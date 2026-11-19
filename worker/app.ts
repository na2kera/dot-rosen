// API の本体。駅データ・フォント・時計を外から受け取るので、Node 上のテストからも同じものを動かせる。
import { Hono } from "hono";
import { ApiError, errorResponse } from "./lib/http.ts";
import type { AppEnv, Deps } from "./lib/types.ts";
import { adminApi } from "./routes/admin.ts";
import { printApi } from "./routes/print.ts";
import { printerApi } from "./routes/printer.ts";
import { RouteDataError, routesApi } from "./routes/routes.ts";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath("/api");

  // すべての API 応答に Cache-Control: no-store
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", routesApi(deps));
  app.route("/", printApi(deps));
  app.route("/", printerApi(deps));
  app.route("/", adminApi(deps));

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err, c) => {
    if (err instanceof RouteDataError) return c.json({ error: err.code, reason: err.reason }, err.status);
    if (err instanceof ApiError) return errorResponse(c, err);
    // 詳細は応答に出さない（ログには秘密の値を含めない）
    console.error("予期しない失敗", c.req.method, c.req.path, err instanceof Error ? err.message : String(err));
    return c.json({ error: "internal" }, 500);
  });

  return app;
}
