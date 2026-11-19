// 確認用の画像を書き出す補助（tools 専用）。
import fs from "node:fs";
import zlib from "node:zlib";
import { encodePng, indexedToRgba, type IndexedImage, type Palette } from "../../shared/pix/index.ts";

export function writePng(file: string, img: IndexedImage, palette: Palette, scale = 1): void {
  const rgba = indexedToRgba(img, palette, scale);
  fs.writeFileSync(file, encodePng(img.width * scale, img.height * scale, rgba, (d) => zlib.deflateSync(d)));
}
