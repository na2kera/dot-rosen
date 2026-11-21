// 路線ごとの X 用の絵（shared/og）の見本を tools/out/og/ に書き出す。
//   pnpm og:sheet
// 書き出しは Worker と同じ非同期の関数（CompressionStream）を使う。最後に、30 駅・最大両数・最長の名前で
// 描画から圧縮までの時間を測って出す。
import fs from "node:fs";
import path from "node:path";
import { OG_H, OG_SCALE, OG_W, renderRouteOg, routeOgPng } from "../shared/og/index.ts";
import { FixtureKit, loadFont, loadStations } from "./lib/card-fixtures.ts";
import { ogFixtures } from "./lib/og-fixtures.ts";
import { ROOT } from "./lib/paths.ts";

const OUT = path.join(ROOT, "tools/out/og");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const kit = new FixtureKit(loadFont(ROOT), loadStations(ROOT));
const fixtures = ogFixtures(kit);
for (const f of fixtures) {
  const png = await routeOgPng({ route: f.route, lookup: kit.lookup, font: kit.font });
  fs.writeFileSync(path.join(OUT, `${f.id}.png`), png);
  console.log(`${f.id}.png  ${OG_W * OG_SCALE}×${OG_H * OG_SCALE}  ${png.byteLength} bytes  ${f.label}`);
}

// 時間の計測（30 駅・最大両数・最長の名前）。最初の数回は温め
const heavy = fixtures.find((f) => f.id === "04-30st-max")!;
const input = { route: heavy.route, lookup: kit.lookup, font: kit.font };
for (let i = 0; i < 5; i++) await routeOgPng(input);
const N = 30;
let render = 0;
let total = 0;
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  renderRouteOg(input);
  const t1 = performance.now();
  await routeOgPng(input);
  const t2 = performance.now();
  render += t1 - t0;
  total += t2 - t1;
}
console.log(`時間（Node ${process.version}、${N} 回の平均）: 描画 ${(render / N).toFixed(2)}ms、描画から圧縮まで ${(total / N).toFixed(2)}ms`);
