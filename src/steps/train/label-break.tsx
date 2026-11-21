// 選択肢のカードの名前の折り返し。4 文字以上の名前は、区切りのよい所でだけ 2 行に割る。
// 名前（label）そのものは変えず（確認用の道具の一覧でも使うため）、画面に出すときに区切りを入れる。
import { Fragment } from "react";

/** 名前 → 区切り（"|" の所でだけ折り返す）。ここに無い名前は 3 文字までなので、そのまま 1 行に入る */
const BREAKS: Record<string, string> = {
  ボンネット: "ボン|ネット",
  横長LED: "横長|LED",
  じぶんのロゴ: "じぶん|のロゴ",
};

export function CardLabel({ text }: { text: string }) {
  const b = BREAKS[text];
  return (
    <span className={`thumb__label ${b ? "thumb__label--keep" : ""}`}>
      <span>
        {b
          ? b.split("|").map((p, i) => (
              <Fragment key={i}>
                {i > 0 && <wbr />}
                {p}
              </Fragment>
            ))
          : text}
      </span>
    </span>
  );
}
