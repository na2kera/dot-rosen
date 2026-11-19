// プリンタ用の生データ（1行 48 バイト、左端が最上位ビット、1 が黒）を PNG にする。
import zlib from "node:zlib";
import { bitToRgba, encodePng, type BitImage } from "../../shared/pix/index.ts";

export const ROW_BYTES = 48;

export function rasterToPng(raster: Uint8Array, scale = 1): Uint8Array {
  if (raster.length % ROW_BYTES !== 0) throw new Error(`生データの長さ ${raster.length} が 48 の倍数ではありません`);
  const img: BitImage = { kind: "bit", width: ROW_BYTES * 8, height: raster.length / ROW_BYTES, stride: ROW_BYTES, data: raster };
  const rgba = bitToRgba(img, [0, 0, 0, 255], [255, 255, 255, 255], scale);
  return encodePng(img.width * scale, img.height * scale, rgba, (d) => zlib.deflateSync(d));
}
