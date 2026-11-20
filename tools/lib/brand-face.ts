// OGP 画像とアイコンで共通に使う、橙色の電車の顔のデザイン。
import { defaultDesign, type TrainDesign } from "../../shared/train/index.ts";

export function brandFaceDesign(): TrainDesign {
  const base = defaultDesign();
  return {
    ...base,
    cars: 1,
    bodyColor: "orange",
    bandColor: "green",
    face: { ...base.face, contour: "round", window: "three", lightShape: "square" },
  };
}
