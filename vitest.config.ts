import { defineConfig } from "vitest/config";

// テストは Node 上で shared/ と tools/ の純粋な処理を確かめる。
// Cloudflare のプラグインは読み込まない（workerd を起動しないため）。
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
