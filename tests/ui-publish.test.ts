// 保存と印刷の申し込みの状態遷移（src/store/publish-store.ts と src/api/client.ts）の試験。
// サーバーは docs/api.md の取り決めどおりに答える小さな偽物を使う。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRouteDraft, type RouteData } from "../shared/route/index.ts";
import { createApi, errorMessage, type FetchLike } from "../src/api/client.ts";
import { memoryStorage, STORAGE_KEYS } from "../src/store/kv-storage.ts";
import { createPublishStore, POLL_MS, POLL_SLOW_MS, pollDelay, readSaved } from "../src/store/publish-store.ts";

const data = (name = "テスト線"): RouteData => ({ ...defaultRouteDraft(), name, stations: ["s1", "s2"] });

type Call = { method: string; path: string; headers: Record<string, string>; body: Record<string, unknown> | null };

/** 取り決めどおりに答える偽のサーバー */
function fakeServer() {
  const calls: Call[] = [];
  const routes = new Map<string, { key: string; data: unknown }>();
  const jobs = new Map<number, { clientId: string; requestId: string; status: string; ahead: number; issueNo: number }>();
  let seq = 0;
  let jobSeq = 0;
  /** 次の n 回を通信の失敗にする */
  let failNext = 0;
  /** 次の応答を差し替える */
  const overrides: (((c: Call) => Response | null) | null)[] = [];
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

  const fetchFn: FetchLike = async (input, init) => {
    const url = new URL(input, "http://x");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const call: Call = { method: init?.method ?? "GET", path: url.pathname + url.search, headers, body };
    calls.push(call);
    const o = overrides.shift();
    if (o) {
      const r = o(call);
      if (r) return r;
    }
    if (headers["Content-Type"] !== "application/json") return json(400, { error: "invalid" });
    if (failNext > 0) {
      failNext--;
      // サーバーには届いたが、応答が返ってこなかったことにする
      handle(call);
      throw new TypeError("Failed to fetch");
    }
    return handle(call);
  };

  function handle(c: Call): Response {
    const m = c.path.match(/^\/api\/routes(?:\/([^/?]+))?/);
    if (m && c.method === "POST") {
      const key = String(c.body!.editKey);
      for (const [id, r] of routes) if (r.key === key) return json(200, { id, expiresAt: "2026-12-20T00:00:00.000Z" });
      const id = `ROUTE${String(++seq).padStart(11, "0")}`;
      routes.set(id, { key, data: c.body!.data });
      return json(200, { id, expiresAt: "2026-12-20T00:00:00.000Z" });
    }
    if (m && c.method === "PUT") {
      const r = routes.get(m[1]);
      if (!r) return json(404, { error: "not_found" });
      if (r.key !== c.headers["X-Edit-Key"]) return json(403, { error: "forbidden" });
      r.data = c.body!.data;
      return json(200, { ok: true, expiresAt: "2026-12-20T00:00:00.000Z" });
    }
    if (m && c.method === "DELETE") {
      const r = routes.get(m[1]);
      if (!r) return json(404, { error: "not_found" });
      if (r.key !== c.headers["X-Edit-Key"]) return json(403, { error: "forbidden" });
      routes.delete(m[1]);
      return json(200, { ok: true });
    }
    if (c.path === "/api/print" && c.method === "POST") {
      const b = c.body!;
      for (const [jobId, j] of jobs)
        if (j.clientId === b.clientId && j.requestId === b.requestId) return json(200, { jobId, issueNo: j.issueNo, ahead: j.ahead, status: j.status });
      const jobId = ++jobSeq;
      jobs.set(jobId, { clientId: String(b.clientId), requestId: String(b.requestId), status: "queued", ahead: 2, issueNo: 40 + jobId });
      return json(200, { jobId, issueNo: 40 + jobId, ahead: 2, status: "queued" });
    }
    const pm = c.path.match(/^\/api\/print\/(\d+)\?clientId=(.+)$/);
    if (pm && c.method === "GET") {
      const j = jobs.get(Number(pm[1]));
      if (!j || j.clientId !== decodeURIComponent(pm[2])) return json(404, { error: "not_found" });
      return json(200, { status: j.status, ahead: j.ahead, issueNo: j.issueNo });
    }
    return json(404, { error: "not_found" });
  }

  return {
    fetchFn,
    calls,
    routes,
    jobs,
    json,
    failOnce: (n = 1) => {
      failNext = n;
    },
    override: (f: (c: Call) => Response | null) => overrides.push(f),
  };
}

let counter = 0;
const random = (n: number) => {
  const b = new Uint8Array(n);
  counter++;
  for (let i = 0; i < n; i++) b[i] = (counter * 31 + i * 7) & 0xff;
  return b;
};

function setup(opts: { hidden?: () => boolean } = {}) {
  const server = fakeServer();
  const storage = memoryStorage();
  const api = createApi(server.fetchFn);
  const p = createPublishStore({ storage, api, random, clientId: "c".repeat(32), isHidden: opts.hidden });
  return { server, storage, p };
}

/** 待ちのタイマーと Promise を進める */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("保存", () => {
  it("鍵を端末に書いてから POST し、成功したら id と期限を書く。2回目は PUT（X-Edit-Key つき）", async () => {
    const { server, storage, p } = setup();
    let keyAtPost: string | null = null;
    server.override((c) => {
      keyAtPost = readSaved(storage)?.editKey ?? null;
      expect(keyAtPost).toBe(c.body!.editKey);
      return null;
    });
    expect(await p.save(data())).toBe(true);
    const saved = readSaved(storage)!;
    expect(saved.editKey).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(saved.id).toBe("ROUTE00000000001");
    expect(saved.expiresAt).toBe("2026-12-20T00:00:00.000Z");
    expect(p.isSaved(data())).toBe(true);
    // 内容を変えたら「変更あり」
    expect(p.isSaved(data("ちがう線"))).toBe(false);
    expect(await p.save(data("ちがう線"))).toBe(true);
    const put = server.calls[server.calls.length - 1];
    expect(put.method).toBe("PUT");
    expect(put.headers["X-Edit-Key"]).toBe(saved.editKey);
    expect(p.isSaved(data("ちがう線"))).toBe(true);
    // 変更が無ければ送らない
    const n = server.calls.length;
    expect(await p.save(data("ちがう線"))).toBe(true);
    expect(server.calls.length).toBe(n);
  });

  it("応答を受け取りそこねたら、同じ鍵で送り直して同じ路線になる", async () => {
    const { server, p } = setup();
    server.failOnce();
    expect(await p.save(data())).toBe(false);
    expect(p.store.get().saveError?.code).toBe("network");
    expect(p.store.get().saved?.id).toBeNull();
    expect(await p.save(data())).toBe(true);
    const posts = server.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0].body!.editKey).toBe(posts[1].body!.editKey);
    expect(server.routes.size).toBe(1);
  });

  it("保存中にもう一度押しても、送るのは1回", async () => {
    const { server, p } = setup();
    const [a, b] = await Promise.all([p.save(data()), p.save(data())]);
    expect(a && b).toBe(true);
    expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("PUT が 410（期限切れ）なら、新しい鍵で作り直す", async () => {
    const { server, p } = setup();
    await p.save(data());
    const oldKey = p.store.get().saved!.editKey;
    server.override(() => server.json(410, { error: "expired" }));
    expect(await p.save(data("新しい線"))).toBe(true);
    const s = p.store.get().saved!;
    expect(s.editKey).not.toBe(oldKey);
    expect(s.id).toBe("ROUTE00000000002");
  });

  it("400 の reason を分かる言葉にする", async () => {
    const { server, p } = setup();
    server.override(() => server.json(400, { error: "invalid", reason: "too_few_stations" }));
    expect(await p.save(data())).toBe(false);
    const e = p.store.get().saveError!;
    expect(e).toMatchObject({ code: "invalid", reason: "too_few_stations", status: 400 });
    expect(errorMessage(e)).toBe("駅を2つ以上えらんでね");
    expect(errorMessage({ code: "invalid", reason: "???" })).toBe("送った内容に まちがいがあります");
  });

  it("路線を消すと、端末の保存情報も消える", async () => {
    const { storage, p } = setup();
    await p.save(data());
    const id = p.store.get().saved!.id!;
    expect(p.owns(id)).toBe(true);
    expect((await p.deleteRoute(id)).ok).toBe(true);
    expect(storage.getItem(STORAGE_KEYS.saved)).toBeNull();
    expect(p.owns(id)).toBe(false);
  });
});

describe("印刷の申し込み", () => {
  it("未保存なら先に保存してから申し込み、5秒おきに状態を問い合わせて、完了で止める", async () => {
    const { server, storage, p } = setup();
    expect(await p.requestPrint(data(), "CODE1")).toBe(true);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/routes", "POST /api/print"]);
    const body = server.calls[1].body!;
    expect(body).toMatchObject({ routeId: "ROUTE00000000001", eventCode: "CODE1", clientId: "c".repeat(32) });
    expect(body.editKey).toBe(readSaved(storage)!.editKey);
    expect(p.store.get().print).toMatchObject({ jobId: 1, issueNo: 41, status: "queued", ahead: 2 });
    // 端末にも残す（開き直しても続きが見える）
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.print)!)).toMatchObject({ jobId: 1, status: "queued" });

    server.jobs.get(1)!.status = "printing";
    server.jobs.get(1)!.ahead = 0;
    await advance(POLL_MS);
    expect(p.store.get().print?.status).toBe("printing");
    server.jobs.get(1)!.status = "done";
    await advance(POLL_MS);
    expect(p.store.get().print?.status).toBe("done");
    const n = server.calls.length;
    await advance(POLL_MS * 4);
    expect(server.calls.length).toBe(n);
  });

  it("通信に失敗したら、送り直しは同じ requestId（二重に申し込まれない）", async () => {
    const { server, p } = setup();
    await p.save(data());
    server.failOnce();
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(p.store.get().printError?.code).toBe("network");
    expect(p.store.get().print?.jobId).toBeNull();
    expect(await p.requestPrint(data(), "CODE1")).toBe(true);
    const posts = server.calls.filter((c) => c.path === "/api/print");
    expect(posts).toHaveLength(2);
    expect(posts[0].body!.requestId).toBe(posts[1].body!.requestId);
    expect(server.jobs.size).toBe(1);
  });

  it("押すたびに新しい requestId を作る（前の申し込みが終わったあと）", async () => {
    const { server, p } = setup();
    await p.requestPrint(data(), "CODE1");
    server.jobs.get(1)!.status = "canceled";
    await advance(POLL_MS);
    expect(p.store.get().print?.status).toBe("canceled");
    await p.requestPrint(data(), "CODE1");
    const posts = server.calls.filter((c) => c.path === "/api/print");
    expect(posts[0].body!.requestId).not.toBe(posts[1].body!.requestId);
  });

  it("二重押しでも送るのは1回", async () => {
    const { server, p } = setup();
    await p.save(data());
    const [a, b] = await Promise.all([p.requestPrint(data(), "CODE1"), p.requestPrint(data(), "CODE1")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(server.calls.filter((c) => c.path === "/api/print")).toHaveLength(1);
  });

  it("はっきり断られたら理由を出し、前の記録（印刷ずみ）に戻す", async () => {
    const { server, p } = setup();
    await p.requestPrint(data(), "CODE1");
    server.jobs.get(1)!.status = "done";
    await advance(POLL_MS);
    server.override(() => server.json(409, { error: "limit_reached" }));
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(p.store.get().printError?.code).toBe("limit_reached");
    expect(errorMessage(p.store.get().printError!)).toContain("もう印刷ずみ");
    expect(p.store.get().print).toMatchObject({ jobId: 1, status: "done" });
  });

  it("会場コードの違い・受付停止・満杯をそれぞれのコードで返す", async () => {
    for (const [status, code] of [
      [403, "invalid_code"],
      [409, "not_accepting"],
      [409, "queue_full"],
      [429, "rate_limited"],
    ] as const) {
      const { server, p } = setup();
      await p.save(data());
      server.override(() => server.json(status, { error: code }, status === 429 ? { "Retry-After": "60" } : {}));
      expect(await p.requestPrint(data(), "CODE1")).toBe(false);
      expect(p.store.get().printError).toMatchObject({ code, status });
      expect(p.store.get().print).toBeNull();
    }
  });

  it("409 conflict（画像の準備中）は、Retry-After だけ待って同じ requestId で送り直す", async () => {
    const { server, p } = setup();
    await p.save(data());
    server.override(() => server.json(409, { error: "conflict" }, { "Retry-After": "2" }));
    server.override(() => server.json(409, { error: "conflict" }, { "Retry-After": "2" }));
    const done = p.requestPrint(data(), "CODE1");
    await advance(1999);
    expect(server.calls.filter((c) => c.path === "/api/print")).toHaveLength(1);
    await advance(1);
    await advance(2000);
    expect(await done).toBe(true);
    const posts = server.calls.filter((c) => c.path === "/api/print");
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((c) => c.body!.requestId)).size).toBe(1);
    expect(p.store.get().printError).toBeNull();
  });

  it("前が 5 人以上なら 15 秒おき。画面が裏の間は問い合わせず、戻ったらすぐ1回", async () => {
    expect(pollDelay(4)).toBe(POLL_MS);
    expect(pollDelay(5)).toBe(POLL_SLOW_MS);
    let hidden = false;
    const { server, p } = setup({ hidden: () => hidden });
    await p.save(data());
    server.override(() => server.json(200, { jobId: 1, issueNo: 41, ahead: 7, status: "queued" }));
    server.jobs.set(1, { clientId: "c".repeat(32), requestId: "x".repeat(22), status: "queued", ahead: 7, issueNo: 41 });
    await p.requestPrint(data(), "CODE1");
    const polls = () => server.calls.filter((c) => c.path.startsWith("/api/print/")).length;
    await advance(POLL_MS);
    expect(polls()).toBe(0);
    await advance(POLL_SLOW_MS - POLL_MS);
    expect(polls()).toBe(1);
    hidden = true;
    await advance(POLL_SLOW_MS * 3);
    expect(polls()).toBe(1);
    hidden = false;
    p.wake();
    await advance(0);
    expect(polls()).toBe(2);
  });

  it("開き直したら、途中の申し込みの問い合わせを再開する", async () => {
    const { server, storage, p } = setup();
    await p.requestPrint(data(), "CODE1");
    p.stopPolling();
    server.jobs.get(1)!.status = "printing";
    const p2 = createPublishStore({ storage, api: createApi(server.fetchFn), random, clientId: "c".repeat(32) });
    expect(p2.store.get().print).toMatchObject({ jobId: 1, status: "queued" });
    p2.resumePolling();
    await advance(0);
    expect(p2.store.get().print?.status).toBe("printing");
    p2.stopPolling();
  });
});
