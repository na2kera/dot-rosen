// 「じぶんの」ロゴ（src/store/my-logo.ts）と、描く画面の「できた／やめる」の試験。
import { describe, expect, it } from "vitest";
import { EMPTY_LOGO, logoFromArt, PRESET_LOGOS } from "../shared/train/logos.ts";
import { memoryStorage, STORAGE_KEYS } from "../src/store/kv-storage.ts";
import { adoptMyLogo, beginDraw, cancelDraw, drawStartBits, finishDraw, logoSelection, readMyLogo, saveMyLogo } from "../src/store/my-logo.ts";

const mine = logoFromArt(["#...............", ".#..............", "..#.............", ...Array(13).fill("................")]);
const other = logoFromArt(["##..............", ...Array(15).fill("................")]);
const preset = PRESET_LOGOS[3].bits;

describe("じぶんのロゴを端末に覚える", () => {
  it("覚えて読み戻せる。キーは STORAGE_KEYS.myLogo", () => {
    const s = memoryStorage();
    expect(readMyLogo(s)).toBeNull();
    expect(saveMyLogo(s, mine)).toBe(mine);
    expect(s.dump()[STORAGE_KEYS.myLogo]).toBe(mine);
    expect(readMyLogo(s)).toBe(mine);
  });

  it("壊れた値・既製と同じ絵・空のロゴは、じぶんのとして扱わない", () => {
    expect(readMyLogo(memoryStorage({ [STORAGE_KEYS.myLogo]: "xyz" }))).toBeNull();
    expect(readMyLogo(memoryStorage({ [STORAGE_KEYS.myLogo]: preset }))).toBeNull();
    expect(readMyLogo(memoryStorage({ [STORAGE_KEYS.myLogo]: EMPTY_LOGO }))).toBeNull();
    const s = memoryStorage({ [STORAGE_KEYS.myLogo]: mine });
    // 既製や空を保存しようとしても、前のじぶんのが残る
    expect(saveMyLogo(s, preset)).toBe(mine);
    expect(saveMyLogo(s, EMPTY_LOGO)).toBe(mine);
    expect(readMyLogo(s)).toBe(mine);
  });

  it("保存先が書けなくても止まらない（開いている間の値は返す）", () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(saveMyLogo(broken, mine)).toBe(mine);
  });
});

describe("起動時の引き継ぎ", () => {
  it("じぶんのが未登録で、いまのロゴが既製と違う絵なら、それをじぶんのにする", () => {
    const s = memoryStorage();
    expect(adoptMyLogo(s, mine)).toBe(mine);
    expect(readMyLogo(s)).toBe(mine);
  });

  it("いまのロゴが既製・空なら何もしない", () => {
    const s = memoryStorage();
    expect(adoptMyLogo(s, preset)).toBeNull();
    expect(adoptMyLogo(s, EMPTY_LOGO)).toBeNull();
    expect(readMyLogo(s)).toBeNull();
  });

  it("じぶんのが登録ずみなら、上書きしない", () => {
    const s = memoryStorage({ [STORAGE_KEYS.myLogo]: mine });
    expect(adoptMyLogo(s, other)).toBe(mine);
    expect(readMyLogo(s)).toBe(mine);
  });
});

describe("選択中の判定", () => {
  it("既製と同じ絵ならその既製、じぶんのと同じ絵なら mine、どちらでもなければ null", () => {
    expect(logoSelection(preset, mine)).toBe(PRESET_LOGOS[3].id);
    expect(logoSelection(mine, mine)).toBe("mine");
    expect(logoSelection(other, mine)).toBeNull();
    expect(logoSelection(mine, null)).toBeNull();
  });
});

describe("描く画面", () => {
  it("じぶんのがあればその続きから、なければいまのロゴを下絵にして始める", () => {
    expect(drawStartBits(mine, preset)).toBe(mine);
    expect(drawStartBits(null, preset)).toBe(preset);
  });

  it("できた: 描いた絵を電車のロゴにし、じぶんのに覚える", () => {
    const s = memoryStorage();
    const r = finishDraw(s, other);
    expect(r).toEqual({ bits: other, mine: other });
    expect(readMyLogo(s)).toBe(other);
  });

  it("できた: 既製と同じ絵なら、じぶんのは作らない（前のじぶんのは残す）", () => {
    const s = memoryStorage({ [STORAGE_KEYS.myLogo]: mine });
    expect(finishDraw(s, preset)).toEqual({ bits: preset, mine });
    expect(readMyLogo(s)).toBe(mine);
  });

  it("やめる: 開く前のロゴに戻す（じぶんのは変えない）", () => {
    const s = memoryStorage({ [STORAGE_KEYS.myLogo]: mine });
    expect(cancelDraw({ opened: preset, start: mine })).toBe(preset);
    expect(readMyLogo(s)).toBe(mine);
  });
});

describe("描く画面を開いた時点のロゴ", () => {
  it("開いたあとに電車のロゴが変わっても、やめるは開いた時点のロゴに戻す", () => {
    const s = beginDraw(mine, preset);
    expect(s).toEqual({ opened: preset, start: mine });
    // 開いている間に別の値が来ても（再描画）、開いた時点のまま
    expect(cancelDraw(s)).toBe(preset);
    expect(beginDraw(null, other)).toEqual({ opened: other, start: other });
  });
});
