// アプリに表示する出典の表記。
// 元データを変えたら、ここと tools/README.md を合わせて直す。

export const ATTRIBUTION_LINES: readonly string[] = [
  "駅・線路: 国土数値情報（鉄道データ）（国土交通省）を加工して作成",
  "陸地: 国土数値情報（行政区域データ）（国土交通省）を加工して作成",
  "フォント: DotGothic16（SIL Open Font License 1.1）",
];

/** 1行にまとめた出典の表記 */
export const ATTRIBUTION_TEXT = ATTRIBUTION_LINES.join(" / ");

/** 出典の配布ページ */
export const ATTRIBUTION_SOURCES = [
  { name: "国土数値情報（鉄道データ）", license: "CC BY 4.0", url: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html" },
  { name: "国土数値情報（行政区域データ）", license: "CC BY 4.0", url: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html" },
  { name: "DotGothic16", license: "SIL OFL 1.1", url: "https://fonts.google.com/specimen/DotGothic16" },
] as const;
