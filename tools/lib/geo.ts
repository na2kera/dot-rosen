// 地理データの加工に使う計算（tools 専用）。座標は [経度, 緯度]。
export type Pt = [number, number];

const R = 6371008.8;
const RAD = Math.PI / 180;
/** 首都圏付近の緯度。間引きなどの平面近似に使う */
const REF_LAT = 35.6;
export const M_PER_DEG_LAT = 110_950;
export const M_PER_DEG_LON = 111_320 * Math.cos(REF_LAT * RAD);

/** 2点間の距離（メートル。球面） */
export function distM(a: Pt, b: Pt): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 折れ線の長さで半分の位置にある点 */
export function lineMidpoint(coords: Pt[]): Pt {
  if (coords.length === 1) return coords[0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = distM(coords[i - 1], coords[i]);
    seg.push(d);
    total += d;
  }
  if (total === 0) return coords[0];
  let half = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] && seg[i] > 0) {
      const t = half / seg[i];
      const a = coords[i];
      const b = coords[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    half -= seg[i];
  }
  return coords[coords.length - 1];
}

/** 点 p と線分 ab の距離の2乗（平面近似、メートル） */
function segDist2(p: Pt, a: Pt, b: Pt): number {
  const px = (p[0] - a[0]) * M_PER_DEG_LON;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - a[0]) * M_PER_DEG_LON;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const l2 = bx * bx + by * by;
  let t = l2 === 0 ? 0 : (px * bx + py * by) / l2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - bx * t;
  const dy = py - by * t;
  return dx * dx + dy * dy;
}

export function pointSegDistM(p: Pt, a: Pt, b: Pt): number {
  return Math.sqrt(segDist2(p, a, b));
}

/** ダグラス・ポーカーの方法で折れ線を間引く（許容誤差はメートル）。両端は残す。 */
export function simplifyLine(coords: Pt[], tolM: number): Pt[] {
  if (coords.length <= 2) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const tol2 = tolM * tolM;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist2(coords[i], coords[s], coords[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** 閉じた多角形（最初と最後の点が同じでなくてよい）を間引く。3点未満になったら null。 */
export function simplifyRing(ring: Pt[], tolM: number): Pt[] | null {
  let pts = ring;
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  if (pts.length < 3) return null;
  // 始点から最も遠い点で2つに分けて、それぞれを間引く
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i][0] - pts[0][0]) * M_PER_DEG_LON;
    const dy = (pts[i][1] - pts[0][1]) * M_PER_DEG_LAT;
    const d = dx * dx + dy * dy;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyLine(pts.slice(0, far + 1), tolM);
  const b = simplifyLine([...pts.slice(far), pts[0]], tolM);
  const out = [...a, ...b.slice(1, -1)];
  return out.length >= 3 ? out : null;
}

/** 多角形の面積（平方メートル、符号つき。反時計回りが正） */
export function ringAreaM2(ring: Pt[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] * M_PER_DEG_LON) * (ring[i][1] * M_PER_DEG_LAT) - (ring[i][0] * M_PER_DEG_LON) * (ring[j][1] * M_PER_DEG_LAT);
  }
  return s / 2;
}

/** 回転数（nonzero）で点が多角形群の内側にあるか */
export function windingNumber(rings: Pt[][], p: Pt): number {
  let w = 0;
  const [x, y] = p;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      if (y1 <= y) {
        if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) w++;
      } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) w--;
    }
  }
  return w;
}

/** 偶奇の規則で点が多角形（外周と穴）の内側にあるか */
export function insidePolygon(rings: Pt[][], p: Pt): boolean {
  let inside = false;
  const [x, y] = p;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export type BBoxT = [number, number, number, number];

export function bboxOf(pts: Pt[]): BBoxT {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const [x, y] of pts) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}

export function bboxIntersects(a: BBoxT, b: BBoxT): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** 多角形を矩形で切り取る（サザーランド・ホッジマン）。回り方は保たれる。 */
export function clipRing(ring: Pt[], bb: BBoxT): Pt[] {
  let out = ring;
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= bb[0], (a, b) => [bb[0], a[1] + ((b[1] - a[1]) * (bb[0] - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= bb[2], (a, b) => [bb[2], a[1] + ((b[1] - a[1]) * (bb[2] - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= bb[1], (a, b) => [a[0] + ((b[0] - a[0]) * (bb[1] - a[1])) / (b[1] - a[1]), bb[1]]],
    [(p) => p[1] <= bb[3], (a, b) => [a[0] + ((b[0] - a[0]) * (bb[3] - a[1])) / (b[1] - a[1]), bb[3]]],
  ];
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    if (input.length === 0) break;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cross(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cross(prev, cur));
    }
  }
  return out;
}
