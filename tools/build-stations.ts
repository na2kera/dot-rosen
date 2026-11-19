// 駅データと地図データを元データから作り直す。
//   pnpm data:build
//
// 入力（data-src/ 以下。コミットしない。取得手順は tools/README.md）
//   data-src/n02/N02-25_GML.zip                 国土数値情報 鉄道データ 2025年版（CC BY 4.0）
//   data-src/n03/N03-20250101_<県番号>_GML.zip  国土数値情報 行政区域データ 2025年版（CC BY 4.0）
//   data-src/ne/ne_10m_rivers_lake_centerlines.geojson, ne_10m_lakes.geojson  Natural Earth（パブリックドメイン）
//
// 出力
//   public/data/stations.json   駅と路線の表
//   public/data/map.json        陸地・線路・川
//   tools/out/stations-report.txt, tools/out/map-debug.png   確認用（コミットしない）
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { readZipEntry } from "./lib/zip.ts";
import { ROOT } from "./lib/paths.ts";
import {
  bboxIntersects,
  bboxOf,
  clipRing,
  distM,
  insidePolygon,
  lineMidpoint,
  pointSegDistM,
  ringAreaM2,
  simplifyLine,
  simplifyRing,
  windingNumber,
  type BBoxT,
  type Pt,
} from "./lib/geo.ts";
import { encodePath, type BBox, type LineInfo, type MapFile, type PrefCode, type Station, type StationsFile, PREF_NAMES } from "../shared/geo/map-data.ts";
import { createIndexed, fillRect, drawLine, fillPolygons, setPixel, type Palette } from "../shared/pix/index.ts";
import { writePng } from "./lib/raster.ts";

const SRC = path.join(ROOT, "data-src");
const OUT_PUBLIC = path.join(ROOT, "public/data");
const OUT_DEBUG = path.join(ROOT, "tools/out");

/** 地図の範囲（対象の1都3県とその周辺） */
const MAP_BBOX: BBoxT = [138.6, 34.8, 141.0, 36.4];
/** 座標の量子化（1/q 度単位。1e5 で約 1m） */
const Q = 100_000;
/** 対象の都県 */
const TARGET_PREFS: PrefCode[] = [11, 12, 13, 14];
/** 陸地に使う県（対象＋周辺） */
const LAND_PREFS = ["08", "09", "10", "11", "12", "13", "14", "19", "20", "22"];
/** 同じ駅名をまとめる距離（メートル。連鎖してよい） */
const MERGE_DIST_M = 600;
/** 線路の間引きの許容誤差（メートル） */
const RAIL_TOL_M = 40;
/** 陸地の間引きの許容誤差（メートル） */
const LAND_TOL_M = 15;
/** これより小さい陸地（平方メートル）は捨てる */
const LAND_MIN_AREA_M2 = 3_000;
/** どの市区町村にも入らない駅を、最寄りの市区町村に寄せる最大距離（メートル） */
const PREF_SNAP_M = 3_000;

type Feature<G> = { properties: Record<string, string | null>; geometry: G };
type LineGeom = { type: "LineString"; coordinates: Pt[] } | { type: "MultiLineString"; coordinates: Pt[][] };
type PolyGeom = { type: "Polygon"; coordinates: Pt[][] } | { type: "MultiPolygon"; coordinates: Pt[][][] };

const report: string[] = [];
const log = (s = "") => {
  report.push(s);
  console.log(s);
};

function readGeoJson<G>(zip: string, entry: string): Feature<G>[] {
  const text = readZipEntry(zip, entry).toString("utf8");
  return (JSON.parse(text) as { features: Feature<G>[] }).features;
}

const inMapBBox = (p: Pt) => p[0] >= MAP_BBOX[0] && p[0] <= MAP_BBOX[2] && p[1] >= MAP_BBOX[1] && p[1] <= MAP_BBOX[3];
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

// ---------------------------------------------------------------- 行政区域（N03）
type Muni = { pref: number; name: string; rings: Pt[][]; bbox: BBoxT };

function loadMunicipalities(): Muni[] {
  const out: Muni[] = [];
  for (const code of LAND_PREFS) {
    const zip = path.join(SRC, `n03/N03-20250101_${code}_GML.zip`);
    const feats = readGeoJson<PolyGeom>(zip, `N03-20250101_${code}.geojson`);
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      const p = f.properties;
      const name = [p.N03_001, p.N03_003, p.N03_004].filter(Boolean).join("");
      for (const rings of polys) {
        out.push({ pref: Number(code), name, rings, bbox: bboxOf(rings[0]) });
      }
    }
  }
  return out;
}

/**
 * 市区町村のポリゴンを1つの陸地にまとめる。
 * 隣り合うポリゴンは境界の頂点を共有しているので、逆向きに2回出る辺を消すと外周（海岸線など）だけが残る。
 */
function buildLand(munis: Muni[]): { rings: Pt[][]; stats: string[] } {
  const keyOf = (p: Pt) => `${p[0]},${p[1]}`;
  const pts = new Map<string, Pt>();
  // 向きつきの辺の数。キーは "始点|終点"
  const edges = new Map<string, number>();
  let used = 0;
  for (const m of munis) {
    if (!bboxIntersects(m.bbox, MAP_BBOX)) continue;
    used++;
    m.rings.forEach((ring0, ri) => {
      // 外周は反時計回り、穴は時計回りにそろえる
      let ring = ring0;
      const ccw = ringAreaM2(ring) > 0;
      if ((ri === 0) !== ccw) ring = [...ring].reverse();
      const n = ring.length;
      const last = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? n - 1 : n;
      for (let i = 0; i < last; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % last];
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (ka === kb) continue;
        pts.set(ka, a);
        pts.set(kb, b);
        const rev = `${kb}|${ka}`;
        const c = edges.get(rev);
        if (c) {
          if (c === 1) edges.delete(rev);
          else edges.set(rev, c - 1);
        } else {
          const fwd = `${ka}|${kb}`;
          edges.set(fwd, (edges.get(fwd) ?? 0) + 1);
        }
      }
    });
  }
  // 残った辺をつないで輪にする
  const out = new Map<string, string[]>();
  let edgeCount = 0;
  for (const [k, c] of edges) {
    const [a, b] = k.split("|");
    for (let i = 0; i < c; i++) {
      let list = out.get(a);
      if (!list) out.set(a, (list = []));
      list.push(b);
      edgeCount++;
    }
  }
  const rings: Pt[][] = [];
  let open = 0;
  for (const start of [...out.keys()]) {
    for (;;) {
      const list = out.get(start);
      if (!list || list.length === 0) break;
      const ring: Pt[] = [pts.get(start)!];
      let cur = start;
      for (;;) {
        const l = out.get(cur);
        if (!l || l.length === 0) {
          open++;
          break;
        }
        const next = l.pop()!;
        if (next === start) break;
        ring.push(pts.get(next)!);
        cur = next;
      }
      rings.push(ring);
    }
  }
  const stats = [
    `陸地: 使った市区町村ポリゴン ${used} 個、残った外周の辺 ${edgeCount} 本、輪 ${rings.length} 個（閉じなかったもの ${open}）`,
  ];
  return { rings, stats };
}

function finishLand(rawRings: Pt[][]): Pt[][] {
  const clipBox: BBoxT = [MAP_BBOX[0] - 0.01, MAP_BBOX[1] - 0.01, MAP_BBOX[2] + 0.01, MAP_BBOX[3] + 0.01];
  const out: Pt[][] = [];
  for (const r of rawRings) {
    if (!bboxIntersects(bboxOf(r), clipBox)) continue;
    const s = simplifyRing(r, LAND_TOL_M);
    if (!s) continue;
    const c = clipRing(s, clipBox);
    if (c.length < 3) continue;
    if (Math.abs(ringAreaM2(c)) < LAND_MIN_AREA_M2) continue;
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- 駅（N02）
type RawStation = {
  name: string;
  line: string;
  operator: string;
  kind: string;
  code: string;
  group: string;
  pt: Pt;
};

function loadStations(): RawStation[] {
  const feats = readGeoJson<LineGeom>(path.join(SRC, "n02/N02-25_GML.zip"), "N02-25_GML/UTF-8/N02-25_Station.geojson");
  const out: RawStation[] = [];
  for (const f of feats) {
    const g = f.geometry;
    const coords = g.type === "LineString" ? g.coordinates : g.coordinates.flat();
    const pt = lineMidpoint(coords);
    if (!inMapBBox(pt)) continue;
    const p = f.properties;
    out.push({
      name: p.N02_005!,
      line: p.N02_003!,
      operator: p.N02_004!,
      kind: p.N02_001!,
      code: p.N02_005c!,
      group: p.N02_005g!,
      pt,
    });
  }
  return out;
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

function prefOf(munis: Muni[], p: Pt): { pref: number | null; muni: string | null; snappedM: number } {
  for (const m of munis) {
    if (p[0] < m.bbox[0] || p[0] > m.bbox[2] || p[1] < m.bbox[1] || p[1] > m.bbox[3]) continue;
    if (insidePolygon(m.rings, p)) return { pref: m.pref, muni: m.name, snappedM: 0 };
  }
  // どこにも入らない（埋立地の端や水上など）: 最寄りの市区町村に寄せる
  let best: Muni | null = null;
  let bestD = Infinity;
  const pad = PREF_SNAP_M / 90_000;
  for (const m of munis) {
    if (p[0] < m.bbox[0] - pad || p[0] > m.bbox[2] + pad || p[1] < m.bbox[1] - pad || p[1] > m.bbox[3] + pad) continue;
    for (const r of m.rings) {
      for (let i = 1; i < r.length; i++) {
        const d = pointSegDistM(p, r[i - 1], r[i]);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
  }
  if (best && bestD <= PREF_SNAP_M) return { pref: best.pref, muni: best.name, snappedM: bestD };
  return { pref: null, muni: null, snappedM: bestD };
}

// ---------------------------------------------------------------- 線路（N02）
function loadRails(): Pt[][] {
  const feats = readGeoJson<LineGeom>(path.join(SRC, "n02/N02-25_GML.zip"), "N02-25_GML/UTF-8/N02-25_RailroadSection.geojson");
  const lines: Pt[][] = [];
  for (const f of feats) {
    const g = f.geometry;
    const parts = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    for (const c of parts) if (c.some(inMapBBox)) lines.push(c);
  }
  return lines;
}

/** 端点を共有する線をつないで長い線にする（分岐のない点だけでつなぐ） */
function chainLines(lines: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  // 重複する線を除く
  const seen = new Set<string>();
  const uniq: Pt[][] = [];
  for (const l of lines) {
    const k1 = l.map(key).join(";");
    const k2 = [...l].reverse().map(key).join(";");
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1);
    uniq.push(l);
  }
  const ends = new Map<string, number[]>();
  uniq.forEach((l, i) => {
    for (const p of [l[0], l[l.length - 1]]) {
      const k = key(p);
      let a = ends.get(k);
      if (!a) ends.set(k, (a = []));
      a.push(i);
    }
  });
  const used = new Uint8Array(uniq.length);
  const out: Pt[][] = [];
  const extend = (chain: Pt[]) => {
    for (;;) {
      const k = key(chain[chain.length - 1]);
      const a = ends.get(k)!;
      if (a.length !== 2) return;
      const nextI = a.find((i) => !used[i]);
      if (nextI === undefined) return;
      used[nextI] = 1;
      const l = uniq[nextI];
      const seg = key(l[0]) === k ? l : [...l].reverse();
      chain.push(...seg.slice(1));
    }
  };
  for (let i = 0; i < uniq.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain = [...uniq[i]];
    extend(chain);
    chain.reverse();
    extend(chain);
    out.push(chain);
  }
  return out;
}

// ---------------------------------------------------------------- 川（Natural Earth）
function loadRivers(): { lines: Pt[][]; names: string[] } {
  const file = path.join(SRC, "ne/ne_10m_rivers_lake_centerlines.geojson");
  const feats = (JSON.parse(fs.readFileSync(file, "utf8")) as { features: Feature<LineGeom>[] }).features;
  const lines: Pt[][] = [];
  const names: string[] = [];
  for (const f of feats) {
    if (!f.geometry) continue;
    const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let hit = false;
    for (const c of parts) {
      if (c.some(inMapBBox)) {
        lines.push(c);
        hit = true;
      }
    }
    if (hit) names.push(String(f.properties.name ?? "?"));
  }
  return { lines, names };
}

// ---------------------------------------------------------------- 本体
function main(): void {
  fs.mkdirSync(OUT_PUBLIC, { recursive: true });
  fs.mkdirSync(OUT_DEBUG, { recursive: true });
  log(`駅データの生成 ${new Date().toISOString()}`);
  log("元データ: N02-25（鉄道 2025年版）、N03-20250101（行政区域 2025年版）、Natural Earth 10m");
  log("");

  // 陸地
  const munis = loadMunicipalities();
  const landRaw = buildLand(munis);
  landRaw.stats.forEach((s) => log(s));
  const land = finishLand(landRaw.rings);
  log(`陸地: 間引き後 ${land.length} 個の多角形、${land.reduce((n, r) => n + r.length, 0)} 点（許容誤差 ${LAND_TOL_M}m）`);

  // 駅
  const raw = loadStations();
  log("");
  log(`駅（地図の範囲内の元データ）: ${raw.length} 件（路線ごとの駅）`);
  const uf = new UnionFind(raw.length);
  const byGroup = new Map<string, number>();
  raw.forEach((s, i) => {
    const g = byGroup.get(s.group);
    if (g === undefined) byGroup.set(s.group, i);
    else uf.union(g, i);
  });
  log(`グループコードの種類: ${byGroup.size}`);
  // グループコードでまとめたものに、名前が違うものが入っていないか
  const groupNames = new Map<number, Set<string>>();
  raw.forEach((s, i) => {
    const r = uf.find(i);
    let set = groupNames.get(r);
    if (!set) groupNames.set(r, (set = new Set()));
    set.add(s.name);
  });
  const mixedGroups = [...groupNames.values()].filter((s) => s.size > 1);
  const byName = new Map<string, number[]>();
  raw.forEach((s, i) => {
    let a = byName.get(s.name);
    if (!a) byName.set(s.name, (a = []));
    a.push(i);
  });
  for (const idx of byName.values()) {
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        if (distM(raw[idx[a]].pt, raw[idx[b]].pt) <= MERGE_DIST_M) uf.union(idx[a], idx[b]);
      }
    }
  }
  const clusters = new Map<number, number[]>();
  raw.forEach((_, i) => {
    const r = uf.find(i);
    let a = clusters.get(r);
    if (!a) clusters.set(r, (a = []));
    a.push(i);
  });
  log(`統合後（地図の範囲内）: ${clusters.size} 駅`);

  // 都県の判定と出力用の形
  const targetMunis = munis.filter((m) => TARGET_PREFS.includes(m.pref as PrefCode));
  const otherMunis = munis.filter((m) => !TARGET_PREFS.includes(m.pref as PrefCode));
  const lineKey = (s: RawStation) => `${s.operator}\t${s.line}`;
  type Built = Omit<Station, "lines"> & { lineKeys: string[]; members: RawStation[]; snappedM: number; muni: string };
  const built: Built[] = [];
  const snapped: string[] = [];
  let outside = 0;
  for (const idx of clusters.values()) {
    const members = idx.map((i) => raw[i]);
    const lon = members.reduce((n, s) => n + s.pt[0], 0) / members.length;
    const lat = members.reduce((n, s) => n + s.pt[1], 0) / members.length;
    const p: Pt = [lon, lat];
    let res = prefOf(targetMunis, p);
    if (res.snappedM > 0 || res.pref === null) {
      // 対象外の県の中にあるなら対象外
      const o = prefOf(otherMunis, p);
      if (o.pref !== null && (o.snappedM === 0 || o.snappedM < res.snappedM)) res = o;
    }
    if (res.pref === null || !TARGET_PREFS.includes(res.pref as PrefCode)) {
      outside++;
      continue;
    }
    const names = [...new Set(members.map((m) => m.name))];
    if (names.length > 1) throw new Error(`名前の違う駅がまとまりました: ${names.join(",")}`);
    const minGroup = members.map((m) => m.group).sort()[0];
    if (res.snappedM > 0) snapped.push(`${names[0]}（${res.muni}、${Math.round(res.snappedM)}m 寄せた）`);
    built.push({
      id: `s${minGroup}`,
      name: names[0],
      lat: round5(lat),
      lon: round5(lon),
      pref: res.pref as PrefCode,
      lineKeys: [...new Set(members.map(lineKey))],
      members,
      snappedM: res.snappedM,
      muni: res.muni ?? "",
    });
  }
  // 路線の表（運営会社・路線名の順）
  const allLineKeys = [...new Set(built.flatMap((b) => b.lineKeys))].sort((a, b) => a.localeCompare(b, "ja"));
  const lineIndex = new Map(allLineKeys.map((k, i) => [k, i]));
  const lines: LineInfo[] = allLineKeys.map((k) => {
    const [operator, name] = k.split("\t");
    return { name, operator };
  });
  // 駅は ID 順（作り直しても差分が小さくなるように）
  built.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set<string>();
  for (const b of built) {
    if (ids.has(b.id)) throw new Error(`駅 ID が重複しました: ${b.id}`);
    ids.add(b.id);
  }
  const stations: Station[] = built.map((b) => ({
    id: b.id,
    name: b.name,
    lat: b.lat,
    lon: b.lon,
    lines: b.lineKeys.map((k) => lineIndex.get(k)!).sort((x, y) => x - y),
    pref: b.pref,
  }));
  const stationsFile: StationsFile = { v: 1, lines, stations };
  fs.writeFileSync(path.join(OUT_PUBLIC, "stations.json"), JSON.stringify(stationsFile));

  // 集計
  log("");
  log("== 1都3県の駅数 ==");
  const rawInTarget = built.reduce((n, b) => n + b.members.length, 0);
  log(`統合前（路線ごとの駅）: ${rawInTarget} 件`);
  log(`統合後: ${stations.length} 駅（範囲外として除いたもの ${outside}）`);
  for (const pc of TARGET_PREFS) log(`  ${PREF_NAMES[pc]}: ${stations.filter((s) => s.pref === pc).length}`);
  log(`路線の数: ${lines.length}`);
  const kinds = new Map<string, number>();
  for (const b of built) {
    const k = [...new Set(b.members.map((m) => m.kind))].sort().join("+");
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  log(`鉄道区分（N02_001）の内訳: ${[...kinds].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  log("  （11 普通鉄道JR、12 普通鉄道、13 鋼索鉄道、14 懸垂式鉄道、15 跨座式鉄道、16 案内軌条式鉄道、17 無軌条鉄道、21 軌道、22 懸垂式モノレール、23 跨座式モノレール、24 案内軌条式、25 浮上式）");
  const cable = built.filter((b) => b.members.every((m) => m.kind === "13"));
  log(`鋼索鉄道（ケーブルカー）だけの駅: ${cable.length}（${cable.map((b) => b.name).join("、")}）`);
  log("");
  log("== 国の集計（1,734 駅）との比較 ==");
  log(`差: ${stations.length - 1734 >= 0 ? "+" : ""}${stations.length - 1734}`);
  // 運営会社ごとに別の駅と数えた場合（同じ駅名・同じ会社・600m 以内だけをまとめる）
  let perOperator = 0;
  for (const b of built) {
    const ops = new Map<string, Pt[]>();
    for (const m of b.members) {
      let a = ops.get(m.operator);
      if (!a) ops.set(m.operator, (a = []));
      a.push(m.pt);
    }
    perOperator += ops.size;
  }
  log(`参考: 運営会社が違えば別の駅と数えた場合 ${perOperator} 駅`);
  log(`参考: 鋼索鉄道だけの駅を除いた場合 ${stations.length - cable.length} 駅`);
  log("見立て:");
  log(`  - このデータは「同じ駅名で 600m 以内」なら会社が違っても1駅にまとめている（例: 新宿は JR・小田急・京王・メトロ・都営で1駅）。`);
  log(`    国の集計は「改札内で乗り換えられる駅」だけを1駅と数えるので、改札を出て乗り換える会社違いの同名駅は別に数えられ、こちらより多くなる。`);
  log(`  - 会社が違えば別の駅と数えると ${perOperator} 駅になり、1,734 は統合後（${stations.length}）とこの値の間にある。`);
  log(`    会社をまたいで改札内で乗り換えられる駅（相互直通の共同使用駅など）を1駅とすると、この上限から減って 1,734 前後になると考えられる。`);
  log(`  - 名前の違う近接駅（下の一覧。例: 溝の口と武蔵溝ノ口）は統合していない。国の集計でも別駅と数えている可能性が高い。`);
  log(`  - ケーブルカー ${cable.length} 駅を含めている。国の集計が鋼索鉄道を含むかどうかは確認していない。`);
  log(`  - 元データの年版（N02 2025年版）と国の集計の時点の違いによる差もありうる（未確認）。`);

  // 同名で別駅として残したもの
  const sameName = new Map<string, Built[]>();
  for (const b of built) {
    let a = sameName.get(b.name);
    if (!a) sameName.set(b.name, (a = []));
    a.push(b);
  }
  const dup = [...sameName].filter(([, a]) => a.length > 1);
  log("");
  log(`== 同名で別駅として残したもの: ${dup.length} 名、${dup.reduce((n, [, a]) => n + a.length, 0)} 駅 ==`);
  for (const [name, a] of dup) {
    const minD = Math.round(
      Math.min(...a.flatMap((x, i) => a.slice(i + 1).map((y) => distM([x.lon, x.lat], [y.lon, y.lat])))),
    );
    log(`${name}（最も近い組 ${minD}m）`);
    for (const b of a) log(`  ${b.id} ${PREF_NAMES[b.pref]} ${b.muni}: ${b.lineKeys.map((k) => k.replace("\t", " ")).join(" / ")}`);
  }

  // 名前は違うが近い駅（改札内で乗り換えられる駅として国が1駅に数えている可能性がある）
  log("");
  const near: string[] = [];
  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const a = built[i];
      const b = built[j];
      if (Math.abs(a.lat - b.lat) > 0.004 || Math.abs(a.lon - b.lon) > 0.005) continue;
      const d = distM([a.lon, a.lat], [b.lon, b.lat]);
      if (d <= 300 && a.name !== b.name) near.push(`${a.name} - ${b.name}（${Math.round(d)}m）`);
    }
  }
  log(`== 名前が違い、300m 以内にある駅の組: ${near.length} 組（統合はしていない）==`);
  near.forEach((s) => log(`  ${s}`));
  log("");
  log(`グループコード（N02_005g）が同じで駅名が違う組（地図の範囲内）: ${mixedGroups.length} 件`);
  mixedGroups.forEach((s) => log(`  ${[...s].join(" / ")}`));
  log("");
  log(`== どの市区町村ポリゴンにも入らず、最寄りに寄せた駅: ${snapped.length} ==`);
  snapped.forEach((s) => log(`  ${s}`));

  // 線路
  const railsRaw = loadRails();
  const rails = chainLines(railsRaw)
    .map((l) => simplifyLine(l, RAIL_TOL_M))
    .filter((l) => l.length >= 2);
  log("");
  log(`線路: 元 ${railsRaw.length} 本 → つないで ${rails.length} 本、${rails.reduce((n, l) => n + l.length, 0)} 点（許容誤差 ${RAIL_TOL_M}m）`);

  // 川
  const rivers = loadRivers();
  log(`川（Natural Earth 10m、範囲内）: ${rivers.names.join(", ") || "なし"}（${rivers.lines.reduce((n, l) => n + l.length, 0)} 点）`);
  log("  → 粗すぎるため地図データには入れない（理由は tools/README.md）");

  // 地図データ
  const bbox: BBox = MAP_BBOX;
  const mapFile: MapFile = {
    v: 1,
    bbox,
    q: Q,
    land: land.map((r) => encodePath(r, bbox, Q)),
    rails: rails.map((l) => encodePath(l, bbox, Q)),
    rivers: [],
  };
  fs.writeFileSync(path.join(OUT_PUBLIC, "map.json"), JSON.stringify(mapFile));

  // 陸地に入らない駅（間引いた後の陸地で判定）
  log("");
  const quantLand = mapFile.land.map((enc) => {
    const r: Pt[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < enc.length; i += 2) {
      x += enc[i];
      y += enc[i + 1];
      r.push([bbox[0] + x / Q, bbox[1] + y / Q]);
    }
    return r;
  });
  const offLand = stations.filter((s) => windingNumber(quantLand, [s.lon, s.lat]) === 0);
  log(`== 間引いた陸地の外（海の上）に見える駅: ${offLand.length} ==`);
  offLand.forEach((s) => log(`  ${s.name} (${s.lat}, ${s.lon})`));
  for (const name of ["お台場海浜公園", "台場", "羽田空港第1・第2ターミナル", "舞浜", "海芝浦", "新木場", "八景島"]) {
    const s = stations.filter((x) => x.name === name);
    log(`  確認: ${name} → ${s.length ? s.map((x) => (windingNumber(quantLand, [x.lon, x.lat]) ? "陸上" : "海上")).join(",") : "該当なし"}`);
  }

  // 容量
  log("");
  log("== 生成物の容量 ==");
  for (const f of ["stations.json", "map.json"]) {
    const b = fs.readFileSync(path.join(OUT_PUBLIC, f));
    log(`  public/data/${f}: ${(b.length / 1024).toFixed(1)} KB（gzip ${(zlib.gzipSync(b, { level: 9 }).length / 1024).toFixed(1)} KB）`);
  }

  fs.writeFileSync(path.join(OUT_DEBUG, "stations-report.txt"), report.join("\n") + "\n");
  drawDebug(quantLand, rails, rivers.lines, stations);
  console.log("tools/out/stations-report.txt と tools/out/map-debug.png を書き出しました");
}

// ---------------------------------------------------------------- 確認用の画像
function drawDebug(land: Pt[][], rails: Pt[][], rivers: Pt[][], stations: Station[]): void {
  const palette: Palette = [
    [170, 205, 230, 255], // 0 海
    [240, 234, 214, 255], // 1 陸
    [150, 150, 150, 255], // 2 線路
    [60, 120, 200, 255], // 3 川
    [200, 40, 40, 255], // 4 駅
    [30, 30, 30, 255], // 5 枠
    [255, 255, 255, 255], // 6 区切り
  ];
  const W = 1200;
  const kLat = 1 / Math.cos(35.6 * (Math.PI / 180));
  const views: { bbox: BBoxT; h: number }[] = [];
  const full: BBoxT = MAP_BBOX;
  views.push({ bbox: full, h: Math.round(((full[3] - full[1]) * W * kLat) / (full[2] - full[0])) });
  const city: BBoxT = [139.62, 35.56, 139.92, 35.76];
  views.push({ bbox: city, h: Math.round(((city[3] - city[1]) * W * kLat) / (city[2] - city[0])) });
  const gap = 8;
  const H = views.reduce((n, v) => n + v.h, 0) + gap;
  const img = createIndexed(W, H, 0);
  let oy = 0;
  for (const [vi, v] of views.entries()) {
    const sx = W / (v.bbox[2] - v.bbox[0]);
    const sy = v.h / (v.bbox[3] - v.bbox[1]);
    const tx = (p: Pt): [number, number] => [(p[0] - v.bbox[0]) * sx, oy + (v.bbox[3] - p[1]) * sy];
    // 陸地は表示範囲だけ塗る
    const sub = createIndexed(W, v.h, 0);
    fillPolygons(sub, land.map((r) => r.map((p) => { const q = tx(p); return [q[0], q[1] - oy] as [number, number]; })), 1);
    img.data.set(sub.data, oy * W);
    const inView = (y: number) => y >= oy && y < oy + v.h;
    const line = (l: Pt[], c: number) => {
      for (let i = 1; i < l.length; i++) {
        const a = tx(l[i - 1]);
        const b = tx(l[i]);
        if (!inView(a[1]) && !inView(b[1])) continue;
        // 表示範囲の外に描かないように1点ずつ確かめる
        const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
        for (let k = 0; k <= n; k++) {
          const x = a[0] + ((b[0] - a[0]) * k) / n;
          const y = a[1] + ((b[1] - a[1]) * k) / n;
          if (inView(y)) setPixel(img, x, y, c);
        }
      }
    };
    rivers.forEach((l) => line(l, 3));
    rails.forEach((l) => line(l, 2));
    const dot = vi === 0 ? 2 : 4;
    for (const s of stations) {
      const [x, y] = tx([s.lon, s.lat]);
      if (!inView(y)) continue;
      fillRect(img, Math.round(x) - (dot >> 1), Math.round(y) - (dot >> 1), dot, dot, 4);
    }
    if (vi === 0) {
      // 拡大図の範囲を枠で示す
      const a = tx([city[0], city[3]]);
      const b = tx([city[2], city[1]]);
      drawLine(img, a[0], a[1], b[0], a[1], 5);
      drawLine(img, a[0], b[1], b[0], b[1], 5);
      drawLine(img, a[0], a[1], a[0], b[1], 5);
      drawLine(img, b[0], a[1], b[0], b[1], 5);
    }
    oy += v.h;
    if (vi === 0) {
      fillRect(img, 0, oy, W, gap, 6);
      oy += gap;
    }
  }
  writePng(path.join(OUT_DEBUG, "map-debug.png"), img, palette);
}

main();
