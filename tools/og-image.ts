// OGP 用の画像を既存の電車・フォントで描く。600×315 を最近傍で2倍にする。
// 実行: node tools/run.mjs tools/og-image.ts
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { drawText, hasGlyph, measureText } from "../shared/font/index.ts";
import { blit, createIndexed, encodePng, fillRect, indexedToRgba, type Rgba } from "../shared/pix/index.ts";
import { COLOR_COUNT, defaultDesign, renderConsist, renderFace, TRAIN_PALETTE, type TrainDesign } from "../shared/train/index.ts";
import { loadFont, loadStations } from "./lib/card-fixtures.ts";
import { ROOT } from "./lib/paths.ts";

const W = 600;
const H = 315;
const SCALE = 2;
const font = loadFont(ROOT);
const image = createIndexed(W, H);
const palette: Rgba[] = TRAIN_PALETTE.slice(0, COLOR_COUNT);
// 電車の色番号を保ち、画面の色変数に合わせた台紙の色を後ろに追加する。
const BG = palette.push([20, 22, 28, 255]) - 1;
const DOT = palette.push([31, 35, 43, 255]) - 1;
const PAPER = palette.push([243, 234, 215, 255]) - 1;
const INK = palette.push([32, 41, 49, 255]) - 1;
const ORANGE = palette.push([255, 157, 46, 255]) - 1;
const GREEN = palette.push([125, 252, 138, 255]) - 1;
const MUTED = palette.push([185, 174, 150, 255]) - 1;
fillRect(image, 0, 0, W, H, BG);

function text(value: string, x: number, y: number, color: number, scale = 1): void {
  // 文字の欠落や、意図しない画面外へのはみ出しは生成時に検出する。
  for (const ch of value) {
    if (!hasGlyph(font, ch.codePointAt(0)!)) throw new Error(`フォントに文字がありません: ${ch}`);
  }
  if (x < 0 || x + measureText(value, scale, { font }) > W || y < 0 || y + font.height * scale > H) {
    throw new Error(`文字が画像からはみ出します: ${value}`);
  }
  drawText(image, x, y, value, scale, { color, font });
}

function centered(value: string, center: number, y: number, color: number, scale = 1): void {
  text(value, Math.round(center - measureText(value, scale, { font }) / 2), y, color, scale);
}

// 発車案内板の消灯ドット。文字の背景にだけ控えめに並べる。
for (let y = 12; y < 107; y += 4) {
  for (let x = 24; x < W - 24; x += 4) fillRect(image, x, y, 1, 1, DOT);
}
centered("えらぶ・つくる・プリント", W / 2, 12, GREEN);
centered("ドット路線メーカー", W / 2, 35, ORANGE, 3);
centered("えきをつないで、じぶんだけの電車をつくろう。", W / 2, 89, PAPER);

// 台紙は角を段にして、ドット絵の輪郭にそろえる。
fillRect(image, 36, 116, 528, 144, PAPER);
fillRect(image, 32, 120, 536, 136, PAPER);
const base = defaultDesign();
const orange: TrainDesign = {
  ...base,
  cars: 1,
  bodyColor: "orange",
  bandColor: "green",
  face: { ...base.face, contour: "round", window: "three", lightShape: "square" },
};
const green: TrainDesign = {
  ...base,
  cars: 2,
  bodyColor: "lime",
  bandColor: "green",
  logo: { ...base.logo, fg: "green" },
};
const blue: TrainDesign = {
  ...base,
  cars: 2,
  bodyColor: "sky",
  bandColor: "blue",
  side: { ...base.side, nose: "stream", window: "ribbon", doors: "two", band: "two" },
  logo: { ...base.logo, fg: "blue" },
};
// 正面を大きく、側面は2両ずつ並べ、顔・形・色の違いを見せる。
blit(image, renderFace(orange), 44, 108, { scale: 2, transparent: 0 });
blit(image, renderConsist(green), 178, 121, { transparent: 0 });
blit(image, renderConsist(blue), 178, 185, { transparent: 0 });
text("01", 180, 128, INK);
text("02", 180, 192, INK);

// 駅名は実在駅データから取得。地理座標ではなく案内板の模式図として等間隔に配置する。
const stations = loadStations(ROOT);
const names = ["新宿", "渋谷", "品川", "東京"].map((name) => {
  const station = stations.stations.find((s) => s.name === name);
  if (!station) throw new Error(`駅が見つかりません: ${name}`);
  return station.name;
});
fillRect(image, 60, 274, 480, 4, ORANGE);
names.forEach((name, i) => {
  const x = 84 + i * 144;
  // 丸い駅の輪郭も整数の点だけで描く。
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const r2 = dx * dx + dy * dy;
      if (r2 <= 36) fillRect(image, x + dx, 276 + dy, 1, 1, r2 <= 9 ? BG : PAPER);
    }
  }
  centered(name, x, 283, PAPER);
});
text("DR", 39, 267, ORANGE);
// 端の装飾は切り落とされても、タイトルや駅名には影響しない。
fillRect(image, 32, 307, 536, 1, DOT);
fillRect(image, 32, 307, 32, 1, MUTED);

const width = W * SCALE;
const height = H * SCALE;
const png = encodePng(width, height, indexedToRgba(image, palette, SCALE), deflateSync);
if (png.byteLength > 300 * 1024) throw new Error(`画像が大きすぎます: ${png.byteLength} bytes`);
const output = path.join(ROOT, "public/og.png");
fs.writeFileSync(output, png);
console.log(`public/og.png: ${width}×${height}, ${png.byteLength} bytes`);
