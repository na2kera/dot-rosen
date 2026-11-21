// X などに出す、路線ごとの絵（docs/spec.md「X に出る絵」、docs/api.md「GET /og/:id.png」）。
// 600×315 のドット絵を組み、書き出すときに 2 倍の 1200×630 にする。絵柄はアプリ共通の絵（tools/og-image.ts）にそろえる。
// Worker と道具（Node）で同じものを使う。DOM にも Node にも依存しない。
// 利用者の入力（路線名・駅の数・両数・色・ロゴ）で投げない。フォントに無い文字は飛ばし、入らない文字は「…」で切る。
import { textWidth, drawTextScaled, ellipsize } from "../card/text.ts";
import { hasGlyph, type BitmapFont } from "../font/index.ts";
import { blit, createIndexed, encodeIndexedPngAsync, fillRect, type IndexedImage, type Palette, type Rgba } from "../pix/index.ts";
import { MAX_CARS, MIN_CARS, routeSectionLabel, type RouteData, type StationLookup } from "../route/index.ts";
import { CAR_RAIL_Y, CAR_W, FACE_RAIL_Y, renderConsist, renderFace, stampLogo, tones, TRAIN_PALETTE } from "../train/index.ts";

/** ドット絵の大きさ（書き出しはこの 2 倍） */
export const OG_W = 600;
export const OG_H = 315;
export const OG_SCALE = 2;

// 絵の色。電車の色番号（0〜207）はそのまま使い、240 番から足す。値は tools/og-image.ts と同じ
const BG = 240;
const DOT = 241;
const PAPER = 242;
const ORANGE = 243;
const GREEN = 244;
const OG_COLORS: readonly [number, Rgba][] = [
  [BG, [20, 22, 28, 255]],
  [DOT, [31, 35, 43, 255]],
  [PAPER, [243, 234, 215, 255]],
  [ORANGE, [255, 157, 46, 255]],
  [GREEN, [125, 252, 138, 255]],
];

export const OG_PALETTE: Palette = (() => {
  const p = [...TRAIN_PALETTE];
  for (const [i, c] of OG_COLORS) p[i] = c;
  return p;
})();

/** 区間の表記に使う「⇄」はフォントに無く、shared/card/text.ts が点を持っている */
const CARD_EXTRA = new Set([0x21c4]);

export const OG_APP_NAME = "ドット路線メーカー";
/** 名前が無いときの見出し */
const NO_NAME = "オリジナルの路線";

// ---- 寸法 ----
const SIDE = 24;
/** 見出しの段（路線名とロゴ） */
const HEAD_Y = 10;
const HEAD_H = 48;
const LOGO_SCALE = 3;
const LOGO_BOX = 16 * LOGO_SCALE + 4;
/** 台紙（角を段にする） */
const MOUNT_X = 32;
const MOUNT_W = OG_W - MOUNT_X * 2;
const MOUNT_Y = 68;
const MOUNT_H = 158;
const FACE_SCALE = 2;
const FACE_X = MOUNT_X + 8;
const FACE_Y = MOUNT_Y + 2;
/** 編成を置く範囲 */
const CONSIST_X0 = FACE_X + 64 * FACE_SCALE + 8;
const CONSIST_X1 = MOUNT_X + MOUNT_W - 4;
/** 路線図 */
const NAMES_Y = 236;
const LINE_Y = 262;
const LINE_H = 6;
const LOOP_Y = 280;
const MAP_X0 = 44;
const SECTION_MAX = 200;
const STATION_NAME_MAX = 16 * 6;
/** アプリの名前（右下） */
const APP_Y = 292;

export type OgInput = {
  /** 路線（検査ずみのもの。名前が空でも描ける） */
  route: RouteData;
  lookup: StationLookup;
  font: BitmapFont;
};

/** フォントに無い文字を飛ばす */
function visible(font: BitmapFont, s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (hasGlyph(font, cp) || CARD_EXTRA.has(cp)) out += ch;
  }
  return out;
}

/** 整数にして [lo, hi] に収める */
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));

/** 丸い駅の印（中心 (cx, cy)、半径 r。中を地の色で抜く半径 hole） */
function disk(img: IndexedImage, cx: number, cy: number, r: number, hole: number): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const r2 = dx * dx + dy * dy;
      if (r2 <= r * r) fillRect(img, cx + dx, cy + dy, 1, 1, hole > 0 && r2 <= hole * hole ? BG : PAPER);
    }
  }
}

/**
 * 区間の表記（今の区間の表記と同じ）。入らないときは、始発と終点の駅名をそれぞれ切り詰めて「⇄」を残す
 * （環状線は起点の駅名を切り詰める）
 */
function sectionLabel(route: RouteData, lookup: StationLookup, font: BitmapFont): string {
  const full = visible(font, routeSectionLabel(route, lookup));
  if (textWidth(font, full) <= SECTION_MAX) return full;
  const names = route.stations.map((id) => visible(font, lookup(id)?.name ?? "?"));
  if (route.loop && names.length >= 3) {
    const room = SECTION_MAX - textWidth(font, "環状（起点 ）");
    return `環状（起点 ${ellipsize(font, names[0], room)}）`;
  }
  if (names.length >= 2) {
    const half = Math.floor((SECTION_MAX - textWidth(font, " ⇄ ")) / 2);
    return `${ellipsize(font, names[0], half)} ⇄ ${ellipsize(font, names[names.length - 1], half)}`;
  }
  return ellipsize(font, full, SECTION_MAX);
}

/** 路線ごとの絵（600×315 の色番号画像）を組み立てる */
export function renderRouteOg(input: OgInput): IndexedImage {
  const { route, lookup, font } = input;
  // 両数は 1〜最大両数に収める（検査ずみのデータでは変わらない）
  const design = { ...route.train, cars: clampInt(route.train.cars, MIN_CARS, MAX_CARS) };
  const img = createIndexed(OG_W, OG_H, BG);
  const text = (x: number, y: number, s: string, k: number, c: number) => drawTextScaled(img, font, x, y, s, k, k, c);

  // ---- 見出し: 消灯ドットの上に路線名（橙）、右にロゴ ----
  for (let y = HEAD_Y - 2; y < HEAD_Y + HEAD_H + 2; y += 4) for (let x = SIDE; x < OG_W - SIDE; x += 4) fillRect(img, x, y, 1, 1, DOT);
  const logoX = OG_W - SIDE - LOGO_BOX;
  fillRect(img, logoX, HEAD_Y - 2, LOGO_BOX, LOGO_BOX, PAPER);
  const logo = createIndexed(16, 16);
  stampLogo(logo, design, 0, 0);
  blit(img, logo, logoX + 2, HEAD_Y, { scale: LOGO_SCALE });
  {
    // 名前が無い（フォントに無い文字だけの名前を含む）ときは、投稿文と同じく「オリジナルの路線」と出す
    const name = visible(font, route.name) || NO_NAME;
    const maxW = logoX - 16 - SIDE;
    {
      const w = textWidth(font, name);
      const k = [3, 2, 1].find((s) => w * s <= maxW);
      const s = k === undefined ? ellipsize(font, name, maxW) : name;
      const kk = k ?? 1;
      text(SIDE, HEAD_Y + Math.floor((HEAD_H - 16 * kk) / 2), s, kk, ORANGE);
    }
  }

  // ---- 台紙と電車（正面 2 倍、側面は等倍） ----
  fillRect(img, MOUNT_X + 4, MOUNT_Y, MOUNT_W - 8, MOUNT_H, PAPER);
  fillRect(img, MOUNT_X, MOUNT_Y + 4, MOUNT_W, MOUNT_H - 8, PAPER);
  blit(img, renderFace(design), FACE_X, FACE_Y, { scale: FACE_SCALE, transparent: 0 });
  {
    const avail = CONSIST_X1 - CONSIST_X0;
    // 縮めずに、入る両数（2 両）だけ描く。それより長い編成は先頭から 2 両（入らない車両は描かない）
    const consist = renderConsist(design, { limit: Math.max(1, Math.min(design.cars, Math.floor(avail / CAR_W))) });
    // 線路の高さを正面の線路にそろえる
    const y = FACE_Y + FACE_RAIL_Y * FACE_SCALE - CAR_RAIL_Y;
    const x = CONSIST_X0 + Math.max(0, Math.floor((avail - consist.width) / 2));
    blit(img, consist, x, y, { transparent: 0 });
  }

  // ---- 路線図: 選んだ駅をつないだ線と、入るぶんの駅名。右に区間 ----
  {
    const label = sectionLabel(route, lookup, font);
    const labelW = textWidth(font, label);
    const labelX = OG_W - SIDE - labelW;
    if (label) text(labelX, LINE_Y + LINE_H / 2 - 8, label, 1, PAPER);
    const x1 = Math.max(MAP_X0 + 120, labelX - 24);
    const n = route.stations.length;
    const loop = route.loop && n >= 3;
    const lt = tones(route.lineColor);
    // 線の縁は紙の色（黒や紺の線でも暗い地に埋もれないよう）
    // 環状線は、両端から下を回って戻る線を足す
    const inset = loop ? 12 : 0;
    const a = MAP_X0 + inset;
    const b = x1 - inset;
    const bars: [number, number, number, number][] = loop
      ? [
          [MAP_X0, LINE_Y, LINE_H, LOOP_Y + LINE_H - LINE_Y],
          [x1 - LINE_H, LINE_Y, LINE_H, LOOP_Y + LINE_H - LINE_Y],
          [MAP_X0, LOOP_Y, x1 - MAP_X0, LINE_H],
          [MAP_X0, LINE_Y, x1 - MAP_X0, LINE_H],
        ]
      : [[a, LINE_Y, b - a, LINE_H]];
    // 縁を先に全部塗ってから中を塗る（つなぎ目に縁の線が残らないよう）
    for (const [x, y, w, h] of bars) fillRect(img, x, y, w, h, PAPER);
    for (const [x, y, w, h] of bars) fillRect(img, x + 1, y + 1, w - 2, h - 2, lt.base);
    const xs = route.stations.map((_, i) => (n <= 1 ? Math.round((a + b) / 2) : Math.round(a + (i * (b - a)) / (n - 1))));
    const step = n <= 1 ? 99 : (b - a) / (n - 1);
    const cy = LINE_Y + LINE_H / 2;
    const small = clampInt(Math.floor(step / 2) - 1, 2, 4);
    xs.forEach((x, i) => {
      const terminal = !loop && (i === 0 || i === n - 1);
      if (terminal) disk(img, x, cy, 6, 3);
      else disk(img, x, cy, small, small >= 3 ? 1 : 0);
    });
    // 駅名は線の上。始発・終点を先に置き、あいだの駅は重ならないものだけ置く
    const names = route.stations.map((id) => ellipsize(font, visible(font, lookup(id)?.name ?? ""), STATION_NAME_MAX));
    const placed: [number, number][] = [];
    const order = n <= 2 ? [...Array(n).keys()] : [0, n - 1, ...Array.from({ length: n - 2 }, (_, i) => i + 1)];
    for (const i of order) {
      const s = names[i];
      if (!s) continue;
      const w = textWidth(font, s);
      const left = clampInt(xs[i] - w / 2, SIDE, Math.max(SIDE, x1 - w));
      const right = left + w;
      if (placed.some(([l, r]) => left < r + 8 && right + 8 > l)) continue;
      placed.push([left, right]);
      text(left, NAMES_Y, s, 1, PAPER);
    }
  }

  // ---- アプリの名前（右下、緑） ----
  text(OG_W - SIDE - textWidth(font, OG_APP_NAME), APP_Y, OG_APP_NAME, 1, GREEN);
  return img;
}

/** 路線ごとの絵の PNG（1200×630、パレット形式）。CompressionStream で圧縮する */
export async function routeOgPng(input: OgInput): Promise<Uint8Array> {
  const img = renderRouteOg(input);
  return encodeIndexedPngAsync(img.width, img.height, img.data, OG_PALETTE, OG_SCALE);
}
