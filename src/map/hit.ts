// 駅のタップの判定と、駅名の置き場所の決定。DOM に依存しない。

export type ScreenPoint = { readonly x: number; readonly y: number };

export type HitResult =
  | { readonly kind: "none" }
  | { readonly kind: "station"; readonly index: number }
  /** 駅が密集していて区別できない。sep は一番近い駅と、その隣の駅の間隔（px） */
  | { readonly kind: "dense"; readonly index: number; readonly sep: number };

export type HitOptions = {
  /** 当たりの半径（px） */
  radius: number;
  /** これより近い駅が隣にあるときは「区別できない」とする（px） */
  denseSep: number;
  /**
   * 隣の駅が denseSep より近くても、タップした所が一番近い駅に margin 以上近ければ選ぶ
   * （margin 未満の差なら、どちらを押したか区別できないとみなす）。
   * 隣との間が margin より狭いときは、いつも「区別できない」とする。
   */
  margin: number;
  /** これ以上拡大できないときは、密集していても一番近い駅を選ぶ */
  atMaxZoom: boolean;
};

/** points（画面上の駅の位置、px）から、tap に一番近い駅を選ぶ */
export function hitTest(points: readonly ScreenPoint[], tap: ScreenPoint, opts: HitOptions): HitResult {
  let best = -1;
  let bestD = opts.radius * opts.radius;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - tap.x;
    const dy = points[i].y - tap.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return { kind: "none" };
  if (opts.atMaxZoom) return { kind: "station", index: best };
  const p = points[best];
  let sep = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (i === best) continue;
    const d = Math.hypot(points[i].x - p.x, points[i].y - p.y);
    if (d < sep) sep = d;
  }
  if (sep < opts.denseSep) {
    if (sep < opts.margin) return { kind: "dense", index: best, sep };
    const dBest = Math.sqrt(bestD);
    const r2 = opts.radius * opts.radius;
    for (let i = 0; i < points.length; i++) {
      if (i === best) continue;
      const dx = points[i].x - tap.x;
      const dy = points[i].y - tap.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && Math.sqrt(d2) - dBest < opts.margin) return { kind: "dense", index: best, sep };
    }
  }
  return { kind: "station", index: best };
}

export type LabelCandidate<K> = {
  readonly key: K;
  /** 駅の点の位置（px） */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type PlacedLabel<K> = { readonly key: K; readonly x: number; readonly y: number; readonly w: number; readonly h: number };

type Rect = { x: number; y: number; w: number; h: number };

/** 間を SPACE px 空けないものを重なりとみなす */
export const LABEL_SPACE = 4;
const SPACE = LABEL_SPACE;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + SPACE && b.x < a.x + a.w + SPACE && a.y < b.y + b.h + SPACE && b.y < a.y + a.h + SPACE;

/**
 * 駅名を重ならないように置く。candidates は優先する順に並べておく。
 * 点の右、左、上、下の順に試し、どこも重なるものは出さない。
 * blocked はあらかじめ避ける場所（自分の路線の印など）。
 */
export function placeLabels<K>(
  candidates: readonly LabelCandidate<K>[],
  view: { w: number; h: number },
  gap: number,
  blocked: readonly Rect[] = [],
): PlacedLabel<K>[] {
  const placed: PlacedLabel<K>[] = [];
  const taken: Rect[] = [...blocked];
  for (const c of candidates) {
    const options: Rect[] = [
      { x: c.x + gap, y: c.y - c.h / 2, w: c.w, h: c.h },
      { x: c.x - gap - c.w, y: c.y - c.h / 2, w: c.w, h: c.h },
      { x: c.x - c.w / 2, y: c.y - gap - c.h, w: c.w, h: c.h },
      { x: c.x - c.w / 2, y: c.y + gap, w: c.w, h: c.h },
    ];
    for (const r of options) {
      const rr = { x: Math.round(r.x), y: Math.round(r.y), w: r.w, h: r.h };
      if (rr.x < 0 || rr.y < 0 || rr.x + rr.w > view.w || rr.y + rr.h > view.h) continue;
      if (taken.some((t) => overlaps(t, rr))) continue;
      taken.push(rr);
      placed.push({ key: c.key, ...rr });
      break;
    }
  }
  return placed;
}
