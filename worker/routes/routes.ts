// 路線の保存・取得・上書き・削除（docs/api.md「4. 公開 API」）。
import { Hono } from "hono";
import { parseRouteData, type RouteData } from "../../shared/route/index.ts";
import { iso } from "../lib/config.ts";
import { newRouteId, routeRev, safeEqual, sha256Hex } from "../lib/crypto.ts";
import { ApiError, asRecord, clientIp, EDIT_KEY_RE, notFound, readJson, ROUTE_ID_RE, str } from "../lib/http.ts";
import { acquireAttempt } from "../lib/rate-limit.ts";
import type { AppEnv, Db, Deps, Resources } from "../lib/types.ts";

/** 路線データを検査する。通らなければ 400（8KB を超えるものは 413）。理由も返す */
export function checkRouteData(input: unknown, res: Resources): RouteData {
  const r = parseRouteData(input, res.lookup);
  if (r.ok) return r.value;
  if (r.error === "too_large") throw new ApiError(413, "too_large");
  throw new RouteDataError(r.error);
}

/** 路線データの検査に通らなかった（400。応答に reason を添える） */
export class RouteDataError extends ApiError {
  constructor(readonly reason: string) {
    super(400, "invalid");
  }
}

export type RouteRow = {
  id: string;
  edit_key_hash: string;
  data: string;
  created_at: string;
  hidden: number;
};

export async function loadRoute(db: Db, id: string): Promise<RouteRow | null> {
  return db
    .prepare("SELECT id, edit_key_hash, data, created_at, hidden FROM routes WHERE id = ?1")
    .bind(id)
    .first<RouteRow>();
}

/** 編集の鍵で路線を確かめる。無い・非公開は 404、鍵が違えば 403 */
export async function checkOwner(row: RouteRow | null, editKey: string | undefined): Promise<RouteRow> {
  if (!row || row.hidden) throw notFound();
  if (editKey === undefined || !EDIT_KEY_RE.test(editKey)) throw new ApiError(403, "forbidden");
  if (!(await safeEqual(await sha256Hex(editKey), row.edit_key_hash))) throw new ApiError(403, "forbidden");
  return row;
}

export function routesApi(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.post("/routes", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    await acquireAttempt(db, "create", clientIp(c), now);
    const body = asRecord(await readJson(c));
    const editKey = str(body.editKey, EDIT_KEY_RE);
    const data = checkRouteData(body.data, deps.resources);
    const hash = await sha256Hex(editKey);
    const nowIso = iso(now);
    // 同じ鍵ならその路線を上書きして同じ id を返す（非公開でないものだけ）
    const row = await db
      .prepare(
        `INSERT INTO routes (id, edit_key_hash, data, created_at, updated_at, hidden)
         VALUES (?1, ?2, ?3, ?4, ?4, 0)
         ON CONFLICT (edit_key_hash) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
           WHERE routes.hidden = 0
         RETURNING id, data`,
      )
      .bind(newRouteId(), hash, JSON.stringify(data), nowIso)
      .first<{ id: string; data: string }>();
    // rev は上書き後に保存されている文字列から作る
    if (row) return c.json({ id: row.id, rev: await routeRev(row.data) });
    // 同じ鍵の路線が非公開になっている
    throw notFound();
  });

  app.get("/routes/:id", async (c) => {
    const id = c.req.param("id");
    if (!ROUTE_ID_RE.test(id)) throw notFound();
    const row = await loadRoute(c.env.DB, id);
    if (!row || row.hidden) throw notFound();
    return c.json({ id: row.id, data: JSON.parse(row.data) as RouteData, rev: await routeRev(row.data) });
  });

  app.put("/routes/:id", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const id = c.req.param("id");
    if (!ROUTE_ID_RE.test(id)) throw notFound();
    const body = asRecord(await readJson(c));
    const data = checkRouteData(body.data, deps.resources);
    const route = await checkOwner(await loadRoute(db, id), c.req.header("X-Edit-Key"));
    const nowIso = iso(now);
    const row = await db
      .prepare(
        `UPDATE routes SET data = ?1, updated_at = ?2
         WHERE id = ?3 AND edit_key_hash = ?4 AND hidden = 0
         RETURNING data`,
      )
      .bind(JSON.stringify(data), nowIso, id, route.edit_key_hash)
      .first<{ data: string }>();
    if (!row) {
      // 確かめてから書くまでの間に、非公開・削除になった
      await checkOwner(await loadRoute(db, id), c.req.header("X-Edit-Key"));
      throw new ApiError(409, "conflict");
    }
    return c.json({ ok: true, rev: await routeRev(row.data) });
  });

  app.delete("/routes/:id", async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const id = c.req.param("id");
    if (!ROUTE_ID_RE.test(id)) throw notFound();
    const route = await checkOwner(await loadRoute(db, id), c.req.header("X-Edit-Key"));
    // 待ちの印刷の取り消しと、路線の削除を1つのトランザクションで
    await db.batch([
      db
        .prepare(
          `UPDATE print_jobs SET status = 'canceled', finished_at = ?1, raster = NULL
           WHERE route_id = ?2 AND status = 'queued' AND EXISTS (SELECT 1 FROM routes WHERE id = ?2 AND edit_key_hash = ?3)`,
        )
        .bind(iso(now), id, route.edit_key_hash),
      db.prepare("DELETE FROM routes WHERE id = ?1 AND edit_key_hash = ?2").bind(id, route.edit_key_hash),
    ]);
    return c.json({ ok: true });
  });

  return app;
}
