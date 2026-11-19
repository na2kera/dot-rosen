// 路線カード（shared/card）を画面で描く。フォントを読み込んでから、カラー版と印刷版（白黒）を作る。
import { useEffect, useMemo, useState } from "react";
import { renderCardColor, renderCardPrint } from "../../shared/card/index.ts";
import type { BitmapFont } from "../../shared/font/index.ts";
import type { BitImage, IndexedImage, Palette } from "../../shared/pix/index.ts";
import type { RouteData, StationLookup } from "../../shared/route/index.ts";
import { loadBitmapFont } from "../data/font.ts";
import { jstDate, jstMonthDay } from "../store/dates.ts";

export const APP_NAME = "ドット路線メーカー";

/** 点データのフォント（読み込み中は null、失敗したら error） */
export function useBitmapFont(): { font: BitmapFont | null; error: boolean; retry(): void } {
  const [font, setFont] = useState<BitmapFont | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    loadBitmapFont().then(
      (f) => alive && setFont(f),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  return { font, error, retry: () => setTick((t) => t + 1) };
}

export type CardOptions = {
  /** 保存済みなら路線の id（QR コードに入れる URL になる） */
  routeId: string | null;
  expiresAt: string | null;
  /** 印刷を申し込んだときの発行番号と日付（無ければ「No.----」と今日） */
  issueNo?: number | null;
  issuedOn?: string | null;
};

export const routeUrl = (id: string) => `${window.location.origin}/r/${id}`;

export type RenderedCard = { color: { image: IndexedImage; palette: Palette }; print: () => BitImage } | { error: string };

/** カードを描く（同じ内容なら使い回す）。印刷版は見るときだけ作る */
export function useCard(data: RouteData | null, lookup: StationLookup, font: BitmapFont | null, opts: CardOptions): RenderedCard | null {
  const json = data ? JSON.stringify(data) : null;
  return useMemo(() => {
    if (!data || !font) return null;
    const input = {
      route: data,
      lookup,
      font,
      issueNo: opts.issueNo ?? null,
      issuedOn: opts.issuedOn ?? jstDate(new Date()),
      expiresOn: opts.expiresAt ? jstMonthDay(new Date(opts.expiresAt)) : undefined,
      url: opts.routeId ? routeUrl(opts.routeId) : undefined,
      appName: APP_NAME,
    };
    try {
      const color = renderCardColor(input);
      let mono: BitImage | null = null;
      return { color, print: () => (mono ??= renderCardPrint(input)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    // json で中身の変化を見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, font, lookup, opts.routeId, opts.expiresAt, opts.issueNo, opts.issuedOn]);
}
