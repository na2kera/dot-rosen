import { useCallback, useSyncExternalStore } from "react";
import type { Store } from "./create-store.ts";

/**
 * ストアの値を読む。selector は状態の一部をそのまま返すもの（新しいオブジェクトを作らない）にする。
 */
export function useStore<T, U = T>(store: Store<T>, selector?: (s: T) => U): U {
  const get = useCallback(() => (selector ? selector(store.get()) : (store.get() as unknown as U)), [store, selector]);
  return useSyncExternalStore(store.subscribe, get);
}
