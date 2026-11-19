// 多角形の塗りつぶし（走査線方式、nonzero の規則、アンチエイリアスなし）。
import type { IndexedImage } from "./image.ts";

/** 点の列（[x0, y0, x1, y1, ...] か [[x, y], ...]）。座標はドット単位 */
export type Ring = ArrayLike<number> | readonly (readonly [number, number])[];

function toFlat(r: Ring): ArrayLike<number> {
  if (r.length > 0 && Array.isArray(r[0])) return (r as readonly (readonly [number, number])[]).flat();
  return r as ArrayLike<number>;
}

/**
 * 多角形群を塗る。各ドットの中心が内側なら塗る。
 * 外周と穴を逆回りにしておけば穴は塗られない。
 */
export function fillPolygons(img: IndexedImage, rings: readonly Ring[], value: number): void {
  const flats = rings.map(toFlat).filter((r) => r.length >= 6);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of flats) {
    for (let i = 1; i < r.length; i += 2) {
      if (r[i] < minY) minY = r[i];
      if (r[i] > maxY) maxY = r[i];
    }
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(img.height - 1, Math.ceil(maxY));
  const xs: number[] = [];
  const dirs: number[] = [];
  const order: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    dirs.length = 0;
    for (const r of flats) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xa = r[j * 2];
        const ya = r[j * 2 + 1];
        const xb = r[i * 2];
        const yb = r[i * 2 + 1];
        if (ya <= sy && yb > sy) {
          xs.push(xa + ((sy - ya) * (xb - xa)) / (yb - ya));
          dirs.push(1);
        } else if (yb <= sy && ya > sy) {
          xs.push(xa + ((sy - ya) * (xb - xa)) / (yb - ya));
          dirs.push(-1);
        }
      }
    }
    order.length = 0;
    for (let k = 0; k < xs.length; k++) order.push(k);
    order.sort((a, b) => xs[a] - xs[b]);
    let w = 0;
    let start = 0;
    for (const k of order) {
      const before = w;
      w += dirs[k];
      if (before === 0 && w !== 0) start = xs[k];
      else if (before !== 0 && w === 0) {
        // ドットの中心（x + 0.5）が区間に入るものを塗る
        const xa = Math.max(0, Math.ceil(start - 0.5));
        const xb = Math.min(img.width, Math.ceil(xs[k] - 0.5));
        if (xb > xa) img.data.fill(value, y * img.width + xa, y * img.width + xb);
      }
    }
  }
}
