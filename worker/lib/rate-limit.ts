// IP ごとの回数制限（docs/api.md「回数制限（IP ごと）」）。rate_limits 表で、固定の時間窓ごとに数える。
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

function limited(retryAfter: number): ApiError {
  return new ApiError(429, "rate_limited", { "Retry-After": String(retryAfter) });
}

const HIT_SQL = `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
    window_start = excluded.window_start
  RETURNING count`;

/** 1回数え、上限を超えていたら 429 を投げる（路線の作成） */
export async function hitLimit(db: Db, kind: LimitKind, ip: string, now: Date): Promise<void> {
  const w = windowOf(kind, now);
  const row = await db.prepare(HIT_SQL).bind(`${kind}:${ip}`, w.start).first<{ count: number }>();
  if (row && row.count > RATE_RULES[kind].limit) throw limited(w.retryAfter);
}

/** 失敗の回数がすでに上限に達していたら 429 を投げる（会場コード、管理ログイン） */
export async function checkFailures(db: Db, kind: LimitKind, ip: string, now: Date): Promise<void> {
  const w = windowOf(kind, now);
  const row = await db
    .prepare("SELECT count FROM rate_limits WHERE key = ?1 AND window_start = ?2")
    .bind(`${kind}:${ip}`, w.start)
    .first<{ count: number }>();
  if (row && row.count >= RATE_RULES[kind].limit) throw limited(w.retryAfter);
}

/** 失敗を1回数える */
export async function recordFailure(db: Db, kind: LimitKind, ip: string, now: Date): Promise<void> {
  const w = windowOf(kind, now);
  await db.prepare(HIT_SQL).bind(`${kind}:${ip}`, w.start).first();
}
