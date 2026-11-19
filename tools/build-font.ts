// DotGothic16 の TTF から、点データのフォント（public/fonts/dotgothic16.bin）と woff2 を作る。
//   pnpm font:build   （先に pnpm data:build で public/data/stations.json を作っておく）
//
// 文字の範囲: ASCII、JIS X 0208 の全文字（非漢字・第1水準・第2水準）、駅名と路線名に出てくる文字。
// フォントに入っていない文字は対象外（tools/out/font-coverage.txt に一覧を出す）。
//
// 点への変換: このフォントの輪郭はドットの形をしているので、16px の格子の各ドットの中心が
// 輪郭の内側かどうかで判定する。格子の位置が文字によって半ドットずれているので、
// 文字ごとに候補のずれ（横・縦それぞれ 0 か半ドット）を試し、1ドットを 4 点で調べて
// 結果が食い違わないものを選ぶ。どの候補でも食い違う文字は一覧に出す。
import fs from "node:fs";
import path from "node:path";
import opentype, { type Font, type Glyph, type PathCommand } from "opentype.js";
import { compress } from "wawoff2";
import { ROOT } from "./lib/paths.ts";
import { encodeBitmapFont, type GlyphInput } from "../shared/font/bitmap-font.ts";
import type { StationsFile } from "../shared/geo/map-data.ts";

const TTF = path.join(ROOT, "assets-src/fonts/DotGothic16-Regular.ttf");
const OFL = path.join(ROOT, "assets-src/fonts/OFL.txt");
const OUT_DIR = path.join(ROOT, "public/fonts");
const OUT_BIN = path.join(OUT_DIR, "dotgothic16.bin");
const OUT_WOFF2 = path.join(OUT_DIR, "DotGothic16-Regular.woff2");
const OUT_REPORT = path.join(ROOT, "tools/out/font-coverage.txt");
const STATIONS = path.join(ROOT, "public/data/stations.json");

const SIZE = 16;
/** 文字の格子の上端（フォントの単位）。輪郭の横線がこの位置から 1000/16 ごとに並んでいる */
const GRID_TOP = 911;

type Poly = [number, number][];

/** 輪郭を折れ線の多角形にする（曲線は細かく分けて近似） */
function toPolys(cmds: PathCommand[]): Poly[] {
  const out: Poly[] = [];
  let cur: Poly | null = null;
  let px = 0;
  let py = 0;
  for (const c of cmds) {
    if (c.type === "M") {
      cur = [[c.x, c.y]];
      out.push(cur);
      px = c.x;
      py = c.y;
    } else if (c.type === "L") {
      cur!.push([c.x, c.y]);
      px = c.x;
      py = c.y;
    } else if (c.type === "Q") {
      for (let t = 1; t <= 8; t++) {
        const s = t / 8;
        const u = 1 - s;
        cur!.push([u * u * px + 2 * u * s * c.x1 + s * s * c.x, u * u * py + 2 * u * s * c.y1 + s * s * c.y]);
      }
      px = c.x;
      py = c.y;
    } else if (c.type === "C") {
      for (let t = 1; t <= 12; t++) {
        const s = t / 12;
        const u = 1 - s;
        cur!.push([
          u * u * u * px + 3 * u * u * s * c.x1 + 3 * u * s * s * c.x2 + s * s * s * c.x,
          u * u * u * py + 3 * u * u * s * c.y1 + 3 * u * s * s * c.y2 + s * s * s * c.y,
        ]);
      }
      px = c.x;
      py = c.y;
    }
  }
  return out.filter((p) => p.length >= 3);
}

/** nonzero の規則で内側か */
function inside(polys: Poly[], x: number, y: number): boolean {
  let w = 0;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [x1, y1] = p[j];
      const [x2, y2] = p[i];
      if (y1 <= y) {
        if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) w++;
      } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) w--;
    }
  }
  return w !== 0;
}

type Raster = { rows: Uint8Array; advance: number; mismatches: number; overflow: number; offset: string };

function rasterize(glyph: Glyph, unitsPerEm: number): Raster {
  const px = unitsPerEm / SIZE;
  const advance = Math.round(glyph.advanceWidth / px);
  const polys = toPolys(glyph.path.commands);
  const q = px / 4; // 4 点で調べるときの中心からのずれ
  let best: Raster | null = null;
  for (const [ox, oy] of [
    [0, 0],
    [px / 2, 0],
    [0, -px / 2],
    [px / 2, -px / 2],
  ]) {
    const rows = new Uint8Array(SIZE * 2);
    let mismatches = 0;
    let overflow = 0;
    if (polys.length) {
      // 格子の外（1ドット外側まで）も調べて、はみ出しを数える
      for (let r = -1; r <= SIZE; r++) {
        for (let c = -1; c <= Math.max(advance, 1); c++) {
          const cx = ox + px * c;
          const cy = GRID_TOP - px / 2 + oy - px * r;
          const hits =
            Number(inside(polys, cx - q, cy - q)) +
            Number(inside(polys, cx + q, cy - q)) +
            Number(inside(polys, cx - q, cy + q)) +
            Number(inside(polys, cx + q, cy + q));
          if (hits !== 0 && hits !== 4) mismatches++;
          const on = inside(polys, cx, cy);
          if (!on) continue;
          if (r < 0 || r >= SIZE || c < 0 || c >= advance || c >= 16) {
            overflow++;
            continue;
          }
          rows[r * 2 + (c >> 3)] |= 0x80 >> (c & 7);
        }
      }
    }
    const cand = { rows, advance, mismatches, overflow, offset: `${ox},${oy}` };
    if (!best || cand.mismatches + cand.overflow * 4 < best.mismatches + best.overflow * 4) best = cand;
    if (cand.mismatches === 0 && cand.overflow === 0) break;
  }
  return best!;
}

/** JIS X 0208 の文字（1〜8区の非漢字、16〜47区の第1水準、48〜84区の第2水準） */
function jisX0208Chars(): string[] {
  const dec = new TextDecoder("euc-jp", { fatal: true });
  const out: string[] = [];
  for (let row = 1; row <= 84; row++) {
    if (row >= 9 && row <= 15) continue;
    for (let cell = 1; cell <= 94; cell++) {
      try {
        const s = dec.decode(new Uint8Array([0xa0 + row, 0xa0 + cell]));
        if (s.length === 1 && s !== "�") out.push(s);
      } catch {
        // 未定義の位置
      }
    }
  }
  // 変換表によって別の文字になるものは両方入れる（～と〜、－と− など）
  out.push("〜", "～", "−", "－", "‖", "∥", "¢", "￠", "£", "￡", "¬", "￢", "—", "―");
  return out;
}

async function main(): Promise<void> {
  const ttf = fs.readFileSync(TTF);
  const font: Font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer);
  if (font.unitsPerEm !== 1000) throw new Error(`想定外の unitsPerEm: ${font.unitsPerEm}`);

  if (!fs.existsSync(STATIONS)) throw new Error("public/data/stations.json がありません。先に pnpm data:build を実行してください");
  const st = JSON.parse(fs.readFileSync(STATIONS, "utf8")) as StationsFile;
  const stationChars = new Set<string>();
  for (const s of st.stations) for (const ch of s.name) stationChars.add(ch);
  const lineChars = new Set<string>();
  for (const l of st.lines) for (const ch of l.name + l.operator) lineChars.add(ch);

  const ascii: string[] = [];
  for (let c = 0x20; c <= 0x7e; c++) ascii.push(String.fromCharCode(c));
  const jis = jisX0208Chars();
  const wanted = new Set<string>([...ascii, ...jis, ...stationChars, ...lineChars]);

  const glyphs: GlyphInput[] = [];
  const missing: string[] = [];
  const mismatched: string[] = [];
  const overflowed: string[] = [];
  const oddAdvance: string[] = [];
  const offsets = new Map<string, number>();
  const shiftedY: string[] = [];
  for (const ch of [...wanted].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!)) {
    const cp = ch.codePointAt(0)!;
    const gi = font.charToGlyphIndex(ch);
    if (!gi) {
      missing.push(ch);
      continue;
    }
    const g = font.glyphs.get(gi);
    const r = rasterize(g, font.unitsPerEm);
    let advance = r.advance;
    if (advance !== 8 && advance !== 16) {
      oddAdvance.push(`${ch} U+${cp.toString(16).toUpperCase()}（${g.advanceWidth} → ${advance}）`);
      advance = advance < 12 ? 8 : 16;
    }
    offsets.set(r.offset, (offsets.get(r.offset) ?? 0) + 1);
    if (!r.offset.endsWith(",0")) shiftedY.push(ch);
    if (r.mismatches) mismatched.push(`${ch} U+${cp.toString(16).toUpperCase()}（${r.mismatches} ドット）`);
    if (r.overflow) overflowed.push(`${ch} U+${cp.toString(16).toUpperCase()}（${r.overflow} ドット）`);
    glyphs.push({ codepoint: cp, advance, rows: r.rows });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bin = encodeBitmapFont(glyphs);
  fs.writeFileSync(OUT_BIN, bin);
  fs.copyFileSync(OFL, path.join(OUT_DIR, "OFL.txt"));
  const woff2 = await compress(new Uint8Array(ttf));
  fs.writeFileSync(OUT_WOFF2, woff2);

  const missingStation = [...stationChars].filter((c) => missing.includes(c));
  const missingLine = [...lineChars].filter((c) => missing.includes(c) && !stationChars.has(c));
  const jisSet = new Set(jis);
  const missingJis = missing.filter((c) => jisSet.has(c));
  const hex = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  const lines = [
    `点データのフォントの生成 ${new Date().toISOString()}`,
    `元: assets-src/fonts/DotGothic16-Regular.ttf（SIL OFL 1.1）`,
    `出力: public/fonts/dotgothic16.bin（${glyphs.length} 文字、${(bin.length / 1024).toFixed(1)} KB）、DotGothic16-Regular.woff2（${(woff2.length / 1024).toFixed(1)} KB）`,
    "",
    `対象の文字: ${wanted.size}（ASCII ${ascii.length}、JIS X 0208 とその別表記 ${jis.length}、駅名 ${stationChars.size} 種、路線名・会社名 ${lineChars.size} 種。重複を含む）`,
    `フォントに無かった文字: ${missing.length}`,
    "",
    `== 駅名に出てくる文字のうちフォントに無いもの: ${missingStation.length} ==`,
    ...missingStation.map((c) => `${c} ${hex(c)}  例: ${st.stations.filter((s) => s.name.includes(c)).map((s) => s.name).slice(0, 5).join("、")}`),
    "",
    `== 路線名・会社名だけに出てくる文字のうちフォントに無いもの: ${missingLine.length} ==`,
    ...missingLine.map((c) => `${c} ${hex(c)}`),
    "",
    `== JIS X 0208（とその別表記）のうちフォントに無いもの: ${missingJis.length} ==`,
    missingJis.map((c) => `${c}(${hex(c)})`).join(" "),
    "",
    `== 1ドットを 4 点で調べて結果が食い違った文字: ${mismatched.length} ==`,
    ...mismatched,
    "",
    `== 16×16（半角は 8×16）の格子からはみ出した点がある文字: ${overflowed.length} ==`,
    ...overflowed,
    "",
    `== 送り幅が 8 でも 16 でもない文字（近い方に丸めた）: ${oddAdvance.length} ==`,
    ...oddAdvance,
    "",
    `格子のずれの内訳（横,縦 フォントの単位）: ${[...offsets].map(([k, v]) => `${k}=${v}`).join("、")}`,
    `縦に半ドットずらして判定した文字（${shiftedY.length}）: ${shiftedY.join(" ")}`,
  ];
  fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
  fs.writeFileSync(OUT_REPORT, lines.join("\n") + "\n");
  console.log(lines.slice(0, 9).join("\n"));
  console.log(`食い違い ${mismatched.length} 文字、はみ出し ${overflowed.length} 文字。詳細は tools/out/font-coverage.txt`);
}

await main();
