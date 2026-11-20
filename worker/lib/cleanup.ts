// 1日1回の掃除（docs/api.md「3. データベース」）。
import { addDays, iso } from "./config.ts";
import { ORPHAN_MS, PRINT_TIMEOUT_MS } from "./jobs.ts";
import type { Db } from "./types.ts";

/** 終わった印刷記録を残す日数 */
export const JOB_RETENTION_DAYS = 30;

/** 路線 r に、まだ終わっていない（queued か printing の）印刷が無い */
const NO_ACTIVE_JOB = "NOT EXISTS (SELECT 1 FROM print_jobs a WHERE a.route_id = r.id AND a.status IN ('queued', 'printing'))";

export type CleanupResult = { routes: number; jobs: number; timedOut: number; rasterCleared: number; rateLimits: number };

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
    // 2・3. 期限切れの路線とその印刷記録。ただし queued か printing の印刷が残っている路線は、
    //   その印刷が終わるまで消さない（受け付けた印刷は最後まで刷る。次回以降の掃除で消える）。
    //   公開 API は expires_at で 410 を返すので、消すのが遅れても公開の期限は変わらない
    db
      .prepare(
        `DELETE FROM print_jobs WHERE route_id IN (SELECT id FROM routes r WHERE r.expires_at <= ?1 AND ${NO_ACTIVE_JOB}) RETURNING id`,
      )
      .bind(nowIso),
    db.prepare(`DELETE FROM routes AS r WHERE r.expires_at <= ?1 AND ${NO_ACTIVE_JOB} RETURNING id`).bind(nowIso),
    // 4. 参照先の路線が無い（削除された）印刷のうち、終わっているもの
    db
      .prepare(
        `DELETE FROM print_jobs WHERE status IN ('done', 'failed', 'canceled')
         AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.id = print_jobs.route_id) RETURNING id`,
      ),
    // 5. 終わってから 30 日たった印刷記録
    db
      .prepare("DELETE FROM print_jobs WHERE status IN ('done', 'failed', 'canceled') AND finished_at < ?1 RETURNING id")
      .bind(iso(addDays(now, -JOB_RETENTION_DAYS))),
    // 6. 終わった印刷の画像は残さない
    db.prepare("UPDATE print_jobs SET raster = NULL WHERE status IN ('done', 'failed', 'canceled') AND raster IS NOT NULL RETURNING id"),
    // 7. 古い回数制限（窓はどれも 1 時間以内なので、1 日より前のものは要らない）
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?1 RETURNING key").bind(iso(addDays(now, -1))),
  ]);
  const n = (i: number) => results[i].results.length;
  return {
    timedOut: n(0),
    jobs: n(1) + n(2) + n(4) + n(5),
    routes: n(3),
    rasterCleared: n(6),
    rateLimits: n(7),
  };
}
