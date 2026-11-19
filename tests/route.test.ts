import { describe, expect, it } from "vitest";
import {
  defaultRouteDraft,
  greatCircleKm,
  MAX_NAME_LENGTH,
  MAX_STATIONS,
  MIN_STATIONS,
  normalizeRouteName,
  parseRouteData,
  parseRouteDraft,
  routeDistanceKm,
  routeSectionLabel,
  stationNumber,
  type StationLookup,
} from "../shared/route/index.ts";
import { defaultDesign } from "../shared/train/index.ts";

// 試験用の駅（座標は概略）
const STATIONS = new Map<string, { name: string; lat: number; lon: number }>([
  ["s1", { name: "新宿", lat: 35.6896, lon: 139.7006 }],
  ["s2", { name: "渋谷", lat: 35.658, lon: 139.7016 }],
  ["s3", { name: "品川", lat: 35.6285, lon: 139.7388 }],
  ["s4", { name: "横浜", lat: 35.4658, lon: 139.6223 }],
  ["s5", { name: "東京", lat: 35.6812, lon: 139.7671 }],
]);
for (let i = 10; i < 50; i++) STATIONS.set(`s${i}`, { name: `駅${i}`, lat: 35 + i / 100, lon: 139.5 });
const lookup: StationLookup = (id) => STATIONS.get(id);

/** コードポイントから文字列を作る（見えない文字をソースに直接書かないため） */
const ch = (...cps: number[]) => String.fromCodePoint(...cps);

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

describe("路線データ（レビュー指摘への対応）", () => {
  const v = valid();
  const nameError = (name: unknown) => parseRouteData({ ...v, name }, lookup);
  const bad = { ok: false, error: "invalid_name" };

  it("余計なキーの中身には触れない（深い入れ子、大きな値、触ると失敗する値）", () => {
    let deep: unknown = {};
    for (let i = 0; i < 3700; i++) deep = { a: deep };
    let veryDeep: unknown = [];
    for (let i = 0; i < 200_000; i++) veryDeep = [veryDeep];
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error("触られた");
        },
        ownKeys() {
          throw new Error("触られた");
        },
        getOwnPropertyDescriptor() {
          throw new Error("触られた");
        },
      },
    );
    const inputs = [
      { ...v, extra: deep },
      { ...v, extra: veryDeep },
      { ...v, pad: "x".repeat(9000) },
      { ...v, big: 1n },
      { ...v, extra: trap },
      { ...v, train: { ...defaultDesign(), junk: deep, trap } },
      { ...v, train: { ...defaultDesign(), face: { ...defaultDesign().face, junk: deep } } },
    ];
    for (const input of inputs) {
      const t = performance.now();
      const r = parseRouteData(input, lookup);
      const ms = performance.now() - t;
      expect(r).toEqual({ ok: true, value: { ...v, symbol: "KR" } });
      expect(ms).toBeLessThan(20);
    }
  });

  it("プロトタイプのキーは読まない", () => {
    const proto = { ...v };
    expect(parseRouteData(Object.create(proto), lookup)).toEqual({ ok: false, error: "invalid_version" });
  });

  it("駅 ID の形式と、lookup の結果の形を確かめる", () => {
    // 普通のオブジェクトを直接引く lookup でも、プロトタイプの名前は駅として通さない
    const plain: Record<string, { name: string; lat: number; lon: number }> = { s1: STATIONS.get("s1")!, s2: STATIONS.get("s2")! };
    const naive: StationLookup = (id) => plain[id];
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(parseRouteData({ ...v, stations: ["s1", id] }, naive), id).toEqual({ ok: false, error: "unknown_station" });
      expect(parseRouteData({ ...v, stations: ["s1", id] }, lookup), id).toEqual({ ok: false, error: "unknown_station" });
    }
    // 形式が違う ID（空、長すぎる、記号、空白、全角）
    const odd: StationLookup = () => ({ name: "どこでも", lat: 35, lon: 139 });
    for (const id of ["", "x".repeat(33), "s1/../s2", "s 1", "s1\n", "ｓ１", "s1.2"]) {
      expect(parseRouteData({ ...v, stations: ["s1", id] }, odd), JSON.stringify(id)).toEqual({ ok: false, error: "unknown_station" });
    }
    expect(parseRouteData({ ...v, stations: ["s1", "x".repeat(32)] }, odd).ok).toBe(true);
    expect(parseRouteData({ ...v, stations: ["s002484", "S_0-1"] }, odd).ok).toBe(true);
    // lookup の結果が駅の形でない
    const shapes: unknown[] = [null, 1, "新宿", [], { name: 1, lat: 35, lon: 139 }, { name: "x", lat: "35", lon: 139 }, { name: "x", lat: 35, lon: NaN }, { name: "x", lat: Infinity, lon: 139 }, { name: "x", lat: 35 }];
    for (const shape of shapes) {
      const broken: StationLookup = (id) => (id === "s2" ? (shape as ReturnType<StationLookup>) : STATIONS.get(id));
      expect(parseRouteData({ ...v, stations: ["s1", "s2"] }, broken), JSON.stringify(shape)).toEqual({ ok: false, error: "unknown_station" });
    }
  });

  it("駅数の上限を超える配列は件数で拒否する（中身が文字列でなければ invalid_stations）", () => {
    expect(parseRouteData({ ...v, stations: new Array(100_000).fill("s1") }, lookup)).toEqual({ ok: false, error: "too_many_stations" });
    expect(parseRouteData({ ...v, stations: new Array(100_000).fill(1) }, lookup)).toEqual({ ok: false, error: "invalid_stations" });
  });

  it("路線名: 双方向制御文字を拒否する", () => {
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]) {
      expect(nameError(`テスト${ch(cp)}線`), cp.toString(16)).toEqual(bad);
      expect(nameError(ch(cp)), cp.toString(16)).toEqual(bad);
    }
  });

  it("路線名: ゼロ幅・書式の文字、異体字セレクタ、タグ文字、見えない文字を拒否する", () => {
    const cps = [
      0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad, 0x034f, 0x180e, // ゼロ幅・書式
      0xfe00, 0xfe0f, 0xe0100, 0xe01ef, 0x180b, // 異体字セレクタ
      0xe0001, 0xe0020, 0xe007f, // タグ文字
      0x3164, 0x115f, 0x1160, 0xffa0, // ハングルの埋め字（見えない文字）
      0xe000, 0xf8ff, // 私用領域
    ];
    for (const cp of cps) {
      expect(nameError(`テスト${ch(cp)}線`), cp.toString(16)).toEqual(bad);
      expect(nameError(ch(cp)), cp.toString(16)).toEqual(bad);
      expect(nameError(ch(cp, cp, cp)), cp.toString(16)).toEqual(bad);
    }
    // 絵文字の ZWJ 連結も通さない
    expect(nameError(ch(0x1f468, 0x200d, 0x1f469))).toEqual(bad);
  });

  it("路線名: 空白だけの名前を拒否する", () => {
    for (const name of [" ", "　", " 　 ", ch(0xa0), ch(0x2003), ch(0xa0, 0x3000, 0x2009), ch(0x205f)]) {
      expect(nameError(name), JSON.stringify(name)).toEqual(bad);
    }
  });

  it("路線名: 前後の改行・タブなどは黙って消さずに拒否する", () => {
    for (const name of ["\nテスト線", "テスト線\n", "\tテスト線", "テスト線\t", "\r\nテスト線", " テスト線\n ", `${ch(0x2028)}テスト線`, `テスト線${ch(0x85)}`, `テスト線${ch(0x0b)}`, `テスト線${ch(0x0c)}`]) {
      expect(nameError(name), JSON.stringify(name)).toEqual(bad);
    }
    // 前後の半角・全角スペースは除く
    expect(normalizeRouteName("　 テスト線 　")).toBe("テスト線");
    // 間の空白は残す
    expect(normalizeRouteName("テスト 線")).toBe("テスト 線");
  });

  it("路線名: 孤立サロゲートを拒否する", () => {
    const hi = String.fromCharCode(0xd800);
    const lo = String.fromCharCode(0xdc00);
    for (const name of [hi, lo, `テスト${hi}`, `${lo}テスト`, `テ${hi}ス${lo}ト`, lo + hi, hi + hi + lo]) {
      expect(nameError(name), JSON.stringify(name)).toEqual(bad);
    }
    // 正しいサロゲートペアは通す
    expect(normalizeRouteName(hi + lo)).toBe(hi + lo);
  });

  it("路線名: サロゲートペアを含む 12 文字は通り、13 文字は拒否する", () => {
    const kanji = ch(0x20bb7); // 𠮷（サロゲートペア）
    const twelve = kanji + "の" + kanji.repeat(5) + "あいうえお";
    expect([...twelve].length).toBe(MAX_NAME_LENGTH);
    expect(twelve.length).toBe(MAX_NAME_LENGTH + 6);
    expect(parseRouteData({ ...v, name: twelve }, lookup)).toEqual({ ok: true, value: { ...v, symbol: "KR", name: twelve } });
    expect(nameError(twelve + "か")).toEqual(bad);
    expect(nameError(twelve + kanji)).toEqual(bad);
    expect(nameError(kanji.repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    expect(nameError(kanji.repeat(MAX_NAME_LENGTH + 1))).toEqual(bad);
    // 前後のスペースは数えない
    expect(nameError(`  ${twelve}　`)).toEqual({ ok: true, value: { ...v, symbol: "KR", name: twelve } });
  });

  it("正常な名前は今までどおり通る", () => {
    for (const name of ["テスト線", "山手線", "Ｒ２線", "A線", "東急東横線", "ゆりかもめ", "埼京・川越線", "1号線", "ー〜・（）", "🚃"]) {
      expect(normalizeRouteName(name), name).toBe(name);
    }
  });
});
