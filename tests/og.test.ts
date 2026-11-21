// 路線ごとの X 用の絵（shared/og）と、パレット形式の PNG（shared/pix/png.ts）の試験。
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { OG_H, OG_PALETTE, OG_SCALE, OG_W, renderRouteOg, routeOgPng } from "../shared/og/index.ts";
import { crc32, deflateAsync, encodeIndexedPng, encodeIndexedPngAsync, type Rgba } from "../shared/pix/index.ts";
import { MAX_CARS, type RouteData } from "../shared/route/index.ts";
import { FixtureKit, loadFont, loadStations } from "../tools/lib/card-fixtures.ts";
import { ogFixtures, type OgFixture } from "../tools/lib/og-fixtures.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
let kit: FixtureKit;
let fixtures: OgFixture[];

beforeAll(() => {
  kit = new FixtureKit(loadFont(ROOT), loadStations(ROOT));
  fixtures = ogFixtures(kit);
});

type Chunk = { type: string; data: Uint8Array };

/** PNG をチャンクに分け、各チャンクの CRC を確かめる */
function chunks(png: Uint8Array): Chunk[] {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let o = 8;
  while (o < png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + len);
    expect(dv.getUint32(o + 8 + len), `${type} の CRC`).toBe(crc32(png, o + 4, o + 8 + len));
    out.push({ type, data });
    o += 12 + len;
  }
  expect(o).toBe(png.length);
  return out;
}

/** パレット形式の PNG を読み、幅・高さ・色番号（フィルタ 0 を外したもの）を返す */
function decodeIndexed(png: Uint8Array) {
  const cs = chunks(png);
  expect(cs[0].type).toBe("IHDR");
  expect(cs[cs.length - 1].type).toBe("IEND");
  const ih = new DataView(cs[0].data.buffer, cs[0].data.byteOffset, 13);
  const w = ih.getUint32(0);
  const h = ih.getUint32(4);
  expect(cs[0].data[8]).toBe(8);
  expect(cs[0].data[9]).toBe(3);
  const plte = cs.find((c) => c.type === "PLTE")!;
  const raw = inflateSync(Buffer.concat(cs.filter((c) => c.type === "IDAT").map((c) => c.data)));
  expect(raw.length).toBe((w + 1) * h);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w + 1)]).toBe(0);
    px.set(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), y * w);
  }
  return { w, h, px, plte: plte.data, types: cs.map((c) => c.type) };
}

describe("パレット形式の PNG", () => {
  const pal: Rgba[] = [
    [0, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 128],
  ];
  const px = new Uint8Array([0, 1, 2, 1, 0, 2]);

  it("同期（zlib）と非同期（CompressionStream）で同じ画像になり、2 倍に拡大できる", async () => {
    const a = decodeIndexed(encodeIndexedPng(3, 2, px, pal, (d) => deflateSync(d), 2));
    const b = decodeIndexed(await encodeIndexedPngAsync(3, 2, px, pal, 2));
    for (const r of [a, b]) {
      expect([r.w, r.h]).toEqual([6, 4]);
      expect([...r.px]).toEqual([0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 2, 2, 1, 1, 0, 0, 2, 2]);
      expect([...r.plte]).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 255]);
      // 不透明でない色があるので tRNS を書く
      expect(r.types).toEqual(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
    }
  });

  it("CompressionStream の deflate は zlib 形式", async () => {
    const data = new TextEncoder().encode("ドット路線メーカー".repeat(50));
    expect(new Uint8Array(inflateSync(await deflateAsync(data)))).toEqual(data);
  });

  it("大きさが合わない・倍率が不正なら投げる", () => {
    expect(() => encodeIndexedPng(3, 3, px, pal, (d) => deflateSync(d))).toThrow();
    expect(() => encodeIndexedPng(3, 2, px, pal, (d) => deflateSync(d), 0)).toThrow();
  });
});

describe("X 用の絵", () => {
  it("見本のすべてで投げず、1200×630 の正しい PNG になる。透明な点が無い", async () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    for (const f of fixtures) {
      const img = renderRouteOg({ route: f.route, lookup: kit.lookup, font: kit.font });
      expect([img.width, img.height], f.id).toEqual([OG_W, OG_H]);
      for (const v of img.data) if (OG_PALETTE[v][3] !== 255) throw new Error(`${f.id}: 透明な点 ${v}`);
      const png = await routeOgPng({ route: f.route, lookup: kit.lookup, font: kit.font });
      const d = decodeIndexed(png);
      expect([d.w, d.h], f.id).toEqual([OG_W * OG_SCALE, OG_H * OG_SCALE]);
      expect(d.types, f.id).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
      // 2 倍にした左上の点が、元の点と同じ
      expect(d.px[0], f.id).toBe(img.data[0]);
      expect(png.byteLength, f.id).toBeLessThan(100 * 1024);
    }
  });

  // 06-1car は屋根にパンタグラフのある顔、08-dark は無い顔
  it("正面の顔（パンタグラフを含む）は台紙の中に、上端から 6 ドット以上空けて収まる", () => {
    for (const f of fixtures) {
      const img = renderRouteOg({ route: f.route, lookup: kit.lookup, font: kit.font });
      // 顔の列（40〜168）で、台紙（紙の色 242）の上端と、電車の色番号（0〜207）が最初に出る行
      const col = (y: number) => Array.from({ length: 128 }, (_, i) => img.data[y * OG_W + 40 + i]);
      const mountTop = Array.from({ length: OG_H }, (_, y) => y).find((y) => col(y).every((v) => v === 242 || v < 208))!;
      const trainTop = Array.from({ length: OG_H }, (_, y) => y).find((y) => col(y).some((v) => v < 208))!;
      expect(trainTop - mountTop, f.id).toBeGreaterThanOrEqual(6);
    }
  });

  it("おかしな入力（駅が引けない、絵文字だけの名前、最大両数、両数の範囲外、32 文字の名前）でも投げない", async () => {
    const base = fixtures.find((f) => f.id === "04-30st-max")!.route;
    const cases: RouteData[] = [
      { ...base, name: "🚃🚃🚃" },
      { ...base, name: "あ".repeat(32) },
      { ...base, name: "W".repeat(40) },
      { ...base, train: { ...base.train, cars: MAX_CARS } },
      { ...base, train: { ...base.train, cars: 0 } },
      { ...base, train: { ...base.train, cars: 1000 } },
      { ...base, train: { ...base.train, cars: Number.NaN } },
      { ...base, stations: [] },
      { ...base, stations: [base.stations[0]] },
      { ...base, loop: true },
      { ...base, loop: true, stations: base.stations.slice(0, 2) },
    ];
    for (const route of cases) {
      expect(() => renderRouteOg({ route, lookup: kit.lookup, font: kit.font })).not.toThrow();
    }
    // 駅が 1 つも引けない
    const none = () => undefined;
    expect(() => renderRouteOg({ route: base, lookup: none, font: kit.font })).not.toThrow();
    await expect(routeOgPng({ route: base, lookup: none, font: kit.font })).resolves.toBeInstanceOf(Uint8Array);
  });
});
