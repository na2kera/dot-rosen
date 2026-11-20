// Worker の中で使う型。テスト（Node 上）からも読み込むので、workerd の型（D1Database など）には
// 直接依存せず、使う部分だけの狭い型にしておく。本物の D1Database はこの型に代入できる。
import type { BitmapFont } from "../../shared/font/index.ts";
import type { StationLookup } from "../../shared/route/index.ts";
import type { CardRaster, CardSnapshot } from "./card.ts";

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}

export interface Db {
  prepare(query: string): DbStatement;
  batch<T = Record<string, unknown>>(statements: DbStatement[]): Promise<{ results: T[] }[]>;
}

/** Worker の設定値と秘密の値（wrangler.jsonc の vars と wrangler secret） */
export type Bindings = {
  DB: Db;
  ADMIN_PASSWORD?: string;
  PRINTER_TOKEN?: string;
  SESSION_SECRET?: string;
  CARD_MONO_SET?: string;
  CARD_SIDE_LAYOUT?: string;
};

/** 同梱する駅データとフォント */
export type Resources = {
  lookup: StationLookup;
  font: BitmapFont;
};

export type Deps = {
  /** モジュールの読み込み時に1回だけ作ったもの */
  resources: Resources;
  /** 現在時刻（テストで差し替える） */
  now: () => Date;
  /** 路線カードの組み立て（テストで失敗を起こすときだけ差し替える。既定は worker/lib/card.ts の buildCardRaster） */
  buildCard?: (snapshot: CardSnapshot, issueNo: number, res: Resources) => CardRaster;
};

export type AppEnv = { Bindings: Bindings };
