# API とデータの取り決め

画面、Worker、プリンタのファームが共通で従う取り決め。仕様の背景は `docs/spec.md`。
2026-11-20: Codex の設計レビューを受けて改訂（印刷の取り出しを原子的に、プリンタ側は小分け取得に、冪等性と上限を追加）。

## 0. 用語

| 用語 | 意味 |
|---|---|
| クライアント | 来場者のブラウザ。`clientId`（画面が最初に作って端末内に保存するランダムな文字列）で区別する |
| プリンタ | ATOM Lite。`PRINTER_TOKEN` で認証する |
| 会場コード | 会場に掲示する QR コードに入れる文字列。印刷できる人を絞る |

## 1. 路線データ

画面とサーバーでやり取りし、サーバーに保存する唯一のデータ。画像は保存しない。

```ts
type RouteData = {
  v: 1;
  name: string;        // 路線名。1〜12文字（コードポイント数）。制御文字と改行は不可
  symbol: string;      // 路線記号。英大文字1〜2文字
  lineColor: ColorId;  // 12色のいずれか
  stations: string[];  // 駅 ID。2〜30件。重複不可
  loop: boolean;       // 環状線なら true（stations に始発駅を2回入れない）。3駅以上のときだけ
  train: TrainDesign;  // shared/train の型
};
```

- 検査と正規化は `shared/route` の `parseRouteData` に一本化し、画面とサーバーで同じものを使う。画面は保存前に同じ検査を通し、通らない理由を表示する。
- 正規化: 路線名は前後の空白を除く。路線記号は大文字にする。余計なキーは捨てる。
- 未知のパーツ ID・色 ID・版（`v`）は拒否する。
- 余計なキーを捨てて正規化したあとの JSON が 8KB を超えるものは拒否する（余計なキーの中身は読まない。本文全体の上限は「2. 入力と応答の共通の決まり」の 16KB）。
- 駅 ID は英数字と `_` `-` の 1〜32 文字で、実在するものだけ。
- 路線名は、制御文字・書式の文字（双方向制御、ゼロ幅など）・異体字セレクタ・私用領域・孤立サロゲートを拒否する。確認は前後の空白を除く前に行う。

## 2. 入力と応答の共通の決まり

- 本文は JSON（`Content-Type: application/json`）。本文は解析する前に大きさを確かめ、16KB を超えたら 413。
- エラーは `{ "error": "<コード>" }`。

| ステータス | 使いどころ |
|---|---|
| 400 | 形式や値が不正（`invalid`） |
| 401 | プリンタ・管理の認証がない、違う（`unauthorized`） |
| 403 | 編集の鍵が違う（`forbidden`）、会場コードが違う（`invalid_code`） |
| 404 | 無い、非公開（`not_found`） |
| 409 | 今の状態ではできない（`conflict`）、回数上限（`limit_reached`）、受付停止中（`not_accepting`）、待ちが満杯（`queue_full`）、保存されている内容が申し込みの版と違う（`stale`） |
| 410 | 期限切れ（`expired`） |
| 413 | 本文が大きすぎる（`too_large`） |
| 429 | 回数制限（`rate_limited`）。`Retry-After` を付ける |
| 500 | 予期しない失敗（`internal`）。詳細は応答に出さない |

- 路線データが検査に通らないときの 400 には、理由のコードを `reason` として添える（`{ "error": "invalid", "reason": "name_too_long" }` など。画面での案内に使う）。
- すべての API 応答に `Cache-Control: no-store`。
- 秘密の値（鍵、トークン、パスワード、会場コード）をログに出さない。
- ID と鍵は暗号用の乱数で作る。路線 ID は 96 ビット以上、編集の鍵は 128 ビット以上、会場コードは 40 ビット以上（紛らわしい文字を除いた英数字）。
- 秘密の値の照合は、時間差の出にくい比較で行う。

### 回数制限（IP ごと）

D1 の小さな表で数える。会場では同じ回線を多人数で共有することがあるので、厳しくしすぎない。

| 対象 | 上限 |
|---|---|
| 路線の作成 | 1時間に 120 回 |
| 会場コードの確認と印刷の申し込みで、コードが違った回数 | 10分に 30 回 |
| 管理ログインの失敗 | 10分に 10 回 |

## 3. データベース（D1）

| 表 | 主な列 |
|---|---|
| `routes` | `id`、`edit_key_hash`（一意）、`data`（RouteData の JSON）、`created_at`、`updated_at`、`expires_at`、`hidden` |
| `print_jobs` | `id`（連番）、`route_id`、`client_id`、`request_id`、`event_code`、`status`、`issue_no`、`sort_key`、`snapshot`（申し込み時点の RouteData と印字する日付・URL の JSON）、`raster`（白黒の生データ。終わったら NULL）、`height`、`created_at`、`claimed_at`、`heartbeat_at`、`finished_at`、`error` |
| `print_grants` | `client_id`、`event_code`、`extra`（追加で許可した回数） |
| `settings` | `key`、`value`（`event_code`、`accepting`、`printer_last_seen`、`issue_counter`） |
| `rate_limits` | `key`（種類と IP）、`window_start`、`count` |

- `print_jobs` には `(client_id, request_id)` の一意制約を付ける。
- `rate_limits` の時間窓は新しい方向にしか進めない。古い時間窓の時刻を持った遅いリクエストが来ても、今の窓の回数を消さない（その 1 回は今の窓に数える）。
- `status`: `queued` → `printing` → `done` / `failed`、または `queued` → `canceled`。
  - `failed` の `error` が `timeout` のものは「結果が分からない」印刷（紙は出たが報告が届かなかった可能性がある）。自動では刷り直さず、主催者が管理画面で判断する。
- `sort_key`: 待ちの順番。通常は `id` と同じ値、再印刷は待ちの先頭より小さい値。
- 時刻は UTC の ISO 8601 文字列。
- 有効期限は最初の保存から `EXPIRY_DAYS` 日（既定 30。Worker の設定値）。上書きしても延びない。
- 1日1回の定期実行（`scheduled`）で消すもの: 期限切れの路線とその印刷記録、終わってから 30 日たった印刷記録、古い `rate_limits`。
  - ただし、`queued` か `printing` の印刷が残っている路線は、その印刷が終わるまで消さない（受け付けた印刷は最後まで刷る）。公開 API は `expires_at` で期限を判定するので、消すのが遅れても期限切れの路線は 410 のまま。
- 印刷画像の高さは最大 3,200 行（約 154KB）。超える画像は作らない。

## 4. 公開 API（来場者の画面から）

| メソッドとパス | 内容 |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/config` | 今のサーバーの設定値 `{ card: { monoSet, sideLayout }, expiryDays }`。認証なし |
| `POST /api/routes` | 本文 `{ data, editKey }` → `{ id, expiresAt, rev }` |
| `GET /api/routes/:id` | `{ id, data, expiresAt, rev }`。無い・非公開は 404、期限切れは 410 |
| `PUT /api/routes/:id` | ヘッダ `X-Edit-Key`、本文 `{ data }` → `{ ok: true, expiresAt, rev }` |
| `DELETE /api/routes/:id` | ヘッダ `X-Edit-Key` → `{ ok: true }`。待ちの印刷も取り消す |
| `GET /api/event?code=...` | `{ valid, accepting }` |
| `POST /api/print` | 本文 `{ routeId, editKey, eventCode, clientId, requestId, rev }` → `{ jobId, issueNo, ahead, status, card: { monoSet, sideLayout }, rev, issuedOn }` |
| `GET /api/print/:jobId?clientId=...` | `{ status, ahead, issueNo }`。`clientId` が違えば 404 |

### サーバーの設定値（`GET /api/config`）

- 応答: `{ "card": { "monoSet": "light" | "bold", "sideLayout": "two-x1" | "lead-x2" | "two-x2-rotated" }, "expiryDays": number }`。値は `CARD_MONO_SET`・`CARD_SIDE_LAYOUT`・`EXPIRY_DAYS`（不正なら既定の bold・two-x1・30）。`Cache-Control: no-store`。
- 画面は起動時（データの読み込みと同じとき）に取り、印刷プレビュー（ステップ3の模様、ステップ4と路線ページの路線カード）をこの見た目で描く。カラー版は側面の置き方だけ合わせる。取れなければ既定の bold・two-x1 で描く（エラーにはしない）。

### 路線の保存

- **編集の鍵（`editKey`）は画面が作る。** 画面は鍵を作って端末に保存してから `POST` する。サーバーは SHA-256 だけを保存する。
- 同じ `editKey` で `POST` がもう一度来たら、新しく作らずに、その路線を上書きして同じ `id` を返す（応答を受け取りそこねて送り直しても、路線が増えない）。
- `PUT` と `DELETE` は、鍵が違えば 403、期限切れは 410、非公開は 404。
- 「1人1路線」は画面上の決まりで、サーバーは強制しない。
- **版の印（`rev`）はサーバーが作る。** 保存されている `data` の文字列（サーバーが検査して整えたあとの JSON）の SHA-256 を 16 進にした先頭 16 文字。列は増やさず、返すたびに計算する。同じ内容なら同じ印になる。
  - 画面は、保存の応答で受け取った `rev` を「保存ずみの内容」と一緒に端末に覚える。画面が自分で計算してはいけない（サーバーが整えた結果と画面の持つ形が同じとは限らない）。
  - 画面は、`PUT` を送る前に端末の保存状態を「結果不明」にし、成功の応答で確定する。応答を受け取りそこねた場合、前の内容を「保存ずみ」として扱わない（次の保存や印刷の前に必ず送り直す）。

### 印刷の申し込み

- 確かめる順: 回数制限 → 会場コード（違えば 403 `invalid_code`）→ 受付中か（409 `not_accepting`）→ 路線があり、期限内で、非公開でなく、`editKey` が合うか → 待ちが満杯でないか（`queued` が 30 件以上なら 409 `queue_full`）→ このクライアントの回数上限（409 `limit_reached`）。
- 回数上限: クライアントごと・会場コードごとに 1 + `print_grants.extra`。数えるのは `canceled` と `failed` 以外の印刷。会場コードを作り直すと、数え直しになる。
- **`requestId` は画面が押すたびに作るランダムな文字列。** 同じ `(clientId, requestId)` の申し込みがもう一度来たら、新しく作らずに元の印刷を返す。
- **申し込みには版の印（`rev`、16 桁の 16 進）が必須。** 無い・形が違えば 400。画面は「いま画面にある内容」を保存したときに受け取った `rev` を付ける。
  - 同じ `(clientId, requestId)` の印刷がまだ無いとき、保存されている路線の `rev` が申し込みの `rev` と違えば、印刷を作らず 409 `stale` を返す（回数を消費しない）。確かめる順では「路線があり…`editKey` が合うか」の直後。
  - 印刷の `snapshot` は、`rev` を確かめたのと同じ読み出しの路線データから作る。**新しく印刷が作られるのは、申し込みの `rev` と同じ内容のときだけ**（確かめたあとに上書きが来ても、刷られるのは確かめた内容）。
  - 応答の `rev` と `issuedOn`（「2026.11.20」の形）は、その印刷が実際に使った内容の印と発行日（`snapshot` に保存した値）。同じ `requestId` の再送で元の印刷を返すときは、申し込みの `rev` と違っていても 200 で返し、応答の `rev` は元の印刷のもの。
  - `snapshot` に `rev` や `issuedOn` が無い古い印刷を返すときは、その項目を `null` にする。画面は、`rev` が `null` の印刷を「今の内容の印刷」とも「前の内容の印刷」とも決めつけず、`issuedOn` が `null` なら端末の今日の日付（日本時間）を使う。
  - 画面の決まり:
    1. 申し込みの前に、いまの内容が保存ずみ（結果不明でない）であることを確かめ、そうでなければ先に保存する。進行中の保存があれば待つ。保存に失敗したら申し込まない。
    2. 申し込む前に、`requestId`・`rev`・内容の控えを端末に書く。書けなければ申し込まない。
    3. 結果が分からなかった申し込みを送り直すときは、内容を変えていても、**元の `requestId` と元の `rev`** で送る。200 なら元の印刷。応答の `rev` がいまの内容の `rev` と違えば「前の内容の印刷」と表示する。
    4. 409 `stale` が返ったら、その `requestId` の印刷は作られていない。端末の保存状態を「結果不明」にして、いまの内容を保存し直し、新しい `requestId` と新しい `rev` で 1 回だけ申し込み直す。それも `stale` ならエラーを表示する。
    5. 端末に記録する発行日は、応答の `issuedOn` を使う。
- 発行番号の採番、回数上限の判定、待ちへの追加は、D1 の `batch`（1つのトランザクション）と条件つきの文で行い、同時に来ても番号の重複や上限の超過が起きないようにする。
- 印刷用の画像は、申し込みの時点でサーバーが保存済みの路線データから組み立てる。画面は先に路線を保存してから申し込む。
- `snapshot` に、そのとき使った路線データ、その `rev`、発行日（日本時間の「2026.11.20」）、期限の日付、URL、印刷の見た目（`monoSet`・`sideLayout`。そのときの `CARD_MONO_SET`・`CARD_SIDE_LAYOUT`）を保存する。再印刷はこの `snapshot` から組み立て直すので、同じ発行番号で同じ内容になる。あとから設定を変えても、過去の印刷の再印刷（見た目の指定なし）は変わらない。
- 応答の `card` は、その印刷で使う見た目（`snapshot` の値）。同じ `requestId` の再送にも同じものを返す。画面は申し込んだあとの印刷プレビューをこの見た目で描く。
- 画像の組み立てに失敗したら、印刷を作らず 500 を返す（回数を消費しない）。
- `ahead` は、自分より前にある `queued` と `printing` の件数。
- 画像の準備が終わっていない印刷に対する同じ `requestId` の再送には、409 `conflict` と `Retry-After: 2` を返す。画面は少し待って同じ `requestId` で送り直す。
- 路線が存在し、非公開でなく、期限内であることは、待ちへ追加する文の中でも確かめる（非公開化や削除と同時に来ても、取り消しのあとに印刷が増えない）。
- 画面は状態を問い合わせ、`done`・`failed`・`canceled` になったら問い合わせをやめる。間隔は、`ahead` が 4 以下なら 5 秒、5 以上なら 15 秒（リクエスト数を抑えるため）。画面が裏に回っている間は問い合わせない。

## 5. プリンタ用 API（ATOM Lite から）

ヘッダ `Authorization: Bearer <PRINTER_TOKEN>` が必須。違えば 401。HTTPS（証明書を検証する）で接続する。

ATOM Lite はメモリが小さく、プリンタへの転送も遅いので、画像は小分けに取りに来る。取りに来ること自体が「生きている」合図になる。

| メソッドとパス | 内容 |
|---|---|
| `POST /api/printer/claim` | 待ちが無ければ 204。あれば先頭の1件を `printing` にして `{ jobId, width: 384, height }` を返す |
| `GET /api/printer/jobs/:id/rows?offset=<行>&count=<行数>` | 画像の一部を返す。本文は `48 × count` バイト |
| `POST /api/printer/jobs/:id/done` | 本文 `{ ok: boolean, error?: string }` |

- `claim`:
  - 選ぶのと `printing` にするのを、1つの条件つき `UPDATE ... RETURNING` で行う。同時に2回呼ばれても、同じ印刷を2回渡さない。
  - すでに `printing` の印刷があれば（プリンタが再起動した場合など）、新しいものは渡さず、その印刷を `failed`（`error` = `timeout`）にしてから次を渡す。途中まで刷った紙を自動で刷り直すことはしない。
  - **プリンタは 1 台だけつなぐ。** 2 台が同じトークンで問い合わせると、この決まりによって互いの印刷を失敗にする。
  - `printer_last_seen` は、前回の更新から 30 秒以上たっているときだけ書き換える。
  - 受付が一時停止中でも、すでに待ちに入っている印刷は渡す。
- `rows`:
  - 1行 48 バイト、左端が最上位ビット、1 が黒。上の行から順。
  - `count` は 1〜240。範囲が画像からはみ出したら 400。
  - `Content-Type: application/octet-stream`、`Content-Length` つき。
  - `printing` でない印刷に対しては 409。
  - 呼ばれるたびに `heartbeat_at` を更新する。
- `done`:
  - `printing` の印刷だけを `done` か `failed` にし、`raster` を NULL にする。
  - すでに同じ結果で終わっている印刷への報告は 200（再送に備える）。違う結果で終わっているものは 409。
  - `error` は 64 文字までの英数字と記号（0x21〜0x7E）。規定外の値は 400 にせず、サーバーが整えて受け付ける（範囲外の文字は `_`、64 文字で切る、文字列でない・空は `unknown`）。プリンタが送り直し続けるのを防ぐため。`ok` が真偽値でない場合だけ 400。
- **時間切れ**: `printing` のまま `heartbeat_at`（無ければ `claimed_at`）から 5 分たったものは、次の `claim` か管理画面の表示のときに `failed`（`timeout`）にする。
- プリンタは、完了報告が届かなかった場合、届くまで送り直す（その間は次の `claim` をしない）。
  - ただし `done` に 404 が返ったら（印刷の記録がサーバーから消えている）、報告先が無いものとして送り直しをやめ、次の `claim` に進む。401 など、ほかの失敗は送り直す。
- プリンタの問い合わせ間隔は 3 秒。ただし 2 分間印刷が無ければ 10 秒に延ばし、印刷が来たら 3 秒に戻す（リクエスト数を抑えるため。3 秒のままだと 1 日 28,800 回）。

## 6. 管理 API

`POST /api/admin/login` 以外は、ログインで発行される Cookie が必須。

- Cookie: `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/api/admin`、12時間。値は「期限」に HMAC-SHA256（`SESSION_SECRET`）で署名したもの。
- 状態を変える管理 API は、`Origin` ヘッダが自分のオリジンと一致することと、`Content-Type: application/json` を確かめる。

| メソッドとパス | 内容 |
|---|---|
| `POST /api/admin/login` | 本文 `{ password }` |
| `POST /api/admin/logout` | Cookie を消す |
| `GET /api/admin/state` | `{ accepting, eventCode, printer: { lastSeenAt }, jobs: [...], counts }`。`jobs` は新しい順に 100 件、路線名・`clientId`・状態・発行番号・使った見た目（`monoSet`・`sideLayout`）つき。画像は含めない |
| `POST /api/admin/jobs/:id/cancel` | `queued` のものだけ取り消す。それ以外は 409 |
| `POST /api/admin/jobs/:id/reprint` | 元の `snapshot` と発行番号で、新しい印刷を待ちの先頭に入れる。回数上限には数えず、待ちの上限（30 件）も適用しない（会場で刷り直したいときに満杯で断らないため）。本文は任意 `{ monoSet?, sideLayout? }`（下記）→ `{ jobId, issueNo, card: { monoSet, sideLayout } }` |
| `POST /api/admin/clients/:clientId/grant` | そのクライアントの、今の会場コードでの回数上限を 1 増やす |
| `POST /api/admin/accepting` | 本文 `{ accepting: boolean }` |
| `POST /api/admin/event-code/regenerate` | 新しい会場コードを発行し、古いものを無効にする |
| `GET /api/admin/routes` | 新しい順に 100 件（路線名、作成日時、非公開かどうか） |
| `POST /api/admin/routes/:id/hide` | 本文 `{ hidden: boolean }`。非公開にするのと、その路線の待ちの印刷を取り消すのを、1つの `batch` で行う |

### 再印刷の見た目の指定（刷り比べ用）

- 本文 `{ "monoSet"?: "light" | "bold", "sideLayout"?: "two-x1" | "lead-x2" | "two-x2-rotated" }`。本文なし・`{}` も受け付ける。
- 指定した項目は、その再印刷だけその見た目で画像を組み立てる。指定しない項目は元の印刷の `snapshot` の見た目（元の記録に見た目が無い古いものは、今のサーバーの設定）。
- 不正な値（未知の文字列、文字列でない、`null`）や、オブジェクトでない本文は 400（印刷は作らない）。
- 新しい印刷の `snapshot` には、実際に使った見た目を入れる（その再印刷をさらに指定なしで再印刷すると、同じ見た目になる）。
- 発行番号・待ちの先頭に入ること・回数上限に数えないこと・刷れない条件（期限切れ・非公開など）は、指定の有無で変わらない。
- `/api/admin/state` の `jobs` の見た目は `snapshot` から読む。見た目の無い古い記録は、今の設定（指定なしの再印刷で使う見た目）で埋めて返す。

## 7. 秘密の設定値（Worker）

`wrangler secret` で入れる。リポジトリには書かない。ローカル開発では `.dev.vars`。

- `ADMIN_PASSWORD`: 管理画面のパスワード
- `PRINTER_TOKEN`: プリンタ用の合い言葉。ファームの `secrets.h` にも同じ値を書く。入れ替えるときは `wrangler secret put` とファームの書き込み直しを両方行う
- `SESSION_SECRET`: 管理 Cookie の署名用

## 8. 画面の URL

| パス | 内容 |
|---|---|
| `/` | 作る画面（4ステップ） |
| `/?event=<会場コード>` | 会場の QR コードから開く URL。会場コードを端末に覚えたら、すぐ URL から消す |
| `/r/:id` | 路線のページ（見るだけ。作った端末なら「編集する」を出す） |
| `/admin` | 管理画面 |

## 9. 画面で伝えること（公開運用のため）

- 保存の前に「この URL を知っている人は誰でも見られます」と表示する。
- 保存後は「◯月◯日まで見られます。画像は早めに保存してね」と表示する。
- 路線ページに「この路線を消す」（作った端末だけ）を用意する。
