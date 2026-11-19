// 画面の状態（今のステップ、駅をえらぶ画面のモードなど）。保存はしない。DOM に依存しない。
import { createStore } from "./create-store.ts";

export type Step = 1 | 2 | 3 | 4;

export type UiState = {
  readonly step: Step;
  /** 「この駅の次に追加」の基準の駅 ID（null なら最後に加える） */
  readonly insertAfterId: string | null;
  /** 検索で選んで強調している駅 ID */
  readonly focusId: string | null;
  /** 駅をえらぶ画面で開いているシート */
  readonly sheet: "list" | "search" | "info" | null;
};

export function createUiStore(initial: Partial<UiState> = {}) {
  const store = createStore<UiState>({ step: 1, insertAfterId: null, focusId: null, sheet: null, ...initial });
  const patch = (p: Partial<UiState>) => store.set((s) => ({ ...s, ...p }));
  return {
    store,
    setStep: (step: Step) => patch({ step, sheet: null }),
    startInsertAfter: (id: string) => patch({ insertAfterId: id, sheet: null, focusId: null }),
    cancelInsert: () => patch({ insertAfterId: null }),
    setFocus: (id: string | null) => patch({ focusId: id }),
    openSheet: (sheet: UiState["sheet"]) => patch({ sheet }),
  };
}

export type UiStore = ReturnType<typeof createUiStore>;
