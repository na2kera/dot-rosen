// 確認用の一覧画像を組み立てる RGBA の台紙（tools 専用）。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { drawText, measureText, parseBitmapFont, setDefaultFont } from "../../shared/font/index.ts";
import { createIndexed, encodePng, getPixel, type BitImage, type IndexedImage, type Palette, type Rgba } from "../../shared/pix/index.ts";
import { ROOT } from "./paths.ts";

let fontReady = false;
function ensureFont(): void {
  if (fontReady) return;
  setDefaultFont(parseBitmapFont(fs.readFileSync(path.join(ROOT, "public/fonts/dotgothic16.bin"))));
  fontReady = true;
}

export class Sheet {
  readonly rgba: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    bg: Rgba = [243, 234, 215, 255],
  ) {
    this.rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) this.rgba.set(bg, i * 4);
  }

  px(x: number, y: number, c: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || c[3] === 0) return;
    this.rgba.set(c, (y * this.width + x) * 4);
  }

  fill(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }

  /** 色番号画像を整数倍で貼る（透明はそのまま） */
  indexed(img: IndexedImage, palette: Palette, x: number, y: number, scale = 1): void {
    for (let j = 0; j < img.height; j++) {
      for (let i = 0; i < img.width; i++) {
        const c = palette[img.data[j * img.width + i]];
        if (!c || c[3] === 0) continue;
        if (scale === 1) this.px(x + i, y + j, c);
        else this.fill(x + i * scale, y + j * scale, scale, scale, c);
      }
    }
  }

  /** 白黒画像を整数倍で貼る（白も塗る） */
  bit(img: BitImage, x: number, y: number, scale = 1, black: Rgba = [0, 0, 0, 255], white: Rgba = [255, 255, 255, 255]): void {
    for (let j = 0; j < img.height; j++) {
      for (let i = 0; i < img.width; i++) {
        const c = getPixel(img, i, j) ? black : white;
        if (scale === 1) this.px(x + i, y + j, c);
        else this.fill(x + i * scale, y + j * scale, scale, scale, c);
      }
    }
  }

  /** 文字（DotGothic16、16 ドット）を書く。戻り値は幅 */
  text(str: string, x: number, y: number, c: Rgba = [32, 41, 49, 255], scale = 1): number {
    ensureFont();
    const w = measureText(str);
    if (w === 0) return 0;
    const tmp = createIndexed(w, 16);
    drawText(tmp, 0, 0, str, 1, { color: 1 });
    this.indexed(tmp, [[0, 0, 0, 0], c], x, y, scale);
    return w * scale;
  }

  save(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodePng(this.width, this.height, this.rgba, (d) => zlib.deflateSync(d)));
  }
}

/** 白黒画像を PNG で保存する（1倍） */
export function saveBit(file: string, img: BitImage): void {
  const s = new Sheet(img.width, img.height, [255, 255, 255, 255]);
  s.bit(img, 0, 0);
  s.save(file);
}
