// QR コードのマス（qrcode-generator を使う）。
import qrcode from "qrcode-generator";

export type QrMatrix = {
  /** 1辺のマス数 */
  size: number;
  /** size * size。1 が黒のマス（上の行から） */
  dark: Uint8Array;
};

/** URL を QR コードのマスにする。誤り訂正は M、型番は自動。URL は ASCII を想定（それ以外は UTF-8 にして入れる） */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  // 既定の変換は文字コードの下位 8 ビットしか使わないので、UTF-8 のバイト列を1バイト1文字にして渡す
  const bytes = new TextEncoder().encode(text);
  let latin1 = "";
  for (const b of bytes) latin1 += String.fromCharCode(b);
  qr.addData(latin1, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const dark = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark[r * size + c] = qr.isDark(r, c) ? 1 : 0;
  return { size, dark };
}
