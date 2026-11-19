// 1日1回の掃除（docs/api.md「3. データベース」）。
import { addDays, iso } from "./config.ts";
import type { Db } from "./types.ts";

/** 終わった印刷記録を残す日数 */
export const JOB_RETENTION_DAYS = 30;

export async function cleanup(db: Db, now: Date): Promise<{ routes: number; jobs: number; rateLimits: number }> {
  const nowIso = iso(now);
  const results = await db.batch([
    // 期限切れの路線の印刷記録
    db.prepare("DELETE FROM print_jobs WHERE route_id IN (SELECT id FROM routes WHERE expires_at <= ?1) RETURNING id").bind(nowIso),
    // 期限切れの路線
    db.prepare("DELETE FROM routes WHERE expires_at <= ?1 RETURNING id").bind(nowIso),
    // 終わってから 30 日たった印刷記録
    db
      .prepare("DELETE FROM print_jobs WHERE status IN ('done', 'failed', 'canceled') AND finished_at < ?1 RETURNING id")
      .bind(iso(addDays(now, -JOB_RETENTION_DAYS))),
    // 古い回数制限（窓はどれも 1 時間以内なので、1 日より前のものは要らない）
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?1 RETURNING key").bind(iso(addDays(now, -1))),
  ]);
  return {
    jobs: results[0].results.length + results[2].results.length,
    routes: results[1].results.length,
    rateLimits: results[3].results.length,
  };
}
