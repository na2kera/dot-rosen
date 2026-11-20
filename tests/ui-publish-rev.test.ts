// 版の印（rev）を使った保存と印刷の申し込み（docs/api.md「路線の保存」「印刷の申し込み」の画面の決まり 1〜5）と、
// Codex の再レビューの指摘（#1〜#5、#7、#8）の再現テスト。
// 不変条件: 新しく印刷が作られるのは、押した時点で画面にある内容の版だけ。それ以外の 200 は既存の印刷の再生で、
// その場合は「前の内容の印刷」と表示される。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRouteDraft, type RouteData } from "../shared/route/index.ts";
import { createApi } from "../src/api/client.ts";
import { memoryStorage, STORAGE_KEYS, type KeyValueStorage } from "../src/store/kv-storage.ts";
import { createPublishStore, POLL_MS, readPrint, readSaved } from "../src/store/publish-store.ts";
import { createConfigLoader } from "../src/store/server-config.ts";
import { fakeServer, revOf } from "./ui-fake-server.ts";

const data = (name = "テスト線"): RouteData => ({ ...defaultRouteDraft(), name, stations: ["s1", "s2"] });
const CLIENT = "c".repeat(32);

let counter = 0;
const random = (n: number) => {
  const b = new Uint8Array(n);
  counter++;
  for (let i = 0; i < n; i++) b[i] = (counter * 31 + i * 7) & 0xff;
  return b;
};

type Sub = (cb: (key: string | null) => void) => () => void;

function tab(server: ReturnType<typeof fakeServer>, storage: KeyValueStorage, subscribeExternal?: Sub) {
  return createPublishStore({ storage, api: createApi(server.fetchFn), random, clientId: CLIENT, subscribeExternal });
}

function setup() {
  const server = fakeServer();
  const storage = memoryStorage();
  let fire: ((key: string | null) => void) | null = null;
  const p = tab(server, storage, (cb) => ((fire = cb), () => {}));
  return { server, storage, p, fire: (k: string | null) => fire!(k) };
}

const printPosts = (s: ReturnType<typeof fakeServer>) => s.calls.filter((c) => c.method === "POST" && c.path === "/api/print");

/** 不変条件: 記録した印刷は実際に作られた印刷と同じ内容で、今の内容と一致すると判定されるのは、その内容のときだけ */
function expectTruthful(server: ReturnType<typeof fakeServer>, p: ReturnType<typeof tab>, shown: RouteData) {
  const rec = p.store.get().print!;
  expect(rec.jobId).not.toBeNull();
  const job = server.jobs.get(rec.jobId!)!;
  expect(rec.printedRev).toBe(job.rev);
  expect(rec.issuedOn).toBe(job.issuedOn);
  const same = JSON.stringify(job.data) === JSON.stringify(shown);
  expect(p.printMatches(shown)).toBe(same);
  return job;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("#1 結果不明の申し込みの送り直し", () => {
  it("A の申し込みが届かず、B に変えて保存してから送り直すと、B が印刷され、B の印刷として記録される", async () => {
    const { server, p } = setup();
    const a = data("前の線");
    const b = data("あとの線");
    expect(await p.save(a)).toBe(true);
    server.dropOnce();
    expect(await p.requestPrint(a, "CODE1")).toBe(false);
    const pending = p.store.get().print!;
    expect(pending.jobId).toBeNull();
    expect(await p.save(b)).toBe(true);
    // 日付をまたいだ
    server.state.today = "2026.11.21";
    expect(await p.requestPrint(b, "CODE1")).toBe(true);
    const posts = printPosts(server);
    // 送り直しは元の requestId と元の rev。stale なので、新しい requestId と B の rev で 1 回だけ申し込み直す
    expect(posts[1].body).toMatchObject({ requestId: pending.requestId, rev: revOf(a) });
    expect(posts[2].body!.requestId).not.toBe(pending.requestId);
    expect(posts[2].body!.rev).toBe(revOf(b));
    expect(server.jobs.size).toBe(1);
    const job = expectTruthful(server, p, b);
    expect((job.data as RouteData).name).toBe("あとの線");
    expect(p.printMatches(a)).toBe(false);
    expect(p.store.get().print!.issuedOn).toBe("2026.11.21");
    p.stopPolling();
  });

  it("A の申し込みが処理されていて応答だけ失った場合、B に変えて送り直すと A の印刷（前の内容）として記録される", async () => {
    const { server, p } = setup();
    const a = data("前の線");
    const b = data("あとの線");
    await p.save(a);
    server.failOnce();
    expect(await p.requestPrint(a, "CODE1")).toBe(false);
    await p.save(b);
    expect(await p.requestPrint(b, "CODE1")).toBe(true);
    expect(server.jobs.size).toBe(1);
    const job = expectTruthful(server, p, b);
    expect((job.data as RouteData).name).toBe("前の線");
    expect(p.printRelation(b)).toBe("other");
    p.stopPolling();
  });

  it("A の申し込みが届かず、B に変えて保存せずに送り直すと、先に B を保存し、A は新しく作られず B が 1 件だけ印刷される", async () => {
    const { server, p } = setup();
    const a = data("前の線");
    const b = data("あとの線");
    expect(await p.save(a)).toBe(true);
    server.dropOnce();
    expect(await p.requestPrint(a, "CODE1")).toBe(false);
    const pending = p.store.get().print!;
    expect(pending.jobId).toBeNull();
    const n = server.calls.length;
    expect(await p.requestPrint(b, "CODE1")).toBe(true);
    const after = server.calls.slice(n);
    // 送り直しより前に、押した時点の内容（B）を保存する
    expect(after[0].method).toBe("PUT");
    expect((after[0].body!.data as RouteData).name).toBe("あとの線");
    const posts = printPosts(server);
    // 送り直しは元の requestId と元の rev（stale）。そのあと新しい requestId と B の rev で 1 回だけ
    expect(posts).toHaveLength(3);
    expect(posts[1].body).toMatchObject({ requestId: pending.requestId, rev: revOf(a) });
    expect(posts[2].body!.requestId).not.toBe(pending.requestId);
    expect(posts[2].body!.rev).toBe(revOf(b));
    expect(server.jobs.size).toBe(1);
    const job = expectTruthful(server, p, b);
    expect((job.data as RouteData).name).toBe("あとの線");
    expect(p.printRelation(b)).toBe("same");
    p.stopPolling();
  });

  it("A の申し込みが処理されていて応答だけ失った場合、B に変えて保存せずに送り直すと、B を保存したうえで A の印刷の再生（前の内容）になる", async () => {
    const { server, p } = setup();
    const a = data("前の線");
    const b = data("あとの線");
    await p.save(a);
    server.failOnce();
    expect(await p.requestPrint(a, "CODE1")).toBe(false);
    const pending = p.store.get().print!;
    expect(server.jobs.size).toBe(1);
    expect(await p.requestPrint(b, "CODE1")).toBe(true);
    const posts = printPosts(server);
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toMatchObject({ requestId: pending.requestId, rev: revOf(a) });
    // 新しい印刷は作られない
    expect(server.jobs.size).toBe(1);
    const id = p.store.get().saved!.id!;
    expect((server.routes.get(id)!.data as RouteData).name).toBe("あとの線");
    const job = expectTruthful(server, p, b);
    expect((job.data as RouteData).name).toBe("前の線");
    expect(p.printRelation(b)).toBe("other");
    p.stopPolling();
  });

  it("送り直しの前の保存（B）に失敗したら送らず、結果不明の記録（元の requestId と rev）を残す", async () => {
    const { server, p } = setup();
    const a = data("前の線");
    const b = data("あとの線");
    await p.save(a);
    server.dropOnce();
    expect(await p.requestPrint(a, "CODE1")).toBe(false);
    const pending = p.store.get().print!;
    server.override(() => server.json(500, { error: "internal" }));
    expect(await p.requestPrint(b, "CODE1")).toBe(false);
    expect(printPosts(server)).toHaveLength(1);
    expect(p.store.get().print).toMatchObject({ requestId: pending.requestId, rev: pending.rev, jobId: null });
    expect(p.store.get().printError).not.toBeNull();
    expect(server.jobs.size).toBe(0);
  });

  it("内容を変えずに送り直すと、保存し直さず、元の requestId と元の rev で A が作られる", async () => {
    const { server, p } = setup();
    const a = data("前の線");
    await p.save(a);
    server.dropOnce();
    expect(await p.requestPrint(a, "CODE1")).toBe(false);
    const pending = p.store.get().print!;
    const n = server.calls.length;
    expect(await p.requestPrint(a, "CODE1")).toBe(true);
    expect(server.calls.slice(n).map((c) => c.method)).toEqual(["POST"]);
    expect(printPosts(server)[1].body).toMatchObject({ requestId: pending.requestId, rev: revOf(a) });
    expect(server.jobs.size).toBe(1);
    const job = expectTruthful(server, p, a);
    expect((job.data as RouteData).name).toBe("前の線");
    p.stopPolling();
  });
});

describe("#2 保存の応答を受け取りそこねた", () => {
  it("B の PUT の応答を失ったあと A に戻しても「保存ずみ」にせず、保存も印刷も A を送り直す", async () => {
    const { server, storage, p } = setup();
    const a = data("A線");
    const b = data("B線");
    await p.save(a);
    server.failOnce();
    expect(await p.save(b)).toBe(false);
    expect(p.saveStatus(a)).toBe("dirty");
    expect(p.isSaved(a)).toBe(false);
    // 開き直しても同じ
    expect(tab(server, storage).saveStatus(a)).toBe("dirty");
    expect(await p.requestPrint(a, "CODE1")).toBe(true);
    const job = expectTruthful(server, p, a);
    expect((job.data as RouteData).name).toBe("A線");
    p.stopPolling();
  });

  it("B の保存が進行中に A に戻して印刷すると、保存を待ってから A を保存し直して申し込む", async () => {
    const { server, p } = setup();
    const a = data("A線");
    const b = data("B線");
    await p.save(a);
    const release = server.hold();
    const saving = p.save(b);
    expect(p.saveStatus(a)).toBe("dirty");
    const printing = p.requestPrint(a, "CODE1");
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(await saving).toBe(true);
    expect(await printing).toBe(true);
    const job = expectTruthful(server, p, a);
    expect((job.data as RouteData).name).toBe("A線");
    p.stopPolling();
  });
});

describe("#3 別タブの保存の応答が逆順に届く", () => {
  it("遅れて届いた古い応答で、端末の保存記録を上書きしない（次の保存で送り直す）", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    let fire1: ((key: string | null) => void) | null = null;
    const tab1 = tab(server, storage, (cb) => ((fire1 = cb), () => {}));
    const tab2 = tab(server, storage);
    const b = data("B線");
    const c = data("C線");
    await tab1.save(data("A線"));
    const release = server.hold();
    const saving = tab1.save(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(await tab2.save(c)).toBe(true);
    fire1!(STORAGE_KEYS.saved);
    release();
    await saving;
    const id = tab1.store.get().saved!.id!;
    expect((server.routes.get(id)!.data as RouteData).name).toBe("C線");
    // 端末の記録は B を保存ずみと言わない
    const rec = readSaved(storage)!;
    expect(rec.savedRev === null || rec.savedRev === revOf(c)).toBe(true);
    expect(tab1.saveStatus(b)).not.toBe("clean");
    const n = server.calls.length;
    expect(await tab1.save(b)).toBe(true);
    expect(server.calls.slice(n).map((x) => x.method)).toEqual(["PUT"]);
    expect((server.routes.get(id)!.data as RouteData).name).toBe("B線");
  });
});

describe("#4 印刷の記録を端末に書けない", () => {
  function failPrintAfter(base: KeyValueStorage) {
    let fail = false;
    return {
      storage: {
        ...base,
        getItem: (k: string) => base.getItem(k),
        removeItem: (k: string) => base.removeItem(k),
        setItem(k: string, v: string) {
          if (fail && k === STORAGE_KEYS.print) throw new Error("QuotaExceededError");
          base.setItem(k, v);
        },
      },
      start: () => (fail = true),
    };
  }

  it("初回: 書けなければ申し込まず、前の記録のまま、理由を出す", async () => {
    const server = fakeServer();
    const s = failPrintAfter(memoryStorage());
    const p = tab(server, s.storage);
    expect(await p.save(data())).toBe(true);
    s.start();
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(printPosts(server)).toHaveLength(0);
    expect(p.store.get().printError?.code).toBe("storage");
    expect(p.store.get().print).toBeNull();
  });

  it("送り直し: 書けなければ送らない", async () => {
    const server = fakeServer();
    const s = failPrintAfter(memoryStorage());
    const p = tab(server, s.storage);
    await p.save(data());
    server.dropOnce();
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    s.start();
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(printPosts(server)).toHaveLength(1);
    expect(p.store.get().printError?.code).toBe("storage");
  });
});

describe("#5 路線ページの「編集する」", () => {
  it("表示中の内容が端末の保存記録と違う版なら、保存ずみとして引き継がない", async () => {
    const { server, storage, p } = setup();
    const a = data("A線");
    await p.save(a);
    const id = p.store.get().saved!.id!;
    // 路線ページで A を表示したあと、別のタブが B に更新した
    const shown = { data: a, rev: revOf(a) };
    await tab(server, storage).save(data("B線"));
    expect(p.markSaved(id, shown.data, shown.rev)).toBe(true);
    expect(p.saveStatus(a)).toBe("dirty");
    const n = server.calls.length;
    expect(await p.save(a)).toBe(true);
    expect(server.calls.slice(n).map((x) => x.method)).toEqual(["PUT"]);
  });

  it("端末の記録と同じ版なら、保存ずみとして引き継ぐ", async () => {
    const { server, p } = setup();
    const a = data("A線");
    await p.save(a);
    const id = p.store.get().saved!.id!;
    expect(p.markSaved(id, a, revOf(a))).toBe(true);
    expect(p.saveStatus(a)).toBe("clean");
    const n = server.calls.length;
    await p.save(a);
    expect(server.calls.length).toBe(n);
  });
});

describe("決まり 4: stale", () => {
  it("2回続けて stale なら申し込まず、エラーを出し、前の記録に戻す", async () => {
    const { server, p } = setup();
    await p.save(data());
    server.override(() => server.json(409, { error: "stale" }));
    server.override(() => null); // PUT（保存し直し）は通す
    server.override(() => server.json(409, { error: "stale" }));
    expect(await p.requestPrint(data(), "CODE1")).toBe(false);
    expect(p.store.get().printError?.code).toBe("stale");
    expect(p.store.get().print).toBeNull();
    const posts = printPosts(server);
    expect(posts).toHaveLength(2);
    expect(posts[0].body!.requestId).not.toBe(posts[1].body!.requestId);
  });
});

describe("古い記録", () => {
  it("rev の無い保存記録は結果不明として扱い、次の保存で送り直して rev を得る", async () => {
    const { server, storage } = setup();
    const first = tab(server, storage);
    await first.save(data());
    const old = readSaved(storage)!;
    storage.setItem(STORAGE_KEYS.saved, JSON.stringify({ editKey: old.editKey, id: old.id, expiresAt: "2026-12-20T00:00:00.000Z", savedJson: old.savedJson }));
    const p = tab(server, storage);
    expect(p.saveStatus(data())).toBe("dirty");
    expect(await p.save(data())).toBe(true);
    expect(server.calls[server.calls.length - 1].method).toBe("PUT");
    expect(p.saveStatus(data())).toBe("clean");
  });

  it("rev の無い結果不明の申し込みは、元の requestId と今の内容の rev で確かめ直す", async () => {
    const { server, storage } = setup();
    const first = tab(server, storage);
    await first.save(data());
    const saved = readSaved(storage)!;
    const requestId = "r".repeat(22);
    storage.setItem(
      STORAGE_KEYS.print,
      JSON.stringify({ routeId: saved.id, requestId, jobId: null, issueNo: null, status: null, ahead: null, fingerprint: "00000000", eventCode: "CODE1", editKey: saved.editKey, issuedOn: "2026.11.20" }),
    );
    const p = tab(server, storage);
    expect(await p.requestPrint(data(), "CODE1")).toBe(true);
    const posts = printPosts(server);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ requestId, rev: revOf(data()) });
    expectTruthful(server, p, data());
    p.stopPolling();
  });

  it("応答の rev が null の古い印刷は、同じとも前の内容とも決めない", async () => {
    const { server, p } = setup();
    await p.save(data());
    server.override(() => server.json(200, { jobId: 1, issueNo: 41, ahead: 0, status: "done", rev: null, issuedOn: "2026.11.19" }));
    expect(await p.requestPrint(data(), "CODE1")).toBe(true);
    expect(p.store.get().print).toMatchObject({ printedRev: null, issuedOn: "2026.11.19" });
    expect(p.printRelation(data())).toBe("unknown");
    expect(p.printMatches(data())).toBe(false);
  });

  it("前の形式の印刷記録（rev も printedRev も無い）を読んでも落ちない", () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEYS.print, JSON.stringify({ routeId: "ROUTE00000000001", requestId: "r".repeat(22), jobId: 3, issueNo: 41, status: "done", ahead: 0 }));
    const rec = readPrint(storage)!;
    expect(rec).toMatchObject({ jobId: 3, rev: null, printedRev: null });
  });
});

describe("決まり 5: 発行日", () => {
  it("応答の issuedOn が null の古い印刷は、端末の今日の日付（日本時間）を記録する", async () => {
    const server = fakeServer();
    const p = createPublishStore({ storage: memoryStorage(), api: createApi(server.fetchFn), random, clientId: CLIENT, now: () => new Date("2026-11-20T16:00:00Z") });
    await p.save(data());
    server.override(() => server.json(200, { jobId: 1, issueNo: 41, ahead: 0, status: "done", rev: null, issuedOn: null }));
    expect(await p.requestPrint(data(), "CODE1")).toBe(true);
    expect(p.store.get().print?.issuedOn).toBe("2026.11.21");
  });
});

describe("#7 問い合わせ中に別タブの印刷に切り替わる", () => {
  /** job1 の申し込み途中の記録がある端末（申し込みの経路は通さない） */
  function withJob1() {
    const t = setup();
    const job = (jobId: number, requestId: string) => ({
      routeId: "ROUTE00000000001", requestId, jobId, issueNo: 40 + jobId, status: "queued", ahead: 1,
      fingerprint: "", eventCode: "CODE1", editKey: "k".repeat(22), issuedOn: "2026.11.20",
    });
    t.server.jobs.set(1, { clientId: CLIENT, requestId: "p".repeat(22), status: "queued", ahead: 1, issueNo: 41 });
    t.server.jobs.set(2, { clientId: CLIENT, requestId: "q".repeat(22), status: "queued", ahead: 1, issueNo: 42 });
    t.storage.setItem(STORAGE_KEYS.print, JSON.stringify(job(1, "p".repeat(22))));
    t.fire(STORAGE_KEYS.print);
    return { ...t, job2: JSON.stringify(job(2, "q".repeat(22))) };
  }
  const polled = (s: ReturnType<typeof fakeServer>, jobId: number) => s.calls.filter((c) => c.path.startsWith(`/api/print/${jobId}?`)).length;

  it("新しい印刷の問い合わせを始め、止まらない", async () => {
    const { server, storage, p, fire, job2 } = withJob1();
    await vi.advanceTimersByTimeAsync(0);
    expect(polled(server, 1)).toBe(1);
    // job1 の次の問い合わせの応答を止め、その間に別タブが job2 を申し込んだ
    const release = server.hold();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(polled(server, 1)).toBe(2);
    storage.setItem(STORAGE_KEYS.print, job2);
    fire(STORAGE_KEYS.print);
    release();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(polled(server, 2)).toBeGreaterThan(0);
    server.jobs.get(2)!.status = "done";
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(p.store.get().print).toMatchObject({ jobId: 2, status: "done" });
    p.stopPolling();
  });

  it("問い合わせ中に記録が消され、そのあと別タブの新しい印刷が来ても問い合わせを始める", async () => {
    const { server, storage, p, fire, job2 } = withJob1();
    await vi.advanceTimersByTimeAsync(0);
    const release = server.hold();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    storage.removeItem(STORAGE_KEYS.print);
    fire(STORAGE_KEYS.print);
    release();
    await vi.advanceTimersByTimeAsync(0);
    storage.setItem(STORAGE_KEYS.print, job2);
    fire(STORAGE_KEYS.print);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(polled(server, 2)).toBeGreaterThan(0);
    p.stopPolling();
  });
});

describe("#8 設定の取得が複数回時間切れ", () => {
  it("遅れて届いた古い応答ではなく、最新の取得の応答を使う", async () => {
    const releases: ((r: Response) => void)[] = [];
    const api = createApi(() => new Promise<Response>((res) => releases.push(res)));
    const loader = createConfigLoader(api);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    const p1 = loader.load();
    await vi.advanceTimersByTimeAsync(5000);
    await p1;
    const p2 = loader.load();
    await vi.advanceTimersByTimeAsync(5000);
    await p2;
    expect(releases).toHaveLength(2);
    releases[0](json({ card: { monoSet: "light", sideLayout: "lead-x2" } }));
    await vi.advanceTimersByTimeAsync(0);
    releases[1](json({ card: { monoSet: "bold", sideLayout: "two-x2-rotated" } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.store.get()).toEqual({ card: { monoSet: "bold", sideLayout: "two-x2-rotated" } });
    expect(await loader.load()).toEqual({ card: { monoSet: "bold", sideLayout: "two-x2-rotated" } });
  });
});
