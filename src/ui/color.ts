// 12色（shared/train のパレット）を画面で使うための小さな関数。
import { colorRgba, type ColorId } from "../../shared/train/colors.ts";

/** 12色の基本色（#rrggbb） */
export function colorHex(id: ColorId): string {
  const [r, g, b] = colorRgba(id);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** その色の上に置く文字の色（明るい色には濃い文字） */
export function inkOn(id: ColorId): string {
  const [r, g, b] = colorRgba(id);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? "#202931" : "#fffdf6";
}
