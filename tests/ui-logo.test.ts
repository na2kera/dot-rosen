// ロゴを描く操作（src/store/logo-ops.ts）の試験。
import { describe, expect, it } from "vitest";
import { EMPTY_LOGO, logoFromArt, PRESET_LOGOS } from "../shared/train/logos.ts";
import { floodFill, HISTORY_LIMIT, isEmpty, plot, popHistory, pushHistory, stroke, toBits, toPixels } from "../src/store/logo-ops.ts";

const art = (px: Uint8Array) => Array.from({ length: 16 }, (_, y) => Array.from(px.subarray(y * 16, y * 16 + 16), (v) => (v ? "#" : ".")).join(""));

describe("ペンと消しゴム", () => {
  it("点を打つ・消す。変わらなければ同じ配列を返す", () => {
    const a = toPixels(EMPTY_LOGO);
    const b = plot(a, 3, 4, 1);
    expect(b).not.toBe(a);
    expect(b[4 * 16 + 3]).toBe(1);
    expect(a[4 * 16 + 3]).toBe(0);
    expect(plot(b, 3, 4, 1)).toBe(b);
    expect(plot(b, 3, 4, 0)[4 * 16 + 3]).toBe(0);
    expect(plot(b, 16, 0, 1)).toBe(b);
  });

  it("速くなぞっても、間の点が飛ばない", () => {
    const px = stroke(toPixels(EMPTY_LOGO), 0, 0, 15, 15, 1);
    for (let i = 0; i < 16; i++) expect(px[i * 16 + i]).toBe(1);
    const h = stroke(toPixels(EMPTY_LOGO), 2, 7, 13, 7, 1);
    expect(art(h)[7]).toBe("..############..");
    const steep = stroke(toPixels(EMPTY_LOGO), 1, 0, 3, 15, 1);
    for (let y = 0; y < 16; y++) expect(art(steep)[y]).toContain("#");
  });
});

describe("塗りつぶし", () => {
  const ring = logoFromArt([
    "................",
    "..##########....",
    "..#........#....",
    "..#........#....",
    "..#........#....",
    "..##########....",
    ...Array(10).fill("................"),
  ]);

  it("囲まれた内側だけを塗る（上下左右のつながり）", () => {
    const px = floodFill(toPixels(ring), 5, 3, 1);
    expect(art(px).slice(1, 6)).toEqual(["..##########....", "..##########....", "..##########....", "..##########....", "..##########...."]);
    expect(art(px)[0]).toBe("................");
  });

  it("外側を塗ると、囲みの内側は残る", () => {
    const px = floodFill(toPixels(ring), 0, 0, 1);
    expect(art(px)[3]).toBe("###........#####");
  });

  it("描く色の所を描く色で塗っても変わらない。地で塗ると消える", () => {
    const a = toPixels(ring);
    expect(floodFill(a, 2, 1, 1)).toBe(a);
    const cleared = floodFill(a, 2, 1, 0);
    expect(isEmpty(cleared)).toBe(true);
  });

  it("ななめにはつながらない", () => {
    const px = toPixels(logoFromArt(["#...............", ".#..............", ...Array(14).fill("................")]));
    const filled = floodFill(px, 0, 0, 0);
    expect(filled[1 * 16 + 1]).toBe(1);
  });
});

describe("1つ戻す", () => {
  it("覚えた順に戻す。同じものは続けて覚えない。上限を超えたら古いものから捨てる", () => {
    let h = pushHistory([], "a");
    h = pushHistory(h, "a");
    h = pushHistory(h, "b");
    expect(h).toEqual(["a", "b"]);
    const r = popHistory(h)!;
    expect(r.bits).toBe("b");
    expect(popHistory(r.history)!.bits).toBe("a");
    expect(popHistory([])).toBeNull();
    let big: readonly string[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) big = pushHistory(big, String(i));
    expect(big.length).toBe(HISTORY_LIMIT);
    expect(big[0]).toBe("5");
  });

  it("点のデータと配列を行き来できる", () => {
    for (const p of PRESET_LOGOS) expect(toBits(toPixels(p.bits))).toBe(p.bits);
  });
});
