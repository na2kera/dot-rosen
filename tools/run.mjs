// tools/ の TypeScript スクリプトを esbuild でまとめてから Node で実行する。
// 使い方: node tools/run.mjs tools/build-stations.ts [引数...]
import { build } from "esbuild";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [entry, ...rest] = process.argv.slice(2);
if (!entry) {
  console.error("使い方: node tools/run.mjs <スクリプト.ts> [引数...]");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const outfile = path.join(root, "tools/out/.run", path.basename(entry).replace(/\.ts$/, ".mjs"));

await build({
  entryPoints: [path.resolve(entry)],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // node_modules の依存はまとめずにそのまま読み込む
  packages: "external",
  sourcemap: "inline",
  logLevel: "warning",
});

process.env.DOT_ROSEN_ROOT = root;
process.argv = [process.argv[0], outfile, ...rest];
await import(pathToFileURL(outfile).href);
