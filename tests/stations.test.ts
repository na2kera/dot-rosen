import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeMap, type MapFile, type StationsFile } from "../shared/geo/map-data.ts";

const read = <T>(p: string): T => JSON.parse(fs.readFileSync(new URL(`../public/data/${p}`, import.meta.url), "utf8")) as T;
const st = read<StationsFile>("stations.json");

describe("駅データ", () => {
  it("件数が妥当（国の集計 1,734 駅の前後）", () => {
    expect(st.v).toBe(1);
    expect(st.stations.length).toBeGreaterThan(1400);
    expect(st.stations.length).toBeLessThan(2000);
  });

  it("ID が重複しない", () => {
    const ids = st.stations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^s\d{6}$/);
  });

  it("主要駅が1件ずつある", () => {
    for (const name of ["新宿", "東京", "横浜", "大宮", "千葉"]) {
      expect(st.stations.filter((s) => s.name === name).length, name).toBe(1);
    }
  });

  it("新宿は会社を問わず1駅にまとまっている", () => {
    const shinjuku = st.stations.find((s) => s.name === "新宿")!;
    const ops = new Set(shinjuku.lines.map((i) => st.lines[i].operator));
    for (const op of ["東日本旅客鉄道", "小田急電鉄", "京王電鉄", "東京地下鉄", "東京都"]) expect(ops.has(op), op).toBe(true);
  });

  it("座標・都県・路線番号が範囲内", () => {
    for (const s of st.stations) {
      expect(s.lon).toBeGreaterThan(138.9);
      expect(s.lon).toBeLessThan(140.95);
      expect(s.lat).toBeGreaterThan(34.85);
      expect(s.lat).toBeLessThan(36.35);
      expect([11, 12, 13, 14]).toContain(s.pref);
      expect(s.lines.length).toBeGreaterThan(0);
      for (const i of s.lines) expect(st.lines[i]).toBeDefined();
      // 小数は5桁まで
      expect(Math.round(s.lat * 1e5) / 1e5).toBe(s.lat);
      expect(Math.round(s.lon * 1e5) / 1e5).toBe(s.lon);
    }
  });

  it("地図データを読み込める", () => {
    const map = decodeMap(read<MapFile>("map.json"));
    expect(map.land.length).toBeGreaterThan(10);
    expect(map.rails.length).toBeGreaterThan(100);
    for (const p of map.land) {
      expect(p.length % 2).toBe(0);
      for (let i = 0; i < p.length; i += 2) {
        expect(p[i]).toBeGreaterThanOrEqual(map.bbox[0] - 0.02);
        expect(p[i]).toBeLessThanOrEqual(map.bbox[2] + 0.02);
      }
    }
  });
});
