// 電車の絵を描くための小さな部品（色番号画像に直接書く）。
// 画素ごとの処理では Set や文字列を使わない。座標はすべて整数。
import { drawLine, fillRect, type IndexedImage } from "../pix/image.ts";
import {
  C_EDGE_METAL,
  C_GLASS,
  C_GLASS2,
  C_INK,
  C_INTERIOR,
  C_LAMP,
  C_LED,
  C_METAL,
  C_METAL_DARK,
  C_METAL_LIGHT,
  C_REFLECT,
  C_WHITE,
  SEAM_BELOW,
  SEAM_FAMILY,
  SEAM_RIGHT,
  withSeam,
} from "./colors.ts";

export const rect = fillRect;
export const line = drawLine;

/** 点を打つ（範囲外は無視） */
export function dot(img: IndexedImage, x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data[y * img.width + x] = c;
}

/** 点の色（範囲外は 0） */
export function colorAt(img: IndexedImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  return img.data[y * img.width + x];
}

/** 角丸の矩形の各行の左端（行 j の点は [A[j+1], w-1-A[j+1]]）。上下に空の行を1つずつ持つ */
const SPAN = new Int16Array(260);

function rrSpans(w: number, h: number, r: number): void {
  SPAN[0] = w;
  SPAN[h + 1] = w;
  for (let j = 0; j < h; j++) {
    const dy = j < r ? r - 1 - j : j >= h - r ? j - (h - r) : -1;
    let a = 0;
    if (r > 0 && dy >= 0) {
      a = r;
      for (let i = 0; i < r; i++) {
        const dx = r - 1 - i;
        if ((dx + 0.5) * (dx + 0.5) + (dy + 0.5) * (dy + 0.5) <= r * r) {
          a = i;
          break;
        }
      }
    }
    SPAN[j + 1] = a;
  }
}

/**
 * 角丸の矩形を塗る（v2 の rr と同じ形）。outline を渡すと、上下左右のどこかが外に接する点を outline で塗る。
 * outline に 0 を渡すと縁なし。
 */
export function box(img: IndexedImage, x: number, y: number, w: number, h: number, fill: number, outline = 0, r = 0): void {
  if (w <= 0 || h <= 0 || h > 256) return;
  rrSpans(w, h, r);
  paintRR(img, x, y, w, h, fill, outline, 0, 0);
}

/** rrSpans で求めた形を塗る。mode 1 は窓ガラスの塗り方 */
function paintRR(img: IndexedImage, x: number, y: number, w: number, h: number, fill: number, outline: number, mode: number, reflect: number): void {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  for (let j = 0; j < h; j++) {
    const yy = y + j;
    if (yy < 0 || yy >= H) continue;
    const a = SPAN[j + 1];
    const b = w - 1 - a;
    const au = SPAN[j];
    const bu = w - 1 - au;
    const ad = SPAN[j + 2];
    const bd = w - 1 - ad;
    const inner = mode === 1 ? (j < 3 ? C_INTERIOR : j > h - 4 ? C_GLASS2 : C_GLASS) : fill;
    // 縁でない区間は [max(a+1, au, ad), min(b-1, bu, bd)]、残りは縁
    const row = yy * W;
    const lo = Math.max(0, x + a);
    const hi = Math.min(W - 1, x + b);
    if (lo > hi) continue;
    const ia = Math.max(a + 1, au, ad);
    const ib = Math.min(b - 1, bu, bd);
    d.fill(outline ? outline : inner, row + lo, row + hi + 1);
    if (ia <= ib) {
      const p = Math.max(lo, x + ia);
      const q = Math.min(hi, x + ib);
      if (p <= q) d.fill(inner, row + p, row + q + 1);
      if (mode === 1) {
        const ri = reflect - j;
        if (ri >= ia && ri <= ib && x + ri >= 0 && x + ri < W) d[row + x + ri] = C_REFLECT;
      }
    }
  }
}

/**
 * 多角形を塗る（v2 と同じく、整数座標の点が内側かを偶奇の規則で判定）。
 * edge を渡すと各辺を線で引く。
 */
export function poly(img: IndexedImage, v: readonly (readonly [number, number])[], fill: number, edge = 0): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of v) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const n = v.length;
  const xs: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    // 点 x が内側 ⇔ x より右にある交点の数が奇数。交点を並べて [c1, c2) の組ごとに塗る
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = v[i][0];
      const b = v[i][1];
      const c = v[j][0];
      const e = v[j][1];
      if (b > y !== e > y) xs.push(((c - a) * (y - b)) / (e - b) + a);
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(minX, Math.ceil(xs[k]));
      const x1 = Math.min(maxX + 1, Math.ceil(xs[k + 1]));
      if (y < 0 || y >= img.height) continue;
      const lo = Math.max(0, x0);
      const hi = Math.min(img.width, x1);
      if (hi > lo) img.data.fill(fill, y * img.width + lo, y * img.width + hi);
    }
  }
  if (edge) for (let i = 0; i < n; i++) line(img, v[i][0], v[i][1], v[(i + 1) % n][0], v[(i + 1) % n][1], edge);
}

/** 窓ガラス（ゴムの縁、上の暗がり、下の明るいところ、斜めの映り込み） */
export function glass(img: IndexedImage, x: number, y: number, w: number, h: number, round = 0): void {
  if (w < 3 || h < 3 || h > 256) return;
  rrSpans(w, h, round);
  paintRR(img, x, y, w, h, C_GLASS, C_INK, 1, Math.floor(w * 0.6));
  if (h > 9) line(img, x + 2, y + h - 3, x + w - 3, y + h - 3, C_GLASS2);
}

/**
 * 行ごとの左右端で形を決めた窓ガラス（運転台の傾いた窓など）。
 * spans[k] = [左端, 右端] が y0 + k 行目。縁は上下左右のどこかが外に接する点。
 */
export function glassSpans(img: IndexedImage, y0: number, spans: readonly (readonly [number, number])[]): void {
  const h = spans.length;
  if (h < 3) return;
  const inShape = (x: number, k: number) => k >= 0 && k < h && x >= spans[k][0] && x <= spans[k][1];
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [a, b] of spans) {
    if (a < minX) minX = a;
    if (b > maxX) maxX = b;
  }
  const reflect = Math.floor((maxX - minX + 1) * 0.6);
  for (let k = 0; k < h; k++) {
    const [a, b] = spans[k];
    for (let x = a; x <= b; x++) {
      const edge = !inShape(x - 1, k) || !inShape(x + 1, k) || !inShape(x, k - 1) || !inShape(x, k + 1);
      let c = edge ? C_INK : k < 3 ? C_INTERIOR : k > h - 4 ? C_GLASS2 : C_GLASS;
      if (!edge && x - minX + k === reflect) c = C_REFLECT;
      dot(img, x, y0 + k, c);
    }
  }
}

/** 前照灯。外側に白い余白、金属の縁、光る面 */
export function lamp(img: IndexedImage, x: number, y: number, w: number, h: number, round: boolean): void {
  box(img, x - 1, y - 1, w + 2, h + 2, C_WHITE, 0, round ? 2 : 0);
  box(img, x, y, w, h, C_METAL_LIGHT, C_INK, round ? 2 : 0);
  rect(img, x + 1, y + 1, w - 2, h - 2, C_LAMP);
  dot(img, x + w - 2, y + 1, C_WHITE);
}

/** 行先表示（暗い地に橙の点） */
export function ledSign(img: IndexedImage, x: number, y: number, w: number): void {
  box(img, x, y, w, 5, C_INTERIOR, C_METAL_DARK);
  for (let i = 2; i < w - 2; i += 3) {
    dot(img, x + i, y + 1, C_LED);
    dot(img, x + i, y + 2, C_LED);
    dot(img, x + i + 1, y + 3, C_LED);
  }
}

/** シングルアームのパンタグラフ。(x, y) は上枠の基準。高さ 15 */
export function panto(img: IndexedImage, x: number, y: number): void {
  rect(img, x - 9, y + 13, 20, 2, C_METAL_DARK);
  for (const a of [x - 6, x + 7]) {
    rect(img, a, y + 10, 3, 3, C_METAL_LIGHT);
    line(img, a - 1, y + 11, a + 3, y + 11, C_METAL_DARK);
  }
  line(img, x + 6, y + 10, x - 5, y + 6, C_INK);
  line(img, x - 5, y + 6, x + 5, y + 1, C_INK);
  line(img, x + 5, y + 1, x + 9, y + 1, C_METAL_LIGHT);
  line(img, x - 3, y, x + 14, y, C_INK);
  line(img, x - 3, y, x - 5, y + 1, C_INK);
  line(img, x + 14, y, x + 16, y + 1, C_INK);
}

/** 線路（レールと砂利）。y はレールの上面。高さ 5 */
export function drawTrack(img: IndexedImage, y: number, x0 = 0, x1 = img.width): void {
  // 乱数を使わない砂利。x は画像の左端からの位置で決まるので、つないでも模様がずれない
  for (let x = x0; x < x1; x++) {
    if (x % 3 === 0) dot(img, x, y + 3, C_METAL_LIGHT);
    if (x % 7 === 2) dot(img, x, y + 4, C_METAL);
  }
  for (let x = x0 + ((((2 - x0) % 9) + 9) % 9); x < x1; x += 9) rect(img, x, y + 1, Math.min(5, x1 - x), 2, C_METAL_DARK);
  rect(img, x0, y, x1 - x0, 1, C_METAL_LIGHT);
  rect(img, x0, y + 1, x1 - x0, 1, C_INK);
}

/** 床下機器の箱（よろい戸つき） */
export function equipment(img: IndexedImage, x: number, y: number, w: number, h: number): void {
  box(img, x, y, w, h, C_METAL, C_EDGE_METAL);
  line(img, x + 1, y + 1, x + w - 2, y + 1, C_METAL_LIGHT);
  for (let a = x + 3; a < x + w - 2; a += 4) line(img, a, y + 3, a, y + h - 2, C_METAL_DARK);
}

/**
 * 12色のうち違う色どうしが接するところ（車体と帯の境目など）に境目の印を付ける。
 * 上側・左側の点を印付きの色番号にする（色は変わらず、白黒で細い黒線になる）。
 * 調べる範囲は [x0, x1) × [y0, y1)。
 */
export function markSeams(img: IndexedImage, x0: number, y0: number, x1: number, y1: number): void {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  const fam = SEAM_FAMILY;
  const xa = Math.max(0, x0);
  const xb = Math.min(W, x1);
  // 4ドットずつ読むための見方（下の行と同じで、4ドットとも同じ色なら境目は無い）
  const d32 = W % 4 === 0 && d.byteOffset % 4 === 0 ? new Uint32Array(d.buffer, d.byteOffset, (W * H) >> 2) : null;
  for (let y = Math.max(0, y0); y < Math.min(H - 1, y1); y++) {
    const row = y * W;
    const below = row + W;
    for (let x = xa; x < xb; x++) {
      const c = d[row + x];
      if (d32 !== null && (x & 3) === 0 && x + 4 < xb) {
        const wd = d32[(row + x) >> 2];
        if (wd === c * 0x01010101 && wd === d32[(below + x) >> 2] && d[row + x + 4] === c) {
          x += 3;
          continue;
        }
      }
      const f = fam[c];
      if (f === 0) continue;
      let flags = 0;
      const fb = fam[d[below + x]];
      if (fb !== 0 && fb !== f) flags = SEAM_BELOW;
      if (x + 1 < W) {
        const fr = fam[d[row + x + 1]];
        if (fr !== 0 && fr !== f) flags |= SEAM_RIGHT;
      }
      if (flags) d[row + x] = withSeam(c, flags);
    }
  }
}
