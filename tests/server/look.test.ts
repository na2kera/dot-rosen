// 印刷の見た目（模様と側面の置き方）: 再印刷での指定、snapshot への記録、GET /api/config。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_MONO_SETS, CARD_SIDE_LAYOUTS, type CardLook } from "../../shared/card/index.ts";
import { admin, adminCookie, apply, claimAndRead, createRoute, json, ORIGIN, printer, startHarness, type Harness } from "./harness.ts";

// ローカルの D1 を通すので、並列で走らせると1件あたりの時間が延びる
vi.setConfig({ testTimeout: 60_000 });

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
  delete h.vars.CARD_MONO_SET;
  delete h.vars.CARD_SIDE_LAYOUT;
});

type Printed = { jobId: number; height: number; raster: Uint8Array };

/** 申し込んで、刷り終える（再印刷できる状態にする） */
async function printOnce(): Promise<{ jobId: number; issueNo: number; printed: Printed }> {
  const r = await createRoute(h);
  const res = await json<{ jobId: number; issueNo: number }>(await apply(h, r));
  const printed = (await claimAndRead(h))!;
  expect(printed.jobId).toBe(res.jobId);
  expect((await printer(h, "POST", `/api/printer/jobs/${printed.jobId}/done`, { ok: true })).status).toBe(200);
  return { ...res, printed };
}

/** 再印刷して、刷り終える */
async function reprint(cookie: string, jobId: number, body?: unknown): Promise<Printed & { card: CardLook }> {
  const res = await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`, body);
  expect(res.status).toBe(200);
  const r = await json<{ jobId: number; card: CardLook }>(res);
  const printed = (await claimAndRead(h))!;
  expect(printed.jobId).toBe(r.jobId);
  expect((await printer(h, "POST", `/api/printer/jobs/${r.jobId}/done`, { ok: true })).status).toBe(200);
  return { ...printed, card: r.card };
}

async function snapshotLook(jobId: number): Promise<Partial<CardLook>> {
  const row = await h.db.prepare("SELECT snapshot FROM print_jobs WHERE id = ?1").bind(jobId).first<{ snapshot: string }>();
  const s = JSON.parse(row!.snapshot) as Partial<CardLook>;
  return { monoSet: s.monoSet, sideLayout: s.sideLayout };
}

const jobCount = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs").first<{ n: number }>())!.n;

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe("再印刷の見た目の指定", () => {
  it("6 通りすべてで画像が作られ、側面の置き方で高さが、模様で中身が変わる。snapshot と一覧に残る", async () => {
    const { jobId, issueNo } = await printOnce();
    const cookie = await adminCookie(h);
    const out = new Map<string, Printed>();
    for (const sideLayout of CARD_SIDE_LAYOUTS) {
      for (const monoSet of CARD_MONO_SETS) {
        const p = await reprint(cookie, jobId, { monoSet, sideLayout });
        expect(p.card).toEqual({ monoSet, sideLayout });
        expect(p.height).toBeGreaterThan(0);
        expect(p.raster.length).toBe(p.height * 48);
        expect(await snapshotLook(p.jobId)).toEqual({ monoSet, sideLayout });
        out.set(`${monoSet}/${sideLayout}`, p);
      }
    }
    expect(out.size).toBe(6);
    for (const monoSet of CARD_MONO_SETS) {
      // 側面の置き方ごとに高さが違う（模様は高さに関係しない）
      const hs = CARD_SIDE_LAYOUTS.map((s) => out.get(`${monoSet}/${s}`)!.height);
      expect(new Set(hs).size).toBe(3);
      // 2倍の置き方は等倍より高い
      expect(hs[1]).toBeGreaterThan(hs[0]);
      expect(hs[2]).toBeGreaterThan(hs[0]);
    }
    for (const s of CARD_SIDE_LAYOUTS) {
      const bold = out.get(`bold/${s}`)!;
      const light = out.get(`light/${s}`)!;
      expect(light.height).toBe(bold.height);
      expect(same(light.raster, bold.raster)).toBe(false);
    }
    // 6 枚の中身はすべて違う
    const all = [...out.values()];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(same(all[i].raster, all[j].raster)).toBe(false);

    // 一覧の各行に、使った見た目が入る。発行番号はすべて同じ
    const state = await json<{ jobs: { id: number; issueNo: number; monoSet: string; sideLayout: string; reprintOf: number | null }[] }>(
      await admin(h, cookie, "GET", "/api/admin/state"),
    );
    expect(state.jobs).toHaveLength(7);
    for (const j of state.jobs) expect(j.issueNo).toBe(issueNo);
    const orig = state.jobs.find((j) => j.id === jobId)!;
    expect(orig).toMatchObject({ monoSet: "bold", sideLayout: "two-x1", reprintOf: null });
    for (const [k, p] of out) {
      const [monoSet, sideLayout] = k.split("/");
      expect(state.jobs.find((j) => j.id === p.jobId)).toMatchObject({ monoSet, sideLayout, reprintOf: jobId });
    }
  });

  it("片方だけ指定したら、もう片方は元の印刷のまま", async () => {
    h.vars.CARD_MONO_SET = "light";
    h.vars.CARD_SIDE_LAYOUT = "lead-x2";
    const { jobId } = await printOnce();
    const cookie = await adminCookie(h);
    const a = await reprint(cookie, jobId, { monoSet: "bold" });
    expect(await snapshotLook(a.jobId)).toEqual({ monoSet: "bold", sideLayout: "lead-x2" });
    const b = await reprint(cookie, jobId, { sideLayout: "two-x2-rotated" });
    expect(await snapshotLook(b.jobId)).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
  });

  it("不正な値は 400 で、印刷は増えない", async () => {
    const { jobId } = await printOnce();
    const cookie = await adminCookie(h);
    const before = await jobCount();
    for (const body of [
      { monoSet: "dark" },
      { sideLayout: "three-x1" },
      { monoSet: "Bold" },
      { monoSet: null },
      { sideLayout: 1 },
      { monoSet: "bold", sideLayout: "" },
      [],
      "bold",
    ]) {
      const res = await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // JSON として読めない本文も 400
    const bad = await h.call("POST", `/api/admin/jobs/${jobId}/reprint`, {
      raw: "{",
      headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(400);
    expect(await jobCount()).toBe(before);
  });

  it("指定なし（{} と本文なし）は元と同じ見た目で、バイト単位で一致する", async () => {
    h.vars.CARD_MONO_SET = "light";
    h.vars.CARD_SIDE_LAYOUT = "two-x2-rotated";
    const { jobId, printed } = await printOnce();
    const cookie = await adminCookie(h);
    const a = await reprint(cookie, jobId, {});
    expect(a.card).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
    expect(a.height).toBe(printed.height);
    expect(same(a.raster, printed.raster)).toBe(true);
    // 本文なし（Content-Type は必須のまま）
    const res = await h.call("POST", `/api/admin/jobs/${jobId}/reprint`, {
      headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const b = (await claimAndRead(h))!;
    expect(same(b.raster, printed.raster)).toBe(true);
  });

  it("サーバーの設定を変えても、過去の印刷の再印刷（指定なし）は変わらない", async () => {
    const { jobId, printed } = await printOnce(); // bold / two-x1
    h.vars.CARD_MONO_SET = "light";
    h.vars.CARD_SIDE_LAYOUT = "lead-x2";
    const cookie = await adminCookie(h);
    const p = await reprint(cookie, jobId);
    expect(p.card).toEqual({ monoSet: "bold", sideLayout: "two-x1" });
    expect(await snapshotLook(p.jobId)).toEqual({ monoSet: "bold", sideLayout: "two-x1" });
    expect(same(p.raster, printed.raster)).toBe(true);
    // 新しい申し込みは新しい設定になる
    const r = await createRoute(h);
    const { jobId: newId } = await json<{ jobId: number }>(await apply(h, r));
    expect(await snapshotLook(newId)).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
  });

  it("見た目を指定した再印刷を、指定なしで再印刷すると、指定した見た目のまま", async () => {
    const { jobId } = await printOnce();
    const cookie = await adminCookie(h);
    const a = await reprint(cookie, jobId, { monoSet: "light", sideLayout: "two-x2-rotated" });
    const b = await reprint(cookie, a.jobId);
    expect(b.card).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
    expect(same(b.raster, a.raster)).toBe(true);
  });

  it("見た目の無い古い記録は、今の設定で刷り、新しい印刷の snapshot に記録する。一覧も今の設定で埋める", async () => {
    const { jobId } = await printOnce();
    await h.db
      .prepare("UPDATE print_jobs SET snapshot = json_remove(snapshot, '$.monoSet', '$.sideLayout') WHERE id = ?1")
      .bind(jobId)
      .run();
    expect(await snapshotLook(jobId)).toEqual({ monoSet: undefined, sideLayout: undefined });
    h.vars.CARD_MONO_SET = "light";
    h.vars.CARD_SIDE_LAYOUT = "lead-x2";
    const cookie = await adminCookie(h);
    const state = await json<{ jobs: { id: number; monoSet: string; sideLayout: string }[] }>(await admin(h, cookie, "GET", "/api/admin/state"));
    expect(state.jobs.find((j) => j.id === jobId)).toMatchObject({ monoSet: "light", sideLayout: "lead-x2" });
    const p = await reprint(cookie, jobId);
    expect(p.card).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
    expect(await snapshotLook(p.jobId)).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
    // 同じ見た目を指定したものと一致する
    const q = await reprint(cookie, jobId, { monoSet: "light", sideLayout: "lead-x2" });
    expect(same(p.raster, q.raster)).toBe(true);
  });

  it("見た目を指定しても、刷れない印刷は今までどおり断る（無い 404、終わっていない 409）", async () => {
    const r = await createRoute(h);
    const { jobId } = await json<{ jobId: number }>(await apply(h, r));
    const cookie = await adminCookie(h);
    expect((await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`, { monoSet: "light" })).status).toBe(409);
    expect((await admin(h, cookie, "POST", "/api/admin/jobs/9999/reprint", { monoSet: "light" })).status).toBe(404);
  });
});

describe("印刷の申し込みの応答", () => {
  it("その印刷で使う見た目（card）を返す。再送にも同じものを返す", async () => {
    h.vars.CARD_MONO_SET = "light";
    h.vars.CARD_SIDE_LAYOUT = "two-x2-rotated";
    const r = await createRoute(h);
    const requestId = "request-look-000001";
    const clientId = "client-look-0000001";
    const first = await json<{ card: CardLook }>(await apply(h, r, { requestId, clientId }));
    expect(first.card).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
    // 設定を変えたあとの再送は、申し込んだときの見た目のまま
    delete h.vars.CARD_MONO_SET;
    delete h.vars.CARD_SIDE_LAYOUT;
    const again = await json<{ card: CardLook }>(await apply(h, r, { requestId, clientId }));
    expect(again.card).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
  });
});

describe("GET /api/config", () => {
  it("認証なしで今の設定値を返す。Cache-Control: no-store", async () => {
    const res = await h.call("GET", "/api/config");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await json(res)).toEqual({ card: { monoSet: "bold", sideLayout: "two-x1" } });
  });

  it("vars を変えると変わる。不正な値は既定値", async () => {
    h.vars.CARD_MONO_SET = "light";
    h.vars.CARD_SIDE_LAYOUT = "lead-x2";
    expect(await json(await h.call("GET", "/api/config"))).toEqual({ card: { monoSet: "light", sideLayout: "lead-x2" } });
    h.vars.CARD_MONO_SET = "dark";
    h.vars.CARD_SIDE_LAYOUT = "x";
    expect(await json(await h.call("GET", "/api/config"))).toEqual({ card: { monoSet: "bold", sideLayout: "two-x1" } });
  });
});
