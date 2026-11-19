// サーバーのテストの土台。ローカルの D1（wrangler の getPlatformProxy が起動する workerd / Miniflare）を
// メモリの中だけに作り（.wrangler/ には書かない）、マイグレーションを当ててから、
// API（worker/app.ts）を Node 上で app.request で呼ぶ。
import fs from "node:fs";
import path from "node:path";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import type { StationsFile } from "../../shared/geo/map-data.ts";
import { defaultRouteDraft } from "../../shared/route/index.ts";
import { ensureEventCode } from "../../worker/lib/settings.ts";
import { createApp } from "../../worker/app.ts";
import { createResources } from "../../worker/lib/resources.ts";
import { buildCardRaster } from "../../worker/lib/card.ts";
import { RATE_RULES, type LimitKind } from "../../worker/lib/rate-limit.ts";
import type { Bindings, Db, DbStatement, Deps, Resources } from "../../worker/lib/types.ts";

const root = path.resolve(import.meta.dirname, "../..");

export const ORIGIN = "https://dot-rosen.test";
/** テスト用のダミーの秘密の値 */
export const SECRETS = {
  ADMIN_PASSWORD: "test-admin-password",
  PRINTER_TOKEN: "test-printer-token",
  SESSION_SECRET: "test-session-secret-0123456789",
} as const;

let cachedResources: Resources | null = null;
export function loadResources(): Resources {
  if (!cachedResources) {
    const stations = JSON.parse(fs.readFileSync(path.join(root, "public/data/stations.json"), "utf8")) as StationsFile;
    const font = new Uint8Array(fs.readFileSync(path.join(root, "public/fonts/dotgothic16.bin")));
    cachedResources = createResources(stations, font);
  }
  return cachedResources;
}

/** 実在の駅 ID を先頭から n 件 */
export function stationIds(n: number): string[] {
  const stations = JSON.parse(fs.readFileSync(path.join(root, "public/data/stations.json"), "utf8")) as StationsFile;
  return stations.stations.slice(0, n).map((s) => s.id);
}

const MIGRATIONS = fs
  .readdirSync(path.join(root, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => fs.readFileSync(path.join(root, "migrations", f), "utf8"));

const TABLES = ["routes", "print_jobs", "print_grants", "settings", "rate_limits"];

export type CallOptions = {
  body?: unknown;
  /** 本文をそのまま送る（JSON にしない） */
  raw?: string | Uint8Array;
  headers?: Record<string, string>;
  ip?: string;
};

export type Harness = Awaited<ReturnType<typeof startHarness>>;

export async function startHarness() {
  const proxy = await getPlatformProxy<{ DB: Db }>({
    configPath: path.join(root, "wrangler.jsonc"),
    persist: false,
    envFiles: [],
    remoteBindings: false,
  });
  const db = proxy.env.DB;

  async function migrate() {
    for (const sql of MIGRATIONS) {
      await db.batch(unstable_splitSqlQuery(sql).map((s) => db.prepare(s)));
    }
  }

  /** 表を作り直す（テストごとに独立させる） */
  async function reset() {
    await db.batch(TABLES.map((t) => db.prepare(`DROP TABLE IF EXISTS ${t}`)));
    await db.prepare("DELETE FROM sqlite_sequence").run().catch(() => {});
    await migrate();
    spy.clear();
  }

  let nowMs = Date.parse("2026-11-20T03:00:00.000Z");
  const clock = {
    now: () => new Date(nowMs),
    set: (iso: string) => {
      nowMs = Date.parse(iso);
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };

  // API が使う DB は、実行した文を記録し、特定の文の直前に割り込める包みを通す（競合の順番の再現と文数の確認用）
  const spy = spyDb(db);
  const env: Bindings = { DB: spy.db, ...SECRETS };
  const vars: Partial<Bindings> = {};
  // 路線カードの組み立てを差し替えられるようにする（失敗のテスト用）
  let cardBuilder: Deps["buildCard"] = undefined;
  const app = createApp({
    resources: loadResources(),
    now: clock.now,
    buildCard: (s, n, r) => (cardBuilder ?? buildCardRaster)(s, n, r),
  });

  async function call(method: string, p: string, opts: CallOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { "CF-Connecting-IP": opts.ip ?? "192.0.2.1", ...opts.headers };
    let body: RequestInit["body"];
    if (opts.raw !== undefined) body = opts.raw as RequestInit["body"];
    else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] ??= "application/json";
    }
    const init: RequestInit & { duplex?: "half" } = { method, headers, body };
    if (body instanceof ReadableStream) init.duplex = "half";
    return app.request(`${ORIGIN}${p}`, init, { ...env, ...vars });
  }

  return {
    db,
    clock,
    env,
    /** wrangler.jsonc の vars に当たる値を差し替える */
    vars,
    call,
    reset,
    setCardBuilder: (f: Deps["buildCard"]) => {
      cardBuilder = f;
    },
    /** sql が re に合う文を API が実行する直前に、1回だけ fn を実行する（fn が投げればその文は失敗する） */
    beforeQuery: spy.beforeQuery,
    /** API が実行した文（batch の中の文も1文として数える） */
    executed: spy.executed,
    dispose: () => proxy.dispose(),
  };
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ---- よく使う手順 ----

export const token = () => crypto.randomUUID().replace(/-/g, "");

export function routeData(overrides: Record<string, unknown> = {}) {
  return { ...defaultRouteDraft(), name: "テスト線", symbol: "TS", stations: stationIds(3), ...overrides };
}

export async function createRoute(h: Harness, data: unknown = routeData(), editKey = token()) {
  const res = await h.call("POST", "/api/routes", { body: { data, editKey } });
  if (res.status !== 200) throw new Error(`路線を作れません: ${res.status} ${await res.text()}`);
  const body = await json<{ id: string; expiresAt: string }>(res);
  return { ...body, editKey };
}

export async function currentEventCode(h: Harness): Promise<string> {
  return ensureEventCode(h.db);
}

export async function apply(
  h: Harness,
  route: { id: string; editKey: string },
  opts: { eventCode?: string; clientId?: string; requestId?: string; ip?: string } = {},
) {
  return h.call("POST", "/api/print", {
    ip: opts.ip,
    body: {
      routeId: route.id,
      editKey: route.editKey,
      eventCode: opts.eventCode ?? (await currentEventCode(h)),
      clientId: opts.clientId ?? token(),
      requestId: opts.requestId ?? token(),
    },
  });
}

export function printer(h: Harness, method: string, p: string, body?: unknown, tokenValue: string = SECRETS.PRINTER_TOKEN) {
  return h.call(method, p, { body, headers: { Authorization: `Bearer ${tokenValue}` } });
}

export async function adminLogin(h: Harness, password: string = SECRETS.ADMIN_PASSWORD, ip?: string) {
  return h.call("POST", "/api/admin/login", { body: { password }, ip, headers: { Origin: ORIGIN } });
}

export async function adminCookie(h: Harness): Promise<string> {
  const res = await adminLogin(h);
  const set = res.headers.get("Set-Cookie") ?? "";
  const m = /^(dr_admin=[^;]+)/.exec(set);
  if (!m) throw new Error(`ログインできません: ${res.status}`);
  return m[1];
}

export function admin(h: Harness, cookie: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const base: Record<string, string> = { Cookie: cookie, Origin: ORIGIN };
  if (method !== "GET") base["Content-Type"] = "application/json";
  return h.call(method, p, { body: method === "GET" ? undefined : (body ?? {}), headers: { ...base, ...headers } });
}

/** 印刷を最後まで取り出す（claim → rows → 生データ） */
export async function claimAndRead(h: Harness, step = 240) {
  const res = await printer(h, "POST", "/api/printer/claim");
  if (res.status === 204) return null;
  const job = await json<{ jobId: number; width: number; height: number }>(res);
  const out = new Uint8Array(job.height * 48);
  for (let off = 0; off < job.height; off += step) {
    const n = Math.min(step, job.height - off);
    const r = await printer(h, "GET", `/api/printer/jobs/${job.jobId}/rows?offset=${off}&count=${n}`);
    if (r.status !== 200) throw new Error(`rows が失敗: ${r.status}`);
    out.set(new Uint8Array(await r.arrayBuffer()), off * 48);
  }
  return { ...job, raster: out };
}

/** 待ち（queued）の印刷を SQL で直接 n 件入れる（待ちの上限のテストで、申し込みを n 回呼ぶ代わり） */
export async function seedQueued(h: Harness, n: number, routeId = "seedroute0000000") {
  const now = h.clock.now().toISOString();
  const stmts = Array.from({ length: n }, (_, i) =>
    h.db
      .prepare(
        `INSERT INTO print_jobs (route_id, client_id, request_id, event_code, status, issue_no, sort_key, snapshot, raster, height, created_at)
         VALUES (?1, ?2, ?3, 'seed', 'queued', 0, 0, '{}', ?4, 1, ?5)`,
      )
      .bind(routeId, `seed-client-${i}-0000`, `seed-request-${i}-000`, new Uint8Array(48), now),
  );
  if (stmts.length > 0) await h.db.batch(stmts);
  await h.db.prepare("UPDATE print_jobs SET sort_key = id WHERE event_code = 'seed'").run();
}

/** 回数制限の数を、今の時間窓で count にしておく */
export async function seedRateLimit(h: Harness, kind: LimitKind, ip: string, count: number) {
  const { windowMs } = RATE_RULES[kind];
  const start = new Date(Math.floor(h.clock.now().getTime() / windowMs) * windowMs).toISOString();
  await h.db
    .prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET window_start = ?2, count = ?3")
    .bind(`${kind}:${ip}`, start, count)
    .run();
}

type SpyStatement = DbStatement & { readonly sql: string; readonly inner: DbStatement };

/** 実行した文を記録し、特定の文の直前に割り込める Db の包み */
function spyDb(db: Db) {
  const hooks: { re: RegExp; fn: () => unknown }[] = [];
  const executed: string[] = [];
  async function fire(sql: string) {
    executed.push(sql);
    const i = hooks.findIndex((h) => h.re.test(sql));
    if (i < 0) return;
    const [h] = hooks.splice(i, 1);
    await h.fn();
  }
  const wrap = (sql: string, inner: DbStatement): SpyStatement => ({
    sql,
    inner,
    bind: (...v: unknown[]) => wrap(sql, inner.bind(...v)),
    first: async <T,>() => (await fire(sql), inner.first<T>()),
    all: async <T,>() => (await fire(sql), inner.all<T>()),
    run: async () => (await fire(sql), inner.run()),
  });
  const wrapped: Db = {
    prepare: (sql: string) => wrap(sql, db.prepare(sql)),
    batch: async <T,>(stmts: DbStatement[]) => {
      const list = stmts as SpyStatement[];
      for (const st of list) await fire(st.sql);
      return db.batch<T>(list.map((st) => st.inner));
    },
  };
  return {
    db: wrapped,
    executed,
    /** 割り込みと記録を消す（テストごと） */
    clear: () => {
      hooks.length = 0;
      executed.length = 0;
    },
    beforeQuery: (re: RegExp, fn: () => unknown) => {
      hooks.push({ re, fn });
    },
  };
}
