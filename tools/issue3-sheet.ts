// Issue #3「窓のところの違いがわからない」の確認用の比較画像を tools/out/sprites/ に出す。
//   node tools/run.mjs tools/issue3-sheet.ts
// pnpm sprites:sheet は tools/out/sprites/ を消して作り直すので、そのあとに実行する。
// 直す前の画像（issue3-front-windows-before.png）は、直す前のコードで作ったものを
// tools/out/issue3-before.png に置いておき、それをコピーする（直したあとのコードでは作り直せない）。
import fs from "node:fs";
import path from "node:path";
import type { Rgba } from "../shared/pix/index.ts";
import { defaultDesign, FACE_CHOICES, FACE_H, FACE_W, renderFace, toMono, TRAIN_PALETTE, type FaceDesign, type TrainDesign } from "../shared/train/index.ts";
import { ROOT } from "./lib/paths.ts";
import { Sheet } from "./lib/sheet.ts";

const OUT = path.join(ROOT, "tools/out/sprites");
fs.mkdirSync(OUT, { recursive: true });

const BG: Rgba = [33, 41, 49, 255];
const TEXT: Rgba = [236, 236, 236, 255];
const SUB: Rgba = [160, 172, 180, 255];

const base = defaultDesign();
const face = (patch: Partial<FaceDesign>): TrainDesign => ({ ...base, face: { ...base.face, ...patch } });

type Row = { label: string; sub?: string; cells: ((s: Sheet, x: number, y: number, scale: number) => void)[] };

/** 列 = 前面窓、行 = rows の表。見出しは点データフォントで、scale 倍の顔を並べる */
function table(title: string, rows: Row[], scale: number, cellW = FACE_W * scale, cellH = FACE_H * scale): Sheet {
  const G = 8 * Math.min(scale, 3);
  const left = 150;
  const head = 64;
  const cols = FACE_CHOICES.window;
  const s = new Sheet(left + G + cols.length * (cellW + G), head + G + rows.length * (cellH + G), BG);
  s.text(title, 12, 8, TEXT);
  cols.forEach((c, i) => {
    const x = left + G + i * (cellW + G);
    s.text(c.label, x, 36, TEXT, 1);
  });
  rows.forEach((r, j) => {
    const y = head + G + j * (cellH + G);
    s.text(r.label, 12, y + (cellH >> 1) - 16, TEXT);
    if (r.sub) s.text(r.sub, 12, y + (cellH >> 1) + 4, SUB);
    r.cells.forEach((draw, i) => draw(s, left + G + i * (cellW + G), y, scale));
  });
  return s;
}

const color = (d: TrainDesign) => (s: Sheet, x: number, y: number, scale: number) => s.indexed(renderFace(d), TRAIN_PALETTE, x, y, scale);
const mono = (d: TrainDesign, set: "bold" | "light") => (s: Sheet, x: number, y: number, scale: number) => s.bit(toMono(renderFace(d), scale, set), x, y);

// 1. 直す前（コピー）
const before = path.join(ROOT, "tools/out/issue3-before.png");
if (fs.existsSync(before)) fs.copyFileSync(before, path.join(OUT, "issue3-front-windows-before.png"));
else console.warn(`直す前の画像がありません: ${path.relative(ROOT, before)}`);

// 2. 直したあと（直す前と同じ並べ方: 列 = 窓、行 = 扉なし / 中央 / 片側寄せ。5 倍。ほかの部位は直す前の画像と同じ）
const doorRows = (render: (d: TrainDesign) => Row["cells"][number], patch: Partial<FaceDesign> = {}): Row[] =>
  FACE_CHOICES.door.map((door) => ({
    label: `扉 ${door.label}`,
    cells: FACE_CHOICES.window.map((w) => render(face({ ...patch, window: w.id, door: door.id }))),
  }));
table("直したあと（輪郭 四角、ほかは既定。5倍）", doorRows(color), 5).save(path.join(OUT, "issue3-front-windows-after.png"));

// 3. 白黒（bold / light、3 倍）
for (const set of ["bold", "light"] as const) {
  table(`直したあとの白黒（${set}、印刷 3 倍）`, doorRows((d) => mono(d, set)), 3).save(path.join(OUT, `issue3-front-windows-after-mono-${set}.png`));
}

// 4. 輪郭 4 種 × 扉 3 種（3 倍）
{
  const rows: Row[] = [];
  for (const contour of FACE_CHOICES.contour)
    for (const door of FACE_CHOICES.door)
      rows.push({ label: `輪郭 ${contour.label}`, sub: `扉 ${door.label}`, cells: FACE_CHOICES.window.map((w) => color(face({ contour: contour.id, window: w.id, door: door.id }))) });
  table("直したあと: 輪郭 4 種 × 扉 3 種（3倍）", rows, 3).save(path.join(OUT, "issue3-front-windows-after-contours.png"));
  // 輪郭ごとにも（4 倍。まとめた画像は縦に長く、縮めて表示されやすいため）
  for (const contour of FACE_CHOICES.contour)
    table(
      `直したあと: 輪郭 ${contour.label}（4倍）`,
      FACE_CHOICES.door.map((door) => ({ label: `扉 ${door.label}`, cells: FACE_CHOICES.window.map((w) => color(face({ contour: contour.id, window: w.id, door: door.id }))) })),
      4,
    ).save(path.join(OUT, `issue3-front-windows-after-contour-${contour.id}.png`));
}

// 5. 扉ありで、ほかの部位を変えたとき（ライトが窓の上・窓の中の行先表示・窓まわりを黒・警戒色。3 倍）
{
  const rows: Row[] = [];
  const variants: [string, Partial<FaceDesign>][] = [
    ["ライト 窓の上", { lightPos: "top" }],
    ["行先 窓の中", { sign: "inwin" }],
    ["窓まわりを黒", { paint: "blackface" }],
    ["LED・窓の上", { lightShape: "led", lightPos: "top", sign: "none" }],
  ];
  for (const [label, patch] of variants)
    for (const door of FACE_CHOICES.door.filter((d) => d.id !== "none"))
      rows.push({ label, sub: `扉 ${door.label}`, cells: FACE_CHOICES.window.map((w) => color(face({ ...patch, window: w.id, door: door.id }))) });
  table("直したあと: 扉ありで、ほかの部位を変えたもの（3倍）", rows, 3).save(path.join(OUT, "issue3-front-windows-after-variants.png"));
}

// 6. ライトの形 3 種 × 位置 3 種、輪郭 4 種の「直す前／直したあと」（5 倍）
//    直す前の絵は、直す前のコードで `ISSUE3_SAVE_BEFORE=1 node tools/run.mjs tools/issue3-sheet.ts` を実行して
//    tools/out/issue3-lights-contours-before.json（色番号の画像）に保存したものを使う。
{
  const S = 5;
  type Item = { key: string; design: TrainDesign };
  const lights: Item[][] = FACE_CHOICES.lightPos.map((pos) =>
    FACE_CHOICES.lightShape.map((shape) => ({ key: `light/${pos.id}/${shape.id}`, design: face({ lightPos: pos.id, lightShape: shape.id }) })),
  );
  const contours: Item[] = FACE_CHOICES.contour.map((c) => ({ key: `contour/${c.id}`, design: face({ contour: c.id }) }));
  const beforeFile = path.join(ROOT, "tools/out/issue3-lights-contours-before.json");
  const encode = (d: TrainDesign) => Buffer.from(renderFace(d).data).toString("base64");
  if (process.env.ISSUE3_SAVE_BEFORE === "1") {
    const saved: Record<string, string> = {};
    for (const it of [...lights.flat(), ...contours]) saved[it.key] = encode(it.design);
    fs.writeFileSync(beforeFile, JSON.stringify(saved));
    console.log(`直す前の絵を保存: ${path.relative(ROOT, beforeFile)}`);
  }
  const before: Record<string, string> = fs.existsSync(beforeFile) ? JSON.parse(fs.readFileSync(beforeFile, "utf8")) : {};
  const draw = (s: Sheet, it: Item, which: "before" | "after", x: number, y: number) => {
    if (which === "after") return s.indexed(renderFace(it.design), TRAIN_PALETTE, x, y, S);
    const b = before[it.key];
    if (!b) return s.text("（直す前の絵なし）", x, y + 40, SUB);
    s.indexed({ kind: "indexed", width: FACE_W, height: FACE_H, data: Uint8Array.from(Buffer.from(b, "base64")) }, TRAIN_PALETTE, x, y, S);
  };
  const CW = FACE_W * S;
  const CH = FACE_H * S;
  const G = 24;
  const left = 170;
  const cols = 8;
  const sheetW = left + cols * (CW + G);
  const lightTop = 80;
  const contourTop = lightTop + 3 * (CH + G) + 90;
  const s = new Sheet(sheetW, contourTop + CH + G + 40, BG);
  s.text("ライトの形と輪郭: 直す前／直したあと（5倍、ほかの部位は既定）", 12, 8, TEXT);
  // ライト: 列 = 形 × (前, 後)、行 = 位置
  FACE_CHOICES.lightShape.forEach((shape, i) => {
    s.text(`${shape.label}`, left + i * 2 * (CW + G), 36, TEXT);
    s.text("直す前", left + i * 2 * (CW + G), 54, SUB);
    s.text("直したあと", left + (i * 2 + 1) * (CW + G), 54, SUB);
  });
  lights.forEach((row, j) => {
    const y = lightTop + j * (CH + G);
    s.text(`位置 ${FACE_CHOICES.lightPos[j].label}`, 12, y + (CH >> 1), TEXT);
    row.forEach((it, i) => {
      draw(s, it, "before", left + i * 2 * (CW + G), y);
      draw(s, it, "after", left + (i * 2 + 1) * (CW + G), y);
    });
  });
  // 輪郭: 列 = 輪郭 × (前, 後)
  contours.forEach((it, i) => {
    s.text(`輪郭 ${FACE_CHOICES.contour[i].label}`, left + i * 2 * (CW + G), contourTop - 56, TEXT);
    s.text("直す前", left + i * 2 * (CW + G), contourTop - 36, SUB);
    s.text("直したあと", left + (i * 2 + 1) * (CW + G), contourTop - 36, SUB);
    draw(s, it, "before", left + i * 2 * (CW + G), contourTop);
    draw(s, it, "after", left + (i * 2 + 1) * (CW + G), contourTop);
  });
  s.text("輪郭", 12, contourTop + (CH >> 1), TEXT);
  s.save(path.join(OUT, "issue3-lights-contours.png"));
  // 白黒（bold、直したあとだけ。印刷 3 倍）
  const ms = new Sheet(left + 4 * (FACE_W * 3 + G), 60 + 4 * (FACE_H * 3 + G), BG);
  ms.text("直したあとの白黒（bold、印刷 3 倍）: 上 3 行 = ライト（列は形、行は位置）、下 1 行 = 輪郭 4 種", 12, 8, TEXT);
  lights.forEach((row, j) => {
    ms.text(`位置 ${FACE_CHOICES.lightPos[j].label}`, 12, 60 + j * (FACE_H * 3 + G) + 100, TEXT);
    row.forEach((it, i) => ms.bit(toMono(renderFace(it.design), 3, "bold"), left + i * (FACE_W * 3 + G), 60 + j * (FACE_H * 3 + G)));
  });
  ms.text("輪郭", 12, 60 + 3 * (FACE_H * 3 + G) + 100, TEXT);
  contours.forEach((it, i) => ms.bit(toMono(renderFace(it.design), 3, "bold"), left + i * (FACE_W * 3 + G), 60 + 3 * (FACE_H * 3 + G)));
  ms.save(path.join(OUT, "issue3-lights-contours-mono-bold.png"));
}

console.log(`書き出し先: ${path.relative(ROOT, OUT)}/issue3-*.png`);
