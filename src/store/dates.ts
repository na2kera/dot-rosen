// 日付の書式。DOM に依存しない。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の日付「2026.11.20」（路線カードの発行日。サーバーと同じ書式） */
export function jstDate(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCFullYear()}.${String(j.getUTCMonth() + 1).padStart(2, "0")}.${String(j.getUTCDate()).padStart(2, "0")}`;
}
