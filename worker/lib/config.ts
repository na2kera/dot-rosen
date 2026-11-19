// 設定値の読み取りと、日付の書式。
import type { Bindings } from "./types.ts";

export const APP_NAME = "ドット路線メーカー";

export const DEFAULT_EXPIRY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 有効期限の日数（EXPIRY_DAYS。1〜365 の整数。それ以外は既定の 30） */
export function expiryDays(env: Bindings): number {
  const n = Number(env.EXPIRY_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_EXPIRY_DAYS;
}

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

export type MonoSet = "light" | "bold";
export type SideLayout = "two-x1" | "lead-x2" | "two-x2-rotated";
const MONO_SETS: readonly string[] = ["light", "bold"];
const SIDE_LAYOUTS: readonly string[] = ["two-x1", "lead-x2", "two-x2-rotated"];

/** 路線カードの模様セットと側面の置き方（CARD_MONO_SET・CARD_SIDE_LAYOUT。既定 bold・two-x1） */
export function cardOptions(env: Bindings): { monoSet: MonoSet; sideLayout: SideLayout } {
  const m = String(env.CARD_MONO_SET ?? "");
  const s = String(env.CARD_SIDE_LAYOUT ?? "");
  return {
    monoSet: (MONO_SETS.includes(m) ? m : "bold") as MonoSet,
    sideLayout: (SIDE_LAYOUTS.includes(s) ? s : "two-x1") as SideLayout,
  };
}

/** 日本時間の月日「12月20日」（路線カードの期限の印字。shared/card の CardInput.expiresOn の書式） */
export function jstMonthDay(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCMonth() + 1}月${j.getUTCDate()}日`;
}
