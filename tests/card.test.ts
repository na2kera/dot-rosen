import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CARD_MAX_HEIGHT,
  CARD_PAPER,
  CARD_WIDTH,
  cardRaster,
  formatIssueNo,
  layoutCard,
  qrMatrix,
  renderCardColor,
  renderCardPrint,
  type CardInput,
} from "../shared/card/index.ts";
import { paintColor, paintPrint } from "../shared/card/render.ts";
import { textWidth } from "../shared/card/text.ts";
import { hasGlyph } from "../shared/font/index.ts";
import { crc32, getPixel, type BitImage } from "../shared/pix/index.ts";
import { parseRouteData, type StationLookup } from "../shared/route/index.ts";
import { defaultDesign, maxInkRatio } from "../shared/train/index.ts";
import { cardFixtures, FixtureKit, LONG30, loadFont, loadStations, YAMANOTE, type CardFixture } from "../tools/lib/card-fixtures.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
let kit: FixtureKit;
let fixtures: CardFixture[];
const fx = (id: string): CardInput => fixtures.find((f) => f.id === id)!.input;

beforeAll(() => {
  kit = new FixtureKit(loadFont(ROOT), loadStations(ROOT));
  fixtures = cardFixtures(kit);
});

const inkAt = (img: BitImage, x: number, y: number) => getPixel(img, x, y) === 1;

describe("路線カード", () => {
  it("幅は常に 384、印刷用は 1行 48 バイトの2値、カラー版は透明な点が無い", () => {
    for (const f of fixtures) {
      const bit = renderCardPrint(f.input);
      expect(bit.width, f.id).toBe(CARD_WIDTH);
      expect(bit.stride, f.id).toBe(48);
      expect(bit.kind).toBe("bit");
      const raw = cardRaster(bit);
      expect(raw.length, f.id).toBe(48 * bit.height);
      expect(raw).toEqual(bit.data);
      const { image, palette } = renderCardColor(f.input);
      expect(image.width, f.id).toBe(CARD_WIDTH);
      expect(image.height, f.id).toBe(bit.height);
      const used = new Set(image.data);
      for (const c of used) expect(palette[c][3], `${f.id} 色 ${c}`).toBe(255);
    }
  });

  it("同じ入力なら同じ出力", () => {
    for (const id of ["long-30st-16car", "loop-30st", "side-two-x2-rotated-light"]) {
      expect(renderCardPrint(fx(id)).data).toEqual(renderCardPrint(fx(id)).data);
      expect(renderCardColor(fx(id)).image.data).toEqual(renderCardColor(fx(id)).image.data);
    }
  });

  it("上 16、下 32 ドットは白。左右 8 ドットに黒が出るのは路線名の行と側面の絵だけ", () => {
    // 1点ずつ expect を呼ぶと遅いので、はみ出した点を集めてから比べる
    const bad: string[] = [];
    const check = (id: string, bit: BitImage, x: number, y: number) => {
      if (inkAt(bit, x, y)) bad.push(`${id} (${x},${y})`);
    };
    for (const f of fixtures) {
      const bit = renderCardPrint(f.input);
      for (let y = 0; y < 16; y++) for (let x = 0; x < CARD_WIDTH; x++) check(f.id, bit, x, y);
      for (let y = bit.height - 32; y < bit.height; y++) for (let x = 0; x < CARD_WIDTH; x++) check(f.id, bit, x, y);
      // 余白を使ってよい行（路線名と、幅 384 の側面の絵）
      const allowed = new Array<boolean>(bit.height).fill(false);
      const ops = layoutCard(f.input).ops;
      const nameOp = ops.find((o) => o.k === "text" && o.y > 16 && o.sy >= 2 && o.s === f.input.route.name);
      const spriteOps = ops.filter((o) => o.k === "sprite");
      const sideOp = spriteOps[spriteOps.length - 1];
      if (nameOp && nameOp.k === "text") for (let y = nameOp.y; y < nameOp.y + 16 * nameOp.sy; y++) allowed[y] = true;
      if (sideOp && sideOp.k === "sprite") for (let y = sideOp.y; y < sideOp.y + sideOp.img.height * sideOp.scale; y++) allowed[y] = true;
      for (let y = 0; y < bit.height; y++) {
        if (allowed[y]) continue;
        for (let x = 0; x < 8; x++) {
          check(f.id, bit, x, y);
          check(f.id, bit, CARD_WIDTH - 1 - x, y);
        }
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("文字の点は印刷用とカラー版で同じ位置に出る", () => {
    for (const id of ["long-30st-16car", "loop-30st", "ascii-name"]) {
      const input = fx(id);
      const layout = layoutCard(input);
      const textOnly = { ...layout, ops: layout.ops.filter((o) => o.k === "text") };
      const bit = paintPrint(textOnly, input.font, "bold");
      const col = paintColor(textOnly, input.font);
      let diff = 0;
      for (let y = 0; y < bit.height; y++)
        for (let x = 0; x < CARD_WIDTH; x++) if (inkAt(bit, x, y) !== (col.data[y * CARD_WIDTH + x] !== CARD_PAPER)) diff++;
      expect(diff, id).toBe(0);
    }
  });

  it("高さ: 2駅と30駅（30駅で約 27cm 前後）", () => {
    const h = (id: string) => renderCardPrint(fx(id)).height;
    const short = h("short-2st-1car");
    const long = h("long-30st-16car");
    const loop = h("loop-30st");
    console.log(`カードの高さ: 2駅 ${short}、30駅 ${long}、環状30駅 ${loop}`);
    expect(short).toBeLessThan(1200);
    expect(long).toBeGreaterThan(1900);
    expect(long).toBeLessThan(2500);
    expect(loop).toBeLessThan(2500);
    const rows: string[] = [];
    for (const side of ["two-x1", "lead-x2", "two-x2-rotated"] as const) {
      const hs = ["short-2st-1car", "long-30st-16car", "loop-30st"].map((id) => renderCardPrint({ ...fx(id), sideLayout: side }).height);
      rows.push(`${side}: 2駅(1両) ${hs[0]} / 30駅(16両) ${hs[1]} / 環状30駅(11両) ${hs[2]}`);
    }
    console.log(rows.join("\n"));
  });

  it("フォントに無い文字だけの路線名でも、黒の割合を記録する（〓は黒い面になる）", () => {
    const route = kit.route({ name: "🚃🚃🚃🚃", symbol: "Q", lineColor: "white", stations: ["新宿", "渋谷"], train: defaultDesign() });
    const bit = renderCardPrint(kit.input(route));
    const r = maxInkRatio(bit, 64);
    console.log(`〓だけの路線名: 64×64 の黒の最大 ${(r.ratio * 100).toFixed(1)}% (${r.x},${r.y})`);
    expect(r.ratio).toBeLessThan(1);
  });

  it("いちばん長くなる組み合わせでも上限 3200 に収まる", () => {
    const longUrl = "https://dot-rosen.example.workers.dev/r/" + "A".repeat(160);
    for (const side of ["two-x1", "lead-x2", "two-x2-rotated"] as const) {
      for (const loop of [false, true]) {
        const route = kit.route({ name: "ＷＷＷＷＷＷＷＷＷＷＷＷ", symbol: "WW", lineColor: "black", stations: loop ? YAMANOTE : LONG30, loop, train: { ...defaultDesign(), cars: 16 } });
        const input = kit.input(route, { sideLayout: side, url: longUrl, expiresOn: "12月20日" });
        const bit = renderCardPrint(input);
        expect(bit.height, `${side} loop=${loop}`).toBeLessThanOrEqual(CARD_MAX_HEIGHT);
      }
    }
  });

  it("極端に長い駅名は「…」で収め、駅が見つからなくても描ける", () => {
    const fake: Record<string, { name: string; lat: number; lon: number }> = {
      a: { name: "あいうえおかきくけこさしすせそたちつてとなにぬねの", lat: 35.6, lon: 139.6 },
      b: { name: "新宿", lat: 35.7, lon: 139.7 },
    };
    const lookup: StationLookup = (id) => fake[id];
    const r = parseRouteData({ v: 1, name: "テスト線", symbol: "T", lineColor: "red", stations: ["a", "b"], loop: false, train: defaultDesign() }, lookup);
    if (!r.ok) throw new Error(r.error);
    const input = { ...kit.input(r.value), lookup };
    // 停車駅案内の駅名（横等倍・縦2倍で描くもの）
    const texts = layoutCard(input).ops.flatMap((o) => (o.k === "text" && o.sx === 1 && o.sy === 2 ? [o.s] : []));
    const name = texts.find((s) => s.startsWith("あいうえお"))!;
    expect(name.endsWith("…")).toBe(true);
    expect(textWidth(input.font, name)).toBeLessThanOrEqual(384 - 8 - 84);
    // 検査を通っていない（見つからない駅を含む）路線でも例外にしない
    const broken = { ...input, lookup: (id: string) => (id === "a" ? undefined : fake[id]) };
    expect(renderCardPrint(broken).width).toBe(CARD_WIDTH);
  });

  it("カードに出す決まった文字はフォントにある", () => {
    const fixed = "駅数総距離直線発行日番号No.-0123456789km（）両編成停車環状から へまで見られますドット路線メーカー…〓";
    for (const ch of fixed) expect(hasGlyph(kit.font, ch.codePointAt(0)!), ch).toBe(true);
    expect(hasGlyph(kit.font, 0x21c4)).toBe(false); // ⇄ はカードで点を持つ
  });

  it("発行番号の表示", () => {
    expect(formatIssueNo(42)).toBe("No.0042");
    expect(formatIssueNo(12345)).toBe("No.12345");
    expect(formatIssueNo(null)).toBe("No.----");
  });

  it("出力のハッシュ値（意図しない変化を検出する。見た目を直したら確認のうえ更新する）", () => {
    const got: Record<string, string> = {};
    for (const id of ["short-2st-1car", "long-30st-16car", "loop-30st", "side-two-x2-rotated-light", "unknown-glyph"]) {
      const bit = renderCardPrint(fx(id));
      const col = renderCardColor(fx(id)).image;
      got[id] = `${bit.height} ${crc32(bit.data).toString(16)} ${crc32(col.data).toString(16)}`;
    }
    expect(got).toEqual(EXPECTED_HASHES);
  });
});

/** 高さ、印刷用の CRC32、カラー版の CRC32（駅データやフォント、電車の絵を作り直したときも変わる） */
const EXPECTED_HASHES: Record<string, string> = {
  "long-30st-16car": "2214 6bbdc24a 3e02596f",
  "loop-30st": "2290 a1272c3d 905e782",
  "short-2st-1car": "998 a505ddfc ce2683d6",
  "side-two-x2-rotated-light": "1966 a66f632c bd3eb6de",
  "unknown-glyph": "1042 df5e6e97 225eb153",
};

// ---- QR コードの読み戻し ----

/** 型番ごとの誤り訂正 M のブロック（[個数, 全体のコード語数, データのコード語数]） */
const RS_M: Record<number, [number, number, number][]> = {
  1: [[1, 26, 16]],
  2: [[1, 44, 28]],
  3: [[1, 70, 44]],
  4: [[2, 50, 32]],
  5: [[2, 67, 43]],
  6: [[4, 43, 27]],
  7: [[4, 49, 31]],
  8: [[2, 60, 38], [2, 61, 39]],
  9: [[3, 58, 36], [2, 59, 37]],
  10: [[4, 69, 43], [1, 70, 44]],
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const MASKS: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/** 形式情報（誤り訂正 M、マスク m）の 15 ビット */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

/** マスの2次元配列から、バイトモードの文字列を読み出す（誤り訂正はしない。読み取りの誤りが無い前提の簡単な復号） */
function decodeQr(m: number[][]): string {
  const n = m.length;
  const version = (n - 17) / 4;
  if (!RS_M[version]) throw new Error(`この型番は試験の対象外です: ${version}`);
  // 形式情報（左上の縦の並び）からマスクを決める
  let fmt = 0;
  for (let i = 0; i < 15; i++) {
    const row = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i;
    if (m[row][8]) fmt |= 1 << i;
  }
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => formatBits(k) === fmt);
  if (mask === undefined) throw new Error("形式情報を読めません");
  // 機能パターンの位置
  const fn = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const mark = (r0: number, c0: number, h: number, w: number) => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < n && c < n) fn[r][c] = true;
  };
  mark(0, 0, 9, 9);
  mark(0, n - 8, 9, 8);
  mark(n - 8, 0, 8, 9);
  mark(6, 0, 1, n);
  mark(0, 6, n, 1);
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) if (!fn[r][c]) mark(r - 2, c - 2, 5, 5);
  if (version >= 7) {
    mark(0, n - 11, 6, 3);
    mark(n - 11, 0, 3, 6);
  }
  // ジグザグに読む
  const bits: number[] = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (const c of [col, col - 1]) if (!fn[r][c]) bits.push(m[r][c] ^ (MASKS[mask](r, c) ? 1 : 0));
    }
    up = !up;
  }
  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // ブロックの並びを戻す（データのコード語だけ）
  const blocks: number[][] = [];
  for (const [count, , dataCount] of RS_M[version]) for (let i = 0; i < count; i++) blocks.push(new Array<number>(dataCount));
  let p = 0;
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) b[i] = words[p++];
  const data = blocks.flat();
  let bp = 0;
  const read = (k: number) => {
    let v = 0;
    for (let i = 0; i < k; i++, bp++) v = (v << 1) | ((data[bp >> 3] >> (7 - (bp & 7))) & 1);
    return v;
  };
  if (read(4) !== 0b0100) throw new Error("バイトモードではありません");
  const len = read(version < 10 ? 8 : 16);
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(read(8));
  return s;
}

describe("QR コード", () => {
  it("印刷用画像からマスを復元して、元の URL が読める", () => {
    for (const url of [kit.input(fx("short-2st-1car").route).url!, "https://example.com/r/" + "Zz9_-".repeat(12)]) {
      const input = { ...fx("long-30st-16car"), url };
      const bit = renderCardPrint(input);
      const op = layoutCard(input).ops.find((o) => o.k === "qr")!;
      const { x, y, cell, m } = op;
      const n = m.size;
      // 各マスの 4×4 ドットがそろっていること
      const grid: number[][] = [];
      for (let r = 0; r < n; r++) {
        const row: number[] = [];
        for (let c = 0; c < n; c++) {
          const v = getPixel(bit, x + c * cell, y + r * cell);
          for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) expect(getPixel(bit, x + c * cell + i, y + r * cell + j)).toBe(v);
          row.push(v);
        }
        grid.push(row);
      }
      // まわり 4 マスぶんが白
      const q = 4 * cell;
      for (let yy = y - q; yy < y + n * cell + q; yy++)
        for (let xx = x - q; xx < x + n * cell + q; xx++) {
          const inside = xx >= x && xx < x + n * cell && yy >= y && yy < y + n * cell;
          if (!inside) expect(getPixel(bit, xx, yy), `(${xx},${yy})`).toBe(0);
        }
      expect(grid.flat()).toEqual([...qrMatrix(url).dark]);
      expect(decodeQr(grid)).toBe(url);
    }
  });
});
