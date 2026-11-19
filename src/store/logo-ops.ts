// ロゴ（16×16、2色）を描く操作。点は 256 バイトの配列（1 が描く色）で扱う。
// 元の配列は変えず、新しい配列を返す。DOM にも React にも依存しない。
import { decodeLogo, encodeLogo, LOGO_SIZE } from "../../shared/train/logos.ts";

export type LogoPixels = Uint8Array;
export type LogoTool = "pen" | "eraser" | "fill";

const N = LOGO_SIZE;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;

export const toPixels = (bits: string): LogoPixels => decodeLogo(bits);
export const toBits = (px: LogoPixels): string => encodeLogo(px);

/** 点を1つ打つ（value: 1 = 描く色、0 = 地の色）。変わらなければ同じ配列を返す */
export function plot(px: LogoPixels, x: number, y: number, value: 0 | 1): LogoPixels {
  if (!inside(x, y) || px[y * N + x] === value) return px;
  const out = px.slice();
  out[y * N + x] = value;
  return out;
}

/** (x0,y0) から (x1,y1) まで線を引く（指を速く動かしても点が飛ばないように）。変わらなければ同じ配列 */
export function stroke(px: LogoPixels, x0: number, y0: number, x1: number, y1: number, value: 0 | 1): LogoPixels {
  let out: LogoPixels | null = null;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (inside(x, y) && px[y * N + x] !== value) {
      out ??= px.slice();
      out[y * N + x] = value;
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out ?? px;
}

/** 塗りつぶし: (x,y) とつながった同じ色のマス（上下左右）を value にする。変わらなければ同じ配列 */
export function floodFill(px: LogoPixels, x: number, y: number, value: 0 | 1): LogoPixels {
  if (!inside(x, y)) return px;
  const from = px[y * N + x];
  if (from === value) return px;
  const out = px.slice();
  const stack = [y * N + x];
  out[y * N + x] = value;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const cx = i % N;
    const cy = (i / N) | 0;
    const next = [cx > 0 ? i - 1 : -1, cx < N - 1 ? i + 1 : -1, cy > 0 ? i - N : -1, cy < N - 1 ? i + N : -1];
    for (const j of next) {
      if (j >= 0 && out[j] === from) {
        out[j] = value;
        stack.push(j);
      }
    }
  }
  return out;
}

export const isEmpty = (px: LogoPixels): boolean => px.every((v) => v === 0);

/** 1つ戻すための履歴（ひと筆ごと）。新しいものが最後 */
export type LogoHistory = readonly string[];

export const HISTORY_LIMIT = 50;

/** 変える前の状態を覚える（同じものが続くときは足さない） */
export function pushHistory(h: LogoHistory, bits: string): LogoHistory {
  if (h[h.length - 1] === bits) return h;
  return [...h, bits].slice(-HISTORY_LIMIT);
}

/** 1つ戻す。戻せなければ null */
export function popHistory(h: LogoHistory): { bits: string; history: LogoHistory } | null {
  if (h.length === 0) return null;
  return { bits: h[h.length - 1], history: h.slice(0, -1) };
}
