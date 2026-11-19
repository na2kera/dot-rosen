// 路線カードの確認用の画像を tools/out/card/ に書き出す。
//   pnpm card:sheet
// 印刷用は等倍（-print.png）と2倍（-print-x2.png）、カラー版は2倍（-color-x2.png）。
// 目で確かめるため、2倍の画像を縦 640 ドットずつに切ったものを review/ に出す。
// 実機で刷り比べるための生データ（.bin、1行 48 バイト、ヘッダなし）を代表の3枚ぶん出す。高さはファイル名に入れる。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { cardRaster, renderCardColor, renderCardPrint, type CardInput } from "../shared/card/index.ts";
import { bitToRgba, encodePng, indexedToRgba } from "../shared/pix/index.ts";
import { parseRouteData, type StationLookup } from "../shared/route/index.ts";
import { defaultDesign } from "../shared/train/index.ts";
import { cardFixtures, FixtureKit, loadFont, loadStations, type CardFixture } from "./lib/card-fixtures.ts";
import { ROOT } from "./lib/paths.ts";

const OUT = path.join(ROOT, "tools/out/card");
const REVIEW = path.join(OUT, "review");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(REVIEW, { recursive: true });

const kit = new FixtureKit(loadFont(ROOT), loadStations(ROOT));
const deflate = (d: Uint8Array) => zlib.deflateSync(d);
const png = (file: string, w: number, h: number, rgba: Uint8Array) => fs.writeFileSync(file, encodePng(w, h, rgba, deflate));

/** RGBA を縦 rows ドットずつに切って保存する */
function slices(name: string, w: number, h: number, rgba: Uint8Array, rows = 640): void {
  for (let i = 0, y = 0; y < h; i++, y += rows) {
    const hh = Math.min(rows, h - y);
    png(path.join(REVIEW, `${name}-${String(i + 1).padStart(2, "0")}.png`), w, hh, rgba.subarray(y * w * 4, (y + hh) * w * 4));
  }
}

// 駅名が極端に長い（「…」になる）場合と、駅が見つからない場合を確かめる架空の駅
const FAKE: Record<string, { name: string; lat: number; lon: number }> = {
  x1: { name: "とてもとてもながいながい名前の駅前ターミナル中央口", lat: 35.6, lon: 139.6 },
  x2: { name: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm", lat: 35.62, lon: 139.62 },
  x3: { name: "新宿", lat: 35.69, lon: 139.7 },
};
const fakeLookup: StationLookup = (id) => FAKE[id] ?? kit.lookup(id);
const fakeRoute = parseRouteData(
  { v: 1, name: "ＷＷＷＷＷＷＷＷＷＷＷＷ", symbol: "WW", lineColor: "yellow", stations: ["x1", "x2", "x3"], loop: true, train: { ...defaultDesign(), cars: 16 } },
  fakeLookup,
);
if (!fakeRoute.ok) throw new Error(fakeRoute.error);

const list: CardFixture[] = [
  ...cardFixtures(kit),
  { id: "edge-ellipsis", label: "架空の極端に長い駅名", input: { ...kit.input(fakeRoute.value), lookup: fakeLookup } },
  { id: "edge-long-url", label: "長い URL（QR が大きい）", input: { ...cardFixtures(kit)[0].input, url: "https://dot-rosen.example.workers.dev/r/" + "Qk7xZp2LmN9aRt4V".repeat(5) } },
];

const BIN = new Set(["short-2st-1car", "long-30st-16car", "loop-30st"]);
const report: string[] = [];
for (const f of list) {
  const input: CardInput = f.input;
  const bit = renderCardPrint(input);
  png(path.join(OUT, `${f.id}-print.png`), bit.width, bit.height, bitToRgba(bit));
  const big = bitToRgba(bit, undefined, undefined, 2);
  png(path.join(OUT, `${f.id}-print-x2.png`), bit.width * 2, bit.height * 2, big);
  slices(`${f.id}-print`, bit.width * 2, bit.height * 2, big);
  const { image, palette } = renderCardColor(input);
  const col = indexedToRgba(image, palette, 2);
  png(path.join(OUT, `${f.id}-color-x2.png`), image.width * 2, image.height * 2, col);
  slices(`${f.id}-color`, image.width * 2, image.height * 2, col);
  if (BIN.has(f.id)) fs.writeFileSync(path.join(OUT, `${f.id}-h${bit.height}.bin`), cardRaster(bit));
  report.push(`${f.id}\t高さ ${bit.height}\t${f.label}`);
}
fs.writeFileSync(path.join(OUT, "heights.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
