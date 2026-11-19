// 乱数の ID、ハッシュ、署名、時間差の出にくい比較。Web Crypto だけを使う。

const enc = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 路線 ID（96 ビット、base64url で 16 文字） */
export function newRouteId(): string {
  return base64url(randomBytes(12));
}

/** 再印刷の request_id などに使う、推測できない文字列（128 ビット） */
export function newToken(): string {
  return base64url(randomBytes(16));
}

// 紛らわしい文字（0 O 1 I L）を除いた英大文字と数字（31 文字）
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** 会場コードの文字数。31^10 ≒ 2^49.5（40 ビット以上） */
export const EVENT_CODE_LENGTH = 10;

/** 会場コード（偏りが出ないよう、範囲外の乱数は捨てて引き直す） */
export function newEventCode(): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < EVENT_CODE_LENGTH) {
    for (const b of randomBytes(16)) {
      if (b >= limit) continue;
      out += CODE_ALPHABET[b % n];
      if (out.length === EVENT_CODE_LENGTH) break;
    }
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return hex(new Uint8Array(sig));
}

/**
 * 時間差の出にくい比較。長さの違いも漏らさないよう、両方を SHA-256 にしてから全バイトを比べる。
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && a.length === b.length;
}
