// プリンタ用 API（docs/api.md「5. プリンタ用 API」）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, adminCookie, apply, claimAndRead, createRoute, json, printer, startHarness, type Harness } from "./harness.ts";

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

type Claim = { jobId: number; width: number; height: number };

async function queued(n = 1) {
  const r = await createRoute(h);
  const jobs: number[] = [];
  for (let i = 0; i < n; i++) jobs.push((await json<{ jobId: number }>(await apply(h, r))).jobId);
  return { route: r, jobs };
}

const jobRow = (id: number) =>
  h.db
    .prepare("SELECT status, error, raster IS NULL AS noRaster, claimed_at, heartbeat_at, finished_at FROM print_jobs WHERE id = ?1")
    .bind(id)
    .first<{ status: string; error: string | null; noRaster: number; claimed_at: string | null; heartbeat_at: string | null; finished_at: string | null }>();

describe("認証", () => {
  it("トークンが違う・無ければ 401", async () => {
    expect((await printer(h, "POST", "/api/printer/claim", undefined, "wrong")).status).toBe(401);
    expect((await h.call("POST", "/api/printer/claim")).status).toBe(401);
    expect((await h.call("POST", "/api/printer/claim", { headers: { Authorization: "Basic xxx" } })).status).toBe(401);
  });

  it("PRINTER_TOKEN が設定されていなければ常に 401", async () => {
    const saved = h.env.PRINTER_TOKEN;
    h.vars.PRINTER_TOKEN = "";
    try {
      expect((await printer(h, "POST", "/api/printer/claim", undefined, saved)).status).toBe(401);
    } finally {
      delete h.vars.PRINTER_TOKEN;
    }
  });
});

describe("claim", () => {
  it("待ちが無ければ 204。あれば先頭を printing にして返す。printer_last_seen を更新する", async () => {
    const empty = await printer(h, "POST", "/api/printer/claim");
    expect(empty.status).toBe(204);
    const seen = await h.db.prepare("SELECT value FROM settings WHERE key = 'printer_last_seen'").first<{ value: string }>();
    expect(seen!.value).toBe("2026-11-20T03:00:00.000Z");

    const { jobs } = await queued(2);
    h.clock.advance(10_000);
    const res = await printer(h, "POST", "/api/printer/claim");
    expect(res.status).toBe(200);
    const c = await json<Claim>(res);
    expect(c).toEqual({ jobId: jobs[0], width: 384, height: expect.any(Number) });
    expect((await jobRow(jobs[0]))!.status).toBe("printing");
    // 30 秒たっていないので printer_last_seen は書き換えない
    const seen2 = await h.db.prepare("SELECT value FROM settings WHERE key = 'printer_last_seen'").first<{ value: string }>();
    expect(seen2!.value).toBe("2026-11-20T03:00:00.000Z");
  });

  it("同時に2回 claim しても、同じ印刷は1回しか渡らない", async () => {
    const { jobs } = await queued(3);
    const res = await Promise.all([printer(h, "POST", "/api/printer/claim"), printer(h, "POST", "/api/printer/claim")]);
    const ids = (await Promise.all(res.filter((r) => r.status === 200).map((r) => json<Claim>(r)))).map((c) => c.jobId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(ids.length);
    // 決まり（docs/api.md）どおり、後の claim は前の printing を failed（timeout）にしてから次を渡す
    const printing = await h.db.prepare("SELECT COUNT(*) AS n FROM print_jobs WHERE status = 'printing'").first<{ n: number }>();
    expect(printing!.n).toBe(1);
    expect(jobs).toEqual(expect.arrayContaining(ids));
  });

  it("printing が残ったまま claim すると、それを failed（timeout）にして次を渡す", async () => {
    const { jobs } = await queued(2);
    await printer(h, "POST", "/api/printer/claim");
    const next = await json<Claim>(await printer(h, "POST", "/api/printer/claim"));
    expect(next.jobId).toBe(jobs[1]);
    expect(await jobRow(jobs[0])).toMatchObject({ status: "failed", error: "timeout", noRaster: 1 });
  });

  it("受付の一時停止中でも、待ちに入っている印刷は渡す", async () => {
    await queued(1);
    await h.db.prepare("UPDATE settings SET value = '0' WHERE key = 'accepting'").run();
    expect((await printer(h, "POST", "/api/printer/claim")).status).toBe(200);
  });
});

describe("rows", () => {
  it("範囲の行を 48 × count バイトで返し、heartbeat_at を更新する", async () => {
    const { jobs } = await queued(1);
    const c = await json<Claim>(await printer(h, "POST", "/api/printer/claim"));
    const full = await h.db.prepare("SELECT raster FROM print_jobs WHERE id = ?1").bind(jobs[0]).first<{ raster: number[] }>();
    const raster = Uint8Array.from(full!.raster);
    h.clock.advance(5_000);
    const res = await printer(h, "GET", `/api/printer/jobs/${c.jobId}/rows?offset=10&count=7`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Length")).toBe(String(7 * 48));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(raster.subarray(10 * 48, 17 * 48));
    expect((await jobRow(c.jobId))!.heartbeat_at).toBe("2026-11-20T03:00:05.000Z");
    // 最後の行まで
    const last = await printer(h, "GET", `/api/printer/jobs/${c.jobId}/rows?offset=${c.height - 1}&count=1`);
    expect(new Uint8Array(await last.arrayBuffer())).toEqual(raster.subarray((c.height - 1) * 48));
  });

  it("count は 1〜240、範囲がはみ出したら 400", async () => {
    await queued(1);
    const c = await json<Claim>(await printer(h, "POST", "/api/printer/claim"));
    const rows = (q: string) => printer(h, "GET", `/api/printer/jobs/${c.jobId}/rows?${q}`);
    expect((await rows("offset=0&count=0")).status).toBe(400);
    expect((await rows("offset=0&count=241")).status).toBe(400);
    expect((await rows("offset=0&count=240")).status).toBe(c.height >= 240 ? 200 : 400);
    expect((await rows(`offset=${c.height}&count=1`)).status).toBe(400);
    expect((await rows(`offset=${c.height - 1}&count=2`)).status).toBe(400);
    expect((await rows("offset=-1&count=1")).status).toBe(400);
    expect((await rows("count=1")).status).toBe(400);
    expect((await rows("offset=0&count=1.5")).status).toBe(400);
  });

  it("printing でない印刷は 409、無い印刷は 404", async () => {
    const { jobs } = await queued(1);
    expect((await printer(h, "GET", `/api/printer/jobs/${jobs[0]}/rows?offset=0&count=1`)).status).toBe(409);
    expect((await printer(h, "GET", "/api/printer/jobs/9999/rows?offset=0&count=1")).status).toBe(404);
  });

  it("全部の行を小分けに取ると、保存した生データと一致する", async () => {
    const { jobs } = await queued(1);
    const full = await h.db.prepare("SELECT raster FROM print_jobs WHERE id = ?1").bind(jobs[0]).first<{ raster: number[] }>();
    const got = await claimAndRead(h, 37);
    expect(got!.raster).toEqual(Uint8Array.from(full!.raster));
  });
});

describe("done", () => {
  it("完了で done になり raster が消える。同じ結果の再送は 200、違う結果は 409", async () => {
    await queued(1);
    const c = await json<Claim>(await printer(h, "POST", "/api/printer/claim"));
    const ok = await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: true });
    expect(ok.status).toBe(200);
    expect(await jobRow(c.jobId)).toMatchObject({ status: "done", noRaster: 1, error: null });
    expect((await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: true })).status).toBe(200);
    expect((await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: false, error: "paper_out" })).status).toBe(409);
    // 終わったあとの rows は 409
    expect((await printer(h, "GET", `/api/printer/jobs/${c.jobId}/rows?offset=0&count=1`)).status).toBe(409);
  });

  it("失敗の報告は failed（error つき）。同じ理由の再送は 200、違う理由・成功は 409", async () => {
    await queued(1);
    const c = await json<Claim>(await printer(h, "POST", "/api/printer/claim"));
    expect((await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: false, error: "paper_out" })).status).toBe(200);
    expect(await jobRow(c.jobId)).toMatchObject({ status: "failed", error: "paper_out", noRaster: 1 });
    expect((await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: false, error: "paper_out" })).status).toBe(200);
    expect((await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: false, error: "other" })).status).toBe(409);
    expect((await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: true })).status).toBe(409);
  });

  it("ok が boolean でなければ 400。queued への報告は 409", async () => {
    const { jobs } = await queued(1);
    expect((await printer(h, "POST", `/api/printer/jobs/${jobs[0]}/done`, { ok: true })).status).toBe(409);
    await printer(h, "POST", "/api/printer/claim");
    const done = (body: unknown) => printer(h, "POST", `/api/printer/jobs/${jobs[0]}/done`, body);
    expect((await done({ ok: "yes" })).status).toBe(400);
    expect((await done({ error: "x" })).status).toBe(400);
    expect((await done({ ok: false, error: "rows_http_409_gave_up" })).status).toBe(200);
    expect(await jobRow(jobs[0])).toMatchObject({ status: "failed", error: "rows_http_409_gave_up" });
  });

  // 400 を返すとファームは送り直し続けるので、規定外の error は整えて受け付ける
  it("規定外の error（長すぎる、範囲外の文字、文字列でない、空）は整えて 200", async () => {
    const cases: [unknown, string][] = [
      ["x".repeat(65), "x".repeat(64)],
      ["紙切れ", "___"],
      ["has space\n", "has_space_"],
      [42, "unknown"],
      [undefined, "unknown"],
      ["", "unknown"],
    ];
    for (const [error, stored] of cases) {
      await h.reset();
      const { jobs } = await queued(1);
      await printer(h, "POST", "/api/printer/claim");
      const res = await printer(h, "POST", `/api/printer/jobs/${jobs[0]}/done`, { ok: false, error });
      expect(res.status).toBe(200);
      expect(await jobRow(jobs[0])).toMatchObject({ status: "failed", error: stored, noRaster: 1 });
      // 同じ（整える前の）本文の再送も 200
      expect((await printer(h, "POST", `/api/printer/jobs/${jobs[0]}/done`, { ok: false, error })).status).toBe(200);
    }
  });
});

describe("時間切れ", () => {
  it("printing のまま 5 分たったものは、管理画面の表示で failed（timeout）になる。rows で延長される", async () => {
    await queued(2);
    const c = await json<Claim>(await printer(h, "POST", "/api/printer/claim"));
    const cookie = await adminCookie(h);
    h.clock.advance(4 * 60_000);
    await printer(h, "GET", `/api/printer/jobs/${c.jobId}/rows?offset=0&count=1`);
    h.clock.advance(4 * 60_000);
    await admin(h, cookie, "GET", "/api/admin/state");
    expect((await jobRow(c.jobId))!.status).toBe("printing");
    h.clock.advance(61_000);
    await admin(h, cookie, "GET", "/api/admin/state");
    expect(await jobRow(c.jobId)).toMatchObject({ status: "failed", error: "timeout", noRaster: 1 });
    // 時間切れのあとに届いた完了報告は 409（結果が分からない印刷として残す）
    expect((await printer(h, "POST", `/api/printer/jobs/${c.jobId}/done`, { ok: true })).status).toBe(409);
  });
});

describe("再印刷", () => {
  it("待ちの先頭に入り、同じ発行番号・同じ内容になる。回数上限に数えない", async () => {
    const r = await createRoute(h);
    const clientId = "client-reprint-0001";
    const first = await json<{ jobId: number; issueNo: number }>(await apply(h, r, { clientId }));
    const original = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${original!.jobId}/done`, { ok: true });
    // 別の印刷が 2 件待っているところへ再印刷
    const others = [await json<{ jobId: number }>(await apply(h, r)), await json<{ jobId: number }>(await apply(h, r))];
    h.clock.advance(24 * 3600_000); // 日付が変わっても内容は同じ
    const cookie = await adminCookie(h);
    const rp = await admin(h, cookie, "POST", `/api/admin/jobs/${first.jobId}/reprint`);
    expect(rp.status).toBe(200);
    const re = await json<{ jobId: number; issueNo: number }>(rp);
    expect(re.issueNo).toBe(first.issueNo);
    const again = await claimAndRead(h);
    expect(again!.jobId).toBe(re.jobId);
    expect(again!.raster).toEqual(original!.raster);
    // 次は元から待っていたもの
    await printer(h, "POST", `/api/printer/jobs/${re.jobId}/done`, { ok: true });
    expect((await json<Claim>(await printer(h, "POST", "/api/printer/claim"))).jobId).toBe(others[0].jobId);
    // 再印刷は回数上限に数えない（このクライアントは 1 回使っただけ）
    const used = await h.db
      .prepare("SELECT COUNT(*) AS n FROM print_jobs WHERE client_id = ?1 AND reprint_of IS NULL")
      .bind(clientId)
      .first<{ n: number }>();
    expect(used!.n).toBe(1);
  });

  it("2回目の再印刷は、1回目の再印刷よりさらに前に入る", async () => {
    const r = await createRoute(h);
    const a = await json<{ jobId: number }>(await apply(h, r));
    const b = await json<{ jobId: number }>(await apply(h, r));
    const ca = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${ca!.jobId}/done`, { ok: true });
    const cb = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${cb!.jobId}/done`, { ok: false, error: "jam" });
    await apply(h, r);
    const cookie = await adminCookie(h);
    const ra = await json<{ jobId: number }>(await admin(h, cookie, "POST", `/api/admin/jobs/${a.jobId}/reprint`));
    const rb = await json<{ jobId: number }>(await admin(h, cookie, "POST", `/api/admin/jobs/${b.jobId}/reprint`));
    expect((await json<Claim>(await printer(h, "POST", "/api/printer/claim"))).jobId).toBe(rb.jobId);
    await printer(h, "POST", `/api/printer/jobs/${rb.jobId}/done`, { ok: true });
    expect((await json<Claim>(await printer(h, "POST", "/api/printer/claim"))).jobId).toBe(ra.jobId);
  });
});
