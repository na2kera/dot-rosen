// 会場の QR コードを PNG にして保存する（ブラウザでだけ動く）。
import { QUIET, qrMatrix } from "./qr.ts";

/**
 * 保存用の PNG（白地に黒、1マス cell px の整数倍、余白 4 マス）。下に caption を書く。
 * ブラウザでだけ動く。
 */
export async function qrPng(text: string, caption: string, cell = 16): Promise<Blob> {
  const m = qrMatrix(text);
  const side = (m.size + QUIET * 2) * cell;
  const capH = caption ? 64 : 0;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side + capH;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas が使えません");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000000";
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) if (m.dark[y * m.size + x]) g.fillRect((x + QUIET) * cell, (y + QUIET) * cell, cell, cell);
  if (caption) {
    // 画面と同じフォントが読めていればそれで、なければ等幅で
    g.font = `32px "DotGothic16", monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(caption, side / 2, side + capH / 2 - cell,side - cell * 2);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG を作れません"))), "image/png"));
}

/** Blob をファイルとして保存させる */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
