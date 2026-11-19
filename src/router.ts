// History API を使った小さなルーター。
import { useSyncExternalStore } from "react";
import { matchRoute, type AppRoute } from "./routes.ts";

const EVENT = "dot-rosen:navigate";

function subscribe(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

const getPath = () => window.location.pathname;

/** 画面を移る（ページは読み直さない） */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
}

export function useRoute(): AppRoute {
  const path = useSyncExternalStore(subscribe, getPath);
  return matchRoute(path);
}
