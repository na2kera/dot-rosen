// X で共有する投稿文と、X の投稿画面の URL（docs/spec.md「X で共有する」、docs/api.md「画面側」）。DOM に依存しない。
import { CANONICAL_ORIGIN } from "../app/canonical-host.ts";

export const X_HASHTAG = "#ドット路線メーカー";
const X_INTENT = "https://x.com/intent/post";

/** 共有する路線のページの URL（独自ドメイン固定、末尾に v = 版の印の先頭 6 桁） */
export function xShareRouteUrl(id: string, rev: string): string {
  return `${CANONICAL_ORIGIN}/r/${encodeURIComponent(id)}?v=${encodeURIComponent(rev.slice(0, 6))}`;
}

/** 投稿文。名前が空なら「オリジナルの路線」として書く。名前の改行は空白にする */
export function xShareText(name: string, url: string): string {
  const n = name.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
  const head = n ? `ドット路線メーカーで「${n}」を作ったよ！` : "ドット路線メーカーでオリジナルの路線を作ったよ！";
  return `${head}\nみんなもオリジナルの路線を作ろう！\n${url}\n\n${X_HASHTAG}`;
}

/** X の投稿画面の URL。URL とハッシュタグも text に入れる（引数に分けると、決めた改行にならない） */
export function xIntentUrl(text: string): string {
  return `${X_INTENT}?text=${encodeURIComponent(text)}`;
}

/** 路線を共有する X の投稿画面の URL */
export function xShareHref(route: { id: string; rev: string; name: string }): string {
  return xIntentUrl(xShareText(route.name, xShareRouteUrl(route.id, route.rev)));
}
