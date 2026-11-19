// 管理画面の状態の問い合わせと、二重押しの防止。
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError, type AdminApi, type AdminState } from "./api.ts";
import { POLL_MS } from "./format.ts";

export type Polled = {
  state: AdminState | null;
  /** サーバーの時計 − 端末の時計（ミリ秒）。Date ヘッダから求める */
  clockOffset: number;
  /** 最後に取得できた端末の時刻 */
  updatedAt: number | null;
  /** 直近の問い合わせが失敗していれば true */
  failing: boolean;
  /** すぐに問い合わせる。操作のあとに呼ぶ */
  refresh(): Promise<void>;
  /** 操作を始めたことを知らせる（それより前に出た問い合わせの応答は捨てる） */
  bump(): void;
};

/**
 * 5 秒おきに GET /api/admin/state を呼ぶ。画面が裏に回っている間は止め、戻ったらすぐ呼ぶ。
 * 401 なら onUnauthorized。
 */
export function useAdminState(api: AdminApi, initial: AdminState | null, initialOffset: number, onUnauthorized: () => void): Polled {
  const [state, setState] = useState<AdminState | null>(initial);
  const [clockOffset, setClockOffset] = useState(initialOffset);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initial ? Date.now() : null);
  const [failing, setFailing] = useState(false);
  const gen = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const unauth = useRef(onUnauthorized);
  unauth.current = onUnauthorized;

  const schedule = useCallback((fetchNow: () => Promise<void>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!alive.current || document.visibilityState === "hidden") return;
    timer.current = setTimeout(() => void fetchNow(), POLL_MS);
  }, []);

  const fetchNow = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    const myGen = gen.current;
    const p = (async () => {
      try {
        const { body, serverTime } = await api.state();
        if (!alive.current || myGen !== gen.current) return;
        setState(body);
        if (serverTime !== null) setClockOffset(serverTime - Date.now());
        setUpdatedAt(Date.now());
        setFailing(false);
      } catch (e) {
        if (!alive.current) return;
        if (e instanceof AdminApiError && e.status === 401) {
          unauth.current();
          return;
        }
        setFailing(true);
      } finally {
        inflight.current = null;
        schedule(fetchNow);
      }
    })();
    inflight.current = p;
    return p;
  }, [api, schedule]);

  const refresh = useCallback(async () => {
    // 動いている問い合わせは古い可能性があるので、終わるのを待ってからもう一度
    gen.current++;
    if (inflight.current) await inflight.current;
    await fetchNow();
  }, [fetchNow]);

  const bump = useCallback(() => {
    gen.current++;
  }, []);

  useEffect(() => {
    alive.current = true;
    if (initial) schedule(fetchNow);
    else void fetchNow();
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      } else void fetchNow();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      document.removeEventListener("visibilitychange", onVis);
    };
    // initial は最初の1回だけ使う
  }, [fetchNow, schedule]);

  return { state, clockOffset, updatedAt, failing, refresh, bump };
}

/** 1秒ごとに描き直すための今の時刻 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** 実行中の操作の印（行が描き直されても残るよう、ID をキーに持つ） */
export function useBusy() {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const ref = useRef(new Set<string>());
  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    if (ref.current.has(key)) return;
    ref.current.add(key);
    setBusy(new Set(ref.current));
    try {
      await fn();
    } finally {
      ref.current.delete(key);
      setBusy(new Set(ref.current));
    }
  }, []);
  return { isBusy: (key: string) => busy.has(key), run };
}
