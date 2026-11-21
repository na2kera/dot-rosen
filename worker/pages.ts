// 路線のページ（/r/:id）への題と絵の差し込みと、X 用の絵（/og/:id.png）。
// docs/api.md「路線のページへの差し込みと、X 用の絵」。API（Hono、/api 配下）とは別の処理で、
// 「すべて no-store」「JSON の 404」は掛けない。静的ファイル（ASSETS）・D1・キャッシュは引数で受け取り、Node 上のテストから呼べるようにする。
import { routeOgPng } from "../shared/og/index.ts";
import { parseRouteData, type RouteData } from "../shared/route/index.ts";
import { routeRev } from "./lib/crypto.ts";
import { ROUTE_ID_RE } from "./lib/http.ts";
import { injectRouteMeta, revTag, routeMeta } from "./lib/page-meta.ts";
import type { Db, Resources } from "./lib/types.ts";
import { loadRoute } from "./routes/routes.ts";

/** 静的ファイルを取る口（env.ASSETS。テストでは差し替える） */
export type AssetFetcher = { fetch(input: Request | URL | string): Promise<Response> };

/** 絵を置くキャッシュ（caches.default。テストでは差し替える。無ければ置かない） */
export type OgCache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
};

export type PageDeps = {
  resources: Resources;
  assets: AssetFetcher;
  db: Db;
  cache?: OgCache | null;
  /** 応答を返したあとの処理（ctx.waitUntil）。無ければ待ってから返す */
  waitUntil?: (p: Promise<unknown>) => void;
  /** D1 の読み出しの打ち切り（ミリ秒。既定 1500） */
  timeoutMs?: number;
  /** 絵の組み立て（テストで失敗を起こすときだけ差し替える） */
  renderOg?: typeof routeOgPng;
};

export const D1_TIMEOUT_MS = 1500;
/** 絵を置く時間（秒） */
export const OG_MAX_AGE = 300;

/** /r/* と /og/* なら応答を返す。それ以外は null（API へ回す） */
export async function handlePage(request: Request, deps: PageDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/r/")) return routePage(request, path, deps);
  if (path.startsWith("/og/")) return ogImage(request, path, deps);
  return null;
}

/** 打ち切り。負けた Promise があとで失敗しても未処理にしない */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  p.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type Found = { route: RouteData; rev: string };

/** 公開中の路線を読む。無い・非公開・形の違うデータは null。D1 の失敗と時間切れは投げる */
async function readRoute(id: string, deps: PageDeps): Promise<Found | null> {
  const row = await withTimeout(
    (async () => loadRoute(deps.db, id))(),
    deps.timeoutMs ?? D1_TIMEOUT_MS,
  );
  if (!row || row.hidden) return null;
  const parsed = parseRouteData(JSON.parse(row.data), deps.resources.lookup);
  if (!parsed.ok) return null;
  return { route: parsed.value, rev: await routeRev(row.data) };
}

// ---- GET /r/:id ----

const ROUTE_PATH_RE = /^\/r\/([^/]+)\/?$/;

async function routePage(request: Request, path: string, deps: PageDeps): Promise<Response> {
  const m = ROUTE_PATH_RE.exec(path);
  const method = request.method;
  // 形の合わないパスと GET・HEAD 以外は、受け取ったリクエストをそのまま静的ファイルへ
  if (!m || (method !== "GET" && method !== "HEAD")) return deps.assets.fetch(request);

  // 素の HTML を取る（ヘッダーを引き継がない新しい GET。/index.html は / へ転送されるので / を取る）
  let html: string | null = null;
  try {
    const res = await deps.assets.fetch(new URL("/", request.url));
    if (res.status === 200 && (res.headers.get("Content-Type") ?? "").includes("text/html")) {
      const text = await res.text();
      if (text.length > 0) html = text;
    }
  } catch {
    html = null;
  }
  if (html === null) return deps.assets.fetch(request);

  let body = html;
  try {
    const id = m[1];
    if (ROUTE_ID_RE.test(id)) {
      const found = await readRoute(id, deps);
      if (found) body = injectRouteMeta(html, routeMeta(id, found.route, found.rev, deps.resources.lookup));
    }
  } catch (e) {
    // D1 の失敗・時間切れ・解析や差し込みの失敗は、素の HTML を返す（ページそのものは今までどおり開く）
    console.warn("路線のページへの差し込みに失敗（素の HTML を返す）", e instanceof Error ? e.message : String(e));
    body = html;
  }
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

// ---- GET /og/:id.png ----

const OG_PATH_RE = /^\/og\/([^/]+)\.png$/;

function fallback(request: Request): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: new URL("/og.png", request.url).toString(), "Cache-Control": "no-store" },
  });
}

/** HEAD なら本文を外す */
function forMethod(request: Request, res: Response): Response {
  return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

async function ogImage(request: Request, path: string, deps: PageDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const m = OG_PATH_RE.exec(path);
  // id の形が違えば D1 を読まない
  if (!m || !ROUTE_ID_RE.test(m[1])) return fallback(request);
  const id = m[1];
  try {
    // D1 は毎回読む（非公開にした路線は、すぐ共通の絵になる）
    const found = await readRoute(id, deps);
    if (!found) return fallback(request);
    // 鍵は今の rev で正規化する（リクエストのクエリは使わない）
    const key = new URL(`/og/${id}.png?v=${revTag(found.rev)}`, request.url).toString();
    const cache = deps.cache ?? null;
    const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
    if (hit) return forMethod(request, hit);
    const png = await (deps.renderOg ?? routeOgPng)({ route: found.route, lookup: deps.resources.lookup, font: deps.resources.font });
    const headers = { "Content-Type": "image/png", "Cache-Control": `public, max-age=${OG_MAX_AGE}` };
    const res = new Response(png as Uint8Array<ArrayBuffer>, { status: 200, headers });
    if (cache) {
      const put = cache.put(key, res.clone()).catch(() => {});
      if (deps.waitUntil) deps.waitUntil(put);
      else await put;
    }
    return forMethod(request, res);
  } catch (e) {
    console.warn("X 用の絵を作れません（共通の絵へ）", e instanceof Error ? e.message : String(e));
    return fallback(request);
  }
}
