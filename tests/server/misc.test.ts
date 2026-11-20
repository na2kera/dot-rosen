// 回数制限、定期実行の掃除、共通の決まり。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "../../worker/lib/cleanup.ts";
import {
  apply,
  claimAndRead,
  createRoute,
  currentEventCode,
  json,
  printer,
  routeData,
  seedRateLimit,
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

describe("回数制限", () => {
  it("路線の作成は IP ごとに 1時間 120 回まで", async () => {
    // 118 回まで数えた状態から（120 回を実際に呼ぶ代わり）。119・120 回目は通り、121 回目で断る
    await seedRateLimit(h, "create", "203.0.113.5", 118);
    for (let i = 0; i < 2; i++) {
      const res = await h.call("POST", "/api/routes", { body: { data: routeData(), editKey: token() }, ip: "203.0.113.5" });
      expect(res.status).toBe(200);
    }
    const res = await h.call("POST", "/api/routes", { body: { data: routeData(), editKey: token() }, ip: "203.0.113.5" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await h.call("POST", "/api/routes", { body: { data: routeData(), editKey: token() }, ip: "203.0.113.6" })).status).toBe(200);
    h.clock.advance(3600_000);
    expect((await h.call("POST", "/api/routes", { body: { data: routeData(), editKey: token() }, ip: "203.0.113.5" })).status).toBe(200);
  });

  it("会場コードが違った回数は 10分に 30 回まで（確認と申し込みの合計）。正しいコードは数えない", async () => {
    const r = await createRoute(h);
    const ip = "203.0.113.9";
    // 26 回まで数えた状態から。確認で 2 回、申し込みで 2 回違えると 30 回
    await seedRateLimit(h, "code", ip, 26);
    const code = await currentEventCode(h);
    expect(await json(await h.call("GET", `/api/event?code=${code}`, { ip }))).toEqual({ valid: true, accepting: true });
    for (let i = 0; i < 2; i++) expect((await h.call("GET", "/api/event?code=WRONGCODE1", { ip })).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await apply(h, r, { eventCode: "WRONGCODE1", ip })).status).toBe(403);
    expect((await h.call("GET", "/api/event?code=WRONGCODE1", { ip })).status).toBe(429);
    const blocked = await apply(h, r, { ip });
    expect(blocked.status).toBe(429);
    expect((await apply(h, r, { ip: "203.0.113.10" })).status).toBe(200);
  });
});

describe("定期実行の掃除", () => {
  it("終わって 30 日たった印刷記録と古い回数制限を消す。路線は何日たっても消さない", async () => {
    const old = await createRoute(h);
    await apply(h, old);
    h.clock.advance(20 * 24 * 3600_000);
    const fresh = await createRoute(h);
    const done = await json<{ jobId: number }>(await apply(h, fresh));
    const c = await claimAndRead(h); // old の印刷（先に並んだもの）
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    const c2 = await claimAndRead(h);
    expect(c2!.jobId).toBe(done.jobId);
    await printer(h, "POST", `/api/printer/jobs/${c2!.jobId}/done`, { ok: true });

    // old の作成から 31 日（以前の期限の 30 日を過ぎた時点）。印刷が終わってからは 11 日
    h.clock.advance(11 * 24 * 3600_000);
    let r = await cleanup(h.db, h.clock.now());
    expect(r).toMatchObject({ jobs: 0 });
    expect(r).not.toHaveProperty("routes");
    expect(r.rateLimits).toBeGreaterThan(0);
    expect((await h.call("GET", `/api/routes/${old.id}`)).status).toBe(200);
    expect((await h.call("GET", `/api/routes/${fresh.id}`)).status).toBe(200);
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").first<{ n: number }>())!.n).toBe(2);

    // 印刷が終わってから 31 日: 印刷記録は消えるが、路線は残る
    h.clock.advance(20 * 24 * 3600_000);
    r = await cleanup(h.db, h.clock.now());
    expect(r).toMatchObject({ jobs: 2 });
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").first<{ n: number }>())!.n).toBe(0);
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM routes").first<{ n: number }>())!.n).toBe(2);
    expect((await h.call("GET", `/api/routes/${old.id}`)).status).toBe(200);
  });

  it("待ちの印刷記録と路線は、何日たっても消さない", async () => {
    const r = await createRoute(h);
    await apply(h, r);
    h.clock.advance(400 * 24 * 3600_000);
    expect(await cleanup(h.db, h.clock.now())).toMatchObject({ jobs: 0 });
    expect((await h.call("GET", `/api/routes/${r.id}`)).status).toBe(200);
  });
});

describe("共通の決まり", () => {
  it("未定義の API は JSON の 404（no-store）", async () => {
    const res = await h.call("GET", "/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("エラー応答にも no-store", async () => {
    const res = await h.call("GET", "/api/routes/AAAAAAAAAAAAAAAA");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const rows = await printer(h, "GET", "/api/printer/jobs/1/rows?offset=0&count=1");
    expect(rows.headers.get("Cache-Control")).toBe("no-store");
  });

  it("health", async () => {
    expect(await json(await h.call("GET", "/api/health"))).toEqual({ ok: true });
  });
});
