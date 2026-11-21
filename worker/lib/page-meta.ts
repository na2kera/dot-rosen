// 路線のページ（/r/:id）の HTML に、路線ごとの題と絵を差し込む（docs/api.md「路線のページへの差し込みと、X 用の絵」）。
// 文字列を受け取って文字列を返す純粋な関数。HTMLRewriter には頼らない（Node 上のテストで確かめるため）。
import { routeSectionLabel, type RouteData, type StationLookup } from "../../shared/route/index.ts";
import { CANONICAL_ORIGIN } from "../../shared/site.ts";
import { APP_NAME } from "./config.ts";

export type RouteMeta = {
  /** <title>・og:title・twitter:title */
  title: string;
  /** description・og:description・twitter:description */
  description: string;
  /** og:url */
  url: string;
  /** og:image・twitter:image */
  image: string;
  /** og:image:alt */
  imageAlt: string;
};

/** 版の印の先頭 6 桁（URL の v） */
export const revTag = (rev: string): string => rev.slice(0, 6);

/** 路線から差し込む値を作る（エスケープ前の素の文字列） */
export function routeMeta(id: string, route: RouteData, rev: string, lookup: StationLookup): RouteMeta {
  const v = revTag(rev);
  return {
    title: `${route.name}｜${APP_NAME}`,
    description: `${routeSectionLabel(route, lookup)}・${route.stations.length}駅。首都圏の実在の駅をつないで、自分だけの路線と電車を作ろう。`,
    url: `${CANONICAL_ORIGIN}/r/${id}?v=${v}`,
    image: `${CANONICAL_ORIGIN}/og/${id}.png?v=${v}`,
    imageAlt: `${route.name}の路線カード。電車の正面と側面、路線図。`,
  };
}

/** 属性の値と本文のどちらにも置けるようにエスケープする */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** <meta property|name="key" content="..."> の content を置き換える（無ければ何もしない。足さない） */
function replaceMeta(html: string, attr: "property" | "name", key: string, value: string): string {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(<meta\\s+${attr}="${k}"\\s+content=")[^"]*(")`);
  // 置き換えは関数で渡す（文字列で渡すと、値の中の $& などが特別扱いされる）
  return html.replace(re, (_m, a: string, b: string) => a + escapeHtml(value) + b);
}

/** <head> の題・説明・URL・絵の項目を置き換える。値はすべてエスケープする */
export function injectRouteMeta(html: string, meta: RouteMeta): string {
  let out = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(meta.title)}</title>`);
  out = replaceMeta(out, "property", "og:title", meta.title);
  out = replaceMeta(out, "name", "twitter:title", meta.title);
  out = replaceMeta(out, "name", "description", meta.description);
  out = replaceMeta(out, "property", "og:description", meta.description);
  out = replaceMeta(out, "name", "twitter:description", meta.description);
  out = replaceMeta(out, "property", "og:url", meta.url);
  out = replaceMeta(out, "property", "og:image", meta.image);
  out = replaceMeta(out, "name", "twitter:image", meta.image);
  out = replaceMeta(out, "property", "og:image:alt", meta.imageAlt);
  return out;
}
