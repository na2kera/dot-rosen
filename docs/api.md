# API とデータの取り決め

画面、Worker、プリンタのファームが共通で従う取り決め。仕様の背景は `docs/spec.md`。

## 1. 路線データ

画面とサーバーでやり取りし、サーバーに保存する唯一のデータ。画像は保存しない。

```ts
type RouteData = {
  v: 1;
  name: string;        // 路線名。1〜12文字（コードポイント数）。制御文字と改行は不可
  symbol: string;      // 路線記号。英大文字1〜2文字
  lineColor: ColorId;  // 12色のいずれか
  stations: string[];  // 駅 ID。2〜30件。重複不可
  loop: boolean;       // 環状線なら true（stations に始発駅を2回入れない）
  train: TrainDesign;  // shared/train の型
};
```

- サーバーは保存前に必ず検査する。駅 ID は実在するものだけ、`train` は `parseTrainDesign` を通す。
- 検査と正規化の関数は `shared/` に置き、画面とサーバーで同じものを使う。

## 2. データベース（D1）

| 表 | 主な列 |
|---|---|
| `routes` | `id`（推測できない文字列。URL に使う）、`edit_key_hash`、`data`（RouteData の JSON）、`created_at`、`updated_at`、`expires_at`、`hidden` |
| `print_jobs` | `id`、`route_id`、`device_id`、`status`、`issue_no`、`raster`（白黒の生データ。印刷が終わったら NULL にする）、`height`、`created_at`、`started_at`、`finished_at`、`error` |
| `print_grants` | `device_id`、`extra`（追加で許可した回数） |
| `settings` | `key`、`value`（`event_code`、`accepting`、`printer_last_seen`、`issue_counter`） |

- `status` は `queued` → `printing` → `done` / `failed`、または `canceled`。
- `printing` のまま3分たったものは `failed` として扱う。
- 時刻は UTC の ISO 8601 文字列。
- 有効期限は最初の保存から `EXPIRY_DAYS` 日（既定 30。Worker の設定値）。上書きしても延びない。
- 期限切れの路線と、終わってから7日たった印刷記録は、1日1回の定期実行で消す。

## 3. 公開 API（来場者の画面から）

すべて JSON。エラーは `{ "error": "<コード>" }` と適切な HTTP ステータス。

| メソッドとパス | 内容 |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `POST /api/routes` | 本文 `{ data }` → `{ id, editKey, expiresAt }`。`editKey` はこの応答でしか返さない |
| `GET /api/routes/:id` | `{ id, data, expiresAt }`。無い・非公開は 404、期限切れは 410 |
| `PUT /api/routes/:id` | ヘッダ `X-Edit-Key`、本文 `{ data }` → `{ ok: true, expiresAt }`。鍵が違えば 403 |
| `GET /api/event?code=...` | `{ valid, accepting }`。会場コードが有効か、受付中か |
| `POST /api/print` | 本文 `{ routeId, editKey, eventCode, deviceId }` → `{ jobId, issueNo, ahead }` |
| `GET /api/print/:jobId?deviceId=...` | `{ status, ahead, issueNo }`。`ahead` は自分より前に待っている件数 |

`POST /api/print` のエラーコード: `invalid_code`（会場コードが違う）、`not_accepting`（受付停止中）、`limit_reached`（この端末の回数上限）、`forbidden`（鍵が違う）、`not_found`。

- `deviceId` は画面が最初に作って端末内に保存するランダムな文字列。回数上限の判定に使う（端末のデータを消せば回避できる、ゆるい制限）。
- 回数上限は端末ごとに 1 + `print_grants.extra`。数えるのは `canceled` と `failed` 以外の印刷。
- 印刷用の画像は、この申し込みの時点でサーバーが路線データから組み立てて `raster` に入れる。
- `issue_no` は申し込みのたびに 1 増える通し番号。再印刷では同じ番号を使う。

## 4. プリンタ用 API（ATOM Lite から）

ヘッダ `Authorization: Bearer <DEVICE_TOKEN>` が必須。違えば 401。

| メソッドとパス | 内容 |
|---|---|
| `GET /api/device/next` | 待ちが無ければ 204。あれば 200 で画像の生データを返し、その印刷を `printing` にする。呼ばれるたびに `printer_last_seen` を更新する |
| `POST /api/device/jobs/:id/done` | 本文 `{ ok: boolean, error?: string }`。`done` か `failed` にし、`raster` を消す |

`GET /api/device/next` の 200 応答:

- `Content-Type: application/octet-stream`
- ヘッダ `X-Job-Id`、`X-Width`（常に 384）、`X-Height`（行数）
- 本文は `48 × X-Height` バイト。1行 48 バイト、左端が最上位ビット、1 が黒。上の行から順。
- 受付が一時停止中でも、すでに待ちに入っている印刷は渡す。

## 5. 管理 API

`POST /api/admin/login` 以外は、ログインで発行される Cookie が必須。

| メソッドとパス | 内容 |
|---|---|
| `POST /api/admin/login` | 本文 `{ password }`。正しければ HttpOnly の Cookie（署名つき、12時間有効）を発行 |
| `POST /api/admin/logout` | Cookie を消す |
| `GET /api/admin/state` | `{ accepting, eventCode, printer: { lastSeenAt }, jobs: [...], counts }`。`jobs` は新しい順に 100 件、路線名つき |
| `POST /api/admin/jobs/:id/cancel` | 待ちの印刷を取り消す |
| `POST /api/admin/jobs/:id/reprint` | 同じ路線・同じ発行番号で、新しい印刷を待ちの先頭に入れる |
| `POST /api/admin/devices/:deviceId/grant` | その端末の回数上限を 1 増やす |
| `POST /api/admin/accepting` | 本文 `{ accepting: boolean }` |
| `POST /api/admin/event-code/regenerate` | 新しい会場コードを発行し、古いものを無効にする |
| `GET /api/admin/routes` | 新しい順に 100 件（路線名、作成日時、非公開かどうか） |
| `POST /api/admin/routes/:id/hide` | 本文 `{ hidden: boolean }`。非公開にすると、その路線の待ちの印刷も取り消す |

## 6. 秘密の設定値（Worker）

`wrangler secret` で入れる。リポジトリには書かない。ローカル開発では `.dev.vars`。

- `ADMIN_PASSWORD`: 管理画面のパスワード
- `DEVICE_TOKEN`: プリンタ用の合い言葉
- `SESSION_SECRET`: 管理 Cookie の署名用

## 7. 画面の URL

| パス | 内容 |
|---|---|
| `/` | 作る画面（4ステップ） |
| `/?event=<会場コード>` | 会場の QR コードから開く URL。会場コードを端末に覚え、印刷ボタンを出す |
| `/r/:id` | 路線のページ（見るだけ。作った端末なら「編集する」を出す） |
| `/admin` | 管理画面 |
