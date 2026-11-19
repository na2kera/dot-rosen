// ドット絵の画像の型と、点・矩形・線・貼り付けの基本操作。
// DOM にも Node にも依存しない。アンチエイリアスはしない。

/** 色番号つき画像。1ドット1バイトで色番号を持つ。パレットは別に持つ。 */
export type IndexedImage = {
  readonly kind: "indexed";
  readonly width: number;
  readonly height: number;
  /** width * height バイト。左上から行ごと */
  readonly data: Uint8Array;
};

/** 白黒2値の画像。1ドット1ビット、行ごとにバイト詰め。左端が最上位ビット、1 が黒。 */
export type BitImage = {
  readonly kind: "bit";
  readonly width: number;
  readonly height: number;
  /** 1行のバイト数（ceil(width / 8)） */
  readonly stride: number;
  readonly data: Uint8Array;
};

export type PixImage = IndexedImage | BitImage;

/** パレットの1色。[赤, 緑, 青, 不透明度]（各 0〜255） */
export type Rgba = readonly [number, number, number, number];
export type Palette = readonly Rgba[];

export function createIndexed(width: number, height: number, fill = 0): IndexedImage {
  assertSize(width, height);
  const data = new Uint8Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { kind: "indexed", width, height, data };
}

export function createBit(width: number, height: number): BitImage {
  assertSize(width, height);
  const stride = Math.ceil(width / 8);
  return { kind: "bit", width, height, stride, data: new Uint8Array(stride * height) };
}

function assertSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new Error(`画像の大きさが不正です: ${width}x${height}`);
  }
}

/** 点の値を読む。範囲外は 0。 */
export function getPixel(img: PixImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  if (img.kind === "indexed") return img.data[y * img.width + x];
  return (img.data[y * img.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
}

/** 点を打つ。範囲外は無視。白黒画像では 0 以外を黒として扱う。 */
export function setPixel(img: PixImage, x: number, y: number, value: number): void {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  if (img.kind === "indexed") {
    img.data[y * img.width + x] = value;
    return;
  }
  const i = y * img.stride + (x >> 3);
  const bit = 0x80 >> (x & 7);
  if (value) img.data[i] |= bit;
  else img.data[i] &= ~bit;
}

/** 矩形を塗る（左上 x, y、幅 w、高さ h）。はみ出しは切り取る。 */
export function fillRect(img: PixImage, x: number, y: number, w: number, h: number, value: number): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.floor(x + w));
  const y1 = Math.min(img.height, Math.floor(y + h));
  if (x0 >= x1 || y0 >= y1) return;
  if (img.kind === "indexed") {
    for (let yy = y0; yy < y1; yy++) img.data.fill(value, yy * img.width + x0, yy * img.width + x1);
    return;
  }
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) setPixel(img, xx, yy, value);
}

/** 線を引く（両端を含む）。ブレゼンハムの方法で、ぼかさない。 */
export function drawLine(img: PixImage, x0: number, y0: number, x1: number, y1: number, value: number): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPixel(img, x0, y0, value);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export type BlitOptions = {
  /** 整数の倍率（既定 1） */
  scale?: number;
  /** この色番号の点は貼らない（色番号画像のみ。既定は透明扱いなし） */
  transparent?: number;
  /** 白黒画像を貼るとき、黒の点に使う値（既定 1） */
  ink?: number;
  /** 左右反転 */
  flipX?: boolean;
};

/**
 * src を dst の (x, y) に整数倍で貼る。
 * 白黒画像の src は黒の点だけを貼る（白は透明）。
 */
export function blit(dst: PixImage, src: PixImage, x: number, y: number, opts: BlitOptions = {}): void {
  const scale = opts.scale ?? 1;
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`倍率は1以上の整数にしてください: ${scale}`);
  const ink = opts.ink ?? 1;
  x = Math.floor(x);
  y = Math.floor(y);
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const v = getPixel(src, opts.flipX ? src.width - 1 - sx : sx, sy);
      let out: number;
      if (src.kind === "bit") {
        if (!v) continue;
        out = ink;
      } else {
        if (opts.transparent !== undefined && v === opts.transparent) continue;
        out = v;
      }
      if (scale === 1) setPixel(dst, x + sx, y + sy, out);
      else fillRect(dst, x + sx * scale, y + sy * scale, scale, scale, out);
    }
  }
}

/** 色番号画像をパレットで RGBA（1ドット4バイト）に変換する。scale で整数倍に拡大する。 */
export function indexedToRgba(img: IndexedImage, palette: Palette, scale = 1): Uint8Array {
  const w = img.width * scale;
  const h = img.height * scale;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const c = palette[img.data[sy * img.width + Math.floor(x / scale)]] ?? [0, 0, 0, 0];
      const o = (y * w + x) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = c[3];
    }
  }
  return out;
}

/** 白黒画像を RGBA に変換する。 */
export function bitToRgba(
  img: BitImage,
  black: Rgba = [0, 0, 0, 255],
  white: Rgba = [255, 255, 255, 255],
  scale = 1,
): Uint8Array {
  const w = img.width * scale;
  const h = img.height * scale;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = getPixel(img, Math.floor(x / scale), Math.floor(y / scale)) ? black : white;
      out.set(c, (y * w + x) * 4);
    }
  }
  return out;
}
