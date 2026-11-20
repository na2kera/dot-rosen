// 画面で路線カードを描くときの入力の組み立て。DOM にも React にも依存しない（tests/ui-config.test.ts で確かめる）。
import type { CardInput, CardLook } from "../../shared/card/index.ts";
import type { BitmapFont } from "../../shared/font/index.ts";
import type { RouteData, StationLookup } from "../../shared/route/index.ts";
import { jstDate } from "../store/dates.ts";

export const APP_NAME = "ドット路線メーカー";

export type CardInputOptions = {
  /** 保存済みなら路線ページの URL（QR コードに入れる） */
  url: string | null;
  /** 印刷を申し込んだときの発行番号と日付（無ければ「No.----」と今日） */
  issueNo?: number | null;
  issuedOn?: string | null;
  /** 印刷の見た目（サーバーの設定か、申し込んだときの見た目） */
  look: CardLook;
};

/**
 * カラー版と印刷版の入力。印刷版は模様と側面の置き方の両方、カラー版は側面の置き方だけを見た目に合わせる
 * （カラー版に模様は関係しない）。
 */
export function cardInputs(
  data: RouteData,
  lookup: StationLookup,
  font: BitmapFont,
  opts: CardInputOptions,
  today: Date = new Date(),
): { color: CardInput; print: CardInput } {
  const base: CardInput = {
    route: data,
    lookup,
    font,
    issueNo: opts.issueNo ?? null,
    issuedOn: opts.issuedOn ?? jstDate(today),
    url: opts.url ?? undefined,
    appName: APP_NAME,
  };
  return {
    color: { ...base, sideLayout: opts.look.sideLayout },
    print: { ...base, sideLayout: opts.look.sideLayout, monoSet: opts.look.monoSet },
  };
}

/** プレビューの見た目: 申し込んだ内容を描くときは申し込んだときの見た目、それ以外は今のサーバーの設定 */
export function previewLook(printed: CardLook | null | undefined, server: CardLook): CardLook {
  return printed ?? server;
}
