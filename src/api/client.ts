// 公開 API（docs/api.md「4. 公開 API」）の呼び出しを1か所に集める。DOM に依存しない（fetch は引数で受け取る）。
import type { RouteData } from "../../shared/route/index.ts";
import { routeErrorText } from "../store/route-errors.ts";

/** サーバーのエラーコード（docs/api.md「2.」）と、通信そのものの失敗 */
export type ApiErrorCode =
  | "invalid"
  | "forbidden"
  | "invalid_code"
  | "not_found"
  | "conflict"
  | "limit_reached"
  | "not_accepting"
  | "queue_full"
  | "expired"
  | "too_large"
  | "rate_limited"
  | "internal"
  | "network"
  // 端末に保存できなかった（サーバーには送っていない）
  | "storage";

export type ApiFailure = {
  ok: false;
  code: ApiErrorCode;
  /** HTTP ステータス（通信の失敗は 0） */
  status: number;
  /** 路線データの検査に通らなかった理由（400 のとき） */
  reason?: string;
  /** 429 のときの待ち秒数 */
  retryAfter?: number;
};

export type ApiResult<T> = { ok: true; value: T } | ApiFailure;

export type PrintStatus = "queued" | "printing" | "done" | "failed" | "canceled";

export type PrintProgress = { status: PrintStatus; ahead: number; issueNo: number };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const KNOWN: readonly string[] = [
  "invalid",
  "forbidden",
  "invalid_code",
  "not_found",
  "conflict",
  "limit_reached",
  "not_accepting",
  "queue_full",
  "expired",
  "too_large",
  "rate_limited",
  "internal",
];

/** ステータスだけで決める（本文が読めなかったとき） */
function codeFromStatus(status: number): ApiErrorCode {
  if (status === 400) return "invalid";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 410) return "expired";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  return "internal";
}

export function createApi(fetchFn: FetchLike, base = "") {
  async function call<T>(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetchFn(base + path, {
        method,
        // 公開 API も JSON の Content-Type が必須
        headers: { "Content-Type": "application/json", ...opts.headers },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      return { ok: false, code: "network", status: 0 };
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (res.ok) {
      if (json === null || typeof json !== "object") return { ok: false, code: "network", status: res.status };
      return { ok: true, value: json as T };
    }
    const body = (json ?? {}) as { error?: unknown; reason?: unknown };
    const code = typeof body.error === "string" && KNOWN.includes(body.error) ? (body.error as ApiErrorCode) : codeFromStatus(res.status);
    const fail: ApiFailure = { ok: false, code, status: res.status };
    if (typeof body.reason === "string") fail.reason = body.reason;
    const ra = Number(res.headers.get("Retry-After"));
    if (Number.isFinite(ra) && ra > 0) fail.retryAfter = ra;
    return fail;
  }

  const enc = encodeURIComponent;

  return {
    createRoute: (data: RouteData, editKey: string) => call<{ id: string; expiresAt: string }>("POST", "/api/routes", { body: { data, editKey } }),
    getRoute: (id: string) => call<{ id: string; data: unknown; expiresAt: string }>("GET", `/api/routes/${enc(id)}`),
    updateRoute: (id: string, data: RouteData, editKey: string) =>
      call<{ ok: true; expiresAt: string }>("PUT", `/api/routes/${enc(id)}`, { body: { data }, headers: { "X-Edit-Key": editKey } }),
    deleteRoute: (id: string, editKey: string) => call<{ ok: true }>("DELETE", `/api/routes/${enc(id)}`, { headers: { "X-Edit-Key": editKey } }),
    checkEvent: (code: string) => call<{ valid: boolean; accepting: boolean }>("GET", `/api/event?code=${enc(code)}`),
    requestPrint: (p: { routeId: string; editKey: string; eventCode: string; clientId: string; requestId: string }) =>
      // card は、その印刷で使う見た目（古いサーバーは返さないので任意）
      call<PrintProgress & { jobId: number; card?: unknown }>("POST", "/api/print", { body: p }),
    printStatus: (jobId: number, clientId: string) => call<PrintProgress>("GET", `/api/print/${jobId}?clientId=${enc(clientId)}`),
    /** 今のサーバーの設定値（中身の検査は src/store/server-config.ts） */
    getConfig: () => call<unknown>("GET", "/api/config"),
  };
}

export type Api = ReturnType<typeof createApi>;

/** エラーを、来場者に分かる言葉にする */
export function errorMessage(f: Pick<ApiFailure, "code" | "reason">): string {
  switch (f.code) {
    case "storage":
      return "この端末に保存できないため、URL を作れません（プライベートモードや空き容量を確かめてね）";
    case "network":
      return "通信できませんでした。電波のよい所で もういちど ためしてね";
    case "invalid_code":
      return "会場コードがちがいます。会場の QR コードを もういちど読みこんでね";
    case "not_accepting":
      return "いまは印刷の受付をお休みしています。少し待ってね";
    case "queue_full":
      return "印刷待ちがいっぱいです。少し待ってから もういちど押してね";
    case "limit_reached":
      return "この端末は もう印刷ずみです。もういちど刷りたいときは係の人に声をかけてね";
    case "rate_limited":
      return "たくさん送られたので ひと休み中です。少し時間をおいてね";
    case "forbidden":
      return "この路線を変える鍵が、この端末にありません";
    case "not_found":
      return "路線が見つかりませんでした";
    case "expired":
      return "見られる期限が切れています";
    case "too_large":
      return "路線のデータが大きすぎます";
    case "invalid":
      return (f.reason && routeErrorText(f.reason)) || "送った内容に まちがいがあります";
    case "conflict":
      return "いまは できません。少し待って もういちど ためしてね";
    case "internal":
      return "サーバーで問題が起きました。少し待って もういちど ためしてね";
  }
}
