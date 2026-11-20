// favicon とホーム画面用のアイコンを、OGP 画像と同じ橙色の電車の顔で描く。
// 拡大は整数倍の最近傍だけにして、ドットがにじまないようにする。
// 実行: node tools/run.mjs tools/icon-image.ts
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { blit, createIndexed, encodePng, fillRect, getPixel, indexedToRgba, type IndexedImage, type Rgba } from "../shared/pix/index.ts";
import { COLOR_COUNT, FACE_BODY_TOP, renderFace, TRAIN_PALETTE } from "../shared/train/index.ts";
import { brandFaceDesign } from "./lib/brand-face.ts";
import { ROOT } from "./lib/paths.ts";

const palette: Rgba[] = TRAIN_PALETTE.slice(0, COLOR_COUNT);
// 電車の色番号を保ち、画面の濃い紺（#14161c）を地の色として後ろに追加する。
const BG = palette.push([20, 22, 28, 255]) - 1;

// 線路は描かない。顔の色番号 0 は透明。
const face = renderFace(brandFaceDesign(), { track: false });

/** 透明でない点を囲む範囲（右端・下端は含まない） */
function bounds(img: IndexedImage): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixel(img, x, y) === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return { x0, y0, x1, y1 };
}

/** 顔の (sx, sy) から w×h を切り出す */
function crop(src: IndexedImage, sx: number, sy: number, w: number, h: number): IndexedImage {
  const out = createIndexed(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.data[y * w + x] = getPixel(src, sx + x, sy + y);
  }
  return out;
}

/** 紺の地に、絵を整数倍で中央に置いた正方形の画像を書き出す */
function writeIcon(file: string, size: number, art: IndexedImage, scale: number): void {
  const w = art.width * scale;
  const h = art.height * scale;
  if (w > size || h > size) throw new Error(`${file}: 絵が枠からはみ出します (${w}×${h} > ${size})`);
  const image = createIndexed(size, size);
  fillRect(image, 0, 0, size, size, BG);
  blit(image, art, Math.floor((size - w) / 2), Math.floor((size - h) / 2), { scale, transparent: 0 });
  const png = encodePng(size, size, indexedToRgba(image, palette), deflateSync);
  fs.writeFileSync(path.join(ROOT, "public", file), png);
  console.log(`public/${file}: ${size}×${size}, ${png.byteLength} bytes`);
}

const b = bounds(face);

// favicon（64×64）: 顔を等倍で枠いっぱいに入れる。高さが 64 を超える分はパンタグラフの上側を削り、
// 車体と足回り（スカート）は全部残す。
const FAV = 64;
const favTop = Math.max(b.y0, b.y1 - FAV);
if (favTop > FACE_BODY_TOP) throw new Error("favicon: 車体の上端が切れます");
writeIcon("favicon.png", FAV, crop(face, b.x0, favTop, b.x1 - b.x0, b.y1 - favTop), 1);

// apple-touch-icon（180×180）: パンタグラフから足回りまで全部を 2 倍で中央に置く。
// 四隅は OS が丸めるので、周りに余白を取る。
writeIcon("apple-touch-icon.png", 180, crop(face, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0), 2);
