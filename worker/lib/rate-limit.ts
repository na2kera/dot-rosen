// IP ごとの回数制限（docs/api.md「回数制限（IP ごと）」）。rate_limits 表で、固定の時間窓ごとに数える。
//
// 並行のリクエストでも上限を超えないよう、判定と加算を1つの文（条件つきの UPSERT ... RETURNING）で行う。
// - 路線の作成: 作成の前に 1 加算する。上限に達していれば加算せず 429。
// - 会場コード・管理ログイン（失敗だけを数える）: 照合の前に 1 加算して枠を取り（上限に達していれば 429 で照合しない）、
//   照合が成功したら 1 戻す。失敗ならそのまま残す。これで同時に何件来ても、窓の中で照合が走る失敗は上限の回数まで。
// - 時間窓は新しい方向にしか進めない。古い窓の時刻を持った遅いリクエストは、今の窓に 1 回として数える
//   （今の窓の回数を 1 に戻さない）。戻すときも、実際に数えた窓から戻す。
import { iso } from "./config.ts";
import { ApiError } from "./http.ts";
import type { Db } from "./types.ts";

export type LimitKind = "create" | "code" | "login";

export const RATE_RULES: Record<LimitKind, { limit: number; windowMs: number }> = {
  /** 路線の作成: 1時間に 120 回 */
  create: { limit: 120, windowMs: 60 * 60 * 1000 },
  /** 会場コードが違った回数: 10分に 30 回 */
  code: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** 管理ログインの失敗: 10分に 10 回 */
  login: { limit: 10, windowMs: 10 * 60 * 1000 },
};

function windowOf(kind: LimitKind, now: Date) {
  const { windowMs } = RATE_RULES[kind];
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return { start: iso(new Date(start)), retryAfter: Math.max(1, Math.ceil((start + windowMs - now.getTime()) / 1000)) };
}

// 窓が新しくなっていれば 1 から数え直す。同じ窓か、保存されている窓より古い窓の要求は今の窓に 1 加算する。
// 今の窓で上限に達していれば何もしない（RETURNING が空になる）。時刻は同じ形の ISO 文字列なので文字列で比べられる
const ACQUIRE_SQL = `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN excluded.window_start > rate_limits.window_start THEN 1 ELSE rate_limits.count + 1 END,
    window_start = MAX(rate_limits.window_start, excluded.window_start)
  WHERE excluded.window_start > rate_limits.window_start OR rate_limits.count < ?3
  RETURNING window_start`;

/** 取った枠（戻すときに使う。実際に数えた窓） */
export type Attempt = { key: string; windowStart: string };

/** 1 回分の枠を取る。上限に達していれば 429 を投げる（加算はしない） */
export async function acquireAttempt(db: Db, kind: LimitKind, ip: string, now: Date): Promise<Attempt> {
  const w = windowOf(kind, now);
  const key = `${kind}:${ip}`;
  const row = await db.prepare(ACQUIRE_SQL).bind(key, w.start, RATE_RULES[kind].limit).first<{ window_start: string }>();
  if (!row) throw new ApiError(429, "rate_limited", { "Retry-After": String(w.retryAfter) });
  return { key, windowStart: row.window_start };
}

/** 取った枠を戻す（照合が成功したとき）。数えた窓がもう新しい窓に進んでいれば何もしない */
export async function releaseAttempt(db: Db, attempt: Attempt): Promise<void> {
  await db
    .prepare("UPDATE rate_limits SET count = count - 1 WHERE key = ?1 AND window_start = ?2 AND count > 0")
    .bind(attempt.key, attempt.windowStart)
    .run();
}
