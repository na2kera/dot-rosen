// print_jobs 表の共通の処理。
import { iso } from "./config.ts";
import type { Db } from "./types.ts";

export type JobStatus = "queued" | "printing" | "done" | "failed" | "canceled";

/** 待ちの上限（queued の件数） */
export const MAX_QUEUED = 30;
/** printing のまま、この時間たったら時間切れ */
export const PRINT_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * 申し込みの途中（番号を取ってから画像を入れるまで）で Worker が止まると、画像の無い queued が残る。
 * この時間たっても画像が無いものは failed（error = render）にする。
 */
export const ORPHAN_MS = 60 * 1000;

/** 画像を入れられなかった申し込みを failed にする文 */
export function sweepOrphansStatement(db: Db, now: Date) {
  return db
    .prepare("UPDATE print_jobs SET status = 'failed', error = 'render', finished_at = ?1 WHERE status = 'queued' AND raster IS NULL AND created_at < ?2")
    .bind(iso(now), iso(new Date(now.getTime() - ORPHAN_MS)));
}

/** printing のまま 5 分たったものを failed（timeout）にする文 */
export function sweepTimeoutsStatement(db: Db, now: Date) {
  return db
    .prepare(
      `UPDATE print_jobs SET status = 'failed', error = 'timeout', finished_at = ?1, raster = NULL
       WHERE status = 'printing' AND COALESCE(heartbeat_at, claimed_at) < ?2`,
    )
    .bind(iso(now), iso(new Date(now.getTime() - PRINT_TIMEOUT_MS)));
}

/** 印刷の状態と、自分より前にある queued と printing の件数 */
export async function jobProgress(
  db: Db,
  jobId: number,
  clientId?: string,
): Promise<{ status: JobStatus; issueNo: number; ahead: number; routeId: string } | null> {
  const row = await db
    .prepare(
      `SELECT j.status AS status, j.issue_no AS issueNo, j.route_id AS routeId,
         CASE WHEN j.status = 'queued' THEN
           (SELECT COUNT(*) FROM print_jobs p WHERE p.status = 'printing')
           + (SELECT COUNT(*) FROM print_jobs q WHERE q.status = 'queued'
                AND (q.sort_key < j.sort_key OR (q.sort_key = j.sort_key AND q.id < j.id)))
         ELSE 0 END AS ahead
       FROM print_jobs j WHERE j.id = ?1 AND (?2 IS NULL OR j.client_id = ?2)`,
    )
    .bind(jobId, clientId ?? null)
    .first<{ status: JobStatus; issueNo: number; ahead: number; routeId: string }>();
  return row;
}

/** D1 の BLOB（number[] か ArrayBuffer で返る）を Uint8Array にする */
export function blobBytes(v: unknown): Uint8Array | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return null;
}
