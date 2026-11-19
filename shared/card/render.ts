// 配置（layoutCard の命令の列）を、印刷用の白黒画像とカラー版の色番号画像に描く。
import type { BitmapFont } from "../font/index.ts";
import { blit, createBit, createIndexed, fillRect, setPixel, type BitImage, type IndexedImage } from "../pix/index.ts";
import { toMono, type PatternSet } from "../train/index.ts";
import type { CardLayout } from "./layout.ts";
import { CARD_BASE, CARD_INK, CARD_PAPER } from "./palette.ts";
import { drawTextScaled } from "./text.ts";

// ---- カラー版 ----

export function paintColor(layout: CardLayout, font: BitmapFont): IndexedImage {
  const img = createIndexed(layout.width, layout.height, CARD_PAPER);
  for (const op of layout.ops) {
    switch (op.k) {
      case "rect":
        fillRect(img, op.x, op.y, op.w, op.h, op.c);
        break;
      case "text":
        drawTextScaled(img, font, op.x, op.y, op.s, op.sx, op.sy, op.c);
        break;
      case "dots":
        for (let x = op.x0; x < op.x1; x += 2) setPixel(img, x, op.y, op.c);
        break;
      case "sprite":
        blit(img, op.img, op.x, op.y, { scale: op.scale, transparent: 0 });
        break;
      case "qr": {
        const { m, cell } = op;
        for (let r = 0; r < m.size; r++)
          for (let c = 0; c < m.size; c++) if (m.dark[r * m.size + c]) fillRect(img, op.x + c * cell, op.y + r * cell, cell, cell, CARD_INK);
        break;
      }
    }
  }
  return img;
}


// ---- 印刷用 ----

/** 色番号の白黒での扱い。0 = 白、1 = 黒、2 = 模様 */
type MonoFill = { kind: 0 | 1 | 2; strip: BitImage | null };
const fillCache: Record<PatternSet, Map<number, MonoFill>> = { light: new Map(), bold: new Map() };

/**
 * 塗りの色番号を白黒でどう塗るか。模様の色は、紙の座標に揃った模様の帯（幅 384、模様の縦の周期ぶん）を作っておく。
 * カードの色（CARD_BASE 以上）は 地 = 白、それ以外 = 黒。
 */
function monoFill(c: number, set: PatternSet, width: number): MonoFill {
  if (c >= CARD_BASE) return { kind: c === CARD_PAPER ? 0 : 1, strip: null };
  const cache = fillCache[set];
  const key = c * 4096 + width;
  const hit = cache.get(key);
  if (hit) return hit;
  // 模様の周期はどれも 7 マス（14 ドット）以下なので、16×28 の見本で判定する
  const sample = toMono(createIndexed(16, 28, c), 1, set);
  let ones = 0;
  for (const v of sample.data) for (let k = 0; k < 8; k++) ones += (v >> k) & 1;
  let res: MonoFill;
  if (ones === 0) res = { kind: 0, strip: null };
  else if (ones === 16 * 28) res = { kind: 1, strip: null };
  else {
    let period = 7;
    for (let p = 1; p <= 7; p++) {
      let same = true;
      for (let r = 0; r + p * 2 < 28 && same; r++)
        for (let i = 0; i < sample.stride; i++) if (sample.data[r * sample.stride + i] !== sample.data[(r + p * 2) * sample.stride + i]) same = false;
      if (same) {
        period = p;
        break;
      }
    }
    res = { kind: 2, strip: toMono(createIndexed(width, period * 2, c), 1, set) };
  }
  cache.set(key, res);
  return res;
}

/** 白黒画像の矩形を塗る（バイト単位でまとめて塗る） */
function fillBits(img: BitImage, x: number, y: number, w: number, h: number, pattern: BitImage | null, black: boolean): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(img.width, x + w);
  const y1 = Math.min(img.height, y + h);
  if (x0 >= x1 || y0 >= y1) return;
  const d = img.data;
  const st = img.stride;
  const b0 = x0 >> 3;
  const b1 = (x1 - 1) >> 3;
  const m0 = 0xff >> (x0 & 7);
  const m1 = (0xff << (7 - ((x1 - 1) & 7))) & 0xff;
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * st;
    const prow = pattern ? (yy % pattern.height) * pattern.stride : 0;
    for (let bi = b0; bi <= b1; bi++) {
      let mask = 0xff;
      if (bi === b0) mask &= m0;
      if (bi === b1) mask &= m1;
      const v = pattern ? pattern.data[prow + bi] : black ? 0xff : 0;
      d[row + bi] = (d[row + bi] & ~mask) | (v & mask);
    }
  }
}

/** 白黒画像 src の黒を dst の (x, y) に重ねる */
function orBits(dst: BitImage, src: BitImage, x: number, y: number): void {
  if ((x & 7) === 0 && x >= 0 && x + src.width <= dst.width) {
    const bx = x >> 3;
    for (let j = 0; j < src.height; j++) {
      const yy = y + j;
      if (yy < 0 || yy >= dst.height) continue;
      const so = j * src.stride;
      const dofs = yy * dst.stride + bx;
      for (let i = 0; i < src.stride; i++) dst.data[dofs + i] |= src.data[so + i];
    }
    return;
  }
  blit(dst, src, x, y);
}

export function paintPrint(layout: CardLayout, font: BitmapFont, set: PatternSet): BitImage {
  const img = createBit(layout.width, layout.height);
  for (const op of layout.ops) {
    switch (op.k) {
      case "rect": {
        const f = monoFill(op.c, set, layout.width);
        fillBits(img, op.x, op.y, op.w, op.h, f.strip, f.kind === 1);
        break;
      }
      case "text":
        drawTextScaled(img, font, op.x, op.y, op.s, op.sx, op.sy, monoFill(op.c, set, layout.width).kind === 0 ? 0 : 1);
        break;
      case "dots": {
        const v = monoFill(op.c, set, layout.width).kind === 0 ? 0 : 1;
        for (let x = op.x0; x < op.x1; x += 2) setPixel(img, x, op.y, v);
        break;
      }
      case "sprite":
        orBits(img, toMono(op.img, op.scale, set), op.x, op.y);
        break;
      case "qr": {
        const { m, cell } = op;
        for (let r = 0; r < m.size; r++)
          for (let c = 0; c < m.size; c++) if (m.dark[r * m.size + c]) fillBits(img, op.x + c * cell, op.y + r * cell, cell, cell, null, true);
        break;
      }
    }
  }
  return img;
}
