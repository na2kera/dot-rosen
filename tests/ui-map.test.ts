// 画面の地図（src/map）と駅の検索（src/data）の試験。
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeMap, type MapFile, type StationsFile } from "../shared/geo/map-data.ts";
import { createIndexed } from "../shared/pix/index.ts";
import { buildStationIndex, normalizeForSearch, searchStations } from "../src/data/station-index.ts";
import { originOf, zoomAround, type Camera } from "../src/map/camera.ts";
import { hitTest, placeLabels } from "../src/map/hit.ts";
import { renderStatic } from "../src/map/raster.ts";
import { buildWorld, KX } from "../src/map/world.ts";

const read = <T>(p: string): T => JSON.parse(fs.readFileSync(new URL(`../public/data/${p}`, import.meta.url), "utf8")) as T;
const stFile = read<StationsFile>("stations.json");
const world = buildWorld(decodeMap(read<MapFile>("map.json")), stFile.stations);

const viewAt = (lon: number, lat: number, z: number, w: number, h: number) => ({
  ox: Math.floor(lon * KX * z - w / 2),
  oy: Math.floor(-lat * z - h / 2),
  z,
});

describe("地図の描画", () => {
  it("矩形で切り取ってから塗っても、切り取らない描き方とドット単位で同じ", () => {
    for (const [lon, lat, z] of [
      [139.767, 35.681, 120],
      [139.767, 35.681, 900],
      [139.65, 35.45, 3000],
      [139.9, 35.6, 9000],
      [139.48, 35.31, 2500],
    ]) {
      const v = viewAt(lon, lat, z, 160, 300);
      const a = createIndexed(160, 300);
      const b = createIndexed(160, 300);
      renderStatic(a, world, v);
      renderStatic(b, world, v, { clip: false });
      expect(Buffer.from(a.data).equals(Buffer.from(b.data)), `${lon},${lat},${z}`).toBe(true);
    }
  });

  it("整数ドットずらして描くと、絵は形を変えずにずれるだけ（移動中にちらつかない）", () => {
    const W = 120;
    const H = 120;
    const v = viewAt(139.7, 35.68, 2700, W, H);
    const a = createIndexed(W, H);
    const b = createIndexed(W, H);
    renderStatic(a, world, v);
    renderStatic(b, world, { ...v, ox: v.ox + 7, oy: v.oy - 5 });
    // b の (x, y) は a の (x + 7, y − 5) と同じ地点
    for (let y = 5; y < H; y++) {
      for (let x = 0; x < W - 7; x++) {
        if (a.data[(y - 5) * W + x + 7] !== b.data[y * W + x]) throw new Error(`${x},${y}`);
      }
    }
  });

  it("陸と海の両方が描かれる（東京湾のあたり）", () => {
    const img = createIndexed(100, 100);
    renderStatic(img, world, viewAt(139.85, 35.55, 400, 100, 100));
    const set = new Set(img.data);
    expect(set.has(0)).toBe(true);
    expect(set.has(1)).toBe(true);
  });
});

describe("視点", () => {
  it("拡大しても、指の下の地点が動かない", () => {
    const vp = { w: 200, h: 300 };
    const c: Camera = { cx: 139.7 * KX, cy: -35.68, z: 2000 };
    const before = { x: (30 + originOf(c, vp).ox) / c.z, y: (40 + originOf(c, vp).oy) / c.z };
    const c2 = zoomAround(c, vp, 5000, 30, 40);
    const after = { x: (30 + originOf(c2, vp).ox) / c2.z, y: (40 + originOf(c2, vp).oy) / c2.z };
    // 原点を整数にそろえるので、ずれは1ドット未満
    expect(Math.abs(before.x - after.x) * c2.z).toBeLessThan(1);
    expect(Math.abs(before.y - after.y) * c2.z).toBeLessThan(1);
  });
});

describe("駅のタップ", () => {
  const opts = { radius: 22, denseSep: 20, margin: 8, atMaxZoom: false };
  it("半径内で一番近い駅を選ぶ", () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 160, y: 100 },
    ];
    expect(hitTest(pts, { x: 115, y: 110 }, opts)).toEqual({ kind: "station", index: 0 });
    expect(hitTest(pts, { x: 140, y: 100 }, opts)).toEqual({ kind: "station", index: 1 });
    expect(hitTest(pts, { x: 130, y: 140 }, opts)).toEqual({ kind: "none" });
  });

  it("密集していて区別できないときは選ばない（最大まで拡大していれば選ぶ）", () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
    ];
    // 2駅の間あたり（差が margin 未満）は区別できない
    expect(hitTest(pts, { x: 104, y: 100 }, opts)).toMatchObject({ kind: "dense", index: 0, sep: 10 });
    // 片方の真上なら選べる
    const wide = [
      { x: 100, y: 100 },
      { x: 116, y: 100 },
    ];
    expect(hitTest(wide, { x: 99, y: 100 }, opts)).toEqual({ kind: "station", index: 0 });
    expect(hitTest(wide, { x: 107, y: 100 }, opts)).toMatchObject({ kind: "dense" });
    // 点が重なるほど近いときは、いつも区別できない
    expect(hitTest(pts.map((p, i) => ({ x: p.x - i * 4, y: p.y })), { x: 100, y: 100 }, opts)).toMatchObject({ kind: "dense" });
    expect(hitTest(pts, { x: 101, y: 100 }, { ...opts, atMaxZoom: true })).toEqual({ kind: "station", index: 0 });
  });

  it("駅名は重ならないように置き、置けないものは出さない", () => {
    const placed = placeLabels(
      [
        { key: "a", x: 50, y: 50, w: 40, h: 20 },
        { key: "b", x: 52, y: 52, w: 40, h: 20 },
        { key: "c", x: 54, y: 50, w: 40, h: 20 },
        { key: "d", x: 52, y: 51, w: 40, h: 20 },
        { key: "e", x: 50, y: 52, w: 40, h: 20 },
      ],
      { w: 200, h: 200 },
      6,
    );
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    expect(placed[0].key).toBe("a");
    expect(placed.length).toBeLessThan(5);
  });
});

describe("駅の検索", () => {
  const index = buildStationIndex(stFile);
  it("漢字・かなの部分一致。完全一致が先頭", () => {
    const r = searchStations(index, "新宿");
    expect(r[0].station.name).toBe("新宿");
    expect(r.some((h) => h.station.name === "西新宿")).toBe(true);
    expect(searchStations(index, "ゲートウェイ")[0].station.name).toBe("高輪ゲートウェイ");
  });

  it("ヶとケ、カタカナとひらがなの違いを気にしない", () => {
    expect(normalizeForSearch("霞ケ関")).toBe(normalizeForSearch("霞ヶ関"));
    expect(searchStations(index, "霞ケ関").length).toBeGreaterThan(0);
  });

  it("同じ名前の別の駅は都県名と路線名で区別できる", () => {
    const r = searchStations(index, "小川町").filter((h) => h.station.name === "小川町");
    expect(r.length).toBe(2);
    expect(r[0].detail).not.toBe(r[1].detail);
  });
});
