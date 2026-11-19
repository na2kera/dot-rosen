// 路線カードの配置。印刷用（白黒）とカラー版は、ここで作る同じ描画の命令の列から作る。
// 座標はすべてドット単位の整数。命令は上から順に重ねて描く。
import type { BitmapFont } from "../font/index.ts";
import { createIndexed, type IndexedImage } from "../pix/index.ts";
import { routeDistanceKm, routeSectionLabel, stationNumber, type RouteData, type StationLookup } from "../route/index.ts";
import { C_WHITE, renderConsist, renderFace, stampLogo, tones } from "../train/index.ts";
import { CARD_INK, CARD_SUB } from "./palette.ts";
import { qrMatrix, type QrMatrix } from "./qr.ts";
import { ellipsize, textWidth, wrapText } from "./text.ts";

export const CARD_WIDTH = 384;
export const CARD_MAX_HEIGHT = 3200;

export type CardSideLayout = "two-x1" | "lead-x2" | "two-x2-rotated";

export type LayoutInput = {
  route: RouteData;
  lookup: StationLookup;
  font: BitmapFont;
  issueNo: number | null;
  issuedOn: string;
  expiresOn?: string;
  url?: string;
  appName: string;
  sideLayout?: CardSideLayout;
};

/** 描画の命令。c は色番号（カードの色か電車の色） */
export type Op =
  | { k: "rect"; x: number; y: number; w: number; h: number; c: number }
  | { k: "text"; x: number; y: number; s: string; sx: number; sy: number; c: number }
  | { k: "dots"; x0: number; x1: number; y: number; c: number }
  | { k: "sprite"; img: IndexedImage; x: number; y: number; scale: number }
  | { k: "qr"; m: QrMatrix; x: number; y: number; cell: number };

export type CardLayout = { width: number; height: number; ops: Op[] };

// ---- 寸法 ----
const W = CARD_WIDTH;
/** 左右の余白 */
const SIDE = 8;
const LEFT = SIDE;
const RIGHT = W - SIDE;
const INNER = RIGHT - LEFT;
const TOP = 16;
const BOTTOM = 32;
/** 段と段の間（区切り線の上下） */
const GAP = 14;

// 停車駅案内
const ROW_H = 44;
const NUM_BOX_X = LEFT;
const NUM_BOX_W = 38;
const NUM_BOX_H = 20;
/** 縦の線（左端と幅）。中心は 64 */
const LINE_X = 59;
const LINE_W = 10;
const LINE_CX = LINE_X + LINE_W / 2;
const NAME_X = 84;
const NAME_MAX = RIGHT - NAME_X;
/** 2倍にする駅名の最大幅（全角9文字） */
const NAME_2X_MAX = 16 * 9;
/** 環状線の上下につける矢印と説明の高さ */
const LOOP_CAP = 30;

// QR コード
const QR_CELL = 4;
const QR_QUIET = 4;

/** 文字・図形を積み上げる */
class Builder {
  readonly ops: Op[] = [];
  constructor(readonly font: BitmapFont) {}

  rect(x: number, y: number, w: number, h: number, c: number): void {
    if (w > 0 && h > 0) this.ops.push({ k: "rect", x, y, w, h, c });
  }

  text(x: number, y: number, s: string, sx: number, sy: number, c: number): number {
    this.ops.push({ k: "text", x, y, s, sx, sy, c });
    return textWidth(this.font, s) * sx;
  }

  /** 左右 [x0, x1) の中央に描く */
  textCenter(x0: number, x1: number, y: number, s: string, sx: number, sy: number, c: number): void {
    const w = textWidth(this.font, s) * sx;
    this.text(x0 + Math.floor((x1 - x0 - w) / 2), y, s, sx, sy, c);
  }

  /** 1ドットおきの点線（横） */
  dots(x0: number, x1: number, y: number, c: number): void {
    if (x1 > x0) this.ops.push({ k: "dots", x0, x1, y, c });
  }

  /** 区切り（点線の中央に小さな菱形） */
  divider(y: number): void {
    const cx = W / 2;
    this.dots(LEFT, cx - 8, y, CARD_INK);
    this.dots(cx + 8, RIGHT, y, CARD_INK);
    for (let i = 0; i < 4; i++) this.rect(cx - 1 - i, y - 3 + i, 2 + i * 2, 1, CARD_INK);
    for (let i = 0; i < 3; i++) this.rect(cx - 3 + i, y + 1 + i, 6 - i * 2, 1, CARD_INK);
  }

  /** 角を丸めた矩形を塗る（半径 r） */
  roundRect(x: number, y: number, w: number, h: number, r: number, c: number): void {
    for (let j = 0; j < h; j++) {
      const k = j < r ? j : j >= h - r ? h - 1 - j : -1;
      const inset = k < 0 ? 0 : r - Math.round(Math.sqrt(r * r - (r - k - 0.5) * (r - k - 0.5)));
      this.rect(x + inset, y + j, w - inset * 2, 1, c);
    }
  }

  /** 円を塗る。中心は (cx, cy) の点の境目（直径 2r の偶数） */
  disk(cx: number, cy: number, r: number, c: number): void {
    for (let j = 0; j < r * 2; j++) {
      const dy = j + 0.5 - r;
      const half = Math.round(Math.sqrt(r * r - dy * dy));
      this.rect(cx - half, cy - r + j, half * 2, 1, c);
    }
  }

  /** 下向きの三角（上辺の中央が cx、幅 w、高さ h） */
  arrowDown(cx: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) {
      const half = Math.max(1, Math.round((w / 2) * (1 - j / h)));
      this.rect(cx - half, y + j, half * 2, 1, c);
    }
  }

  sprite(img: IndexedImage, x: number, y: number, scale: number): void {
    this.ops.push({ k: "sprite", img, x, y, scale });
  }
}

/** 色番号画像を時計回りに 90 度回す（先頭車の鼻先が上、屋根が右になる） */
function rotateCW(img: IndexedImage): IndexedImage {
  const out = createIndexed(img.height, img.width);
  const ow = out.width;
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width;
    const ox = img.height - 1 - y;
    for (let x = 0; x < img.width; x++) out.data[x * ow + ox] = img.data[row + x];
  }
  return out;
}

/** 発行番号の表示（No.0042、未発行は No.----） */
export function formatIssueNo(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return "No.----";
  return `No.${String(Math.floor(n)).padStart(4, "0")}`;
}

/** 文字列の倍率を決める（収まる最大の整数倍。どれも入らなければ null） */
function fitScale(font: BitmapFont, s: string, maxWidth: number, scales: readonly number[]): number | null {
  const w = textWidth(font, s);
  for (const k of scales) if (w * k <= maxWidth) return k;
  return null;
}

export function layoutCard(input: LayoutInput): CardLayout {
  const { route, lookup, font } = input;
  const design = route.train;
  const b = new Builder(font);
  const lt = tones(route.lineColor);
  const names = route.stations.map((id) => lookup(id)?.name ?? "?");
  let y = TOP;

  // ---- 1. 見出し: ロゴ（3倍）と路線記号（2倍）、その下に路線名 ----
  {
    y += 2; // 枠の外側の線のぶん
    const logo = createIndexed(16, 16);
    stampLogo(logo, design, 0, 0);
    const badgeW = 48;
    const total = 48 + 16 + badgeW;
    const lx = Math.floor((W - total) / 2 / 8) * 8;
    // ロゴの枠
    b.rect(lx - 2, y - 2, 52, 52, CARD_INK);
    b.rect(lx - 1, y - 1, 50, 50, C_WHITE);
    b.sprite(logo, lx, y, 3);
    // 路線記号: 角丸の枠（外から 濃い線・ラインカラー・濃い線）に英字
    const bx = lx + 48 + 16;
    const by = y - 2;
    b.roundRect(bx, by, badgeW, 52, 9, lt.edge);
    b.roundRect(bx + 1, by + 1, badgeW - 2, 50, 8, lt.base);
    b.roundRect(bx + 5, by + 5, badgeW - 10, 42, 5, lt.edge);
    b.roundRect(bx + 6, by + 6, badgeW - 12, 40, 4, C_WHITE);
    b.textCenter(bx, bx + badgeW, by + 10, route.symbol, 2, 2, CARD_INK);
    y += 48 + 2 + 10;
    // 路線名。3倍 → 2倍 → 横等倍・縦2倍。この行だけは左右の余白なしの 384 ドットまで使う
    const k = fitScale(font, route.name, W, [3, 2]);
    if (k !== null) {
      b.textCenter(0, W, y, route.name, k, k, CARD_INK);
      y += 16 * k;
    } else {
      b.textCenter(0, W, y, ellipsize(font, route.name, W), 1, 2, CARD_INK);
      y += 32;
    }
    y += 10;
    // ラインカラーの帯
    b.rect(LEFT, y, INNER, 8, lt.edge);
    b.rect(LEFT + 1, y + 1, INNER - 2, 6, lt.base);
    y += 8 + GAP;
  }

  // ---- 2. 区間（2倍 → 等倍 → 等倍で2行） ----
  {
    const label = routeSectionLabel(route, lookup);
    const k = fitScale(font, label, INNER, [2, 1]);
    if (k !== null) {
      b.textCenter(LEFT, RIGHT, y, label, k, k, CARD_INK);
      y += 16 * k;
    } else {
      const lines = route.loop ? [label] : [`${names[0]} ⇄`, names[names.length - 1]];
      for (const line of lines) {
        b.textCenter(LEFT, RIGHT, y, ellipsize(font, line, INNER), 1, 1, CARD_INK);
        y += 20;
      }
      y -= 4;
    }
    y += GAP;
  }

  // ---- 3. 正面の顔（3倍、中央） ----
  {
    const face = renderFace(design);
    b.sprite(face, (W - face.width * 3) / 2, y, 3);
    y += face.height * 3 + GAP;
  }

  // ---- 4. 側面と「◯両編成」 ----
  {
    const layout = input.sideLayout ?? "two-x1";
    const one = design.cars === 1;
    if (layout === "two-x1") {
      const img = renderConsist(design, { limit: 2 });
      b.sprite(img, (W - img.width) / 2, y, 1);
      y += img.height;
    } else if (layout === "lead-x2") {
      const img = renderConsist(design, { limit: 1 });
      b.sprite(img, (W - img.width * 2) / 2, y, 2);
      y += img.height * 2;
    } else {
      const img = rotateCW(renderConsist(design, { limit: one ? 1 : 2 }));
      b.sprite(img, (W - img.width * 2) / 2, y, 2);
      y += img.height * 2;
    }
    y += 8;
    b.textCenter(LEFT, RIGHT, y, `${design.cars}両編成`, 2, 2, CARD_INK);
    y += 32 + GAP;
  }

  b.divider(y);
  y += GAP;

  // ---- 5. 停車駅案内 ----
  {
    b.textCenter(LEFT, RIGHT, y, route.loop ? "停車駅（環状）" : "停車駅", 1, 1, CARD_SUB);
    y += 16 + 12;
    const n = names.length;
    const capTop = route.loop ? LOOP_CAP : 0;
    const rowsTop = y + capTop;
    const center = (i: number) => rowsTop + i * ROW_H + ROW_H / 2;
    const rowsBottom = rowsTop + n * ROW_H;
    // 縦の線（ラインカラー、両側に濃い線）
    const lineTop = route.loop ? y + 10 : center(0);
    const lineBottom = route.loop ? rowsBottom + LOOP_CAP - 12 : center(n - 1);
    b.rect(LINE_X, lineTop, LINE_W, lineBottom - lineTop, lt.edge);
    b.rect(LINE_X + 1, lineTop, LINE_W - 2, lineBottom - lineTop, lt.base);
    if (route.loop) {
      // 上: 前の駅（終点）から入ってくる矢印、下: 始発駅へつづく矢印
      b.arrowDown(LINE_CX, y, 20, 10, CARD_INK);
      b.arrowDown(LINE_CX, lineBottom, 20, 10, CARD_INK);
      const tag = (ty: number, s: string) => {
        b.rect(NAME_X, ty, 36, 20, CARD_INK);
        b.rect(NAME_X + 1, ty + 1, 34, 18, C_WHITE);
        b.text(NAME_X + 2, ty + 2, "環状", 1, 1, CARD_INK);
        const tx = NAME_X + 36 + 8;
        b.text(tx, ty + 2, ellipsize(font, s, RIGHT - tx), 1, 1, CARD_SUB);
      };
      tag(y - 2, `${stationNumber(route.symbol, n - 1)} ${names[n - 1]} から`);
      tag(lineBottom - 6, `${stationNumber(route.symbol, 0)} ${names[0]} へ`);
    }
    for (let i = 0; i < n; i++) {
      const cy = center(i);
      // 駅ナンバリング（枠つき、等倍）
      const bx = NUM_BOX_X;
      const by = cy - NUM_BOX_H / 2;
      b.rect(bx, by, NUM_BOX_W, NUM_BOX_H, lt.edge);
      b.rect(bx + 1, by + 1, NUM_BOX_W - 2, NUM_BOX_H - 2, C_WHITE);
      b.textCenter(bx, bx + NUM_BOX_W, by + 2, stationNumber(route.symbol, i), 1, 1, CARD_INK);
      // 線の上の丸い印（始発と終点は大きめ）
      const terminal = !route.loop && (i === 0 || i === n - 1);
      if (terminal) {
        b.disk(LINE_CX, cy, 12, CARD_INK);
        b.disk(LINE_CX, cy, 9, C_WHITE);
        b.disk(LINE_CX, cy, 5, CARD_INK);
      } else {
        b.disk(LINE_CX, cy, 8, CARD_INK);
        b.disk(LINE_CX, cy, 6, C_WHITE);
      }
      // 駅名（全角9文字までは2倍、それより長いものは横等倍・縦2倍、入らなければ「…」）
      const name = names[i];
      const w1 = textWidth(font, name);
      if (w1 <= NAME_2X_MAX) b.text(NAME_X, cy - 16, name, 2, 2, CARD_INK);
      else b.text(NAME_X, cy - 16, ellipsize(font, name, NAME_MAX), 1, 2, CARD_INK);
    }
    y = rowsBottom + capTop + GAP;
  }

  // ---- 6. データ欄 ----
  {
    const rows: [string, string][] = [
      ["駅数", `${names.length}駅`],
      ["総距離", `${routeDistanceKm(route, lookup).toFixed(1)}km（直線距離）`],
      ["発行日", input.issuedOn],
      ["発行番号", formatIssueNo(input.issueNo)],
    ];
    const lineH = 22;
    const h = rows.length * lineH + 14;
    b.roundRect(LEFT, y, INNER, h, 3, CARD_INK);
    b.roundRect(LEFT + 1, y + 1, INNER - 2, h - 2, 2, C_WHITE);
    const labelX = LEFT + 12;
    const valueX = labelX + 64 + 16;
    rows.forEach(([label, value], i) => {
      const ty = y + 10 + i * lineH;
      b.text(labelX, ty, label, 1, 1, CARD_SUB);
      b.text(valueX, ty, ellipsize(font, value, RIGHT - 12 - valueX), 1, 1, CARD_INK);
      if (i > 0) b.dots(LEFT + 8, RIGHT - 8, ty - 4, CARD_SUB);
    });
    y += h;
  }

  // ---- 7. QR コードとアプリ名・期限（URL が無ければ省く） ----
  if (input.url) {
    y += 8;
    const m = qrMatrix(input.url);
    const quiet = QR_QUIET * QR_CELL;
    const qx = LEFT + quiet;
    const qy = y + quiet;
    const size = m.size * QR_CELL;
    b.rect(LEFT, y, size + quiet * 2, size + quiet * 2, C_WHITE);
    b.ops.push({ k: "qr", m, x: qx, y: qy, cell: QR_CELL });
    const tx = qx + size + quiet;
    const tw = RIGHT - tx;
    const lines: { s: string; c: number }[] = [];
    for (const s of wrapText(font, input.appName, tw)) lines.push({ s, c: CARD_INK });
    if (input.expiresOn) {
      const full = `${input.expiresOn}まで見られます`;
      const parts = textWidth(font, full) <= tw ? [full] : [`${input.expiresOn}まで`, "見られます"];
      lines.push({ s: "", c: CARD_INK });
      for (const p of parts) for (const s of wrapText(font, p, tw)) lines.push({ s, c: CARD_SUB });
    }
    const lh = 20;
    const blockH = lines.reduce((a, l) => a + (l.s ? lh : 8), 0) - 4;
    let ty = qy + Math.floor((size - blockH) / 2);
    for (const l of lines) {
      if (l.s) b.text(tx, ty, l.s, 1, 1, l.c);
      ty += l.s ? lh : 8;
    }
    y = qy + size;
  }

  const height = y + BOTTOM;
  if (height > CARD_MAX_HEIGHT) throw new Error(`路線カードが長すぎます: ${height} ドット（上限 ${CARD_MAX_HEIGHT}）`);
  return { width: W, height, ops: b.ops };
}
