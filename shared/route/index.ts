// 路線データ（docs/api.md「1. 路線データ」）の型と基本の関数。
// 画面とサーバーで同じ検査・正規化を使う。DOM にも Node にも依存しない。
import { COLOR_IDS, type ColorId } from "../train/colors.ts";
import { defaultDesign, parseTrainDesign, type TrainDesign } from "../train/design.ts";

export { MAX_CARS, MIN_CARS } from "../train/design.ts";

/** 駅数の上限・下限 */
export const MAX_STATIONS = 30;
export const MIN_STATIONS = 2;
/** 路線名の最大文字数（コードポイント数） */
export const MAX_NAME_LENGTH = 12;
/** 環状にできる最小の駅数 */
export const MIN_LOOP_STATIONS = 3;
/** 路線データの JSON の最大バイト数（UTF-8） */
export const MAX_ROUTE_JSON_BYTES = 8 * 1024;

export type RouteData = {
  v: 1;
  /** 路線名。1〜12文字（コードポイント数）。制御文字と改行は不可 */
  name: string;
  /** 路線記号。英大文字1〜2文字 */
  symbol: string;
  /** ラインカラー */
  lineColor: ColorId;
  /** 駅 ID。2〜30件。重複不可 */
  stations: string[];
  /** 環状線なら true（stations に始発駅を2回入れない）。3駅以上のときだけ */
  loop: boolean;
  train: TrainDesign;
};

/** 作りかけの状態。RouteData と同じ形で、駅数の下限だけ無い（0〜30件） */
export type RouteDraft = RouteData;

/** 駅を引く関数（無ければ undefined） */
export type StationLookup = (id: string) => { name: string; lat: number; lon: number } | undefined;

/**
 * 検査の失敗の理由。
 * - too_large: JSON が 8KB を超える / invalid_format: オブジェクトでない、JSON にできない
 * - invalid_version / invalid_name / invalid_symbol / invalid_line_color / invalid_loop
 * - invalid_stations: 配列でない、文字列でない / too_few_stations / too_many_stations
 * - unknown_station / duplicate_station / loop_too_short
 * - invalid_train（と parseTrainDesign の理由: invalid_face など）
 */
export type RouteError =
  | "too_large"
  | "invalid_format"
  | "invalid_version"
  | "invalid_name"
  | "invalid_symbol"
  | "invalid_line_color"
  | "invalid_stations"
  | "too_few_stations"
  | "too_many_stations"
  | "unknown_station"
  | "duplicate_station"
  | "invalid_loop"
  | "loop_too_short"
  | "invalid_train"
  | "invalid_face"
  | "invalid_side"
  | "invalid_color"
  | "invalid_cars"
  | "invalid_logo";

export type RouteResult<T> = { ok: true; value: T } | { ok: false; error: RouteError };

/** 初期値（駅は空） */
export function defaultRouteDraft(): RouteDraft {
  const train = defaultDesign();
  return { v: 1, name: "あたらしい路線", symbol: "DR", lineColor: train.bandColor, stations: [], loop: false, train };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 制御文字（C0・DEL・C1）と、行・段落の区切り
const FORBIDDEN_IN_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** 路線名を正規化する（前後の空白を除く）。不正なら null */
export function normalizeRouteName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (FORBIDDEN_IN_NAME.test(name)) return null;
  const n = [...name].length;
  if (n < 1 || n > MAX_NAME_LENGTH) return null;
  return name;
}

/** 路線記号を正規化する（大文字にする）。不正なら null */
export function normalizeRouteSymbol(input: unknown): string | null {
  if (typeof input !== "string" || !/^[A-Za-z]{1,2}$/.test(input)) return null;
  return input.toUpperCase();
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function parse(input: unknown, lookup: StationLookup, minStations: number): RouteResult<RouteData> {
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    return { ok: false, error: "invalid_format" };
  }
  if (json === undefined || !isRecord(input)) return { ok: false, error: "invalid_format" };
  if (utf8Length(json) > MAX_ROUTE_JSON_BYTES) return { ok: false, error: "too_large" };
  if (input.v !== 1) return { ok: false, error: "invalid_version" };
  const name = normalizeRouteName(input.name);
  if (name === null) return { ok: false, error: "invalid_name" };
  const symbol = normalizeRouteSymbol(input.symbol);
  if (symbol === null) return { ok: false, error: "invalid_symbol" };
  const lineColor = input.lineColor;
  if (typeof lineColor !== "string" || !(COLOR_IDS as readonly string[]).includes(lineColor)) return { ok: false, error: "invalid_line_color" };
  const stations = input.stations;
  if (!Array.isArray(stations) || stations.some((s) => typeof s !== "string")) return { ok: false, error: "invalid_stations" };
  if (stations.length < minStations) return { ok: false, error: "too_few_stations" };
  if (stations.length > MAX_STATIONS) return { ok: false, error: "too_many_stations" };
  if (stations.some((s) => lookup(s as string) === undefined)) return { ok: false, error: "unknown_station" };
  if (new Set(stations).size !== stations.length) return { ok: false, error: "duplicate_station" };
  if (typeof input.loop !== "boolean") return { ok: false, error: "invalid_loop" };
  if (input.loop && stations.length < MIN_LOOP_STATIONS) return { ok: false, error: "loop_too_short" };
  const train = parseTrainDesign(input.train);
  if (!train.ok) return { ok: false, error: train.error as RouteError };
  return {
    ok: true,
    value: { v: 1, name, symbol, lineColor: lineColor as ColorId, stations: [...(stations as string[])], loop: input.loop, train: train.value },
  };
}

/** 路線データを検査して正規化する（保存・印刷の前に必ず通す）。余計なキーは捨てる */
export function parseRouteData(input: unknown, lookup: StationLookup): RouteResult<RouteData> {
  return parse(input, lookup, MIN_STATIONS);
}

/** 作りかけの状態を検査して正規化する（駅は 0 件から。端末に保存したものを読み戻すときなど） */
export function parseRouteDraft(input: unknown, lookup: StationLookup): RouteResult<RouteDraft> {
  return parse(input, lookup, 0);
}

/** 駅ナンバリング（index は 0 始まり）。stationNumber("KR", 0) → "KR01" */
export function stationNumber(symbol: string, index: number): string {
  return `${symbol}${String(index + 1).padStart(2, "0")}`;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** 2点の球面上の距離（km、ハバーサインの式） */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 隣り合う駅の直線距離（球面の距離）の合計（km、小数1桁に丸める）。
 * 環状線は最後の駅から始発駅までも足す。見つからない駅は飛ばす。
 */
export function routeDistanceKm(route: Pick<RouteData, "stations" | "loop">, lookup: StationLookup): number {
  const pts = route.stations.map(lookup).filter((s): s is NonNullable<typeof s> => s !== undefined);
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += greatCircleKm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  if (route.loop && pts.length >= MIN_LOOP_STATIONS) {
    const a = pts[pts.length - 1];
    sum += greatCircleKm(a.lat, a.lon, pts[0].lat, pts[0].lon);
  }
  return Math.round(sum * 10) / 10;
}

/** 区間の表示。「新宿 ⇄ 横浜」、環状線は「環状（起点 新宿）」。駅が無ければ空、1駅ならその駅名 */
export function routeSectionLabel(route: Pick<RouteData, "stations" | "loop">, lookup: StationLookup): string {
  const names = route.stations.map((id) => lookup(id)?.name ?? "?");
  if (names.length === 0) return "";
  if (route.loop && names.length >= MIN_LOOP_STATIONS) return `環状（起点 ${names[0]}）`;
  if (names.length === 1) return names[0];
  return `${names[0]} ⇄ ${names[names.length - 1]}`;
}
