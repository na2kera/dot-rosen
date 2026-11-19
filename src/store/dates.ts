// 日付の書式。DOM に依存しない。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の日付「2026.11.20」（路線カードの発行日。サーバーと同じ書式） */
export function jstDate(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCFullYear()}.${String(j.getUTCMonth() + 1).padStart(2, "0")}.${String(j.getUTCDate()).padStart(2, "0")}`;
}

/** 日本時間の月日「12月20日」（路線カードに印字する期限。サーバーと同じ書式） */
export function jstMonthDay(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCMonth() + 1}月${j.getUTCDate()}日`;
}

/** 端末の現地時刻の月日「12月20日」（画面の期限の案内）。読めなければ null */
export function localMonthDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
