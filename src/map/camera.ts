// 地図の視点（中心と拡大度）と、画面との座標の変換。DOM に依存しない。
//
// 中心 (cx, cy) は世界座標（world.ts）。z は 1 度あたりの地図のドット数。
// 地図のドットは画面上で dotPx（CSS px）の大きさになる。
import { toWorldX, toWorldY } from "./world.ts";

export type Camera = { readonly cx: number; readonly cy: number; readonly z: number };

/** 地図の範囲（世界座標）と拡大度の上下限 */
export type CameraLimits = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
};

/** 画面（地図の部分）の大きさを地図のドットで表したもの */
export type Viewport = { readonly w: number; readonly h: number };

export function clampCamera(c: Camera, lim: CameraLimits): Camera {
  const z = Math.min(lim.maxZ, Math.max(lim.minZ, c.z));
  return { cx: Math.min(lim.maxX, Math.max(lim.minX, c.cx)), cy: Math.min(lim.maxY, Math.max(lim.minY, c.cy)), z };
}

/** 画像の左上に来る「世界座標 × z」の整数の値（整数にそろえるので、移動しても線の形が変わらない） */
export function originOf(c: Camera, vp: Viewport): { ox: number; oy: number } {
  return { ox: Math.floor(c.cx * c.z - vp.w / 2), oy: Math.floor(c.cy * c.z - vp.h / 2) };
}

/** 世界座標 → 地図のドット（画像の左上が 0） */
export function worldToDot(c: Camera, vp: Viewport, x: number, y: number): [number, number] {
  const { ox, oy } = originOf(c, vp);
  return [x * c.z - ox, y * c.z - oy];
}

/** 地図のドット → 世界座標 */
export function dotToWorld(c: Camera, vp: Viewport, dx: number, dy: number): [number, number] {
  const { ox, oy } = originOf(c, vp);
  return [(dx + ox) / c.z, (dy + oy) / c.z];
}

/** ドット単位で動かす（指の向きと同じ向きに地図が動く） */
export function panBy(c: Camera, ddx: number, ddy: number): Camera {
  return { cx: c.cx - ddx / c.z, cy: c.cy - ddy / c.z, z: c.z };
}

/** 画面上の点 (dx, dy)（ドット）を動かさずに、拡大度を z に変える */
export function zoomAround(c: Camera, vp: Viewport, z: number, dx: number, dy: number): Camera {
  // 原点の切り捨ての影響を除くため、切り捨て前の式で考える
  const wx = c.cx + (dx - vp.w / 2) / c.z;
  const wy = c.cy + (dy - vp.h / 2) / c.z;
  return { cx: wx - (dx - vp.w / 2) / z, cy: wy - (dy - vp.h / 2) / z, z };
}

/** 経度・緯度の範囲がちょうど入る拡大度 */
export function fitZ(vp: Viewport, minLon: number, minLat: number, maxLon: number, maxLat: number): number {
  const w = toWorldX(maxLon) - toWorldX(minLon);
  const h = toWorldY(minLat) - toWorldY(maxLat);
  return Math.min(vp.w / w, vp.h / h);
}

/** 2つの視点の間（t = 0〜1）。拡大度は対数で補間する */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const z = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * t);
  return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, z };
}
