// 小さな状態の入れ物（購読つき）。React からは use-store.ts の useStore で読む。
// DOM にも React にも依存しない。

export type Listener = () => void;

export type Store<T> = {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: Listener): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
