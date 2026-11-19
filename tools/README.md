# tools/

データ生成などの Node スクリプト。TypeScript は `tools/run.mjs` が esbuild でまとめてから実行する。

| コマンド | 内容 |
|---|---|
| `pnpm data:build` | `tools/build-stations.ts`。駅データ・地図データを `public/data/` に作り直す |
| `pnpm font:build` | `tools/build-font.ts`。点データのフォントと woff2 を `public/fonts/` に作り直す（駅名の文字を使うので `data:build` の後に実行） |
| `pnpm sprites:sheet` | `tools/sprites-sheet.ts`。電車のパーツの確認用一覧を `tools/out/sprites/` に出す（拡大ページは `review/`） |
| `pnpm sprites:bench` | `tools/bench-sprites.ts`。顔1つ・側面2両・白黒変換の時間を、新しいプロセスで 7 回測る |
| `pnpm print:bench` | `tools/bench-print.ts`。`POST /api/print` の計算（本文の検査、路線データの検査、カードの描画、生データ）の時間を、新しいプロセスで 7 回測る |
| `pnpm printer:fake` | `tools/fake-printer.ts`。プリンタの代わりに claim → rows → done を回し、受け取った画像を `tools/out/printed/` に PNG（と生データ .bin）で保存する。`PRINTER_TOKEN=... pnpm printer:fake --url http://127.0.0.1:5182 --once`。`--fail <理由>` で失敗の報告、`--no-done` で報告しない |
| `pnpm raster:png` | `tools/raster-to-png.ts`。プリンタ用の生データ（48 × 高さ バイト）を PNG にする。`pnpm raster:png <入力.bin> [出力.png] [--scale 2]` |

### サーバーの確認用の開発サーバー

ほかの開発サーバーとローカルの D1（`.wrangler/`）を取り合わないよう、`tools/dev-api.vite.config.ts` で D1 の置き場所を一時ディレクトリにして起動する。

```sh
S=$(mktemp -d)
volta run --node 22.23.2 pnpm exec wrangler d1 migrations apply dot-rosen --local --persist-to $S
DOT_ROSEN_STATE=$S DEV_ADMIN_PASSWORD=dev-admin DEV_PRINTER_TOKEN=dev-printer DEV_SESSION_SECRET=dev-session-secret \
  pnpm dev --port 5182 --strictPort --config tools/dev-api.vite.config.ts
# 別の端末で: PRINTER_TOKEN=dev-printer pnpm printer:fake --url http://127.0.0.1:5182
# 定期実行（掃除）を呼ぶ: curl "http://127.0.0.1:5182/cdn-cgi/handler/scheduled?cron=0+18+*+*+*"
```

生成物（`public/data/`、`public/fonts/`）はコミットする。元データ（`data-src/`）と確認用の出力（`tools/out/`）はコミットしない。

## 元データの取得

`data-src/` に次の配置で置く（どれもダウンロードしたファイルをそのまま置く。展開しない）。

```
data-src/n02/N02-25_GML.zip
data-src/n03/N03-20250101_08_GML.zip   … 08 09 10 11 12 13 14 19 20 22 の10県
data-src/ne/ne_10m_rivers_lake_centerlines.geojson
data-src/ne/ne_10m_lakes.geojson
```

```sh
mkdir -p data-src/n02 data-src/n03 data-src/ne
curl -L -o data-src/n02/N02-25_GML.zip https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip
for p in 08 09 10 11 12 13 14 19 20 22; do
  curl -L -o data-src/n03/N03-20250101_${p}_GML.zip https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_${p}_GML.zip
done
for f in ne_10m_rivers_lake_centerlines.geojson ne_10m_lakes.geojson; do
  curl -L -o data-src/ne/$f https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f
done
```

## ライセンス

| データ | 使い方 | ライセンス | 配布ページ |
|---|---|---|---|
| 国土数値情報 鉄道データ N02 2025年版（国土交通省） | 駅・線路 | CC BY 4.0（2020年以降のデータ） | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html |
| 国土数値情報 行政区域データ N03 2025年版（国土交通省） | 都県の判定・陸地 | CC BY 4.0 | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html |
| Natural Earth 10m 河川・湖 | 試しただけで使っていない | パブリックドメイン | https://www.naturalearthdata.com/ |
| DotGothic16 | 画面と印刷の文字 | SIL OFL 1.1（`assets-src/fonts/OFL.txt`） | https://fonts.google.com/specimen/DotGothic16 |

- 国土数値情報の「河川」W05 と「海岸線」C23 は非商用限定なので使わない。
- アプリに出す出典の表記は `shared/attribution.ts`。

## 駅データの作り方（build-stations.ts）

- 駅の形状（ホームの線）の長さの中点を代表点にする。
- 地図の範囲（経度 138.6〜141.0、緯度 34.8〜36.4）の駅を、グループコード（N02_005g）が同じもの、
  および同じ駅名で代表点が 600m 以内のもの（連鎖）でまとめる。位置はまとめた代表点の平均。
- 都県は N03 の市区町村ポリゴンで判定し、東京・神奈川・埼玉・千葉だけを残す。どのポリゴンにも入らない駅は
  3km 以内の最寄りの市区町村に寄せる。
- 駅の ID は `s` + まとめた中で最小のグループコード。
- 陸地は、範囲にかかる10県の市区町村ポリゴンから、逆向きに2回出る辺（隣との境界）を消して外周だけを残し、
  15m の許容誤差で間引く。
- 線路は端点でつないでから 40m の許容誤差で間引く。
- 座標は 1/100000 度単位の整数の差分で保存する（`shared/geo/map-data.ts`）。

## 川について

Natural Earth 10m の範囲内の川は利根川1本（60点）だけで、多摩川・荒川・江戸川・隅田川・相模川が無く、
形も粗いため地図データには入れていない（`map.json` の `rivers` は空。確認用画像には参考として青線で描く）。
国土数値情報の W05 は非商用限定のため使えない。地球地図日本（国土地理院）は国土地理院コンテンツ利用規約
（公共データ利用規約 PDL1.0）の対象と読めるが、測量法による制約の有無を確認できていないため使っていない。

## 確認用の出力（tools/out/、コミットしない）

- `stations-report.txt`: 都県別の駅数、統合前後の数、同名で別駅として残したもの、国の集計との比較など
- `map-debug.png`: 全体図と都心部の拡大図
- `font-coverage.txt`: フォントに無い文字、点の判定が食い違った文字
- `sprites/`: 電車の確認用一覧（parts-face / parts-side / random-color / random-mono-light・bold / v2-compare / logos / print-test-*）、`ink-report.txt`（64×64 の黒の割合）
