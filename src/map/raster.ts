// 地図の静的な層（海・陸・川・線路・駅の点）をドット絵に描く。DOM に依存しない。
// 線と塗りは shared/pix を使い、アンチエイリアスはしない。
import { drawLine, fillPolygons, fillRect, type IndexedImage } from "../../shared/pix/index.ts";
import { lodFor, type MapWorld, type Shape } from "./world.ts";

/** 地図の色番号 */
export const MC = {
  SEA: 0,
  LAND: 1,
  RAIL: 2,
  RIVER: 3,
  STATION: 4,
  STATION_IN: 5,
  WAVE: 6,
  INK: 7,
  MARK: 8,
  LINE: 9,
  FOCUS: 10,
  LINE_LIGHT: 11,
  OUT: 12,
  OUT_DOT: 13,
} as const;

/**
 * 描く範囲。ox, oy は画像の左上に来る「世界座標 × z」の整数の値。
 * 世界座標 (X, Y) の点は画像の (X × z − ox, Y × z − oy) に来る。
 */
export type RasterView = { readonly ox: number; readonly oy: number; readonly z: number };

/** 駅の点の描き方（z によって変える） */
export function stationDotSize(z: number): 0 | 1 | 2 | 3 {
  if (z < 380) return 0;
  if (z < 700) return 1;
  if (z < 2200) return 2;
  return 3;
}

/**
 * 閉じた多角形を矩形で切り取る（サザーランド・ホッジマンの方法）。
 * 矩形の内側の点に対する回転数は変わらないので、nonzero の塗りの結果は矩形の内側で同じになる。
 */
export function clipRing(pts: ArrayLike<number>, x0: number, y0: number, x1: number, y1: number): number[] {
  let cur: number[] = Array.from(pts);
  const edges: [number, number, boolean][] = [
    [0, x0, true],
    [0, x1, false],
    [1, y0, true],
    [1, y1, false],
  ];
  for (const [axis, v, isMin] of edges) {
    const n = cur.length / 2;
    if (n === 0) break;
    const out: number[] = [];
    const inside = (i: number) => (isMin ? cur[i * 2 + axis] >= v : cur[i * 2 + axis] <= v);
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n;
      const iin = inside(i);
      const jin = inside(j);
      if (iin !== jin) {
        const ax = cur[j * 2];
        const ay = cur[j * 2 + 1];
        const bx = cur[i * 2];
        const by = cur[i * 2 + 1];
        const a = axis === 0 ? ax : ay;
        const b = axis === 0 ? bx : by;
        const t = (v - a) / (b - a);
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
      if (iin) out.push(cur[i * 2], cur[i * 2 + 1]);
    }
    cur = out;
  }
  return cur;
}

function visible(s: Shape, view: RasterView, w: number, h: number, pad: number): boolean {
  const z = view.z;
  return !(s.maxX * z - view.ox < -pad || s.minX * z - view.ox > w + pad || s.maxY * z - view.oy < -pad || s.minY * z - view.oy > h + pad);
}

function project(pts: Float64Array, view: RasterView): number[] {
  const out: number[] = [];
  const z = view.z;
  let px = NaN;
  let py = NaN;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] * z - view.ox;
    const y = pts[i + 1] * z - view.oy;
    if (x === px && y === py) continue;
    out.push(x, y);
    px = x;
    py = y;
  }
  return out;
}

function strokeShapes(img: IndexedImage, shapes: readonly Shape[], view: RasterView, color: number): void {
  const z = view.z;
  for (const s of shapes) {
    if (!visible(s, view, img.width, img.height, 2)) continue;
    const p = s.pts;
    let ax = Math.round(p[0] * z - view.ox);
    let ay = Math.round(p[1] * z - view.oy);
    for (let i = 2; i < p.length; i += 2) {
      const bx = Math.round(p[i] * z - view.ox);
      const by = Math.round(p[i + 1] * z - view.oy);
      if (bx !== ax || by !== ay) drawLine(img, ax, ay, bx, by, color);
      ax = bx;
      ay = by;
    }
  }
}

export type StaticOptions = {
  /** 海に波の模様を入れる（既定 true） */
  waves?: boolean;
  /** 陸地を矩形で切り取ってから塗る（既定 true。false は確かめ用の素朴な描き方） */
  clip?: boolean;
};

/** 海・陸・川・線路・駅の点を描く */
export function renderStatic(img: IndexedImage, world: MapWorld, view: RasterView, opts: StaticOptions = {}): void {
  const { width: w, height: h } = img;
  img.data.fill(MC.SEA);
  const lod = lodFor(world, view.z);
  const rings: number[][] = [];
  for (const s of lod.land) {
    if (!visible(s, view, w, h, 1)) continue;
    const p = project(s.pts, view);
    rings.push(opts.clip === false ? p : clipRing(p, -1, -1, w + 1, h + 1));
  }
  fillPolygons(img, rings, MC.LAND);
  if (opts.waves !== false) drawWaves(img, view);
  drawOutside(img, world, view);
  strokeShapes(img, lod.rivers, view, MC.RIVER);
  strokeShapes(img, lod.rails, view, MC.RAIL);
  drawStationDots(img, world, view);
}

/** 海の波の模様（世界に固定した格子に短い線を置く。移動しても模様がずれない） */
function drawWaves(img: IndexedImage, view: RasterView): void {
  const { width: w, height: h, data } = img;
  const PX = 24;
  const PY = 12;
  for (let y = 0; y < h; y++) {
    const wy = y + view.oy;
    const ry = ((wy % PY) + PY) % PY;
    if (ry !== 0 && ry !== 1) continue;
    // 1行おきに半周期ずらす
    const shift = Math.floor(wy / PY) & 1 ? PX / 2 : 0;
    for (let x = 0; x < w; x++) {
      const wx = x + view.ox + shift;
      const rx = ((wx % PX) + PX) % PX;
      // 「‾‾__‾‾」のような小さな波
      const on = ry === 0 ? rx === 1 || rx === 2 : rx === 0 || rx === 3;
      if (on && data[y * w + x] === MC.SEA) data[y * w + x] = MC.WAVE;
    }
  }
}

/** 地図データの範囲の外（点の模様）。陸地が範囲の端でまっすぐ切れているのを、海岸に見せないため */
function drawOutside(img: IndexedImage, world: MapWorld, view: RasterView): void {
  const { width: w, height: h, data } = img;
  const b = world.bounds;
  const x0 = Math.ceil(b.minX * view.z - view.ox);
  const x1 = Math.floor(b.maxX * view.z - view.ox);
  const y0 = Math.ceil(b.minY * view.z - view.oy);
  const y1 = Math.floor(b.maxY * view.z - view.oy);
  if (x0 <= 0 && y0 <= 0 && x1 >= w && y1 >= h) return;
  for (let y = 0; y < h; y++) {
    const wy = y + view.oy;
    const rowOut = y < y0 || y >= y1;
    for (let x = 0; x < w; x++) {
      if (!rowOut && x >= x0 && x < x1) {
        x = x1 - 1;
        continue;
      }
      const wx = x + view.ox;
      data[y * w + x] = (wy & 3) === 0 && (wx & 3) === ((wy >> 2) & 1) * 2 ? MC.OUT_DOT : MC.OUT;
    }
  }
}

function drawStationDots(img: IndexedImage, world: MapWorld, view: RasterView): void {
  const z = view.z;
  const size = stationDotSize(z);
  if (size === 0) return;
  const { stationX: xs, stationY: ys } = world;
  const w = img.width;
  const h = img.height;
  for (let i = 0; i < xs.length; i++) {
    const x = Math.floor(xs[i] * z - view.ox);
    const y = Math.floor(ys[i] * z - view.oy);
    if (x < -2 || y < -2 || x > w + 1 || y > h + 1) continue;
    if (size === 1) fillRect(img, x, y, 1, 1, MC.STATION);
    else if (size === 2) fillRect(img, x, y, 2, 2, MC.STATION);
    else {
      fillRect(img, x - 1, y - 1, 3, 3, MC.STATION);
      fillRect(img, x, y, 1, 1, MC.STATION_IN);
    }
  }
}
