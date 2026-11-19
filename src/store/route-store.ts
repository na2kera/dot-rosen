// 作りかけの路線を1か所で持つストア。変更のたびに少し間をおいて端末へ保存する。
// DOM にも React にも依存しない（保存先と駅の引き方は引数で受け取る）。
import {
  defaultRouteDraft,
  MAX_STATIONS,
  MIN_LOOP_STATIONS,
  normalizeRouteName,
  normalizeRouteSymbol,
  parseRouteDraft,
  type RouteDraft,
  type StationLookup,
} from "../../shared/route/index.ts";
import { COLOR_IDS, type ColorId } from "../../shared/train/colors.ts";
import { defaultDesign, parseTrainDesign, type TrainDesign } from "../../shared/train/design.ts";
import { createStore, type Store } from "./create-store.ts";
import { safeGet, safeSet, STORAGE_KEYS, type KeyValueStorage } from "./kv-storage.ts";
import * as ops from "./route-ops.ts";

/** 保存データの版。形を変えたら上げる（古い版は読まずに初期値に戻す。元の文字列は退避する） */
export const DRAFT_STORAGE_VERSION = 1;

/** 1つ戻すために覚えておく、駅の並びの前の状態 */
type StationsSnapshot = { readonly stations: readonly string[]; readonly loop: boolean };

/** 1つ戻すで覚えておく数 */
const HISTORY_LIMIT = 50;

export type RouteState = {
  readonly draft: RouteDraft;
  /** 駅の並びを変える操作の前の状態（新しいものが最後） */
  readonly history: readonly StationsSnapshot[];
  /** 端末への自動保存に失敗している（次の変更やページを離れるときにやり直す） */
  readonly persistFailed: boolean;
};

type Saved = { ver: number; draft: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** 電車のデザインを部位ごとに救う（検査に通る部位だけ残し、ほかは初期値） */
function salvageTrain(raw: unknown): TrainDesign {
  const whole = parseTrainDesign(raw);
  if (whole.ok) return whole.value;
  const def = defaultDesign();
  if (!isRecord(raw)) return def;
  let t = def;
  const tryPart = (patch: Partial<Record<keyof TrainDesign, unknown>>) => {
    const r = parseTrainDesign({ ...t, ...patch });
    if (r.ok) t = r.value;
  };
  tryPart({ face: own(raw, "face") });
  tryPart({ side: own(raw, "side") });
  tryPart({ bodyColor: own(raw, "bodyColor") });
  tryPart({ bandColor: own(raw, "bandColor") });
  tryPart({ cars: own(raw, "cars") });
  tryPart({ logo: own(raw, "logo") });
  return t;
}

/** 検査に通らなかった作りかけから、項目ごとに救える分を残す */
function salvageDraft(r: Record<string, unknown>, lookup: StationLookup): RouteDraft {
  const def = defaultRouteDraft();
  const rawName = own(r, "name");
  const name = typeof rawName === "string" ? (rawName.trim() === "" ? "" : (normalizeRouteName(ops.clampName(rawName)) ?? def.name)) : def.name;
  const rawSymbol = own(r, "symbol");
  const symbol = rawSymbol === "" ? "" : (normalizeRouteSymbol(rawSymbol) ?? def.symbol);
  const lc = own(r, "lineColor");
  const lineColor = typeof lc === "string" && (COLOR_IDS as readonly string[]).includes(lc) ? (lc as ColorId) : def.lineColor;
  const rawStations = own(r, "stations");
  const stations: string[] = [];
  if (Array.isArray(rawStations)) {
    for (const s of rawStations.slice(0, MAX_STATIONS * 2)) {
      if (stations.length >= MAX_STATIONS) break;
      if (typeof s !== "string" || stations.includes(s)) continue;
      // 1駅ずつ確かめる（知らない駅だけ落とす）
      if (parseRouteDraft({ ...def, stations: [s] }, lookup).ok) stations.push(s);
    }
  }
  const loop = own(r, "loop") === true && stations.length >= MIN_LOOP_STATIONS;
  const draft: RouteDraft = { v: 1, name, symbol, lineColor, stations, loop, train: salvageTrain(own(r, "train")) };
  // 最後に全体を確かめる（名前・記号が空でも通るように仮の値で）
  const check = parseRouteDraft({ ...draft, name: draft.name || "仮", symbol: draft.symbol || "X" }, lookup);
  return check.ok ? draft : def;
}

/**
 * 端末に保存した作りかけを読み戻す。
 * - 読めない・版が違うときは初期値（damaged = true。呼び出し元が元の文字列を退避する）
 * - 検査に通らない項目があっても全体は捨てず、項目ごとに救える分を残す（damaged = true）
 * - 入力途中で空にした路線名・路線記号は、そのまま空で戻す
 */
export function restoreDraftReport(json: string | null, lookup: StationLookup): { draft: RouteDraft; damaged: boolean } {
  if (json === null) return { draft: defaultRouteDraft(), damaged: false };
  let saved: Saved;
  try {
    saved = JSON.parse(json) as Saved;
  } catch {
    return { draft: defaultRouteDraft(), damaged: true };
  }
  if (!isRecord(saved) || saved.ver !== DRAFT_STORAGE_VERSION) return { draft: defaultRouteDraft(), damaged: true };
  const raw = saved.draft;
  if (!isRecord(raw)) return { draft: defaultRouteDraft(), damaged: true };
  const emptyName = typeof raw.name === "string" && raw.name.trim() === "";
  const emptySymbol = raw.symbol === "";
  const parsed = parseRouteDraft({ ...raw, name: emptyName ? "仮" : raw.name, symbol: emptySymbol ? "X" : raw.symbol }, lookup);
  if (parsed.ok) return { draft: { ...parsed.value, name: emptyName ? "" : parsed.value.name, symbol: emptySymbol ? "" : parsed.value.symbol }, damaged: false };
  return { draft: salvageDraft(raw, lookup), damaged: true };
}

export function restoreDraft(json: string | null, lookup: StationLookup): RouteDraft {
  return restoreDraftReport(json, lookup).draft;
}

export function serializeDraft(draft: RouteDraft): string {
  return JSON.stringify({ ver: DRAFT_STORAGE_VERSION, draft } satisfies Saved);
}

/**
 * 作りかけを端末に書く（「編集する」の引き継ぎなど、ストアの外から書くとき）。書けたら true
 */
export function writeDraft(storage: KeyValueStorage, draft: RouteDraft): boolean {
  return safeSet(storage, STORAGE_KEYS.draft, serializeDraft(draft));
}

export type RouteStoreOptions = {
  storage: KeyValueStorage;
  lookup: StationLookup;
  /** 保存までの待ち時間（ミリ秒）。既定 400 */
  saveDelayMs?: number;
  /** ほかのタブで保存先が変わったときに呼ばれる口（key は変わったキー。null は全部） */
  subscribeExternal?: (cb: (key: string | null) => void) => () => void;
};

export type RouteStore = ReturnType<typeof createRouteStore>;

export function createRouteStore(opts: RouteStoreOptions) {
  const { storage, lookup } = opts;
  const delay = opts.saveDelayMs ?? 400;
  const initialJson = safeGet(storage, STORAGE_KEYS.draft);
  const initial = restoreDraftReport(initialJson, lookup);
  // 読み戻せなかった元の文字列は、上書きする前に退避する
  if (initial.damaged && initialJson !== null) safeSet(storage, STORAGE_KEYS.draftBackup, initialJson);
  const store: Store<RouteState> = createStore<RouteState>({ draft: initial.draft, history: [], persistFailed: false });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  /** 最後に端末へ書いた（または端末から読んだ）文字列。ほかのタブの変更かどうかを見分ける */
  let lastJson = initialJson;

  function flush(): boolean {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!dirty) return true;
    const json = serializeDraft(store.get().draft);
    if (safeSet(storage, STORAGE_KEYS.draft, json)) {
      dirty = false;
      lastJson = json;
      if (store.get().persistFailed) store.set({ ...store.get(), persistFailed: false });
      return true;
    }
    // 書けなかった: 未保存の印を残し、次の機会にやり直す
    if (!store.get().persistFailed) store.set({ ...store.get(), persistFailed: true });
    return false;
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
    store.set({ ...prev, draft: result.draft, history: [...prev.history, snap].slice(-HISTORY_LIMIT) });
    scheduleSave();
    return result;
  }

  /** ほかのタブが作りかけを書き換えたら取り込む（こちらに未保存の変更があるときは、こちらを優先する） */
  function syncFromStorage(): void {
    if (dirty) return;
    const json = safeGet(storage, STORAGE_KEYS.draft);
    if (json === lastJson || json === null) return;
    const r = restoreDraftReport(json, lookup);
    if (r.damaged) return;
    lastJson = json;
    store.set({ draft: r.draft, history: [], persistFailed: false });
  }

  const unsubscribe = opts.subscribeExternal?.((key) => {
    if (key === null || key === STORAGE_KEYS.draft) syncFromStorage();
  });

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
      store.set({ ...prev, draft: { ...prev.draft, stations: [...last.stations], loop: last.loop }, history: prev.history.slice(0, -1) });
      scheduleSave();
      return true;
    },
    setName: (raw: string) => update((d) => ops.setName(d, raw)),
    setSymbol: (raw: string) => update((d) => ops.setSymbol(d, raw)),
    setLineColor: (c: ColorId) => update((d) => ops.setLineColor(d, c)),
    setTrain: (train: TrainDesign) => update((d) => ({ ...d, train })),
    /** そのほかの変更（ステップ3・4用）。駅の並びを変えるときは上の関数を使う */
    update,
    /** 待たずにすぐ保存する（ページを離れるときなど）。書けなければ false */
    flush,
    /** ほかのタブの変更を取り込む（テスト用にも公開） */
    syncFromStorage,
    dispose(): void {
      flush();
      unsubscribe?.();
    },
  };
}
