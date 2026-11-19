import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// 画面（React）と Worker（worker/index.ts）を1つの Vite で扱う。
// 開発サーバー上でも Worker は workerd の中で動き、ローカルの D1 が使える。
export default defineConfig({
  plugins: [react(), cloudflare()],
});
