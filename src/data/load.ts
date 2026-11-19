// 画面に要るデータ（駅、地図、フォント）の読み込み。
import { decodeMap, MAP_PATH, parseStations, STATIONS_PATH, type MapData, type MapFile, type StationsFile } from "../../shared/geo/map-data.ts";
import { buildWorld, type MapWorld } from "../map/world.ts";
import { buildStationIndex, type StationIndex } from "./station-index.ts";

export type AppData = {
  readonly stationsFile: StationsFile;
  readonly index: StationIndex;
  readonly map: MapData;
  readonly world: MapWorld;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function loadFont(): Promise<void> {
  await Promise.all([document.fonts.load('16px "DotGothic16"'), document.fonts.load('32px "DotGothic16"')]);
  if (!document.fonts.check('16px "DotGothic16"')) throw new Error("font");
}

/** 3つを並べて読み、1つ終わるごとに onProgress(0〜1) を呼ぶ */
export async function loadAppData(onProgress: (p: number) => void): Promise<AppData> {
  let done = 0;
  const step = <T,>(p: Promise<T>) =>
    p.then((v) => {
      done++;
      onProgress(done / 4);
      return v;
    });
  const [stationsFile, mapFile] = await Promise.all([
    step(fetchJson<StationsFile>(STATIONS_PATH).then(parseStations)),
    step(fetchJson<MapFile>(MAP_PATH)),
    step(loadFont()),
  ]);
  const map = decodeMap(mapFile);
  const world = buildWorld(map, stationsFile.stations);
  onProgress(1);
  return { stationsFile, index: buildStationIndex(stationsFile), map, world };
}
