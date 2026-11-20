// 保存と印刷の申し込みの状態遷移（src/store/publish-store.ts と src/api/client.ts）の試験。
// サーバーは docs/api.md の取り決めどおりに答える小さな偽物（tests/ui-fake-server.ts）を使う。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRouteDraft, type RouteData } from "../shared/route/index.ts";
import { createApi, errorMessage } from "../src/api/client.ts";
import { memoryStorage, STORAGE_KEYS, type KeyValueStorage } from "../src/store/kv-storage.ts";
import { createPublishStore, POLL_MS, POLL_SLOW_MS, pollDelay, readPrint, readSaved, routeFingerprint } from "../src/store/publish-store.ts";
import { fakeServer, revOf } from "./ui-fake-server.ts";

const data = (name = "テスト線"): RouteData => ({ ...defaultRouteDraft(), name, stations: ["s1", "s2"] });

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
  it("鍵を端末に書いてから POST し、成功したら id を書く（期限は無い）。2回目は PUT（X-Edit-Key つき）", async () => {
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
    expect(saved).not.toHaveProperty("expiresAt");
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.saved)!)).not.toHaveProperty("expiresAt");
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

  it("PUT が 404（消された）なら、新しい鍵で作り直す", async () => {
    const { server, p } = setup();
    await p.save(data());
    const oldKey = p.store.get().saved!.editKey;
    server.override(() => server.json(404, { error: "not_found" }));
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
    // 未保存に戻る（「保存して URL をつくる」が出る）
    expect(p.saveStatus(data())).toBe("none");
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
    expect(p2.markSaved(id, data(), revOf(data()))).toBe(false);
    expect(p.markSaved(id, data(), revOf(data()))).toBe(true);
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
    // 送り直しの前に、押した時点の内容を保存する（画面の決まり 1）
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /api/routes/${pending.routeId}`, "POST /api/print"]);
    expect(sent[1].body).toMatchObject({ requestId: pending.requestId, eventCode: "CODE1", routeId: pending.routeId });
    expect(server.jobs.size).toBe(1);
    // 記録は前の内容のもの。今の内容とは違うと分かる
    expect(p.printRelation(b)).toBe("other");
    expect(p.printMatches(b)).toBe(false);
    p.stopPolling();
  });
});

describe("期限は無い（Issue #1）", () => {
  it("何日たっても保存ずみのまま。保存し直しても送らず、URL も変わらない", async () => {
    let t = new Date("2026-11-20T00:00:00Z");
    const { server, p } = setup({ now: () => t });
    await p.save(data());
    const id = p.store.get().saved!.id;
    t = new Date("2028-01-01T00:00:00Z");
    expect(p.isSaved(data())).toBe(true);
    expect(p.saveStatus(data())).toBe("clean");
    const n = server.calls.length;
    expect(await p.save(data())).toBe(true);
    expect(server.calls.length).toBe(n);
    expect(p.store.get().saved!.id).toBe(id);
  });

  it("端末に残った古い記録の expiresAt（過去の日付）は読み捨て、保存ずみのまま扱う", async () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    await first.p.save(data());
    const rec = JSON.parse(storage.getItem(STORAGE_KEYS.saved)!) as Record<string, unknown>;
    storage.setItem(STORAGE_KEYS.saved, JSON.stringify({ ...rec, expiresAt: "2026-01-01T00:00:00.000Z" }));
    const saved = readSaved(storage)!;
    expect(saved).not.toHaveProperty("expiresAt");
    expect(saved.id).toBe(rec.id);
    const { p } = setup({ storage, now: () => new Date("2027-01-01T00:00:00Z") });
    expect(p.saveStatus(data())).toBe("clean");
    expect(p.isSaved(data())).toBe(true);
  });

  it("410 が返っても期限切れ扱いはしない（エラーとして出すだけ）", async () => {
    const { server, p } = setup();
    await p.save(data());
    server.override(() => server.json(410, { error: "expired" }));
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(p.store.get().printError?.code).toBe("internal");
    expect(p.saveStatus(data())).toBe("clean");
  });
});

describe("指摘10: 発行番号と申し込んだ日", () => {
  it("申し込みが通ったら、発行番号と発行日（応答の issuedOn。端末の時計ではない）を記録する", async () => {
    const { server, p } = setup({ now: () => new Date("2026-11-20T00:00:00Z") });
    server.state.today = "2026.11.21";
    await p.requestPrint(data(), "CODE1");
    expect(p.store.get().print).toMatchObject({ issueNo: 41, issuedOn: "2026.11.21" });
    p.stopPolling();
  });
});
