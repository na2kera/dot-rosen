// Cloudflare Worker の入口。/api/*（API）と、/r/*（路線のページ）・/og/*（X 用の絵）がここに来る（それ以外は静的ファイル）。
//
// 駅データとフォントは Worker に同梱する（静的アセットから読むと、リクエストのたびに取得と解析が要るため）。
// JSON は Vite がモジュールとして取り込み、.bin は Data モジュール（ArrayBuffer）になる。
// どちらもモジュールの読み込み時（起動時）に1回だけ解析し、以後のリクエストでは使い回す。
import { env } from "cloudflare:workers";
import stationsFile from "../public/data/stations.json";
import fontBin from "../public/fonts/dotgothic16.bin";
import type { StationsFile } from "../shared/geo/map-data.ts";
import { createApp } from "./app.ts";
import { cleanup } from "./lib/cleanup.ts";
import { cardOptions } from "./lib/config.ts";
import { handlePage } from "./pages.ts";
import { createResources } from "./lib/resources.ts";
import type { Bindings } from "./lib/types.ts";
import { warmUpCard } from "./lib/warmup.ts";

const stations = stationsFile as StationsFile;
const resources = createResources(stations, fontBin);
const app = createApp({ resources, now: () => new Date() });

// 起動時に路線カードの描画を空打ちして JIT を温める（最初の印刷の申し込みが 1 リクエストの CPU 上限を超えないように）。
// 起動時の処理はリクエストの CPU 時間とは別枠。失敗しても起動は止めない。テスト（worker/app.ts）では呼ばれない。
try {
  warmUpCard(
    resources,
    stations.stations.map((s) => s.id),
    cardOptions(env as unknown as Bindings),
  );
} catch (e) {
  console.warn("路線カードの温めに失敗（起動は続ける）", e instanceof Error ? e.message : String(e));
}

export default {
  async fetch(request, env, ctx) {
    // 路線のページと X 用の絵は API とは別に処理する（API の no-store と JSON の 404 を掛けない）
    const page = await handlePage(request, {
      resources,
      assets: env.ASSETS,
      db: (env as unknown as Bindings).DB,
      cache: caches.default,
      waitUntil: (p) => ctx.waitUntil(p),
    });
    if (page) return page;
    return app.fetch(request, env as Bindings, ctx);
  },
  async scheduled(_controller, env) {
    const r = await cleanup((env as Bindings).DB, new Date());
    console.log("掃除", r);
  },
} satisfies ExportedHandler<Env>;
