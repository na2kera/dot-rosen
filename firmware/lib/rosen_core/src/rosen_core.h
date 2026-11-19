// 機器に依存しない処理（PC 上のテストでも同じものをコンパイルする）。
// Arduino のヘッダは使わない。
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace rosen {

// 用紙の幅（ドット）と 1 行のバイト数。docs/api.md「4. プリンタ用 API」:
// 1 行 48 バイト、左端が最上位ビット、1 が黒。
constexpr uint16_t kWidthDots = 384;
constexpr uint16_t kRowBytes = kWidthDots / 8;  // 48

// ---------------------------------------------------------------------------
// GS v 0（ラスタービットマップ印刷）のヘッダ
//   1D 76 30 m xL xH yL yH d1...dk
//   xL + xH*256 = 横方向のバイト数、yL + yH*256 = 縦方向のドット数
// 根拠:
//   - data-src/ATOM-PRINTER/src/ATOM_PRINTER_CMD.h 23 行目
//       PRINTER_BMP_CMD[] = {0x1D, 0x76, 0x30, 0xff, 0xff, 0xff, 0xff, 0xff}
//   - data-src/ATOM-PRINTER/src/ATOM_PRINTER.cpp 115-131 行目 printBMP()
//       buffer[3]=mode, [4]=(xdot/8)&0xff, [5]=(xdot/8)>>8, [6]=ydot&0xff, [7]=ydot>>8
//   - 命令一覧 PDF ATOM_PRINTER_CMD_v1.06.pdf 1.41「GS v 0 m xL xH yL yH」(p.22)
//       m=0/48 が通常（200x200dpi）
// 公式 printBMP は使わない（データ配列の先頭にヘッダを上書きする・長さが uint16_t）。
// ---------------------------------------------------------------------------
constexpr size_t kRasterHeaderSize = 8;
void buildRasterHeader(uint8_t out[kRasterHeaderSize], uint16_t widthBytes,
                       uint16_t rows, uint8_t mode = 0);

// 帯分割: 残り行数と帯の最大行数から、次の帯の行数を返す。
uint16_t nextBandRows(uint32_t remainingRows, uint16_t maxBandRows);
// 全体の帯の数
uint32_t bandCount(uint32_t totalRows, uint16_t maxBandRows);

// ---------------------------------------------------------------------------
// ボーレート変更 ESC ## SBDR baudrate（baudrate は 4 バイト、リトルエンディアン）
//   1B 23 23 53 42 44 52 b0 b1 b2 b3
// 根拠:
//   - 公式ドキュメント https://docs.m5stack.com/en/atom/atom_printer の
//     "Set Baud Rate" 行: 0x1B,0x23,0x23,0x53,0x42,0x44,0x52,X
//     (9600:X=0x80,0x25,0x00,0x00) (115200:X=0x00,0xC2,0x01,0x00)
//   - 命令一覧 PDF 2.8「ESC ## SBDR 设置串口波特率」(p.30)
//       例: 115200 → 1B 23 23 53 42 44 52 00 C2 01 00
//   公式リポジトリ（ATOM_PRINTER_CMD.h）には無い。
//   変更がすぐ効くか・電源を切っても残るかは資料に書かれていない（未確認）。
// ---------------------------------------------------------------------------
constexpr size_t kBaudCmdSize = 11;
void buildBaudCmd(uint8_t out[kBaudCmdSize], uint32_t baud);

// 印字濃度 ESC ## STDP n（PDF 2.10, p.30。0〜39 と書かれているが、
// 5.2 GS g 1 では濃度 0〜3 と書かれており食い違う。未確認）
constexpr size_t kDensityCmdSize = 8;
void buildDensityCmd(uint8_t out[kDensityCmdSize], uint8_t n);

// ---------------------------------------------------------------------------
// 状態の読み取り（すべて命令一覧 PDF のみが根拠。K118 が実際に返すかは未確認）
//   DLE EOT n : 10 04 n (1<=n<=4)   PDF 1.40 (p.20-21) 実時間の状態
//   GS r 1    : 1D 72 01            PDF 1.25 (p.11)    紙センサーの状態
//                 ※ 受信済みのデータを処理し終えてから返す
// ---------------------------------------------------------------------------
struct PaperState {
  bool known;      // 判定できたか
  bool paperOut;   // 紙切れ
  bool nearEnd;    // 紙が残り少ない
  bool error;      // そのほかの異常ビット
};
// DLE EOT n の応答 1 バイトを解釈する。n=2: bit5 紙切れ, bit6 異常 / n=4: bit2-3 残り少,
// bit6 紙切れ, bit5 異常（PDF の表が重なっているため、この読み方は未確認）。固定ビット（bit1=1, bit4=1, bit0=0, bit7=0）が合わなければ known=false。
PaperState interpretDleEot(uint8_t n, uint8_t value);
// GS r 1 の応答: bit0-1 (0x03) 残り少、bit2-3 (0x0C) 紙切れ、bit4 / bit7 は 0 固定。
PaperState interpretGsR1(uint8_t value);

// ---------------------------------------------------------------------------
// テスト印刷の図柄（ファーム内で計算する）
// ---------------------------------------------------------------------------
enum class Pattern : uint8_t {
  Test1 = 1,  // 確認パターン（400 行）
  Test2 = 2,  // 高負荷パターン（黒 50/75/100% 各 64 行）
  Short = 3,  // BAUD 切り替え後の短いテスト（64 行）
};
uint16_t patternHeight(Pattern p);
// 1 行ぶん（48 バイト）を書き込む。y は 0 始まり。
void fillPatternRow(Pattern p, uint16_t y, uint8_t row[kRowBytes]);

// 8x8 ベイヤー配列によるディザ。percent は 0〜100。
bool ditherBlack(uint16_t x, uint16_t y, uint8_t percent);

// ---------------------------------------------------------------------------
// USB シリアルの行コマンド
// ---------------------------------------------------------------------------
enum class CmdType : uint8_t {
  Unknown,
  Empty,
  Status,     // STATUS
  Test,       // TEST 1 / TEST 2           arg = 番号
  Baud,       // BAUD 9600 / BAUD 115200   arg = 速度
  BaudLocal,  // BAUD LOCAL 9600 など      arg = 速度（プリンタへは送らない）
  BaudQuery,  // BAUD ?
  Paper,      // PAPER
  Print,      // PRINT <高さ>              arg = 高さ
  Help,       // HELP
};
struct Command {
  CmdType type;
  uint32_t arg;
};
// 前後の空白と改行を無視し、英字の大小は区別しない。
Command parseCommand(const char* line);

// ---------------------------------------------------------------------------
// サーバー（docs/api.md「5. プリンタ用 API」）
// ---------------------------------------------------------------------------
struct ClaimInfo {
  uint32_t jobId;
  uint32_t width;
  uint32_t height;
};
// POST /api/printer/claim の 200 応答 { "jobId": n, "width": 384, "height": n } を読む。
// 3 つとも数値で見つかれば true。JSON ライブラリは使わない簡易な読み取り。
bool parseClaimJson(const char* json, ClaimInfo& out);

// done の error 文字列を作る: 印字できる ASCII（0x21〜0x7E）以外は "_" に置き換え、
// " と \ も "_" にし、最大 maxLen 文字（API の上限は 64）にする。戻り値は書いた文字数。
size_t sanitizeErrorCode(const char* in, char* out, size_t outSize, size_t maxLen = 64);

// JSON 文字列の中身として安全な形にする（" と \ と制御文字）。
// 出力は必ず NUL で終わる。収まらない分は切り捨てる。戻り値は書いた文字数。
size_t jsonEscape(const char* in, char* out, size_t outSize);

// SERVER_URL の末尾の "/" を取り除いた長さを返す
size_t trimmedUrlLength(const char* url);

}  // namespace rosen
