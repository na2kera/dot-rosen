// 画面の試験で使う偽のサーバー（docs/api.md の取り決めどおりに答える）。
// 版の印（rev）は、サーバーと同じく保存した内容の SHA-256 の先頭 16 文字。印刷の申し込みでは rev を確かめ、違えば 409 stale。
import { createHash } from "node:crypto";
import type { FetchLike } from "../src/api/client.ts";

export type Call = { method: string; path: string; headers: Record<string, string>; body: Record<string, unknown> | null };

export type FakeJob = {
  clientId: string;
  requestId: string;
  status: string;
  ahead: number;
  issueNo: number;
  /** その印刷が実際に使った内容と版の印、発行日（snapshot の代わり）。古い印刷は rev が null */
  rev?: string | null;
  data?: unknown;
  issuedOn?: string;
};

/** サーバーと同じ作り方の版の印 */
export const revOf = (data: unknown): string => createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);

const REV = /^[0-9a-f]{16}$/;

export function fakeServer() {
  const calls: Call[] = [];
  const routes = new Map<string, { key: string; data: unknown; rev: string }>();
  const jobs = new Map<number, FakeJob>();
  let seq = 0;
  let jobSeq = 0;
  /** 次の n 回を「届いて処理されたが、応答が返ってこない」にする */
  let failNext = 0;
  /** 次の n 回を「届かない」にする */
  let dropNext = 0;
  /** 次の応答を差し替える */
  const overrides: (((c: Call) => Response | null) | null)[] = [];
  /** 次のリクエストは処理するが、応答は放すまで返さない */
  const holds: ((release: () => void) => void)[] = [];
  const state = { today: "2026.11.20" };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

  const fetchFn: FetchLike = async (input, init) => {
    const url = new URL(input, "http://x");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const call: Call = { method: init?.method ?? "GET", path: url.pathname + url.search, headers, body };
    calls.push(call);
    if (dropNext > 0) {
      dropNext--;
      throw new TypeError("Failed to fetch");
    }
    const o = overrides.shift();
    if (o) {
      const r = o(call);
      if (r) return r;
    }
    if (headers["Content-Type"] !== "application/json") return json(400, { error: "invalid" });
    if (failNext > 0) {
      failNext--;
      // サーバーには届いたが、応答が返ってこなかったことにする
      handle(call);
      throw new TypeError("Failed to fetch");
    }
    const hold = holds.shift();
    const res = handle(call);
    if (hold) await new Promise<void>((r) => hold(r));
    return res;
  };

  function handle(c: Call): Response {
    const m = c.path.match(/^\/api\/routes(?:\/([^/?]+))?/);
    if (m && c.method === "POST") {
      const key = String(c.body!.editKey);
      for (const [id, r] of routes)
        if (r.key === key) {
          r.data = c.body!.data;
          r.rev = revOf(r.data);
          return json(200, { id, rev: r.rev });
        }
      const id = `ROUTE${String(++seq).padStart(11, "0")}`;
      routes.set(id, { key, data: c.body!.data, rev: revOf(c.body!.data) });
      return json(200, { id, rev: revOf(c.body!.data) });
    }
    if (m && c.method === "GET" && m[1]) {
      const r = routes.get(m[1]);
      if (!r) return json(404, { error: "not_found" });
      return json(200, { id: m[1], data: r.data, rev: r.rev });
    }
    if (m && c.method === "PUT") {
      const r = routes.get(m[1]);
      if (!r) return json(404, { error: "not_found" });
      if (r.key !== c.headers["X-Edit-Key"]) return json(403, { error: "forbidden" });
      r.data = c.body!.data;
      r.rev = revOf(r.data);
      return json(200, { ok: true, rev: r.rev });
    }
    if (m && c.method === "DELETE") {
      const r = routes.get(m[1]);
      if (!r) return json(404, { error: "not_found" });
      if (r.key !== c.headers["X-Edit-Key"]) return json(403, { error: "forbidden" });
      routes.delete(m[1]);
      return json(200, { ok: true });
    }
    if (c.path === "/api/print" && c.method === "POST") {
      const b = c.body!;
      if (typeof b.rev !== "string" || !REV.test(b.rev)) return json(400, { error: "invalid" });
      const reply = (jobId: number, j: FakeJob) =>
        json(200, { jobId, issueNo: j.issueNo, ahead: j.ahead, status: j.status, rev: j.rev ?? null, issuedOn: j.issuedOn ?? state.today });
      for (const [jobId, j] of jobs) if (j.clientId === b.clientId && j.requestId === b.requestId) return reply(jobId, j);
      const route = routes.get(String(b.routeId));
      if (!route) return json(404, { error: "not_found" });
      if (route.key !== b.editKey) return json(403, { error: "forbidden" });
      if (route.rev !== b.rev) return json(409, { error: "stale" });
      const jobId = ++jobSeq;
      const job: FakeJob = {
        clientId: String(b.clientId),
        requestId: String(b.requestId),
        status: "queued",
        ahead: 2,
        issueNo: 40 + jobId,
        rev: route.rev,
        data: route.data,
        issuedOn: state.today,
      };
      jobs.set(jobId, job);
      return reply(jobId, job);
    }
    const pm = c.path.match(/^\/api\/print\/(\d+)\?clientId=(.+)$/);
    if (pm && c.method === "GET") {
      const j = jobs.get(Number(pm[1]));
      if (!j || j.clientId !== decodeURIComponent(pm[2])) return json(404, { error: "not_found" });
      return json(200, { status: j.status, ahead: j.ahead, issueNo: j.issueNo });
    }
    return json(404, { error: "not_found" });
  }

  return {
    fetchFn,
    calls,
    routes,
    jobs,
    json,
    state,
    failOnce: (n = 1) => {
      failNext = n;
    },
    dropOnce: (n = 1) => {
      dropNext = n;
    },
    override: (f: (c: Call) => Response | null) => overrides.push(f),
    /** 次のリクエストの応答を止める。返す関数で放す */
    hold: (): (() => void) => {
      let release: (() => void) | null = null;
      let released = false;
      holds.push((r) => {
        if (released) r();
        else release = r;
      });
      return () => {
        released = true;
        release?.();
      };
    },
  };
}
