// 管理 API の呼び出し（src/admin/api.ts）の試験。fetch を差し替えて、送るものと失敗の受け取り方を確かめる。
import { describe, expect, it } from "vitest";
import { AdminApiError, createAdminApi, type Fetcher } from "../src/admin/api.ts";

type Call = { url: string; init: RequestInit | undefined };

function fake(res: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    return res();
  };
  return { api: createAdminApi(fetcher), calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("送るもの", () => {
  it("POST は Content-Type: application/json と本文（無いものも {}）を付ける", async () => {
    const { api, calls } = fake(() => json({ ok: true }));
    await api.cancel(12);
    await api.setAccepting(false);
    await api.login("pw");
    expect(calls.map((c) => [c.url, c.init?.method, c.init?.body])).toEqual([
      ["/api/admin/jobs/12/cancel", "POST", "{}"],
      ["/api/admin/accepting", "POST", '{"accepting":false}'],
      ["/api/admin/login", "POST", '{"password":"pw"}'],
    ]);
    for (const c of calls) {
      expect((c.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(c.init?.credentials).toBe("same-origin");
    }
  });

  it("ID は URL に埋めるとき符号化する", async () => {
    const { api, calls } = fake(() => json({ ok: true, hidden: true, canceled: 0 }));
    await api.grant("abc_DEF-0123456789");
    await api.setHidden("a/b", true);
    expect(calls[0].url).toBe("/api/admin/clients/abc_DEF-0123456789/grant");
    expect(calls[1].url).toBe("/api/admin/routes/a%2Fb/hide");
    expect(calls[1].init?.body).toBe('{"hidden":true}');
  });

  it("GET は本文を付けない。state はサーバーの時刻（Date）も返す", async () => {
    const { api, calls } = fake(() => json({ accepting: true }, 200, { Date: "Fri, 20 Nov 2026 05:00:00 GMT" }));
    const r = await api.state();
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.body).toBeUndefined();
    expect(r.serverTime).toBe(Date.parse("2026-11-20T05:00:00Z"));
  });

  it("routes は一覧を返す", async () => {
    const { api } = fake(() => json({ routes: [{ id: "x", name: "a", createdAt: "", hidden: false }] }));
    expect(await api.routes()).toHaveLength(1);
  });
});

describe("失敗", () => {
  it("エラーのコードと Retry-After を持つ", async () => {
    const { api } = fake(() => json({ error: "rate_limited" }, 429, { "Retry-After": "120" }));
    const e = await api.login("x").catch((e: unknown) => e);
    expect(e).toBeInstanceOf(AdminApiError);
    expect(e).toMatchObject({ status: 429, code: "rate_limited", retryAfter: 120 });
  });

  it("本文が JSON でない失敗も受け取る", async () => {
    const { api } = fake(() => new Response("oops", { status: 502 }));
    await expect(api.state()).rejects.toMatchObject({ status: 502, code: "unknown" });
  });

  it("通信できなければ status 0", async () => {
    const api = createAdminApi(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.state()).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("成功でも本文が読めなければ失敗にする", async () => {
    const { api } = fake(() => new Response("<html>", { status: 200 }));
    await expect(api.state()).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("再印刷の見た目", () => {
  it("見た目を省くと {}（元と同じ）、指定するとその値を本文に入れる", async () => {
    const { api, calls } = fake(() => json({ jobId: 2, issueNo: 1, card: { monoSet: "light", sideLayout: "lead-x2" } }));
    await api.reprint(1);
    const r = await api.reprint(1, { monoSet: "light", sideLayout: "lead-x2" });
    expect(calls.map((c) => [c.url, c.init?.body])).toEqual([
      ["/api/admin/jobs/1/reprint", "{}"],
      ["/api/admin/jobs/1/reprint", '{"monoSet":"light","sideLayout":"lead-x2"}'],
    ]);
    expect(r.card).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
  });
});
