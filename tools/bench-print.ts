// POST /api/print でサーバーが行う計算の時間を Node 上で測る（D1 の待ち時間は含めない）。
//   node tools/run.mjs tools/bench-print.ts
// 新しいプロセスでの最初の1回と、100 回の平均を、7 プロセスの中央値で出す。
// 測るもの: 本文の JSON 解析と入力の検査、保存済みの路線データの解析と検査（駅の引き当てを含む）、
// 路線カードの描画（worker/lib/card.ts が呼ぶもの）、生データへの変換、snapshot の JSON 化。
// 起動時の処理（駅データの JSON 解析と引き当て表、フォントの読み込み）は別に測る。
// 続けて、起動時の温め（worker/lib/warmup.ts）を N 回したあとの「別の路線の最初の1回」と、温め自体の合計を
// N = 0, 1, 2, 4, 8, 16 で測る（それぞれ新しいプロセスで 7 回の中央値）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { StationsFile } from "../shared/geo/map-data.ts";
import { ROOT } from "./lib/paths.ts";

const now = () => performance.now();

const child = (extra: Record<string, string> = {}) =>
  JSON.parse(execFileSync(process.execPath, [process.argv[1]], { env: { ...process.env, BENCH_CHILD: "1", ...extra } }).toString()) as Record<
    string,
    number
  >;

if (!process.env.BENCH_CHILD) {
  const runs = Array.from({ length: 7 }, () => child());
  const med = (k: string) => {
    const v = runs.map((r) => r[k]).sort((a, b) => a - b);
    return `中央値 ${v[3].toFixed(2)} ms（最小 ${v[0].toFixed(2)}、最大 ${v[6].toFixed(2)}）`;
  };
  console.log(`Node ${process.version}、新しいプロセスで 7 回。路線は 30 駅・16 両・路線名 12 文字（重い場合）`);
  console.log(`起動時（駅データの解析と引き当て表、フォント）: ${med("initMs")}`);
  console.log(`最初の1回 合計: ${med("firstTotal")}`);
  console.log(`  うち 本文の解析と検査: ${med("firstParse")}`);
  console.log(`  うち 路線カードの描画: ${med("firstRender")}`);
  console.log(`  うち 生データへの変換: ${med("firstRaster")}`);
  console.log(`100 回の平均 合計: ${med("avgTotal")}`);
  console.log(`  うち 本文の解析と検査: ${med("avgParse")}`);
  console.log(`  うち 路線カードの描画: ${med("avgRender")}`);
  console.log(`  うち 生データへの変換: ${med("avgRaster")}`);
  console.log(`画像の高さ: ${runs[0].height} 行（${runs[0].height * 48} バイト）`);
  console.log("");
  console.log("起動時の温め N 回のあと、別の路線の最初の1回（POST /api/print の計算の合計）と、温めの合計。7 回の中央値（最小〜最大）ms");
  console.log("| N | 別の路線の最初の1回 | 温めの合計 |");
  console.log("|---|---|---|");
  for (const n of [0, 1, 2, 4, 8, 16]) {
    const w = Array.from({ length: 7 }, () => child({ BENCH_WARM: String(n) }));
    const m = (k: string) => {
      const v = w.map((r) => r[k]).sort((a, b) => a - b);
      return `${v[3].toFixed(2)}（${v[0].toFixed(2)}〜${v[6].toFixed(2)}）`;
    };
    console.log(`| ${n} | ${m("afterMs")} | ${m("warmTotalMs")} |`);
  }
  process.exit(0);
}

const { createResources } = await import("../worker/lib/resources.ts");
const card = await import("../worker/lib/card.ts");
const { warmUpCard } = await import("../worker/lib/warmup.ts");
const { parseRouteData, defaultRouteDraft } = await import("../shared/route/index.ts");
const { defaultDesign } = await import("../shared/train/index.ts");

const stationsText = fs.readFileSync(path.join(ROOT, "public/data/stations.json"), "utf8");
const fontBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, "public/fonts/dotgothic16.bin")));
const t0 = now();
const stationsFile = JSON.parse(stationsText) as StationsFile;
const res = createResources(stationsFile, fontBytes);
const initMs = now() - t0;

// 測る路線: 駅名の長い 30 駅・16 両（温めの路線とは駅もデザインも違う）
const ids = stationsFile.stations
  .slice()
  .sort((a, b) => [...b.name].length - [...a.name].length)
  .slice(0, 30)
  .map((s) => s.id);
const route = { ...defaultRouteDraft(), name: "ながいながい路線名テスト線", symbol: "NG", stations: ids, train: { ...defaultDesign(), cars: 16 } };
route.name = [...route.name].slice(0, 12).join("");
const body = JSON.stringify({ routeId: "AAAAAAAAAAAAAAAA", editKey: "k".repeat(32), eventCode: "ABCDEFGHJK", clientId: "c".repeat(32), requestId: "r".repeat(32), rev: "0123456789abcdef" });
const stored = JSON.stringify(parseRouteData(route, res.lookup).ok ? route : null);

function once() {
  const a = now();
  const b0 = JSON.parse(body) as Record<string, string>;
  for (const k of Object.keys(b0)) if (!/^[A-Za-z0-9_-]+$/.test(b0[k])) throw new Error(k);
  const parsed = parseRouteData(JSON.parse(stored), res.lookup);
  if (!parsed.ok) throw new Error(parsed.error);
  const snapshot = {
    route: parsed.value,
    rev: b0.rev,
    issuedOn: "2026.11.20",
    expiresOn: "12月20日",
    url: "https://dot-rosen.example/r/AAAAAAAAAAAAAAAA",
    appName: "ドット路線メーカー",
    monoSet: "bold" as const,
    sideLayout: "two-x1" as const,
  };
  JSON.stringify(snapshot);
  const b = now();
  // buildCardRaster の中身を分けて測る（描画 → 生データ）
  const t = card.timedBuild(snapshot, 42, res);
  const c = now();
  return { parse: b - a, render: t.renderMs, raster: t.rasterMs, total: c - a, height: t.height };
}

if (process.env.BENCH_WARM !== undefined) {
  const n = Number(process.env.BENCH_WARM);
  const allIds = stationsFile.stations.map((s) => s.id);
  const w0 = now();
  warmUpCard(res, allIds, { monoSet: "bold", sideLayout: "two-x1" }, n);
  const warmTotalMs = now() - w0;
  const after = once();
  console.log(JSON.stringify({ warmTotalMs, afterMs: after.total }));
  process.exit(0);
}

const first = once();
let sum = { parse: 0, render: 0, raster: 0, total: 0 };
for (let i = 0; i < 100; i++) {
  const r = once();
  sum = { parse: sum.parse + r.parse, render: sum.render + r.render, raster: sum.raster + r.raster, total: sum.total + r.total };
}
console.log(
  JSON.stringify({
    initMs,
    firstTotal: first.total,
    firstParse: first.parse,
    firstRender: first.render,
    firstRaster: first.raster,
    avgTotal: sum.total / 100,
    avgParse: sum.parse / 100,
    avgRender: sum.render / 100,
    avgRaster: sum.raster / 100,
    height: first.height,
  }),
);
