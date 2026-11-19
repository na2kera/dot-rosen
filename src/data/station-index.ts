// 駅データを引きやすくまとめたものと、駅名の検索。DOM に依存しない。
import { PREF_NAMES, type Station, type StationsFile } from "../../shared/geo/map-data.ts";
import type { StationLookup } from "../../shared/route/index.ts";

export type StationIndex = {
  readonly stations: readonly Station[];
  readonly byId: ReadonlyMap<string, Station>;
  /** stations の並びでの番号 */
  readonly indexOf: ReadonlyMap<string, number>;
  readonly lookup: StationLookup;
  /** 駅に乗り入れる路線の名前 */
  lineNames(s: Station): string[];
  /** 同じ名前の別の駅があるか */
  hasNamesake(s: Station): boolean;
};

export function buildStationIndex(file: StationsFile): StationIndex {
  const byId = new Map<string, Station>();
  const indexOf = new Map<string, number>();
  const nameCount = new Map<string, number>();
  file.stations.forEach((s, i) => {
    byId.set(s.id, s);
    indexOf.set(s.id, i);
    nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
  });
  return {
    stations: file.stations,
    byId,
    indexOf,
    lookup: (id) => byId.get(id),
    lineNames: (s) => s.lines.map((l) => file.lines[l]?.name ?? "").filter((n) => n !== ""),
    hasNamesake: (s) => (nameCount.get(s.name) ?? 0) > 1,
  };
}

/** カタカナをひらがなに（検索のときだけ使う） */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 検索用に整える（全角・半角をそろえ、カタカナはひらがなに、ヶとケをそろえる） */
export function normalizeForSearch(s: string): string {
  return toHiragana(
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[ヶヵケ]/g, "け")
      .replace(/[ノ之]/g, "の"),
  );
}

export type SearchHit = { readonly station: Station; /** 候補に添える説明（路線名、同名なら都県） */ readonly detail: string };

/**
 * 駅名の部分一致で探す（漢字・かな。読みがなは無いので駅名の文字だけ）。
 * 前方一致を先に、次に短い名前、乗り入れ路線の多い駅の順。
 */
export function searchStations(index: StationIndex, query: string, limit = 30): SearchHit[] {
  const q = normalizeForSearch(query);
  if (q === "") return [];
  const hits: { s: Station; rank: number }[] = [];
  for (const s of index.stations) {
    const n = normalizeForSearch(s.name);
    const at = n.indexOf(q);
    if (at < 0) continue;
    const rank = (n === q ? 0 : at === 0 ? 1 : 2) * 1000 + n.length * 10 - Math.min(9, s.lines.length);
    hits.push({ s, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.s.name.localeCompare(b.s.name, "ja"));
  return hits.slice(0, limit).map(({ s }) => ({ station: s, detail: stationDetail(index, s) }));
}

/** 「山手線・中央線 ほか2」のような説明。同名の駅があるときは都県名を前に付ける */
export function stationDetail(index: StationIndex, s: Station, maxLines = 2): string {
  const names = [...new Set(index.lineNames(s))];
  let text = names.slice(0, maxLines).join("・");
  if (names.length > maxLines) text += ` ほか${names.length - maxLines}`;
  if (index.hasNamesake(s)) text = `${PREF_NAMES[s.pref]} ${text}`;
  return text;
}
