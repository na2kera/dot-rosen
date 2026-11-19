// 印刷用の路線カード（renderCardPrint）の速さを測る。
//   pnpm card:bench
// サーバーが印刷の申し込みで行う処理（30 駅のカードを白黒で組み立てて生データにする）を、
// 新しいプロセスでの最初の1回と、100 回の平均で測る。新しいプロセスで 7 回測って中央値を出す。
// 最初の1回の内訳（配置、白黒の描画、そのうち電車の白黒変換、QR）も測る。
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/paths.ts";

const now = () => performance.now();

if (!process.env.BENCH_CHILD) {
  const child = (mode: string) =>
    JSON.parse(execFileSync(process.execPath, [process.argv[1]], { env: { ...process.env, BENCH_CHILD: mode } }).toString()) as Record<string, number>;
  const runs = Array.from({ length: 7 }, () => ({ ...child("1"), ...child("2") }));
  const med = (k: string) => {
    const v = runs.map((r) => r[k]).sort((a, b) => a - b);
    return `中央値 ${v[3].toFixed(2)} ms（最小 ${v[0].toFixed(2)}、最大 ${v[6].toFixed(2)}）`;
  };
  console.log(`Node ${process.version}、新しいプロセスで 7 回`);
  console.log(`モジュールの読み込み: ${med("importMs")}`);
  console.log(`フォントの読み込み（parseBitmapFont）: ${med("fontMs")}`);
  console.log(`最初の1回（30 駅・環状・two-x1・bold、cardRaster まで）: ${med("firstMs")}`);
  console.log(`最初の1回の内訳（別の新しいプロセスで、各段階を冷えた状態から順に測った値）:`);
  console.log(`  QR（qrMatrix）: ${med("cQr")}`);
  console.log(`  配置（layoutCard、QR なし。電車の色番号画像を含む）: ${med("cLayout")}`);
  console.log(`  白黒の描画: 電車（toMono と重ね合わせ）: ${med("cSprites")}`);
  console.log(`  白黒の描画: 文字: ${med("cText")}`);
  console.log(`  白黒の描画: 塗り・点線・QR のマス: ${med("cRest")}`);
  console.log(`最初の1回（30 駅・two-x2-rotated、上の後）: ${med("rotFirstMs")}`);
  console.log(`100 回の平均（30 駅・two-x1）: ${med("avgMs")}`);
  console.log(`100 回の平均（30 駅・two-x2-rotated）: ${med("avgRotMs")}`);
  process.exit(0);
}

if (process.env.BENCH_CHILD === "2") {
  const card = await import("../shared/card/index.ts");
  const render = await import("../shared/card/render.ts");
  const fx = await import("./lib/card-fixtures.ts");
  const font = fx.loadFont(ROOT);
  const kit = new fx.FixtureKit(font, fx.loadStations(ROOT));
  const input = fx.cardFixtures(kit).find((f) => f.id === "loop-30st")!.input;
  const r: Record<string, number> = {};
  let t = now();
  card.qrMatrix(fx.SAMPLE_URL);
  r.cQr = now() - t;
  t = now();
  const L = card.layoutCard({ ...input, url: undefined });
  r.cLayout = now() - t;
  const part = (ks: string[]) => {
    const t1 = now();
    render.paintPrint({ ...L, ops: L.ops.filter((o) => ks.includes(o.k)) }, font, "bold");
    return now() - t1;
  };
  r.cSprites = part(["sprite"]);
  r.cText = part(["text"]);
  r.cRest = part(["rect", "dots", "qr"]);
  process.stdout.write(JSON.stringify(r));
  process.exit(0);
}

const t0 = now();
const card = await import("../shared/card/index.ts");
const fx = await import("./lib/card-fixtures.ts");
const importMs = now() - t0;

const stations = fx.loadStations(ROOT);
const tf = now();
const font = fx.loadFont(ROOT);
const fontMs = now() - tf;
const kit = new fx.FixtureKit(font, stations);
const list = fx.cardFixtures(kit);
const loop = list.find((f) => f.id === "loop-30st")!.input;
const long = list.find((f) => f.id === "long-30st-16car")!.input;

let sink = 0;
const t1 = now();
sink += card.cardRaster(card.renderCardPrint(loop)).length;
const firstMs = now() - t1;

const rot = { ...long, sideLayout: "two-x2-rotated" as const };
const t2 = now();
sink += card.renderCardPrint(rot).height;
const rotFirstMs = now() - t2;

const t3 = now();
for (let i = 0; i < 100; i++) sink += card.cardRaster(card.renderCardPrint(i % 2 ? loop : long)).length;
const avgMs = (now() - t3) / 100;
const t4 = now();
for (let i = 0; i < 100; i++) sink += card.renderCardPrint(rot).height;
const avgRotMs = (now() - t4) / 100;

process.stdout.write(JSON.stringify({ importMs, fontMs, firstMs, rotFirstMs, avgMs, avgRotMs, sink }));
