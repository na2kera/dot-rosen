// 点データのフォント（tools/build-font.ts が作る .bin）の読み書きと、文字の描画。
// ブラウザでも Worker でも Node でも同じコードで使う（DataView と Uint8Array だけを使う）。
//
// ファイル形式（数値はすべてリトルエンディアン）:
//   0   "DRF1"            識別子（4 バイト）
//   4   u8  版（1）
//   5   u8  文字の高さ（ドット。16）
//   6   u8  1行のバイト数（2 = 横 16 ドットまで）
//   7   u8  予備（0）
//   8   u32 文字数 N
//   12  u32 × N  コードポイント（昇順）
//   ..  u8  × N  送り幅（ドット。8 か 16）
//   ..  N × 高さ × 1行のバイト数  点のデータ（上の行から。左端が最上位ビット、1 が点あり）

import { fillRect, setPixel, type PixImage } from "../pix/image.ts";

const MAGIC = "DRF1";
const HEADER_SIZE = 12;

export type BitmapFont = {
  readonly height: number;
  readonly bytesPerRow: number;
  /** コードポイント（昇順） */
  readonly codepoints: Uint32Array;
  readonly advances: Uint8Array;
  readonly bitmaps: Uint8Array;
};

export type GlyphInput = {
  codepoint: number;
  advance: number;
  /** height 行 × bytesPerRow バイト */
  rows: Uint8Array;
};

/** フォントのファイルを作る（tools 用）。 */
export function encodeBitmapFont(glyphs: GlyphInput[], height = 16, bytesPerRow = 2): Uint8Array {
  const sorted = [...glyphs].sort((a, b) => a.codepoint - b.codepoint);
  const n = sorted.length;
  const glyphSize = height * bytesPerRow;
  const out = new Uint8Array(HEADER_SIZE + n * 4 + n + n * glyphSize);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = MAGIC.charCodeAt(i);
  out[4] = 1;
  out[5] = height;
  out[6] = bytesPerRow;
  dv.setUint32(8, n, true);
  const advOff = HEADER_SIZE + n * 4;
  const bmpOff = advOff + n;
  sorted.forEach((g, i) => {
    if (i > 0 && sorted[i - 1].codepoint === g.codepoint) throw new Error(`文字が重複しています: U+${g.codepoint.toString(16)}`);
    if (g.rows.length !== glyphSize) throw new Error(`点のデータの大きさが違います: U+${g.codepoint.toString(16)}`);
    dv.setUint32(HEADER_SIZE + i * 4, g.codepoint, true);
    out[advOff + i] = g.advance;
    out.set(g.rows, bmpOff + i * glyphSize);
  });
  return out;
}

/** フォントのファイルを読む。 */
export function parseBitmapFont(input: ArrayBuffer | Uint8Array): BitmapFont {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC || bytes[4] !== 1) throw new Error("フォントのファイル形式が違います");
  const height = bytes[5];
  const bytesPerRow = bytes[6];
  const n = dv.getUint32(8, true);
  const codepoints = new Uint32Array(n);
  for (let i = 0; i < n; i++) codepoints[i] = dv.getUint32(HEADER_SIZE + i * 4, true);
  const advOff = HEADER_SIZE + n * 4;
  const bmpOff = advOff + n;
  const end = bmpOff + n * height * bytesPerRow;
  if (end > bytes.length) throw new Error("フォントのファイルが途中で切れています");
  return {
    height,
    bytesPerRow,
    codepoints,
    advances: bytes.subarray(advOff, bmpOff),
    bitmaps: bytes.subarray(bmpOff, end),
  };
}

/** 文字の番号（無ければ -1）。二分探索。 */
export function glyphIndex(font: BitmapFont, codepoint: number): number {
  const cps = font.codepoints;
  let lo = 0;
  let hi = cps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = cps[mid];
    if (v === codepoint) return mid;
    if (v < codepoint) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function hasGlyph(font: BitmapFont, codepoint: number): boolean {
  return glyphIndex(font, codepoint) >= 0;
}

/** 点があるか（文字の番号、x、y）。 */
export function glyphPixel(font: BitmapFont, index: number, x: number, y: number): boolean {
  const off = index * font.height * font.bytesPerRow + y * font.bytesPerRow + (x >> 3);
  return ((font.bitmaps[off] >> (7 - (x & 7))) & 1) === 1;
}

/** フォントに無い文字の代わりに出す文字（〓）。これも無ければ空白にする。 */
const FALLBACK = 0x3013;

function resolve(font: BitmapFont, cp: number): { index: number; advance: number } {
  let index = glyphIndex(font, cp);
  if (index < 0) index = glyphIndex(font, FALLBACK);
  if (index < 0) return { index: -1, advance: cp < 0x100 ? font.height / 2 : font.height };
  return { index, advance: font.advances[index] };
}

let defaultFont: BitmapFont | null = null;

/** drawText / measureText で font を省略したときに使うフォントを決める。 */
export function setDefaultFont(font: BitmapFont): void {
  defaultFont = font;
}

function pickFont(font?: BitmapFont): BitmapFont {
  const f = font ?? defaultFont;
  if (!f) throw new Error("フォントが読み込まれていません（setDefaultFont を先に呼んでください）");
  return f;
}

export type TextOptions = {
  /** 点に使う値。色番号画像では色番号、白黒画像では 1（黒）か 0（白）。既定 1 */
  color?: number;
  /** 省略時は setDefaultFont で決めたもの */
  font?: BitmapFont;
};

function checkScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`倍率は1以上の整数にしてください: ${scale}`);
}

/** 文字列の幅（ドット）。1行のみ。 */
export function measureText(text: string, scale = 1, opts: TextOptions = {}): number {
  checkScale(scale);
  const font = pickFont(opts.font);
  let w = 0;
  for (const ch of text) w += resolve(font, ch.codePointAt(0)!).advance;
  return w * scale;
}

/**
 * 文字列を (x, y) を左上として描く。倍率は整数のみ。戻り値は描いた幅（ドット）。
 * 改行には対応しない。
 */
export function drawText(img: PixImage, x: number, y: number, text: string, scale = 1, opts: TextOptions = {}): number {
  checkScale(scale);
  const font = pickFont(opts.font);
  const color = opts.color ?? 1;
  x = Math.floor(x);
  y = Math.floor(y);
  let cx = x;
  for (const ch of text) {
    const { index, advance } = resolve(font, ch.codePointAt(0)!);
    if (index >= 0) {
      for (let gy = 0; gy < font.height; gy++) {
        for (let gx = 0; gx < advance; gx++) {
          if (!glyphPixel(font, index, gx, gy)) continue;
          if (scale === 1) setPixel(img, cx + gx, y + gy, color);
          else fillRect(img, cx + gx * scale, y + gy * scale, scale, scale, color);
        }
      }
    }
    cx += advance * scale;
  }
  return cx - x;
}
