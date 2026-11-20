// 会場コードの確認と印刷の申し込み（docs/api.md「印刷の申し込み」）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_QUEUED } from "../../worker/lib/jobs.ts";
import { admin, adminCookie, apply, createRoute, currentEventCode, json, routeData, seedQueued, startHarness, stationIds, token, type Harness } from "./harness.ts";

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

describe("会場コードの確認", () => {
  it("正しいコードは valid、違うコードは invalid", async () => {
    const code = await currentEventCode(h);
    expect(await json(await h.call("GET", `/api/event?code=${code}`))).toEqual({ valid: true, accepting: true });
    expect(await json(await h.call("GET", "/api/event?code=WRONGCODE1"))).toEqual({ valid: false, accepting: true });
    expect(await json(await h.call("GET", "/api/event"))).toEqual({ valid: false, accepting: true });
  });
});

describe("印刷の申し込み", () => {
  it("申し込むと queued で待ちに入り、状態を問い合わせられる。snapshot に日付と URL が入る", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const res = await apply(h, r, { clientId });
    expect(res.status).toBe(200);
    const body = await json<PrintRes>(res);
    expect(body).toEqual({
      jobId: expect.any(Number),
      issueNo: 1,
      ahead: 0,
      status: "queued",
      card: { monoSet: "bold", sideLayout: "two-x1" },
      rev: r.rev,
      issuedOn: "2026.11.20",
    });
    const st = await h.call("GET", `/api/print/${body.jobId}?clientId=${clientId}`);
    expect(await json(st)).toEqual({ status: "queued", ahead: 0, issueNo: 1 });
    // clientId が違えば 404
    expect((await h.call("GET", `/api/print/${body.jobId}?clientId=${token()}`)).status).toBe(404);
    expect((await h.call("GET", `/api/print/${body.jobId}`)).status).toBe(404);
    const row = await h.db
      .prepare("SELECT snapshot, height, length(raster) AS len FROM print_jobs WHERE id = ?1")
      .bind(body.jobId)
      .first<{ snapshot: string; height: number; len: number }>();
    const snap = JSON.parse(row!.snapshot);
    // 2026-11-20T03:00Z は日本時間 11/20 12:00。期限は 30 日後
    expect(snap).toMatchObject({ issuedOn: "2026.11.20", expiresOn: "12月20日", url: `https://dot-rosen.test/r/${r.id}`, monoSet: "bold", sideLayout: "two-x1" });
    expect(snap.route.name).toBe("テスト線");
    expect(row!.len).toBe(row!.height * 48);
  });

  it("日付は日本時間（UTC 15:30 は翌日）", async () => {
    h.clock.set("2026-11-20T15:30:00.000Z");
    const r = await createRoute(h);
    const { jobId } = await json<PrintRes>(await apply(h, r));
    const row = await h.db.prepare("SELECT snapshot FROM print_jobs WHERE id = ?1").bind(jobId).first<{ snapshot: string }>();
    expect(JSON.parse(row!.snapshot)).toMatchObject({ issuedOn: "2026.11.21", expiresOn: "12月21日" });
  });

  it("CARD_MONO_SET と CARD_SIDE_LAYOUT で路線カードの設定を変えられる", async () => {
    h.vars.CARD_MONO_SET = "light";
    h.vars.CARD_SIDE_LAYOUT = "lead-x2";
    try {
      const r = await createRoute(h);
      const { jobId } = await json<PrintRes>(await apply(h, r));
      const row = await h.db.prepare("SELECT snapshot FROM print_jobs WHERE id = ?1").bind(jobId).first<{ snapshot: string }>();
      expect(JSON.parse(row!.snapshot)).toMatchObject({ monoSet: "light", sideLayout: "lead-x2" });
    } finally {
      delete h.vars.CARD_MONO_SET;
      delete h.vars.CARD_SIDE_LAYOUT;
    }
  });

  it("会場コードが違えば 403 invalid_code", async () => {
    const r = await createRoute(h);
    const res = await apply(h, r, { eventCode: "WRONGCODE1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("受付停止中は 409 not_accepting", async () => {
    const r = await createRoute(h);
    await h.db.prepare("UPDATE settings SET value = '0' WHERE key = 'accepting'").run();
    const res = await apply(h, r);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_accepting" });
  });

  it("路線の鍵が違えば 403、無い路線は 404、期限切れは 410、非公開は 404", async () => {
    const r = await createRoute(h);
    expect((await apply(h, { id: r.id, editKey: token() })).status).toBe(403);
    expect((await apply(h, { id: "AAAAAAAAAAAAAAAA", editKey: r.editKey })).status).toBe(404);
    await h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run();
    expect((await apply(h, r)).status).toBe(404);
    await h.db.prepare("UPDATE routes SET hidden = 0 WHERE id = ?1").bind(r.id).run();
    h.clock.advance(31 * 24 * 3600_000);
    expect((await apply(h, r)).status).toBe(410);
  });

  it("入力の長さと文字種", async () => {
    const r = await createRoute(h);
    expect((await apply(h, r, { clientId: "short" })).status).toBe(400);
    expect((await apply(h, r, { requestId: "x".repeat(65) })).status).toBe(400);
    expect((await apply(h, r, { clientId: "あ".repeat(20) })).status).toBe(400);
    expect((await apply(h, r, { eventCode: "コード" })).status).toBe(400);
  });

  it("回数上限: 1台1回。上限の解除で1回増える。取り消し・失敗は数えない", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const first = await json<PrintRes>(await apply(h, r, { clientId }));
    const second = await apply(h, r, { clientId });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "limit_reached" });

    const cookie = await adminCookie(h);
    expect((await admin(h, cookie, "POST", `/api/admin/clients/${clientId}/grant`)).status).toBe(200);
    expect((await apply(h, r, { clientId })).status).toBe(200);
    expect((await apply(h, r, { clientId })).status).toBe(409);

    // 取り消した印刷は数えない
    await admin(h, cookie, "POST", `/api/admin/jobs/${first.jobId}/cancel`);
    expect((await apply(h, r, { clientId })).status).toBe(200);
  });

  it("待ちが満杯（queued が 30 件）なら 409 queue_full", async () => {
    const r = await createRoute(h);
    // 申し込みを 29 回呼ぶ代わりに SQL で入れる。30 件目は通り、31 件目で満杯
    await seedQueued(h, MAX_QUEUED - 1);
    expect((await apply(h, r)).status).toBe(200);
    const res = await apply(h, r);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "queue_full" });
  });

  it("同じ (clientId, requestId) の再送は新しく作らず元の印刷を返す。次の番号は連番のまま", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const requestId = token();
    const a = await json<PrintRes>(await apply(h, r, { clientId, requestId }));
    const b = await json<PrintRes>(await apply(h, r, { clientId, requestId }));
    expect(b).toEqual(a);
    const n = await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").first<{ n: number }>();
    expect(n!.n).toBe(1);
    // 受付を止めたあとの再送でも、元の印刷を返す
    await h.db.prepare("UPDATE settings SET value = '0' WHERE key = 'accepting'").run();
    expect(await json<PrintRes>(await apply(h, r, { clientId, requestId }))).toEqual(a);
    await h.db.prepare("UPDATE settings SET value = '1' WHERE key = 'accepting'").run();
    const c = await json<PrintRes>(await apply(h, r));
    expect(c.issueNo).toBe(a.issueNo + 1);
  });

  it("発行番号は連番で、ahead は前にある件数", async () => {
    const r = await createRoute(h);
    const got: PrintRes[] = [];
    for (let i = 0; i < 4; i++) got.push(await json<PrintRes>(await apply(h, r)));
    expect(got.map((g) => g.issueNo)).toEqual([1, 2, 3, 4]);
    expect(got.map((g) => g.ahead)).toEqual([0, 1, 2, 3]);
  });

  it("同時に 10 件申し込んでも、番号が重複せず上限も超えない", async () => {
    const r = await createRoute(h);
    // 別々の端末 10 台
    const many = await Promise.all(Array.from({ length: 10 }, () => apply(h, r)));
    const bodies = await Promise.all(many.map((m) => json<PrintRes>(m)));
    expect(many.every((m) => m.status === 200)).toBe(true);
    expect(bodies.map((b) => b.issueNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const counter = await h.db.prepare("SELECT value FROM settings WHERE key = 'issue_counter'").first<{ value: string }>();
    expect(Number(counter!.value)).toBe(10);

    // 同じ端末から別々の requestId で 10 件: 1 件だけ通る
    const clientId = token();
    const same = await Promise.all(Array.from({ length: 10 }, () => apply(h, r, { clientId })));
    expect(same.filter((m) => m.status === 200)).toHaveLength(1);
    expect(same.filter((m) => m.status === 409)).toHaveLength(9);

    // 待ちが 25 件（11 件 + SQL で 14 件）のところへ 10 件: 5 件だけ通り、待ちは 30 件を超えない
    await seedQueued(h, 14);
    const fill = await Promise.all(Array.from({ length: 10 }, () => apply(h, r)));
    expect(fill.filter((m) => m.status === 200)).toHaveLength(5);
    expect(fill.filter((m) => m.status === 409)).toHaveLength(5);
    // 本物の申し込み 16 件の番号はすべて違い、待ちは全体で 30 件
    const q = await h.db
      .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT issue_no) AS d FROM print_jobs WHERE status = 'queued' AND event_code != 'seed'")
      .first<{ n: number; d: number }>();
    expect(q).toEqual({ n: 16, d: 16 });
    const total = await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs WHERE status = 'queued'").first<{ n: number }>();
    expect(total!.n).toBe(30);
  });

  it("同じ requestId を同時に 5 回送っても 1 件だけ作る（準備中の 409 は送り直すと同じ印刷に収束する）", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const requestId = token();
    const send = () => apply(h, r, { clientId, requestId });
    // 先行の申し込みが画像を保存する前に再送が着く順番を、必ず 1 件含める（その再送は準備中の 409 が正しい）
    let early: Response | null = null;
    h.beforeQuery(/UPDATE print_jobs SET raster = \?1/, async () => {
      early = await send();
    });
    const res = [...(await Promise.all(Array.from({ length: 4 }, send)))];
    res.push(early!);
    expect(res).toHaveLength(5);
    // 初回は 200 か準備中の 409（conflict, Retry-After: 2）。409 だったものは同じ requestId で送り直す
    const bodies: PrintRes[] = [];
    for (let m of res) {
      for (let i = 0; m.status === 409 && i < 10; i++) {
        expect(m.headers.get("Retry-After")).toBe("2");
        expect(await m.json()).toEqual({ error: "conflict" });
        m = await send();
      }
      expect(m.status).toBe(200);
      bodies.push(await json<PrintRes>(m));
    }
    expect((early as Response | null)?.status).toBe(409);
    const ids = new Set(bodies.map((b) => b.jobId));
    expect(ids.size).toBe(1);
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").first<{ n: number }>())!.n).toBe(1);
    const counter = await h.db.prepare("SELECT value FROM settings WHERE key = 'issue_counter'").first<{ value: string }>();
    expect(counter!.value).toBe("1");
  });

  it("画像を入れられずに残った申し込みは、1分たつと failed（render）になり数えない", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const { jobId } = await json<PrintRes>(await apply(h, r, { clientId }));
    // Worker が画像を入れる前に止まった状態を作る
    await h.db.prepare("UPDATE print_jobs SET raster = NULL, height = NULL WHERE id = ?1").bind(jobId).run();
    h.clock.advance(61_000);
    expect((await apply(h, r, { clientId })).status).toBe(200);
    const row = await h.db.prepare("SELECT status, error FROM print_jobs WHERE id = ?1").bind(jobId).first();
    expect(row).toEqual({ status: "failed", error: "render" });
  });

  it("画像の組み立てに失敗したら印刷を作らず 500。回数も番号も消費しない", async () => {
    const r = await createRoute(h);
    const clientId = token();
    await json(await apply(h, r)); // 1 番
    h.setCardBuilder(() => {
      throw new Error("高さが上限を超えた");
    });
    try {
      const res = await apply(h, r, { clientId });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      h.setCardBuilder(undefined);
    }
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").first<{ n: number }>())!.n).toBe(1);
    const ok = await json<PrintRes>(await apply(h, r, { clientId }));
    expect(ok.issueNo).toBe(2);
  });

  it("本物の路線カードは高さ 3,200 行以内で、生データは 48 × 高さ バイト", async () => {
    const r = await createRoute(h, routeData({ stations: stationIds(30), train: { ...routeData().train, cars: 16 } }));
    const { jobId } = await json<PrintRes>(await apply(h, r));
    const row = await h.db.prepare("SELECT height, length(raster) AS len FROM print_jobs WHERE id = ?1").bind(jobId).first<{ height: number; len: number }>();
    expect(row!.height).toBeGreaterThan(0);
    expect(row!.height).toBeLessThanOrEqual(3200);
    expect(row!.len).toBe(row!.height * 48);
  });

  it("会場コードを作り直すと古いコードは無効になり、回数は数え直し", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const old = await currentEventCode(h);
    expect((await apply(h, r, { clientId, eventCode: old })).status).toBe(200);
    expect((await apply(h, r, { clientId, eventCode: old })).status).toBe(409);
    const cookie = await adminCookie(h);
    const { eventCode } = await json<{ eventCode: string }>(await admin(h, cookie, "POST", "/api/admin/event-code/regenerate"));
    expect(eventCode).not.toBe(old);
    expect(eventCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect((await apply(h, r, { clientId, eventCode: old })).status).toBe(403);
    expect((await apply(h, r, { clientId, eventCode })).status).toBe(200);
  });
});
