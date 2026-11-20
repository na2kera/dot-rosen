// 設定値の読み取りと、日付の書式。
import { toCardLook, type CardLook, type CardMonoSet, type CardSideLayout } from "../../shared/card/index.ts";
import type { Bindings } from "./types.ts";

export const APP_NAME = "ドット路線メーカー";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

export const iso = (d: Date) => d.toISOString();

/** 日本時間の日付「2026.11.20」 */
export function jstDate(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  const mm = String(j.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(j.getUTCDate()).padStart(2, "0");
  return `${j.getUTCFullYear()}.${mm}.${dd}`;
}

export type MonoSet = CardMonoSet;
export type SideLayout = CardSideLayout;

/** 路線カードの模様セットと側面の置き方（CARD_MONO_SET・CARD_SIDE_LAYOUT。既定 bold・two-x1） */
export function cardOptions(env: Bindings): CardLook {
  return toCardLook({ monoSet: env.CARD_MONO_SET, sideLayout: env.CARD_SIDE_LAYOUT });
}
