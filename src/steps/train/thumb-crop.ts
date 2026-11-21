// 選択肢のカード（5 列）に入れる絵の切り出し。絵の倍率は変えず（等倍）、見せたい所だけを切り出す。
// DOM にも React にも依存しない。
import { blit, createIndexed, type IndexedImage } from "../../../shared/pix/index.ts";
import { CAR_W, carLayout, LOGO_SIZE, type SideDesign, type TrainDesign } from "../../../shared/train/index.ts";

export type CropRect = { x: number; y: number; w: number; h: number };

/** 切り出す（はみ出した所は透明） */
export function cropIndexed(img: IndexedImage, r: CropRect): IndexedImage {
  const out = createIndexed(r.w, r.h);
  blit(out, img, -r.x, -r.y);
  return out;
}

/** 切り出す幅。画面の幅 360 で 5 列にしたとき、選んだカード（太枠）の中に収まる幅 */
export const THUMB_W = 48;

/** 正面の顔（64×76）の絵のある所。左右の空きと、線路を描かない下の空きを落とす */
export const FACE_CROP: CropRect = { x: 8, y: 0, w: THUMB_W, h: 70 };

/** 側面の絵の高さ（屋根の機器から車輪まで） */
const SIDE_Y = 4;
const SIDE_H = 56;

/** ドアは、扉の数（2・3・4）の違いが 1 両ぶんでしか分からないので、中間車 1 両を等倍のまま横長に見せる */
export const DOORS_CROP: CropRect = { x: 0, y: SIDE_Y, w: CAR_W, h: SIDE_H };

/**
 * 側面（先頭車 192×64）から、その部位の違いが分かる所を切り出す位置。
 * 鼻先は前の端、窓・帯はロゴの後ろ、ドア・屋根は先頭の扉を基準にする（鼻先で位置がずれるため）。
 */
export function sideCrop(design: TrainDesign, part: keyof SideDesign): CropRect {
  const L = carLayout(design, "lead", design.side.roof !== "none");
  const behindLogo = L.logo ? L.logo.x + LOGO_SIZE + 2 : 8;
  const at = (x: number): CropRect => ({ x, y: SIDE_Y, w: THUMB_W, h: SIDE_H });
  switch (part) {
    case "nose":
      return at(0);
    case "window":
    case "band":
      return at(behindLogo);
    case "doors":
      // ふつうは DOORS_CROP（中間車 1 両）を使う。先頭車から切り出すときは先頭の扉の少し後ろ
      return at((L.doors[0]?.x ?? behindLogo) + 36);
    case "roof":
      // パンタグラフと、その後ろの冷房が入る所
      return at((L.doors[0]?.x ?? behindLogo) + 52);
  }
}
