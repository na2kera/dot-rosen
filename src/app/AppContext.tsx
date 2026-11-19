// 画面全体で共有するもの（読み込んだデータ、ストア）。
import { createContext, useContext } from "react";
import type { AppData } from "../data/load.ts";
import type { KeyValueStorage } from "../store/kv-storage.ts";
import type { RouteState, RouteStore } from "../store/route-store.ts";
import type { UiState, UiStore } from "../store/ui-store.ts";
import { useStore } from "../store/use-store.ts";

export type AppContextValue = {
  data: AppData;
  route: RouteStore;
  ui: UiStore;
  clientId: string;
  storage: KeyValueStorage;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("AppContext がありません");
  return v;
}

const selectDraft = (s: RouteState) => s.draft;
const selectCanUndo = (s: RouteState) => s.history.length > 0;

/** 作りかけの路線 */
export function useDraft() {
  return useStore(useApp().route.store, selectDraft);
}

export function useCanUndo() {
  return useStore(useApp().route.store, selectCanUndo);
}

export function useUi(): UiState {
  return useStore(useApp().ui.store);
}
