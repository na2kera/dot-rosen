// 路線カード（shared/card）を画面で描く。フォントを読み込んでから、カラー版と印刷版（白黒）を作る。
import { useEffect, useMemo, useState } from "react";
import { renderCardColor, renderCardPrint, type CardLook } from "../../shared/card/index.ts";
import type { BitmapFont } from "../../shared/font/index.ts";
import type { BitImage, IndexedImage, Palette } from "../../shared/pix/index.ts";
import type { RouteData, StationLookup } from "../../shared/route/index.ts";
import { getConfig } from "../app/services.ts";
import { loadBitmapFont } from "../data/font.ts";
import { useStore } from "../store/use-store.ts";
import type { ServerConfig } from "../store/server-config.ts";
import { APP_NAME, cardInputs } from "./card-input.ts";

export { APP_NAME };

const selectCardLook = (s: ServerConfig) => s.card;

/** 今のサーバーの設定の印刷の見た目（取れるまで・取れなければ既定の bold / two-x1） */
export function useServerCardLook(): CardLook {
  return useStore(getConfig().store, selectCardLook);
}

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
  /** 印刷を申し込んだときの発行番号と日付（無ければ「No.----」と今日） */
  issueNo?: number | null;
  issuedOn?: string | null;
  /** 印刷の見た目（サーバーの設定か、申し込んだときの見た目） */
  look: CardLook;
};

export const routeUrl = (id: string) => `${window.location.origin}/r/${id}`;

export type RenderedCard = { color: { image: IndexedImage; palette: Palette }; print: () => BitImage } | { error: string };

/** カードを描く（同じ内容なら使い回す）。印刷版は見るときだけ作る */
export function useCard(data: RouteData | null, lookup: StationLookup, font: BitmapFont | null, opts: CardOptions): RenderedCard | null {
  const json = data ? JSON.stringify(data) : null;
  return useMemo(() => {
    if (!data || !font) return null;
    try {
      const input = cardInputs(data, lookup, font, {
        url: opts.routeId ? routeUrl(opts.routeId) : null,
        issueNo: opts.issueNo,
        issuedOn: opts.issuedOn,
        look: opts.look,
      });
      const color = renderCardColor(input.color);
      let mono: BitImage | null = null;
      return { color, print: () => (mono ??= renderCardPrint(input.print)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    // json で中身の変化を見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, font, lookup, opts.routeId, opts.issueNo, opts.issuedOn, opts.look.monoSet, opts.look.sideLayout]);
}
