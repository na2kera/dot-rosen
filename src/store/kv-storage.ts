// 端末への保存先（localStorage と同じ形）。テストでは記憶だけの実装を渡す。
// DOM に依存しない（ブラウザの localStorage を包むものは browser.ts）。

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** 保存のキー（ほかの担当もここに足す） */
export const STORAGE_KEYS = {
  draft: "dot-rosen:draft",
  clientId: "dot-rosen:client-id",
  eventCode: "dot-rosen:event-code",
  hintSeen: "dot-rosen:hint-seen",
  // 保存した路線（編集の鍵、id、期限、保存した時点の内容）
  saved: "dot-rosen:saved",
  // 印刷の申し込み（requestId、jobId、状態）
  print: "dot-rosen:print",
} as const;

/** 記憶だけの保存先（テストや、localStorage が使えない端末用） */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/** 読み書きの失敗（容量不足、使えない設定など）で止まらないようにする */
export function safeGet(s: KeyValueStorage, key: string): string | null {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(s: KeyValueStorage, key: string, value: string): boolean {
  try {
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(s: KeyValueStorage, key: string): void {
  try {
    s.removeItem(key);
  } catch {
    // 何もしない
  }
}
