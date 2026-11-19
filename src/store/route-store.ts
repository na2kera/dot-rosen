// 作りかけの路線を1か所で持つストア。変更のたびに少し間をおいて端末へ保存する。
// DOM にも React にも依存しない（保存先と駅の引き方は引数で受け取る）。
import { defaultRouteDraft, parseRouteDraft, type RouteDraft, type StationLookup } from "../../shared/route/index.ts";
import type { ColorId } from "../../shared/train/colors.ts";
import type { TrainDesign } from "../../shared/train/design.ts";
import { createStore, type Store } from "./create-store.ts";
import { safeGet, safeSet, STORAGE_KEYS, type KeyValueStorage } from "./kv-storage.ts";
import * as ops from "./route-ops.ts";

/** 保存データの版。形を変えたら上げる（古い版は読まずに初期値に戻す） */
export const DRAFT_STORAGE_VERSION = 1;

/** 1つ戻すために覚えておく、駅の並びの前の状態 */
type StationsSnapshot = { readonly stations: readonly string[]; readonly loop: boolean };

/** 1つ戻すで覚えておく数 */
const HISTORY_LIMIT = 50;

export type RouteState = {
  readonly draft: RouteDraft;
  /** 駅の並びを変える操作の前の状態（新しいものが最後） */
  readonly history: readonly StationsSnapshot[];
};

type Saved = { ver: number; draft: unknown };

/**
 * 端末に保存した作りかけを読み戻す。読めない・壊れている・版が違うときは初期値。
 * 入力途中で空にした路線名・路線記号は、そのまま空で戻す（検査は仮の値で通す）。
 */
export function restoreDraft(json: string | null, lookup: StationLookup): RouteDraft {
  if (json === null) return defaultRouteDraft();
  let saved: Saved;
  try {
    saved = JSON.parse(json) as Saved;
  } catch {
    return defaultRouteDraft();
  }
  if (typeof saved !== "object" || saved === null || saved.ver !== DRAFT_STORAGE_VERSION) return defaultRouteDraft();
  const raw = saved.draft;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return defaultRouteDraft();
  const r = raw as Record<string, unknown>;
  const emptyName = typeof r.name === "string" && r.name.trim() === "";
  const emptySymbol = r.symbol === "";
  const parsed = parseRouteDraft({ ...r, name: emptyName ? "仮" : r.name, symbol: emptySymbol ? "X" : r.symbol }, lookup);
  if (!parsed.ok) return defaultRouteDraft();
  return { ...parsed.value, name: emptyName ? "" : parsed.value.name, symbol: emptySymbol ? "" : parsed.value.symbol };
}

export function serializeDraft(draft: RouteDraft): string {
  return JSON.stringify({ ver: DRAFT_STORAGE_VERSION, draft } satisfies Saved);
}

export type RouteStoreOptions = {
  storage: KeyValueStorage;
  lookup: StationLookup;
  /** 保存までの待ち時間（ミリ秒）。既定 400 */
  saveDelayMs?: number;
};

export type RouteStore = ReturnType<typeof createRouteStore>;

export function createRouteStore(opts: RouteStoreOptions) {
  const { storage, lookup } = opts;
  const delay = opts.saveDelayMs ?? 400;
  const store: Store<RouteState> = createStore<RouteState>({
    draft: restoreDraft(safeGet(storage, STORAGE_KEYS.draft), lookup),
    history: [],
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  function flush(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    safeSet(storage, STORAGE_KEYS.draft, serializeDraft(store.get().draft));
  }

  function scheduleSave(): void {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  /** 駅の並び以外を変える（1つ戻すの対象にしない） */
  function update(fn: (d: RouteDraft) => RouteDraft): void {
    const prev = store.get();
    const draft = fn(prev.draft);
    if (draft === prev.draft) return;
    store.set({ ...prev, draft });
    scheduleSave();
  }

  /** 駅の並びを変える（前の状態を覚えて、1つ戻せるようにする） */
  function applyStations(result: ops.OpResult): ops.OpResult {
    if (!result.ok) return result;
    const prev = store.get();
    if (result.draft === prev.draft) return result;
    const snap: StationsSnapshot = { stations: prev.draft.stations, loop: prev.draft.loop };
    store.set({ draft: result.draft, history: [...prev.history, snap].slice(-HISTORY_LIMIT) });
    scheduleSave();
    return result;
  }

  const draft = () => store.get().draft;

  return {
    store,
    getDraft: draft,
    /** 最後（環状線なら始発駅に戻る手前）に加える */
    addStation: (id: string) => applyStations(ops.addStation(draft(), id)),
    /** index の駅の次に加える */
    insertAfter: (index: number, id: string) => applyStations(ops.addStation(draft(), id, index + 1)),
    removeAt: (index: number) => applyStations(ops.removeStationAt(draft(), index)),
    removeStation: (id: string) => applyStations(ops.removeStationAt(draft(), draft().stations.indexOf(id))),
    move: (from: number, to: number) => applyStations(ops.moveStation(draft(), from, to)),
    setLoop: (loop: boolean) => applyStations(ops.setLoop(draft(), loop)),
    clearStations: () => applyStations({ ok: true, draft: ops.clearStations(draft()) }),
    canUndo: () => store.get().history.length > 0,
    /** 駅の並びを1つ前に戻す。戻せたら true */
    undo(): boolean {
      const prev = store.get();
      const last = prev.history[prev.history.length - 1];
      if (!last) return false;
      store.set({ draft: { ...prev.draft, stations: [...last.stations], loop: last.loop }, history: prev.history.slice(0, -1) });
      scheduleSave();
      return true;
    },
    setName: (raw: string) => update((d) => ops.setName(d, raw)),
    setSymbol: (raw: string) => update((d) => ops.setSymbol(d, raw)),
    setLineColor: (c: ColorId) => update((d) => ops.setLineColor(d, c)),
    setTrain: (train: TrainDesign) => update((d) => ({ ...d, train })),
    /** そのほかの変更（ステップ3・4用）。駅の並びを変えるときは上の関数を使う */
    update,
    /** 待たずにすぐ保存する（ページを離れるときなど） */
    flush,
    dispose(): void {
      flush();
    },
  };
}
