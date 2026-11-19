// 路線カードの描画の「空打ち」（JIT を温める）。
// Worker の起動時（モジュールの読み込み時）に worker/index.ts から1回だけ呼ぶ。起動時の処理は
// 1リクエストの CPU 時間（無料枠 10ms）とは別枠なので、最初の印刷の申し込みが重くならないようにここで温める。
// テスト（worker/app.ts を直接使う）では呼ばない。
//
// グローバルスコープで使えない API（crypto.getRandomValues、Date.now()、fetch、タイマー）は使わない。
// 乱数は固定の種、日付と URL は固定の文字列。
import type { RouteData } from "../../shared/route/index.ts";
import { COLOR_IDS, createRng, defaultDesign, randomDesign, type Rng } from "../../shared/train/index.ts";
import { buildCardRaster } from "./card.ts";
import { APP_NAME, type MonoSet, type SideLayout } from "./config.ts";
import type { Resources } from "./types.ts";

/**
 * 起動時に描く回数（tools/bench-print.ts の測定で決めた）。
 * 4 回で「別の路線の最初の1回」が中央値 4.2ms・最大 5.1ms、8 回で中央値 3.5ms・最大 4.8ms（温めの合計は約 65ms）。
 * 無料枠の 10ms に対して余裕を持たせるため 8 にしている。
 */
export const WARMUP_COUNT = 8;

const NAMES = ["あおぞら線", "Dot本線", "みなとみらい環状線", "ゆうやけ線", "KR", "ほしぞら急行線"];
// 駅数・両数・環状の組み合わせ（順に回す）
const SHAPES: { stations: number; cars: number; loop: boolean }[] = [
  { stations: 30, cars: 16, loop: false },
  { stations: 2, cars: 1, loop: false },
  { stations: 15, cars: 8, loop: true },
  { stations: 30, cars: 3, loop: true },
  { stations: 7, cars: 12, loop: false },
];

function pickStations(rng: Rng, ids: readonly string[], n: number): string[] {
  const out = new Set<string>();
  while (out.size < Math.min(n, ids.length)) out.add(ids[Math.floor(rng() * ids.length)]);
  return [...out];
}

/** 温め用の路線（i 番目）。同じ種なら毎回同じものになる */
export function warmupRoute(rng: Rng, stationIds: readonly string[], i: number): RouteData {
  const shape = SHAPES[i % SHAPES.length];
  const train = { ...randomDesign(rng, defaultDesign()), cars: shape.cars };
  const name = [...NAMES[i % NAMES.length]].slice(0, 12).join("");
  return {
    v: 1,
    name,
    symbol: String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + ((i * 7) % 26)),
    lineColor: COLOR_IDS[Math.floor(rng() * COLOR_IDS.length)],
    stations: pickStations(rng, stationIds, shape.stations),
    loop: shape.loop && shape.stations >= 3,
    train,
  };
}

/**
 * 路線カードを本番と同じ経路（buildCardRaster → renderCardPrint → cardRaster、QR の URL つき）で n 回描き、結果は捨てる。
 * 例外は呼び出し側で握る。描いた回数を返す。
 */
export function warmUpCard(
  res: Resources,
  stationIds: readonly string[],
  opts: { monoSet: MonoSet; sideLayout: SideLayout },
  n: number = WARMUP_COUNT,
  seed = 20261120,
): number {
  const rng = createRng(seed);
  let sink = 0;
  for (let i = 0; i < n; i++) {
    const route = warmupRoute(rng, stationIds, i);
    const card = buildCardRaster(
      {
        route,
        issuedOn: "2026.11.20",
        expiresOn: "12月20日",
        url: `https://dot-rosen.example/r/WARMUP${String(i).padStart(10, "0")}`,
        appName: APP_NAME,
        monoSet: opts.monoSet,
        sideLayout: opts.sideLayout,
      },
      i + 1,
      res,
    );
    sink += card.height;
  }
  return sink > 0 ? n : 0;
}
