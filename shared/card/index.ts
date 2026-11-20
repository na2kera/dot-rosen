// 路線カード（docs/spec.md「3. 印刷」の「路線カードの中身」）。
// 1つの配置（layout.ts）から、印刷用の白黒画像とカラー版の色番号画像を作る。DOM にも Node にも依存しない。
import type { BitmapFont } from "../font/index.ts";
import type { BitImage, IndexedImage, Palette } from "../pix/index.ts";
import type { RouteData, StationLookup } from "../route/index.ts";
import { CARD_WIDTH, layoutCard, type CardSideLayout } from "./layout.ts";
import { CARD_PALETTE } from "./palette.ts";
import { paintColor, paintPrint } from "./render.ts";

export { CARD_MAX_HEIGHT, CARD_WIDTH, formatIssueNo, layoutCard, type CardLayout, type CardSideLayout, type Op } from "./layout.ts";
export { CARD_BASE, CARD_INK, CARD_PALETTE, CARD_PAPER, CARD_SUB } from "./palette.ts";
export { qrMatrix, type QrMatrix } from "./qr.ts";
export {
  CARD_MONO_SETS,
  CARD_SIDE_LAYOUTS,
  DEFAULT_CARD_LOOK,
  isCardMonoSet,
  isCardSideLayout,
  toCardLook,
  type CardLook,
  type CardMonoSet,
} from "./look.ts";

export type CardInput = {
  /** 検査済みの路線データ */
  route: RouteData;
  /** 駅 ID → 駅名・座標 */
  lookup: StationLookup;
  /** 点データのフォント */
  font: BitmapFont;
  /** 発行番号。未発行（プレビュー）は null →「No.----」 */
  issueNo: number | null;
  /** 発行日（「2026.11.20」） */
  issuedOn: string;
  /** QR コードにする URL。無ければ QR の段を省く */
  url?: string;
  /** アプリ名（「ドット路線メーカー」） */
  appName: string;
  /** 印刷用の模様。既定は "bold" */
  monoSet?: "light" | "bold";
  /** 側面の置き方。既定は "two-x1" */
  sideLayout?: CardSideLayout;
};

/** 印刷用（幅 384 の白黒）。高さが CARD_MAX_HEIGHT を超えるときは例外を投げる */
export function renderCardPrint(input: CardInput): BitImage {
  return paintPrint(layoutCard(input), input.font, input.monoSet ?? "bold");
}

/** 画面・保存用のカラー版（幅 384 の色番号画像とパレット） */
export function renderCardColor(input: CardInput): { image: IndexedImage; palette: Palette } {
  return { image: paintColor(layoutCard(input), input.font), palette: CARD_PALETTE };
}

/** プリンタに送る生データ（1行 48 バイト、左端が最上位ビット、1 が黒、上の行から） */
export function cardRaster(img: BitImage): Uint8Array {
  if (img.width !== CARD_WIDTH || img.stride !== CARD_WIDTH / 8) throw new Error(`路線カードの幅が ${CARD_WIDTH} ではありません: ${img.width}`);
  return img.data.slice(0, img.stride * img.height);
}
