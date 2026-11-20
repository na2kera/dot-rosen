// 電車のデザインの型、部位の候補一覧、初期値、ランダム、検査。
import { COLOR_IDS, type ColorId } from "./colors.ts";
import { isLogoBits, PRESET_LOGOS } from "./logos.ts";

/** 候補1つ（ID は英字、label は画面に出す名前） */
export type Choice<T extends string> = { readonly id: T; readonly label: string };

const choices = <const T extends string>(list: readonly (readonly [T, string])[]): readonly Choice<T>[] =>
  list.map(([id, label]) => ({ id, label }));

// ---- 正面の顔 ----

export const FACE_CHOICES = {
  contour: choices([
    ["square", "四角"],
    ["round", "角丸"],
    ["taper", "上すぼまり"],
    ["dome", "丸"],
  ]),
  window: choices([
    ["one", "1枚の大窓"],
    ["two", "2枚窓"],
    ["three", "3枚窓"],
    ["pano", "曲面のパノラマ窓"],
    ["small", "小窓"],
  ]),
  door: choices([
    ["none", "なし"],
    ["center", "中央"],
    ["side", "片側寄せ"],
  ]),
  lightShape: choices([
    ["round", "丸形"],
    ["square", "角形"],
    ["led", "横長の LED 風"],
  ]),
  lightPos: choices([
    ["top", "窓の上"],
    ["mid", "窓の下の両脇"],
    ["low", "腰の低い位置"],
  ]),
  sign: choices([
    ["none", "なし"],
    ["top", "上部"],
    ["inwin", "窓の中"],
  ]),
  skirt: choices([
    ["none", "なし"],
    ["small", "小"],
    ["large", "大"],
  ]),
  paint: choices([
    ["plain", "車体色のまま"],
    ["blackface", "窓まわりを黒"],
    ["band", "帯を回す"],
    ["warning", "警戒色のしま模様"],
  ]),
} as const;

// ---- 側面 ----

export const SIDE_CHOICES = {
  nose: choices([
    ["flat", "切妻（垂直）"],
    ["slope", "ゆるい傾斜"],
    ["round", "丸み"],
    ["stream", "流線形"],
    ["long", "ロングノーズ"],
    ["bonnet", "ボンネット型"],
  ]),
  window: choices([
    ["big", "四角い大窓"],
    ["small", "小窓が並ぶ"],
    ["round", "丸窓"],
    ["ribbon", "横長の連続窓"],
  ]),
  doors: choices([
    ["two", "片側2ドア"],
    ["three", "3ドア"],
    ["four", "4ドア"],
  ]),
  roof: choices([
    ["panto", "パンタグラフのみ"],
    ["cooler", "クーラー付き"],
    ["none", "なし"],
  ]),
  band: choices([
    ["none", "帯なし"],
    ["one", "1本帯"],
    ["two", "2本帯"],
    ["stripe", "斜めストライプ"],
    ["dots", "ドット柄"],
    ["split", "上下塗り分け"],
  ]),
} as const;

type Ids<T extends readonly Choice<string>[]> = T[number]["id"];

export type FaceDesign = { -readonly [K in keyof typeof FACE_CHOICES]: Ids<(typeof FACE_CHOICES)[K]> };
export type SideDesign = { -readonly [K in keyof typeof SIDE_CHOICES]: Ids<(typeof SIDE_CHOICES)[K]> };

export type LogoDesign = {
  /** 16×16 の点。1行を16ビット（左端が最上位）として4桁の16進数にし、上の行から16行つないだ64文字（小文字） */
  bits: string;
  /** 描く色 */
  fg: ColorId;
  /** 地の色 */
  bg: ColorId;
};

export type TrainDesign = {
  face: FaceDesign;
  side: SideDesign;
  bodyColor: ColorId;
  bandColor: ColorId;
  /** 両数（1〜16） */
  cars: number;
  logo: LogoDesign;
};

/** 部位の名前（画面の見出しに使う） */
export const FACE_PART_LABELS: Record<keyof FaceDesign, string> = {
  contour: "輪郭",
  window: "前面窓",
  door: "貫通扉",
  lightShape: "ライトの形",
  lightPos: "ライトの位置",
  sign: "行先表示",
  skirt: "スカート",
  paint: "前面の塗り分け",
};

export const SIDE_PART_LABELS: Record<keyof SideDesign, string> = {
  nose: "鼻先",
  window: "窓",
  doors: "ドア",
  roof: "屋根の機器",
  band: "帯・柄",
};

export const FACE_KEYS = Object.keys(FACE_CHOICES) as (keyof FaceDesign)[];
export const SIDE_KEYS = Object.keys(SIDE_CHOICES) as (keyof SideDesign)[];

export const MIN_CARS = 1;
export const MAX_CARS = 16;
export const DEFAULT_CARS = 8;

/** 初期値（通勤電車らしい組み合わせ） */
export function defaultDesign(): TrainDesign {
  return {
    face: {
      contour: "square",
      window: "two",
      door: "none",
      lightShape: "round",
      lightPos: "mid",
      sign: "top",
      skirt: "small",
      paint: "band",
    },
    side: { nose: "flat", window: "big", doors: "four", roof: "cooler", band: "one" },
    bodyColor: "silver",
    bandColor: "green",
    cars: DEFAULT_CARS,
    logo: { bits: PRESET_LOGOS[0].bits, fg: "green", bg: "white" },
  };
}

/** 0 以上 1 未満の乱数を返す関数 */
export type Rng = () => number;

/** 種から決まる乱数（mulberry32）。確認用の出力やテストで使う */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return list[i];
}

/**
 * 顔・側面・車体色・帯色をまとめてランダムに選ぶ。両数は base のまま。
 * ロゴは既製ロゴから選び、描く色は帯の色、地は車体色（車体に帯の色で描いたように見える）。
 */
export function randomDesign(rng: Rng, base: TrainDesign = defaultDesign()): TrainDesign {
  const face = {} as Record<string, string>;
  for (const k of FACE_KEYS) face[k] = pick<Choice<string>>(rng, FACE_CHOICES[k]).id;
  const side = {} as Record<string, string>;
  for (const k of SIDE_KEYS) side[k] = pick<Choice<string>>(rng, SIDE_CHOICES[k]).id;
  const bodyColor = pick(rng, COLOR_IDS);
  const bandColor = pick(
    rng,
    COLOR_IDS.filter((c) => c !== bodyColor),
  );
  const logo = pick(rng, PRESET_LOGOS);
  return {
    face: face as FaceDesign,
    side: side as SideDesign,
    bodyColor,
    bandColor,
    cars: base.cars,
    logo: { bits: logo.bits, fg: bandColor, bg: bodyColor },
  };
}

// ---- 検査 ----

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isColor = (v: unknown): v is ColorId => typeof v === "string" && (COLOR_IDS as readonly string[]).includes(v);

function pickChoices<K extends string>(
  input: unknown,
  table: Record<K, readonly Choice<string>[]>,
): Record<K, string> | null {
  if (!isRecord(input)) return null;
  const out = {} as Record<K, string>;
  for (const k of Object.keys(table) as K[]) {
    const v = input[k];
    if (typeof v !== "string" || !table[k].some((c) => c.id === v)) return null;
    out[k] = v;
  }
  return out;
}

/**
 * 受け取った値を検査して正規化する。余計なキーは捨てる。
 * 失敗の理由: invalid_train / invalid_face / invalid_side / invalid_color / invalid_cars / invalid_logo
 */
export function parseTrainDesign(input: unknown): ParseResult<TrainDesign> {
  if (!isRecord(input)) return { ok: false, error: "invalid_train" };
  const face = pickChoices(input.face, FACE_CHOICES);
  if (!face) return { ok: false, error: "invalid_face" };
  const side = pickChoices(input.side, SIDE_CHOICES);
  if (!side) return { ok: false, error: "invalid_side" };
  if (!isColor(input.bodyColor) || !isColor(input.bandColor)) return { ok: false, error: "invalid_color" };
  const cars = input.cars;
  if (typeof cars !== "number" || !Number.isInteger(cars) || cars < MIN_CARS || cars > MAX_CARS) return { ok: false, error: "invalid_cars" };
  const logo = input.logo;
  if (!isRecord(logo) || typeof logo.bits !== "string" || !isColor(logo.fg) || !isColor(logo.bg)) return { ok: false, error: "invalid_logo" };
  const bits = logo.bits.toLowerCase();
  if (!isLogoBits(bits)) return { ok: false, error: "invalid_logo" };
  return {
    ok: true,
    value: {
      face: face as FaceDesign,
      side: side as SideDesign,
      bodyColor: input.bodyColor,
      bandColor: input.bandColor,
      cars,
      logo: { bits, fg: logo.fg, bg: logo.bg },
    },
  };
}
