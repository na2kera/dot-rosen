// 路線カードの文字。点データのフォントを、横と縦で別々の整数倍にして描く。
// shared/font の drawText は縦横同じ倍率しか扱えないため、カード用に「横等倍・縦2倍」を描ける形をここに置く。
// フォントに無い文字は drawText と同じく「〓」にする。ただし「⇄」はフォントに無いのでカードで点を持つ。
import { glyphIndex, glyphPixel, type BitmapFont } from "../font/index.ts";
import { fillRect, setPixel, type BitImage, type PixImage } from "../pix/index.ts";

/** フォントに無い文字の代わり（〓） */
const FALLBACK = 0x3013;

/** カードで点を持つ文字（16×16。'#' が点） */
const EXTRA_GLYPHS: Record<number, readonly string[]> = {
  // ⇄（右向きの矢印の下に左向きの矢印）
  0x21c4: [
    "................",
    "................",
    "..........#.....",
    "..........##....",
    ".############...",
    "..........##....",
    "..........#.....",
    "................",
    "................",
    ".....#..........",
    "....##..........",
    "...############.",
    "....##..........",
    ".....#..........",
    "................",
    "................",
  ],
};

type Glyph = { advance: number; index: number; extra: readonly string[] | null };

function resolve(font: BitmapFont, cp: number): Glyph {
  const extra = EXTRA_GLYPHS[cp];
  if (extra && glyphIndex(font, cp) < 0) return { advance: 16, index: -1, extra };
  let index = glyphIndex(font, cp);
  if (index < 0) index = glyphIndex(font, FALLBACK);
  if (index < 0) return { advance: cp < 0x100 ? font.height / 2 : font.height, index: -1, extra: null };
  return { advance: font.advances[index], index, extra: null };
}

/** 文字列の幅（等倍のドット数） */
export function textWidth(font: BitmapFont, text: string): number {
  let w = 0;
  for (const ch of text) w += resolve(font, ch.codePointAt(0)!).advance;
  return w;
}

/**
 * 文字列を (x, y) を左上として描く。sx は横の倍率、sy は縦の倍率（どちらも整数）。
 * 戻り値は描いた幅（ドット）。
 */
export function drawTextScaled(img: PixImage, font: BitmapFont, x: number, y: number, text: string, sx: number, sy: number, color: number): number {
  let cx = x;
  const h = font.height;
  for (const ch of text) {
    const g = resolve(font, ch.codePointAt(0)!);
    if (g.index >= 0 || g.extra) {
      if (img.kind === "bit") drawGlyphBit(img, font, g, cx, y, sx, sy, color !== 0);
      else {
        for (let gy = 0; gy < h; gy++) {
          const row = g.extra ? g.extra[gy] : null;
          for (let gx = 0; gx < g.advance; gx++) {
            const on = row ? row.charCodeAt(gx) === 35 : glyphPixel(font, g.index, gx, gy);
            if (!on) continue;
            if (sx === 1 && sy === 1) setPixel(img, cx + gx, y + gy, color);
            else fillRect(img, cx + gx * sx, y + gy * sy, sx, sy, color);
          }
        }
      }
    }
    cx += g.advance * sx;
  }
  return cx - x;
}

/** カードで点を持つ文字を、フォントと同じ形（1行 2 バイト）にしたもの */
const EXTRA_BYTES = new Map<readonly string[], Uint8Array>();
function extraBytes(rows: readonly string[]): Uint8Array {
  let b = EXTRA_BYTES.get(rows);
  if (!b) {
    b = new Uint8Array(rows.length * 2);
    rows.forEach((r, y) => {
      for (let x = 0; x < 16; x++) if (r.charCodeAt(x) === 35) b![y * 2 + (x >> 3)] |= 0x80 >> (x & 7);
    });
    EXTRA_BYTES.set(rows, b);
  }
  return b;
}

/** 1バイトの点を横に k 倍に広げた値（k = 1〜3。8k ビット） */
const EXPAND: Uint32Array[] = [1, 2, 3].map((k) => {
  const t = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    let e = 0;
    for (let b = 0; b < 8; b++) if (v & (0x80 >> b)) e |= ((1 << k) - 1) << ((7 - b) * k);
    t[v] = e >>> 0;
  }
  return t;
});

/**
 * 白黒画像に1文字を描く（黒のみ）。点のデータをバイトのまま読み、横の倍率は表で広げて
 * 1行に最大 4 バイトずつ重ねる。fillRect を点ごとに呼ぶより速い。
 */
function drawGlyphBit(img: BitImage, font: BitmapFont, g: Glyph, cx: number, y: number, sx: number, sy: number, black: boolean): void {
  const src = g.extra ? extraBytes(g.extra) : font.bitmaps;
  const bpr = g.extra ? 2 : font.bytesPerRow;
  const base = g.extra ? 0 : g.index * font.height * bpr;
  const d = img.data;
  const st = img.stride;
  const W = img.width;
  const fast = black && sx <= 3;
  for (let gy = 0; gy < font.height; gy++) {
    for (let k = 0; k < bpr; k++) {
      let v = src[base + gy * bpr + k];
      // 送り幅より右の点は描かない
      const rest = g.advance - k * 8;
      if (rest <= 0) break;
      if (rest < 8) v &= (0xff << (8 - rest)) & 0xff;
      if (v === 0) continue;
      const px = cx + k * 8 * sx;
      if (fast && px >= 0 && px + 8 * sx <= W) {
        const nbits = 8 * sx;
        const off = px & 7;
        const val = (EXPAND[sx - 1][v] << (32 - nbits - off)) >>> 0;
        const bi = px >> 3;
        const nb = (off + nbits + 7) >> 3;
        for (let j = 0; j < sy; j++) {
          const yy = y + gy * sy + j;
          if (yy < 0 || yy >= img.height) continue;
          const o = yy * st + bi;
          d[o] |= val >>> 24;
          if (nb > 1) d[o + 1] |= (val >>> 16) & 0xff;
          if (nb > 2) d[o + 2] |= (val >>> 8) & 0xff;
          if (nb > 3) d[o + 3] |= val & 0xff;
        }
        continue;
      }
      for (let bit = 0; bit < 8; bit++) {
        if ((v & (0x80 >> bit)) === 0) continue;
        const x0 = px + bit * sx;
        for (let j = 0; j < sy; j++) {
          const yy = y + gy * sy + j;
          if (yy < 0 || yy >= img.height) continue;
          const row = yy * st;
          for (let i = 0; i < sx; i++) {
            const xx = x0 + i;
            if (xx < 0 || xx >= W) continue;
            if (black) d[row + (xx >> 3)] |= 0x80 >> (xx & 7);
            else d[row + (xx >> 3)] &= ~(0x80 >> (xx & 7));
          }
        }
      }
    }
  }
}

/** 幅 maxWidth（等倍のドット数）に収まるように、末尾を「…」にする。収まればそのまま */
export function ellipsize(font: BitmapFont, text: string, maxWidth: number): string {
  if (textWidth(font, text) <= maxWidth) return text;
  const chars = [...text];
  const ell = "…";
  const ellW = textWidth(font, ell);
  let w = 0;
  let out = "";
  for (const ch of chars) {
    const cw = textWidth(font, ch);
    if (w + cw + ellW > maxWidth) break;
    out += ch;
    w += cw;
  }
  return out + ell;
}

/** 幅 maxWidth（等倍のドット数）ごとに折り返す（1文字ずつ詰める。禁則はしない） */
export function wrapText(font: BitmapFont, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  let w = 0;
  for (const ch of text) {
    const cw = textWidth(font, ch);
    if (line !== "" && w + cw > maxWidth) {
      lines.push(line);
      line = "";
      w = 0;
    }
    line += ch;
    w += cw;
  }
  if (line !== "") lines.push(line);
  return lines;
}
