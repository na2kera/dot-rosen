// プリンタ用の生データのファイル（48 × 高さ バイト）を PNG に変換する。
//   node tools/run.mjs tools/raster-to-png.ts <入力.bin> [出力.png] [--scale 2]
import fs from "node:fs";
import { rasterToPng } from "./lib/raster-png.ts";

const args = process.argv.slice(2);
const si = args.indexOf("--scale");
const scale = si >= 0 ? Number(args.splice(si, 2)[1]) : 1;
const [input, output = input?.replace(/\.[^.]*$/, "") + ".png"] = args;
if (!input || !Number.isInteger(scale) || scale < 1) {
  console.error("使い方: node tools/run.mjs tools/raster-to-png.ts <入力.bin> [出力.png] [--scale 2]");
  process.exit(1);
}
const raster = new Uint8Array(fs.readFileSync(input));
fs.writeFileSync(output, rasterToPng(raster, scale));
console.log(`${output}（384 × ${raster.length / 48} ドット、${scale} 倍）`);
