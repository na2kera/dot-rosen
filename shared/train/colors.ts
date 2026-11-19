// 電車の絵の色。画像は色番号（Uint8Array）で持ち、色味はここだけで決める。
// 色味を直すときは PAL と固定色の表を変えれば、画面・印刷・確認用の出力すべてに反映される。
import type { Palette, Rgba } from "../pix/image.ts";

/** 車体・帯・ロゴ・ラインカラーに使う12色 */
export const COLOR_IDS = [
  "white",
  "silver",
  "black",
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "sky",
  "blue",
  "purple",
  "pink",
] as const;
export type ColorId = (typeof COLOR_IDS)[number];

/** 画面に出す色の名前 */
export const COLOR_LABELS: Record<ColorId, string> = {
  white: "白",
  silver: "銀",
  black: "黒",
  red: "赤",
  orange: "橙",
  yellow: "黄",
  lime: "黄緑",
  green: "緑",
  sky: "水色",
  blue: "青",
  purple: "紫",
  pink: "桃",
};

/** 12色の基本色（v2 の見本の PAL を引き継ぐ） */
export const PAL: Record<ColorId, string> = {
  white: "#f4f4f0",
  silver: "#b8c0cc",
  black: "#33384a",
  red: "#d9453d",
  orange: "#f08a2c",
  yellow: "#f2c530",
  lime: "#8ac43f",
  green: "#2f9e5b",
  sky: "#3fa9e0",
  blue: "#2d5fc4",
  purple: "#8a55c7",
  pink: "#e8709a",
};

// ---- 色番号 ----

/** 何も描かない（透明） */
export const C_NONE = 0;
/** 輪郭・ゴムなどのいちばん濃い線 */
export const C_INK = 1;
/** 窓枠・柱 */
export const C_FRAME = 2;
export const C_GLASS = 3;
/** ガラスの下側の明るいところ */
export const C_GLASS2 = 4;
/** ガラスの映り込み */
export const C_REFLECT = 5;
/** 車内の暗がり、表示器の地 */
export const C_INTERIOR = 6;
export const C_METAL = 7;
export const C_METAL_LIGHT = 8;
export const C_METAL_DARK = 9;
export const C_WHITE = 10;
/** 前照灯の光 */
export const C_LAMP = 11;
/** 尾灯 */
export const C_TAIL = 12;
/** 行先表示などの橙色の点 */
export const C_LED = 13;
/** 金属部の輪郭 */
export const C_EDGE_METAL = 14;
/** 警戒色のしまの黒 */
export const C_STRIPE_BLACK = 15;

/** 12色それぞれの色番号の先頭。COLOR_BASE + 色の番号 * COLOR_STRIDE + 階調 */
export const COLOR_BASE = 16;
export const COLOR_STRIDE = 16;
/** 階調: 明 */
export const T_LIGHT = 0;
/** 階調: 基本 */
export const T_BASE = 1;
/** 階調: 暗 */
export const T_DARK = 2;
/** その色の部品の輪郭（白黒では黒） */
export const T_EDGE = 3;
/** ロゴの描く色（色は基本色と同じ。白黒では黒） */
export const T_LOGO_FG = 4;
/** ロゴの地の色（色は基本色と同じ。白黒では白） */
export const T_LOGO_BG = 5;
/**
 * 境目の印（明・基本・暗のそれぞれに 3 種）。色は元の階調と同じで、白黒では
 * 下の境目（1）なら最後の印刷行、右の境目（2）なら最後の印刷列、両方（3）なら両方に黒線を入れる。
 * 色番号 = 先頭 + T_SEAM + 階調 * 3 + (印 - 1)
 */
export const T_SEAM = 6;
export const SEAM_BELOW = 1;
export const SEAM_RIGHT = 2;
/** 使っている色番号の数 */
export const COLOR_COUNT = COLOR_BASE + COLOR_IDS.length * COLOR_STRIDE;

const COLOR_INDEX: Record<ColorId, number> = Object.fromEntries(COLOR_IDS.map((id, i) => [id, i])) as Record<ColorId, number>;

/** 12色の番号（0〜11） */
export function colorIndex(id: ColorId): number {
  return COLOR_INDEX[id];
}

/** 色番号の束（その色の明・基本・暗・輪郭・ロゴ用） */
export type Tones = { light: number; base: number; dark: number; edge: number; logoFg: number; logoBg: number };

export function tones(id: ColorId): Tones {
  const b = COLOR_BASE + COLOR_INDEX[id] * COLOR_STRIDE;
  return { light: b + T_LIGHT, base: b + T_BASE, dark: b + T_DARK, edge: b + T_EDGE, logoFg: b + T_LOGO_FG, logoBg: b + T_LOGO_BG };
}

/** 色番号が12色のどれに属するか（属さなければ -1） */
export function familyOf(index: number): number {
  if (index < COLOR_BASE || index >= COLOR_COUNT) return -1;
  return ((index - COLOR_BASE) / COLOR_STRIDE) | 0;
}

/** 色番号の階調（12色に属さなければ -1）。境目の印は元の階調を返す */
export function toneOf(index: number): number {
  if (index < COLOR_BASE || index >= COLOR_COUNT) return -1;
  const k = (index - COLOR_BASE) % COLOR_STRIDE;
  return k >= T_SEAM && k < T_SEAM + 9 ? ((k - T_SEAM) / 3) | 0 : k;
}

/** 境目の印（0 = なし、1 = 下、2 = 右、3 = 両方） */
export function seamOf(index: number): number {
  if (index < COLOR_BASE || index >= COLOR_COUNT) return 0;
  const k = (index - COLOR_BASE) % COLOR_STRIDE;
  return k >= T_SEAM && k < T_SEAM + 9 ? ((k - T_SEAM) % 3) + 1 : 0;
}

/** 色番号 → 12色の番号 + 1（明・基本・暗と、その境目の印のときだけ。ほかは 0）。境目を探すときの表 */
export const SEAM_FAMILY: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let i = COLOR_BASE; i < COLOR_COUNT; i++) {
    const tone = toneOf(i);
    if (tone >= 0 && tone <= T_DARK) t[i] = familyOf(i) + 1;
  }
  return t;
})();

/** 明・基本・暗の色番号に境目の印を付けたもの（flags は 1〜3。印を足すときは既存の印と合わせる） */
export function withSeam(index: number, flags: number): number {
  const fam = familyOf(index);
  const tone = toneOf(index);
  if (fam < 0 || tone < 0 || tone > T_DARK || flags === 0) return index;
  const merged = seamOf(index) | flags;
  return COLOR_BASE + fam * COLOR_STRIDE + T_SEAM + tone * 3 + (merged - 1);
}

// ---- 色味の計算（v2 と同じ式） ----

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function mix(c: string, target: string, amount: number): Rgba {
  const a = hex(c);
  const b = hex(target);
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount),
    255,
  ];
}

const rgb = (c: string): Rgba => [...hex(c), 255];

/** 固定色（ガラス・金属・灯具など。v2 を引き継ぐ） */
const FIXED: readonly [number, string][] = [
  [C_INK, "#202931"],
  [C_FRAME, "#344750"],
  [C_GLASS, "#466978"],
  [C_GLASS2, "#77959e"],
  [C_REFLECT, "#bed2d5"],
  [C_INTERIOR, "#30434d"],
  [C_METAL, "#89949c"],
  [C_METAL_LIGHT, "#d4d9d9"],
  [C_METAL_DARK, "#606d77"],
  [C_WHITE, "#ffffff"],
  [C_LAMP, "#fff1be"],
  [C_TAIL, "#ce4d48"],
  [C_LED, "#f9b55b"],
  [C_EDGE_METAL, "#485761"],
  [C_STRIPE_BLACK, "#2a2f3a"],
];

/** 色番号 → RGBA。0 は透明 */
export const TRAIN_PALETTE: Palette = (() => {
  const p: Rgba[] = Array.from({ length: 256 }, () => [0, 0, 0, 0] as Rgba);
  for (const [i, c] of FIXED) p[i] = rgb(c);
  COLOR_IDS.forEach((id, k) => {
    const base = PAL[id];
    const b = COLOR_BASE + k * COLOR_STRIDE;
    p[b + T_LIGHT] = mix(base, "#ffffff", 0.28);
    p[b + T_BASE] = rgb(base);
    p[b + T_DARK] = mix(base, "#17252c", 0.27);
    p[b + T_EDGE] = mix(base, "#091824", 0.48);
    p[b + T_LOGO_FG] = rgb(base);
    p[b + T_LOGO_BG] = rgb(base);
    for (let tone = 0; tone < 3; tone++) for (let f = 0; f < 3; f++) p[b + T_SEAM + tone * 3 + f] = p[b + tone];
  });
  return p;
})();

/** 12色の基本色の RGBA（画面の色見本などに使う） */
export function colorRgba(id: ColorId): Rgba {
  return TRAIN_PALETTE[tones(id).base];
}
