// 管理 API（docs/api.md「6. 管理 API」）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admin,
  adminCookie,
  adminLogin,
  apply,
  claimAndRead,
  createRoute,
  currentEventCode,
  json,
  ORIGIN,
  printer,
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

describe("ログイン", () => {
  it("成功すると Cookie（HttpOnly・Secure・SameSite=Strict・Path=/api/admin・12時間）を発行する", async () => {
    const res = await adminLogin(h);
    expect(res.status).toBe(200);
    const set = res.headers.get("Set-Cookie")!;
    expect(set).toMatch(/^dr_admin=\d+\.[0-9a-f]{64};/);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Strict");
    expect(set).toContain("Path=/api/admin");
    expect(set).toContain("Max-Age=43200");
  });

  it("パスワードが違えば 401", async () => {
    const res = await adminLogin(h, "wrong");
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("失敗が 10分に 10 回を超えたら 429（Retry-After つき）。正しいパスワードでも断る。別の IP は通る", async () => {
    for (let i = 0; i < 10; i++) expect((await adminLogin(h, "wrong", "198.51.100.7")).status).toBe(401);
    const res = await adminLogin(h, SECRETS.ADMIN_PASSWORD, "198.51.100.7");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await adminLogin(h, SECRETS.ADMIN_PASSWORD, "198.51.100.8")).status).toBe(200);
    // 窓が変われば、また試せる
    h.clock.advance(10 * 60_000);
    expect((await adminLogin(h, SECRETS.ADMIN_PASSWORD, "198.51.100.7")).status).toBe(200);
  });

  it("Origin が違う・無いログインは 403、Content-Type が JSON でなければ 400", async () => {
    const body = { password: SECRETS.ADMIN_PASSWORD };
    expect((await h.call("POST", "/api/admin/login", { body, headers: { Origin: "https://evil.test" } })).status).toBe(403);
    expect((await h.call("POST", "/api/admin/login", { body })).status).toBe(403);
    expect(
      (await h.call("POST", "/api/admin/login", { raw: JSON.stringify(body), headers: { Origin: ORIGIN, "Content-Type": "text/plain" } })).status,
    ).toBe(400);
  });
});

describe("Cookie と Origin", () => {
  it("Cookie なし・改ざん・期限切れは 401", async () => {
    expect((await h.call("GET", "/api/admin/state")).status).toBe(401);
    const cookie = await adminCookie(h);
    expect((await admin(h, cookie, "GET", "/api/admin/state")).status).toBe(200);
    const tampered = cookie.replace(/\.(.)/, (_, c) => `.${c === "0" ? "1" : "0"}`);
    expect((await admin(h, tampered, "GET", "/api/admin/state")).status).toBe(401);
    const longer = cookie.replace(/=(\d+)/, (_, n) => `=${Number(n) + 1000}`);
    expect((await admin(h, longer, "GET", "/api/admin/state")).status).toBe(401);
    h.clock.advance(12 * 3600_000);
    expect((await admin(h, cookie, "GET", "/api/admin/state")).status).toBe(401);
  });

  it("状態を変える操作は Origin が違えば 403、Content-Type が違えば 400", async () => {
    const cookie = await adminCookie(h);
    expect((await admin(h, cookie, "POST", "/api/admin/accepting", { accepting: false }, { Origin: "https://evil.test" })).status).toBe(403);
    expect((await admin(h, cookie, "POST", "/api/admin/accepting", { accepting: false }, { "Content-Type": "text/plain" })).status).toBe(400);
    expect(await json(await admin(h, cookie, "GET", "/api/admin/state"))).toMatchObject({ accepting: true });
  });

  it("ログアウトで Cookie を消す", async () => {
    const cookie = await adminCookie(h);
    const res = await admin(h, cookie, "POST", "/api/admin/logout");
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/^dr_admin=; Max-Age=0; Path=\/api\/admin/);
  });
});

describe("操作", () => {
  it("state: 受付・会場コード・プリンタ・印刷の一覧（新しい順、路線名・clientId つき、画像なし）・件数", async () => {
    const r = await createRoute(h);
    const clientId = token();
    await apply(h, r, { clientId });
    await apply(h, r);
    await printer(h, "POST", "/api/printer/claim");
    const cookie = await adminCookie(h);
    const s = await json<{
      accepting: boolean;
      eventCode: string;
      printer: { lastSeenAt: string | null };
      jobs: Record<string, unknown>[];
      counts: Record<string, number>;
    }>(await admin(h, cookie, "GET", "/api/admin/state"));
    expect(s.accepting).toBe(true);
    expect(s.eventCode).toBe(await currentEventCode(h));
    expect(s.printer.lastSeenAt).toBe("2026-11-20T03:00:00.000Z");
    expect(s.jobs).toHaveLength(2);
    expect(s.jobs[1]).toMatchObject({ routeId: r.id, routeName: "テスト線", clientId, status: "printing", issueNo: 1 });
    expect(s.jobs[0]).toMatchObject({ status: "queued", issueNo: 2 });
    expect(s.jobs[0]).not.toHaveProperty("raster");
    expect(s.jobs[0]).not.toHaveProperty("snapshot");
    expect(s.counts).toEqual({ queued: 1, printing: 1, done: 0, failed: 0, canceled: 0 });
  });

  it("state: 会場コードが無ければ初回に作る", async () => {
    const before = await h.db.prepare("SELECT value FROM settings WHERE key = 'event_code'").first();
    expect(before).toBeNull();
    const cookie = await adminCookie(h);
    const s = await json<{ eventCode: string }>(await admin(h, cookie, "GET", "/api/admin/state"));
    expect(s.eventCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    const s2 = await json<{ eventCode: string }>(await admin(h, cookie, "GET", "/api/admin/state"));
    expect(s2.eventCode).toBe(s.eventCode);
  });

  it("取り消し: queued だけ。printing・done は 409、無いものは 404", async () => {
    const r = await createRoute(h);
    const a = await json<{ jobId: number }>(await apply(h, r));
    const b = await json<{ jobId: number }>(await apply(h, r));
    await printer(h, "POST", "/api/printer/claim"); // a が printing
    const cookie = await adminCookie(h);
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${a.jobId}/cancel`)).status).toBe(409);
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${b.jobId}/cancel`)).status).toBe(200);
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${b.jobId}/cancel`)).status).toBe(409);
    expect((await admin(h, cookie, "POST", "/api/admin/jobs/9999/cancel")).status).toBe(404);
    const row = await h.db.prepare("SELECT status, raster FROM print_jobs WHERE id = ?1").bind(b.jobId).first();
    expect(row).toEqual({ status: "canceled", raster: null });
  });

  it("再印刷: queued・printing は 409、路線が非公開・削除済みなら 409、無いものは 404", async () => {
    const r = await createRoute(h);
    const a = await json<{ jobId: number }>(await apply(h, r));
    const cookie = await adminCookie(h);
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${a.jobId}/reprint`)).status).toBe(409);
    const c = await claimAndRead(h);
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${a.jobId}/reprint`)).status).toBe(409);
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    await admin(h, cookie, "POST", `/api/admin/routes/${r.id}/hide`, { hidden: true });
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${a.jobId}/reprint`)).status).toBe(409);
    await admin(h, cookie, "POST", `/api/admin/routes/${r.id}/hide`, { hidden: false });
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${a.jobId}/reprint`)).status).toBe(200);
    expect((await admin(h, cookie, "POST", "/api/admin/jobs/9999/reprint")).status).toBe(404);
  });

  it("受付の一時停止と再開", async () => {
    const cookie = await adminCookie(h);
    const code = await currentEventCode(h);
    expect(await json(await admin(h, cookie, "POST", "/api/admin/accepting", { accepting: false }))).toEqual({ ok: true, accepting: false });
    expect(await json(await h.call("GET", `/api/event?code=${code}`))).toEqual({ valid: true, accepting: false });
    expect((await admin(h, cookie, "POST", "/api/admin/accepting", { accepting: "no" })).status).toBe(400);
    await admin(h, cookie, "POST", "/api/admin/accepting", { accepting: true });
    expect(await json(await h.call("GET", `/api/event?code=${code}`))).toEqual({ valid: true, accepting: true });
  });

  it("上限の解除: 今の会場コードで 1 ずつ増える。clientId の形が違えば 400", async () => {
    const cookie = await adminCookie(h);
    const id = token();
    expect(await json(await admin(h, cookie, "POST", `/api/admin/clients/${id}/grant`))).toEqual({ ok: true, extra: 1 });
    expect(await json(await admin(h, cookie, "POST", `/api/admin/clients/${id}/grant`))).toEqual({ ok: true, extra: 2 });
    expect((await admin(h, cookie, "POST", "/api/admin/clients/bad!/grant")).status).toBe(400);
    // 会場コードを作り直すと、解除も数え直し
    await admin(h, cookie, "POST", "/api/admin/event-code/regenerate");
    expect(await json(await admin(h, cookie, "POST", `/api/admin/clients/${id}/grant`))).toEqual({ ok: true, extra: 1 });
  });

  it("路線の一覧（新しい順、非公開かどうか）と非公開化。非公開にすると待ちの印刷が取り消される", async () => {
    const r1 = await createRoute(h);
    h.clock.advance(1000);
    const r2 = await createRoute(h);
    const queuedJob = await json<{ jobId: number }>(await apply(h, r1));
    const other = await json<{ jobId: number }>(await apply(h, r2));
    const cookie = await adminCookie(h);
    const hide = await admin(h, cookie, "POST", `/api/admin/routes/${r1.id}/hide`, { hidden: true });
    expect(await json(hide)).toEqual({ ok: true, hidden: true, canceled: 1 });
    const list = await json<{ routes: { id: string; name: string; hidden: boolean; createdAt: string }[] }>(await admin(h, cookie, "GET", "/api/admin/routes"));
    expect(list.routes.map((r) => [r.id, r.hidden])).toEqual([
      [r2.id, false],
      [r1.id, true],
    ]);
    expect(list.routes[0].name).toBe("テスト線");
    const rows = await h.db.prepare("SELECT id, status FROM print_jobs ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: queuedJob.jobId, status: "canceled" },
      { id: other.jobId, status: "queued" },
    ]);
    expect((await h.call("GET", `/api/routes/${r1.id}`)).status).toBe(404);
    expect((await admin(h, cookie, "POST", "/api/admin/routes/AAAAAAAAAAAAAAAA/hide", { hidden: true })).status).toBe(404);
    // 公開に戻す
    await admin(h, cookie, "POST", `/api/admin/routes/${r1.id}/hide`, { hidden: false });
    expect((await h.call("GET", `/api/routes/${r1.id}`)).status).toBe(200);
  });
});
