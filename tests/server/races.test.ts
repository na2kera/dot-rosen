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

describe("1・2. 路線の確認のあとの非公開化・削除と、追加の競合", () => {
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

  it("再印刷: 確かめたあと追加の直前に非公開になったら 409 で追加しない。作ってから何日たっても再印刷できる", async () => {
    const r = await createRoute(h);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    const c = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    const cookie = await adminCookie(h);

    h.beforeQuery(REPRINT_INSERT, () => h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run());
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`)).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs WHERE reprint_of IS NOT NULL")).toBe(0);

    await h.db.prepare("UPDATE routes SET hidden = 0 WHERE id = ?1").bind(r.id).run();
    h.clock.advance(400 * 24 * 3600_000);
    const cookie2 = await adminCookie(h);
    const res = await admin(h, cookie2, "POST", `/api/admin/jobs/${jobId}/reprint`);
    expect(res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs WHERE reprint_of IS NOT NULL")).toBe(1);
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

  it("路線が非公開でも、鍵が合えば元の印刷の状態を返す。削除されたら 404", async () => {
    const { r, clientId, requestId, a } = await first();
    await h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run();
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

  // 遅いリクエスト: 時刻を採ったあと（古い時間窓）に、別のリクエストが新しい窓で数え始めた
  const LOGIN_WINDOW = 10 * 60_000;
  const RATE_UPSERT = /INSERT INTO rate_limits/;

  it("管理ログイン: 古い時間窓の時刻を持った遅い失敗は、新しい窓の回数を戻さず、今の窓に 1 回として数える", async () => {
    const ip = "198.51.100.30";
    h.clock.set("2026-11-20T03:09:59.000Z"); // 窓の終わり間際に時刻を採る
    h.beforeQuery(RATE_UPSERT, async () => {
      h.clock.advance(LOGIN_WINDOW);
      await seedRateLimit(h, "login", ip, 10); // 新しい窓で上限まで数えられた
    });
    const slow = await adminLogin(h, "wrong", ip);
    expect(slow.status).toBe(429);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `login:${ip}`)).toBe(10);
    // 新しい窓のリクエストも断られる（数え直されていない）
    expect((await adminLogin(h, "wrong", ip)).status).toBe(429);
    const row = await h.db.prepare("SELECT window_start FROM rate_limits WHERE key = ?1").bind(`login:${ip}`).first<{ window_start: string }>();
    expect(row!.window_start).toBe("2026-11-20T03:10:00.000Z");
  });

  it("管理ログイン: 古い時間窓の遅い成功は、今の窓に数えた 1 回を戻す（回数は変わらない）", async () => {
    const ip = "198.51.100.31";
    h.clock.set("2026-11-20T03:09:59.000Z");
    h.beforeQuery(RATE_UPSERT, async () => {
      h.clock.advance(LOGIN_WINDOW);
      await seedRateLimit(h, "login", ip, 5);
    });
    expect((await adminLogin(h, SECRETS.ADMIN_PASSWORD, ip)).status).toBe(200);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `login:${ip}`)).toBe(5);
    // 古い窓の遅い失敗は今の窓に 1 回として数える
    h.clock.set("2026-11-20T03:09:59.000Z");
    expect((await adminLogin(h, "wrong", ip)).status).toBe(401);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `login:${ip}`)).toBe(6);
  });

  it("会場コード: 古い時間窓の時刻を持った遅いリクエストでも、新しい窓の回数は戻らない", async () => {
    const ip = "198.51.100.32";
    h.clock.set("2026-11-20T03:09:59.000Z");
    h.beforeQuery(RATE_UPSERT, async () => {
      h.clock.advance(10 * 60_000);
      await seedRateLimit(h, "code", ip, 30);
    });
    expect((await h.call("GET", "/api/event?code=WRONGCODE1", { ip })).status).toBe(429);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `code:${ip}`)).toBe(30);
  });

  it("時間窓が新しくなれば 1 から数え直す", async () => {
    const ip = "198.51.100.33";
    await seedRateLimit(h, "login", ip, 10);
    expect((await adminLogin(h, "wrong", ip)).status).toBe(429);
    h.clock.advance(LOGIN_WINDOW);
    expect((await adminLogin(h, "wrong", ip)).status).toBe(401);
    expect(await count("SELECT count AS n FROM rate_limits WHERE key = ?1", `login:${ip}`)).toBe(1);
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

describe("6b. 期限は無い: 掃除は路線を消さず、古い記録の期限の日付は印字しない", () => {
  const DAY = 24 * 3600_000;
  const jobs = async () => (await h.db.prepare("SELECT id, status FROM print_jobs ORDER BY id").all<{ id: number; status: string }>()).results;

  it("待ちの印刷がある路線も無い路線も、何日たっても掃除で消えない。待ちの印刷は最後まで刷れる", async () => {
    const r = await createRoute(h);
    const other = await createRoute(h);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    h.clock.advance(400 * DAY);
    expect(await cleanup(h.db, h.clock.now())).toMatchObject({ jobs: 0 });
    expect((await h.call("GET", `/api/routes/${r.id}`)).status).toBe(200);
    expect((await h.call("GET", `/api/routes/${other.id}`)).status).toBe(200);
    const c = await claimAndRead(h);
    expect(c!.jobId).toBe(jobId);
    expect((await printer(h, "POST", `/api/printer/jobs/${jobId}/done`, { ok: true })).status).toBe(200);
    // 終わってから 30 日たった印刷記録は消えるが、路線は残る
    h.clock.advance(31 * DAY);
    expect(await cleanup(h.db, h.clock.now())).toMatchObject({ jobs: 1 });
    expect(await jobs()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM routes")).toBe(2);
  });

  it("再印刷を確かめたあと追加の直前に掃除が走っても、路線は消えず再印刷は入る", async () => {
    const r = await createRoute(h);
    h.clock.advance(20 * DAY);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    const c = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    const cookie = await adminCookie(h);
    // 路線の作成から 31 日後（以前の期限の後）の掃除。元の印刷は終わってから 11 日なので残る
    h.beforeQuery(REPRINT_INSERT, () => cleanup(h.db, new Date(h.clock.now().getTime() + 11 * DAY)));
    const re = await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`);
    expect(re.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM routes")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs WHERE reprint_of = ?1", jobId)).toBe(1);
  });

  it("期限の日付（expiresOn）が残った古い snapshot でも、管理画面の一覧・再印刷が落ちず、期限は印字しない", async () => {
    const r = await createRoute(h);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    const c = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    const cookie = await adminCookie(h);
    // 期限の無い記録からの再印刷
    const plain = await json<{ jobId: number }>(await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`));
    // 期限を廃止する前の記録の形にする
    await h.db.prepare("UPDATE print_jobs SET snapshot = json_set(snapshot, '$.expiresOn', '12月20日') WHERE id = ?1").bind(jobId).run();
    const state = await admin(h, cookie, "GET", "/api/admin/state");
    expect(state.status).toBe(200);
    const re = await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`);
    expect(re.status).toBe(200);
    const old = await json<{ jobId: number }>(re);
    const row = (id: number) =>
      h.db.prepare("SELECT snapshot, raster, height FROM print_jobs WHERE id = ?1").bind(id).first<{ snapshot: string; raster: ArrayBuffer; height: number }>();
    const a = (await row(plain.jobId))!;
    const b = (await row(old.jobId))!;
    // 新しい印刷の snapshot に期限の日付を引き継がず、路線カードも期限の無い記録と同じ
    expect(JSON.parse(b.snapshot)).not.toHaveProperty("expiresOn");
    expect(b.height).toBe(a.height);
    expect(new Uint8Array(b.raster)).toEqual(new Uint8Array(a.raster));
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
