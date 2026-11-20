// イベント会場に貼る A4 横向きの紹介ポスターを、このリポジトリの電車・フォント・路線カード・QR の描画だけで描く。
// 実行: node tools/run.mjs tools/poster.ts --url <QR に入れる URL> [--out <出力先>]
// 877×620 の色番号画像に描き、最近傍で 4 倍（3508×2480、A4 横を 300dpi）にする。
// 路線カードの見本だけは、4 倍にした後の画像に等倍で重ねる（カードの 1 ドット = 出力の 1 ドット）。
// 出力には会場コードの入った URL が入るので、既定の出力先は gitignore 済みの tools/out/poster/。
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { CARD_WIDTH, layoutCard, qrMatrix, renderCardPrint, type QrMatrix } from "../shared/card/index.ts";
import { drawText, hasGlyph, measureText } from "../shared/font/index.ts";
import { bitToRgba, blit, createIndexed, encodePng, fillRect, indexedToRgba, setPixel, type Rgba } from "../shared/pix/index.ts";
import { C_GLASS2, C_LAMP, COLOR_COUNT, createRng, defaultDesign, renderConsist, renderFace, TRAIN_PALETTE, tones, type TrainDesign } from "../shared/train/index.ts";
import { brandFaceDesign } from "./lib/brand-face.ts";
import { APP_NAME, FixtureKit, loadFont, loadStations, SAMPLE_URL } from "./lib/card-fixtures.ts";
import { ROOT } from "./lib/paths.ts";

// ---- 引数 ----
function usage(message?: string): never {
  if (message) console.error(message);
  console.error("使い方: node tools/run.mjs tools/poster.ts --url <QR に入れる URL> [--out <出力先.png>]");
  console.error("  既定の出力先: tools/out/poster/poster-a4-landscape.png（リポジトリに入れないこと）");
  process.exit(1);
}
const args = process.argv.slice(2);
let url: string | undefined;
let out = path.join(ROOT, "tools/out/poster/poster-a4-landscape.png");
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--url") url = args[++i];
  else if (a === "--out") out = path.resolve(args[++i] ?? usage("--out の値がありません"));
  else usage(`知らない引数です: ${a}`);
}
if (!url) usage("--url を指定してください（既定の URL はありません）");

// ---- 寸法 ----
const W = 877;
const H = 620;
const SCALE = 4;
/** A4 横 297mm を幅 W で割った、元画像の 1 ドットの大きさ（mm） */
const MM = 297 / W;
/** 紙の端から 10mm の、大事な要素を置かない余白（元画像のドット） */
const SAFE = 30;

const font = loadFont(ROOT);
const image = createIndexed(W, H);
const palette: Rgba[] = TRAIN_PALETTE.slice(0, COLOR_COUNT);
// 電車の色番号を保ったまま、ポスターの色（src/styles/tokens.css と電車の 12 色に合わせる）を後ろに足す。
const add = (c: Rgba) => palette.push(c) - 1;
const BG = add([243, 234, 215, 255]); // --c-bg
const BG_DOT = add([233, 222, 198, 255]); // 地の点の模様（ごく薄く）
const PANEL = add([255, 253, 246, 255]); // --c-panel
const INK = add([32, 41, 49, 255]); // --c-ink
const INK_WEAK = add([107, 98, 80, 255]); // --c-ink-weak
const WEAK = add([185, 174, 150, 255]); // --c-weak
const SHADOW = add([214, 202, 176, 255]); // 影（地より少し濃い）
const ORANGE = add([240, 138, 44, 255]); // 電車の橙
const GREEN = add([47, 158, 91, 255]);
const BLUE = add([45, 95, 196, 255]);
const RED = add([217, 69, 61, 255]); // --c-alert
const WHITE = add([255, 255, 255, 255]);
const BLACK = add([0, 0, 0, 255]);
if (palette.length > 256) throw new Error("色が 256 を超えました");

fillRect(image, 0, 0, W, H, BG);
// 発車案内板の消灯ドットを思わせる、薄い点の模様（インクをほとんど使わない）
for (let y = 2; y < H; y += 6) for (let x = 2; x < W; x += 6) setPixel(image, x, y, BG_DOT);

// ---- 置き場所の検査 ----
type Box = { x: number; y: number; w: number; h: number; what: string };
const placed: Box[] = [];
/** 大事な要素の置き場所を登録する。余白にかかる・ほかの要素と重なるときは生成時にエラーにする */
function claim(what: string, x: number, y: number, w: number, h: number): void {
  if (x < SAFE || y < SAFE || x + w > W - SAFE || y + h > H - SAFE) {
    throw new Error(`紙の端から 10mm の余白にかかります: ${what}（${x},${y} ${w}×${h}）`);
  }
  for (const b of placed) {
    if (x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h) throw new Error(`「${what}」が「${b.what}」と重なります`);
  }
  placed.push({ x, y, w, h, what });
}

/** 文字の高さの最小（mm）。これより小さい文字は作らない */
const MIN_TEXT_MM = 3;
const textSizes = new Map<string, number>();

/** 1 行の文字を描く。フォントに無い文字・余白へのはみ出し・重なりは生成時にエラーにする */
function text(value: string, x: number, y: number, color: number, scale = 1): number {
  for (const ch of value) {
    if (!hasGlyph(font, ch.codePointAt(0)!)) throw new Error(`フォントに文字がありません: ${ch}（${value}）`);
  }
  const w = measureText(value, scale, { font });
  const h = font.height * scale;
  const mm = h * MM;
  if (mm < MIN_TEXT_MM) throw new Error(`文字が小さすぎます（${mm.toFixed(1)}mm）: ${value}`);
  claim(`文字「${value}」`, x, y, w, h);
  textSizes.set(`${value}（${scale} 倍）`, mm);
  drawText(image, x, y, value, scale, { color, font });
  return w;
}
const width = (value: string, scale = 1) => measureText(value, scale, { font });
function centered(value: string, cx: number, y: number, color: number, scale = 1): void {
  text(value, Math.round(cx - width(value, scale) / 2), y, color, scale);
}

/** 角を 1 段落とした四角（ドット絵の輪郭にそろえる） */
function box(x: number, y: number, w: number, h: number, color: number): void {
  fillRect(image, x + 1, y, w - 2, h, color);
  fillRect(image, x, y + 1, w, h - 2, color);
}
/** 枠つきの台紙（影 → 枠 → 中）。枠は線の太さ t */
function panel(x: number, y: number, w: number, h: number, fill: number, frame = INK, t = 2, shadow = 4): void {
  if (shadow) box(x + shadow, y + shadow, w, h, SHADOW);
  box(x, y, w, h, frame);
  box(x + t, y + t, w - 2 * t, h - 2 * t, fill);
}
/** 塗った円 */
function disc(cx: number, cy: number, r: number, color: number): void {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) setPixel(image, cx + dx, cy + dy, color);
}
/** 文字の絵（1 文字 = 1 ドット。"." は描かない）を貼る */
function art(rows: readonly string[], colors: Record<string, number>, x: number, y: number, scale = 1): void {
  rows.forEach((row, yy) => {
    for (let xx = 0; xx < row.length; xx++) {
      const ch = row[xx];
      if (ch === ".") continue;
      const c = colors[ch];
      if (c === undefined) throw new Error(`絵の色がありません: ${ch}`);
      fillRect(image, x + xx * scale, y + yy * scale, scale, scale, c);
    }
  });
}

// ---- 1. 見出し（全幅） ----
const TITLE = APP_NAME; // 「ドット路線メーカー」
const TITLE_SCALE = 5;
const titleW = width(TITLE, TITLE_SCALE);
const titleX = Math.round((W - titleW) / 2);
const titleY = 38;
// 橙の影を右下にずらして重ね、遠目でも太く見せる（影は文字の登録の外に描く）
drawText(image, titleX + 4, titleY + 4, TITLE, TITLE_SCALE, { color: ORANGE, font });
text(TITLE, titleX, titleY, INK, TITLE_SCALE);
// 見出しの両脇に線路の飾り（端の余白には入れない）
for (const [x0, x1] of [
  [SAFE, titleX - 14],
  [titleX + titleW + 14, W - SAFE],
] as const) {
  for (let x = x0 + 2; x < x1 - 2; x += 8) fillRect(image, x, titleY + 50, 3, 17, SHADOW);
  fillRect(image, x0, titleY + 52, x1 - x0, 3, WEAK);
  fillRect(image, x0, titleY + 62, x1 - x0, 3, WEAK);
}
const COPY = "えきを えらんで じぶんだけの路線と電車を つくろう！";
centered(COPY, W / 2, 130, INK, 2);

// ---- 2. QR の段（右） ----
const COL_X = 596;
const COL_W = W - SAFE - COL_X; // 251
const qr: QrMatrix = qrMatrix(url);
const QUIET = 4;
// 1 マスは 2mm 以上（6 ドット以上）。段の幅に入るいちばん大きいマスにする
const cell = Math.floor((COL_W - 4) / (qr.size + QUIET * 2));
const cellMm = cell * MM;
const qrMm = qr.size * cell * MM;
if (cellMm < 2 || qrMm < 60) {
  throw new Error(`URL が長く QR が細かくなりすぎます（${qr.size} マス、1 マス ${cellMm.toFixed(2)}mm、一辺 ${qrMm.toFixed(1)}mm）`);
}
const qrTotal = (qr.size + QUIET * 2) * cell; // 余白込み
const qrPanelX = COL_X + Math.floor((COL_W - (qrTotal + 4)) / 2);

// 呼びかけ（ふきだし）
const CALL1 = "スマホで";
const CALL2 = "よみとってね！";
const bubbleY = 174;
const bubbleH = 80;
panel(COL_X, bubbleY, COL_W, bubbleH, PANEL, RED, 3, 0);
// ふきだしのしっぽ（下向き、QR を指す）
for (let i = 0; i < 12; i++) {
  fillRect(image, COL_X + COL_W / 2 - 12 + i, bubbleY + bubbleH - 3 + i, 24 - 2 * i, 1, RED);
  if (i < 9) fillRect(image, COL_X + COL_W / 2 - 8 + i, bubbleY + bubbleH - 3 + i, 16 - 2 * i, 1, PANEL);
}
centered(CALL1, COL_X + COL_W / 2, bubbleY + 8, INK, 2);
centered(CALL2, COL_X + COL_W / 2, bubbleY + 42, RED, 2);

// QR 本体（白地に黒、まわりに 4 マスの白）
const qrPanelY = bubbleY + bubbleH + 16;
claim("QR コード", qrPanelX, qrPanelY, qrTotal + 4, qrTotal + 4);
box(qrPanelX + 4, qrPanelY + 4, qrTotal + 4, qrTotal + 4, SHADOW);
fillRect(image, qrPanelX, qrPanelY, qrTotal + 4, qrTotal + 4, INK);
fillRect(image, qrPanelX + 2, qrPanelY + 2, qrTotal, qrTotal, WHITE);
const qrX = qrPanelX + 2 + QUIET * cell;
const qrY = qrPanelY + 2 + QUIET * cell;
for (let r = 0; r < qr.size; r++) {
  for (let c = 0; c < qr.size; c++) if (qr.dark[r * qr.size + c]) fillRect(image, qrX + c * cell, qrY + r * cell, cell, cell, BLACK);
}
// 手で打てる短い URL
const SHORT_URL = "dot-rosen.na2kera.com";
const urlY = qrPanelY + qrTotal + 4 + 8;
centered(SHORT_URL, COL_X + COL_W / 2, urlY, INK_WEAK);
// 小さな注記
const NOTE1 = "むりょう・とうろくなし";
const NOTE2 = "いんさつは ひとり 1かい";
centered(NOTE1, COL_X + COL_W / 2, urlY + 26, INK);
centered(NOTE2, COL_X + COL_W / 2, urlY + 46, INK);

// ---- 3. あそびかた（左上、3 つの手順） ----
const STEP_Y = 174;
const STEP_W = 176;
const STEP_H = 112;
const STEP_GAP = 11;
const PHONE = [
  ".############.",
  "##############",
  "##wwwwwwwwww##",
  "##w###ww###w##",
  "##w#w#ww#w#w##",
  "##w###ww###w##",
  "##wwwwwwwwww##",
  "##ww#w#ww#ww##",
  "##w#ww#w#w#w##",
  "##w###wwww#w##",
  "##w#w#w##w#w##",
  "##w###ww#www##",
  "##wwwwwwwwww##",
  "##############",
  "######oo######",
  ".############.",
];
const TRAIN_ICON = [
  "..##########..",
  ".#llllllllll#.",
  "#llllllllllll#",
  "#l####ll####l#",
  "#l#ww#ll#ww#l#",
  "#l#ww#ll#ww#l#",
  "#l####ll####l#",
  "#llllllllllll#",
  "#gggggggggggg#",
  "#lyyllllllyyl#",
  "#lyyllllllyyl#",
  "#llllllllllll#",
  ".############.",
  "..##......##..",
  "..##......##..",
  "##############",
];
const PRINTER = [
  "....wwwwww....",
  "....w#w#ww....",
  "....wwwwww....",
  ".############.",
  "##############",
  "##ggggggggg###",
  "##############",
  "##########o###",
  "##############",
  ".##wwwwwwww##.",
  "...w##w#ww....",
  "...wwwwwwww...",
  "...w#w##w#w...",
  "...wwwwwwww...",
  "...ww#w##ww...",
  "...wwwwwwww...",
];
const steps: { color: number; head: string; lines: string[]; icon: (x: number, y: number) => void }[] = [
  {
    color: ORANGE,
    head: "よみとる",
    lines: ["スマホで", "QRコードを", "よむ"],
    icon: (x, y) => art(PHONE, { "#": INK, w: WHITE, o: ORANGE }, x, y, 2),
  },
  {
    color: GREEN,
    head: "つくる",
    lines: ["えきを えらんで", "電車を", "デザイン"],
    icon: (x, y) => art(TRAIN_ICON, { "#": INK, l: tones("lime").base, g: tones("green").base, w: C_GLASS2, y: C_LAMP }, x, y, 2),
  },
  {
    color: BLUE,
    head: "もらう",
    lines: ["プリンタで", "路線カードを", "いんさつ"],
    icon: (x, y) => art(PRINTER, { "#": INK, w: WHITE, g: GREEN, o: ORANGE }, x, y, 2),
  },
];
steps.forEach((s, i) => {
  const x = SAFE + 4 + i * (STEP_W + STEP_GAP);
  panel(x, STEP_Y, STEP_W, STEP_H, PANEL);
  // 番号（色の丸に白い数字）
  disc(x + 22, STEP_Y + 22, 15, s.color);
  text(String(i + 1), x + 22 - width(String(i + 1), 2) / 2, STEP_Y + 6, WHITE, 2);
  text(s.head, x + 44, STEP_Y + 6, s.color === GREEN ? GREEN : s.color, 2);
  s.lines.forEach((line, k) => text(line, x + 10, STEP_Y + 46 + k * 19, INK, 1));
  s.icon(x + STEP_W - 40, STEP_Y + 52);
});

// ---- 4. 電車（主役。顔のアップと編成） ----
const VIS_Y = STEP_Y + STEP_H + 12;
const base = defaultDesign();
const faces: TrainDesign[] = [
  brandFaceDesign(),
  {
    ...base,
    bodyColor: "sky",
    bandColor: "blue",
    face: { contour: "dome", window: "pano", door: "none", lightShape: "led", lightPos: "low", sign: "inwin", skirt: "large", paint: "plain" },
  },
  {
    ...base,
    bodyColor: "pink",
    bandColor: "purple",
    face: { contour: "taper", window: "two", door: "center", lightShape: "round", lightPos: "mid", sign: "top", skirt: "small", paint: "blackface" },
  },
];
const FACE_SCALE = 2;
faces.forEach((d, i) => {
  const img = renderFace(d);
  const x = SAFE + 6 + i * (img.width * FACE_SCALE + 6);
  claim(`電車の顔 ${i + 1}`, x, VIS_Y, img.width * FACE_SCALE, img.height * FACE_SCALE);
  blit(image, img, x, VIS_Y, { scale: FACE_SCALE, transparent: 0 });
});
// 編成（色違いを 2 本、前後にずらして）
const consists: TrainDesign[] = [
  {
    ...base,
    cars: 2,
    bodyColor: "yellow",
    bandColor: "red",
    side: { nose: "stream", window: "ribbon", doors: "two", roof: "panto", band: "two" },
    logo: { ...base.logo, fg: "red", bg: "yellow" },
  },
];
const consistY = VIS_Y + 76 * FACE_SCALE + 2;
for (const d of consists) {
  const img = renderConsist(d);
  claim("編成", SAFE + 6, consistY, img.width, img.height);
  blit(image, img, SAFE + 6, consistY, { transparent: 0 });
}

// 実在の駅（4 都県から 1 つずつ）を路線図ふうに並べる
const stations = loadStations(ROOT);
const LINE_STATIONS = ["大宮", "新宿", "東京", "横浜", "千葉"];
for (const name of LINE_STATIONS) {
  if (!stations.stations.some((s) => s.name === name)) throw new Error(`駅が見つかりません: ${name}`);
}

// ---- 5. 路線カードの見本（出力の画像に等倍で重ねる） ----
const kit = new FixtureKit(font, stations);
const sampleRoute = kit.route({
  name: "ドット本線",
  symbol: "DR",
  lineColor: "orange",
  stations: ["大宮", "東京", "横浜"],
  train: { ...consists[0], cars: 4 },
});
const cardInput = kit.input(sampleRoute, { issuedOn: "2026.11.21", url: SAMPLE_URL });
const card = renderCardPrint(cardInput);
// 見本の QR はポスターの本物と紛らわしくならないよう、読めない薄い模様に描き替える
const cardQr = layoutCard(cardInput).ops.find((op) => op.k === "qr");
if (!cardQr || cardQr.k !== "qr") throw new Error("見本のカードに QR の段がありません");
// カードは 4 で割り切れる高さに切りそろえ、元画像の格子に合わせる
const cardH = Math.floor(card.height / SCALE) * SCALE;
const CARD_X = 476; // 元画像のドット
const CARD_Y = VIS_Y + 22;
const cardWb = CARD_WIDTH / SCALE; // 96
const cardHb = cardH / SCALE;
if (CARD_Y + cardHb + 8 > H - SAFE) throw new Error(`カードの見本が下にはみ出します（高さ ${cardHb}）`);
claim("路線カードの見本", CARD_X, CARD_Y, cardWb, cardHb + 8);
// 影と、レシートのようなぎざぎざの下端（カードの外側は元画像に描く）
fillRect(image, CARD_X + 5, CARD_Y + 5, cardWb, cardHb, SHADOW);
for (let x = 0; x < cardWb; x++) {
  const d = 4 - Math.abs((x % 8) - 4); // 0..4 の山
  fillRect(image, CARD_X + x + 5, CARD_Y + cardHb + 5, 1, d + 1, SHADOW);
}
for (let x = 0; x < cardWb; x++) fillRect(image, CARD_X + x, CARD_Y + cardHb, 1, 4 - Math.abs((x % 8) - 4) + 1, WHITE);
// 「これが もらえる！」の札（カードの右端にそろえる）
const GET = "これが もらえる！";
const getW = width(GET);
const getX = CARD_X + cardWb + 6 - (getW + 12);
// 札はカードの上に少しかかるので、札の文字だけ登録する
box(getX, VIS_Y - 4, getW + 12, 24, RED);
text(GET, getX + 6, VIS_Y, WHITE);

// ---- 6. 路線図（下段） ----
const lineY = consistY + 64 + 10;
const LINE_X0 = SAFE + 24;
const LINE_X1 = CARD_X - 24;
const CAPTION = "東京・神奈川・埼玉・千葉の ほんものの えきから えらべる";
centered(CAPTION, (LINE_X0 + LINE_X1) / 2, lineY - 2, INK_WEAK);
const railY = lineY + 26;
fillRect(image, LINE_X0, railY - 2, LINE_X1 - LINE_X0, 5, ORANGE);
LINE_STATIONS.forEach((name, i) => {
  const x = Math.round(LINE_X0 + ((LINE_X1 - LINE_X0) * i) / (LINE_STATIONS.length - 1));
  disc(x, railY, 7, INK);
  disc(x, railY, 4, PANEL);
  centered(name, x, railY + 10, INK);
});

// ---- 書き出し ----
const OW = W * SCALE;
const OH = H * SCALE;
const rgba = indexedToRgba(image, palette, SCALE);
// カードの見本を等倍で重ねる（紙は白、印字は濃い色）
const cardRgba = bitToRgba(card, [40, 42, 52, 255], [255, 255, 255, 255]);
const qrBox = { x: cardQr.x, y: cardQr.y, s: cardQr.m.size * cardQr.cell };
const rng = createRng(20261121);
const fakeMod = cardQr.cell;
const fake = new Uint8Array(cardQr.m.size * cardQr.m.size).map(() => (rng() < 0.45 ? 1 : 0));
for (let y = 0; y < cardH; y++) {
  for (let x = 0; x < CARD_WIDTH; x++) {
    let c: Rgba = [cardRgba[(y * CARD_WIDTH + x) * 4], cardRgba[(y * CARD_WIDTH + x) * 4 + 1], cardRgba[(y * CARD_WIDTH + x) * 4 + 2], 255];
    // 見本の QR の範囲は、薄い灰色の でたらめな点にする（読み取れない）
    if (x >= qrBox.x && x < qrBox.x + qrBox.s && y >= qrBox.y && y < qrBox.y + qrBox.s) {
      const mc = Math.floor((x - qrBox.x) / fakeMod);
      const mr = Math.floor((y - qrBox.y) / fakeMod);
      c = fake[mr * cardQr.m.size + mc] ? [214, 214, 210, 255] : [255, 255, 255, 255];
    }
    const o = ((CARD_Y * SCALE + y) * OW + CARD_X * SCALE + x) * 4;
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = 255;
  }
}
// 札（これが もらえる！）はカードの上に重ねたいので、札の部分だけ描き直す
{
  const x0 = getX * SCALE;
  const y0 = (VIS_Y - 4) * SCALE;
  for (let y = y0; y < y0 + 24 * SCALE; y++) {
    for (let x = x0; x < x0 + (getW + 12) * SCALE; x++) {
      const src = image.data[Math.floor(y / SCALE) * W + Math.floor(x / SCALE)];
      const c = palette[src];
      const o = (y * OW + x) * 4;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = 255;
    }
  }
}

const png = encodePng(OW, OH, rgba, deflateSync);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);

// ---- 報告 ----
console.log(`${path.relative(ROOT, out)}: ${OW}×${OH}（A4 横 300dpi）, ${png.byteLength} bytes`);
console.log(
  `QR: ${qr.size} マス（型番 ${(qr.size - 17) / 4}）、1 マス ${cell} ドット × ${SCALE} = ${cell * SCALE}px = ${cellMm.toFixed(2)}mm、` +
    `一辺 ${qrMm.toFixed(1)}mm（余白込み ${(qrTotal * MM).toFixed(1)}mm）、位置 x=${qrX * SCALE} y=${qrY * SCALE} px（出力の画像）`,
);
console.log(`路線カードの見本: ${CARD_WIDTH}×${cardH}px = ${((CARD_WIDTH * 297) / OW).toFixed(1)}×${((cardH * 297) / OW).toFixed(1)}mm`);
const sizes = [...textSizes.entries()].sort((a, b) => a[1] - b[1]);
console.log(`文字の高さ（行の高さ、mm）: 最小 ${sizes[0][1].toFixed(1)} 〜 最大 ${sizes[sizes.length - 1][1].toFixed(1)}`);
for (const [s, mm] of sizes) console.log(`  ${mm.toFixed(1)}mm  ${s}`);
