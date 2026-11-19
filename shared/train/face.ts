// 正面の顔（64×76）。v2 の見本の face() を、どの組み合わせでも部品がぶつからないように配置し直したもの。
// 配置は faceLayout() で矩形として求め、描画とテストの両方がそれを使う。
import { createIndexed, type IndexedImage } from "../pix/image.ts";
import {
  C_EDGE_METAL,
  C_FRAME,
  C_INK,
  C_INTERIOR,
  C_METAL,
  C_METAL_DARK,
  C_METAL_LIGHT,
  C_STRIPE_BLACK,
  C_TAIL,
  C_WHITE,
  tones,
} from "./colors.ts";
import type { FaceDesign, TrainDesign } from "./design.ts";
import { box, dot, drawTrack, glass, lamp, ledSign, line, markSeams, panto, poly, rect } from "./draw.ts";
import { near, rectOf, subtractSpan, type Rect } from "./geometry.ts";
import { pantographCars } from "./consist-rules.ts";

export const FACE_W = 64;
export const FACE_H = 76;
/** 車体の上端・下端の行 */
export const FACE_BODY_TOP = 14;
export const FACE_BODY_BOTTOM = 61;
/** 線路のレールの行 */
export const FACE_RAIL_Y = 70;
const BODY_L = 9;
const BODY_R = 54;

/** 輪郭ごとの、上端からの行ごとの内側への食い込み（v2 の式を整数の表にしたもの） */
const CONTOUR_INSET: Record<FaceDesign["contour"], readonly number[]> = {
  square: [2, 1],
  round: [5, 3, 2, 2, 1, 1],
  taper: [6, 6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1],
  dome: [10, 7, 6, 4, 3, 3, 2, 1, 1],
};

export type FaceLayout = {
  /** 各行の車体の左端・右端（車体の無い行は -1） */
  bodyLeft: Int16Array;
  bodyRight: Int16Array;
  /** 前面窓のガラス（扉と重なる部分は除いたもの） */
  windows: Rect[];
  windowRound: number;
  door: Rect | null;
  doorGlass: Rect | null;
  /** 前照灯（左、右）。白い余白の内側の大きさ */
  lamps: Rect[];
  lampRound: boolean;
  /** 尾灯（白い縁を含む 3×3）。無いときは空 */
  tails: Rect[];
  sign: Rect | null;
  /** ワイパーの根元 */
  wipers: { x: number; y: number }[];
  /** 手すりの x（行 43〜55） */
  handrails: number[];
  plate: Rect | null;
  hatch: Rect | null;
  panto: boolean;
};

function bodySpans(contour: FaceDesign["contour"]): { left: Int16Array; right: Int16Array } {
  const left = new Int16Array(FACE_H).fill(-1);
  const right = new Int16Array(FACE_H).fill(-1);
  const table = CONTOUR_INSET[contour];
  for (let y = FACE_BODY_TOP; y <= FACE_BODY_BOTTOM; y++) {
    const r = y - FACE_BODY_TOP;
    const n = Math.max(r < table.length ? table[r] : 0, y > 58 ? (y - 58) >> 1 : 0);
    left[y] = BODY_L + n;
    right[y] = BODY_R - n;
  }
  return { left, right };
}

/** 輪郭の線を除いた、車体の内側か（上下左右がすべて車体の点） */
function interiorChecker(left: Int16Array, right: Int16Array) {
  return (r: Rect): boolean => {
    for (let y = r.y; y < r.y + r.h; y++) {
      if (y - 1 < 0 || y + 1 >= FACE_H || left[y - 1] < 0 || left[y + 1] < 0 || left[y] < 0) return false;
      const l = Math.max(left[y - 1], left[y], left[y + 1]) + 1;
      const rr = Math.min(right[y - 1], right[y], right[y + 1]) - 1;
      if (r.x < l || r.x + r.w - 1 > rr) return false;
    }
    return true;
  };
}

/** 左右反転した矩形（顔の中心 x=31.5 で折り返す） */
const mirror = (r: Rect): Rect => ({ x: FACE_W - r.x - r.w, y: r.y, w: r.w, h: r.h });

type TailArrangement = "beside" | "below" | "above" | "none";

/**
 * 顔の配置。ライトが左右に置けない組み合わせは見つかっていないが、万一置けなければ
 * ライトの位置を「窓の下の両脇」「腰の低い位置」の順に替えて置く。
 */
export function faceLayout(design: TrainDesign): FaceLayout {
  const first = buildFaceLayout(design, design.face.lightPos);
  if (first.lamps.length === 2) return first;
  for (const pos of ["mid", "low", "top"] as const) {
    const L = buildFaceLayout(design, pos);
    if (L.lamps.length === 2) return L;
  }
  return first;
}

function buildFaceLayout(design: TrainDesign, lightPos: FaceDesign["lightPos"]): FaceLayout {
  const f = { ...design.face, lightPos };
  const { left, right } = bodySpans(f.contour);
  const inside = interiorChecker(left, right);
  const top = f.lightPos === "top";

  // ---- 前面窓 ----
  // ライトが窓の上のときは、窓を下げて灯具の白い余白との間を1ドット空ける
  const winY = top ? 27 : 24;
  const winH = top ? 13 : 16;
  const base: [number, number, number, number][] = {
    one: [[15, winY, 34, winH]],
    two: [
      [14, winY, 17, winH],
      [33, winY, 17, winH],
    ],
    three: [
      [14, winY, 10, winH],
      [26, winY, 12, winH],
      [40, winY, 10, winH],
    ],
    // 扉があるときは扉で2つに分かれるので、外側へ広げる
    pano: f.door === "none" ? [[17, winY, 30, winH]] : [[14, winY, 36, winH]],
    small: [
      [16, winY + (top ? 1 : 2), 12, winH - (top ? 2 : 3)],
      [36, winY + (top ? 1 : 2), 12, winH - (top ? 2 : 3)],
    ],
  }[f.window] as [number, number, number, number][];
  const windowRound = f.window === "pano" ? (f.door === "none" ? 3 : 2) : 1;

  // ---- 貫通扉 ----
  let door: Rect | null = null;
  let doorGlass: Rect | null = null;
  if (f.door !== "none") {
    const dw = f.door === "center" ? 12 : 10;
    const dx = f.door === "center" ? 26 : 34;
    // ライトが窓の上のときは、扉の上端をライトの下まで下げる
    const dy = top ? 26 : 21;
    door = rectOf(dx, dy, dw, 61 - dy);
    doorGlass = rectOf(dx + 2, winY + 1, dw - 4, winH - 1);
  }
  // 扉の左右1ドットは柱として残し、窓を切る
  const windows: Rect[] = [];
  for (const [x, y, w, h] of base) {
    const spans = door ? subtractSpan(x, x + w - 1, door.x - 1, door.x + door.w) : [[x, x + w - 1] as [number, number]];
    for (const [a, b] of spans) if (b - a + 1 >= 6) windows.push(rectOf(a, y, b - a + 1, h));
  }
  // 片側寄せの扉の外側に、細い窓を1枚入れる（何もない車体の柱が広く残らないように）
  if (door && f.door === "side") {
    const [bx, by, bw, bh] = base[base.length - 1];
    const x0 = door.x + door.w + 1;
    if (bx + bw - 1 > door.x + door.w && !windows.some((w) => w.x >= x0)) {
      for (const w of [6, 5]) {
        const r = rectOf(x0, by, w, bh);
        if (inside(rectOf(r.x, r.y, r.w + 1, r.h))) {
          windows.push(r);
          break;
        }
      }
    }
  }

  // ---- 行先表示（上部）の場所を先に取っておく ----
  const reservedSign = f.sign === "top" && top ? rectOf(26, 19, 12, 5) : null;

  // ---- 前照灯と尾灯 ----
  const obstacles: Rect[] = [...windows];
  if (door) obstacles.push(door);
  if (reservedSign) obstacles.push(reservedSign);
  // 屋根（19 行より上）には灯具を置かない
  const free = (r: Rect, gap: number) => r.y >= 19 && inside(r) && !obstacles.some((o) => near(r, o, gap));

  const shapes: [number, number][] = f.lightShape === "led" ? [[10, 3], [8, 3], [6, 3]] : [[6, 5], [5, 4]];
  const pref = f.lightShape === "led" ? 13 : 14;
  let lamps: Rect[] = [];
  let tails: Rect[] = [];
  search: for (const [lw, lh] of shapes) {
    const ly = top ? 22 - (lh >> 1) : f.lightPos === "mid" ? 49 : 54;
    for (const arr of ["beside", "below", "above", "none"] as TailArrangement[]) {
      const group = (x: number): { lamp: Rect; tail: Rect | null } => {
        const lampR = rectOf(x, ly, lw, lh);
        const ty = ly + ((lh - 3) >> 1);
        const tail =
          arr === "beside"
            ? rectOf(x + lw + 2, ty, 3, 3)
            : arr === "below"
              ? rectOf(x + ((lw - 3) >> 1), ly + lh + 1, 3, 3)
              : arr === "above"
                ? rectOf(x + ((lw - 3) >> 1), ly - 4, 3, 3)
                : null;
        return { lamp: lampR, tail };
      };
      const fits = (g: { lamp: Rect; tail: Rect | null }) =>
        free(rectOf(g.lamp.x - 1, g.lamp.y - 1, g.lamp.w + 2, g.lamp.h + 2), 1) && (!g.tail || free(g.tail, 1));
      // 外側から内側へ、好みの位置に近い順に試す
      const cands: number[] = [pref];
      for (let d = 1; d <= 6; d++) cands.push(pref - d, pref + d);
      let leftG: { lamp: Rect; tail: Rect | null } | null = null;
      let rightG: { lamp: Rect; tail: Rect | null } | null = null;
      for (const x of cands) {
        const g = group(x);
        if (fits(g)) {
          leftG = g;
          break;
        }
      }
      for (const x of cands) {
        const g = group(x);
        const m = { lamp: mirror(g.lamp), tail: g.tail ? mirror(g.tail) : null };
        if (fits(m)) {
          rightG = m;
          break;
        }
      }
      if (leftG && rightG) {
        lamps = [leftG.lamp, rightG.lamp];
        tails = leftG.tail && rightG.tail ? [leftG.tail, rightG.tail] : [];
        break search;
      }
    }
  }
  const lampRims = lamps.map((l) => rectOf(l.x - 1, l.y - 1, l.w + 2, l.h + 2));
  const lightParts = [...lampRims, ...tails];

  // ---- 行先表示 ----
  let sign: Rect | null = null;
  if (f.sign === "top") {
    if (top && lamps.length === 2) {
      const a = Math.max(...lightParts.filter((r) => r.x < 32).map((r) => r.x + r.w)) + 2;
      const b = Math.min(...lightParts.filter((r) => r.x >= 32).map((r) => r.x)) - 3;
      const w = Math.min(18, b - a + 1);
      if (w >= 8) sign = rectOf(32 - (w >> 1), 19, w, 5);
    } else {
      sign = rectOf(23, 19, 18, 5);
    }
  } else if (f.sign === "inwin" && windows.length > 0) {
    const center = windows.find((w) => w.x <= 31 && w.x + w.w - 1 >= 32);
    const piece = center ?? windows.reduce((a, b) => (b.w > a.w ? b : a));
    const w = Math.min(17, piece.w - (piece.w >= 21 ? 4 : 2));
    if (w >= 8) sign = rectOf(piece.x + ((piece.w - w) >> 1), piece.y + 1, w, 5);
    // 窓が細すぎるときは、扉の窓の中に入れる
    else if (doorGlass && doorGlass.w >= 6) sign = rectOf(doorGlass.x, doorGlass.y + 1, doorGlass.w, 5);
  }

  // ---- ワイパー（左右それぞれ、いちばん広い窓に1本） ----
  const wipers: { x: number; y: number }[] = [];
  for (const half of ["left", "right"] as const) {
    const pieces = windows.filter((w) => (w.x + w.w / 2 < 32) === (half === "left") && w.w >= 9);
    if (pieces.length === 0) continue;
    const p = pieces.reduce((a, b) => (b.w > a.w ? b : a));
    const x = half === "left" ? p.x + 4 : p.x + p.w - 8;
    wipers.push({ x, y: p.y + p.h - 2 });
  }

  // ---- 手すり（扉の両脇。ライトとぶつかるなら付けない） ----
  const handrails: number[] = [];
  if (door) {
    // 尾灯とは重なってよい（v2 と同じく、尾灯が手すりの上に描かれる）
    const others = [...lampRims, ...windows];
    const ok = (x: number) => {
      const r = rectOf(x, 43, 1, 13);
      return inside(r) && !others.some((o) => near(r, o, 0)) && !near(r, door, 0);
    };
    const leftX = [door.x - 4, door.x - 3, door.x - 2].find(ok);
    const rightX = [door.x + door.w + 3, door.x + door.w + 2, door.x + door.w + 1].find(ok);
    if (f.door === "center") {
      if (leftX !== undefined && rightX !== undefined && door.x - leftX === rightX - (door.x + door.w - 1)) handrails.push(leftX, rightX);
    } else {
      if (leftX !== undefined) handrails.push(leftX);
      if (rightX !== undefined) handrails.push(rightX);
    }
  }

  // ---- 銘板と点検ふた（空いているときだけ） ----
  const taken = [...lightParts, ...(door ? [door] : []), ...handrails.map((x) => rectOf(x, 43, 1, 13))];
  const plateR = rectOf(17, 56, 6, 2);
  const hatchR = rectOf(43, 57, 6, 1);
  const plate = f.paint !== "warning" && inside(plateR) && !taken.some((o) => near(plateR, o, 1)) ? plateR : null;
  const hatch = f.paint !== "warning" && inside(hatchR) && !taken.some((o) => near(hatchR, o, 1)) ? hatchR : null;

  return {
    bodyLeft: left,
    bodyRight: right,
    windows,
    windowRound,
    door,
    doorGlass,
    lamps,
    lampRound: f.lightShape === "round",
    tails,
    sign,
    wipers,
    handrails,
    plate,
    hatch,
    panto: design.side.roof !== "none" && pantographCars(design.cars)[0],
  };
}

export type RenderOptions = {
  /** 線路を描く（既定 true） */
  track?: boolean;
};

/** 正面の顔を描く（64×76、色番号画像） */
export function renderFace(design: TrainDesign, opts: RenderOptions = {}): IndexedImage {
  const L = faceLayout(design);
  const f = design.face;
  const img = createIndexed(FACE_W, FACE_H);
  const d = img.data;
  const t = tones(design.bodyColor);
  const bt = tones(design.bandColor);
  const { bodyLeft: left, bodyRight: right } = L;

  if (L.panto) panto(img, 31, 0);

  // ---- 車体（輪郭、屋根、陰影、塗り分け）。行ごとに区間で塗る ----
  for (let y = FACE_BODY_TOP; y <= FACE_BODY_BOTTOM; y++) {
    const row = y * FACE_W;
    const l = left[y];
    const r = right[y];
    const inner = y > FACE_BODY_TOP && y < FACE_BODY_BOTTOM;
    const il = inner ? Math.max(left[y - 1], l, left[y + 1]) + 1 : r + 1;
    const ir = inner ? Math.min(right[y - 1], r, right[y + 1]) - 1 : r;
    d.fill(t.edge, row + l, row + r + 1);
    if (il > ir) continue;
    // 塗り分けが行全体にかかるとき
    let whole = -1;
    if (f.paint === "band" && y >= 42 && y <= 46) whole = y === 42 ? bt.light : bt.base;
    else if (f.paint === "blackface" && y >= 20 && y <= 41) whole = C_INTERIOR;
    else if (y < 19) whole = y < 17 ? C_METAL_DARK : C_METAL;
    if (whole >= 0) {
      d.fill(whole, row + il, row + ir + 1);
      continue;
    }
    if (f.paint === "warning" && y >= 53 && y <= 58) {
      for (let x = il; x <= ir; x++) d[row + x] = (x + y) % 8 < 4 ? bt.base : C_STRIPE_BLACK;
      continue;
    }
    // 陰影: 外側の2列は暗、その内側は明、残りは基本（上端の行は明、下の方は暗）
    const mid = y === 19 ? t.light : y > 57 ? t.dark : t.base;
    d.fill(t.dark, row + il, row + Math.min(ir, 12) + 1);
    if (ir >= 13) d.fill(t.light, row + Math.max(il, 13), row + Math.min(ir, 16) + 1);
    if (ir >= 17) d.fill(mid, row + Math.max(il, 17), row + Math.min(ir, 50) + 1);
    if (ir >= 51) d.fill(t.dark, row + Math.max(il, 51), row + ir + 1);
  }
  // 屋根の丸みの光
  line(img, 18, 17, 45, 17, C_METAL_LIGHT);
  if (design.bodyColor === "silver") {
    // ステンレスのコルゲート
    for (let y = 48; y < 58; y += 3) {
      if (f.paint === "warning" && y + 1 >= 53) break;
      line(img, 14, y, 49, y, t.light);
      line(img, 14, y + 1, 49, y + 1, t.dark);
    }
  }
  if (f.paint === "band") line(img, left[47] + 2, 47, right[47] - 2, 47, t.edge);
  // 上すぼまりの鼻の面
  if (f.contour === "taper") {
    line(img, 18, 49, 45, 49, t.light);
    line(img, 18, 50, 14, 53, t.light);
    line(img, 45, 50, 49, 53, t.dark);
    line(img, 29, 57, 34, 57, t.dark);
    dot(img, 31, 58, t.light);
  }

  // ---- 窓 ----
  for (const w of L.windows) glass(img, w.x, w.y, w.w, w.h, L.windowRound);

  // ---- 貫通扉 ----
  if (L.door && L.doorGlass) {
    const { x: dx, w: dw } = L.door;
    box(img, dx, L.door.y, dw, L.door.h, t.base, t.edge, 1);
    line(img, dx + 1, L.door.y + 2, dx + 1, 58, t.light);
    if (f.paint === "band") rect(img, dx + 1, 42, dw - 2, 5, bt.base);
    // 窓まわりを黒にするときは、扉の上半分も黒にする（黒い面が扉で縦に割れないように）
    if (f.paint === "blackface") rect(img, dx + 1, L.door.y + 1, dw - 2, 41 - L.door.y, C_INTERIOR);
    if (f.paint === "warning") {
      for (let y = 53; y <= 58; y++) for (let x = dx + 1; x < dx + dw - 1; x++) dot(img, x, y, (x + y) % 8 < 4 ? bt.base : C_STRIPE_BLACK);
    }
    const g = L.doorGlass;
    glass(img, g.x, g.y, g.w, g.h, 1);
    line(img, dx + dw - 4, 48, dx + dw - 2, 48, C_INK);
    dot(img, dx + dw - 4, 49, C_METAL_LIGHT);
    if (f.paint !== "warning") line(img, dx + 3, 53, dx + dw - 5, 53, t.light);
    for (const yy of [30, 51]) rect(img, dx, yy, 2, 2, C_METAL_DARK);
    box(img, dx - 1, 59, dw + 2, 3, C_METAL, C_INK);
    for (const xx of L.handrails) {
      line(img, xx, 43, xx, 55, C_METAL_LIGHT);
      dot(img, xx, 43, C_INK);
      dot(img, xx, 55, C_INK);
    }
  }

  // ---- 行先表示 ----
  if (L.sign) ledSign(img, L.sign.x, L.sign.y, L.sign.w);

  // ---- ワイパー ----
  for (const { x, y } of L.wipers) {
    line(img, x, y, x + 4, y - 6, C_INK);
    line(img, x + 2, y - 5, x + 5, y - 7, C_FRAME);
    dot(img, x - 1, y + 1, C_METAL_LIGHT);
  }

  // ---- 前照灯と尾灯 ----
  for (const l of L.lamps) lamp(img, l.x, l.y, l.w, l.h, L.lampRound);
  for (const tl of L.tails) box(img, tl.x, tl.y, 3, 3, C_TAIL, C_WHITE, 1);

  // ---- 銘板と点検ふた ----
  if (L.plate) box(img, L.plate.x, L.plate.y, L.plate.w, L.plate.h, C_METAL_LIGHT, t.dark);
  if (L.hatch) line(img, L.hatch.x, L.hatch.y, L.hatch.x + L.hatch.w - 1, L.hatch.y, t.dark);

  // 車体と帯の境目に印を付ける（白黒で細い黒線になる）
  if (f.paint === "band" || f.paint === "warning") markSeams(img, BODY_L, 40, BODY_R + 1, 60);

  // ---- 足まわり ----
  rect(img, 17, 63, 5, 6, C_INTERIOR);
  rect(img, 42, 63, 5, 6, C_INTERIOR);
  if (f.skirt !== "none") {
    const h = f.skirt === "large" ? 7 : 4;
    poly(
      img,
      [
        [12, 62],
        [51, 62],
        [48, 62 + h],
        [15, 62 + h],
      ],
      C_METAL,
      C_EDGE_METAL,
    );
    line(img, 15, 63, 48, 63, C_METAL_LIGHT);
    for (const x of [18, 44]) rect(img, x, 65, 2, 2, C_INK);
  } else {
    line(img, 12, 63, 51, 63, C_INK);
    line(img, 22, 64, 20, 68, C_METAL_DARK);
    line(img, 43, 64, 45, 68, C_METAL_DARK);
  }
  box(img, 28, 63, 8, 5, C_METAL_DARK, C_INK, 1);
  rect(img, 30, 64, 4, 2, C_METAL_LIGHT);
  box(img, 23, 62, 3, 3, C_METAL, C_INK, 1);
  box(img, 39, 62, 3, 3, C_METAL, C_INK, 1);
  if (opts.track ?? true) drawTrack(img, FACE_RAIL_Y);
  return img;
}
