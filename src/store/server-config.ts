// サーバーの設定値（GET /api/config）。印刷プレビューを実際の印刷と同じ見た目で描くために使う。
// 取得に失敗したら既定値（bold / two-x1）で動かす（エラーにはしない）。DOM にも React にも依存しない。
import { DEFAULT_CARD_LOOK, toCardLook, type CardLook } from "../../shared/card/index.ts";
import type { Api } from "../api/client.ts";
import { createStore, type Store } from "./create-store.ts";

export type ServerConfig = {
  readonly card: CardLook;
  /** 有効期限の日数（取れなければ null） */
  readonly expiryDays: number | null;
};

export const DEFAULT_SERVER_CONFIG: ServerConfig = { card: DEFAULT_CARD_LOOK, expiryDays: null };

/** 取得を待つ上限。これを過ぎたら既定値で進める（読み込みを止めない） */
export const CONFIG_TIMEOUT_MS = 5000;

/** 応答を読む。足りない・不正な項目は既定値にする */
export function parseServerConfig(v: unknown): ServerConfig {
  const r = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const days = r.expiryDays;
  return {
    card: toCardLook(r.card),
    expiryDays: typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null,
  };
}

export type ConfigLoader = {
  readonly store: Store<ServerConfig>;
  /** 取得する（失敗しても reject しない）。取れたものは使い回し、失敗したら次の呼び出しで取り直す */
  load(): Promise<ServerConfig>;
};

export function createConfigLoader(api: Pick<Api, "getConfig">, timeoutMs = CONFIG_TIMEOUT_MS): ConfigLoader {
  const store = createStore<ServerConfig>(DEFAULT_SERVER_CONFIG);
  let loaded: Promise<ServerConfig> | null = null;
  let pending: Promise<ServerConfig> | null = null;

  function load(): Promise<ServerConfig> {
    if (loaded) return loaded;
    if (pending) return pending;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<null>((res) => {
      timer = setTimeout(() => res(null), timeoutMs);
    });
    const fetched = api.getConfig().then(
      (r) => (r.ok ? parseServerConfig(r.value) : null),
      () => null,
    );
    const p = Promise.race([fetched, timeout]).then((cfg) => {
      if (timer !== null) clearTimeout(timer);
      pending = null;
      if (cfg) {
        loaded = Promise.resolve(cfg);
        store.set(cfg);
        return cfg;
      }
      // 時間切れのあとに届いたものは取り込む
      void fetched.then((late) => {
        if (late && !loaded) {
          loaded = Promise.resolve(late);
          store.set(late);
        }
      });
      return store.get();
    });
    pending = p;
    return p;
  }

  return { store, load };
}
