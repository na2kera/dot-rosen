// 調整用の定数。実機で確かめながらここを書き換える。
#pragma once

// ===== サーバーへの問い合わせ（docs/api.md「5. プリンタ用 API」） =====
// 1: 自動で claim する（既定）。0: しない。USB の CLAIM ON / CLAIM OFF でも切り替えられる
// （電源を切るとここの値に戻る）。未送信の完了報告は claim の入・切に関係なく送り直す
#define AUTO_CLAIM 1
// 問い合わせの間隔（docs/api.md 5 の末尾）。サーバーの無料枠（1 日 10 万リクエスト）の節約のため、
// 最後に印刷を受け取ってから（起動直後は起動から）POLL_IDLE_AFTER_MS の間印刷が無ければ
// POLL_INTERVAL_IDLE_MS に延ばす。印刷を受け取るか本体ボタンを押すと POLL_INTERVAL_MS に戻す。
#define POLL_INTERVAL_MS 3000          // 通常の claim の間隔。完了報告の送り直しは常にこの間隔
#define POLL_INTERVAL_IDLE_MS 10000    // 印刷が無い間の claim の間隔
#define POLL_IDLE_AFTER_MS 120000      // この時間印刷が無ければ間隔を延ばす（2 分）
#define HTTP_CONNECT_TIMEOUT_MS 10000
#define HTTP_TIMEOUT_MS 15000          // 応答の待ち時間・本文の読み取りの待ち時間
#define TLS_HANDSHAKE_TIMEOUT_S 10     // TLS ハンドシェイクの待ち時間（秒）
#define FETCH_ROWS 96                  // 1 回の rows 取得の行数 = 1 回の GS v 0 の行数（1〜240）
#define FETCH_RETRIES 3                // 帯の取得の失敗時に、やり直す回数（初回を除く）
#define FETCH_RETRY_DELAY_MS 1500      // やり直しの間隔（回数ぶん伸ばす）
#define FETCH_TOTAL_TIMEOUT_MS 90000   // 1 つの帯の取得（やり直しを含む）にかけてよい時間の上限
#define MAX_JOB_HEIGHT 3200            // これを超える高さの印刷は受け付けない（claim の検査）
#define CLAIM_BODY_MAX 256             // claim の応答本文の上限（バイト）
#define DONE_BODY_MAX 512              // done の応答本文を読み切る上限（超えたら接続を閉じる）

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
// これ以上受信できない状態が続いたら、その帯で印刷を失敗として打ち切る（error: printer_busy）
#define PRINTER_CTS_TIMEOUT_MS 10000
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

// 縦の倍率（%、100〜200）。紙送りが足りず縦に縮んで刷れるときに、プリンタへ送る行を
// 水増しして補正する（例: 113 なら 100 行を 113 行にして送る）。100 なら補正しない（従来どおり）。
// USB の VSCALE コマンドで変えると本体の不揮発メモリに保存され、そちらが優先される。
// 指定の 12V のアダプタで正しく刷れるなら 100 に戻す（README「縦の倍率」）
#define PRINTER_VSCALE_PERCENT 100

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
#define USB_RESYNC_QUIET_MS 1000       // PRINT の失敗後、入力がこの時間途切れるまで読み捨てる
#define USB_LINE_MAX 64
