// 版の印（rev）: 保存の応答と、印刷の申し込みでの照合（docs/api.md「路線の保存」「印刷の申し込み」）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admin,
  adminCookie,
  apply,
  claimAndRead,
  createRoute,
  currentEventCode,
  currentRev,
  DUMMY_REV,
  json,
  printer,
  revOf,
  routeData,
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

const ENQUEUE = /^\s*INSERT INTO print_jobs \(route_id, client_id, request_id, event_code, status, issue_no, sort_key, snapshot, created_at\)/;
const REV_RE = /^[0-9a-f]{16}$/;

type PrintRes = { jobId: number; issueNo: number; ahead: number; status: string; rev: string | null; issuedOn: string | null };

const count = async (sql: string, ...binds: unknown[]) => (await h.db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const counter = async () => Number((await h.db.prepare("SELECT value FROM settings WHERE key = 'issue_counter'").first<{ value: string }>())!.value);
const snapshotOf = async (jobId: number) =>
  JSON.parse((await h.db.prepare("SELECT snapshot FROM print_jobs WHERE id = ?1").bind(jobId).first<{ snapshot: string }>())!.snapshot) as {
    rev?: string;
    issuedOn: string;
    route: { name: string };
  };
const put = (r: { id: string; editKey: string }, data: unknown) => h.call("PUT", `/api/routes/${r.id}`, { body: { data }, headers: { "X-Edit-Key": r.editKey } });

describe("保存の応答の rev", () => {
  it("POST・GET・PUT は、保存されている data の文字列の SHA-256 の先頭 16 桁を返す", async () => {
    const r = await createRoute(h, routeData({ name: "  一回目 " }));
    expect(r.rev).toMatch(REV_RE);
    expect(r.rev).toBe(await currentRev(h, r.id));

    const got = await json<{ id: string; rev: string }>(await h.call("GET", `/api/routes/${r.id}`));
    expect(got.rev).toBe(r.rev);

    const res = await put(r, routeData({ name: "二回目" }));
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; expiresAt: string; rev: string }>(res);
    expect(body).toEqual({ ok: true, expiresAt: r.expiresAt, rev: await currentRev(h, r.id) });
    expect(body.rev).not.toBe(r.rev);
    expect((await json<{ rev: string }>(await h.call("GET", `/api/routes/${r.id}`))).rev).toBe(body.rev);

    // 同じ内容なら同じ印
    const back = await json<{ rev: string }>(await put(r, routeData({ name: "  一回目 " })));
    expect(back.rev).toBe(r.rev);
  });

  it("同じ editKey の POST（上書き）は、上書き後の内容の rev を返す", async () => {
    const key = token();
    const a = await createRoute(h, routeData({ name: "一回目" }), key);
    const b = await createRoute(h, routeData({ name: "二回目" }), key);
    expect(b.id).toBe(a.id);
    expect(b.rev).not.toBe(a.rev);
    expect(b.rev).toBe(await currentRev(h, a.id));
  });

  it("サーバーが整えたあとの文字列で計算する（送った JSON の印ではない）", async () => {
    const sent = routeData({ name: "  整える前　", extra: 1 });
    const r = await createRoute(h, sent);
    const row = await h.db.prepare("SELECT data FROM routes WHERE id = ?1").bind(r.id).first<{ data: string }>();
    expect(r.rev).toBe(await revOf(row!.data));
    expect(r.rev).not.toBe(await revOf(JSON.stringify(sent)));
  });
});

describe("印刷の申し込みの rev", () => {
  it("rev が無い・形が違えば 400", async () => {
    const r = await createRoute(h);
    for (const rev of [null, "", "ABCDEF0123456789", "0123456789abcde", "0123456789abcdef0", "zzzzzzzzzzzzzzzz"]) {
      const res = await apply(h, r, { rev });
      expect(res.status).toBe(400);
    }
    const bad = await h.call("POST", "/api/print", { body: { routeId: r.id, editKey: r.editKey, eventCode: "ABCDEFGHJK", clientId: token(), requestId: token(), rev: 123 } });
    expect(bad.status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(0);
  });

  it("合っていれば 200。応答に rev と issuedOn、snapshot に rev が入る", async () => {
    const r = await createRoute(h);
    const res = await apply(h, r, { rev: r.rev });
    expect(res.status).toBe(200);
    const body = await json<PrintRes>(res);
    expect(body).toMatchObject({ issueNo: 1, status: "queued", rev: r.rev, issuedOn: "2026.11.20" });
    expect(await snapshotOf(body.jobId)).toMatchObject({ rev: r.rev, issuedOn: "2026.11.20" });
  });

  it("保存されている内容と違えば 409 stale。回数も発行番号も消費しない", async () => {
    const r = await createRoute(h);
    const clientId = token();
    expect((await put(r, routeData({ name: "変えた" }))).status).toBe(200);
    const res = await apply(h, r, { clientId, rev: r.rev });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale" });
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(0);
    expect(await counter()).toBe(0);
    // 同じ端末が新しい rev で申し込み直せば通り、番号は 1
    const ok = await apply(h, r, { clientId, rev: await currentRev(h, r.id) });
    expect(ok.status).toBe(200);
    expect((await json<PrintRes>(ok)).issueNo).toBe(1);
  });

  it("stale は、形の正しいでたらめな rev でも同じ。鍵が違えば先に 403", async () => {
    const r = await createRoute(h);
    expect((await apply(h, r, { rev: DUMMY_REV })).status).toBe(409);
    expect((await apply(h, { id: r.id, editKey: token() }, { rev: DUMMY_REV })).status).toBe(403);
  });

  it("確かめたあと追加の直前に PUT が来たら、印刷は作らず 409 stale。回数も発行番号も消費しない", async () => {
    const r = await createRoute(h, routeData({ name: "確かめた" }));
    expect(r.rev).toMatch(REV_RE);
    h.beforeQuery(ENQUEUE, async () => {
      expect((await put(r, routeData({ name: "あとから" }))).status).toBe(200);
    });
    const res = await apply(h, r, { rev: r.rev });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale" });
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(0);
    expect(await counter()).toBe(0);
    // 保存されている内容は上書き後のもの
    expect(await currentRev(h, r.id)).not.toBe(r.rev);
  });

  it("確かめたあと追加の直前に同じ内容で上書きされても（rev が同じ）、そのまま追加する", async () => {
    const r = await createRoute(h, routeData({ name: "確かめた" }));
    h.beforeQuery(ENQUEUE, async () => {
      expect((await put(r, routeData({ name: "確かめた" }))).status).toBe(200);
    });
    const res = await apply(h, r, { rev: r.rev });
    expect(res.status).toBe(200);
    expect((await json<PrintRes>(res)).rev).toBe(r.rev);
  });

  it("遅れた最初の申し込み（r1・A）は、stale の再送と B の申し込み（r2）のあとに再開しても印刷を作らず 409 stale", async () => {
    const r = await createRoute(h, routeData({ name: "A線" }));
    const revA = r.rev;
    const clientId = token();
    const r1 = token();
    const r2 = token();
    // 回数枠を 2 にする（枠が 1 だと回数上限で止まり、この穴が見えない）
    const code = await currentEventCode(h);
    await h.db.prepare("INSERT INTO print_grants (client_id, event_code, extra) VALUES (?1, ?2, 1)").bind(clientId, code).run();
    let revB = "";
    let r2Body: PrintRes | null = null;
    h.beforeQuery(ENQUEUE, async () => {
      // r1 が rev の照合を通ったあと、待ちへの追加の前で遅れている間に:
      expect((await put(r, routeData({ name: "B線" }))).status).toBe(200);
      revB = (await currentRev(h, r.id))!;
      // r1・A の rev の再送は、印刷が見つからず stale
      const resend = await apply(h, r, { clientId, requestId: r1, rev: revA });
      expect(resend.status).toBe(409);
      expect(await resend.json()).toEqual({ error: "stale" });
      // 画面は新しい requestId で B を申し込み、200
      const again = await apply(h, r, { clientId, requestId: r2, rev: revB });
      expect(again.status).toBe(200);
      r2Body = await json<PrintRes>(again);
    });
    const late = await apply(h, r, { clientId, requestId: r1, rev: revA });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "stale" });
    // 印刷は r2 の B の 1 件だけ。発行番号は 1 つだけ進む
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs WHERE request_id = ?1", r2)).toBe(1);
    expect(r2Body).toMatchObject({ issueNo: 1, rev: revB });
    expect((await snapshotOf(r2Body!.jobId)).route.name).toBe("B線");
    expect(await counter()).toBe(1);
  });

  it("同じ requestId の再送は、rev が違っても元の印刷（元の rev）を 200 で返す", async () => {
    const r = await createRoute(h);
    expect(r.rev).toMatch(REV_RE);
    const clientId = token();
    const requestId = token();
    const a = await json<PrintRes>(await apply(h, r, { clientId, requestId, rev: r.rev }));
    const changed = await json<{ rev: string }>(await put(r, routeData({ name: "変えた" })));
    for (const rev of [changed.rev, DUMMY_REV, r.rev]) {
      const res = await apply(h, r, { clientId, requestId, rev });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual(a);
    }
    expect(a.rev).toBe(r.rev);
    expect(await count("SELECT COUNT(*) AS n FROM print_jobs")).toBe(1);
  });

  it("再送でも rev の形は確かめる（無ければ 400）", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const requestId = token();
    expect((await apply(h, r, { clientId, requestId })).status).toBe(200);
    expect((await apply(h, r, { clientId, requestId, rev: null })).status).toBe(400);
  });

  it("再印刷は元の snapshot の rev を引き継ぐ", async () => {
    const r = await createRoute(h);
    expect(r.rev).toMatch(REV_RE);
    const { jobId } = await json<PrintRes>(await apply(h, r, { rev: r.rev }));
    const c = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    await put(r, routeData({ name: "変えた" }));
    const cookie = await adminCookie(h);
    const res = await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`);
    expect(res.status).toBe(200);
    const re = await json<{ jobId: number }>(res);
    expect((await snapshotOf(re.jobId)).rev).toBe(r.rev);
  });

  it("snapshot に rev の無い古い印刷: 再送は rev: null、再印刷と管理画面の一覧も落ちない", async () => {
    const r = await createRoute(h);
    const clientId = token();
    const requestId = token();
    const { jobId } = await json<PrintRes>(await apply(h, r, { clientId, requestId }));
    await h.db.prepare("UPDATE print_jobs SET snapshot = json_remove(snapshot, '$.rev') WHERE id = ?1").bind(jobId).run();

    const replay = await apply(h, r, { clientId, requestId, rev: DUMMY_REV });
    expect(replay.status).toBe(200);
    expect(await json<PrintRes>(replay)).toMatchObject({ jobId, rev: null, issuedOn: "2026.11.20" });

    const c = await claimAndRead(h);
    await printer(h, "POST", `/api/printer/jobs/${c!.jobId}/done`, { ok: true });
    const cookie = await adminCookie(h);
    const re = await admin(h, cookie, "POST", `/api/admin/jobs/${jobId}/reprint`);
    expect(re.status).toBe(200);
    const reId = (await json<{ jobId: number }>(re)).jobId;
    expect((await snapshotOf(reId)).rev).toBeUndefined();
    const st = await admin(h, cookie, "GET", "/api/admin/state");
    expect(st.status).toBe(200);
    expect((await json<{ jobs: unknown[] }>(st)).jobs).toHaveLength(2);
  });
});
