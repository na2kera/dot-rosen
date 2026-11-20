// 路線の保存・取得・上書き・削除と、不正な入力（docs/api.md「4. 公開 API」）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NAME_LENGTH } from "../../shared/route/index.ts";
import { apply, createRoute, json, routeData, startHarness, token, type Harness } from "./harness.ts";

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

describe("路線の保存と取得", () => {
  it("保存して取得できる。期限は 30 日後、応答は no-store", async () => {
    const r = await createRoute(h, routeData({ name: "  テスト線　", symbol: "ab", extra: 1 }));
    expect(r.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(r.expiresAt).toBe("2026-12-20T03:00:00.000Z");
    const res = await h.call("GET", `/api/routes/${r.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await json<{ id: string; data: Record<string, unknown>; expiresAt: string }>(res);
    expect(body.id).toBe(r.id);
    expect(body.data.name).toBe("テスト線");
    expect(body.data.symbol).toBe("AB");
    expect(body.data).not.toHaveProperty("extra");
    // 鍵はハッシュだけを保存する
    const row = await h.db.prepare("SELECT edit_key_hash FROM routes WHERE id = ?1").bind(r.id).first<{ edit_key_hash: string }>();
    expect(row!.edit_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.edit_key_hash).not.toBe(r.editKey);
  });

  it("EXPIRY_DAYS で期限を変えられる", async () => {
    h.vars.EXPIRY_DAYS = "7";
    try {
      const r = await createRoute(h);
      expect(r.expiresAt).toBe("2026-11-27T03:00:00.000Z");
    } finally {
      delete h.vars.EXPIRY_DAYS;
    }
  });

  it("同じ editKey の POST は新しく作らず上書きして同じ id を返す", async () => {
    const key = token();
    const a = await createRoute(h, routeData({ name: "一回目" }), key);
    h.clock.advance(60_000);
    const b = await createRoute(h, routeData({ name: "二回目" }), key);
    expect(b.id).toBe(a.id);
    expect(b.expiresAt).toBe(a.expiresAt);
    const n = await h.db.prepare("SELECT COUNT(*) AS n FROM routes").first<{ n: number }>();
    expect(n!.n).toBe(1);
    const got = await json<{ data: { name: string } }>(await h.call("GET", `/api/routes/${a.id}`));
    expect(got.data.name).toBe("二回目");
  });

  it("無い路線は 404、形の違う ID も 404", async () => {
    expect((await h.call("GET", "/api/routes/AAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await h.call("GET", "/api/routes/short")).status).toBe(404);
  });

  it("上書き: 鍵が合えば上書き（期限は延びない）、違えば 403、無ければ 403", async () => {
    const r = await createRoute(h);
    h.clock.advance(24 * 3600_000);
    const ok = await h.call("PUT", `/api/routes/${r.id}`, { body: { data: routeData({ name: "変えた" }) }, headers: { "X-Edit-Key": r.editKey } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, expiresAt: r.expiresAt, rev: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const got = await json<{ data: { name: string } }>(await h.call("GET", `/api/routes/${r.id}`));
    expect(got.data.name).toBe("変えた");

    const bad = await h.call("PUT", `/api/routes/${r.id}`, { body: { data: routeData() }, headers: { "X-Edit-Key": token() } });
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: "forbidden" });
    const none = await h.call("PUT", `/api/routes/${r.id}`, { body: { data: routeData() } });
    expect(none.status).toBe(403);
  });

  it("削除: 鍵が違えば 403、合えば消えて 404。待ちの印刷も取り消す", async () => {
    const r = await createRoute(h);
    const p = await apply(h, r);
    expect(p.status).toBe(200);
    const { jobId } = await json<{ jobId: number }>(p);
    expect((await h.call("DELETE", `/api/routes/${r.id}`, { headers: { "X-Edit-Key": token() } })).status).toBe(403);
    const del = await h.call("DELETE", `/api/routes/${r.id}`, { headers: { "X-Edit-Key": r.editKey } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    expect((await h.call("GET", `/api/routes/${r.id}`)).status).toBe(404);
    const job = await h.db.prepare("SELECT status, raster FROM print_jobs WHERE id = ?1").bind(jobId).first<{ status: string; raster: unknown }>();
    expect(job).toEqual({ status: "canceled", raster: null });
  });

  it("期限切れ: 取得は 410、上書き・削除も 410（鍵が違えば 403）、同じ鍵の POST も 410", async () => {
    const r = await createRoute(h);
    h.clock.advance(30 * 24 * 3600_000);
    const g = await h.call("GET", `/api/routes/${r.id}`);
    expect(g.status).toBe(410);
    expect(await g.json()).toEqual({ error: "expired" });
    expect((await h.call("PUT", `/api/routes/${r.id}`, { body: { data: routeData() }, headers: { "X-Edit-Key": r.editKey } })).status).toBe(410);
    expect((await h.call("PUT", `/api/routes/${r.id}`, { body: { data: routeData() }, headers: { "X-Edit-Key": token() } })).status).toBe(403);
    expect((await h.call("DELETE", `/api/routes/${r.id}`, { headers: { "X-Edit-Key": r.editKey } })).status).toBe(410);
    expect((await h.call("POST", "/api/routes", { body: { data: routeData(), editKey: r.editKey } })).status).toBe(410);
  });

  it("非公開: 取得・上書き・削除は 404", async () => {
    const r = await createRoute(h);
    await h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run();
    expect((await h.call("GET", `/api/routes/${r.id}`)).status).toBe(404);
    expect((await h.call("PUT", `/api/routes/${r.id}`, { body: { data: routeData() }, headers: { "X-Edit-Key": r.editKey } })).status).toBe(404);
    expect((await h.call("DELETE", `/api/routes/${r.id}`, { headers: { "X-Edit-Key": r.editKey } })).status).toBe(404);
    expect((await h.call("POST", "/api/routes", { body: { data: routeData(), editKey: r.editKey } })).status).toBe(404);
  });
});

describe("不正な入力", () => {
  const post = (body: unknown) => h.call("POST", "/api/routes", { body });

  it("16KB を超える本文は解析せずに 413", async () => {
    const big = JSON.stringify({ data: routeData(), editKey: token(), pad: "x".repeat(17 * 1024) });
    const res = await h.call("POST", "/api/routes", { raw: big, headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
    // Content-Length が無くても、読んだ大きさで止める
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024)));
        c.close();
      },
    });
    const res2 = await h.call("POST", "/api/routes", { raw: stream as unknown as Uint8Array, headers: { "Content-Type": "application/json" } });
    expect(res2.status).toBe(413);
  });

  it("路線データの余計なキーは捨てて保存する（大きさは正規化したあとで確かめる）", async () => {
    const res = await post({ data: { ...routeData(), pad: "x".repeat(9000) }, editKey: token() });
    expect(res.status).toBe(200);
    const { id } = await json<{ id: string }>(res);
    const row = await h.db.prepare("SELECT data FROM routes WHERE id = ?1").bind(id).first<{ data: string }>();
    expect(row!.data).not.toContain("pad");
  });

  it("JSON でない、Content-Type が違う、壊れた JSON は 400", async () => {
    expect((await h.call("POST", "/api/routes", { raw: "{}", headers: { "Content-Type": "text/plain" } })).status).toBe(400);
    expect((await h.call("POST", "/api/routes", { raw: "{", headers: { "Content-Type": "application/json" } })).status).toBe(400);
    expect((await post([])).status).toBe(400);
  });

  it("存在しない駅、長すぎる路線名、未知のパーツ ID は 400（理由つき）", async () => {
    const cases: [unknown, string][] = [
      [routeData({ stations: ["s_nope", "s_nope2"] }), "unknown_station"],
      [routeData({ name: "あ".repeat(MAX_NAME_LENGTH + 1) }), "invalid_name"],
      [{ ...routeData(), train: { ...routeData().train, face: { ...routeData().train.face, skirt: "nope" } } }, "invalid_face"],
      [routeData({ v: 2 }), "invalid_version"],
    ];
    for (const [data, reason] of cases) {
      const res = await post({ data, editKey: token() });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid", reason });
    }
  });

  it("editKey の長さと文字種", async () => {
    expect((await post({ data: routeData(), editKey: "short" })).status).toBe(400);
    expect((await post({ data: routeData(), editKey: "x".repeat(129) })).status).toBe(400);
    expect((await post({ data: routeData(), editKey: "鍵".repeat(30) })).status).toBe(400);
    expect((await post({ data: routeData() })).status).toBe(400);
  });
});
