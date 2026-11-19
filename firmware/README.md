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

すべて `Authorization: Bearer <PRINTER_TOKEN>` つき、HTTPS（既定でルート証明書を検証）。

1. Wi-Fi 接続後、NTP で時刻を合わせる。合うまでサーバーには接続しない（15 秒合わなければ黄色、`LAST_ERROR ntp_timeout`。その後もやり直し続ける）。
   - 注: このコア（Arduino-ESP32 2.0.17）の設定には証明書の日付の確認（`MBEDTLS_HAVE_TIME_DATE`）が無いように見える。時刻合わせは取り決めどおり行っているが、実機で必要かどうかは未確認。
2. 3 秒おきに `POST /api/printer/claim`。204 なら何もしない。200 なら `{ "jobId", "width": 384, "height" }`。
3. `GET /api/printer/jobs/<jobId>/rows?offset=<行>&count=<FETCH_ROWS>` で帯（既定 96 行 = 4608 バイト）を取得し、その帯を `GS v 0` で印刷する。これを最後の行まで繰り返す。接続は keep-alive で使い回す。
   - 帯の取得に失敗したら `FETCH_RETRIES` 回までやり直す（400 / 401 / 404 / 409 はやり直さない）。
   - それでもだめなら、そこまで刷った分はそのままにして（紙を送ってちぎれるようにする）失敗を報告する。先頭から刷り直さない。
4. 紙を `PRINTER_FEED_LINES` 行送り、`POST /api/printer/jobs/<jobId>/done` に `{"ok":true}` か `{"ok":false,"error":"<64 文字までの英数字と記号>"}`。
   - 届かなければ間隔を 2 倍ずつ空けて `DONE_RETRIES` 回まで送り直す。200 と 409 はどちらも受理済みとして扱う。
   - **注意**: 既定の設定（`PRINTER_USE_CTS 0`、`PRINTER_SYNC_AFTER_BAND 0`）では、プリンタからは何も読み返さない。`ok:true` は「全部の行をプリンタに送り終えた」という意味で、紙切れ・プリンタの電源断・速度の食い違いがあっても `ok:true` になる。

`error` の主な値: `rows_http_<コード>`、`rows_conn_<番号>`、`rows_bad_length_<長さ>`、`rows_read_timeout`、`rows_disconnected`、`wifi_lost`、`printer_busy_timeout`（CTS 使用時）、`printer_no_response` / `paper_out`（`PRINTER_SYNC_AFTER_BAND` 使用時）、`bad_job_size`。

証明書の検証を切りたいとき（非常用）は `config.h` の `TLS_VERIFY` を 0 にする。組み込んだルート証明書は `include/root_ca.h` の先頭に一覧がある。

## USB シリアルのコマンド（115200bps、1 行 1 コマンド、改行は LF か CRLF）

| コマンド | 動き | 返事 |
|---|---|---|
| `STATUS` | 状態を返す | `WIFI ...` / `SERVER ...` / `PRINTER baud=... cts_g19=... use_cts=...` / `LAST_ERROR ...` の 4 行 |
| `TEST 1` / `TEST 2` | ボタンと同じテスト印刷 | `DONE` か `ERR <理由>` |
| `BAUD 115200` / `BAUD 9600` | プリンタに速度変更の命令（ESC ## SBDR）を今の速度で送り、こちらの速度も切り替えて、短いテスト印刷（64 行）をする | `BAUD <速度>` のあと `DONE` か `ERR <理由>` |
| `BAUD LOCAL 115200` / `BAUD LOCAL 9600` | **こちら側の速度だけ**切り替える（プリンタには送らない）。速度が食い違ったときの復旧用 | `BAUD LOCAL <速度>` |
| `BAUD ?` | プリンタに速度を問い合わせる（GS g 7） | `BAUD local=<こちらの速度> printer=<応答の文字列 か no_response>` |
| `PAPER` | 紙の状態を問い合わせる（DLE EOT 2、DLE EOT 4、GS r 1） | `PAPER raw dle_eot2=0x.. dle_eot4=0x.. gs_r1=0x..`（応答なしは `none`）のあと、`PAPER ok` / `PAPER out` / `PAPER ok near_end` / `PAPER unknown` / `PAPER 未対応 (no_response)` |
| `PRINT <高さ>` | PC から生データを受け取って印刷する（下記） | `READY <バイト数>` を帯ごとに、最後に `DONE` か `ERR <理由>` |
| `HELP` | コマンド一覧 | 1 行 |

サーバーとの通信中（接続の待ち・帯の取得・印刷・`done` の送り直し）は処理が止まるので、その間のボタンと USB コマンドは受け付けが遅れる（短押しは取りこぼすことがある）。

ほかに、起動時や動作中に `[boot]`、`[wifi]`、`[job]`、`[done]`、`[error]` などで始まるログ行が出る。PC 側のプログラムはこれらを読み飛ばすこと。

### `PRINT <高さ>` の手順

データは 1 行 48 バイト（384 ドット）、左端が最上位ビット、1 が黒、上の行から順（サーバーの `rows` と同じ形式）。高さは 1〜`MAX_JOB_HEIGHT`（既定 4000）。

1. PC → `PRINT 2200\n`
2. ATOM → `READY <n>\n`（n = その帯のバイト数。既定では 4608 = 96 行。最後の帯は残りの分）
3. PC → ちょうど n バイトの生データを送る
4. 2〜3 を繰り返す。全部の行を受け取ると ATOM → `DONE\n`
5. 途中で `USB_READ_TIMEOUT_MS`（既定 15 秒）データが来なければ `ERR usb_timeout`。送りかけのデータは捨てられ、プリンタは初期化し直される。

`READY` を待たずに次の帯を送ると、受信バッファ（1 帯 + 256 バイト）があふれる可能性がある。

## 実機で最初に確かめる手順

secrets.h なしのビルドで 1〜4 を確かめ、最後に secrets.h を入れて 5 を確かめる。シリアルモニタを開いておく。

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
5. **サーバーからの印刷**: secrets.h を書いて書き込み、LED が緑になるのを確かめてから、画面から印刷を申し込む。印刷後に管理画面で `done` になっているか確かめる。印刷中に Wi-Fi を切って `failed` になるかも確かめる。

## PC 上のテスト

機器に依存しない部分（`GS v 0` ヘッダ、帯分割、ボーレート命令、状態の読み取り、テストパターン、コマンドの読み取り、claim の JSON 読み取り、error 文字列）を PC で確かめる。

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
