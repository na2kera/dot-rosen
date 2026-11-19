// 会場コードの確認と印刷の申し込み（docs/api.md「4. 公開 API」「印刷の申し込み」）。
import { Hono } from "hono";
import { parseRouteData } from "../../shared/route/index.ts";
import { buildCardRaster, type CardSnapshot } from "../lib/card.ts";
import { APP_NAME, cardOptions, iso, jstDate, jstMonthDay } from "../lib/config.ts";
import { safeEqual, sha256Hex } from "../lib/crypto.ts";
import {
  ApiError,
  asRecord,
  CLIENT_TOKEN_RE,
  clientIp,
  conflict,
  EDIT_KEY_RE,
  EVENT_CODE_RE,
  jobIdParam,
  notFound,
  readJson,
  ROUTE_ID_RE,
  str,
} from "../lib/http.ts";
import { jobProgress, MAX_QUEUED, sweepOrphansStatement } from "../lib/jobs.ts";
import { acquireAttempt, releaseAttempt } from "../lib/rate-limit.ts";
import { readSettings } from "../lib/settings.ts";
import type { AppEnv, Db, Deps } from "../lib/types.ts";
import { checkOwner, loadRoute } from "./routes.ts";

/**
 * 会場コードを確かめる。照合の前に失敗の枠を1つ取り（上限なら 429 で照合しない）、合っていれば戻す。
 * 違えば枠はそのまま（失敗を1回数えたことになる）で 403。
 */
async function checkEventCode(db: Db, code: string, ip: string, now: Date): Promise<{ eventCode: string; accepting: boolean }> {
  await acquireAttempt(db, "code", ip, now);
  const s = await readSettings(db);
  if (s.eventCode === null || !(await safeEqual(code, s.eventCode))) throw new ApiError(403, "invalid_code");
  await releaseAttempt(db, "code", ip, now);
  return { eventCode: s.eventCode, accepting: s.accepting };
}

type ExistingJob = { id: number; route_id: string; preparing: number; edit_key_hash: string | null };

/** 同じ (clientId, requestId) の印刷と、その路線の鍵のハッシュ（路線が無ければ null） */
async function existingJob(db: Db, clientId: string, requestId: string) {
  return db
    .prepare(
      `SELECT j.id, j.route_id, (j.status = 'queued' AND j.raster IS NULL) AS preparing, r.edit_key_hash
       FROM print_jobs j LEFT JOIN routes r ON r.id = j.route_id
       WHERE j.client_id = ?1 AND j.request_id = ?2`,
    )
    .bind(clientId, requestId)
    .first<ExistingJob>();
}

/**
 * 再送への応答。路線 ID が違えば 409、路線が無く鍵を確かめられなければ 404、鍵が違えば 403。
 * 路線が非公開・期限切れでも、鍵が合えば元の印刷の状態を返す（受付停止中でも返す）。
 * 画像がまだ入っていない（準備中の）印刷には成功を返さず、409 と Retry-After: 2。
 */
async function replayResponse(db: Db, prev: ExistingJob, routeId: string, editKey: string) {
  if (prev.route_id !== routeId) throw conflict();
  if (prev.edit_key_hash === null) throw notFound();
  if (!(await safeEqual(await sha256Hex(editKey), prev.edit_key_hash))) throw new ApiError(403, "forbidden");
  if (prev.preparing) throw new ApiError(409, "conflict", { "Retry-After": "2" });
  return progressResponse(db, prev.id);
}

async function progressResponse(db: Db, jobId: number) {
  const p = await jobProgress(db, jobId);
  if (!p) throw new Error("印刷が見つかりません");
  return { jobId, issueNo: p.issueNo, ahead: p.ahead, status: p.status };
}

/**
 * 発行番号の採番、条件の確認、待ちへの追加を1つの batch で行う。
 * 1. 条件（受付中・会場コード・路線が存在し非公開でなく期限内・待ちの上限・回数上限）を満たし、同じ (clientId, requestId) が無ければ、
 *    sort_key = NULL（この batch で作った印）で追加する。発行番号は issue_counter + 1。
 * 2. 1 で追加した行（sort_key IS NULL）があるときだけ issue_counter を 1 増やす。
 * 3. その行の sort_key を id にして返す。
 */
function enqueueStatements(db: Db, p: { routeId: string; clientId: string; requestId: string; eventCode: string; snapshot: string; now: string }) {
  return [
    db
      .prepare(
        `INSERT INTO print_jobs (route_id, client_id, request_id, event_code, status, issue_no, sort_key, snapshot, created_at)
         SELECT ?1, ?2, ?3, ?4, 'queued', CAST(s.value AS INTEGER) + 1, NULL, ?5, ?6
         FROM settings s
         WHERE s.key = 'issue_counter'
           AND EXISTS (SELECT 1 FROM routes WHERE id = ?1 AND hidden = 0 AND expires_at > ?6)
           AND (SELECT value FROM settings WHERE key = 'accepting') = '1'
           AND (SELECT value FROM settings WHERE key = 'event_code') = ?4
           AND (SELECT COUNT(*) FROM print_jobs WHERE status = 'queued') < ?7
           AND (SELECT COUNT(*) FROM print_jobs
                WHERE client_id = ?2 AND event_code = ?4 AND reprint_of IS NULL AND status NOT IN ('canceled', 'failed'))
               < 1 + COALESCE((SELECT extra FROM print_grants WHERE client_id = ?2 AND event_code = ?4), 0)
         ON CONFLICT (client_id, request_id) DO NOTHING`,
      )
      .bind(p.routeId, p.clientId, p.requestId, p.eventCode, p.snapshot, p.now, MAX_QUEUED),
    db
      .prepare(
        `UPDATE settings SET value = CAST(value AS INTEGER) + 1
         WHERE key = 'issue_counter'
           AND EXISTS (SELECT 1 FROM print_jobs WHERE client_id = ?1 AND request_id = ?2 AND sort_key IS NULL)`,
      )
      .bind(p.clientId, p.requestId),
    db
      .prepare("UPDATE print_jobs SET sort_key = id WHERE client_id = ?1 AND request_id = ?2 AND sort_key IS NULL RETURNING id, issue_no")
      .bind(p.clientId, p.requestId),
  ];
}

/** 追加できなかった理由を、確かめる順に調べる */
async function rejectReason(db: Db, clientId: string, eventCode: string, routeId: string, now: Date): Promise<ApiError> {
  const s = await readSettings(db);
  if (s.eventCode !== eventCode) return new ApiError(403, "invalid_code");
  if (!s.accepting) return new ApiError(409, "not_accepting");
  // 路線を確かめたあとに、非公開化・削除・期限切れになった
  const route = await loadRoute(db, routeId);
  if (!route || route.hidden) return notFound();
  if (route.expires_at <= iso(now)) return new ApiError(410, "expired");
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM print_jobs WHERE status = 'queued') AS queued,
         (SELECT COUNT(*) FROM print_jobs
          WHERE client_id = ?1 AND event_code = ?2 AND reprint_of IS NULL AND status NOT IN ('canceled', 'failed')) AS used,
         1 + COALESCE((SELECT extra FROM print_grants WHERE client_id = ?1 AND event_code = ?2), 0) AS allowed`,
    )
    .bind(clientId, eventCode)
    .first<{ queued: number; used: number; allowed: number }>();
  if (row && row.queued >= MAX_QUEUED) return new ApiError(409, "queue_full");
  if (row && row.used >= row.allowed) return new ApiError(409, "limit_reached");
  return conflict();
}

export function printApi(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/event", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const ip = clientIp(c);
    const code = c.req.query("code") ?? "";
    // 照合の前に失敗の枠を1つ取り、合っていれば戻す（並行でも上限を超えて照合しない）
    await acquireAttempt(db, "code", ip, now);
    const s = await readSettings(db);
    const valid = EVENT_CODE_RE.test(code) && s.eventCode !== null && (await safeEqual(code, s.eventCode));
    if (valid) await releaseAttempt(db, "code", ip, now);
    return c.json({ valid, accepting: s.accepting });
  });

  app.post("/print", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const ip = clientIp(c);
    const body = asRecord(await readJson(c));
    const routeId = str(body.routeId, ROUTE_ID_RE);
    const editKey = str(body.editKey, EDIT_KEY_RE);
    const code = str(body.eventCode, EVENT_CODE_RE);
    const clientId = str(body.clientId, CLIENT_TOKEN_RE);
    const requestId = str(body.requestId, CLIENT_TOKEN_RE);

    // 回数制限 → 会場コード
    const { eventCode, accepting } = await checkEventCode(db, code, ip, now);

    // 同じ (clientId, requestId) の再送なら、鍵を確かめてから元の印刷を返す
    const prev = await existingJob(db, clientId, requestId);
    if (prev) return c.json(await replayResponse(db, prev, routeId, editKey));

    // 受付中か → 路線（期限内・非公開でない・鍵が合う）
    if (!accepting) throw new ApiError(409, "not_accepting");
    const route = await checkOwner(await loadRoute(db, routeId), editKey, now);
    const parsed = parseRouteData(JSON.parse(route.data), deps.resources.lookup);
    if (!parsed.ok) throw new Error(`保存済みの路線データが検査に通りません: ${parsed.error}`);

    const opts = cardOptions(c.env);
    const snapshot: CardSnapshot = {
      route: parsed.value,
      issuedOn: jstDate(now),
      expiresOn: jstMonthDay(new Date(route.expires_at)),
      url: `${new URL(c.req.url).origin}/r/${routeId}`,
      appName: APP_NAME,
      monoSet: opts.monoSet,
      sideLayout: opts.sideLayout,
    };

    // 待ちの上限・回数上限の判定、発行番号、追加を1つの batch で
    const results = await db.batch<{ id: number; issue_no: number }>([
      sweepOrphansStatement(db, now),
      ...enqueueStatements(db, { routeId, clientId, requestId, eventCode, snapshot: JSON.stringify(snapshot), now: iso(now) }),
    ]);
    const created = results[results.length - 1].results[0];
    if (!created) {
      // 同時に届いた同じ申し込みに先を越された
      const again = await existingJob(db, clientId, requestId);
      if (again) return c.json(await replayResponse(db, again, routeId, editKey));
      throw await rejectReason(db, clientId, eventCode, routeId, now);
    }

    // 発行番号が決まったので画像を組み立てて保存する。どちらかが失敗したら印刷を消し、回数を消費しない
    try {
      const card = (deps.buildCard ?? buildCardRaster)(snapshot, created.issue_no, deps.resources);
      // 取り消された（路線の非公開化など）場合は何も書かない
      await db
        .prepare("UPDATE print_jobs SET raster = ?1, height = ?2 WHERE id = ?3 AND raster IS NULL AND status = 'queued'")
        .bind(card.raster, card.height, created.id)
        .run();
    } catch (e) {
      console.error("路線カードの組み立てか保存に失敗", { jobId: created.id, routeId, message: e instanceof Error ? e.message : String(e) });
      await db.batch([
        db.prepare("DELETE FROM print_jobs WHERE id = ?1 AND raster IS NULL").bind(created.id),
        // 後から別の番号が出ていなければ、番号を戻す
        db
          .prepare("UPDATE settings SET value = CAST(value AS INTEGER) - 1 WHERE key = 'issue_counter' AND CAST(value AS INTEGER) = ?1")
          .bind(created.issue_no),
      ]);
      throw new ApiError(500, "internal");
    }
    return c.json(await progressResponse(db, created.id));
  });

  app.get("/print/:jobId", async (c) => {
    const jobId = jobIdParam(c.req.param("jobId"));
    const clientId = c.req.query("clientId") ?? "";
    if (!CLIENT_TOKEN_RE.test(clientId)) throw notFound();
    const p = await jobProgress(c.env.DB, jobId, clientId);
    if (!p) throw notFound();
    return c.json({ status: p.status, ahead: p.ahead, issueNo: p.issueNo });
  });

  return app;
}
