// 管理 API の呼び出し（docs/api.md「6. 管理 API」）。DOM に依存しない（fetch は差し替えられる）。
import type { CardLook } from "../../shared/card/index.ts";

export type JobStatus = "queued" | "printing" | "done" | "failed" | "canceled";

export type AdminJob = {
  id: number;
  routeId: string;
  /** 申し込み時点の路線名（snapshot から） */
  routeName: string | null;
  clientId: string;
  status: JobStatus;
  issueNo: number;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** 再印刷なら元の印刷の ID */
  reprintOf: number | null;
  /** その印刷で使った見た目（記録に無い古いものは、サーバーが今の設定で埋める） */
  monoSet: CardLook["monoSet"];
  sideLayout: CardLook["sideLayout"];
};

export type AdminState = {
  accepting: boolean;
  eventCode: string;
  printer: { lastSeenAt: string | null };
  jobs: AdminJob[];
  counts: Record<JobStatus, number>;
};

export type AdminRoute = {
  id: string;
  name: string | null;
  createdAt: string;
  hidden: boolean;
};

/** API の失敗。status 0 は通信できなかったとき */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** 429 の Retry-After（秒） */
    readonly retryAfter: number | null = null,
  ) {
    super(`${status} ${code}`);
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** 応答と、それを受け取ったときのサーバーの時刻（Date ヘッダ。無ければ null） */
export type WithServerTime<T> = { body: T; serverTime: number | null };

export function createAdminApi(fetcher: Fetcher = (i, init) => fetch(i, init)) {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<WithServerTime<T>> {
    let res: Response;
    try {
      res = await fetcher(`/api/admin${path}`, {
        method,
        credentials: "same-origin",
        // 状態を変える API は Content-Type: application/json が必須（本文が要らないものも {} を送る）
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) } : {}),
      });
    } catch {
      throw new AdminApiError(0, "network");
    }
    if (!res.ok) {
      let code = "unknown";
      try {
        const j = (await res.json()) as { error?: unknown };
        if (typeof j.error === "string") code = j.error;
      } catch {
        // 本文が JSON でない
      }
      const ra = Number(res.headers.get("Retry-After"));
      throw new AdminApiError(res.status, code, Number.isFinite(ra) && ra > 0 ? ra : null);
    }
    const date = Date.parse(res.headers.get("Date") ?? "");
    let parsed: T;
    try {
      parsed = (await res.json()) as T;
    } catch {
      throw new AdminApiError(res.status, "bad_response");
    }
    return { body: parsed, serverTime: Number.isFinite(date) ? date : null };
  }
  const post = <T>(path: string, body?: unknown) => call<T>("POST", path, body).then((r) => r.body);

  return {
    login: (password: string) => post<{ ok: true; expiresAt: string }>("/login", { password }),
    logout: () => post<{ ok: true }>("/logout"),
    state: () => call<AdminState>("GET", "/state"),
    cancel: (jobId: number) => post<{ ok: true }>(`/jobs/${jobId}/cancel`),
    /** look を省くと元の印刷と同じ見た目。指定した項目だけ、その再印刷の見た目を変える（刷り比べ用） */
    reprint: (jobId: number, look: Partial<CardLook> = {}) =>
      post<{ jobId: number; issueNo: number; card: CardLook }>(`/jobs/${jobId}/reprint`, look),
    grant: (clientId: string) => post<{ ok: true; extra: number }>(`/clients/${encodeURIComponent(clientId)}/grant`),
    setAccepting: (accepting: boolean) => post<{ ok: true; accepting: boolean }>("/accepting", { accepting }),
    regenerateEventCode: () => post<{ eventCode: string }>("/event-code/regenerate"),
    routes: () => call<{ routes: AdminRoute[] }>("GET", "/routes").then((r) => r.body.routes),
    setHidden: (routeId: string, hidden: boolean) =>
      post<{ ok: true; hidden: boolean; canceled: number }>(`/routes/${encodeURIComponent(routeId)}/hide`, { hidden }),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

/**
 * ログアウトする。ログアウトできた（またはもうログインが切れていた = 401）なら true。
 * 通信の失敗などで Cookie が消えたか分からないときは false（画面はログインに戻さず、やり直してもらう）
 */
export async function tryLogout(api: Pick<AdminApi, "logout">): Promise<boolean> {
  try {
    await api.logout();
    return true;
  } catch (e) {
    return e instanceof AdminApiError && e.status === 401;
  }
}
