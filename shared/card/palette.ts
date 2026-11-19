// 路線カードの色。電車の色番号（TRAIN_PALETTE、0〜207）はそのまま使い、カード専用の色を 240 番から足す。
import type { Palette, Rgba } from "../pix/index.ts";
import { COLOR_COUNT, TRAIN_PALETTE } from "../train/index.ts";

/** カード専用の色番号の始まり（これ以上は印刷で 地 = 白、それ以外 = 黒 になる） */
export const CARD_BASE = 240;
/** 地（クリーム色） */
export const CARD_PAPER = 240;
/** 文字・罫線（濃い色） */
export const CARD_INK = 241;
/** 見出しなどの控えめな文字（印刷では黒） */
export const CARD_SUB = 242;

const CARD_COLORS: readonly [number, Rgba][] = [
  [CARD_PAPER, [251, 246, 233, 255]],
  [CARD_INK, [40, 42, 52, 255]],
  [CARD_SUB, [98, 104, 116, 255]],
];

if (COLOR_COUNT > CARD_BASE) throw new Error("電車の色番号がカードの色番号と重なっています");

/** カラー版のパレット（電車の色 + カードの色） */
export const CARD_PALETTE: Palette = (() => {
  const p = [...TRAIN_PALETTE];
  for (const [i, c] of CARD_COLORS) p[i] = c;
  return p;
})();
