// 作りかけの路線（RouteDraft）を変える純粋な関数。元の値は変えず、新しい値を返す。
// DOM にも React にも依存しない（テストから読む）。
import { MAX_NAME_LENGTH, MAX_STATIONS, MIN_LOOP_STATIONS, type RouteDraft } from "../../shared/route/index.ts";
import type { ColorId } from "../../shared/train/colors.ts";

export type OpFailure = "duplicate" | "full" | "too_short" | "out_of_range";
export type OpResult = { ok: true; draft: RouteDraft } | { ok: false; reason: OpFailure };

/** 駅の数が減って環状にできなくなったら、環状をやめる */
function fixLoop(d: RouteDraft): RouteDraft {
  return d.loop && d.stations.length < MIN_LOOP_STATIONS ? { ...d, loop: false } : d;
}

/**
 * 駅を加える。at を省くと最後（環状線なら始発駅に戻る手前）に入れる。
 * at は入れる位置（0 なら先頭）。
 */
export function addStation(d: RouteDraft, id: string, at = d.stations.length): OpResult {
  if (d.stations.includes(id)) return { ok: false, reason: "duplicate" };
  if (d.stations.length >= MAX_STATIONS) return { ok: false, reason: "full" };
  if (at < 0 || at > d.stations.length) return { ok: false, reason: "out_of_range" };
  const stations = [...d.stations];
  stations.splice(at, 0, id);
  return { ok: true, draft: { ...d, stations } };
}

export function removeStationAt(d: RouteDraft, index: number): OpResult {
  if (index < 0 || index >= d.stations.length) return { ok: false, reason: "out_of_range" };
  const stations = d.stations.filter((_, i) => i !== index);
  return { ok: true, draft: fixLoop({ ...d, stations }) };
}

/** from の駅を to の位置へ動かす */
export function moveStation(d: RouteDraft, from: number, to: number): OpResult {
  const n = d.stations.length;
  if (from < 0 || from >= n || to < 0 || to >= n) return { ok: false, reason: "out_of_range" };
  if (from === to) return { ok: true, draft: d };
  const stations = [...d.stations];
  const [s] = stations.splice(from, 1);
  stations.splice(to, 0, s);
  return { ok: true, draft: { ...d, stations } };
}

export function setLoop(d: RouteDraft, loop: boolean): OpResult {
  if (loop && d.stations.length < MIN_LOOP_STATIONS) return { ok: false, reason: "too_short" };
  return { ok: true, draft: { ...d, loop } };
}

export function clearStations(d: RouteDraft): RouteDraft {
  return { ...d, stations: [], loop: false };
}

/**
 * 路線名に使えない文字（shared/route の normalizeRouteName が拒否するもの）。入力の時点で取り除く。
 * 制御文字・書式の文字（ゼロ幅接合子など）・行と段落の区切り・私用領域・見えない文字・異体字セレクタ。
 */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}]/gu;
/** 対になっていないサロゲート */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** 路線名を整える: 使えない文字を除き、MAX_NAME_LENGTH 文字（コードポイント）までに切る */
export function clampName(raw: string): string {
  const cleaned = raw.replace(LONE_SURROGATE, "").replace(FORBIDDEN_IN_NAME, "");
  return [...cleaned].slice(0, MAX_NAME_LENGTH).join("");
}

/** 路線記号の入力を整える（全角は半角に、英字以外は除き、大文字にして 2 文字まで） */
export function cleanSymbol(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 2);
}

export function setName(d: RouteDraft, raw: string): RouteDraft {
  return { ...d, name: clampName(raw) };
}

export function setSymbol(d: RouteDraft, raw: string): RouteDraft {
  return { ...d, symbol: cleanSymbol(raw) };
}

export function setLineColor(d: RouteDraft, color: ColorId): RouteDraft {
  return { ...d, lineColor: color };
}

/** 残りの文字数（コードポイント） */
export function nameRemaining(name: string): number {
  return MAX_NAME_LENGTH - [...name].length;
}

/** あと何駅加えられるか */
export function stationsRemaining(d: RouteDraft): number {
  return MAX_STATIONS - d.stations.length;
}
