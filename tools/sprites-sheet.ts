// 電車のパーツの確認用一覧を tools/out/sprites/ に書き出す。
//   pnpm sprites:sheet
// 決められた一覧（parts-face / parts-side / random-* / v2-compare / logos / print-test-*）のほかに、
// 目で確かめるための拡大ページを tools/out/sprites/review/ に出す。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { BitImage, IndexedImage, Rgba } from "../shared/pix/index.ts";
import { createBit, createIndexed, getPixel, setPixel } from "../shared/pix/index.ts";
import {
  CAR_W,
  COLOR_IDS,
  COLOR_LABELS,
  createRng,
  defaultDesign,
  FACE_CHOICES,
  FACE_KEYS,
  FACE_PART_LABELS,
  maxInkRatio,
  PATTERN_SETS,
  PRESET_LOGOS,
  randomDesign,
  renderCar,
  renderConsist,
  renderFace,
  SIDE_CHOICES,
  SIDE_KEYS,
  SIDE_PART_LABELS,
  toMono,
  tones,
  TRAIN_PALETTE,
  type PatternSet,
  type TrainDesign,
} from "../shared/train/index.ts";
import { ROOT } from "./lib/paths.ts";
import { saveBit, Sheet } from "./lib/sheet.ts";

const OUT = path.join(ROOT, "tools/out/sprites");
const REVIEW = path.join(OUT, "review");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(REVIEW, { recursive: true });

const INK: Rgba = [32, 41, 49, 255];
const GRAY: Rgba = [96, 109, 119, 255];
const PAPER: Rgba = [243, 234, 215, 255];
const P = TRAIN_PALETTE;

type Cell = { w: number; h: number; draw: (s: Sheet, x: number, y: number) => void };

/** セルを横 cols 個ずつ並べた台紙を作る */
function grid(cells: Cell[], cols: number, gap = 12, margin = 16, title?: string): Sheet {
  const cw = Math.max(...cells.map((c) => c.w));
  const ch = Math.max(...cells.map((c) => c.h));
  const rows = Math.ceil(cells.length / cols);
  const top = title ? 28 : 0;
  const s = new Sheet(margin * 2 + cols * cw + (cols - 1) * gap, margin * 2 + top + rows * ch + (rows - 1) * gap, PAPER);
  if (title) s.text(title, margin, margin, INK);
  cells.forEach((c, i) => c.draw(s, margin + (i % cols) * (cw + gap), margin + top + Math.floor(i / cols) * (ch + gap)));
  return s;
}

/** 縦に台紙をつなぐ */
function stack(sheets: Sheet[], gap = 8): Sheet {
  const w = Math.max(...sheets.map((s) => s.width));
  const h = sheets.reduce((a, s) => a + s.height, 0) + gap * (sheets.length - 1);
  const out = new Sheet(w, h, PAPER);
  let y = 0;
  for (const s of sheets) {
    for (let j = 0; j < s.height; j++) out.rgba.set(s.rgba.subarray(j * s.width * 4, (j + 1) * s.width * 4), ((y + j) * w) * 4);
    y += s.height + gap;
  }
  return out;
}

const labelled = (label: string, img: IndexedImage, scale: number, sub?: string): Cell => ({
  w: Math.max(img.width * scale, 0),
  h: img.height * scale + (sub ? 40 : 20),
  draw: (s, x, y) => {
    s.text(label, x, y, INK);
    if (sub) s.text(sub, x, y + 18, GRAY);
    s.indexed(img, P, x, y + (sub ? 40 : 20), scale);
  },
});

type Patch = { face?: Partial<TrainDesign["face"]>; side?: Partial<TrainDesign["side"]>; cars?: number };
const with_ = (d: TrainDesign, patch: Patch): TrainDesign => ({
  ...d,
  ...patch,
  face: { ...d.face, ...(patch.face ?? {}) },
  side: { ...d.side, ...(patch.side ?? {}) },
});

const short = (d: TrainDesign) =>
  `${d.face.contour}/${d.face.window}/${d.face.door}/${d.face.lightShape}/${d.face.lightPos}/${d.face.sign}/${d.face.skirt}/${d.face.paint}`;
const shortSide = (d: TrainDesign) => `${d.side.nose}/${d.side.window}/${d.side.doors}/${d.side.roof}/${d.side.band} ${d.bodyColor}+${d.bandColor}`;

const base = defaultDesign();

// ---- 1. parts-face.png ----
{
  const blocks: Sheet[] = [];
  for (const contour of FACE_CHOICES.contour) {
    const cells: Cell[] = [];
    const b = with_(base, { face: { contour: contour.id } });
    cells.push(labelled("既定", renderFace(b), 2));
    for (const k of FACE_KEYS) {
      if (k === "contour") continue;
      for (const c of FACE_CHOICES[k]) {
        if (c.id === b.face[k]) continue;
        cells.push(labelled(`${FACE_PART_LABELS[k]}`, renderFace(with_(b, { face: { [k]: c.id } as Partial<TrainDesign["face"]> })), 2, c.label));
      }
    }
    blocks.push(grid(cells, 10, 12, 16, `輪郭: ${contour.label}（ほかは既定。1つずつ変えたもの）`));
  }
  stack(blocks).save(path.join(OUT, "parts-face.png"));
  // 拡大ページ（3倍）
  for (const contour of FACE_CHOICES.contour) {
    const cells: Cell[] = [];
    const b = with_(base, { face: { contour: contour.id } });
    cells.push(labelled("既定", renderFace(b), 3));
    for (const k of FACE_KEYS) {
      if (k === "contour") continue;
      for (const c of FACE_CHOICES[k]) {
        if (c.id === b.face[k]) continue;
        cells.push(labelled(FACE_PART_LABELS[k], renderFace(with_(b, { face: { [k]: c.id } as Partial<TrainDesign["face"]> })), 3, c.label));
      }
    }
    grid(cells, 7, 12, 8).save(path.join(REVIEW, `parts-face-${contour.id}.png`));
  }
  // 2部位の衝突を見るための交差の一覧（3倍）
  const cross = (name: string, list: TrainDesign[], label: (d: TrainDesign) => [string, string]) => {
    for (let p = 0; p * 21 < list.length; p++) {
      const cells = list.slice(p * 21, p * 21 + 21).map((d) => labelled(...label(d).slice(0, 1) as [string], renderFace(d), 3, label(d)[1]));
      grid(cells, 7, 12, 8).save(path.join(REVIEW, `${name}-${String(p + 1).padStart(2, "0")}.png`));
    }
  };
  const lightList: TrainDesign[] = [];
  for (const contour of FACE_CHOICES.contour) for (const door of FACE_CHOICES.door) for (const pos of FACE_CHOICES.lightPos) for (const shape of FACE_CHOICES.lightShape)
    lightList.push(with_(base, { face: { contour: contour.id, door: door.id, lightPos: pos.id, lightShape: shape.id } }));
  cross("cross-light", lightList, (d) => [`${d.face.contour}/${d.face.door}`, `${d.face.lightPos}/${d.face.lightShape}`]);
  const winList: TrainDesign[] = [];
  for (const w of FACE_CHOICES.window) for (const door of FACE_CHOICES.door) for (const sign of FACE_CHOICES.sign)
    winList.push(with_(base, { face: { window: w.id, door: door.id, sign: sign.id } }));
  cross("cross-window", winList, (d) => [`${d.face.window}/${d.face.door}`, `表示 ${d.face.sign}`]);
}

// ---- 2. parts-side.png（先頭車。鼻先ごと） ----
{
  const blocks: Sheet[] = [];
  for (const nose of SIDE_CHOICES.nose) {
    const cells: Cell[] = [];
    const b = with_(base, { side: { nose: nose.id }, cars: 1 });
    cells.push(labelled("既定", renderCar(b, "lead"), 2));
    for (const k of SIDE_KEYS) {
      if (k === "nose") continue;
      for (const c of SIDE_CHOICES[k]) {
        if (c.id === b.side[k]) continue;
        cells.push(labelled(`${SIDE_PART_LABELS[k]}: ${c.label}`, renderCar(with_(b, { side: { [k]: c.id } as Partial<TrainDesign["side"]> }), "lead"), 2));
      }
    }
    const g = grid(cells, 3, 12, 16, `鼻先: ${nose.label}（先頭車。ほかは既定、1つずつ変えたもの。1両編成なのでパンタグラフ付き）`);
    blocks.push(g);
    g.save(path.join(REVIEW, `parts-side-${nose.id}.png`));
  }
  stack(blocks).save(path.join(OUT, "parts-side.png"));
  for (const nose of SIDE_CHOICES.nose) {
    const cells: Cell[] = [];
    for (const doors of SIDE_CHOICES.doors) for (const w of SIDE_CHOICES.window) {
      const d = with_(base, { side: { nose: nose.id, doors: doors.id, window: w.id }, cars: 8 });
      cells.push(labelled(`${nose.id}/${doors.id}/${w.id}`, renderCar(d, "lead"), 2));
    }
    grid(cells, 3, 12, 8).save(path.join(REVIEW, `cross-side-${nose.id}.png`));
  }
  {
    const cells: Cell[] = [];
    for (const band of SIDE_CHOICES.band) for (const doors of SIDE_CHOICES.doors) {
      const d = with_(base, { side: { band: band.id, doors: doors.id }, cars: 8 });
      cells.push(labelled(`中間車 ${band.id}/${doors.id}`, renderCar(d, "middle"), 2));
    }
    grid(cells, 3, 12, 8).save(path.join(REVIEW, "cross-side-middle.png"));
  }
}

// ---- 3〜4. ランダム 60 デザイン ----
const rng = createRng(20261120);
const randoms: TrainDesign[] = Array.from({ length: 60 }, () => randomDesign(rng, { ...base, cars: 2 }));
{
  const cells: Cell[] = randoms.map((d, i) => {
    const face = renderFace(d);
    const cons = renderConsist(d);
    return {
      w: 64 * 2 + 12 + cons.width * 2,
      h: 76 * 2 + 40,
      draw: (s, x, y) => {
        s.text(`#${i + 1} ${COLOR_LABELS[d.bodyColor]}/${COLOR_LABELS[d.bandColor]}`, x, y, INK);
        s.text(`${short(d)}  ${shortSide(d)}`, x, y + 18, GRAY);
        s.indexed(face, P, x, y + 40, 2);
        s.indexed(cons, P, x + 140, y + 40 + 24, 2);
      },
    };
  });
  grid(cells, 2, 16, 16, "ランダム 60（種 20261120、顔と2両編成。2倍）").save(path.join(OUT, "random-color.png"));
  // 拡大ページ（3両にして中間車も見る）
  for (let p = 0; p < 10; p++) {
    const pc = randoms.slice(p * 6, p * 6 + 6).map((d0, k) => {
      const d = { ...d0, cars: 3 };
      const face = renderFace(d);
      const cons = renderConsist(d);
      return {
        w: 64 * 2 + 12 + cons.width * 2,
        h: 76 * 2 + 24,
        draw: (s: Sheet, x: number, y: number) => {
          s.text(`#${p * 6 + k + 1} ${short(d)} | ${shortSide(d)}`, x, y, INK);
          s.indexed(face, P, x, y + 24, 2);
          s.indexed(cons, P, x + 140, y + 24 + 24, 2);
        },
      };
    });
    // 3両 × 2倍 = 1152 は広いので、2両目と3両目は下の段に
    grid(pc, 1, 8, 8).save(path.join(REVIEW, `random-color-${String(p + 1).padStart(2, "0")}.png`));
  }
}

for (const set of PATTERN_SETS) {
  const cells: Cell[] = randoms.map((d, i) => {
    const face = toMono(renderFace(d), 3, set);
    const cons = renderConsist(d);
    const m1 = toMono(cons, 1, set);
    const m2 = toMono(cons, 2, set);
    return {
      w: face.width + 12 + m2.width,
      h: Math.max(face.height, m1.height + 8 + m2.height) + 20,
      draw: (s, x, y) => {
        s.text(`#${i + 1} ${COLOR_LABELS[d.bodyColor]}/${COLOR_LABELS[d.bandColor]} ${short(d)} ${shortSide(d)}`, x, y, INK);
        s.bit(face, x, y + 20);
        s.bit(m1, x + face.width + 12, y + 20);
        s.bit(m2, x + face.width + 12, y + 20 + m1.height + 8);
      },
    };
  });
  grid(cells, 2, 16, 16, `ランダム 60 の白黒（${set}。顔は3倍、側面は等倍と2倍）`).save(path.join(OUT, `random-mono-${set}.png`));
  for (let p = 0; p < 15; p++) grid(cells.slice(p * 4, p * 4 + 4), 1, 8, 8).save(path.join(REVIEW, `random-mono-${set}-${String(p + 1).padStart(2, "0")}.png`));
}

// ---- 5. v2-compare.png ----
{
  type V2Img = { w: number; h: number; d: (string | null)[] };
  type V2 = { face: (o: unknown) => V2Img; car: (o: unknown) => V2Img; faces: Record<string, unknown>[]; trains: Record<string, unknown>[][]; PAL: Record<string, string> };
  const v2 = createRequire(import.meta.url)(path.join(ROOT, "prototypes/art-sample/v2-realistic.cjs")) as V2;
  const v2Img = (s: Sheet, im: V2Img, x: number, y: number, scale: number) => {
    for (let j = 0; j < im.h; j++) {
      for (let i = 0; i < im.w; i++) {
        const c = im.d[j * im.w + i];
        if (!c) continue;
        const rgb: Rgba = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
        s.fill(x + i * scale, y + j * scale, scale, scale, rgb);
      }
    }
  };
  const colorOf = (hex: unknown) => COLOR_IDS.find((id) => v2.PAL[id] === hex) ?? "white";
  const designs: TrainDesign[] = v2.faces.map((f, i) => {
    const lead = v2.trains[i][0];
    return {
      face: {
        contour: f.contour as TrainDesign["face"]["contour"],
        window: f.window as TrainDesign["face"]["window"],
        door: f.door as TrainDesign["face"]["door"],
        lightShape: f.lightShape as TrainDesign["face"]["lightShape"],
        lightPos: f.lightPos as TrainDesign["face"]["lightPos"],
        sign: f.sign as TrainDesign["face"]["sign"],
        skirt: f.skirt as TrainDesign["face"]["skirt"],
        paint: f.paint as TrainDesign["face"]["paint"],
      },
      side: {
        nose: lead.nose as TrainDesign["side"]["nose"],
        window: lead.win as TrainDesign["side"]["window"],
        doors: (["", "", "two", "three", "four"] as const)[lead.doors as number] as TrainDesign["side"]["doors"],
        roof: "cooler",
        band: lead.band as TrainDesign["side"]["band"],
      },
      bodyColor: colorOf(f.color),
      bandColor: colorOf(f.bandColor),
      cars: 2,
      logo: { ...base.logo },
    };
  });
  const titles = ["01 都市の通勤形", "02 都市間の特急", "03 高速列車", "04 昔ながらの近郊形"];
  const s = new Sheet(1600, 4 * 520 + 40, PAPER);
  s.text("v2 の見本（上段）と、新しいコードで同じ組み合わせを描いたもの（下段）。顔 3倍、側面 2倍", 16, 12, INK);
  designs.forEach((d, i) => {
    const y = 40 + i * 520;
    s.text(titles[i], 16, y, INK);
    s.text(`v2: 顔 ${short(d)} / 側面 先頭 ${JSON.stringify(v2.trains[i][0])}`, 16, y + 18, GRAY);
    v2Img(s, v2.face({ ...v2.faces[i] }), 16, y + 40, 3);
    v2Img(s, v2.car(v2.trains[i][0]), 16 + 204, y + 40, 2);
    v2Img(s, v2.car(v2.trains[i][1]), 16 + 204 + 384, y + 40, 2);
    s.text("新", 16, y + 270, INK);
    s.indexed(renderFace(d), P, 16, y + 290, 3);
    s.indexed(renderConsist(d), P, 16 + 204, y + 290, 2);
  });
  s.save(path.join(OUT, "v2-compare.png"));
}

// ---- 6. logos.png ----
{
  const cells: Cell[] = PRESET_LOGOS.map((l, i) => {
    const d: TrainDesign = { ...base, logo: { bits: l.bits, fg: COLOR_IDS[(i % 11) + 1], bg: "white" } };
    const img = createIndexed(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const on = (parseInt(l.bits[y * 4 + (x >> 2)], 16) >> (3 - (x & 3))) & 1;
      img.data[y * 16 + x] = on ? tones(d.logo.fg).logoFg : tones(d.logo.bg).logoBg;
    }
    const mono = toMono(img, 4, "bold");
    return {
      w: 16 * 6 + 8 + 64,
      h: 16 * 6 + 24,
      draw: (s, x, y) => {
        s.text(`${l.label}（${l.id}）`, x, y, INK);
        s.indexed(img, P, x, y + 22, 6);
        s.bit(mono, x + 16 * 6 + 8, y + 22);
      },
    };
  });
  grid(cells, 4, 24, 16, "既製ロゴ 12 種（左: 6倍、右: 白黒 4倍）").save(path.join(OUT, "logos.png"));
}

// ---- 7. print-test-*.png（384 ドット幅の白黒） ----
function blitBit(dst: BitImage, src: BitImage, x: number, y: number): void {
  for (let j = 0; j < src.height; j++) for (let i = 0; i < src.width; i++) if (getPixel(src, i, j)) setPixel(dst, x + i, y + j, 1);
}
function rotateCW(img: IndexedImage): IndexedImage {
  const out = createIndexed(img.height, img.width);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) out.data[x * out.width + (img.height - 1 - y)] = img.data[y * img.width + x];
  return out;
}
function monoLabel(dst: BitImage, text: string, x: number, y: number): void {
  const s = new Sheet(dst.width, 16, [255, 255, 255, 255]);
  s.text(text, 0, 0, [0, 0, 0, 255]);
  for (let j = 0; j < 16; j++) for (let i = 0; i < dst.width; i++) if (s.rgba[(j * dst.width + i) * 4] < 128) setPixel(dst, x + i, y + j, 1);
}
const inkReport: string[] = [];
/** 確認用に 3 倍で保存（384 ドットは画面では小さすぎるため） */
function zoomBit(name: string, img: BitImage): void {
  const z = new Sheet(img.width * 3, img.height * 3, [255, 255, 255, 255]);
  z.bit(img, 0, 0, 3);
  z.save(path.join(REVIEW, `${name}-x3.png`));
}
for (const set of PATTERN_SETS as PatternSet[]) {
  // (a) 12色の模様見本
  {
    const img = createBit(384, 22 + 2 * 100);
    monoLabel(img, `12色の模様（${set}）`, 4, 0);
    COLOR_IDS.forEach((id, k) => {
      const sw = createIndexed(28, 22, tones(id).base);
      const m = toMono(sw, 2, set);
      const x = 8 + (k % 6) * 62;
      const y = 22 + Math.floor(k / 6) * 100;
      for (let i = -1; i <= m.width; i++) {
        setPixel(img, x + i, y - 1, 1);
        setPixel(img, x + i, y + m.height, 1);
      }
      for (let j = 0; j < m.height; j++) {
        setPixel(img, x - 1, y + j, 1);
        setPixel(img, x + m.width, y + j, 1);
      }
      blitBit(img, m, x, y);
      monoLabel(img, COLOR_LABELS[id], x, y + m.height + 4);
    });
    saveBit(path.join(OUT, `print-test-patterns-${set}.png`), img);
    zoomBit(`print-test-patterns-${set}`, img);
  }
  // (b) 顔1つ＋2両を等倍で横置き / (c) 顔＋先頭車2倍を90度回転
  const d = base;
  {
    const face = toMono(renderFace(d), 1, set);
    const cons = toMono(renderConsist(d, { limit: 2 }), 1, set);
    const img = createBit(384, 20 + face.height + 8 + cons.height + 8);
    monoLabel(img, `顔と2両 等倍（${set}）`, 4, 0);
    blitBit(img, face, (384 - face.width) >> 1, 20);
    blitBit(img, cons, 0, 20 + face.height + 8);
    saveBit(path.join(OUT, `print-test-side1x-${set}.png`), img);
    zoomBit(`print-test-side1x-${set}`, img);
    const r = maxInkRatio(img);
    inkReport.push(`side1x-${set}: 64x64 の黒の最大 ${(r.ratio * 100).toFixed(1)}% (${r.x},${r.y})`);
  }
  {
    const face = toMono(renderFace(d), 3, set);
    const car = toMono(rotateCW(renderCar({ ...d, cars: 8 }, "lead")), 2, set);
    const img = createBit(384, 20 + face.height + 12 + car.height + 8);
    monoLabel(img, `顔3倍と先頭車2倍・90度回転（${set}）`, 4, 0);
    blitBit(img, face, (384 - face.width) >> 1, 20);
    blitBit(img, car, (384 - car.width) >> 1, 20 + face.height + 12);
    saveBit(path.join(OUT, `print-test-rot2x-${set}.png`), img);
    zoomBit(`print-test-rot2x-${set}`, img);
    const r = maxInkRatio(img);
    inkReport.push(`rot2x-${set}: 64x64 の黒の最大 ${(r.ratio * 100).toFixed(1)}% (${r.x},${r.y})`);
  }
}

// 黒の割合（ランダム 60 の顔3倍・側面2倍）
for (const set of PATTERN_SETS) {
  let worst = { ratio: 0, label: "" };
  let over = 0;
  randoms.forEach((d, i) => {
    for (const [label, m] of [
      ["顔3倍", toMono(renderFace(d), 3, set)],
      ["側面2倍", toMono(renderConsist(d), 2, set)],
    ] as const) {
      const r = maxInkRatio(m);
      if (r.ratio > 0.5) over++;
      if (r.ratio > worst.ratio) worst = { ratio: r.ratio, label: `#${i + 1} ${label} ${d.bodyColor}/${d.bandColor} ${short(d)} ${shortSide(d)}` };
    }
  });
  inkReport.push(`random ${set}: 64x64 の黒の最大 ${(worst.ratio * 100).toFixed(1)}%（${worst.label}）、5割を超えた画像 ${over}/120`);
}
fs.writeFileSync(path.join(OUT, "ink-report.txt"), inkReport.join("\n") + "\n");
console.log(inkReport.join("\n"));
console.log(`書き出し先: ${path.relative(ROOT, OUT)}`);
void CAR_W;
