// ブラウザでの保存先と乱数（テストからは読まない。中身の仕組みは kv-storage.ts の layeredStorage）。
import { layeredStorage, type LayeredStorage } from "./kv-storage.ts";

let cached: LayeredStorage | null = null;

/** localStorage を読めるか（設定によっては触るだけで例外になる） */
function readableLocalStorage(): Storage | null {
  try {
    const ls = window.localStorage;
    ls.getItem("dot-rosen:probe");
    return ls;
  } catch {
    return null;
  }
}

/**
 * 端末の保存先。読めるかどうかと書けるかどうかを分けて扱う。
 * - 書けなくても、すでにある値は読む（書けない分はこのページを開いている間だけ覚える）
 * - 書けなかったときは setItem が例外を投げる（safeSet が false を返す）ので、呼び出し元が気づける
 */
export function browserStorage(): LayeredStorage {
  if (cached) return cached;
  const ls = readableLocalStorage();
  let writable = false;
  if (ls) {
    try {
      const k = "dot-rosen:probe";
      ls.setItem(k, "1");
      ls.removeItem(k);
      writable = true;
    } catch {
      writable = false;
    }
  }
  cached = layeredStorage(ls, writable ? "ok" : ls ? "readonly" : "memory");
  return cached;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** ほかのタブで保存先が変わったとき（storage イベント）に呼ぶ */
export function onExternalStorageChange(cb: (key: string | null) => void): () => void {
  const on = (e: StorageEvent) => cb(e.key);
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}
