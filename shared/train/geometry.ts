// 配置の計算に使う矩形の型と小道具。

/** 矩形（左上 x, y、幅 w、高さ h。ドット単位） */
export type Rect = { x: number; y: number; w: number; h: number };

export const rectOf = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** 2つの矩形が gap ドット以内に近づいているか（gap=0 なら重なりだけ） */
export function near(a: Rect, b: Rect, gap = 0): boolean {
  return a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
}

/** 矩形を左右に広げる・縮める */
export const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 });

/** 横の区間 [a, b]（両端を含む）から、[c, d] を取り除いた残り */
export function subtractSpan(a: number, b: number, c: number, d: number): [number, number][] {
  if (d < a || c > b) return [[a, b]];
  const out: [number, number][] = [];
  if (c > a) out.push([a, c - 1]);
  if (d < b) out.push([d + 1, b]);
  return out;
}
