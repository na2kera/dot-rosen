// 色番号画像を感熱プリンタ用の白黒2値にする。
// 12色それぞれに固定の模様を割り当てる。模様は「印刷2ドット」を1マスとして決める（倍率によらない）。
// 模様セットは2通り: light（v2 相当のまばらな模様）と bold（色の違いがはっきり分かる濃さ）。
import { createBit, type BitImage, type IndexedImage } from "../pix/image.ts";
import {
  C_EDGE_METAL,
  C_FRAME,
  C_GLASS,
  C_GLASS2,
  C_INK,
  C_INTERIOR,
  C_LAMP,
  C_LED,
  C_METAL,
  C_METAL_DARK,
  C_METAL_LIGHT,
  C_NONE,
  C_REFLECT,
  C_STRIPE_BLACK,
  C_TAIL,
  C_WHITE,
  COLOR_BASE,
  COLOR_COUNT,
  COLOR_IDS,
  COLOR_STRIDE,
  T_BASE,
  T_DARK,
  T_EDGE,
  T_LIGHT,
  T_LOGO_BG,
  T_LOGO_FG,
  T_SEAM,
  type ColorId,
} from "./colors.ts";

export type PatternSet = "light" | "bold";
export const PATTERN_SETS: readonly PatternSet[] = ["light", "bold"];

/** 模様（マス単位の繰り返し）。(x, y) はマスの座標 */
type PatternFn = (x: number, y: number) => boolean;
type PatternDef = { w: number; h: number; fn: PatternFn };

const WHITE_P: PatternDef = { w: 1, h: 1, fn: () => false };
const BLACK_P: PatternDef = { w: 1, h: 1, fn: () => true };
const p = (w: number, h: number, fn: PatternFn): PatternDef => ({ w, h, fn });

/** light: v2 の印刷見本の模様（いずれも 25% 以下） */
const LIGHT_COLORS: Record<ColorId, PatternDef> = {
  white: WHITE_P,
  silver: p(6, 4, (x, y) => x % 6 === 0 && y % 4 === 0),
  black: p(2, 2, (x, y) => x % 2 === 0 && y % 2 === 0),
  red: p(1, 5, (_x, y) => y % 5 === 0),
  orange: p(6, 1, (x) => x % 6 === 0),
  yellow: p(6, 3, (x, y) => x % 6 === 0 && y % 3 === 0),
  lime: p(6, 6, (x, y) => (x - y + 48) % 6 === 0),
  green: p(5, 5, (x, y) => (x + y) % 5 === 0),
  sky: p(4, 3, (x, y) => x % 4 === 0 && y % 3 === 0),
  blue: p(6, 6, (x, y) => y % 6 === 0 || (x % 6 === 0 && y % 6 === 3)),
  purple: p(7, 7, (x, y) => (x - y + 49) % 7 === 0 || (x + y) % 7 === 0),
  pink: p(4, 4, (x, y) => x % 4 === 0 && y % 4 === 0),
};

/** bold: 模様の向きと粗さを色ごとに変え、濃さは 50% 以下に抑える */
const BOLD_COLORS: Record<ColorId, PatternDef> = {
  white: WHITE_P,
  silver: p(3, 3, (x, y) => x % 3 === 0 && y % 3 === 0),
  black: p(4, 4, (x, y) => (x + y) % 2 === 0 && !(x % 4 === 0 && y % 4 === 0)),
  red: p(1, 4, (_x, y) => y % 4 === 0),
  orange: p(4, 1, (x) => x % 4 === 0),
  yellow: p(2, 2, (x, y) => x % 2 === 0 && y % 2 === 0),
  lime: p(4, 4, (x, y) => (x + y) % 4 === 0),
  green: p(4, 4, (x, y) => (x - y + 40) % 4 === 0),
  sky: p(3, 3, (x, y) => y % 3 === 0 && x % 3 !== 2),
  blue: p(5, 5, (x, y) => x % 5 === 0 || y % 5 === 0),
  purple: p(5, 5, (x, y) => (x + y) % 5 === 0 || (x - y + 50) % 5 === 0),
  pink: p(4, 4, (x, y) => x % 4 < 2 && y % 4 < 2),
};

/** 固定色の模様 */
const FIXED_RULES: Record<PatternSet, readonly [number, PatternDef][]> = {
  light: [
    [C_INK, BLACK_P],
    [C_FRAME, BLACK_P],
    [C_GLASS, WHITE_P],
    [C_GLASS2, WHITE_P],
    [C_REFLECT, BLACK_P],
    [C_INTERIOR, p(5, 3, (x, y) => x % 5 === 0 && y % 3 === 0)],
    [C_METAL, p(5, 3, (x, y) => x % 5 === 0 && y % 3 === 0)],
    [C_METAL_LIGHT, WHITE_P],
    [C_METAL_DARK, p(5, 5, (x, y) => (x + y) % 5 === 0)],
    [C_WHITE, WHITE_P],
    [C_LAMP, WHITE_P],
    [C_TAIL, BLACK_P],
    [C_LED, BLACK_P],
    [C_EDGE_METAL, BLACK_P],
    [C_STRIPE_BLACK, BLACK_P],
  ],
  bold: [
    [C_INK, BLACK_P],
    [C_FRAME, BLACK_P],
    [C_GLASS, WHITE_P],
    [C_GLASS2, WHITE_P],
    [C_REFLECT, BLACK_P],
    [C_INTERIOR, p(4, 4, (x, y) => (x + y) % 2 === 0 && !(x % 4 === 0 && y % 4 === 0))],
    [C_METAL, p(3, 3, (x, y) => x % 3 === 0 && y % 3 === 0)],
    [C_METAL_LIGHT, WHITE_P],
    [C_METAL_DARK, p(4, 4, (x, y) => (x + y) % 4 === 0)],
    [C_WHITE, WHITE_P],
    [C_LAMP, WHITE_P],
    [C_TAIL, BLACK_P],
    [C_LED, BLACK_P],
    [C_EDGE_METAL, BLACK_P],
    [C_STRIPE_BLACK, BLACK_P],
  ],
};

/** 白黒に変換するための表 */
type MonoTable = {
  /** 色番号 → 模様の番号 */
  pid: Uint8Array;
  /** 色番号 → 境目の印（0 なし、1 下、2 右、3 両方） */
  seam: Uint8Array;
  /** 模様ごと: 0 = 白だけ、1 = 黒だけ、2 = 模様 */
  kind: Uint8Array;
  /** 模様ごとの幅・高さ（マス）と、tiles の中の位置、行の表の中の位置 */
  w: Uint8Array;
  h: Uint8Array;
  off: Uint16Array;
  rowBase: Uint16Array;
  rowCount: number;
  tiles: Uint8Array;
  /** 規則がある色番号か */
  known: Uint8Array;
  /** 出力の1行のバイト数ごとに、模様の行を展開したもの（使うときに作る） */
  rows: Map<number, { bytes: Uint8Array; ready: Uint8Array }>;
};

function buildTable(set: PatternSet): MonoTable {
  const rules = new Array<PatternDef | undefined>(256);
  rules[C_NONE] = WHITE_P;
  for (const [i, def] of FIXED_RULES[set]) rules[i] = def;
  const colors = set === "light" ? LIGHT_COLORS : BOLD_COLORS;
  const seam = new Uint8Array(256);
  COLOR_IDS.forEach((id, k) => {
    const b = COLOR_BASE + k * COLOR_STRIDE;
    rules[b + T_LIGHT] = colors[id];
    rules[b + T_BASE] = colors[id];
    rules[b + T_DARK] = colors[id];
    rules[b + T_EDGE] = BLACK_P;
    rules[b + T_LOGO_FG] = BLACK_P;
    rules[b + T_LOGO_BG] = WHITE_P;
    for (let tone = 0; tone < 3; tone++) {
      for (let fl = 1; fl <= 3; fl++) {
        const i = b + T_SEAM + tone * 3 + fl - 1;
        rules[i] = colors[id];
        seam[i] = fl;
      }
    }
  });
  const known = new Uint8Array(256);
  const pid = new Uint8Array(256);
  const defs: PatternDef[] = [];
  for (let i = 0; i < 256; i++) {
    const def = rules[i] ?? WHITE_P;
    known[i] = rules[i] ? 1 : 0;
    let k = defs.indexOf(def);
    if (k < 0) {
      k = defs.length;
      defs.push(def);
    }
    pid[i] = k;
  }
  const n = defs.length;
  const kind = new Uint8Array(n);
  const w = new Uint8Array(n);
  const h = new Uint8Array(n);
  const off = new Uint16Array(n);
  const rowBase = new Uint16Array(n);
  const tiles = new Uint8Array(defs.reduce((a, d) => a + d.w * d.h, 0));
  let o = 0;
  let rb = 0;
  defs.forEach((def, k) => {
    let ones = 0;
    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        const v = def.fn(x, y) ? 1 : 0;
        tiles[o + y * def.w + x] = v;
        ones += v;
      }
    }
    kind[k] = ones === 0 ? 0 : ones === def.w * def.h ? 1 : 2;
    w[k] = def.w;
    h[k] = def.h;
    off[k] = o;
    rowBase[k] = rb;
    o += def.w * def.h;
    rb += def.h;
  });
  return { pid, seam, kind, w, h, off, rowBase, rowCount: rb, tiles, known, rows: new Map() };
}

const TABLES: Record<PatternSet, MonoTable> = { light: buildTable("light"), bold: buildTable("bold") };

/** 色番号に白黒の規則があるか（テスト用） */
export function hasMonoRule(set: PatternSet, index: number): boolean {
  return TABLES[set].known[index] === 1;
}

/** 模様 p の phase 行目を、出力1行ぶんのバイト列に展開する */
function fillPatternRow(t: MonoTable, bytes: Uint8Array, stride: number, p: number, phase: number): void {
  const base = (t.rowBase[p] + phase) * stride;
  const pw = t.w[p];
  const to = t.off[p] + phase * pw;
  for (let x = 0; x < stride * 8; x++) {
    if (t.tiles[to + ((x >> 1) % pw)] === 1) bytes[base + (x >> 3)] |= 0x80 >> (x & 7);
  }
}

// 1行ぶんの作業用（呼ぶたびに作らない）
let RUN_START = new Int32Array(0);
let RUN_PID = new Uint8Array(0);
let SEAM_START = new Int32Array(0);
let SEAM_END = new Int32Array(0);
let SEAM_FLAG = new Uint8Array(0);

/**
 * 色番号画像を白黒2値にする。scale は整数の倍率。set は模様セット（既定 bold）。
 * - 模様は印刷2ドットを1マスとして、印刷の座標で決める。
 * - 境目の印が付いた点（描くときに markSeams で付ける）は、下の印なら最後の印刷行、
 *   右の印なら最後の印刷列を黒にする（倍率によらず印刷1ドットの線）。
 */
export function toMono(src: IndexedImage, scale = 1, set: PatternSet = "bold"): BitImage {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`倍率は1以上の整数にしてください: ${scale}`);
  const t = TABLES[set];
  const { pid, seam, kind, h: th, rowBase } = t;
  const W = src.width;
  const H = src.height;
  const s = src.data;
  const out = createBit(W * scale, H * scale);
  const od = out.data;
  const stride = out.stride;
  let cache = t.rows.get(stride);
  if (!cache) {
    cache = { bytes: new Uint8Array(t.rowCount * stride), ready: new Uint8Array(t.rowCount) };
    t.rows.set(stride, cache);
  }
  const pb = cache.bytes;
  const ready = cache.ready;
  if (RUN_START.length < W + 1) {
    RUN_START = new Int32Array(W + 1);
    RUN_PID = new Uint8Array(W + 1);
    SEAM_START = new Int32Array(W + 1);
    SEAM_END = new Int32Array(W + 1);
    SEAM_FLAG = new Uint8Array(W + 1);
  }
  const runStart = RUN_START;
  const runPid = RUN_PID;
  const seamStart = SEAM_START;
  const seamEnd = SEAM_END;
  const seamFlag = SEAM_FLAG;
  // 4ドットずつ読むための見方（幅が4の倍数で、並びが揃っているときだけ）
  const s32 = W % 4 === 0 && s.byteOffset % 4 === 0 ? new Uint32Array(s.buffer, s.byteOffset, (W * H) >> 2) : null;
  for (let sy = 0; sy < H; sy++) {
    const row = sy * W;
    // ---- 元の1行を、模様が同じ区間と、境目の印の区間に分ける ----
    let runs = 0;
    let seams = 0;
    let prevColor = -1;
    let prevPid = -1;
    let colorStart = 0;
    let rep = -1;
    for (let q = 0; q < W; q += 4) {
      // 4ドットとも直前と同じ色なら飛ばす
      if (s32 !== null && s32[(row + q) >> 2] === rep) continue;
      const qe = q + 4 < W ? q + 4 : W;
      for (let x = q; x < qe; x++) {
        const c = s[row + x];
        if (c === prevColor) continue;
        if (prevColor >= 0 && seam[prevColor] !== 0) {
          seamStart[seams] = colorStart;
          seamEnd[seams] = x;
          seamFlag[seams] = seam[prevColor];
          seams++;
        }
        const p = pid[c];
        if (p !== prevPid) {
          runStart[runs] = x;
          runPid[runs] = p;
          runs++;
          prevPid = p;
        }
        prevColor = c;
        colorStart = x;
        rep = c * 0x01010101;
      }
    }
    if (prevColor >= 0 && seam[prevColor] !== 0) {
      seamStart[seams] = colorStart;
      seamEnd[seams] = W;
      seamFlag[seams] = seam[prevColor];
      seams++;
    }
    runStart[runs] = W;
    // ---- 印刷の行ごとに、区間をバイト単位で重ねる ----
    for (let j = 0; j < scale; j++) {
      const y = sy * scale + j;
      const cy = y >> 1;
      const orow = y * stride;
      const last = j === scale - 1;
      if (j > 0 && cy === (y - 1) >> 1) {
        // 模様のマスが前の行と同じなら、前の行（境目の右の線を含む）をそのまま写す
        od.copyWithin(orow, orow - stride, orow);
        if (last) {
          for (let e = 0; e < seams; e++) {
            if ((seamFlag[e] & 1) === 0) continue;
            for (let x = seamStart[e] * scale; x < seamEnd[e] * scale; x++) od[orow + (x >> 3)] |= 0x80 >> (x & 7);
          }
        }
        continue;
      }
      for (let r = 0; r < runs; r++) {
        const p = runPid[r];
        const k = kind[p];
        if (k === 0) continue;
        const x0 = runStart[r] * scale;
        const xl = runStart[r + 1] * scale - 1;
        const b0 = orow + (x0 >> 3);
        const b1 = orow + (xl >> 3);
        const m0 = 0xff >> (x0 & 7);
        const m1 = (0xff << (7 - (xl & 7))) & 0xff;
        if (k === 1) {
          if (b0 === b1) od[b0] |= m0 & m1;
          else {
            od[b0] |= m0;
            for (let b = b0 + 1; b < b1; b++) od[b] = 0xff;
            od[b1] |= m1;
          }
          continue;
        }
        const phase = cy % th[p];
        const pr = rowBase[p] + phase;
        if (ready[pr] === 0) {
          fillPatternRow(t, pb, stride, p, phase);
          ready[pr] = 1;
        }
        const sh = pr * stride - orow;
        if (b0 === b1) od[b0] |= pb[b0 + sh] & m0 & m1;
        else {
          od[b0] |= pb[b0 + sh] & m0;
          for (let b = b0 + 1; b < b1; b++) od[b] |= pb[b + sh];
          od[b1] |= pb[b1 + sh] & m1;
        }
      }
      // 境目の線
      for (let e = 0; e < seams; e++) {
        const fl = seamFlag[e];
        if (last && (fl & 1) !== 0) {
          for (let x = seamStart[e] * scale; x < seamEnd[e] * scale; x++) od[orow + (x >> 3)] |= 0x80 >> (x & 7);
        } else if ((fl & 2) !== 0) {
          for (let sx = seamStart[e]; sx < seamEnd[e]; sx++) {
            const x = sx * scale + scale - 1;
            od[orow + (x >> 3)] |= 0x80 >> (x & 7);
          }
        }
      }
    }
  }
  return out;
}

/** 黒の割合が最も高い size×size の範囲（画像が小さいときは画像全体） */
export function maxInkRatio(img: BitImage, size = 64): { ratio: number; x: number; y: number } {
  const W = img.width;
  const H = img.height;
  const sw = Math.min(size, W);
  const sh = Math.min(size, H);
  if (sw === 0 || sh === 0) return { ratio: 0, x: 0, y: 0 };
  const stride = W + 1;
  const sum = new Uint32Array(stride * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += (img.data[y * img.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + rowSum;
    }
  }
  let max = -1;
  let ax = 0;
  let ay = 0;
  for (let y = 0; y + sh <= H; y++) {
    for (let x = 0; x + sw <= W; x++) {
      const n = sum[(y + sh) * stride + x + sw] - sum[y * stride + x + sw] - sum[(y + sh) * stride + x] + sum[y * stride + x];
      if (n > max) {
        max = n;
        ax = x;
        ay = y;
      }
    }
  }
  return { ratio: max / (sw * sh), x: ax, y: ay };
}

/** 色番号のうち、絵に使うもの（白黒の規則の網羅を確かめるため） */
export function usedColorIndices(): number[] {
  const out = [C_INK, C_FRAME, C_GLASS, C_GLASS2, C_REFLECT, C_INTERIOR, C_METAL, C_METAL_LIGHT, C_METAL_DARK, C_WHITE, C_LAMP, C_TAIL, C_LED, C_EDGE_METAL, C_STRIPE_BLACK];
  for (let i = COLOR_BASE; i < COLOR_COUNT; i++) {
    const t = (i - COLOR_BASE) % COLOR_STRIDE;
    if (t < T_SEAM + 9) out.push(i);
  }
  return out;
}
