// 保存と印刷の申し込みの状態遷移（src/store/publish-store.ts と src/api/client.ts）の試験。
// サーバーは docs/api.md の取り決めどおりに答える小さな偽物を使う。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRouteDraft, type RouteData } from "../shared/route/index.ts";
import { createApi, errorMessage, type FetchLike } from "../src/api/client.ts";
import { memoryStorage, STORAGE_KEYS, type KeyValueStorage } from "../src/store/kv-storage.ts";
import { createPublishStore, POLL_MS, POLL_SLOW_MS, pollDelay, readPrint, readSaved, routeFingerprint } from "../src/store/publish-store.ts";

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

type SetupOpts = { hidden?: () => boolean; storage?: KeyValueStorage; now?: () => Date; subscribeExternal?: (cb: (key: string | null) => void) => () => void };

function setup(opts: SetupOpts = {}) {
  const server = fakeServer();
  const storage = opts.storage ?? memoryStorage();
  const api = createApi(server.fetchFn);
  const p = createPublishStore({ storage, api, random, clientId: "c".repeat(32), isHidden: opts.hidden, now: opts.now, subscribeExternal: opts.subscribeExternal });
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

// ---- コードレビューの指摘の再現 ----

/** 指定したキーだけ書けない保存先（容量超過などの代わり） */
function failingStorage(failKeys: string[]) {
  const base = memoryStorage();
  return {
    ...base,
    setItem(k: string, v: string) {
      if (failKeys.includes(k)) throw new Error("QuotaExceededError");
      base.setItem(k, v);
    },
  };
}

describe("指摘1: 端末に書けないとき", () => {
  it("編集の鍵を端末に書けなければ POST せず、分かる理由を出す", async () => {
    const { server, p } = setup({ storage: failingStorage([STORAGE_KEYS.saved]) });
    expect(await p.save(data())).toBe(false);
    expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    const e = p.store.get().saveError!;
    expect(e.code).toBe("storage");
    expect(errorMessage(e)).toContain("この端末に保存できない");
    // 印刷も、保存できないので申し込まない
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(server.calls.filter((c) => c.path === "/api/print")).toHaveLength(0);
    expect(p.store.get().printError?.code).toBe("storage");
  });

  it("「編集する」の引き継ぎ（markSaved）は、端末に書けなければ false", async () => {
    const storage = memoryStorage();
    const { p } = setup({ storage });
    await p.save(data());
    const id = p.store.get().saved!.id!;
    const { p: p2 } = setup({ storage: Object.assign(failingStorage([STORAGE_KEYS.saved]), { getItem: storage.getItem }) });
    expect(p2.markSaved(id, data("新しい名前"), "2026-12-20T00:00:00.000Z")).toBe(false);
    expect(p.markSaved(id, data("新しい名前"), "2026-12-20T00:00:00.000Z")).toBe(true);
  });
});

describe("指摘4: 複数のタブ", () => {
  it("ほかのタブがすでに保存していれば、その鍵と id で保存する（POST し直さない）", async () => {
    const storage = memoryStorage();
    const tab1 = setup({ storage });
    const tab2 = createPublishStore({ storage, api: createApi(tab1.server.fetchFn), random, clientId: "c".repeat(32) });
    // タブ2 はまだ何も知らない状態で、タブ1 が保存する
    expect(tab2.store.get().saved).toBeNull();
    await tab1.p.save(data());
    const key = readSaved(storage)!.editKey;
    expect(await tab2.save(data("タブ2の線"))).toBe(true);
    const last = tab1.server.calls[tab1.server.calls.length - 1];
    expect(last.method).toBe("PUT");
    expect(last.headers["X-Edit-Key"]).toBe(key);
    expect(tab1.server.routes.size).toBe(1);
  });

  it("ほかのタブの保存・印刷の情報を、storage イベントで取り込む", async () => {
    const storage = memoryStorage();
    let fire: ((key: string | null) => void) | null = null;
    const { p } = setup({ storage, subscribeExternal: (cb) => ((fire = cb), () => {}) });
    const other = setup({ storage });
    await other.p.requestPrint(data(), "CODE1");
    other.p.stopPolling();
    expect(p.store.get().saved).toBeNull();
    fire!(STORAGE_KEYS.saved);
    fire!(STORAGE_KEYS.print);
    expect(p.store.get().saved?.id).toBe("ROUTE00000000001");
    expect(p.store.get().print?.jobId).toBe(1);
    p.stopPolling();
  });
});

describe("指摘5: 保存中に内容を変えて印刷", () => {
  it("進行中の保存が終わったあと、今の内容で保存し直してから申し込む", async () => {
    const { server, p } = setup();
    const a = data("前の線");
    const b = data("あとの線");
    const saving = p.save(a);
    const printing = p.requestPrint(b, "CODE1");
    expect(await saving).toBe(true);
    expect(await printing).toBe(true);
    const seq = server.calls.map((c) => `${c.method} ${c.path}`);
    expect(seq).toEqual(["POST /api/routes", "PUT /api/routes/ROUTE00000000001", "POST /api/print"]);
    expect((server.routes.get("ROUTE00000000001")!.data as RouteData).name).toBe("あとの線");
    expect(p.printMatches(b)).toBe(true);
    p.stopPolling();
  });

  it("保存の途中で別の内容の保存を頼まれたら、終わったあとにその内容で保存し直す", async () => {
    const { server, p } = setup();
    const first = p.save(data("一"));
    const second = p.save(data("二"));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(p.isSaved(data("二"))).toBe(true);
    expect(server.calls.map((c) => c.method)).toEqual(["POST", "PUT"]);
  });
});

describe("指摘6: 結果が分からない申し込みのあとで内容を変えた", () => {
  it("新しい requestId を作らず、同じ本文で確かめ直し、前の内容の印刷として記録する", async () => {
    const { server, storage, p } = setup();
    const a = data("前の線");
    await p.save(a);
    server.failOnce();
    expect(await p.requestPrint(a, "CODE1")).toBe(false);
    const pending = readPrint(storage)!;
    expect(pending.jobId).toBeNull();
    expect(pending.fingerprint).toBe(routeFingerprint(a));
    // 内容を変えて、会場コードも違うもので押しても、前の申し込みを同じ本文で確かめ直す
    const b = data("あとの線");
    const n = server.calls.length;
    expect(await p.requestPrint(b, "OTHER")).toBe(true);
    const sent = server.calls.slice(n);
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/print"]);
    expect(sent[0].body).toMatchObject({ requestId: pending.requestId, eventCode: "CODE1", routeId: pending.routeId });
    expect(server.jobs.size).toBe(1);
    // 記録は前の内容のもの。今の内容とは違うと分かる
    expect(p.printMatches(a)).toBe(true);
    expect(p.printMatches(b)).toBe(false);
    p.stopPolling();
  });
});

describe("指摘8: 期限切れ", () => {
  it("期限切れなら内容が同じでも保存ずみにせず、保存すると新しい URL を作る", async () => {
    let t = new Date("2026-11-20T00:00:00Z");
    const { server, p } = setup({ now: () => t });
    await p.save(data());
    expect(p.saveStatus(data())).toBe("clean");
    t = new Date("2026-12-21T00:00:00Z");
    expect(p.isSaved(data())).toBe(false);
    expect(p.saveStatus(data())).toBe("expired");
    const oldKey = p.store.get().saved!.editKey;
    expect(await p.save(data())).toBe(true);
    const last = server.calls[server.calls.length - 1];
    expect(last.method).toBe("POST");
    expect(last.body!.editKey).not.toBe(oldKey);
    expect(p.store.get().saved!.id).toBe("ROUTE00000000002");
  });

  it("印刷で expired が返ったら、保存ずみ扱いをやめる（次は保存し直してから申し込む）", async () => {
    const { server, p } = setup();
    await p.save(data());
    server.override(() => server.json(410, { error: "expired" }));
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(p.store.get().printError?.code).toBe("expired");
    expect(p.saveStatus(data())).toBe("expired");
    expect(await p.requestPrint(data(), "CODE1")).toBe(true);
    expect(server.calls.filter((c) => c.method === "POST" && c.path === "/api/routes")).toHaveLength(2);
    p.stopPolling();
  });
});

describe("指摘10: 発行番号と申し込んだ日", () => {
  it("申し込みが通ったら、発行番号と申し込んだ日（日本時間）を記録する", async () => {
    const { p } = setup({ now: () => new Date("2026-11-20T16:00:00Z") });
    await p.requestPrint(data(), "CODE1");
    expect(p.store.get().print).toMatchObject({ issueNo: 41, issuedOn: "2026.11.21" });
    p.stopPolling();
  });
});
