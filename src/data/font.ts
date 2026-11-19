// 路線カードの文字に使う点データのフォント（/fonts/dotgothic16.bin）。一度読んだら使い回す。
import { BITMAP_FONT_PATH, parseBitmapFont, type BitmapFont } from "../../shared/font/index.ts";

let fontPromise: Promise<BitmapFont> | null = null;

export function loadBitmapFont(): Promise<BitmapFont> {
  fontPromise ??= fetch(BITMAP_FONT_PATH)
    .then((res) => {
      if (!res.ok) throw new Error(`${BITMAP_FONT_PATH}: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => parseBitmapFont(buf))
    .catch((e: unknown) => {
      fontPromise = null;
      throw e;
    });
  return fontPromise;
}
