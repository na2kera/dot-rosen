// PNG への書き出し（RGBA 8bit とパレット 8bit、フィルタなし）。
// 圧縮関数は環境ごとに違うので引数で受け取る（Node なら zlib.deflateSync を渡す）。

import type { Palette } from "./image.ts";

/** zlib 形式（RFC 1950）で圧縮する関数 */
export type Deflate = (data: Uint8Array) => Uint8Array;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** RGBA の生データ（width * height * 4 バイト）を PNG にする。 */
export function encodePng(width: number, height: number, rgba: Uint8Array, deflate: Deflate): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error("RGBA のバイト数が大きさと合いません");
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  // 圧縮・フィルタ・インターレースはすべて 0
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    // 各行の先頭はフィルタ種別 0（なし）
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** チャンクをつないで PNG のバイト列にする */
function assemble(ihdr: Uint8Array, extra: [string, Uint8Array][], idat: Uint8Array): Uint8Array {
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...extra.map(([t, d]) => chunk(t, d)), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * 色番号（1ドット1バイト）とパレットから、パレット形式（8 ビット）の PNG の部品を作る。
 * scale で整数倍に拡大する。パレットは使っている最大の番号までを書き、使っている色に不透明でないものがあれば tRNS も書く。
 */
function indexedParts(width: number, height: number, pixels: Uint8Array, palette: Palette, scale: number) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`倍率は1以上の整数にしてください: ${scale}`);
  if (pixels.length !== width * height) throw new Error("色番号のバイト数が大きさと合いません");
  const w = width * scale;
  const h = height * scale;
  const used = new Uint8Array(256);
  let max = 0;
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    used[v] = 1;
    if (v > max) max = v;
  }
  const n = max + 1;
  const plte = new Uint8Array(n * 3);
  const trns = new Uint8Array(n);
  let opaque = true;
  for (let i = 0; i < n; i++) {
    const c = palette[i] ?? [0, 0, 0, 0];
    plte[i * 3] = c[0];
    plte[i * 3 + 1] = c[1];
    plte[i * 3 + 2] = c[2];
    trns[i] = c[3];
    if (used[i] && c[3] !== 255) opaque = false;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 3; // パレット
  // 各行の先頭はフィルタ種別 0（なし）。拡大した行は前の行の写し
  const stride = w + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < height; y++) {
    const o = y * scale * stride;
    const src = y * width;
    if (scale === 1) raw.set(pixels.subarray(src, src + width), o + 1);
    else for (let x = 0; x < width; x++) raw.fill(pixels[src + x], o + 1 + x * scale, o + 1 + (x + 1) * scale);
    for (let k = 1; k < scale; k++) raw.copyWithin(o + k * stride, o, o + stride);
  }
  const extra: [string, Uint8Array][] = [["PLTE", plte]];
  if (!opaque) extra.push(["tRNS", trns]);
  return { ihdr, extra, raw };
}

/** パレット形式の PNG を作る（圧縮関数を受け取る。Node なら zlib.deflateSync） */
export function encodeIndexedPng(
  width: number,
  height: number,
  pixels: Uint8Array,
  palette: Palette,
  deflate: Deflate,
  scale = 1,
): Uint8Array {
  const { ihdr, extra, raw } = indexedParts(width, height, pixels, palette, scale);
  return assemble(ihdr, extra, deflate(raw));
}

/** zlib 形式（RFC 1950）の非同期の圧縮。CompressionStream("deflate") を使う（Worker・ブラウザ・Node 18 以降） */
export async function deflateAsync(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** パレット形式の PNG を、CompressionStream で圧縮して作る（Worker に同期の圧縮が無いため） */
export async function encodeIndexedPngAsync(
  width: number,
  height: number,
  pixels: Uint8Array,
  palette: Palette,
  scale = 1,
): Promise<Uint8Array> {
  const { ihdr, extra, raw } = indexedParts(width, height, pixels, palette, scale);
  return assemble(ihdr, extra, await deflateAsync(raw));
}
