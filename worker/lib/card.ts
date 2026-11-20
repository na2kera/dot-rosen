// 路線カード（shared/card）を呼ぶのはここだけ。
import { CARD_MAX_HEIGHT, cardRaster, renderCardPrint } from "../../shared/card/index.ts";
import type { RouteData } from "../../shared/route/index.ts";
import type { MonoSet, SideLayout } from "./config.ts";
import type { Resources } from "./types.ts";

/** 1行のバイト数（384 ドット） */
export const ROW_BYTES = 48;
export const CARD_WIDTH = 384;
export { CARD_MAX_HEIGHT };

/** 申し込み時点で決めた、印字する内容。再印刷はこれから組み立て直す */
export type CardSnapshot = {
  route: RouteData;
  /** route の元になった保存内容の版の印。この項目ができる前の古い記録には無い */
  rev?: string;
  issuedOn: string;
  url: string;
  appName: string;
  monoSet: MonoSet;
  sideLayout: SideLayout;
};

export type CardRaster = { raster: Uint8Array; height: number };

/** 描画と生データへの変換に分けて時間を測る（tools/bench-print.ts 用） */
export function timedBuild(snapshot: CardSnapshot, issueNo: number, res: Resources): CardRaster & { renderMs: number; rasterMs: number } {
  const t0 = performance.now();
  const img = renderCardPrint({
    route: snapshot.route,
    lookup: res.lookup,
    font: res.font,
    issueNo,
    issuedOn: snapshot.issuedOn,
    url: snapshot.url,
    appName: snapshot.appName,
    monoSet: snapshot.monoSet,
    sideLayout: snapshot.sideLayout,
  });
  const t1 = performance.now();
  if (img.width !== CARD_WIDTH) throw new Error(`路線カードの幅が ${img.width} です`);
  if (img.height < 1 || img.height > CARD_MAX_HEIGHT) throw new Error(`路線カードの高さが ${img.height} 行です（上限 ${CARD_MAX_HEIGHT}）`);
  const raster = cardRaster(img);
  const t2 = performance.now();
  if (raster.length !== ROW_BYTES * img.height) throw new Error("生データの大きさが合いません");
  return { raster, height: img.height, renderMs: t1 - t0, rasterMs: t2 - t1 };
}

/** 印刷用の生データを作る。高さが上限を超えるときや大きさが合わないときは投げる */
export function buildCardRaster(snapshot: CardSnapshot, issueNo: number, res: Resources): CardRaster {
  const { raster, height } = timedBuild(snapshot, issueNo, res);
  return { raster, height };
}
