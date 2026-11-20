// 1日1回の掃除（docs/api.md「3. データベース」）。路線には期限が無いので、路線は消さない。
import { addDays, iso } from "./config.ts";
import { ORPHAN_MS, PRINT_TIMEOUT_MS } from "./jobs.ts";
import type { Db } from "./types.ts";

/** 終わった印刷記録を残す日数 */
export const JOB_RETENTION_DAYS = 30;

export type CleanupResult = { jobs: number; timedOut: number; rasterCleared: number; rateLimits: number };

export async function cleanup(db: Db, now: Date): Promise<CleanupResult> {
  const nowIso = iso(now);
  const results = await db.batch([
    // 0. printing のまま時間切れのもの（プリンタが止まった、路線が消えたなど）を failed（timeout）に
    db
      .prepare(
        `UPDATE print_jobs SET status = 'failed', error = 'timeout', finished_at = ?1, raster = NULL
         WHERE status = 'printing' AND COALESCE(heartbeat_at, claimed_at) < ?2 RETURNING id`,
      )
      .bind(nowIso, iso(new Date(now.getTime() - PRINT_TIMEOUT_MS))),
    // 1. 画像の無いまま残った古い queued（申し込みの準備に失敗した残り）を消す
    db
      .prepare("DELETE FROM print_jobs WHERE status = 'queued' AND raster IS NULL AND created_at < ?1 RETURNING id")
      .bind(iso(new Date(now.getTime() - ORPHAN_MS))),
    // 2. 参照先の路線が無い（削除された）印刷のうち、終わっているもの
    db
      .prepare(
        `DELETE FROM print_jobs WHERE status IN ('done', 'failed', 'canceled')
         AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.id = print_jobs.route_id) RETURNING id`,
      ),
    // 3. 終わってから 30 日たった印刷記録
    db
      .prepare("DELETE FROM print_jobs WHERE status IN ('done', 'failed', 'canceled') AND finished_at < ?1 RETURNING id")
      .bind(iso(addDays(now, -JOB_RETENTION_DAYS))),
    // 4. 終わった印刷の画像は残さない
    db.prepare("UPDATE print_jobs SET raster = NULL WHERE status IN ('done', 'failed', 'canceled') AND raster IS NOT NULL RETURNING id"),
    // 5. 古い回数制限（窓はどれも 1 時間以内なので、1 日より前のものは要らない）
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?1 RETURNING key").bind(iso(addDays(now, -1))),
  ]);
  const n = (i: number) => results[i].results.length;
  return {
    timedOut: n(0),
    jobs: n(1) + n(2) + n(3),
    rasterCleared: n(4),
    rateLimits: n(5),
  };
}
