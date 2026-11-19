// 駅データとフォントから、駅の引き当てとフォントを作る（モジュールの読み込み時に1回だけ）。
import { parseBitmapFont } from "../../shared/font/index.ts";
import { parseStations, type StationsFile } from "../../shared/geo/map-data.ts";
import type { StationLookup } from "../../shared/route/index.ts";
import type { Resources } from "./types.ts";

export function createResources(stations: StationsFile, fontBytes: ArrayBuffer | Uint8Array): Resources {
  const file = parseStations(stations);
  const map = new Map<string, { name: string; lat: number; lon: number }>();
  for (const s of file.stations) map.set(s.id, { name: s.name, lat: s.lat, lon: s.lon });
  const lookup: StationLookup = (id) => map.get(id);
  return { lookup, font: parseBitmapFont(fontBytes) };
}
