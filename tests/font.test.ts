import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  drawText,
  encodeBitmapFont,
  hasGlyph,
  measureText,
  parseBitmapFont,
  setDefaultFont,
  type BitmapFont,
} from "../shared/font/index.ts";
import { createBit, createIndexed, getPixel } from "../shared/pix/index.ts";

let font: BitmapFont;
beforeAll(() => {
  font = parseBitmapFont(new Uint8Array(fs.readFileSync(new URL("../public/fonts/dotgothic16.bin", import.meta.url))));
});

const rowsOf = (img: Parameters<typeof getPixel>[0], w: number, h: number, x0 = 0, y0 = 0, step = 1) => {
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let s = "";
    for (let x = 0; x < w; x++) s += getPixel(img, x0 + x * step, y0 + y * step) ? "#" : ".";
    out.push(s);
  }
  return out;
};

// DotGothic16 の「A」（8×16）
const GLYPH_A = [
  "........",
  "........",
  "....#...",
  "....#...",
  "....#...",
  "...#.#..",
  "...#.#..",
  "...#.#..",
  "..#...#.",
  "..#...#.",
  "..#...#.",
  "..#####.",
  ".#.....#",
  ".#.....#",
  ".#.....#",
  "........",
];

// DotGothic16 の「新」（16×16）。輪郭を高解像度で調べた形と照らし合わせて確認したもの
const GLYPH_SHIN = [
  "................",
  "....#...........",
  "....#........##.",
  ".#######.####...",
  "..#...#..#......",
  "..#...#..#......",
  "...#.#...#......",
  ".#######.#######",
  "....#....#...#..",
  ".#######.#...#..",
  "...###...#...#..",
  "..#.#.#..#...#..",
  "..#.#.#..#...#..",
  ".#..#..##....#..",
  "....#...#....#..",
  "....#...#....#..",
];

describe("点データのフォントと drawText", () => {
  it("必要な文字が入っている", () => {
    expect(font.height).toBe(16);
    expect(font.codepoints.length).toBeGreaterThan(6900);
    for (const ch of "ドット路線メーカー新宿御茶ノ水霞ヶ関〜～−－Az09") expect(hasGlyph(font, ch.codePointAt(0)!), ch).toBe(true);
  });

  it("送り幅は半角 8・全角 16", () => {
    expect(measureText("A", 1, { font })).toBe(8);
    expect(measureText("新", 1, { font })).toBe(16);
    expect(measureText("A新宿", 2, { font })).toBe(80);
  });

  it("「A」の点が期待どおり（白黒画像、等倍）", () => {
    const img = createBit(8, 16);
    expect(drawText(img, 0, 0, "A", 1, { font })).toBe(8);
    expect(rowsOf(img, 8, 16)).toEqual(GLYPH_A);
  });

  it("2 倍では各点が 2×2 になる（色番号画像、位置ずらし）", () => {
    const img = createIndexed(40, 40, 0);
    drawText(img, 3, 5, "A", 2, { font, color: 7 });
    expect(rowsOf(img, 8, 16, 3, 5, 2)).toEqual(GLYPH_A);
    expect(rowsOf(img, 8, 16, 4, 6, 2)).toEqual(GLYPH_A);
    expect(img.data[(5 + 2 * 2) * 40 + 3 + 4 * 2]).toBe(7);
    // 塗った点の数は等倍の 4 倍
    const ones = GLYPH_A.join("").split("#").length - 1;
    expect(img.data.filter((v) => v === 7).length).toBe(ones * 4);
  });

  it("全角の「新」の点が期待どおり", () => {
    const img = createBit(16, 16);
    expect(drawText(img, 0, 0, "新", 1, { font })).toBe(16);
    expect(rowsOf(img, 16, 16)).toEqual(GLYPH_SHIN);
  });

  it("全角の「一」は横一列の線になる", () => {
    const img = createBit(16, 16);
    drawText(img, 0, 0, "一", 1, { font });
    const rows = rowsOf(img, 16, 16);
    const filled = rows.filter((r) => r.includes("#"));
    expect(filled.length).toBe(1);
    expect(filled[0].replace(/^\.+|\.+$/g, "")).toMatch(/^#+$/);
    expect(filled[0].split("#").length - 1).toBeGreaterThanOrEqual(12);
  });

  it("「新宿」は 2 文字分の幅に点が入り、はみ出さない", () => {
    const img = createBit(40, 16);
    expect(drawText(img, 0, 0, "新宿", 1, { font })).toBe(32);
    const rows = rowsOf(img, 40, 16);
    expect(rows.some((r) => r.slice(0, 16).includes("#"))).toBe(true);
    expect(rows.some((r) => r.slice(16, 32).includes("#"))).toBe(true);
    expect(rows.every((r) => !r.slice(32).includes("#"))).toBe(true);
  });

  it("倍率は整数のみ", () => {
    expect(() => drawText(createBit(8, 8), 0, 0, "A", 1.5, { font })).toThrow();
  });

  it("既定のフォントを決めれば font を省略できる", () => {
    setDefaultFont(font);
    expect(measureText("AB")).toBe(16);
  });

  it("書き出したファイルを読み戻せる", () => {
    const rows = new Uint8Array(32);
    rows[0] = 0x80;
    const bin = encodeBitmapFont([
      { codepoint: 0x42, advance: 8, rows: new Uint8Array(32) },
      { codepoint: 0x41, advance: 8, rows },
    ]);
    const f = parseBitmapFont(bin);
    expect([...f.codepoints]).toEqual([0x41, 0x42]);
    const img = createBit(8, 2);
    drawText(img, 0, 0, "A", 1, { font: f });
    expect(getPixel(img, 0, 0)).toBe(1);
    expect(getPixel(img, 1, 0)).toBe(0);
  });
});
