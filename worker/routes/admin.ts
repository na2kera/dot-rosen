// 管理 API（docs/api.md「6. 管理 API」）。
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { buildCardRaster, type CardSnapshot } from "../lib/card.ts";
import { isCardMonoSet, isCardSideLayout, toCardLook, type CardLook } from "../../shared/card/index.ts";
import { cardOptions, iso } from "../lib/config.ts";
import { hmacHex, newEventCode, newToken, safeEqual } from "../lib/crypto.ts";
import { ApiError, asRecord, CLIENT_TOKEN_RE, clientIp, conflict, invalid, jobIdParam, notFound, readJson, ROUTE_ID_RE } from "../lib/http.ts";
import { sweepOrphansStatement, sweepTimeoutsStatement, type JobStatus } from "../lib/jobs.ts";
import { acquireAttempt, releaseAttempt } from "../lib/rate-limit.ts";
import { ensureEventCode, readSettings } from "../lib/settings.ts";
import type { AppEnv, Deps } from "../lib/types.ts";

export const SESSION_COOKIE = "dr_admin";
/** 管理 Cookie の有効時間（12時間） */
export const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_PASSWORD_LENGTH = 256;

function secrets(c: Context<AppEnv>): { password: string; sessionSecret: string } {
  const password = c.env.ADMIN_PASSWORD;
  const sessionSecret = c.env.SESSION_SECRET;
  if (!password || !sessionSecret) {
    console.error("ADMIN_PASSWORD か SESSION_SECRET が設定されていません");
    throw new ApiError(500, "internal");
  }
  return { password, sessionSecret };
}

async function sessionValue(secret: string, expMs: number): Promise<string> {
  return `${expMs}.${await hmacHex(secret, `admin-session:${expMs}`)}`;
}

function readCookie(c: Context<AppEnv>, name: string): string | null {
  const header = c.req.header("Cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function setSessionCookie(c: Context<AppEnv>, value: string, maxAgeSec: number) {
  c.header("Set-Cookie", `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSec}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict`);
}

/** 状態を変える管理 API: Origin が自分のオリジンと一致し、Content-Type が JSON であること */
const sameOriginJson = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (!origin || origin !== new URL(c.req.url).origin) throw new ApiError(403, "forbidden");
    if (!/^application\/json\s*(;|$)/i.test(c.req.header("Content-Type") ?? "")) throw invalid();
  }
  await next();
});

/**
 * 再印刷の本文 { monoSet?, sideLayout? }。書かれた項目だけを返す。不正な値は 400
 * （刷り比べのため、その再印刷だけ見た目を変える）
 */
function reprintLook(body: Record<string, unknown>): Partial<CardLook> {
  const out: Partial<CardLook> = {};
  if (body.monoSet !== undefined) {
    if (!isCardMonoSet(body.monoSet)) throw invalid();
    out.monoSet = body.monoSet;
  }
  if (body.sideLayout !== undefined) {
    if (!isCardSideLayout(body.sideLayout)) throw invalid();
    out.sideLayout = body.sideLayout;
  }
  return out;
}

export function adminApi(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use("/admin/*", sameOriginJson);

  // ログイン以外は Cookie が必須
  app.use("/admin/*", async (c, next) => {
    if (c.req.path === "/api/admin/login") return next();
    const { sessionSecret } = secrets(c);
    const v = readCookie(c, SESSION_COOKIE);
    const m = v ? /^(\d{1,16})\.([0-9a-f]{64})$/.exec(v) : null;
    if (!m) throw new ApiError(401, "unauthorized");
    const exp = Number(m[1]);
    const now = deps.now().getTime();
    if (!(exp > now && exp <= now + SESSION_MS)) throw new ApiError(401, "unauthorized");
    if (!(await safeEqual(v!, await sessionValue(sessionSecret, exp)))) throw new ApiError(401, "unauthorized");
    await next();
  });

  app.post("/admin/login", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const ip = clientIp(c);
    const { password, sessionSecret } = secrets(c);
    const body = asRecord(await readJson(c));
    const given = typeof body.password === "string" && body.password.length <= MAX_PASSWORD_LENGTH ? body.password : "";
    // 照合の前に失敗の枠を1つ取り（上限なら 429 で照合しない）、成功したら戻す
    const attempt = await acquireAttempt(db, "login", ip, now);
    if (!(await safeEqual(given, password))) throw new ApiError(401, "unauthorized");
    await releaseAttempt(db, attempt);
    const exp = now.getTime() + SESSION_MS;
    setSessionCookie(c, await sessionValue(sessionSecret, exp), SESSION_MS / 1000);
    return c.json({ ok: true, expiresAt: iso(new Date(exp)) });
  });

  app.post("/admin/logout", (c) => {
    setSessionCookie(c, "", 0);
    return c.json({ ok: true });
  });

  app.get("/admin/state", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    await db.batch([sweepTimeoutsStatement(db, now), sweepOrphansStatement(db, now)]);
    const eventCode = await ensureEventCode(db);
    const [s, jobs, counts] = await Promise.all([
      readSettings(db),
      db
        .prepare(
          `SELECT id, route_id AS routeId, json_extract(snapshot, '$.route.name') AS routeName, client_id AS clientId,
             status, issue_no AS issueNo, created_at AS createdAt, claimed_at AS claimedAt, finished_at AS finishedAt,
             error, reprint_of AS reprintOf,
             json_extract(snapshot, '$.monoSet') AS monoSet, json_extract(snapshot, '$.sideLayout') AS sideLayout
           FROM print_jobs ORDER BY id DESC LIMIT 100`,
        )
        .all(),
      db.prepare("SELECT status, COUNT(*) AS n FROM print_jobs GROUP BY status").all<{ status: JobStatus; n: number }>(),
    ]);
    const fallbackLook = cardOptions(c.env);
    const countMap: Record<JobStatus, number> = { queued: 0, printing: 0, done: 0, failed: 0, canceled: 0 };
    for (const r of counts.results) countMap[r.status] = r.n;
    return c.json({
      accepting: s.accepting,
      eventCode,
      printer: { lastSeenAt: s.printerLastSeen },
      // 見た目の無い古い記録は、今の設定（指定なしの再印刷で使う見た目）で埋める
      jobs: jobs.results.map((j) => ({ ...j, ...toCardLook(j, fallbackLook) })),
      counts: countMap,
    });
  });

  app.post("/admin/jobs/:id/cancel", async (c) => {
    const db = c.env.DB;
    const id = jobIdParam(c.req.param("id"));
    const row = await db
      .prepare("UPDATE print_jobs SET status = 'canceled', finished_at = ?1, raster = NULL WHERE id = ?2 AND status = 'queued' RETURNING id")
      .bind(iso(deps.now()), id)
      .first();
    if (row) return c.json({ ok: true });
    const exists = await db.prepare("SELECT 1 AS x FROM print_jobs WHERE id = ?1").bind(id).first();
    throw exists ? conflict() : notFound();
  });

  app.post("/admin/jobs/:id/reprint", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const nowIso = iso(now);
    const id = jobIdParam(c.req.param("id"));
    const override = reprintLook(asRecord(await readJson(c, { optional: true })));
    type Src = { status: JobStatus; issue_no: number; snapshot: string; route_hidden: number | null; route_exists: string | null };
    const load = () =>
      db
        .prepare(
          `SELECT j.status, j.issue_no, j.snapshot, r.hidden AS route_hidden, r.id AS route_exists
           FROM print_jobs j LEFT JOIN routes r ON r.id = j.route_id WHERE j.id = ?1`,
        )
        .bind(id)
        .first<Src>();
    // 刷れない理由: 無い 404、終わっていない 409、路線が消えた・非公開 409
    const reason = (src: Src | null): ApiError | null => {
      if (!src) return notFound();
      if (src.status !== "done" && src.status !== "failed") return conflict();
      if (src.route_exists === null || src.route_hidden) return conflict();
      return null;
    };
    const src = await load();
    const before = reason(src);
    if (before) throw before;
    // 見た目: 指定があればそれ、無ければ元の印刷と同じ（元の記録に無ければ今の設定）。
    // 新しい印刷の snapshot には使った見た目を必ず入れる（この再印刷をさらに再印刷しても同じ見た目になる）
    let card;
    let snapshot: CardSnapshot;
    try {
      // 期限を廃止する前の記録には expiresOn（期限の日付）が残っていることがある。印字しないので引き継がない
      const { expiresOn: _expiresOn, ...orig } = JSON.parse(src!.snapshot) as CardSnapshot & { expiresOn?: unknown };
      snapshot = { ...orig, ...toCardLook(orig, cardOptions(c.env)), ...override };
      card = (deps.buildCard ?? buildCardRaster)(snapshot, src!.issue_no, deps.resources);
    } catch (e) {
      console.error("再印刷の組み立てに失敗", { jobId: id, message: e instanceof Error ? e.message : String(e) });
      throw new ApiError(500, "internal");
    }
    // 元の路線データ・日付・URL と発行番号（見た目だけ上で決めたもの）で、待ちの先頭（いまの先頭より小さい sort_key）に入れる。
    // 路線が存在し、非公開でないことを同じ文の中で確かめる（確かめたあとの非公開化・削除と競合しない）
    const row = await db
      .prepare(
        `INSERT INTO print_jobs (route_id, client_id, request_id, event_code, status, issue_no, sort_key, snapshot, raster, height, created_at, reprint_of)
         SELECT j.route_id, j.client_id, ?1, j.event_code, 'queued', j.issue_no,
           COALESCE((SELECT MIN(sort_key) FROM print_jobs WHERE status = 'queued'), 0) - 1,
           ?6, ?2, ?3, ?4, j.id
         FROM print_jobs j
         WHERE j.id = ?5 AND j.status IN ('done', 'failed')
           AND EXISTS (SELECT 1 FROM routes r WHERE r.id = j.route_id AND r.hidden = 0)
         RETURNING id, issue_no`,
      )
      .bind(`reprint-${newToken()}`, card.raster, card.height, nowIso, id, JSON.stringify(snapshot))
      .first<{ id: number; issue_no: number }>();
    if (!row) throw reason(await load()) ?? conflict();
    return c.json({ jobId: row.id, issueNo: row.issue_no, card: { monoSet: snapshot.monoSet, sideLayout: snapshot.sideLayout } });
  });

  app.post("/admin/clients/:clientId/grant", async (c) => {
    const db = c.env.DB;
    const clientId = c.req.param("clientId");
    if (!CLIENT_TOKEN_RE.test(clientId)) throw invalid();
    const eventCode = await ensureEventCode(db);
    const row = await db
      .prepare(
        `INSERT INTO print_grants (client_id, event_code, extra) VALUES (?1, ?2, 1)
         ON CONFLICT (client_id, event_code) DO UPDATE SET extra = extra + 1 RETURNING extra`,
      )
      .bind(clientId, eventCode)
      .first<{ extra: number }>();
    return c.json({ ok: true, extra: row?.extra ?? 1 });
  });

  app.post("/admin/accepting", async (c) => {
    const body = asRecord(await readJson(c));
    if (typeof body.accepting !== "boolean") throw invalid();
    await c.env.DB.prepare("UPDATE settings SET value = ?1 WHERE key = 'accepting'").bind(body.accepting ? "1" : "0").run();
    return c.json({ ok: true, accepting: body.accepting });
  });

  app.post("/admin/event-code/regenerate", async (c) => {
    const db = c.env.DB;
    const eventCode = newEventCode();
    // 新しいコードにするのと、古いコードの上限の解除（print_grants）を消すのを1つの batch で
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('event_code', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(eventCode),
      db.prepare("DELETE FROM print_grants WHERE event_code != ?1").bind(eventCode),
    ]);
    return c.json({ eventCode });
  });

  app.get("/admin/routes", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, json_extract(data, '$.name') AS name, created_at AS createdAt, hidden
       FROM routes ORDER BY created_at DESC LIMIT 100`,
    ).all<{ id: string; name: string; createdAt: string; hidden: number }>();
    return c.json({ routes: results.map((r) => ({ ...r, hidden: r.hidden === 1 })) });
  });

  app.post("/admin/routes/:id/hide", async (c) => {
    const db = c.env.DB;
    const id = c.req.param("id");
    if (!ROUTE_ID_RE.test(id)) throw notFound();
    const body = asRecord(await readJson(c));
    if (typeof body.hidden !== "boolean") throw invalid();
    const hidden = body.hidden ? 1 : 0;
    // 非公開にするのと、その路線の待ちの印刷の取り消しを1つの batch で
    const results = await db.batch<{ id: unknown }>([
      db.prepare("UPDATE routes SET hidden = ?1 WHERE id = ?2 RETURNING id").bind(hidden, id),
      db
        .prepare(
          `UPDATE print_jobs SET status = 'canceled', finished_at = ?1, raster = NULL
           WHERE route_id = ?2 AND status = 'queued' AND ?3 = 1 RETURNING id`,
        )
        .bind(iso(deps.now()), id, hidden),
    ]);
    if (!results[0].results[0]) throw notFound();
    return c.json({ ok: true, hidden: body.hidden, canceled: results[1].results.length });
  });

  return app;
}
