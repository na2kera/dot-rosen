// 調整用の定数。実機で確かめながらここを書き換える。
#pragma once

// ===== サーバーへの問い合わせ（docs/api.md「5. プリンタ用 API」） =====
#define POLL_INTERVAL_MS 3000          // POST /api/printer/claim の間隔
#define HTTP_CONNECT_TIMEOUT_MS 10000
#define HTTP_TIMEOUT_MS 15000          // 応答の待ち時間・本文の読み取りの待ち時間
#define FETCH_ROWS 96                  // 1 回の rows 取得の行数 = 1 回の GS v 0 の行数（1〜240）
#define FETCH_RETRIES 3                // 帯の取得の失敗時に、やり直す回数（初回を除く）
#define FETCH_RETRY_DELAY_MS 1500      // やり直しの間隔（回数ぶん伸ばす）
#define MAX_JOB_HEIGHT 4000            // これを超える高さの印刷は受け付けない
#define DONE_RETRIES 5                 // done が届かないときに送り直す回数（初回を除く）
#define DONE_RETRY_DELAY_MS 2000       // 送り直しの間隔（2 倍ずつ伸ばす）

// ===== HTTPS =====
// 1: ルート証明書（include/root_ca.h）で検証する（既定）
// 0: 検証しない（setInsecure）。会場で証明書の問題が起きたときの非常用
#define TLS_VERIFY 1
// 証明書の検証の前に NTP で時刻を合わせる
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.google.com"
#define NTP_TIMEOUT_MS 15000
#define NTP_MIN_EPOCH 1735689600       // 2025-01-01。これより前なら時刻が合っていないとみなす

// ===== Wi-Fi =====
#define WIFI_RETRY_INTERVAL_MS 10000   // 切れたときに接続をやり直す間隔

// ===== プリンタとの UART =====
// ピンの根拠: data-src/ATOM-PRINTER/src/ATOM_PRINTER.h 33-34 行目
//   begin(HardwareSerial *serial = &Serial2, int baud = 9600, uint8_t RX = 33, uint8_t TX = 23, ...)
//   と ATOM_PRINTER.cpp 8 行目 _serial->begin(baud, SERIAL_8N1, RX, TX)。
// G19 (CTS) は公式ドキュメントのピン表（Atom G23/G33/G19 = TX/RX/CTS）にだけ書かれていて、
// 公式のコードでは使われていない。どちらの電圧が「受信できない」かは未確認。
#define PRINTER_PIN_RX 33
#define PRINTER_PIN_TX 23
#define PRINTER_PIN_CTS 19
#define PRINTER_BAUD_DEFAULT 9600      // 公式の既定（ATOM_PRINTER.h 33 行目、公式ドキュメント 9600bps 8N1）

// 起動時に 115200bps へ上げるか（0: 上げない＝既定、1: 上げる）。
// 命令は ESC ## SBDR（公式ドキュメントの "Set Baud Rate" と命令一覧 PDF 2.8）。
// 実機で確かめるまで動作は保証できないため、既定は 0。
#define PRINTER_BOOT_USE_115200 0
#define PRINTER_FAST_BAUD 115200
#define PRINTER_BAUD_SWITCH_WAIT_MS 200  // 変更命令を送ってから、こちらの速度を変えるまで

// ===== 受信が追いつかないときの待ち方 =====
// 1: G19 を見て、受信できない間は送るのを待つ。0: 見ない（既定。極性が未確認のため）
#define PRINTER_USE_CTS 0
// 受信できないときの G19 の電圧（HIGH / LOW）。未確認。STATUS で G19 の値が見える
#define PRINTER_CTS_BUSY_LEVEL HIGH
#define PRINTER_CTS_TIMEOUT_MS 10000   // これ以上受信できない状態が続いたら失敗
#define PRINTER_CHUNK_BYTES 48         // 1 回に送るバイト数（CTS を確かめる単位）
// 帯の中で、1 回（PRINTER_CHUNK_BYTES）送るごとに入れる待ち時間。0 なら待たない（既定）。
// 115200bps で帯の途中の印字が乱れるときに増やす（例: 2500 = 1 行ごとに約 2.5ms）
#define PRINTER_CHUNK_DELAY_US 0
// 帯を送り終えたあとの待ち時間 = PRINTER_BAND_DELAY_MS + 行数 x PRINTER_ROW_DELAY_US
// 印字速度 60mm/s（公式ドキュメント）= 約 480 行/秒 = 約 2.1ms/行 を目安にしている
#define PRINTER_ROW_DELAY_US 2500
#define PRINTER_BAND_DELAY_MS 0
// 1: 帯ごとに GS r 1（PDF 1.25。受信済みデータを処理してから返す）を送り、
//    応答が来るまで待つ。紙切れならそこで止める。K118 が応答するかは未確認なので既定 0
#define PRINTER_SYNC_AFTER_BAND 0
#define PRINTER_SYNC_TIMEOUT_MS 5000
#define PRINTER_STATUS_TIMEOUT_MS 500  // 状態問い合わせの応答待ち

// 印字濃度 ESC ## STDP n（PDF 2.10）。-1 なら送らない（既定）。
// PDF 内で範囲が 0〜39 と 0〜3 で食い違っているため未確認。
#define PRINTER_DENSITY -1

// 印刷後の紙送り（ちぎりやすい位置まで）。LF(0x0A) を送る回数。
// 根拠: ATOM_PRINTER.cpp 49-54 行目 newLine() が 0x0A を送っている。必要な量は実機で調整
#define PRINTER_FEED_LINES 4

// ===== LED（ATOM Lite の SK6812、G27） =====
#define LED_PIN 27
#define LED_BRIGHTNESS 24              // 0〜255。控えめに
#define LED_BLINK_MS 400
#define LED_FAIL_MS 4000               // 印刷の失敗を赤で出す時間

// ===== ボタン（ATOM Lite、G39） =====
#define BUTTON_PIN 39
#define BUTTON_DEBOUNCE_MS 60
#define BUTTON_LONG_MS 2000

// ===== USB シリアル =====
#define USB_BAUD 115200
#define USB_READ_TIMEOUT_MS 15000      // PRINT で 1 帯ぶんのデータを待つ時間
#define USB_LINE_MAX 64
