// 路線のページ（/r/:id）への差し込みと、X 用の絵（/og/:id.png）。docs/api.md「路線のページへの差し込みと、X 用の絵」。
// D1 は harness のローカル D1。静的ファイル（ASSETS）とキャッシュは差し替える。
import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../worker/lib/types.ts";
import { handlePage, type AssetFetcher, type OgCache, type PageDeps } from "../../worker/pages.ts";
import { createRoute, loadResources, ORIGIN, routeData, startHarness, type Harness } from "./harness.ts";

vi.setConfig({ testTimeout: 30_000 });

const HTML = fs.readFileSync(path.resolve(import.meta.dirname, "../../index.html"), "utf8");

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 60_000);
afterAll(async () => {
  await h?.dispose();
});
beforeEach(async () => {
  await h.reset();
});

/** 静的ファイルの代わり。/ は index.html、それ以外は SPA と同じく index.html を返す。受け取ったものを記録する */
function fakeAssets(opts: { status?: number; body?: string | null; type?: string } = {}) {
  const seen: Request[] = [];
  const assets: AssetFetcher = {
    async fetch(input) {
      const req = input instanceof Request ? input : new Request(input);
      seen.push(req);
      return new Response(opts.body === undefined ? HTML : opts.body, {
        status: opts.status ?? 200,
        headers: { "Content-Type": opts.type ?? "text/html; charset=utf-8", ETag: '"abc"' },
      });
    },
  };
  return { assets, seen };
}

function memoryCache() {
  const map = new Map<string, Response>();
  const cache: OgCache = {
    async match(key) {
      const r = map.get(key);
      return r ? r.clone() : undefined;
    },
    async put(key, res) {
      map.set(key, res);
    },
  };
  return { cache, map };
}

function deps(extra: Partial<PageDeps> = {}): PageDeps {
  return { resources: loadResources(), assets: fakeAssets().assets, db: h.env.DB, ...extra };
}

const get = (p: string, d: PageDeps, init: RequestInit = {}) => handlePage(new Request(`${ORIGIN}${p}`, init), d);

const metaContent = (html: string, key: string) =>
  new RegExp(`<meta\\s+(?:property|name)="${key.replace(/[.:]/g, "\\$&")}"\\s+content="([^"]*)"`).exec(html)?.[1];

/** 路線を壊す D1（prepare が同期で投げる / first が reject / 返ってこない） */
function brokenDb(kind: "throw" | "reject" | "hang"): Db {
  return {
    prepare() {
      if (kind === "throw") throw new Error("D1 down");
      const st = {
        bind: () => st,
        first: () => (kind === "reject" ? Promise.reject(new Error("D1 down")) : new Promise<never>(() => {})),
        all: () => Promise.reject(new Error("x")),
        run: () => Promise.reject(new Error("x")),
      };
      return st;
    },
    batch: () => Promise.reject(new Error("x")),
  };
}

describe("GET /r/:id", () => {
  it("路線の題・説明・URL・絵を差し込む。v はサーバーの rev から作る（リクエストの v は使わない）", async () => {
    const r = await createRoute(h, routeData({ name: "みどり線" }));
    const { assets, seen } = fakeAssets();
    const res = (await get(`/r/${r.id}?v=zzzzzz`, deps({ assets }), { headers: { "If-None-Match": '"abc"' } }))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("ETag")).toBeNull();
    expect(res.headers.get("Content-Length")).toBeNull();
    const html = await res.text();
    const v = r.rev.slice(0, 6);
    expect(html).toContain("<title>みどり線｜ドット路線メーカー</title>");
    expect(metaContent(html, "og:url")).toBe(`https://dot-rosen.na2kera.com/r/${r.id}?v=${v}`);
    expect(metaContent(html, "og:image")).toBe(`https://dot-rosen.na2kera.com/og/${r.id}.png?v=${v}`);
    expect(metaContent(html, "twitter:image")).toBe(`https://dot-rosen.na2kera.com/og/${r.id}.png?v=${v}`);
    expect(metaContent(html, "og:description")).toMatch(/^.+ ⇄ .+・3駅。首都圏の実在の駅をつないで、自分だけの路線と電車を作ろう。$/);
    expect(html).not.toContain("zzzzzz");
    // HTML は / を、ヘッダーを引き継がない新しい GET で取る
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).pathname).toBe("/");
    expect(seen[0].method).toBe("GET");
    expect(seen[0].headers.get("If-None-Match")).toBeNull();
  });

  it("内容を変えて保存しなおすと v が変わる", async () => {
    const r = await createRoute(h, routeData({ name: "みどり線" }));
    const a = metaContent(await (await get(`/r/${r.id}`, deps()))!.text(), "og:image");
    await h.call("PUT", `/api/routes/${r.id}`, { body: { data: routeData({ name: "あお線" }) }, headers: { "X-Edit-Key": r.editKey } });
    const b = await (await get(`/r/${r.id}`, deps()))!.text();
    expect(b).toContain("<title>あお線｜ドット路線メーカー</title>");
    expect(metaContent(b, "og:image")).not.toBe(a);
  });

  it("末尾のスラッシュも同じページ。HEAD は本文なしで同じヘッダー", async () => {
    const r = await createRoute(h, routeData({ name: "みどり線" }));
    expect(await (await get(`/r/${r.id}/`, deps()))!.text()).toContain("みどり線｜");
    const head = (await get(`/r/${r.id}`, deps(), { method: "HEAD" }))!;
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(head.body).toBeNull();
  });

  it("無い・非公開・形の違う id は素の HTML を 1 バイトも変えずに 200", async () => {
    const r = await createRoute(h);
    await h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run();
    for (const p of [`/r/${r.id}`, "/r/AAAAAAAAAAAAAAAA", "/r/short", "/r/%3Cscript%3E"]) {
      h.executed.length = 0;
      const res = (await get(p, deps()))!;
      expect(res.status, p).toBe(200);
      expect(await res.text(), p).toBe(HTML);
    }
    // 形の違う id は D1 を読まない
    h.executed.length = 0;
    await get("/r/short", deps());
    expect(h.executed).toHaveLength(0);
  });

  it("D1 が投げても（同期・非同期）、返ってこなくても（打ち切り）、素の HTML で 200", async () => {
    for (const kind of ["throw", "reject", "hang"] as const) {
      const t0 = Date.now();
      const res = (await get("/r/AAAAAAAAAAAAAAAA", deps({ db: brokenDb(kind), timeoutMs: 50 })))!;
      expect(res.status, kind).toBe(200);
      expect(await res.text(), kind).toBe(HTML);
      expect(Date.now() - t0, kind).toBeLessThan(1000);
    }
  });

  it("保存されたデータが壊れていても素の HTML", async () => {
    const r = await createRoute(h);
    await h.db.prepare("UPDATE routes SET data = '{broken' WHERE id = ?1").bind(r.id).run();
    expect(await (await get(`/r/${r.id}`, deps()))!.text()).toBe(HTML);
  });

  it("HTML を取れなければ、受け取ったリクエストをそのまま静的ファイルへ。POST や形の合わないパスも", async () => {
    const r = await createRoute(h);
    for (const opts of [{ status: 304, body: null }, { status: 200, body: "" }, { type: "text/plain" }, { status: 404 }]) {
      const bad = fakeAssets(opts);
      await get(`/r/${r.id}`, deps({ assets: bad.assets }));
      expect(bad.seen.map((q) => new URL(q.url).pathname), JSON.stringify(opts)).toEqual(["/", `/r/${r.id}`]);
    }
    const post = fakeAssets();
    await get(`/r/${r.id}`, deps({ assets: post.assets }), { method: "POST" });
    expect(post.seen.map((q) => [q.method, new URL(q.url).pathname])).toEqual([["POST", `/r/${r.id}`]]);
    const deep = fakeAssets();
    await get(`/r/${r.id}/x`, deps({ assets: deep.assets }));
    expect(deep.seen.map((q) => new URL(q.url).pathname)).toEqual([`/r/${r.id}/x`]);
  });

  it("/r と /og 以外は扱わない（API へ回す）", async () => {
    expect(await get("/api/health", deps())).toBeNull();
    expect(await get("/og.png", deps())).toBeNull();
    expect(await get("/", deps())).toBeNull();
  });
});

/** PNG の頭・幅・高さ・中身（展開した大きさ）を確かめる */
function checkPng(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset);
  expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
  const w = dv.getUint32(16);
  const hh = dv.getUint32(20);
  expect([w, hh]).toEqual([1200, 630]);
  // IDAT をつないで展開
  const idat: Uint8Array[] = [];
  for (let o = 8; o < png.length; ) {
    const len = dv.getUint32(o);
    if (String.fromCharCode(...png.subarray(o + 4, o + 8)) === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  expect(inflateSync(Buffer.concat(idat)).length).toBe((1200 + 1) * 630);
}

describe("GET /og/:id.png", () => {
  it("200・image/png・1200×630・max-age=300。キャッシュに今の rev の鍵で置き、2 回目はキャッシュから", async () => {
    const r = await createRoute(h, routeData({ name: "みどり線" }));
    const { cache, map } = memoryCache();
    let renders = 0;
    const d = deps({
      cache,
      renderOg: async (input) => {
        renders++;
        return (await import("../../shared/og/index.ts")).routeOgPng(input);
      },
    });
    const res = (await get(`/og/${r.id}.png?v=whatever`, d))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    checkPng(new Uint8Array(await res.arrayBuffer()));
    expect([...map.keys()]).toEqual([`${ORIGIN}/og/${r.id}.png?v=${r.rev.slice(0, 6)}`]);
    // クエリを変えても描き直さない
    const again = (await get(`/og/${r.id}.png?v=other`, d))!;
    expect(again.status).toBe(200);
    checkPng(new Uint8Array(await again.arrayBuffer()));
    expect(renders).toBe(1);
    // HEAD は本文なし
    const head = (await get(`/og/${r.id}.png`, d, { method: "HEAD" }))!;
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toBe("image/png");
    expect(head.body).toBeNull();
  });

  const isFallback = (res: Response) => {
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/og.png`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  };

  it("無い・非公開・形の違う id は /og.png へ 302。形が違えば D1 を読まない。非公開はキャッシュより先に効く", async () => {
    const r = await createRoute(h);
    const { cache } = memoryCache();
    expect((await get(`/og/${r.id}.png`, deps({ cache })))!.status).toBe(200);
    await h.db.prepare("UPDATE routes SET hidden = 1 WHERE id = ?1").bind(r.id).run();
    isFallback((await get(`/og/${r.id}.png`, deps({ cache })))!);
    isFallback((await get("/og/AAAAAAAAAAAAAAAA.png", deps()))!);
    h.executed.length = 0;
    for (const p of ["/og/short.png", "/og/foo", `/og/${r.id}.jpg`, `/og/${r.id}.png/x`]) isFallback((await get(p, deps()))!);
    expect(h.executed).toHaveLength(0);
  });

  it("D1 の失敗・時間切れ・描画の失敗は 302", async () => {
    for (const kind of ["throw", "reject", "hang"] as const) {
      isFallback((await get("/og/AAAAAAAAAAAAAAAA.png", deps({ db: brokenDb(kind), timeoutMs: 50 })))!);
    }
    const r = await createRoute(h);
    isFallback(
      (await get(
        `/og/${r.id}.png`,
        deps({
          renderOg: async () => {
            throw new Error("描けない");
          },
        }),
      ))!,
    );
  });

  it("GET・HEAD 以外は 405", async () => {
    const r = await createRoute(h);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = (await get(`/og/${r.id}.png`, deps(), { method }))!;
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET, HEAD");
    }
  });
});

describe("キャッシュの失敗と、応答のあとの書き込み", () => {
  it("waitUntil を渡すと、終わっていない cache.put を waitUntil に渡したまま PNG を返す", async () => {
    const r = await createRoute(h);
    const pending: Promise<unknown>[] = [];
    let putCalled = false;
    const cache: OgCache = {
      match: async () => undefined,
      put: () => {
        putCalled = true;
        return new Promise<void>(() => {}); // 終わらない
      },
    };
    const res = (await get(`/og/${r.id}.png`, deps({ cache, waitUntil: (p) => pending.push(p) })))!;
    expect(res.status).toBe(200);
    checkPng(new Uint8Array(await res.arrayBuffer()));
    expect(putCalled).toBe(true);
    expect(pending).toHaveLength(1);
    // 渡した Promise はまだ終わっていない
    const state = await Promise.race([pending[0].then(() => "done"), new Promise((ok) => setTimeout(() => ok("pending"), 20))]);
    expect(state).toBe("pending");
  });

  it("cache.match・cache.put が失敗しても（同期で投げても、reject でも）PNG を返す", async () => {
    const r = await createRoute(h);
    const boom = () => {
      throw new Error("cache down");
    };
    const caches: OgCache[] = [
      { match: boom, put: boom },
      { match: () => Promise.reject(new Error("x")), put: () => Promise.reject(new Error("x")) },
      { match: async () => undefined, put: () => Promise.reject(new Error("x")) },
    ];
    for (const [i, cache] of caches.entries()) {
      for (const waitUntil of [undefined, (p: Promise<unknown>) => void p]) {
        const res = (await get(`/og/${r.id}.png`, deps({ cache, waitUntil })))!;
        expect(res.status, String(i)).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/png");
        checkPng(new Uint8Array(await res.arrayBuffer()));
      }
    }
  });
});

describe("捕まえきれなかった失敗でも 500 にしない", () => {
  it("/r/*: 静的ファイルの取得が投げても、もう一度そのまま静的ファイルへ渡した応答を返す", async () => {
    const r = await createRoute(h);
    const seen: string[] = [];
    let n = 0;
    const assets: AssetFetcher = {
      async fetch(input) {
        const req = input instanceof Request ? input : new Request(input);
        seen.push(new URL(req.url).pathname);
        // 1 回目（/ の HTML）と 2 回目（そのまま渡す）は失敗、3 回目は返す
        if (++n <= 2) throw new Error("assets down");
        return new Response("plain", { status: 200, headers: { "Content-Type": "text/html" } });
      },
    };
    const res = (await get(`/r/${r.id}`, deps({ assets })))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("plain");
    expect(seen).toEqual(["/", `/r/${r.id}`, `/r/${r.id}`]);
  });

  it("/r/*: それも失敗したら投げる（従来どおり、Worker の失敗として扱う）", async () => {
    const assets: AssetFetcher = {
      fetch: async () => {
        throw new Error("assets down");
      },
    };
    await expect(get("/r/AAAAAAAAAAAAAAAA", deps({ assets }))).rejects.toThrow("assets down");
  });

  it("/og/*: 処理の中で投げても /og.png へ 302", async () => {
    const r = await createRoute(h);
    const req = new Request(`${ORIGIN}/og/${r.id}.png`);
    // method を読むと投げるリクエスト（処理の入口より先の失敗の代わり）
    const bad = new Proxy(req, {
      get(t, p) {
        if (p === "method") throw new Error("broken request");
        const v = Reflect.get(t, p, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const res = (await handlePage(bad, deps()))!;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`${ORIGIN}/og.png`);
  });
});
