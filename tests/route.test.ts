import { describe, expect, it } from "vitest";
import {
  defaultRouteDraft,
  greatCircleKm,
  MAX_NAME_LENGTH,
  MAX_STATIONS,
  MIN_STATIONS,
  parseRouteData,
  parseRouteDraft,
  routeDistanceKm,
  routeSectionLabel,
  stationNumber,
  type StationLookup,
} from "../shared/route/index.ts";
import { defaultDesign } from "../shared/train/index.ts";

// 試験用の駅（座標は概略）
const STATIONS: Record<string, { name: string; lat: number; lon: number }> = {
  s1: { name: "新宿", lat: 35.6896, lon: 139.7006 },
  s2: { name: "渋谷", lat: 35.658, lon: 139.7016 },
  s3: { name: "品川", lat: 35.6285, lon: 139.7388 },
  s4: { name: "横浜", lat: 35.4658, lon: 139.6223 },
  s5: { name: "東京", lat: 35.6812, lon: 139.7671 },
};
for (let i = 10; i < 50; i++) STATIONS[`s${i}`] = { name: `駅${i}`, lat: 35 + i / 100, lon: 139.5 };
const lookup: StationLookup = (id) => STATIONS[id];

const valid = () => ({ ...defaultRouteDraft(), name: "テスト線", symbol: "kr", stations: ["s1", "s2", "s3"] });

describe("路線データ", () => {
  it("初期値", () => {
    const d = defaultRouteDraft();
    expect(d).toEqual({ v: 1, name: "あたらしい路線", symbol: "DR", lineColor: defaultDesign().bandColor, stations: [], loop: false, train: defaultDesign() });
    expect(parseRouteDraft(d, lookup).ok).toBe(true);
    expect(parseRouteData(d, lookup)).toEqual({ ok: false, error: "too_few_stations" });
  });

  it("正しい値を正規化する（空白、大文字、余計なキー）", () => {
    const r = parseRouteData({ ...valid(), name: "  テスト線　", extra: "x", train: { ...defaultDesign(), junk: 1 } }, lookup);
    expect(r).toEqual({ ok: true, value: { ...valid(), name: "テスト線", symbol: "KR", train: defaultDesign() } });
  });

  it("不正な入力を理由つきで拒否する", () => {
    const v = valid();
    const many = Array.from({ length: MAX_STATIONS + 1 }, (_, i) => `s${i + 10}`);
    const cases: [unknown, string][] = [
      [null, "invalid_format"],
      [[], "invalid_format"],
      ["{}", "invalid_format"],
      [{ ...v, v: 2 }, "invalid_version"],
      [{ ...v, v: undefined }, "invalid_version"],
      [{ ...v, name: "" }, "invalid_name"],
      [{ ...v, name: "   " }, "invalid_name"],
      [{ ...v, name: "あ".repeat(MAX_NAME_LENGTH + 1) }, "invalid_name"],
      [{ ...v, name: "改行\nあり" }, "invalid_name"],
      [{ ...v, name: "タブ\tあり" }, "invalid_name"],
      [{ ...v, name: "区切り\u2028" + "x" }, "invalid_name"],
      [{ ...v, name: 12 }, "invalid_name"],
      [{ ...v, symbol: "" }, "invalid_symbol"],
      [{ ...v, symbol: "ABC" }, "invalid_symbol"],
      [{ ...v, symbol: "K1" }, "invalid_symbol"],
      [{ ...v, symbol: "Ｋ" }, "invalid_symbol"],
      [{ ...v, lineColor: "gold" }, "invalid_line_color"],
      [{ ...v, stations: "s1,s2" }, "invalid_stations"],
      [{ ...v, stations: ["s1", 2] }, "invalid_stations"],
      [{ ...v, stations: ["s1"] }, "too_few_stations"],
      [{ ...v, stations: many }, "too_many_stations"],
      [{ ...v, stations: ["s1", "nope"] }, "unknown_station"],
      [{ ...v, stations: ["s1", "s2", "s1"] }, "duplicate_station"],
      [{ ...v, loop: "yes" }, "invalid_loop"],
      [{ ...v, stations: ["s1", "s2"], loop: true }, "loop_too_short"],
      [{ ...v, train: null }, "invalid_train"],
      [{ ...v, train: { ...defaultDesign(), cars: 99 } }, "invalid_cars"],
      [{ ...v, pad: "x".repeat(9000) }, "too_large"],
    ];
    for (const [input, error] of cases) expect(parseRouteData(input, lookup), JSON.stringify(input).slice(0, 80)).toEqual({ ok: false, error });
  });

  it("名前の文字数はコードポイントで数える", () => {
    const name = "🚃".repeat(MAX_NAME_LENGTH);
    const r = parseRouteData({ ...valid(), name }, lookup);
    expect(r.ok && r.value.name).toBe(name);
  });

  it("駅数の境目と環状", () => {
    expect(parseRouteData({ ...valid(), stations: ["s1", "s2"] }, lookup).ok).toBe(true);
    const thirty = Array.from({ length: MAX_STATIONS }, (_, i) => `s${i + 10}`);
    expect(parseRouteData({ ...valid(), stations: thirty }, lookup).ok).toBe(true);
    expect(parseRouteData({ ...valid(), loop: true }, lookup).ok).toBe(true);
    expect(MIN_STATIONS).toBe(2);
    expect(parseRouteDraft({ ...valid(), stations: [] }, lookup).ok).toBe(true);
    expect(parseRouteDraft({ ...valid(), stations: ["s1"] }, lookup).ok).toBe(true);
  });

  it("駅ナンバリング", () => {
    expect(stationNumber("KR", 0)).toBe("KR01");
    expect(stationNumber("A", 9)).toBe("A10");
    expect(stationNumber("DR", 29)).toBe("DR30");
  });

  it("距離（直線距離の合計、小数1桁）", () => {
    // 緯度 1 度 ≒ 111.2 km
    expect(greatCircleKm(35, 139, 36, 139)).toBeCloseTo(111.2, 1);
    const ab = greatCircleKm(35.6896, 139.7006, 35.658, 139.7016);
    const bc = greatCircleKm(35.658, 139.7016, 35.6285, 139.7388);
    const ca = greatCircleKm(35.6285, 139.7388, 35.6896, 139.7006);
    expect(routeDistanceKm({ stations: ["s1", "s2", "s3"], loop: false }, lookup)).toBe(Math.round((ab + bc) * 10) / 10);
    expect(routeDistanceKm({ stations: ["s1", "s2", "s3"], loop: true }, lookup)).toBe(Math.round((ab + bc + ca) * 10) / 10);
    // 新宿〜横浜はおよそ 25 km
    const d = routeDistanceKm({ stations: ["s1", "s4"], loop: false }, lookup);
    expect(d).toBeGreaterThan(24);
    expect(d).toBeLessThan(27);
    expect(routeDistanceKm({ stations: [], loop: false }, lookup)).toBe(0);
  });

  it("区間の表示", () => {
    expect(routeSectionLabel({ stations: ["s1", "s2", "s4"], loop: false }, lookup)).toBe("新宿 ⇄ 横浜");
    expect(routeSectionLabel({ stations: ["s1", "s2", "s4"], loop: true }, lookup)).toBe("環状（起点 新宿）");
    expect(routeSectionLabel({ stations: [], loop: false }, lookup)).toBe("");
  });
});
