// サーバーの確認用の開発サーバーの設定。vite.config.ts と同じものを、ローカルの D1 の置き場所と
// Vite のキャッシュだけ別にして動かす（ほかの人の開発サーバーと .wrangler/ を取り合わないため）。
//   DOT_ROSEN_STATE=<一時ディレクトリ> DEV_ADMIN_PASSWORD=... DEV_PRINTER_TOKEN=... DEV_SESSION_SECRET=... \
//     pnpm dev --port 5182 --strictPort --config tools/dev-api.vite.config.ts
// マイグレーション: wrangler d1 migrations apply dot-rosen --local --persist-to <同じ一時ディレクトリ>
// 秘密の値は環境変数から渡す。ただし .dev.vars があると、そちらが優先される（環境変数の値は使われない）。
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const state = process.env.DOT_ROSEN_STATE;
if (!state) throw new Error("DOT_ROSEN_STATE（ローカルの D1 を置く一時ディレクトリ）を指定してください");

const secrets: Record<string, string> = {};
for (const k of ["ADMIN_PASSWORD", "PRINTER_TOKEN", "SESSION_SECRET"]) {
  const v = process.env[`DEV_${k}`];
  if (v) secrets[k] = v;
}

export default defineConfig({
  cacheDir: path.join(state, "vite-cache"),
  plugins: [
    react(),
    cloudflare({
      persistState: { path: state },
      config: { vars: secrets },
    }),
  ],
});
