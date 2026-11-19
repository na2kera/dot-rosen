// 競合・再送の順番、回数制限の並行、掃除、問い合わせの文数（コードレビューの指摘への対応）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "../../worker/lib/cleanup.ts";
import {
  admin,
  adminCookie,
  adminLogin,
  apply,
  claimAndRead,
  createRoute,
  currentEventCode,
  json,
  printer,
  routeData,
  seedRateLimit,
  SECRETS,
  startHarness,
  token,
  type Harness,
} from "./harness.ts";

// ローカルの D1 を通すので、並列で走らせると1件あたりの時間が延びる
vi.setConfig({ testTimeout: 30_000 });

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});
beforeEach(async () => {
  await h.reset();
  h.clock.set("2026-11-20T03:00:00.000Z");
});

type PrintRes = { jobId: number; issueNo: number; ahead: number; status: string };
const ENQUEUE = /^\s*INSERT INTO print_jobs \(route_id, client_id, request_id, event_code, status, issue_no, sort_key, snapshot, created_at\)/;
const SAVE_RASTER = /UPDATE print_jobs SET raster = \?1/;
const REPRINT_INSERT = /reprint_of\)/;

const count = async (sql: string, ...binds: unknown[]) => (await h.db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const counter = async () => Number((await h.db.prepare("SELECT value FROM settings WHERE key = 'issue_counter'").first<{ value: string }>())!.value);

describe("1・2. 路線の確認のあとの非公開化・削除・期限切れと、追加の競合", () => {
  it("確認のあと追加の直前に非公開になったら、追加せず 404。番号も消費しない", async () => {
    const r = await createRoute(h);
    h.beforeQuery(ENQUEUE, () => h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run());
    const res = await apply(h, r);
    expect(res.status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(0);
    expect(await counter()).toBe(0);
  });

  it("確認のあと追加の直前に削除されたら 404", async () => {
    const r = await createRoute(h);
    h.beforeQuery(ENQUEUE, () => h.db.prepare("DELETE FROM routes WHERE id = ?1").bind(r.id).run());
    expect((await apply(h, r)).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(0);
  });

  it("確認のあと追加の直前に期限が切れたら 410", async () => {
    const r = await createRoute(h);
    h.beforeQuery(ENQUEUE, () => h.db.prepare("UPDATE routes SET expires_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(r.id).run());
    const res = await apply(h, r);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expired" });
  });

  it("再印刷: 期限切れの路線は 410。確かめたあと追加の直前に非公開になったら 409 で追加しない", async () => {
    const r = await createRoute(h);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    const c = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    const cookie = await adminCookie(h);

    h.beforeQuery(REPRINT_INSERT, () => h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run());
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`)).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs WHERE reprint_of IS NOT NULL")).toBe(0);

    await h.db.prepare("UPDATE routes SET hidden = 0 WHERE id = ?1").bind(r.id).run();
    h.beforeQuery(REPRINT_INSERT, () => h.db.prepare("UPDATE routes SET expires_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(r.id).run());
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`)).status).toBe(410);

    // 最初から期限切れ
    h.clock.advance(31 * 24 * 3600_000);
    const cookie2 = await adminCookie(h);
    const res = await admin(h, cookie2, "POST", `/api/admin/jobs/${jobId}/reprint`);
    expect(res.status).toBe(410);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs WHERE reprint_of IS NOT NULL")).toBe(0);
  });
});

describe("3. 同じ (clientId, requestId) の再送", () => {
  async function first() {
    const r = await createRoute(h);
    const clientId = token();
    const requestId = token();
    const a = await json<PrintRes>(await apply(h, r, { clientId, requestId }));
    return { r, clientId, requestId, a };
  }

  it("鍵が違えば 403、路線 ID が違えば 409", async () => {
    const { r, clientId, requestId } = await first();
    const bad = await apply(h, { id: r.id, editKey: token() }, { clientId, requestId });
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: "forbidden" });
    const other = await createRoute(h);
    expect((await apply(h, other, { clientId, requestId })).status).toBe(409);
  });

  it("路線が非公開・期限切れでも、鍵が合えば元の印刷の状態を返す。削除されたら 404", async () => {
    const { r, clientId, requestId, a } = await first();
    await h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run();
    expect(await json(await apply(h, r, { clientId, requestId }))).toEqual(a);
    await h.db.prepare("UPDATE routes SET hidden = 0, expires_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1").bind(r.id).run();
    expect(await json(await apply(h, r, { clientId, requestId }))).toEqual(a);
    await h.db.prepare("DELETE FROM routes WHERE id = ?1").bind(r.id).run();
    expect((await apply(h, r, { clientId, requestId })).status).toBe(404);
  });
});

describe("4. 画像の準備中の再送と、画像の保存の失敗", () => {
  it("画像を保存する直前に届いた再送には成功を返さず、409 と Retry-After: 2。最初の申し込みは成功する", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const requestId = token();
    let replay: Response | null = null;
    h.beforeQuery(SAVE_RASTER, async () => {
      replay = await apply(h, r, { clientId, requestId });
    });
    const res = await apply(h, r, { clientId, requestId });
    expect(res.status).toBe(200);
    expect(replay!.status).toBe(409);
    expect(replay!.headers.get("Retry-After")).toBe("2");
    expect(await replay!.json()).toEqual({ error: "conflict" });
    // 準備が終わったあとの再送は元の印刷を返す
    expect(await json(await apply(h, r, { clientId, requestId }))).toEqual(await json(res));
  });

  it("画像の保存に失敗したら、印刷を消し、番号を戻し、500。回数も消費しない", async () => {
    const r = await createRoute(h);
    const clientId = token();
    h.beforeQuery(SAVE_RASTER, () => {
      throw new Error("D1 の書き込みに失敗（試験）");
    });
    const res = await apply(h, r, { clientId });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(0);
    expect(await counter()).toBe(0);
    const ok = await json<PrintRes>(await apply(h, r, { clientId }));
    expect(ok.issueNo).toBe(1);
  });

  it("claim は画像の無い（準備中の）印刷を渡さない", async () => {
    const r = await createRoute(h);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    await h.db.prepare("UPDATE print_jobs SET raster = NULL, height = NULL WHERE id = ?1").bind(jobId).run();
    expect((await printer(h, "POST", "/api/printer/claim")).status).toBe(204);
    expect((await h.db.prepare("SELECT status FROM print_jobs WHERE id = ?1").bind(jobId).first<{ status: string }>())!.status).toBe("queued");
  });
});

describe("5. 失敗回数の制限は、並行のリクエストでも超えない", () => {
  it("会場コード: 残り 2 回のところへ違うコードを 10 件同時に送ると、照合されるのは 2 件だけ", async () => {
    const ip = "198.51.100.20";
    await seedRateLimit(h, "code", ip, 28);
    const res = await Promise.all(Array.from({ length: 10 }, () => h.call("GET", "/api/event?code=WRONGCODE1", { ip })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(2);
    expect(res.filter((r) => r.status === 429)).toHaveLength(8);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `code:${ip}`)).toBe(30);
  });

  it("会場コード: 正しいコードは数えない（残り 1 回でも通り、数は増えない）", async () => {
    const ip = "198.51.100.21";
    const code = await currentEventCode(h);
    await seedRateLimit(h, "code", ip, 29);
    expect(await json(await h.call("GET", `/api/event?code=${code}`, { ip }))).toEqual({ valid: true, accepting: true });
    const r = await createRoute(h);
    expect((await apply(h, r, { ip })).status).toBe(200);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `code:${ip}`)).toBe(29);
  });

  it("管理ログイン: 残り 2 回のところへ違うパスワードを 6 件同時に送ると、照合されるのは 2 件だけ。成功は数えない", async () => {
    const ip = "198.51.100.22";
    await seedRateLimit(h, "login", ip, 8);
    const res = await Promise.all(Array.from({ length: 6 }, () => adminLogin(h, "wrong", ip)));
    expect(res.filter((r) => r.status === 401)).toHaveLength(2);
    expect(res.filter((r) => r.status === 429)).toHaveLength(4);

    const ip2 = "198.51.100.23";
    await seedRateLimit(h, "login", ip2, 9);
    expect((await adminLogin(h, SECRETS.ADMIN_PASSWORD, ip2)).status).toBe(200);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `login:${ip2}`)).toBe(9);
  });

  it("路線の作成: 残り 3 回のところへ 8 件同時に送ると、作られるのは 3 件だけ", async () => {
    const ip = "198.51.100.24";
    await seedRateLimit(h, "create", ip, 117);
    const res = await Promise.all(Array.from({ length: 8 }, () => h.call("POST", "/api/routes", { body: { data: routeData(), editKey: token() }, ip })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(3);
    expect(res.filter((r) => r.status === 429)).toHaveLength(5);
    expect(await count("SELECT COUNT(*) AS n FROM routes")).toBe(3);
  });
});

describe("6. 日次の掃除", () => {
  it("削除した路線の printing は時間切れで failed になり、終わった印刷として消える", async () => {
    const r = await createRoute(h);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    await printer(h, "POST", "/api/printer/claim");
    expect((await h.call("DELETE", `/api/routes/${r.id}`, { headers: { "X-Edit-Key": r.editKey } })).status).toBe(200);
    // まだ時間切れでない printing は残す
    expect(await cleanup(h.db, h.clock.now())).toMatchObject({ timedOut: 0, jobs: 0 });
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs WHERE id = ?1", jobId)).toBe(1);
    h.clock.advance(6 * 60_000);
    expect(await cleanup(h.db, h.clock.now())).toMatchObject({ timedOut: 1, jobs: 1 });
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(0);
  });

  it("画像の無いまま残った古い queued を消し、終わった印刷に残った raster を消す", async () => {
    const r = await createRoute(h);
    const a = await json<PrintRes>(await apply(h, r));
    const b = await json<PrintRes>(await apply(h, r));
    await h.db.prepare("UPDATE print_jobs SET raster = NULL WHERE id = ?1").bind(a.jobId).run();
    await h.db.prepare("UPDATE print_jobs SET status = 'done', finished_at = ?2 WHERE id = ?1").bind(b.jobId, h.clock.now().toISOString()).run();
    // 準備中（1 分以内）のものは消さない
    expect(await cleanup(h.db, h.clock.now())).toMatchObject({ jobs: 0, rasterCleared: 1 });
    h.clock.advance(61_000);
    expect(await cleanup(h.db, h.clock.now())).toMatchObject({ jobs: 1, rasterCleared: 0 });
    const rows = await h.db.prepare("SELECT id, status, raster FROM print_jobs").all();
    expect(rows.results).toEqual([{ id: b.jobId, status: "done", raster: null }]);
  });
});

describe("7. 会場コードの作り直し", () => {
  it("古いコードの上限の解除（print_grants）を消す", async () => {
    const cookie = await adminCookie(h);
    await admin(h, cookie, "POST", `/api/admin/clients/${token()}/grant`);
    await admin(h, cookie, "POST", `/api/admin/clients/${token()}/grant`);
    expect(await count("SELECT COUNT(*) AS n FROM print_grants")).toBe(2);
    await admin(h, cookie, "POST", "/api/admin/event-code/regenerate");
    expect(await count("SELECT COUNT(*) AS n FROM print_grants")).toBe(0);
  });
});

describe("8. 問い合わせの文数", () => {
  it("待ちも印刷中も無い claim は 1 文（printer_last_seen の更新が要るときだけ 2 文）", async () => {
    h.executed.length = 0;
    expect((await printer(h, "POST", "/api/printer/claim")).status).toBe(204);
    expect(h.executed).toHaveLength(2); // printer_last_seen が空なので更新する
    h.executed.length = 0;
    h.clock.advance(10_000);
    expect((await printer(h, "POST", "/api/printer/claim")).status).toBe(204);
    expect(h.executed).toHaveLength(1);
    h.executed.length = 0;
    h.clock.advance(30_000);
    expect((await printer(h, "POST", "/api/printer/claim")).status).toBe(204);
    expect(h.executed).toHaveLength(2);
    const seen = await h.db.prepare("SELECT value FROM settings WHERE key = 'printer_last_seen'").first<{ value: string }>();
    expect(seen!.value).toBe("2026-11-20T03:00:40.000Z");
  });

  it("待ちがあれば従来どおり（1 文で確かめ、batch の 4 文で渡す）", async () => {
    const r = await createRoute(h);
    await apply(h, r);
    h.executed.length = 0;
    expect((await printer(h, "POST", "/api/printer/claim")).status).toBe(200);
    expect(h.executed).toHaveLength(5);
  });

  it("GET /api/print/:jobId は 1 文", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const { jobId } = await json<PrintRes>(await apply(h, r, { clientId }));
    h.executed.length = 0;
    expect((await h.call("GET", `/api/print/${jobId}?clientId=${clientId}`)).status).toBe(200);
    expect(h.executed).toHaveLength(1);
  });
});
