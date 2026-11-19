// ブラウザでの保存先と乱数（テストからは読まない）。
import { memoryStorage, type KeyValueStorage } from "./kv-storage.ts";

let cached: KeyValueStorage | null = null;

/** localStorage（使えない端末では記憶だけの保存先） */
export function browserStorage(): KeyValueStorage {
  if (cached) return cached;
  try {
    const ls = window.localStorage;
    const k = "dot-rosen:probe";
    ls.setItem(k, "1");
    ls.removeItem(k);
    cached = ls;
  } catch {
    cached = memoryStorage();
  }
  return cached;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
