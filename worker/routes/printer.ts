// プリンタ用 API（docs/api.md「5. プリンタ用 API」）。
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { CARD_WIDTH, ROW_BYTES } from "../lib/card.ts";
import { iso } from "../lib/config.ts";
import { safeEqual } from "../lib/crypto.ts";
import { ApiError, asRecord, conflict, invalid, jobIdParam, notFound, readJson, sanitizePrinterError } from "../lib/http.ts";
import { blobBytes, sweepOrphansStatement, type JobStatus } from "../lib/jobs.ts";
import { touchPrinterStatement } from "../lib/settings.ts";
import type { AppEnv, Deps } from "../lib/types.ts";

/** rows の count の上限 */
export const MAX_ROWS_PER_REQUEST = 240;

const printerAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.env.PRINTER_TOKEN;
  const m = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "");
  if (!token || !m || !(await safeEqual(m[1], token))) throw new ApiError(401, "unauthorized");
  await next();
});

export function printerApi(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use("/printer/*", printerAuth);

  app.post("/printer/claim", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const nowIso = iso(now);
    // 待ちも印刷中も無いとき（問い合わせのほとんど）は軽く済ませる: 1文で有無と printer_last_seen を見て、
    // 何も無ければ 204（printer_last_seen の更新が要るときだけもう1文）
    const probe = await db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM print_jobs WHERE status IN ('queued', 'printing')) AS busy,
           (SELECT value FROM settings WHERE key = 'printer_last_seen') AS seen`,
      )
      .first<{ busy: number; seen: string | null }>();
    if (probe && !probe.busy) {
      if (!probe.seen || probe.seen < iso(new Date(now.getTime() - 30 * 1000))) await touchPrinterStatement(db, now).run();
      return c.body(null, 204);
    }
    const results = await db.batch<{ id: number; height: number }>([
      sweepOrphansStatement(db, now),
      // すでに printing のもの（プリンタの再起動など）は、渡し直さずに「結果が分からない」失敗にする
      db
        .prepare("UPDATE print_jobs SET status = 'failed', error = 'timeout', finished_at = ?1, raster = NULL WHERE status = 'printing'")
        .bind(nowIso),
      // 先頭の1件を選ぶのと printing にするのを1つの文で
      db
        .prepare(
          `UPDATE print_jobs SET status = 'printing', claimed_at = ?1, heartbeat_at = NULL
           WHERE id = (SELECT id FROM print_jobs WHERE status = 'queued' AND raster IS NOT NULL ORDER BY sort_key, id LIMIT 1)
             AND status = 'queued'
           RETURNING id, height`,
        )
        .bind(nowIso),
      touchPrinterStatement(db, now),
    ]);
    const job = results[2].results[0];
    if (!job) return c.body(null, 204);
    return c.json({ jobId: job.id, width: CARD_WIDTH, height: job.height });
  });

  app.get("/printer/jobs/:id/rows", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const id = jobIdParam(c.req.param("id"));
    const offsetStr = c.req.query("offset") ?? "";
    const countStr = c.req.query("count") ?? "";
    if (!/^\d{1,6}$/.test(offsetStr) || !/^\d{1,3}$/.test(countStr)) throw invalid();
    const offset = Number(offsetStr);
    const count = Number(countStr);
    if (count < 1 || count > MAX_ROWS_PER_REQUEST) throw invalid();
    const results = await db.batch<{ status: JobStatus; height: number | null; chunk: unknown }>([
      db.prepare("UPDATE print_jobs SET heartbeat_at = ?1 WHERE id = ?2 AND status = 'printing'").bind(iso(now), id),
      // 必要な部分だけを substr で読む（BLOB の substr はバイト単位、1 始まり）
      db
        .prepare(
          `SELECT status, height,
             CASE WHEN status = 'printing' AND ?2 + ?3 <= height THEN substr(raster, ?2 * ${ROW_BYTES} + 1, ?3 * ${ROW_BYTES}) END AS chunk
           FROM print_jobs WHERE id = ?1`,
        )
        .bind(id, offset, count),
      touchPrinterStatement(db, now),
    ]);
    const row = results[1].results[0];
    if (!row) throw notFound();
    if (row.status !== "printing") throw conflict();
    if (row.height === null || offset + count > row.height) throw invalid();
    const bytes = blobBytes(row.chunk);
    if (!bytes || bytes.length !== count * ROW_BYTES) throw new Error(`生データの長さが違います: job ${id}`);
    return new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length) },
    });
  });

  app.post("/printer/jobs/:id/done", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const id = jobIdParam(c.req.param("id"));
    const body = asRecord(await readJson(c));
    if (typeof body.ok !== "boolean") throw invalid();
    let error: string | null = null;
    if (!body.ok) {
      error = sanitizePrinterError(body.error);
    }
    const status: JobStatus = body.ok ? "done" : "failed";
    const results = await db.batch<{ id: number }>([
      db
        .prepare(
          `UPDATE print_jobs SET status = ?1, error = ?2, finished_at = ?3, heartbeat_at = ?3, raster = NULL
           WHERE id = ?4 AND status = 'printing' RETURNING id`,
        )
        .bind(status, error, iso(now), id),
      touchPrinterStatement(db, now),
    ]);
    if (results[0].results[0]) return c.json({ ok: true });
    // すでに終わっている: 同じ結果なら再送として 200、違えば 409
    const row = await db.prepare("SELECT status, error FROM print_jobs WHERE id = ?1").bind(id).first<{ status: JobStatus; error: string | null }>();
    if (!row) throw notFound();
    if (row.status === status && (status === "done" || row.error === error)) return c.json({ ok: true });
    throw conflict();
  });

  return app;
}
