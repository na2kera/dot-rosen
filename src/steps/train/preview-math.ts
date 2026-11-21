// 「電車をつくる」のプレビューの計算。DOM にも React にも依存しない。

/**
 * 大きく見る画面の顔の倍率（端末の画素での倍率）。
 * 白黒（印刷プレビュー）は 2 倍の細かさで描くので偶数にする（カラーも白黒も整数倍になる）。
 * CSS で 4 倍まで、使える高さ（CSS px）に収まる最大。最小は 2。
 */
export function bigFaceDevice(dpr: number, roomCss: number, faceH: number): number {
  const even = (x: number) => Math.floor(x / 2) * 2;
  const cap = even(4 * dpr);
  const fit = even((roomCss * dpr) / faceH);
  return Math.max(2, Math.min(cap, fit));
}

/** 指（またはマウス）の 1 回の操作の記録 */
export type Gesture = {
  /** 置いた位置からいちばん離れた距離（CSS px） */
  moved: number;
  /** 同時に置かれた指の最大数 */
  maxPointers: number;
  /** 操作の間にスクロールが起きたか */
  scrolled: boolean;
  /** ブラウザが操作を取り消したか（スクロールに切り替わったときなど） */
  canceled: boolean;
};

/** タップの許す動き（CSS px） */
export const TAP_SLOP = 8;

/** タップと判断できるときだけ true（スクロールの指で開かないように） */
export function isTap(g: Gesture): boolean {
  return g.moved < TAP_SLOP && g.maxPointers <= 1 && !g.scrolled && !g.canceled;
}
