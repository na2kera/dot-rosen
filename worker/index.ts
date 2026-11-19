// Cloudflare Worker の入口。/api/* だけがここに来る（それ以外は静的ファイル）。
import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

// 未定義の API は JSON で 404 を返す
app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
