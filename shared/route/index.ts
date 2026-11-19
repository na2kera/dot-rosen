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
 * - too_large: 正規化した結果の JSON が 8KB を超える / invalid_format: オブジェクトでない
 * - invalid_version / invalid_name / invalid_symbol / invalid_line_color / invalid_loop
 * - invalid_stations: 配列でない、文字列でない / too_few_stations / too_many_stations
 * - unknown_station（ID の形式が違う、lookup で引けない、引いた結果が駅の形でない）/ duplicate_station / loop_too_short
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

/** 自身のキーだけを読む（プロトタイプから値を拾わない） */
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

// 路線名に使えない文字。
// - Cc: 制御文字（C0・DEL・C1。改行・タブを含む）
// - Cf: 書式の文字（双方向制御 U+200E/200F/202A〜202E/2066〜2069/061C、ゼロ幅 U+200B〜200D/2060/FEFF、タグ文字など）
// - Zl・Zp: 行・段落の区切り（U+2028/2029）
// - Co: 私用領域（点データのフォントで印刷できない）
// - Default_Ignorable_Code_Point: 見えない文字（異体字セレクタ、ハングルの埋め字 U+3164 など）
// - Variation_Selector: 異体字セレクタ（念のため明示）
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}]/u;
// 前後から除く空白（半角・全角スペース）
const EDGE_SPACES = /^[ \u3000]+|[ \u3000]+$/g;
// 空白だけの名前（U+00A0 など、前後から除かない空白も含む）
const ONLY_SPACES = /^\p{White_Space}*$/u;

/** 孤立サロゲート（対になっていない U+D800〜DFFF）を含むか。isWellFormed が無い環境でも使えるよう自前で確かめる */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * 路線名を正規化する。不正なら null。
 * 禁止文字は元の入力に対して先に確かめ（前後にあっても拒否する）、そのあとで前後の半角・全角スペースを除く。
 */
export function normalizeRouteName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (hasLoneSurrogate(input) || FORBIDDEN_IN_NAME.test(input)) return null;
  const name = input.replace(EDGE_SPACES, "");
  const n = [...name].length;
  if (n < 1 || n > MAX_NAME_LENGTH) return null;
  if (ONLY_SPACES.test(name)) return null;
  return name;
}

/** 路線記号を正規化する（大文字にする）。不正なら null */
export function normalizeRouteSymbol(input: unknown): string | null {
  if (typeof input !== "string" || !/^[A-Za-z]{1,2}$/.test(input)) return null;
  return input.toUpperCase();
}

/** 駅 ID の形式（実データは "s" と数字6桁。英数字と _ - で 1〜32 文字まで許す） */
const STATION_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** 駅 ID が形式に合い、lookup の結果が駅の形（name が文字列、lat・lon が有限の数値）をしているか */
function isKnownStation(id: string, lookup: StationLookup): boolean {
  if (!STATION_ID.test(id)) return false;
  const s: unknown = lookup(id);
  if (!isRecord(s)) return false;
  return typeof s.name === "string" && Number.isFinite(s.lat) && Number.isFinite(s.lon);
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

// 入力全体を文字列化・走査しない。決まったキーだけを取り出して検査し、余計なキーの中身には触れない。
function parse(input: unknown, lookup: StationLookup, minStations: number): RouteResult<RouteData> {
  if (!isRecord(input)) return { ok: false, error: "invalid_format" };
  if (own(input, "v") !== 1) return { ok: false, error: "invalid_version" };
  const name = normalizeRouteName(own(input, "name"));
  if (name === null) return { ok: false, error: "invalid_name" };
  const symbol = normalizeRouteSymbol(own(input, "symbol"));
  if (symbol === null) return { ok: false, error: "invalid_symbol" };
  const lineColor = own(input, "lineColor");
  if (typeof lineColor !== "string" || !(COLOR_IDS as readonly string[]).includes(lineColor)) return { ok: false, error: "invalid_line_color" };
  const raw = own(input, "stations");
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_stations" };
  // 件数を先に確かめ、長い配列を走査しない
  if (raw.length > MAX_STATIONS) {
    return { ok: false, error: raw.slice(0, MAX_STATIONS + 1).every((s) => typeof s === "string") ? "too_many_stations" : "invalid_stations" };
  }
  const stations: string[] = [];
  for (const s of raw) {
    if (typeof s !== "string") return { ok: false, error: "invalid_stations" };
    stations.push(s);
  }
  if (stations.length < minStations) return { ok: false, error: "too_few_stations" };
  if (stations.some((s) => !isKnownStation(s, lookup))) return { ok: false, error: "unknown_station" };
  if (new Set(stations).size !== stations.length) return { ok: false, error: "duplicate_station" };
  const loop = own(input, "loop");
  if (typeof loop !== "boolean") return { ok: false, error: "invalid_loop" };
  if (loop && stations.length < MIN_LOOP_STATIONS) return { ok: false, error: "loop_too_short" };
  const train = parseTrainDesign(own(input, "train"));
  if (!train.ok) return { ok: false, error: train.error as RouteError };
  const value: RouteData = { v: 1, name, symbol, lineColor: lineColor as ColorId, stations, loop, train: train.value };
  // 正規化した結果（余計なキーを捨てたあと）の大きさを確かめる
  if (utf8Length(JSON.stringify(value)) > MAX_ROUTE_JSON_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, value };
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
