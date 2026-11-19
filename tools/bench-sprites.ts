// 電車の描画の速さを測る。
//   pnpm sprites:bench
// 印刷の申し込みでサーバーが行う処理（顔1つ・側面2両・それぞれの白黒変換）を、
// 新しいプロセスでの最初の1回と、100 回の平均で測る。
// 顔は 3 倍、側面は等倍で白黒にする（2 倍も別に測る）。

import { execFileSync } from "node:child_process";

const now = () => performance.now();

// 引数なしで呼ぶと、新しいプロセスで 7 回測って中央値を出す
if (!process.env.BENCH_CHILD) {
  const runs = Array.from({ length: 7 }, () =>
    JSON.parse(execFileSync(process.execPath, [process.argv[1]], { env: { ...process.env, BENCH_CHILD: "1" } }).toString()) as Record<string, number>,
  );
  const med = (k: string) => {
    const v = runs.map((r) => r[k]).sort((a, b) => a - b);
    return `中央値 ${v[3].toFixed(2)} ms（最小 ${v[0].toFixed(2)}、最大 ${v[6].toFixed(2)}）`;
  };
  console.log(`Node ${process.version}、新しいプロセスで 7 回`);
  console.log(`モジュールの読み込みと初期化: ${med("importMs")}`);
  console.log(`最初の1回（顔 + 側面2両 + それぞれ白黒。顔3倍・側面等倍）: ${med("firstMs")}`);
  console.log(`その次の1回（別のデザイン、側面2倍）: ${med("first2xMs")}`);
  console.log(`100 回の平均（側面 等倍）: ${med("avgMs")}`);
  console.log(`100 回の平均（側面 2倍）: ${med("avg2xMs")}`);
  process.exit(0);
}

const tImport = now();
const T = await import("../shared/train/index.ts");
const importMs = now() - tImport;

type Design = ReturnType<typeof T.defaultDesign>;

function job(design: Design, sideScale: number): number {
  const face = T.renderFace(design);
  const lead = T.renderCar(design, "lead");
  const second = T.renderCar(design, design.cars >= 3 ? "middle" : "tail");
  let ink = 0;
  ink += T.toMono(face, 3).data[0];
  ink += T.toMono(lead, sideScale).data[0];
  ink += T.toMono(second, sideScale).data[0];
  return ink;
}

// 最初の1回（JIT が温まる前）
const first = T.defaultDesign();
const t1 = now();
job(first, 1);
const firstMs = now() - t1;

// 2 倍の最初の1回（等倍の後なので、完全に冷えた状態ではない）
const t2 = now();
job(T.randomDesign(T.createRng(7)), 2);
const first2xMs = now() - t2;

// 100 回の平均（毎回違うデザイン）
const rng = T.createRng(12345);
const designs = Array.from({ length: 100 }, () => T.randomDesign(rng, { ...first, cars: 8 }));
let sink = 0;
const t3 = now();
for (const d of designs) sink += job(d, 1);
const avgMs = (now() - t3) / designs.length;
const t4 = now();
for (const d of designs) sink += job(d, 2);
const avg2xMs = (now() - t4) / designs.length;

process.stdout.write(JSON.stringify({ importMs, firstMs, first2xMs, avgMs, avg2xMs, sink }));
