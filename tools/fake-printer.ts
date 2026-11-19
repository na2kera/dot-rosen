// プリンタ（ATOM Lite）の代わり。claim → rows（小分け）→ done を回し、受け取った画像を PNG に保存する。
//   PRINTER_TOKEN=... node tools/run.mjs tools/fake-printer.ts [--url http://127.0.0.1:5182] [--once]
//     [--interval 3000] [--rows 48] [--fail <理由>] [--no-done] [--out tools/out/printed]
// --once: 待ちが無くなったら終わる（無ければ 3 秒おきに問い合わせ続ける）
// --fail: 完了ではなく失敗として報告する / --no-done: 報告しない（時間切れの確認用）
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/paths.ts";
import { rasterToPng, ROW_BYTES } from "./lib/raster-png.ts";

function opt(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const base = opt("url", "http://127.0.0.1:5182").replace(/\/$/, "");
const token = opt("token", process.env.PRINTER_TOKEN ?? "");
const interval = Number(opt("interval", "3000"));
const step = Number(opt("rows", "48"));
const failReason = opt("fail", "");
const outDir = path.resolve(ROOT, opt("out", "tools/out/printed"));
if (!token) {
  console.error("PRINTER_TOKEN（環境変数）か --token を指定してください");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}` };

async function printOne(): Promise<boolean> {
  const res = await fetch(`${base}/api/printer/claim`, { method: "POST", headers });
  if (res.status === 204) return false;
  if (res.status !== 200) throw new Error(`claim: ${res.status} ${await res.text()}`);
  const job = (await res.json()) as { jobId: number; width: number; height: number };
  console.log(`[claim] job ${job.jobId}（${job.width} × ${job.height}）`);
  const raster = new Uint8Array(job.height * ROW_BYTES);
  for (let off = 0; off < job.height; off += step) {
    const n = Math.min(step, job.height - off);
    const r = await fetch(`${base}/api/printer/jobs/${job.jobId}/rows?offset=${off}&count=${n}`, { headers });
    if (r.status !== 200) throw new Error(`rows ${off}+${n}: ${r.status} ${await r.text()}`);
    const len = Number(r.headers.get("Content-Length"));
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length !== n * ROW_BYTES || len !== bytes.length) throw new Error(`rows ${off}+${n}: 長さが違う（${bytes.length}、Content-Length ${len}）`);
    raster.set(bytes, off * ROW_BYTES);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `job-${job.jobId}.png`);
  fs.writeFileSync(file, rasterToPng(raster));
  fs.writeFileSync(file.replace(/\.png$/, ".bin"), raster);
  console.log(`[rows] ${job.height} 行を ${step} 行ずつ受け取り、${path.relative(ROOT, file)} に保存`);
  if (flag("no-done")) return true;
  const body = failReason ? { ok: false, error: failReason } : { ok: true };
  const d = await fetch(`${base}/api/printer/jobs/${job.jobId}/done`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(`[done] ${JSON.stringify(body)} → ${d.status} ${await d.text()}`);
  return true;
}

for (;;) {
  let printed = false;
  try {
    printed = await printOne();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    if (flag("once")) process.exit(1);
  }
  if (!printed) {
    if (flag("once")) break;
    await new Promise((r) => setTimeout(r, interval));
  }
}
