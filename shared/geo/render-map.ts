// 地図データをドット絵の画像に描く（DOM に依存しない）。
import { drawLine, fillPolygons, fillRect, type IndexedImage } from "../pix/index.ts";
import type { BBox, LonLatPath, MapData, Station } from "./map-data.ts";

export type MapColors = { land: number; rail: number; river: number; station: number };

/** 表示範囲を、緯度による横の縮みを補正して画像に収めるための変換を作る */
export function makeProjection(view: BBox, width: number, height: number) {
  const midLat = (view[1] + view[3]) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const sx = width / ((view[2] - view[0]) * kx);
  const sy = height / (view[3] - view[1]);
  const s = Math.min(sx, sy);
  // 余白が出る方向は中央に寄せる
  const ox = (width - (view[2] - view[0]) * kx * s) / 2;
  const oy = (height - (view[3] - view[1]) * s) / 2;
  return (lon: number, lat: number): [number, number] => [ox + (lon - view[0]) * kx * s, oy + (view[3] - lat) * s];
}

/** 表示範囲の縦横比（幅 / 高さ） */
export function viewAspect(view: BBox): number {
  const midLat = (view[1] + view[3]) / 2;
  return ((view[2] - view[0]) * Math.cos((midLat * Math.PI) / 180)) / (view[3] - view[1]);
}

function project(path: LonLatPath, proj: (lon: number, lat: number) => [number, number]): Float64Array {
  const out = new Float64Array(path.length);
  for (let i = 0; i < path.length; i += 2) {
    const [x, y] = proj(path[i], path[i + 1]);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/** 陸地・川・線路・駅の点を描く。地の色（海）は img をあらかじめ塗っておく */
export function renderMap(
  img: IndexedImage,
  map: MapData,
  stations: readonly Station[],
  view: BBox,
  colors: MapColors,
  stationSize = 1,
): void {
  const proj = makeProjection(view, img.width, img.height);
  fillPolygons(img, map.land.map((r) => project(r, proj)), colors.land);
  const stroke = (paths: LonLatPath[], c: number) => {
    for (const p of paths) {
      const q = project(p, proj);
      for (let i = 2; i < q.length; i += 2) drawLine(img, q[i - 2], q[i - 1], q[i], q[i + 1], c);
    }
  };
  stroke(map.rivers, colors.river);
  stroke(map.rails, colors.rail);
  const h = stationSize >> 1;
  for (const s of stations) {
    const [x, y] = proj(s.lon, s.lat);
    fillRect(img, Math.floor(x) - h, Math.floor(y) - h, stationSize, stationSize, colors.station);
  }
}
