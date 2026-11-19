import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  blit,
  bitToRgba,
  crc32,
  createBit,
  createIndexed,
  drawLine,
  encodePng,
  fillPolygons,
  fillRect,
  getPixel,
  indexedToRgba,
  setPixel,
} from "../shared/pix/index.ts";

const dump = (img: { width: number; height: number } & Parameters<typeof getPixel>[0]) => {
  const rows: string[] = [];
  for (let y = 0; y < img.height; y++) {
    let s = "";
    for (let x = 0; x < img.width; x++) s += String(getPixel(img, x, y));
    rows.push(s);
  }
  return rows;
};

describe("ドット絵の基礎部品", () => {
  it("白黒画像は行ごとにバイト詰めで、左端が最上位ビット", () => {
    const img = createBit(10, 2);
    expect(img.stride).toBe(2);
    setPixel(img, 0, 0, 1);
    setPixel(img, 9, 1, 1);
    expect(img.data[0]).toBe(0x80);
    expect(img.data[3]).toBe(0x40);
    setPixel(img, 0, 0, 0);
    expect(img.data[0]).toBe(0);
    // 範囲外は無視
    setPixel(img, -1, 0, 1);
    setPixel(img, 10, 0, 1);
    expect(getPixel(img, 10, 0)).toBe(0);
  });

  it("矩形ははみ出しを切り取る", () => {
    const img = createIndexed(4, 3);
    fillRect(img, -1, 1, 3, 5, 7);
    expect(dump(img)).toEqual(["0000", "7700", "7700"]);
  });

  it("線は両端を含み、ぼかさない", () => {
    const img = createIndexed(5, 3);
    drawLine(img, 0, 0, 4, 2, 1);
    expect(dump(img)).toEqual(["10000", "01100", "00011"]);
    // 逆向きに引いても両端が入り、各列に1点ずつ
    const img2 = createIndexed(5, 3);
    drawLine(img2, 4, 2, 0, 0, 1);
    const rows = dump(img2);
    expect(rows[0][0]).toBe("1");
    expect(rows[2][4]).toBe("1");
    for (let x = 0; x < 5; x++) expect(rows.filter((r) => r[x] === "1").length).toBe(1);
  });

  it("整数倍で貼り付ける（色番号の透明と左右反転）", () => {
    const src = createIndexed(2, 1);
    src.data.set([3, 0]);
    const dst = createIndexed(5, 2, 9);
    blit(dst, src, 1, 0, { scale: 2, transparent: 0 });
    expect(dump(dst)).toEqual(["93399", "93399"]);
    const dst2 = createIndexed(2, 1);
    blit(dst2, src, 0, 0, { flipX: true });
    expect(dump(dst2)).toEqual(["03"]);
    expect(() => blit(dst, src, 0, 0, { scale: 1.5 })).toThrow();
  });

  it("白黒画像を色番号画像に貼ると黒だけが ink の色になる", () => {
    const src = createBit(3, 1);
    setPixel(src, 1, 0, 1);
    const dst = createIndexed(3, 1, 5);
    blit(dst, src, 0, 0, { ink: 2 });
    expect(dump(dst)).toEqual(["525"]);
  });

  it("多角形の塗りつぶしは中心が内側のドットだけを塗る", () => {
    const img = createIndexed(6, 4);
    fillPolygons(img, [[1, 1, 5, 1, 5, 3, 1, 3]], 1);
    expect(dump(img)).toEqual(["000000", "011110", "011110", "000000"]);
    // 逆回りの穴は塗らない
    const img2 = createIndexed(5, 5);
    fillPolygons(img2, [[0, 0, 5, 0, 5, 5, 0, 5], [2, 2, 2, 3, 3, 3, 3, 2]], 1);
    expect(dump(img2)[2]).toBe("11011");
  });

  it("RGBA への変換（倍率つき）", () => {
    const img = createIndexed(1, 1, 1);
    const rgba = indexedToRgba(img, [[0, 0, 0, 0], [10, 20, 30, 255]], 2);
    expect([...rgba]).toEqual([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]);
    const bit = createBit(2, 1);
    setPixel(bit, 0, 0, 1);
    expect([...bitToRgba(bit)]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("PNG に書き出して読み戻せる", () => {
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const png = encodePng(2, 1, rgba, (d) => zlib.deflateSync(d));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(16)).toBe(2);
    expect(dv.getUint32(20)).toBe(1);
    const idatLen = dv.getUint32(33);
    const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen));
    expect([...raw]).toEqual([0, ...rgba]);
  });
});
