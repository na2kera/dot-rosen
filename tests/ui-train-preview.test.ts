// 「電車をつくる」のプレビューの計算（src/steps/train/preview-math.ts）の試験。
import { describe, expect, it } from "vitest";
import { bigFaceDevice, isTap } from "../src/steps/train/preview-math.ts";

describe("大きく見る画面の顔の倍率（端末の画素での倍率）", () => {
  const FACE_H = 76;
  it("偶数で、CSS で 4 倍まで。画素比が整数でない端末でも偶数の整数", () => {
    for (const dpr of [1, 2, 2.625, 3]) {
      const k = bigFaceDevice(dpr, 10000, FACE_H);
      expect(Number.isInteger(k)).toBe(true);
      expect(k % 2).toBe(0);
      expect(k / dpr).toBeLessThanOrEqual(4);
    }
    expect(bigFaceDevice(1, 10000, FACE_H)).toBe(4);
    expect(bigFaceDevice(2, 10000, FACE_H)).toBe(8);
    expect(bigFaceDevice(2.625, 10000, FACE_H)).toBe(10);
    expect(bigFaceDevice(3, 10000, FACE_H)).toBe(12);
  });

  it("使える高さに収まる最大の偶数（最小は 2）", () => {
    // 高さ 239px・画素比 2 → CSS 3 倍（端末 6 倍）= 228px
    expect(bigFaceDevice(2, 239, FACE_H)).toBe(6);
    expect((bigFaceDevice(2.625, 239, FACE_H) * FACE_H) / 2.625).toBeLessThanOrEqual(239);
    expect(bigFaceDevice(3, 10, FACE_H)).toBe(2);
  });
});

describe("プレビューのタップの判定", () => {
  it("動かさずに 1 本の指で押して離したときだけタップ", () => {
    expect(isTap({ moved: 0, maxPointers: 1, scrolled: false, canceled: false })).toBe(true);
    expect(isTap({ moved: 7, maxPointers: 1, scrolled: false, canceled: false })).toBe(true);
  });
  it("8px 以上動いた・2 本の指・スクロールが起きた・取り消されたときは開かない", () => {
    expect(isTap({ moved: 8, maxPointers: 1, scrolled: false, canceled: false })).toBe(false);
    expect(isTap({ moved: 0, maxPointers: 2, scrolled: false, canceled: false })).toBe(false);
    expect(isTap({ moved: 0, maxPointers: 1, scrolled: true, canceled: false })).toBe(false);
    expect(isTap({ moved: 0, maxPointers: 1, scrolled: false, canceled: true })).toBe(false);
  });
});
