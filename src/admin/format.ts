// 管理画面の表示用の小さな処理。DOM にも React にも依存しない。
import { AdminApiError, type AdminJob, type JobStatus } from "./api.ts";

/** 状態の問い合わせの間隔 */
export const POLL_MS = 5000;

/**
 * プリンタを「つながっていない」とみなす経過時間。
 * サーバーは printer_last_seen を 30 秒に1回しか書き換えない（worker/lib/settings.ts の touchPrinterStatement）ので、
 * プリンタが3秒おきに問い合わせていても、記録上の経過は最大 30 秒＋3 秒ほどになる。
 * 生きているのに赤にしないよう、記録の間隔（30 秒）＋問い合わせの間隔（3 秒）＋余裕で 45 秒とする
 * （claim・rows・done のどれでも記録されるので、印刷中も記録は続く）。
 */
export const PRINTER_OFFLINE_MS = 45_000;

/** 「3秒前」「2分前」「1時間前」「2日前」 */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

export type PrinterView = { online: boolean; label: string; detail: string };

/** プリンタの状態。now はサーバーの時計に合わせた今の時刻 */
export function printerView(lastSeenAt: string | null, now: number): PrinterView {
  const t = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (!Number.isFinite(t)) return { online: false, label: "つながっていません", detail: "まだ一度も問い合わせがありません" };
  const age = now - t;
  if (age >= PRINTER_OFFLINE_MS) return { online: false, label: "つながっていません", detail: `最後の問い合わせ ${elapsedText(age)}` };
  return { online: true, label: "つながっています", detail: `最後の記録 ${elapsedText(age)}（30秒ごとに記録）` };
}

export type JobTone = "wait" | "busy" | "ok" | "bad" | "off";

export type JobView = { label: string; tone: JobTone; note: string | null };

export function jobView(job: Pick<AdminJob, "status" | "error">): JobView {
  switch (job.status) {
    case "queued":
      return { label: "待ち", tone: "wait", note: null };
    case "printing":
      return { label: "印刷中", tone: "busy", note: null };
    case "done":
      return { label: "完了", tone: "ok", note: null };
    case "canceled":
      return { label: "取り消し済み", tone: "off", note: null };
    case "failed":
      if (job.error === "timeout")
        return { label: "結果不明", tone: "bad", note: "結果が分かりません（紙が出ているか確かめてください）" };
      return { label: "失敗", tone: "bad", note: job.error ? `理由: ${job.error}` : null };
  }
}

export type JobActions = { cancel: boolean; reprint: boolean };

/**
 * 行に出す操作（「この端末にもう1回許可」はどの行にも出す）。
 * 再印刷は、サーバーが受け付ける done / failed だけ（canceled は 409 になる。worker/routes/admin.ts）。
 */
export function jobActions(status: JobStatus): JobActions {
  return { cancel: status === "queued", reprint: status === "done" || status === "failed" };
}

const timeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 日本時間の「11/20 14:03」 */
export function formatTime(isoText: string | null): string {
  const t = isoText ? Date.parse(isoText) : NaN;
  if (!Number.isFinite(t)) return "—";
  const parts = Object.fromEntries(timeFmt.formatToParts(t).map((p) => [p.type, p.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 発行番号（No.0042） */
export const issueText = (n: number) => `No.${String(n).padStart(4, "0")}`;

/** 会場の QR コードに入れる URL */
export function eventUrl(origin: string, code: string): string {
  return `${origin}/?event=${encodeURIComponent(code)}`;
}

/** 路線ページの URL */
export const routePath = (id: string) => `/r/${encodeURIComponent(id)}`;

/** 何分待てばよいか（切り上げ。最低1分） */
const waitMinutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));

/** ログインの失敗の理由 */
export function loginErrorText(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 401) return "パスワードが違います";
    if (e.status === 429)
      return e.retryAfter ? `失敗が続いたため止めています。${waitMinutes(e.retryAfter)}分ほど待ってからためしてください` : "失敗が続いたため止めています。しばらく待ってからためしてください";
    if (e.status === 0) return "通信できませんでした。電波を確かめてください";
  }
  return "ログインできませんでした（サーバーの不具合）";
}

/** 操作の失敗の理由（短いお知らせ用） */
export function actionErrorText(e: unknown, kind: "cancel" | "reprint" | "grant" | "accepting" | "regenerate" | "hide" | "load"): string {
  if (e instanceof AdminApiError) {
    if (e.status === 0) return "通信できませんでした";
    if (e.status === 401) return "ログインが切れました";
    if (e.status === 404) return "見つかりません（消えた可能性があります）";
    if (e.status === 409) {
      if (kind === "cancel") return "取り消せません（もう印刷が始まっています）";
      if (kind === "reprint") return "再印刷できません（路線が消えたか非公開です）";
      return "今の状態ではできません";
    }
    if (e.status === 403) return "操作を受け付けませんでした（開き直してください）";
  }
  return "失敗しました（サーバーの不具合）";
}
