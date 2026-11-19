# プリンタのファーム（ATOM Lite + ATOM Printer K118）

M5Stack ATOM Printer 感熱プリンタキット（K118）を、サーバーからの画像印刷用に動かすファーム。
PlatformIO（Arduino フレームワーク、`espressif32@6.12.0` = Arduino-ESP32 2.0.17）で作る。外部ライブラリは使わない。

## 配線と電源

- ATOM Lite はキットのプリンタ基板に差し込むだけ。ピンは公式ライブラリと同じ（`ATOM_PRINTER.h` の `begin()` の既定値）:
  - G23 → プリンタの RX（ATOM からの送信）
  - G33 ← プリンタの TX（ATOM への受信。状態問い合わせの応答に使う）
  - G19: 公式ドキュメントのピン表で CTS とされている。公式のコードでは使っていない。既定では見ない（`PRINTER_USE_CTS 0`）
- プリンタの電源は **DC 12V / 2.5A 以上**（5.5mm のプラグ）。アダプタはキットに付属していない。USB の電源だけでは印字できない。
- ATOM Lite の USB-C は書き込み・USB シリアル用。

## 準備と書き込み

1. `include/secrets.example.h` を `include/secrets.h` にコピーして値を書く（`secrets.h` は .gitignore 済み）。
   - `WIFI_SSID` / `WIFI_PASS`: 会場の Wi-Fi（テザリング・モバイルルーター）。`WIFI_SSID` が空なら Wi-Fi に接続しない
   - `SERVER_URL`: 例 `https://xxxx.workers.dev`（末尾の `/` は無くてよい）
   - `PRINTER_TOKEN`: Worker の秘密の値 `PRINTER_TOKEN` と同じ値
   - `secrets.h` が無いときは見本（ダミー値）でビルドされ、テスト印刷と USB シリアルだけ動く。
2. ビルド: `cd firmware && pio run`
3. 書き込み: `pio run -t upload`（ATOM Lite を USB でつなぐ）
4. シリアルモニタ: `pio device monitor`（115200bps）

調整用の定数は `include/config.h` にまとめてある（問い合わせ間隔、1 回の取得行数、待ち時間、ボーレート、CTS、証明書の検証、印字濃度、紙送り量など）。

## LED の色

| 状態 | 色 |
|---|---|
| 起動中・Wi-Fi 接続中 | 青の点滅 |
| 待機中（サーバーに届いている） | 緑 |
| 印刷中 | 白 |
| Wi-Fi 切断（Wi-Fi 未設定のときも） | 赤の点滅 |
| サーバーに届かない・認証エラー・時刻合わせの失敗 | 黄 |
| 印刷の失敗 | 赤（約 4 秒） |

## ボタン（本体の G39）

- 短押し: テスト印刷 1（400 行の確認パターン。左右端の線、1 ドット・2 ドットの縦線・横線・市松、黒 10%〜100% の段階、図形）
- 長押し（2 秒）: テスト印刷 2（黒 50%・75%・100% を各 64 行の高負荷パターン）
- 図柄はファーム内で計算している（`lib/rosen_core` の `fillPatternRow`）。

## サーバーとのやり取り（docs/api.md「5. プリンタ用 API」）

> **重要: 既定の設定ではプリンタが本当に印字できたかは確かめていない。**
> 既定（`PRINTER_USE_CTS 0`、`PRINTER_SYNC_AFTER_BAND 0`）では、プリンタからは何も読み返さない。`done` の `ok:true` は「全部の行をプリンタに送り終えた」という意味で、**紙切れ・プリンタの電源断・速度の食い違いがあっても `ok:true` を報告する**。その場合は管理画面から再印刷する。

すべて `Authorization: Bearer <PRINTER_TOKEN>` つき、HTTPS（既定でルート証明書を検証）。TLS のハンドシェイクは `TLS_HANDSHAKE_TIMEOUT_S`（10 秒）で打ち切る。

1. Wi-Fi 接続後、NTP で時刻を合わせる。合うまでサーバーには接続しない（15 秒合わなければ黄色、`LAST_ERROR ntp_timeout`。その後もやり直し続ける）。待つ間もボタンと USB は動く。
   - 注（未検証）: このコア（Arduino-ESP32 2.0.17）の設定には `MBEDTLS_HAVE_TIME_DATE` が無く、**証明書の有効期間（日付）は検証されない可能性がある**。証明書の署名の検証は行う。時刻合わせは取り決めどおり行っている。
2. `POST /api/printer/claim` で印刷を取りに行く（`AUTO_CLAIM` / `CLAIM ON` のとき）。204 なら何もしない。
   - 間隔は通常 3 秒（`POLL_INTERVAL_MS`）。最後に印刷を受け取ってから（起動直後は起動から）2 分間（`POLL_IDLE_AFTER_MS`）印刷が無ければ 10 秒（`POLL_INTERVAL_IDLE_MS`）に延ばす。サーバーの無料枠（1 日 10 万リクエスト）を節約するため（docs/api.md 5 の末尾）。
   - 印刷を受け取ったとき（claim が 200）と、本体ボタンを押したとき（テスト印刷）は 3 秒に戻す。USB コマンドでは戻らない。
   - 未送信の完了報告がある間は、送り直しを 3 秒おきに行う（延ばさない）。
   - 今の間隔は `STATUS` の `POLL interval_ms=...` で見える。
   - 200 の本文は `CLAIM_BODY_MAX`（256 バイト）までのバッファに、Content-Length か chunked の終端まで読み切る。
   - JSON が閉じ括弧まであること、`jobId` / `width` / `height` が終端まで読める 0 以上の整数であること、`width` が 384、`height` が 1〜`MAX_JOB_HEIGHT`（3200）であることを確かめる。
   - どれかが欠けたら印刷しない。`jobId` が読めれば `done` に `{"ok":false,"error":"bad_claim"}` を報告する。`jobId` も読めなければ報告できないので、`LAST_ERROR claim_bad_no_job_...` を記録して次の周期へ。
3. `GET /api/printer/jobs/<jobId>/rows?offset=<行>&count=<FETCH_ROWS>` で帯（既定 96 行 = 4608 バイト）を取得し、その帯を `GS v 0` で印刷する。これを最後の行まで繰り返す。
   - 帯の取得に失敗したら `FETCH_RETRIES` 回までやり直す（400 / 401 / 404 / 409 はやり直さない）。1 つの帯にかける時間は、やり直しを含めて `FETCH_TOTAL_TIMEOUT_MS`（90 秒）まで。
   - それでもだめなら、そこまで刷った分はそのままにして（紙を送ってちぎれるようにする）失敗を報告する。先頭から刷り直さない。
4. 紙を `PRINTER_FEED_LINES` 行送り、`POST /api/printer/jobs/<jobId>/done` に `{"ok":true}` か `{"ok":false,"error":"<64 文字までの英数字と記号>"}`。
   - 200 は受理。409 は「サーバー側ではすでに別の結果で終わっている」で、送り直しはやめるが `LAST_ERROR done_conflict_job_<id>` を記録する（STATUS で見える）。
   - それ以外（通信失敗を含む）は、結果を **未送信の完了報告** として持ち続け、問い合わせの周期（3 秒）ごとに 200 か 409 が返るまで送り直す。その間は次の `claim` をしない。Wi-Fi が切れても保持し、つながり直したら送り直す。電源を切ると消える（そのときサーバーは 5 分後に時間切れとして扱う）。送り直しの待ちの間もボタンと USB コマンドは動く。

接続は keep-alive で使い回す。ただし応答の本文を最後まで読み切れたときだけで、読み切れない場合（エラー応答、長さ不明、時間切れなど）は接続を閉じる。

`error` の主な値: `bad_claim`、`rows_http_<コード>`、`rows_conn_<番号>`、`rows_bad_length_<長さ>`、`rows_read_timeout`、`rows_disconnected`、`wifi_lost`（やり直しの時間切れでは末尾に `_gave_up`）、`printer_busy`（CTS 使用時。その帯で打ち切ってプリンタを初期化し直す）、`printer_no_response` / `paper_out`（`PRINTER_SYNC_AFTER_BAND` 使用時）。

証明書の検証を切りたいとき（非常用）は `config.h` の `TLS_VERIFY` を 0 にする。組み込んだルート証明書は `include/root_ca.h` の先頭に一覧がある。

## USB シリアルのコマンド（115200bps、1 行 1 コマンド、改行は LF か CRLF）

| コマンド | 動き | 返事 |
|---|---|---|
| `STATUS` | 状態を返す | 下記の 11 行 |
| `TEST 1` / `TEST 2` | ボタンと同じテスト印刷 | `DONE` か `ERR <理由>` |
| `BAUD 115200` / `BAUD 9600` | プリンタに速度変更の命令（ESC ## SBDR）を今の速度で送り、こちらの速度も切り替えて、短いテスト印刷（64 行）をする | `BAUD <速度>` のあと `DONE` か `ERR <理由>` |
| `BAUD LOCAL 115200` / `BAUD LOCAL 9600` | **こちら側の速度だけ**切り替える（プリンタには送らない）。速度が食い違ったときの復旧用 | `BAUD LOCAL <速度>` |
| `BAUD ?` | プリンタに速度を問い合わせる（GS g 7） | `BAUD local=<こちらの速度> printer=<応答の文字列 か no_response>` |
| `PAPER` | 紙の状態を問い合わせる（DLE EOT 2、DLE EOT 4、GS r 1） | `PAPER raw dle_eot2=0x.. dle_eot4=0x.. gs_r1=0x..`（応答なしは `none`）のあと、`PAPER ok` / `PAPER out` / `PAPER ok near_end` / `PAPER unknown` / `PAPER 未対応 (no_response)` |
| `PRINT <高さ>` | PC から生データを受け取って印刷する（下記） | `READY <バイト数>` を帯ごとに、最後に `DONE`、失敗なら `ERR <理由>` のあと `RESYNC` |
| `CLAIM ON` / `CLAIM OFF` | 自動 claim の入・切（電源を切ると `AUTO_CLAIM` の値に戻る）。未送信の完了報告の送り直しは入・切に関係なく続ける | `CLAIM ON` / `CLAIM OFF` |
| `HELP` | コマンド一覧 | 1 行 |

`STATUS` の返事（1 行ずつ）:

```
WIFI connected ssid=... ip=... rssi=-55      （または disconnected / not_configured）
SERVER ok http=204 url=... tls=verify auto_claim=on
NTP synced                                    （または not_synced）
POLL interval_ms=3000 idle_ms=4512            （今の問い合わせ間隔と、最後に印刷を受け取って・ボタンを押して・起動してからの経過）
JOB id=42 rows_sent=960 height=1800 printing=0   （今の、または最後の印刷。rows_sent は USB / テスト印刷でも更新）
PENDING_DONE none                             （または job=42 ok=0 error=rows_http_500 attempts=3）
PRINTER baud=9600 cts_g19=0 use_cts=0 cts_busy_level=1 sync_after_band=0
CTS_LAST_PRINT busy_count=0 busy_ms=0         （最後の印刷中に G19 が busy 側になった回数と累積時間。設定に関係なく記録）
HEAP free=... max_block=...                   （空きヒープと最大の空きブロック）
RESET reason=1 uptime_s=...                   （esp_reset_reason() の値。1 = 電源投入、4 = ソフトウェア、5 = 例外/パニック、6/7 = ウォッチドッグ など）
LAST_ERROR ...
```

サーバーとの 1 回の通信中（接続の待ち・帯の取得・印刷）は処理が止まるので、その間のボタンと USB コマンドは受け付けが遅れる（短押しは取りこぼすことがある）。`CLAIM OFF` の間、LED はサーバーとの最後の状態のまま変わらない。

ほかに、起動時や動作中に `[boot]`、`[wifi]`、`[ntp]`、`[job]`、`[rows]`、`[done]`、`[error]`、`[button]` で始まるログ行が出る。PC 側のプログラムはこれらを読み飛ばすこと。

### `PRINT <高さ>` の手順

データは 1 行 48 バイト（384 ドット）、左端が最上位ビット、1 が黒、上の行から順（サーバーの `rows` と同じ形式）。高さは 1〜`MAX_JOB_HEIGHT`（既定 3200）。

1. PC → `PRINT 2200\n`
2. ATOM → `READY <n>\n`（n = その帯のバイト数。既定では 4608 = 96 行。最後の帯は残りの分）
3. PC → ちょうど n バイトの生データを送る
4. 2〜3 を繰り返す。全部の行を受け取ると ATOM → `DONE\n`
5. 途中で `USB_READ_TIMEOUT_MS`（既定 15 秒）データが来なければ `ERR usb_timeout`。プリンタは初期化し直される。
6. **失敗後の再同期**: `ERR ...` を返したあと、ATOM は入力が `USB_RESYNC_QUIET_MS`（1 秒）途切れるまで受信データを読み捨てる。その間に届いたものは行コマンドとしても解釈しない。読み捨てが終わると `RESYNC\n` を返す。PC 側は `ERR` を受けたら送信を止め、`RESYNC` を待ってから次のコマンドを送る。

`READY` を待たずに次の帯を送ると、受信バッファ（1 帯 + 256 バイト）があふれる可能性がある。

## 実機で最初に確かめる手順

テスト印刷が出ることを確かめるまでは、サーバーの印刷を取りに行かないようにする。**secrets.h を作らずに書き込む**（または secrets.h の `SERVER_URL` を入れない／`AUTO_CLAIM` を 0 にする）か、起動直後に `CLAIM OFF` を送る。これで 1〜4 を確かめ、最後に 5 を確かめる。シリアルモニタを開いておく。

1. **テスト印刷 1**: 本体ボタンを短く押す（または `TEST 1`）。
   - 左右端の線が両方出ているか（384 ドット幅が収まっているか）、1 ドットの線・市松がつぶれていないか、黒 10%〜100% の段階が分かれているか、図形がゆがんでいないかを見る。
   - 96 行ごとの帯のつなぎ目（y=96, 192, 288 付近）に白い筋や段差が無いか見る。
2. **115200bps**: `BAUD 115200` を送り、続く短いテスト印刷が乱れないか見る。続けて `TEST 1`。
   - 乱れたり何も出ないときは `BAUD LOCAL 9600` で戻して `TEST 1` が出るか確かめる。出なければ `BAUD LOCAL 115200` にしてから `BAUD 9600` を送る（速度の設定がプリンタに残る場合の復旧）。
   - 電源を入れ直したあと、プリンタがどちらの速度で起きるか（`BAUD ?` か `TEST 1` で）確かめる。
   - 問題なければ `config.h` の `PRINTER_BOOT_USE_115200` を 1 にする。
3. **テスト印刷 2 を 5 回続けて**: 長押し（2 秒）を 5 回、1 枚ずつ終わるのを待って繰り返す。かすれ・途中で止まる・紙送りの乱れ・プリンタの過熱停止が無いか見る。
   - 乱れるときは、帯の途中で乱れるなら `PRINTER_CHUNK_DELAY_US`（1 行ごとの待ち）を、帯の切れ目で乱れるなら `PRINTER_ROW_DELAY_US`（帯を送ったあとの待ち）を増やす。`FETCH_ROWS` を小さくするのも効く。`STATUS` の `cts_g19` が印刷中に変わるか見て、使えそうなら `PRINTER_USE_CTS` と `PRINTER_CTS_BUSY_LEVEL` を設定する。
4. **紙切れ**: 紙がある状態で `PAPER`、紙を外して `PAPER`。`raw` の値が変わるか、`PAPER out` になるかを記録する。応答が無ければ紙切れは検知できない。
   - `gs_r1` が応答し、紙を外すと `PAPER out` になるなら、`config.h` の `PRINTER_SYNC_AFTER_BAND` を 1 にする。帯ごとに処理の完了を待ち、紙切れなら `done` に `ok:false`（`paper_out`）を送るようになる。
5. **サーバーからの印刷**: secrets.h を書いて書き込み（`CLAIM OFF` にしていたなら `CLAIM ON`）、LED が緑になるのを確かめてから、画面から印刷を申し込む。印刷後に管理画面で `done` になっているか確かめる。
   - 印刷中に Wi-Fi を切り、`failed` になるか、`STATUS` の `PENDING_DONE` に結果が残り、つながり直したあとに送られて `none` に戻るかを確かめる。

## PC 上のテスト

機器に依存しない部分（`GS v 0` ヘッダ、帯分割、ボーレート命令、状態の読み取り、テストパターン、コマンドの読み取り、claim の応答の検査、HTTP 本文の終端の判定（Content-Length / chunked）、done の応答の分類と未送信の完了報告の予約、rows のやり直しの判定、CTS の busy の集計、error 文字列）を PC で確かめる。

```sh
cd firmware
c++ -std=c++17 -Wall -Wextra -I lib/rosen_core/src \
  lib/rosen_core/src/rosen_core.cpp test/host/test_core.cpp -o .pio/test_core
.pio/test_core            # 引数にディレクトリを渡すと test1.pbm などを書き出す
```

このマシンでは既定の SDK でリンクに失敗したため、`-isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` を足して実行した。

## 命令の根拠

| 命令 | バイト列 | 根拠 |
|---|---|---|
| 初期化 ESC @ | `1B 40` | 公式リポジトリ `src/ATOM_PRINTER_CMD.h` 2 行目 |
| ラスター印刷 GS v 0 | `1D 76 30 m xL xH yL yH` | `ATOM_PRINTER_CMD.h` 23 行目、`ATOM_PRINTER.cpp` 115-131 行目、命令一覧 PDF 1.41 |
| 改行（紙送り） | `0A` | `ATOM_PRINTER.cpp` 49-54 行目 `newLine()` |
| ボーレート変更 ESC ## SBDR | `1B 23 23 53 42 44 52` + 4 バイト（リトルエンディアン） | 公式ドキュメントの "Set Baud Rate"、命令一覧 PDF 2.8。公式リポジトリには無い |
| 速度の問い合わせ GS g 7 | `1D 67 37` | 命令一覧 PDF 5.8 |
| 実時間の状態 DLE EOT n | `10 04 n` | 命令一覧 PDF 1.40 |
| 紙センサーの状態 GS r 1 | `1D 72 01` | 命令一覧 PDF 1.25 |
| 印字濃度 ESC ## STDP n | `1B 23 23 53 54 44 50 n` | 命令一覧 PDF 2.10（範囲の記述が食い違うので既定では送らない） |

- 公式リポジトリ: https://github.com/m5stack/ATOM-PRINTER （確認したコミット fbbd15a）
- 公式ドキュメント: https://docs.m5stack.com/en/atom/atom_printer
- 命令一覧 PDF: https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/docs/datasheet/atombase/atom_pritner/ATOM_PRINTER_CMD_v1.06.pdf （公式ドキュメントからリンク。汎用の感熱プリンタ向けの命令集で、K118 がすべてに応じるかは未確認）

公式ライブラリの `printBMP` は使っていない（データ配列の先頭 8 バイトにヘッダを上書きする、長さの計算が 16 ビット）。`GS v 0` は自前で組み立てている。
