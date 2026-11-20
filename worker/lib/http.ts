// 入力と応答の共通の決まり（docs/api.md「2. 入力と応答の共通の決まり」）。
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./types.ts";

/** 本文の上限（バイト） */
export const MAX_BODY_BYTES = 16 * 1024;

export type ErrorCode =
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "invalid_code"
  | "not_found"
  | "conflict"
  | "limit_reached"
  | "not_accepting"
  | "queue_full"
  | "stale"
  | "expired"
  | "too_large"
  | "rate_limited"
  | "internal";

/** 途中で投げて、app.onError で応答にする失敗 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }
}

export const invalid = () => new ApiError(400, "invalid");
export const notFound = () => new ApiError(404, "not_found");
export const conflict = () => new ApiError(409, "conflict");

export function errorResponse(c: Context<AppEnv>, err: ApiError): Response {
  for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
  return c.json({ error: err.code }, err.status);
}

/**
 * 本文を JSON として読む（optional なら、本文が無い・空のときは {}）。Content-Type が JSON でなければ 400、16KB を超えたら 413。
 * 大きさは解析の前に確かめる（Content-Length を見たうえで、実際に読んだバイト数でも確かめる）。
 */
export async function readJson(c: Context<AppEnv>, opts: { optional?: boolean } = {}): Promise<unknown> {
  const type = c.req.header("Content-Type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw invalid();
  const len = c.req.header("Content-Length");
  if (len !== undefined) {
    if (!/^\d+$/.test(len)) throw invalid();
    if (Number(len) > MAX_BODY_BYTES) throw new ApiError(413, "too_large");
  }
  const body = c.req.raw.body;
  if (!body) {
    if (opts.optional) return {};
    throw invalid();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ApiError(413, "too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    bytes.set(ch, off);
    off += ch.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw invalid();
  }
  // 本文が任意の API は、空の本文を {} とみなす
  if (opts.optional && text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw invalid();
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 本文がオブジェクトであること */
export function asRecord(v: unknown): Record<string, unknown> {
  if (!isRecord(v)) throw invalid();
  return v;
}

// 文字列の入力の形（長さと文字種）
/** 路線 ID（96 ビットを base64url にした 16 文字） */
export const ROUTE_ID_RE = /^[A-Za-z0-9_-]{16}$/;
/** 編集の鍵（128 ビット以上。base64url か16進で 22〜128 文字） */
export const EDIT_KEY_RE = /^[A-Za-z0-9_-]{22,128}$/;
/** clientId・requestId（画面が作るランダムな文字列。16〜64 文字） */
export const CLIENT_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** 版の印（SHA-256 の 16 進の先頭 16 文字） */
export const REV_RE = /^[0-9a-f]{16}$/;
/** 会場コード（英数字 4〜32 文字。作るのは 10 文字） */
export const EVENT_CODE_RE = /^[A-Za-z0-9]{4,32}$/;
/** 印刷の ID（連番） */
export const JOB_ID_RE = /^[1-9][0-9]{0,15}$/;
/**
 * プリンタの失敗の理由を整える（64 文字までの英数字と記号。空白は含めない）。
 * 規定外でも 400 にはしない（ファームは 200・409 以外を送り直し続けるため）。範囲外の文字は「_」にし、
 * 64 文字で切る。文字列でない・空なら "unknown"。
 */
export function sanitizePrinterError(v: unknown): string {
  if (typeof v !== "string") return "unknown";
  const out = [...v]
    .slice(0, 64)
    .map((ch) => (/^[\x21-\x7e]$/.test(ch) ? ch : "_"))
    .join("");
  return out || "unknown";
}

export function str(v: unknown, re: RegExp): string {
  if (typeof v !== "string" || !re.test(v)) throw invalid();
  return v;
}

export function jobIdParam(v: string | undefined): number {
  if (v === undefined || !JOB_ID_RE.test(v)) throw notFound();
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw notFound();
  return n;
}

/** IP（CF-Connecting-IP。無ければ unknown） */
export function clientIp(c: Context<AppEnv>): string {
  return (c.req.header("CF-Connecting-IP") ?? "unknown").slice(0, 64);
}
