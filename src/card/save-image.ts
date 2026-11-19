// カードを画像（PNG）にして端末に保存する。サーバーは通さない。
import { indexedToRgba, type IndexedImage, type Palette } from "../../shared/pix/index.ts";

/** 保存する画像の倍率（幅 384 → 1152） */
export const SAVE_SCALE = 3;

/** カラー版のカードを整数倍に拡大した PNG にする */
export function cardPngBlob(card: { image: IndexedImage; palette: Palette }, scale = SAVE_SCALE): Promise<Blob> {
  const { image, palette } = card;
  const rgba = indexedToRgba(image, palette, scale);
  const c = document.createElement("canvas");
  c.width = image.width * scale;
  c.height = image.height * scale;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), c.width, c.height), 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG にできませんでした"))), "image/png"));
}

/** ファイル名（使えない文字は除く） */
export function imageFileName(routeName: string): string {
  const base = routeName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim() || "路線カード";
  return `${base}.png`;
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export type SaveResult = "shared" | "downloaded" | "preview" | "canceled";

/**
 * 端末に保存する。
 * - スマホで、ファイルの共有ができれば共有シート（iPhone は「画像を保存」で写真に入る）
 * - iPhone で共有できなければ、画像を表示して長押しで保存してもらう（"preview"）
 * - それ以外はダウンロード
 * 共有はタップの直後に呼ぶ必要があるので、blob は先に作っておく。
 */
export async function saveImage(blob: Blob, fileName: string): Promise<SaveResult> {
  const file = new File([blob], fileName, { type: "image/png" });
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (coarse && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "canceled";
      return "preview";
    }
  }
  if (isIOS()) return "preview";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
