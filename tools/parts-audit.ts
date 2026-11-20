// 見分けにくいパーツの組み合わせを洗い出す。
//   pnpm parts:audit（= node tools/run.mjs tools/parts-audit.ts）
// 各パーツについて、ほかのパーツの全組み合わせごとに、選択肢の 2 つずつで絵の違うドット数を数え、
// しきい値未満のものを「見分けにくい」として tools/out/sprites/parts-audit.md と parts-audit.png に書き出す。
// pnpm sprites:sheet は tools/out/sprites/ を消すので、そのあとに実行する。
import fs from "node:fs";
import path from "node:path";
import type { IndexedImage, Rgba } from "../shared/pix/index.ts";
import {
  CAR_H,
  CAR_W,
  defaultDesign,
  FACE_CHOICES,
  FACE_H,
  FACE_KEYS,
  FACE_PART_LABELS,
  FACE_W,
  faceLayout,
  renderCar,
  renderFace,
  SIDE_CHOICES,
  SIDE_KEYS,
  SIDE_PART_LABELS,
  TRAIN_PALETTE,
  type Choice,
  type TrainDesign,
} from "../shared/train/index.ts";
import { ROOT } from "./lib/paths.ts";
import { Sheet } from "./lib/sheet.ts";

const OUT = path.join(ROOT, "tools/out/sprites");
fs.mkdirSync(OUT, { recursive: true });

/**
 * しきい値（違うドットの数）。顔の前面窓 5 種類は、扉なしで見分けられている最小のペア差が 95 ドット。
 * その半分の 48 ドット未満を「見分けにくい」とする（側面も同じ値。絵の大きさではなく、違う部分の大きさで見る）。
 */
const THRESHOLD = 48;

type Table = Record<string, readonly Choice<string>[]>;

/** 全組み合わせの絵を作っておく（混合基数で番号を付ける） */
function renderAll(table: Table, keys: string[], make: (sel: Record<string, string>) => Uint8Array[]): { imgs: Uint8Array[][]; radix: number[]; total: number } {
  const radix = keys.map((k) => table[k].length);
  const total = radix.reduce((a, b) => a * b, 1);
  const imgs: Uint8Array[][] = new Array(total);
  for (let n = 0; n < total; n++) {
    const sel: Record<string, string> = {};
    let r = n;
    for (let i = keys.length - 1; i >= 0; i--) {
      sel[keys[i]] = table[keys[i]][r % radix[i]].id;
      r = Math.floor(r / radix[i]);
    }
    imgs[n] = make(sel);
  }
  return { imgs, radix, total };
}

const diff = (a: Uint8Array, b: Uint8Array): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

/** 全ペアの、組み合わせを通しての最小の差（しきい値以上のものも含む。参考に出す） */
const closest: { area: string; partLabel: string; a: string; b: string; min: number }[] = [];

type Finding = {
  area: string;
  part: string;
  partLabel: string;
  a: Choice<string>;
  b: Choice<string>;
  /** 見分けにくかった組み合わせの数 / 比べた組み合わせの数 */
  count: number;
  of: number;
  min: number;
  max: number;
  /** 見分けにくかった組み合わせに共通する条件 */
  when: string[];
  /** 部位どうしの依存を崩さない形の、主な組み合わせ（1〜2 部位の値の組と、そのときに起きる割合） */
  groups: { cond: string; hits: number; total: number; example: string }[];
  /** 代表例（差がいちばん小さいもの） */
  sample: Record<string, string>;
  view: number;
};

function audit(
  area: string,
  table: Table,
  keys: string[],
  labels: Record<string, string>,
  all: { imgs: Uint8Array[][]; radix: number[]; total: number },
  views: string[],
  /** パーツごとに見る絵（views の番号） */
  viewsFor: (part: string) => number[],
): Finding[] {
  const out: Finding[] = [];
  const { imgs, radix, total } = all;
  const decode = (n: number) => {
    const sel: Record<string, string> = {};
    let r = n;
    for (let i = keys.length - 1; i >= 0; i--) {
      sel[keys[i]] = table[keys[i]][r % radix[i]].id;
      r = Math.floor(r / radix[i]);
    }
    return sel;
  };
  keys.forEach((part, pi) => {
    const stride = radix.slice(pi + 1).reduce((a, b) => a * b, 1);
    const m = radix[pi];
    for (const v of viewsFor(part)) {
      // 組 (a, b) ごとの記録
      const rec = new Map<string, { hits: number[]; diffs: number[]; of: number; min: number }>();
      for (let n = 0; n < total; n++) {
        // このパーツが最初の選択肢である番号だけを起点にする
        if (Math.floor(n / stride) % m !== 0) continue;
        for (let i = 0; i < m; i++) {
          for (let j = i + 1; j < m; j++) {
            const d = diff(imgs[n + i * stride][v], imgs[n + j * stride][v]);
            const key = `${i}:${j}`;
            let r = rec.get(key);
            if (!r) rec.set(key, (r = { hits: [], diffs: [], of: 0, min: Infinity }));
            r.of++;
            if (d < r.min) r.min = d;
            if (d < THRESHOLD) {
              r.hits.push(n);
              r.diffs.push(d);
            }
          }
        }
      }
      for (const [key, r] of rec) {
        const [i, j] = key.split(":").map(Number);
        closest.push({ area: `${area}（${views[v]}）`, partLabel: labels[part], a: table[part][i].label, b: table[part][j].label, min: r.min });
        if (r.hits.length === 0) continue;
        // 共通する条件: ほかのパーツで、見分けにくい組み合わせに出てくる値が全部でないもの
        const when: string[] = [];
        keys.forEach((k, ki) => {
          if (ki === pi) return;
          const seen = new Set(r.hits.map((n) => decode(n)[k]));
          if (seen.size < table[k].length) when.push(`${labels[k]}が「${table[k].filter((c) => seen.has(c.id)).map((c) => c.label).join("」「")}」`);
        });
        // 主な組み合わせ: ほかの部位 1 つか 2 つの値の組ごとに、その値の組を持つ組み合わせのうち見分けにくかった割合を出し、
        // 割合が高い（同じなら部位の数が少なく、件数が多い）順に 3 つ
        const mainGroups = (hits: number[], of: number, pi: number) => {
          const others = keys.map((_, i) => i).filter((i) => i !== pi);
          const sets: number[][] = [...others.map((a) => [a]), ...others.flatMap((a, ai) => others.slice(ai + 1).map((b) => [a, b]))];
          const cands: { cond: string; hits: number; total: number; example: string; size: number }[] = [];
          for (const set of sets) {
            const cnt = new Map<string, { n: number; first: number }>();
            for (const h of hits) {
              const sel = decode(h);
              const key = set.map((i) => sel[keys[i]]).join("\t");
              const c = cnt.get(key);
              if (c) c.n++;
              else cnt.set(key, { n: 1, first: h });
            }
            const total = of / set.reduce((a, i) => a * table[keys[i]].length, 1);
            for (const [key, c] of cnt) {
              const vals = key.split("\t");
              const cond = set.map((i, q) => `${labels[keys[i]]}「${table[keys[i]].find((x) => x.id === vals[q])!.label}」`).join("かつ");
              const sel = decode(c.first);
              const example = keys.filter((_, i) => i !== pi).map((k) => `${labels[k]}=${table[k].find((x) => x.id === sel[k])!.label}`).join("、");
              cands.push({ cond, hits: c.n, total, example, size: set.length });
            }
          }
          cands.sort((a, b) => b.hits / b.total - a.hits / a.total || a.size - b.size || b.hits - a.hits);
          return cands.slice(0, 3).map(({ size: _s, ...g }) => g);
        };
        let best = 0;
        for (let q = 1; q < r.diffs.length; q++) if (r.diffs[q] < r.diffs[best]) best = q;
        out.push({
          area: `${area}（${views[v]}）`,
          part,
          partLabel: labels[part],
          a: table[part][i],
          b: table[part][j],
          count: r.hits.length,
          of: r.of,
          min: Math.min(...r.diffs),
          max: Math.max(...r.diffs),
          when,
          sample: { ...decode(r.hits[best]), [part]: table[part][i].id },
          groups: mainGroups(r.hits, r.of, pi),
          view: v,
        });
      }
    }
  });
  return out;
}

const base = defaultDesign();
const t0 = Date.now();

// ---- 顔（8 部位、19,440 通りの全数。車体色・帯色・両数は既定） ----
const faceTable = FACE_CHOICES as unknown as Table;
const faceAll = renderAll(faceTable, FACE_KEYS, (sel) => [renderFace({ ...base, face: sel as TrainDesign["face"] }).data]);
const faceFindings = audit("顔", faceTable, FACE_KEYS, FACE_PART_LABELS, faceAll, ["正面"], () => [0]);

// ---- 側面（5 部位、1,296 通りの全数 × 先頭車・中間車。パンタグラフは載せて比べる） ----
const sideTable = SIDE_CHOICES as unknown as Table;
const sideAll = renderAll(sideTable, SIDE_KEYS, (sel) => {
  const d = { ...base, side: sel as TrainDesign["side"] };
  return [renderCar(d, "lead", { panto: true }).data, renderCar(d, "middle", { panto: true }).data];
});
// 中間車には鼻先が無いので、鼻先は先頭車だけで比べる
const sideFindings = audit("側面", sideTable, SIDE_KEYS, SIDE_PART_LABELS, sideAll, ["先頭車", "中間車"], (p) => (p === "nose" ? [0] : [0, 1]));

// ---- 昨夜の時点で分かっていたもの（数え方は tools/out/.run/count.mjs と同じ） ----
let shrunk = 0;
let noTail = 0;
const shrunkBy = new Map<string, number>();
const noTailBy = new Map<string, number>();
for (let n = 0; n < faceAll.total; n++) {
  let r = n;
  const sel: Record<string, string> = {};
  for (let i = FACE_KEYS.length - 1; i >= 0; i--) {
    sel[FACE_KEYS[i]] = faceTable[FACE_KEYS[i]][r % faceAll.radix[i]].id;
    r = Math.floor(r / faceAll.radix[i]);
  }
  const f = sel as TrainDesign["face"];
  const L = faceLayout({ ...base, face: f });
  const isShrunk = f.lightShape === "led" ? L.lamps[0].w < 10 : L.lamps[0].w < 6;
  const label = (k: keyof TrainDesign["face"]) => FACE_CHOICES[k].find((c) => c.id === f[k])!.label;
  if (isShrunk) {
    shrunk++;
    const k = `輪郭「${label("contour")}」・扉「${label("door")}」・ライト「${label("lightShape")}」「${label("lightPos")}」`;
    shrunkBy.set(k, (shrunkBy.get(k) ?? 0) + 1);
  }
  if (L.tails.length === 0) {
    noTail++;
    const k = `輪郭「${label("contour")}」・ライト「${label("lightShape")}」「${label("lightPos")}」・行先表示「${label("sign")}」`;
    noTailBy.set(k, (noTailBy.get(k) ?? 0) + 1);
  }
}

// ---- 書き出し ----
const all = [...faceFindings, ...sideFindings].sort((p, q) => q.count - p.count || p.min - q.min);
const md: string[] = [];
md.push("# 見分けにくいパーツの組み合わせ（parts:audit）");
md.push("");
md.push(`- しきい値: 違うドットが **${THRESHOLD} ドット未満** のペアを「見分けにくい」とした（顔の前面窓 5 種類が扉なしで見分けられている最小のペア差 95 の半分）。`);
md.push("- 顔: 8 部位の全 19,440 通り（全数）。各部位について、ほかの 7 部位の組み合わせごとに、その部位の選択肢を 2 つずつ比べた。車体色は銀、帯は緑、8 両（顔のパンタグラフなし）。");
md.push("- 側面: 5 部位の全 1,296 通り（全数）× 先頭車・中間車（パンタグラフは載せる、ロゴは既定）。鼻先は中間車に無いので先頭車だけで比べた。");
md.push("- 「条件」は、見分けにくかった例に出てきた値を、部位ごとに別々に並べた一覧（その部位の選択肢の一部に限られるものだけ書く）。**これらの値がそろえば必ず起きる、という意味ではない**（部位どうしの組み合わせの依存は、この一覧からは消えている）。");
md.push("- 「主な組み合わせ」は、ほかの部位 1 つか 2 つの値の組ごとに、その値の組を持つ組み合わせのうち何件で起きたか（割合の高い順に 3 つ）。部位どうしの依存を崩さずに読めるよう、例も 1 件ずつ付けた。");
md.push("- 前面窓以外は直していない（一覧にしただけ）。");
md.push(`- 実行時間 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
md.push("");
md.push("## まとめ");
md.push("");
md.push(`| 場所 | 部位 | 見分けにくいペア | 件数 / 比べた数 | 違うドット（最小〜最大） |`);
md.push("|---|---|---|---|---|");
for (const f of all) md.push(`| ${f.area} | ${f.partLabel} | 「${f.a.label}」と「${f.b.label}」 | ${f.count.toLocaleString()} / ${f.of.toLocaleString()} | ${f.min}〜${f.max} |`);
if (all.length === 0) md.push("| なし | | | | |");
md.push("");
md.push("## 条件（多い順）");
md.push("");
all.forEach((f, i) => {
  md.push(`### ${i + 1}. ${f.area} ${f.partLabel}: 「${f.a.label}」と「${f.b.label}」（${f.count.toLocaleString()} / ${f.of.toLocaleString()}）`);
  md.push("");
  md.push(`- 条件: ${f.when.length ? f.when.join("、") : "限定なし（どの組み合わせでも起きる）"}`);
  md.push("- 主な組み合わせ:");
  for (const g of f.groups) md.push(`  - ${g.cond}のとき: ${g.hits.toLocaleString()} / ${g.total.toLocaleString()} 件（例: ${g.example}）`);
  md.push(`- 違うドット: ${f.min}〜${f.max}`);
  md.push(`- 代表例（差がいちばん小さいもの）: ${Object.entries(f.sample).filter(([k]) => k !== f.part).map(([k, v]) => `${(f.area.startsWith("顔") ? FACE_PART_LABELS : SIDE_PART_LABELS)[k as never]}=${((f.area.startsWith("顔") ? faceTable : sideTable)[k].find((c) => c.id === v) ?? { label: v }).label}`).join("、")}`);
  md.push("");
});
md.push("## 参考: しきい値以上だが差が小さいペア（最小の差が 96 ドット未満のもの、小さい順）");
md.push("");
md.push("| 場所 | 部位 | ペア | 最小の差 |");
md.push("|---|---|---|---|");
for (const c of closest.filter((c) => c.min >= THRESHOLD && c.min < THRESHOLD * 2).sort((p, q) => p.min - q.min)) md.push(`| ${c.area} | ${c.partLabel} | 「${c.a}」と「${c.b}」 | ${c.min} |`);
md.push("");
md.push("## 昨夜の時点で分かっていたもの（破綻ではないが、選んだとおりに出ない）");
md.push("");
md.push(`- 顔のライトが小さくなる組み合わせ: **${shrunk.toLocaleString()} 通り** / 19,440（数え方: 1 つ目のライトの幅が、LED 風は 10 未満、ほかは 6 未満。直す前は 2,340 通り）`);
for (const [k, n] of [...shrunkBy].sort((a, b) => b[1] - a[1])) md.push(`  - ${k}: ${n}`);
md.push(`- 尾灯が出ない組み合わせ: **${noTail.toLocaleString()} 通り** / 19,440（数え方: 配置の尾灯が 0 個。直す前に同じ数え方で数えると 1,080 通り。メモの 960 通りは再現できなかった）`);
for (const [k, n] of [...noTailBy].sort((a, b) => b[1] - a[1])) md.push(`  - ${k}: ${n}`);
md.push("");
fs.writeFileSync(path.join(OUT, "parts-audit.md"), md.join("\n"));

// 代表例の画像（多い順に最大 24 件。左右に 2 つの選択肢を並べる）
{
  const INK: Rgba = [32, 41, 49, 255];
  const GRAY: Rgba = [96, 109, 119, 255];
  const top = all.slice(0, 24);
  const rowH = (f: Finding) => (f.area.startsWith("顔") ? FACE_H * 3 : CAR_H * 2) + 44;
  const width = 16 * 2 + Math.max(FACE_W * 3 * 2 + 16, CAR_W * 2 * 2 + 16);
  const height = 16 * 2 + 28 + top.reduce((a, f) => a + rowH(f) + 12, 0);
  const s = new Sheet(width, Math.max(height, 80));
  s.text(`見分けにくい組み合わせの代表例（多い順、しきい値 ${THRESHOLD} ドット未満）`, 16, 16, INK);
  let y = 16 + 28;
  top.forEach((f, i) => {
    s.text(`${i + 1}. ${f.area} ${f.partLabel}: 「${f.a.label}」と「${f.b.label}」 ${f.count}/${f.of}`, 16, y, INK);
    s.text(`違うドット ${f.min}〜${f.max}。条件: ${f.when.join("、") || "限定なし"}`.slice(0, 90), 16, y + 18, GRAY);
    const imgs: IndexedImage[] = [f.a, f.b].map((c) => {
      const sel = { ...f.sample, [f.part]: c.id };
      if (f.area.startsWith("顔")) return renderFace({ ...base, face: sel as TrainDesign["face"] });
      const d = { ...base, side: sel as TrainDesign["side"] };
      return renderCar(d, f.view === 0 ? "lead" : "middle", { panto: true });
    });
    const sc = f.area.startsWith("顔") ? 3 : 2;
    imgs.forEach((im, k) => s.indexed(im, TRAIN_PALETTE, 16 + k * (im.width * sc + 16), y + 40, sc));
    y += rowH(f) + 12;
  });
  s.save(path.join(OUT, "parts-audit.png"));
}

console.log(`見分けにくいペア ${all.length} 種類（顔 ${faceFindings.length}、側面 ${sideFindings.length}）`);
for (const f of all) console.log(`  ${f.area} ${f.partLabel}: ${f.a.label} / ${f.b.label}  ${f.count}/${f.of}  差 ${f.min}〜${f.max}`);
console.log(`ライトが小さくなる ${shrunk}、尾灯が出ない ${noTail}`);
console.log(`書き出し先: ${path.relative(ROOT, OUT)}/parts-audit.md, parts-audit.png`);
