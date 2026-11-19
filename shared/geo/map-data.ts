// 駅データと地図データ（public/data/ 以下）の型と読み込み。
// tools/build-stations.ts が作り、画面と Worker が読む。

/** 都県コード（JIS X 0401）。11 埼玉、12 千葉、13 東京、14 神奈川 */
export type PrefCode = 11 | 12 | 13 | 14;

export const PREF_NAMES: Record<PrefCode, string> = {
  11: "埼玉県",
  12: "千葉県",
  13: "東京都",
  14: "神奈川県",
};

export type LineInfo = {
  /** 路線名（例: 山手線） */
  name: string;
  /** 運営会社（例: 東日本旅客鉄道） */
  operator: string;
};

export type Station = {
  /** 作り直しても変わりにくい ID（"s" + 統合した駅の中で最小のグループコード） */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** StationsFile.lines の番号 */
  lines: number[];
  pref: PrefCode;
};

/** public/data/stations.json */
export type StationsFile = {
  v: 1;
  lines: LineInfo[];
  stations: Station[];
};

/** [最小経度, 最小緯度, 最大経度, 最大緯度] */
export type BBox = readonly [number, number, number, number];

/**
 * public/data/map.json
 * 各線は整数の配列 [x0, y0, dx1, dy1, dx2, dy2, ...]。
 * x = round((経度 - bbox[0]) * q)、y = round((緯度 - bbox[1]) * q)。2点目以降は前の点との差。
 */
export type MapFile = {
  v: 1;
  bbox: BBox;
  q: number;
  /** 陸地の輪郭（閉じた多角形。内側の穴は逆回り。nonzero で塗る） */
  land: number[][];
  /** 実在路線の線路 */
  rails: number[][];
  /** 大きな川（無ければ空） */
  rivers: number[][];
};

/** 経度・緯度を交互に並べた配列 [経度0, 緯度0, 経度1, 緯度1, ...] */
export type LonLatPath = Float64Array;

export type MapData = {
  bbox: BBox;
  land: LonLatPath[];
  rails: LonLatPath[];
  rivers: LonLatPath[];
};

export const STATIONS_PATH = "/data/stations.json";
export const MAP_PATH = "/data/map.json";

/** 経度・緯度の列を整数の差分に変換する（tools 用）。連続する同じ点は省く。 */
export function encodePath(coords: readonly (readonly [number, number])[], bbox: BBox, q: number): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < coords.length; i++) {
    const x = Math.round((coords[i][0] - bbox[0]) * q);
    const y = Math.round((coords[i][1] - bbox[1]) * q);
    if (out.length === 0) out.push(x, y);
    else if (x !== px || y !== py) out.push(x - px, y - py);
    else continue;
    px = x;
    py = y;
  }
  return out;
}

export function decodePath(enc: readonly number[], bbox: BBox, q: number): LonLatPath {
  const out = new Float64Array(enc.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < enc.length; i += 2) {
    x += enc[i];
    y += enc[i + 1];
    out[i] = bbox[0] + x / q;
    out[i + 1] = bbox[1] + y / q;
  }
  return out;
}

export function decodeMap(file: MapFile): MapData {
  if (file.v !== 1) throw new Error("地図データの版が違います");
  const dec = (paths: number[][]) => paths.map((p) => decodePath(p, file.bbox, file.q));
  return { bbox: file.bbox, land: dec(file.land), rails: dec(file.rails), rivers: dec(file.rivers) };
}

export function parseStations(file: StationsFile): StationsFile {
  if (file.v !== 1) throw new Error("駅データの版が違います");
  return file;
}
