// 側面1両（192×64）と編成。v2 の見本の car() を、どの組み合わせでも破綻しないように配置し直したもの。
// 20m 級の車体 = 192 ドット。レール 59 行、屋根 24 行、床 48 行。台車の中心 29 / 162。
import { createIndexed, type IndexedImage } from "../pix/image.ts";
import {
  C_EDGE_METAL,
  C_FRAME,
  C_INK,
  C_INTERIOR,
  C_LED,
  C_METAL,
  C_METAL_DARK,
  C_METAL_LIGHT,
  C_WHITE,
  tones,
  type Tones,
} from "./colors.ts";
import { pantographCars } from "./consist-rules.ts";
import type { SideDesign, TrainDesign } from "./design.ts";
import { box, dot, drawTrack, equipment, glass, glassSpans, lamp, line, markSeams, panto, rect } from "./draw.ts";
import { rectOf, type Rect } from "./geometry.ts";
import { decodeLogo, LOGO_SIZE } from "./logos.ts";

export const CAR_W = 192;
export const CAR_H = 64;
export const CAR_BODY_TOP = 24;
export const CAR_BODY_BOTTOM = 48;
export const CAR_RAIL_Y = 59;
/** 窓の上端の行と高さ */
const WIN_Y = 30;
const WIN_H = 9;
/** ロゴの上端の行 */
export const LOGO_Y = 30;
const DOOR_W = 12;
const PASSENGER_END = 184;

export type CarKind = "lead" | "middle" | "tail";

/** 鼻先ごとの、屋根からの行ごとの食い込み（v2 の式を整数の表にしたもの。25 行） */
const NOSE_INSET: Record<SideDesign["nose"], readonly number[]> = {
  flat: new Array<number>(25).fill(0),
  slope: [7, 7, 6, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  round: [6, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3],
  stream: [27, 25, 23, 22, 20, 18, 17, 15, 14, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1, 1, 0, 0],
  long: [52, 49, 46, 43, 41, 38, 35, 32, 29, 27, 24, 21, 18, 16, 13, 10, 7, 5, 2, 0, 0, 0, 0, 1, 2],
  bonnet: [23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 18, 11, 5, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2],
};

export type CarLayout = {
  kind: CarKind;
  /** 各行の車体の左端・右端（車体の無い行は -1） */
  bodyLeft: Int16Array;
  bodyRight: Int16Array;
  /** 運転台の窓（各行の左右端）。先頭車・最後尾車のみ */
  cab: { y: number; spans: [number, number][] } | null;
  /** 乗務員扉（先頭車・最後尾車のみ） */
  crewDoor: Rect | null;
  /** 客用扉 */
  doors: Rect[];
  /** 客室の窓ガラス */
  windows: Rect[];
  /** 横長の連続窓の帯 */
  ribbon: Rect | null;
  logo: Rect | null;
  noseLamp: Rect | null;
  /** 側面の行先表示、小さい銘板、車番の板 */
  sign: Rect | null;
  plate: Rect | null;
  numberPlate: Rect | null;
  panto: boolean;
};

function interiorRange(left: Int16Array, right: Int16Array, y: number): [number, number] {
  if (y <= CAR_BODY_TOP || y >= CAR_BODY_BOTTOM) return [CAR_W, -1];
  return [Math.max(left[y - 1], left[y], left[y + 1]) + 1, Math.min(right[y - 1], right[y], right[y + 1]) - 1];
}

/** 左右反転（tail 用） */
const flipRect = (r: Rect): Rect => ({ x: CAR_W - r.x - r.w, y: r.y, w: r.w, h: r.h });

/** 先頭車の配置を作る（tail はこれを左右反転する） */
function leadOrMiddleLayout(design: TrainDesign, lead: boolean, pantoOn: boolean): CarLayout {
  const s = design.side;
  const inset = lead ? NOSE_INSET[s.nose] : NOSE_INSET.flat;
  const left = new Int16Array(CAR_H).fill(-1);
  const right = new Int16Array(CAR_H).fill(-1);
  for (let y = CAR_BODY_TOP; y <= CAR_BODY_BOTTOM; y++) {
    const c = y === CAR_BODY_TOP || y === CAR_BODY_BOTTOM ? 1 : 0;
    left[y] = 2 + inset[y - CAR_BODY_TOP] + c;
    right[y] = 189 - c;
  }
  let cab: CarLayout["cab"] = null;
  let crewDoor: Rect | null = null;
  let logo: Rect | null = null;
  let noseLamp: Rect | null = null;
  let start = 8;
  let firstGap = 8;
  if (lead) {
    const cabX = 4 + inset[7];
    const cabW = s.nose === "long" ? 16 : 13;
    const wedge = s.nose === "long" || s.nose === "stream";
    const spans: [number, number][] = [];
    // ロングノーズは鼻の傾きがゆるく、上の行では窓が細くなりすぎるので2行下げる
    const cabTop = s.nose === "long" ? 31 : 29;
    for (let y = cabTop; y <= 37; y++) {
      const [il] = interiorRange(left, right, y);
      const a = Math.max(il + 1, wedge ? cabX - Math.floor(((y - 29) * 4) / 7) : cabX);
      spans.push([a, cabX + cabW - 1]);
    }
    cab = { y: cabTop, spans };
    const dx = cabX + cabW + 3;
    crewDoor = rectOf(dx, 28, 7, 20);
    logo = rectOf(dx + 10, LOGO_Y, LOGO_SIZE, LOGO_SIZE);
    start = logo.x + LOGO_SIZE + 3;
    firstGap = 3;
    // 鼻先の前照灯は、白い余白まで車体の内側に入る位置
    let minX = 0;
    for (let y = 43; y <= 47; y++) minX = Math.max(minX, interiorRange(left, right, y)[0] + 1);
    noseLamp = rectOf(minX, 44, 4, 3);
  }

  // ---- 客用扉 ----
  const n = s.doors === "two" ? 2 : s.doors === "three" ? 3 : 4;
  const x0 = start + firstGap;
  const x1 = PASSENGER_END - DOOR_W;
  const doors: Rect[] = [];
  for (let k = 0; k < n; k++) doors.push(rectOf(Math.round(x0 + (k * (x1 - x0)) / Math.max(1, n - 1)), 30, DOOR_W, 18));

  // ---- 窓（扉の間の区間ごと） ----
  const spansX: [number, number][] = [];
  let a = start;
  for (const d of doors) {
    spansX.push([a, d.x - 3]);
    a = d.x + DOOR_W + 3;
  }
  spansX.push([a, PASSENGER_END]);
  const windows: Rect[] = [];
  let ribbon: Rect | null = null;
  const usable = spansX.filter(([p, q]) => q - p + 1 >= 5);
  for (const [p, q] of usable) {
    const width = q - p + 1;
    if (s.window === "ribbon") {
      windows.push(rectOf(p, WIN_Y, width, WIN_H));
    } else if (s.window === "big") {
      // 長い区間は、幅 50 ドットまでの窓に分ける（間に 2 ドットの柱。3・4ドアでは v2 と同じ1枚）
      const count = Math.max(1, Math.ceil((width + 2) / 52));
      const ww = Math.floor((width - (count - 1) * 2) / count);
      const off = (width - (count * ww + (count - 1) * 2)) >> 1;
      for (let k = 0; k < count; k++) windows.push(rectOf(p + off + k * (ww + 2), WIN_Y, ww, WIN_H));
    } else {
      const ww = s.window === "round" ? 10 : 9;
      const step = ww + 3;
      const count = Math.max(1, Math.floor((width + 3) / step));
      const off = Math.max(0, Math.floor((width - (count * step - 3)) / 2));
      for (let k = 0; k < count; k++) {
        const x = p + off + k * step;
        if (x + ww - 1 <= q) windows.push(rectOf(x, WIN_Y, ww, WIN_H));
      }
    }
  }
  if (s.window === "ribbon") ribbon = rectOf(start - 1, WIN_Y - 1, PASSENGER_END - start + 3, WIN_H + 2);

  // ---- 行先表示・銘板・車番（窓の上下の空いたところ） ----
  const wide = usable.filter(([p, q]) => q - p + 1 >= 14);
  let sign: Rect | null = null;
  let plate: Rect | null = null;
  let numberPlate: Rect | null = null;
  if (wide.length > 0) {
    const [p, q] = wide[0];
    sign = rectOf(p + ((q - p + 1 - 12) >> 1), 26, 12, 4);
  }
  const firstSpan = usable[0];
  if (firstSpan && (!sign || firstSpan !== wide[0]) && firstSpan[1] - firstSpan[0] + 1 >= 6) plate = rectOf(firstSpan[0], 27, 6, 2);
  const lastWide = usable.filter(([p, q]) => q - p + 1 >= 9).at(-1);
  if (lastWide) numberPlate = rectOf(lastWide[1] - 7, 42, 7, 3);

  return {
    kind: lead ? "lead" : "middle",
    bodyLeft: left,
    bodyRight: right,
    cab,
    crewDoor,
    doors,
    windows,
    ribbon,
    logo,
    noseLamp,
    sign,
    plate,
    numberPlate,
    panto: pantoOn,
  };
}

/** その車両にパンタグラフを載せるか（既定の決まり） */
function defaultPanto(design: TrainDesign, kind: CarKind): boolean {
  if (design.side.roof === "none") return false;
  const p = pantographCars(design.cars);
  if (kind === "lead") return p[0];
  if (kind === "tail") return p[p.length - 1] && design.cars > 1;
  return design.cars >= 3 ? p[1] : false;
}

/** 側面1両の配置（tail は lead の左右反転） */
export function carLayout(design: TrainDesign, kind: CarKind, panto = defaultPanto(design, kind)): CarLayout {
  const L = leadOrMiddleLayout(design, kind !== "middle", panto);
  if (kind !== "tail") return L;
  const left = new Int16Array(CAR_H).fill(-1);
  const right = new Int16Array(CAR_H).fill(-1);
  for (let y = 0; y < CAR_H; y++) {
    if (L.bodyLeft[y] < 0) continue;
    left[y] = CAR_W - 1 - L.bodyRight[y];
    right[y] = CAR_W - 1 - L.bodyLeft[y];
  }
  const f = (r: Rect | null) => (r ? flipRect(r) : null);
  return {
    ...L,
    kind: "tail",
    bodyLeft: left,
    bodyRight: right,
    cab: L.cab ? { y: L.cab.y, spans: L.cab.spans.map(([a, b]) => [CAR_W - 1 - b, CAR_W - 1 - a] as [number, number]) } : null,
    crewDoor: f(L.crewDoor),
    doors: L.doors.map(flipRect),
    windows: L.windows.map(flipRect),
    ribbon: f(L.ribbon),
    logo: f(L.logo),
    noseLamp: f(L.noseLamp),
    sign: f(L.sign),
    plate: f(L.plate),
    numberPlate: f(L.numberPlate),
  };
}

/** 帯・柄の色（その点が帯でなければ -1） */
function bandAt(band: SideDesign["band"], bt: Tones, x: number, y: number): number {
  switch (band) {
    case "one":
      return y >= 40 && y <= 42 ? (y === 40 ? bt.light : bt.base) : -1;
    case "two":
      return y === 40 || y === 41 || y === 44 ? (y === 40 ? bt.light : bt.base) : -1;
    case "split":
      return y >= 40 ? (y === 40 ? bt.light : y === 47 ? bt.dark : bt.base) : -1;
    case "stripe":
      return y >= 40 && y <= 46 && (x + y) % 8 < 3 ? bt.base : -1;
    case "dots": {
      if (y < 40 || y > 45) return -1;
      const row = ((y - 40) / 3) | 0;
      return (y - 40) % 3 < 2 && (x + row * 3) % 6 < 2 ? bt.base : -1;
    }
    default:
      return -1;
  }
}

export type CarRenderOptions = {
  /** パンタグラフを載せるか（既定は pantographCars の決まり） */
  panto?: boolean;
  /** 線路を描く（既定 true） */
  track?: boolean;
  /** ロゴを貼る（既定 true。テスト用） */
  logo?: boolean;
};

function drawLeadOrMiddle(design: TrainDesign, L: CarLayout, lead: boolean): IndexedImage {
  const s = design.side;
  const img = createIndexed(CAR_W, CAR_H);
  const d = img.data;
  const t = tones(design.bodyColor);
  const bt = tones(design.bandColor);
  const silver = design.bodyColor === "silver";
  const { bodyLeft: left, bodyRight: right } = L;

  // ---- 車体（行ごとに同じ色で塗り、帯の柄だけ点ごとに塗る） ----
  const patterned = s.band === "stripe" || s.band === "dots";
  for (let y = CAR_BODY_TOP; y <= CAR_BODY_BOTTOM; y++) {
    const row = y * CAR_W;
    const l = left[y];
    const r = right[y];
    const [il, ir] = interiorRange(left, right, y);
    if (il > ir) {
      d.fill(t.edge, row + l, row + r + 1);
      continue;
    }
    d.fill(t.edge, row + l, row + il);
    d.fill(t.edge, row + ir + 1, row + r + 1);
    let c = y === 25 ? C_METAL_DARK : y === 26 ? C_METAL : y === 27 || y === 28 ? t.light : y === 47 ? t.light : y >= 45 ? t.dark : t.base;
    const b = patterned ? -1 : bandAt(s.band, bt, 0, y);
    if (b >= 0) c = b;
    else if (y === 43 && s.band === "one") c = t.dark;
    else if (silver && y > 43 && y < 47) c = y % 2 ? t.light : t.dark;
    d.fill(c, row + il, row + ir + 1);
    if (patterned && y >= 40 && y <= 46) {
      for (let x = il; x <= ir; x++) {
        const pb = bandAt(s.band, bt, x, y);
        if (pb >= 0) d[row + x] = pb;
      }
    }
  }
  // 雨どいの光と、床の線
  line(img, interiorRange(left, right, 26)[0] + 1, 26, 187, 26, C_METAL_LIGHT);
  line(img, interiorRange(left, right, 47)[0] + 1, 48, 186, 48, t.edge);

  // ---- 運転台 ----
  if (lead && L.cab && L.crewDoor) {
    glassSpans(img, L.cab.y, L.cab.spans);
    const dx = L.crewDoor.x;
    box(img, dx, 28, 7, 20, t.base, t.edge, 1);
    for (let y = 40; y <= 46; y++) {
      for (let x = dx + 1; x <= dx + 5; x++) {
        const b = bandAt(s.band, bt, x, y);
        if (b >= 0) dot(img, x, y, b);
      }
    }
    glass(img, dx + 2, 30, 4, 8);
    dot(img, dx + 5, 41, C_INK);
    line(img, dx - 2, 48, dx + 8, 48, C_METAL_LIGHT);
    line(img, dx - 1, 49, dx + 7, 49, C_METAL_DARK);
    if (s.nose === "bonnet") {
      line(img, interiorRange(left, right, 39)[0] + 1, 39, 23, 39, t.light);
      for (let x = 9; x < 21; x += 3) line(img, x, 41, x, 45, t.dark);
    }
    if (s.nose === "long") {
      line(img, 5, 44, 32, 43, t.light);
      line(img, 9, 46, 24, 46, C_METAL);
    }
    if (L.noseLamp) lamp(img, L.noseLamp.x, L.noseLamp.y, 4, 3, false);
  }

  // ---- 窓 ----
  if (L.ribbon) {
    const r = L.ribbon;
    box(img, r.x, r.y, r.w, r.h, C_INTERIOR, C_INK);
    for (const w of L.windows) {
      glass(img, w.x, w.y, w.w, w.h, 0);
      for (let x = w.x + 13; x < w.x + w.w - 6; x += 13) line(img, x, w.y, x, w.y + w.h - 1, C_INK);
    }
  } else {
    for (const w of L.windows) {
      glass(img, w.x, w.y, w.w, w.h, s.window === "round" ? 2 : 1);
      if (s.window === "big" && w.w > 21) line(img, w.x + (w.w >> 1), w.y, w.x + (w.w >> 1), w.y + w.h - 1, C_FRAME);
    }
  }

  // ---- 客用扉 ----
  for (const dr of L.doors) {
    const x = dr.x;
    line(img, x - 2, 29, x + DOOR_W + 1, 29, t.edge);
    line(img, x - 2, 28, x + DOOR_W + 1, 28, t.light);
    box(img, x, 30, DOOR_W, 18, t.base, t.edge);
    if (s.band !== "none") {
      for (let y = 40; y <= 46; y++) {
        for (let xx = x + 1; xx < x + DOOR_W - 1; xx++) {
          const b = bandAt(s.band, bt, xx, y);
          if (b >= 0) d[y * CAR_W + xx] = b;
        }
      }
    }
    if (L.ribbon) rect(img, x + 1, 30, DOOR_W - 2, 10, C_INTERIOR);
    line(img, x + 6, 30, x + 6, 47, C_FRAME);
    glass(img, x + 2, 31, 4, 8, 1);
    glass(img, x + 7, 31, 4, 8, 1);
    dot(img, x + 4, 42, C_INK);
    dot(img, x + 8, 42, C_INK);
    line(img, x + 1, 47, x + 10, 47, C_METAL_LIGHT);
    if (x + DOOR_W + 2 < 187) line(img, x + DOOR_W + 2, 32, x + DOOR_W + 2, 46, t.edge);
  }

  // ---- 小さい表示類 ----
  if (L.plate) box(img, L.plate.x, L.plate.y, 6, 2, C_WHITE, C_METAL_DARK);
  if (L.sign) {
    box(img, L.sign.x, 26, 12, 4, C_INTERIOR, C_EDGE_METAL);
    for (let k = 2; k < 10; k += 3) rect(img, L.sign.x + k, 27, 1, 2, C_LED);
  }
  if (L.numberPlate) {
    const p = L.numberPlate;
    box(img, p.x, p.y, 7, 3, t.light, t.dark);
    dot(img, p.x + 2, p.y + 1, t.dark);
    dot(img, p.x + 4, p.y + 1, t.dark);
  }

  // 車体と帯の境目に印を付ける（白黒で細い黒線になる）
  if (s.band !== "none") markSeams(img, 0, 38, CAR_W, 48);

  // ---- 屋根 ----
  if (s.roof === "cooler") {
    for (const [x, w] of [
      [64, 29],
      [128, 27],
    ]) {
      box(img, x, 19, w, 6, C_METAL, C_EDGE_METAL, 2);
      line(img, x + 3, 20, x + w - 4, 20, C_METAL_LIGHT);
      for (let a = x + 4; a < x + w - 3; a += 3) line(img, a, 22, a, 23, C_FRAME);
    }
  } else if (s.roof === "panto") {
    for (let x = 63; x < 166; x += 24) {
      if (L.panto && x + 8 > 102 && x < 126) continue;
      box(img, x, 22, 8, 3, C_METAL, C_METAL_DARK, 1);
    }
  }
  if (L.panto) panto(img, 113, 5);

  // ---- 床下機器と台車 ----
  for (const [x, y, w, h] of [
    [50, 49, 20, 6],
    [73, 50, 15, 5],
    [91, 49, 27, 7],
    [122, 49, 18, 5],
  ]) equipment(img, x, y, w, h);
  box(img, 141, 50, 6, 4, C_METAL_LIGHT, C_EDGE_METAL, 1);
  for (const bx of [29, 162]) {
    for (const wx of [bx - 10, bx + 10]) {
      box(img, wx - 4, 51, 8, 8, C_INK, 0, 3);
      box(img, wx - 2, 53, 4, 4, C_METAL, C_METAL_DARK, 1);
      dot(img, wx, 54, C_METAL_LIGHT);
      line(img, wx - 3, 58, wx + 2, 58, C_METAL_DARK);
    }
    box(img, bx - 14, 50, 29, 5, C_METAL_DARK, C_INK, 1);
    line(img, bx - 11, 51, bx + 11, 51, C_METAL_LIGHT);
    for (const xx of [bx - 10, bx + 10]) box(img, xx - 2, 53, 5, 3, C_METAL, C_EDGE_METAL);
    for (const xx of [bx - 5, bx + 4]) {
      rect(img, xx, 49, 3, 5, C_METAL);
      for (let y = 49; y < 54; y += 2) line(img, xx, y, xx + 2, y, C_INK);
    }
  }

  // ---- 連結部の幌と連結器 ----
  rect(img, 190, 29, 2, 17, C_EDGE_METAL);
  if (!lead) rect(img, 0, 29, 2, 17, C_EDGE_METAL);
  for (let y = 30; y < 46; y += 3) {
    line(img, 190, y, 191, y, C_METAL_LIGHT);
    if (!lead) line(img, 0, y, 1, y, C_METAL_LIGHT);
  }
  rect(img, 188, 49, 4, 2, C_INK);
  if (!lead) rect(img, 0, 49, 4, 2, C_INK);
  return img;
}

/** 左右反転（行ごとに並びを逆にする） */
function flipX(img: IndexedImage): IndexedImage {
  const out = createIndexed(img.width, img.height);
  const w = img.width;
  for (let y = 0; y < img.height; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) out.data[row + x] = img.data[row + w - 1 - x];
  }
  return out;
}

/** ロゴを (x, y) に等倍で貼る */
export function stampLogo(img: IndexedImage, design: TrainDesign, x: number, y: number): void {
  const px = decodeLogo(design.logo.bits);
  const fg = tones(design.logo.fg).logoFg;
  const bg = tones(design.logo.bg).logoBg;
  for (let j = 0; j < LOGO_SIZE; j++) {
    const row = (y + j) * img.width + x;
    for (let i = 0; i < LOGO_SIZE; i++) img.data[row + i] = px[j * LOGO_SIZE + i] ? fg : bg;
  }
}

/** 側面1両を描く（192×64、色番号画像）。tail は lead の左右反転（ロゴは反転しない） */
export function renderCar(design: TrainDesign, kind: CarKind, opts: CarRenderOptions = {}): IndexedImage {
  const pantoOn = opts.panto ?? defaultPanto(design, kind);
  const L = carLayout(design, kind === "tail" ? "lead" : kind, pantoOn);
  let img = drawLeadOrMiddle(design, L, kind !== "middle");
  if (kind === "tail") img = flipX(img);
  if ((opts.logo ?? true) && L.logo) {
    const x = kind === "tail" ? CAR_W - L.logo.x - LOGO_SIZE : L.logo.x;
    stampLogo(img, design, x, L.logo.y);
  }
  if (opts.track ?? true) drawTrack(img, CAR_RAIL_Y);
  return img;
}

export type ConsistOptions = {
  /** 線路を描く（既定 true） */
  track?: boolean;
  /** 先頭から何両まで描くか（既定は全部） */
  limit?: number;
};

/**
 * 編成を横につないで描く（先頭車が左）。1両編成は先頭車1両。
 * 2両以上は lead + middle × (n-2) + tail。パンタグラフは pantographCars の決まりで載せる。
 */
export function renderConsist(design: TrainDesign, opts: ConsistOptions = {}): IndexedImage {
  const n = design.cars;
  const count = Math.min(n, opts.limit ?? n);
  const out = createIndexed(CAR_W * count, CAR_H);
  const pantos = design.side.roof === "none" ? new Array<boolean>(n).fill(false) : pantographCars(n);
  const cache = new Map<string, IndexedImage>();
  for (let i = 0; i < count; i++) {
    const kind: CarKind = i === 0 ? "lead" : i === n - 1 ? "tail" : "middle";
    const key = `${kind}:${pantos[i]}`;
    let car = cache.get(key);
    if (!car) {
      car = renderCar(design, kind, { panto: pantos[i], track: false });
      cache.set(key, car);
    }
    for (let y = 0; y < CAR_H; y++) out.data.set(car.data.subarray(y * CAR_W, (y + 1) * CAR_W), y * out.width + i * CAR_W);
  }
  if (opts.track ?? true) drawTrack(out, CAR_RAIL_Y);
  return out;
}
