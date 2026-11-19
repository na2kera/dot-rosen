// 路線カードの印刷の見た目（模様セットと側面の置き方）の値の一覧。画面とサーバーで同じものを使う。
import type { CardSideLayout } from "./layout.ts";

export type CardMonoSet = "light" | "bold";

/** 印刷の見た目。サーバーの設定（CARD_MONO_SET・CARD_SIDE_LAYOUT）と、印刷の記録（snapshot）に入る */
export type CardLook = { monoSet: CardMonoSet; sideLayout: CardSideLayout };

export const CARD_MONO_SETS: readonly CardMonoSet[] = ["bold", "light"];
export const CARD_SIDE_LAYOUTS: readonly CardSideLayout[] = ["two-x1", "lead-x2", "two-x2-rotated"];

/** 設定が無いとき・読めないときの見た目 */
export const DEFAULT_CARD_LOOK: CardLook = { monoSet: "bold", sideLayout: "two-x1" };

export const isCardMonoSet = (v: unknown): v is CardMonoSet => typeof v === "string" && (CARD_MONO_SETS as readonly string[]).includes(v);
export const isCardSideLayout = (v: unknown): v is CardSideLayout => typeof v === "string" && (CARD_SIDE_LAYOUTS as readonly string[]).includes(v);

/** 値を見た目として読む。足りない・不正な項目は fallback の値にする */
export function toCardLook(v: unknown, fallback: CardLook = DEFAULT_CARD_LOOK): CardLook {
  const r = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  return {
    monoSet: isCardMonoSet(r.monoSet) ? r.monoSet : fallback.monoSet,
    sideLayout: isCardSideLayout(r.sideLayout) ? r.sideLayout : fallback.sideLayout,
  };
}
