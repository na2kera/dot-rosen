// settings 表（event_code、accepting、printer_last_seen、issue_counter）。
import { newEventCode } from "./crypto.ts";
import type { Db } from "./types.ts";

export type Settings = {
  /** まだ作っていなければ null */
  eventCode: string | null;
  accepting: boolean;
  /** プリンタが最後に問い合わせてきた時刻（無ければ null） */
  printerLastSeen: string | null;
  issueCounter: number;
};

export async function readSettings(db: Db): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const m = new Map(results.map((r) => [r.key, r.value]));
  return {
    eventCode: m.get("event_code") || null,
    accepting: m.get("accepting") === "1",
    printerLastSeen: m.get("printer_last_seen") || null,
    issueCounter: Number(m.get("issue_counter") ?? 0),
  };
}

/** 会場コードを返す。まだ無ければ作る（初めて必要になったとき） */
export async function ensureEventCode(db: Db): Promise<string> {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('event_code', ?1) ON CONFLICT (key) DO NOTHING").bind(newEventCode()).run();
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'event_code'").first<{ value: string }>();
  if (!row) throw new Error("会場コードを読めません");
  return row.value;
}

/** printer_last_seen を、前回の更新から 30 秒以上たっているときだけ書き換える文 */
export function touchPrinterStatement(db: Db, now: Date) {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - 30 * 1000).toISOString();
  return db
    .prepare("UPDATE settings SET value = ?1 WHERE key = 'printer_last_seen' AND (value = '' OR value < ?2)")
    .bind(nowIso, cutoff);
}
