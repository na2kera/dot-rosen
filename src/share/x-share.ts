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

/** 「X で共有」の状態。href が null なら押せない（reason を添える） */
export type XShareState = { href: string | null; reason: string | null };

export const X_REASON_UNSAVED = "URL をつくると、X で共有できます";
export const X_REASON_DIRTY = "保存しなおすと、X で共有できます";

/**
 * 「できあがり」の「X で共有」。押せるのは、いまのデータの保存の状態が clean で、保存記録の rev が分かっているときだけ。
 * 路線名は画面のデータ、v は保存記録の rev。
 * - none（保存する前）: 押せない（URL をつくると…）
 * - dirty（変更あり・保存の結果が分からない）や rev が無いとき: 押せない（保存しなおすと…）
 */
export function finishXShare(input: {
  status: "none" | "clean" | "dirty";
  saved: { id: string | null; savedRev: string | null } | null;
  /** 画面のデータの路線名（データが検査に通らなければ null） */
  name: string | null;
}): XShareState {
  const { status, saved, name } = input;
  if (status === "none" || !saved?.id) return { href: null, reason: X_REASON_UNSAVED };
  if (status === "clean" && saved.savedRev && name !== null) return { href: xShareHref({ id: saved.id, rev: saved.savedRev, name }), reason: null };
  return { href: null, reason: X_REASON_DIRTY };
}

/**
 * 路線のページの「X で共有」の行き先。持ち主（この端末の保存記録の id がページの id と同じ）のときだけ出す。
 * 名前も v もページが読んだもの（同じ応答の data と rev の組）を使う。出さないときは null。
 */
export function routeXShare(input: { owner: boolean; id: string; loaded: { data: { name: string }; rev: string | null } }): string | null {
  const { owner, id, loaded } = input;
  if (!owner || !loaded.rev) return null;
  return xShareHref({ id, rev: loaded.rev, name: loaded.data.name });
}
