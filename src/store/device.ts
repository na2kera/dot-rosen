// 端末ごとの値（clientId、会場コード、初回の案内を見たか）。DOM に依存しない。
import { safeGet, safeRemove, safeSet, STORAGE_KEYS, type KeyValueStorage } from "./kv-storage.ts";

export type RandomBytes = (n: number) => Uint8Array;

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** clientId（128 ビットの乱数を16進で）を読む。無ければ作って保存する */
export function getOrCreateClientId(storage: KeyValueStorage, random: RandomBytes): string {
  const saved = safeGet(storage, STORAGE_KEYS.clientId);
  if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
  const id = toHex(random(16));
  safeSet(storage, STORAGE_KEYS.clientId, id);
  return id;
}

/** 会場コードとして受け付ける形（形の確認はサーバーが行うので、ここは緩くする） */
const EVENT_CODE = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * URL の ?event=<コード> を端末に覚え、URL から消したものを返す。
 * 消すものが無ければ null（URL を書き換えなくてよい）。
 */
export function captureEventCode(href: string, storage: KeyValueStorage): string | null {
  const url = new URL(href);
  if (!url.searchParams.has("event")) return null;
  const code = url.searchParams.get("event") ?? "";
  if (EVENT_CODE.test(code)) safeSet(storage, STORAGE_KEYS.eventCode, code);
  url.searchParams.delete("event");
  return url.pathname + url.search + url.hash;
}

export function getEventCode(storage: KeyValueStorage): string | null {
  const v = safeGet(storage, STORAGE_KEYS.eventCode);
  return v && EVENT_CODE.test(v) ? v : null;
}

export function clearEventCode(storage: KeyValueStorage): void {
  safeRemove(storage, STORAGE_KEYS.eventCode);
}

export function isHintSeen(storage: KeyValueStorage): boolean {
  return safeGet(storage, STORAGE_KEYS.hintSeen) === "1";
}

export function markHintSeen(storage: KeyValueStorage): void {
  safeSet(storage, STORAGE_KEYS.hintSeen, "1");
}
