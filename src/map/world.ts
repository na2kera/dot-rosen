// 地図データを「世界座標」に直し、描画しやすい形（範囲つきの小分け、拡大度ごとの間引き）にまとめる。
// DOM にも React にも依存しない（テストから読む）。
//
// 世界座標: X = 経度 × KX、Y = −緯度（単位は度）。KX は緯度による横の縮みの補正（首都圏の中ほどで固定）。
// 画面のドット = 世界座標 × z（z は 1 度あたりのドット数）。
import type { LonLatPath, MapData, Station } from "../../shared/geo/map-data.ts";

export const KX = Math.cos((35.6 * Math.PI) / 180);

export const toWorldX = (lon: number) => lon * KX;
export const toWorldY = (lat: number) => -lat;
export const toLon = (x: number) => x / KX;
export const toLat = (y: number) => -y;

/** 点の列（世界座標 [X0, Y0, X1, Y1, ...]）と、その範囲 */
export type Shape = {
  readonly pts: Float64Array;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** 間引きの段階。z がこの値以下のときに使う（最後の段階は間引かない） */
export type Lod = {
  /** この段階を使う z の上限 */
  readonly maxZ: number;
  /** 陸地の輪郭（閉じた多角形） */
  readonly land: readonly Shape[];
  /** 線路（小分けにしたもの） */
  readonly rails: readonly Shape[];
  readonly rivers: readonly Shape[];
};

export type MapWorld = {
  readonly lods: readonly Lod[];
  /** 地図データのある範囲（世界座標）。外は「地図の外」として描く */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  /** 駅の世界座標（stations と同じ順） */
  readonly stationX: Float64Array;
  readonly stationY: Float64Array;
};

function shapeOf(pts: Float64Array): Shape {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { pts, minX, minY, maxX, maxY };
}

function toWorld(path: LonLatPath): Float64Array {
  const out = new Float64Array(path.length);
  for (let i = 0; i < path.length; i += 2) {
    out[i] = toWorldX(path[i]);
    out[i + 1] = toWorldY(path[i + 1]);
  }
  return out;
}

/** ダグラス・ポイカーの方法で間引く（tol は世界座標の距離）。両端は残す */
export function simplify(pts: Float64Array, tol: number): Float64Array {
  const n = pts.length / 2;
  if (n <= 2 || tol <= 0) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length > 0) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const dx = pts[b * 2] - ax;
    const dy = pts[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax;
      const py = pts[i * 2 + 1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const cross = px * dy - py * dx;
        d2 = (cross * cross) / len2;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  let m = 0;
  for (let i = 0; i < n; i++) if (keep[i]) m++;
  const out = new Float64Array(m * 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    out[k++] = pts[i * 2];
    out[k++] = pts[i * 2 + 1];
  }
  return out;
}

/** 線を最大 size 点ずつに小分けにする（隣どうしは端の点を共有する） */
function chunk(pts: Float64Array, size: number): Float64Array[] {
  const n = pts.length / 2;
  if (n <= size) return [pts];
  const out: Float64Array[] = [];
  for (let s = 0; s < n - 1; s += size - 1) {
    const e = Math.min(n, s + size);
    out.push(pts.slice(s * 2, e * 2));
  }
  return out;
}

/** 間引きの段階の z（1 度あたりのドット数）。間引きの許容誤差はその z で 0.5 ドット */
const LOD_ZS = [150, 400, 1100, 3000, 8000];
const CHUNK = 48;

export function buildWorld(map: MapData, stations: readonly Station[]): MapWorld {
  const land = map.land.map(toWorld);
  const rails = map.rails.map(toWorld);
  const rivers = map.rivers.map(toWorld);
  const lods: Lod[] = [];
  const make = (tol: number, maxZ: number): Lod => ({
    maxZ,
    land: land.map((r) => shapeOf(simplify(r, tol))).filter((s) => s.pts.length >= 6),
    rails: rails.flatMap((p) => chunk(simplify(p, tol), CHUNK).map(shapeOf)),
    rivers: rivers.flatMap((p) => chunk(simplify(p, tol), CHUNK).map(shapeOf)),
  });
  for (const z of LOD_ZS) lods.push(make(0.5 / z, z));
  lods.push(make(0, Infinity));
  const stationX = new Float64Array(stations.length);
  const stationY = new Float64Array(stations.length);
  stations.forEach((s, i) => {
    stationX[i] = toWorldX(s.lon);
    stationY[i] = toWorldY(s.lat);
  });
  const b = map.bbox;
  const bounds = { minX: toWorldX(b[0]), maxX: toWorldX(b[2]), minY: toWorldY(b[3]), maxY: toWorldY(b[1]) };
  return { lods, bounds, stationX, stationY };
}

export function lodFor(world: MapWorld, z: number): Lod {
  for (const l of world.lods) if (z <= l.maxZ) return l;
  return world.lods[world.lods.length - 1];
}
