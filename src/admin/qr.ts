// 会場の QR コード（画面表示用の SVG のパス。保存用の PNG は qr-png.ts）。マスは shared/card/qr.ts の qrMatrix を使う。
import { qrMatrix, type QrMatrix } from "../../shared/card/qr.ts";

/** 周りの余白（マス数）。QR コードの決まりは 4 マス */
export const QUIET = 4;

export { qrMatrix };

/** 黒のマスを1つのパスにする（横に続くマスはまとめる）。座標は余白込みのマス単位 */
export function qrPath(m: QrMatrix, quiet = QUIET): string {
  let d = "";
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.dark[y * m.size + x]) {
        x++;
        continue;
      }
      let e = x + 1;
      while (e < m.size && m.dark[y * m.size + e]) e++;
      d += `M${x + quiet} ${y + quiet}h${e - x}v1h${x - e}z`;
      x = e;
    }
  }
  return d;
}
