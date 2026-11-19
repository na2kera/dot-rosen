// サーバーへの保存と印刷の申し込み（docs/api.md「路線の保存」「印刷の申し込み」）。
// 端末に残す情報（編集の鍵、id、jobId など）もここで読み書きする。DOM にも React にも依存しない。
import { toCardLook, type CardLook } from "../../shared/card/index.ts";
import type { RouteData } from "../../shared/route/index.ts";
import type { Api, ApiFailure, PrintStatus } from "../api/client.ts";
import { createStore } from "./create-store.ts";
import { jstDate } from "./dates.ts";
import type { RandomBytes } from "./device.ts";
import { safeGet, safeRemove, safeSet, STORAGE_KEYS, type KeyValueStorage } from "./kv-storage.ts";

/** 保存した路線の記録。editKey は POST の前に書き、id は成功してから書く */
export type SavedRecord = {
  readonly editKey: string;
  readonly id: string | null;
  readonly expiresAt: string | null;
  /** 最後に保存できた内容（正規化した RouteData の JSON）。変更があるかの判定に使う */
  readonly savedJson: string | null;
};

/** 印刷の申し込みの記録。jobId が null のものは「送ったが結果が分からない」申し込み */
export type PrintRecord = {
  readonly routeId: string;
  readonly requestId: string;
  readonly jobId: number | null;
  readonly issueNo: number | null;
  readonly status: PrintStatus | null;
  readonly ahead: number | null;
  /** 申し込んだときの内容の指紋（routeFingerprint）。今の内容と比べる */
  readonly fingerprint: string;
  /** 申し込んだときの会場コードと編集の鍵（結果が分からないときに、同じ本文で送り直すため） */
  readonly eventCode: string;
  readonly editKey: string;
  /** 申し込んだ日（日本時間の「2026.11.20」） */
  readonly issuedOn: string | null;
  /** 申し込んだときの印刷の見た目（申し込みの応答、無ければ申し込んだときのサーバーの設定）。古い記録は null */
  readonly card: CardLook | null;
  /** この申し込みの前の記録（断られたときに戻す。1つだけ持つ） */
  readonly prev: PrintRecord | null;
};

export type PublishState = {
  readonly saved: SavedRecord | null;
  readonly saving: boolean;
  readonly saveError: ApiFailure | null;
  readonly print: PrintRecord | null;
  /** 印刷の申し込みを送っている途中 */
  readonly requesting: boolean;
  readonly printError: ApiFailure | null;
  /** 状態の問い合わせが通信に失敗している */
  readonly pollFailing: boolean;
};

/** 問い合わせの間隔（ミリ秒）。前が少ないときは短く、多いときは長く */
export const POLL_MS = 5000;
export const POLL_SLOW_MS = 15000;
/** 前の件数がこれ以上なら、間隔を長くする */
export const POLL_SLOW_AHEAD = 5;
/** 409 conflict（サーバーが画像を準備中）で送り直す回数 */
export const CONFLICT_RETRIES = 4;

export function pollDelay(ahead: number | null): number {
  return ahead !== null && ahead >= POLL_SLOW_AHEAD ? POLL_SLOW_MS : POLL_MS;
}

const TERMINAL: readonly PrintStatus[] = ["done", "failed", "canceled"];
export const isTerminal = (s: PrintStatus | null): boolean => s !== null && TERMINAL.includes(s);

/** 鍵や requestId に使う文字列（base64url。16 バイトで 22 文字 = 128 ビット） */
export function randomToken(random: RandomBytes, bytes = 16): string {
  const b = random(bytes);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 変更があるかを比べるための形 */
export const routeJson = (data: RouteData): string => JSON.stringify(data);

/** 内容の指紋（正規化した JSON の FNV-1a 32 ビット） */
export function routeFingerprint(data: RouteData): string {
  const s = routeJson(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const isStr = (v: unknown): v is string => typeof v === "string";
const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));
const STATUSES: readonly string[] = ["queued", "printing", "done", "failed", "canceled"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readJson(storage: KeyValueStorage, key: string): Record<string, unknown> | null {
  const raw = safeGet(storage, key);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

export function readSaved(storage: KeyValueStorage): SavedRecord | null {
  const r = readJson(storage, STORAGE_KEYS.saved);
  if (!r || !isStr(r.editKey) || !TOKEN.test(r.editKey)) return null;
  const opt = (v: unknown) => (isStr(v) ? v : null);
  return { editKey: r.editKey, id: opt(r.id), expiresAt: opt(r.expiresAt), savedJson: opt(r.savedJson) };
}

function parsePrint(r: Record<string, unknown>, depth: number): PrintRecord | null {
  if (!isStr(r.routeId) || !isStr(r.requestId) || !TOKEN.test(r.requestId)) return null;
  if (!isNumOrNull(r.jobId) || !isNumOrNull(r.issueNo) || !isNumOrNull(r.ahead)) return null;
  const status = isStr(r.status) && STATUSES.includes(r.status) ? (r.status as PrintStatus) : null;
  return {
    routeId: r.routeId,
    requestId: r.requestId,
    jobId: r.jobId,
    issueNo: r.issueNo,
    status,
    ahead: r.ahead,
    fingerprint: isStr(r.fingerprint) ? r.fingerprint : "",
    eventCode: isStr(r.eventCode) ? r.eventCode : "",
    editKey: isStr(r.editKey) ? r.editKey : "",
    issuedOn: isStr(r.issuedOn) ? r.issuedOn : null,
    card: isRecord(r.card) ? toCardLook(r.card) : null,
    prev: depth === 0 && isRecord(r.prev) ? parsePrint(r.prev, 1) : null,
  };
}

export function readPrint(storage: KeyValueStorage): PrintRecord | null {
  const r = readJson(storage, STORAGE_KEYS.print);
  return r ? parsePrint(r, 0) : null;
}

export type PublishDeps = {
  storage: KeyValueStorage;
  api: Api;
  random: RandomBytes;
  clientId: string;
  /** 画面が裏に回っているか（裏の間は問い合わせない） */
  isHidden?: () => boolean;
  /** 今のサーバーの設定の見た目（申し込んだときの見た目として覚える）。無ければ記録しない */
  cardLook?: () => CardLook;
  /** 今の時刻（期限切れの判定、申し込んだ日） */
  now?: () => Date;
  /** ほかのタブで保存先が変わったときに呼ばれる口 */
  subscribeExternal?: (cb: (key: string | null) => void) => () => void;
};

/** 保存の状態（画面の出し分け用） */
export type SaveStatus = "none" | "clean" | "dirty" | "expired";

export type PublishStore = ReturnType<typeof createPublishStore>;

const storageFailure = (): ApiFailure => ({ ok: false, code: "storage", status: 0 });

export function createPublishStore(deps: PublishDeps) {
  const { storage, api, random, clientId } = deps;
  const isHidden = deps.isHidden ?? (() => false);
  const now = deps.now ?? (() => new Date());
  const store = createStore<PublishState>({
    saved: readSaved(storage),
    saving: false,
    saveError: null,
    print: readPrint(storage),
    requesting: false,
    printError: null,
    pollFailing: false,
  });
  const patch = (p: Partial<PublishState>) => store.set((s) => ({ ...s, ...p }));

  /** 端末に書く。書けたら true（書けなくても、開いている間は state に持つ） */
  function writeSaved(rec: SavedRecord | null): boolean {
    let ok = true;
    if (rec) ok = safeSet(storage, STORAGE_KEYS.saved, JSON.stringify(rec));
    else safeRemove(storage, STORAGE_KEYS.saved);
    patch({ saved: rec });
    return ok;
  }

  function writePrint(rec: PrintRecord | null): boolean {
    let ok = true;
    if (rec) ok = safeSet(storage, STORAGE_KEYS.print, JSON.stringify(rec));
    else safeRemove(storage, STORAGE_KEYS.print);
    patch({ print: rec });
    return ok;
  }

  const sameSaved = (a: SavedRecord | null, b: SavedRecord | null) => JSON.stringify(a) === JSON.stringify(b);

  /** 端末に書かれている保存の情報を読み直す（ほかのタブが保存していれば、その鍵と id を使う） */
  function refreshSaved(): void {
    const fresh = readSaved(storage);
    if (fresh && !sameSaved(fresh, store.get().saved)) patch({ saved: fresh });
  }

  const isExpired = (rec: SavedRecord | null) => !!rec?.expiresAt && Date.parse(rec.expiresAt) <= now().getTime();

  // ---- 保存 ----

  let saving: Promise<boolean> | null = null;

  /** 鍵の路線がもう使えない（消された・期限切れ・非公開・鍵違い） */
  const isGone = (f: ApiFailure) => f.code === "not_found" || f.code === "expired" || f.code === "forbidden";

  async function post(data: RouteData, json: string): Promise<boolean> {
    // 鍵は送る前に端末へ書く（応答を受け取りそこねても、同じ鍵で送り直せば同じ路線が返る）。
    // 書けなかったら送らない（あとで編集も削除もできない URL ができてしまうため）
    let rec = store.get().saved;
    if (!rec || rec.id !== null) rec = { editKey: randomToken(random), id: null, expiresAt: null, savedJson: null };
    if (!writeSaved(rec)) {
      patch({ saveError: storageFailure() });
      return false;
    }
    const r = await api.createRoute(data, rec.editKey);
    if (r.ok) {
      // 鍵はもう端末にあるので、ここで書けなくても同じ鍵で送り直せば同じ路線に戻れる
      writeSaved({ editKey: rec.editKey, id: r.value.id, expiresAt: r.value.expiresAt, savedJson: json });
      return true;
    }
    patch({ saveError: r });
    return false;
  }

  async function doSave(data: RouteData): Promise<boolean> {
    const json = routeJson(data);
    patch({ saving: true, saveError: null });
    try {
      refreshSaved();
      const rec = store.get().saved;
      if (rec && rec.id !== null && isExpired(rec)) {
        // 期限切れ: 同じ URL には保存できないので、新しい鍵で作り直す
        writeSaved(null);
        return await post(data, json);
      }
      if (rec && rec.id !== null) {
        if (rec.savedJson === json) return true;
        const r = await api.updateRoute(rec.id, data, rec.editKey);
        if (r.ok) {
          writeSaved({ ...rec, expiresAt: r.value.expiresAt, savedJson: json });
          return true;
        }
        if (!isGone(r)) {
          patch({ saveError: r });
          return false;
        }
        // 前の路線はもう使えないので、新しい鍵で作り直す（URL は変わる）
        writeSaved(null);
        return await post(data, json);
      }
      if (await post(data, json)) return true;
      const err = store.get().saveError;
      if (err && isGone(err)) {
        // 送り直しの鍵の路線が消されていた → 新しい鍵で1回だけ作り直す
        writeSaved(null);
        patch({ saveError: null });
        return await post(data, json);
      }
      return false;
    } finally {
      patch({ saving: false });
    }
  }

  /** 保存してあり、期限内で、内容が変わっていないか */
  function isSaved(data: RouteData | null): boolean {
    const rec = store.get().saved;
    return !!rec && rec.id !== null && !isExpired(rec) && data !== null && rec.savedJson === routeJson(data);
  }

  function saveStatus(data: RouteData | null): SaveStatus {
    const rec = store.get().saved;
    if (!rec || rec.id === null) return "none";
    if (isExpired(rec)) return "expired";
    return data !== null && rec.savedJson === routeJson(data) ? "clean" : "dirty";
  }

  /**
   * 保存する（新規は POST、2回目以降は PUT）。
   * 保存中に呼ばれたら、その保存が終わるのを待ってから、頼まれた内容が保存ずみかを確かめ、違えば保存し直す。
   */
  async function save(data: RouteData): Promise<boolean> {
    while (saving) await saving;
    if (isSaved(data)) return true;
    const p = doSave(data).finally(() => {
      if (saving === p) saving = null;
    });
    saving = p;
    return p;
  }

  // ---- 印刷の状態の問い合わせ ----

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;

  function stopPolling(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    polling = false;
  }

  function schedulePoll(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void pollOnce(), pollDelay(store.get().print?.ahead ?? null));
  }

  async function pollOnce(): Promise<void> {
    pollTimer = null;
    const rec = store.get().print;
    if (!rec || rec.jobId === null || isTerminal(rec.status)) {
      polling = false;
      return;
    }
    // 裏に回っている間は問い合わせない（表に戻ったら wake で再開）
    if (isHidden()) return;
    const r = await api.printStatus(rec.jobId, clientId);
    if (!polling) return;
    const cur = store.get().print;
    if (!cur || cur.jobId !== rec.jobId) return;
    if (r.ok) {
      writePrint({ ...cur, status: r.value.status, ahead: r.value.ahead, issueNo: r.value.issueNo });
      patch({ pollFailing: false });
      if (isTerminal(r.value.status)) {
        polling = false;
        return;
      }
    } else if (r.code === "not_found") {
      // 申し込みが無くなった（路線ごと消された など）
      writePrint(null);
      polling = false;
      return;
    } else {
      patch({ pollFailing: true });
    }
    if (pollTimer === null) schedulePoll();
  }

  /** 画面が表に戻ったとき: 問い合わせ中なら、すぐに1回問い合わせる */
  function wake(): void {
    if (!polling || isHidden()) return;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    void pollOnce();
  }

  /** 終わっていない申し込みがあれば、状態の問い合わせを始める（すぐに1回、そのあとは間隔をおいて） */
  function resumePolling(): void {
    const rec = store.get().print;
    if (polling || !rec || rec.jobId === null || isTerminal(rec.status)) return;
    polling = true;
    void pollOnce();
  }

  // ---- 印刷の申し込み ----

  let requesting = false;

  /** 申し込みを送る（409 conflict = 画像の準備中なら、少し待って同じ本文で送り直す） */
  async function send(rec: PrintRecord) {
    const body = { routeId: rec.routeId, editKey: rec.editKey, eventCode: rec.eventCode, clientId, requestId: rec.requestId };
    let r = await api.requestPrint(body);
    for (let i = 0; i < CONFLICT_RETRIES && !r.ok && r.code === "conflict"; i++) {
      const wait = (r.retryAfter ?? 2) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      r = await api.requestPrint(body);
    }
    return r;
  }

  /** 送った結果を記録する。断られたら前の記録に戻す。結果が分からなければそのまま残す */
  function settle(rec: PrintRecord, r: Awaited<ReturnType<typeof send>>): boolean {
    if (r.ok) {
      // 応答の見た目（その印刷で実際に使うもの）を優先し、無ければ申し込んだときに覚えた設定のまま
      const card = r.value.card !== undefined && isRecord(r.value.card) ? toCardLook(r.value.card, rec.card ?? undefined) : rec.card;
      writePrint({ ...rec, jobId: r.value.jobId, issueNo: r.value.issueNo, status: r.value.status, ahead: r.value.ahead, card });
      stopPolling();
      if (!isTerminal(r.value.status)) {
        polling = true;
        patch({ pollFailing: false });
        schedulePoll();
      }
      return true;
    }
    if (r.code !== "network" && r.code !== "internal" && r.code !== "conflict") {
      // はっきり断られた → 申し込みは無かったことにし、前の記録（印刷ずみ など）に戻す
      writePrint(rec.prev);
      if (r.code === "expired") {
        // 保存した路線の期限が切れていた → 保存ずみ扱いをやめ、次は新しい URL で保存する
        const saved = store.get().saved;
        if (saved && saved.id === rec.routeId) writeSaved({ ...saved, expiresAt: now().toISOString() });
      }
    }
    patch({ printError: r });
    return false;
  }

  /**
   * 印刷を申し込む。未保存や変更ありなら先に保存する。
   * - requestId は押すたびに新しく作る
   * - ただし結果が分からない申し込みがあるときは、新しく作らず、同じ requestId・同じ本文で確かめ直す
   *   （内容を変えたあとでも、前の内容の申し込みとして記録する）
   */
  async function requestPrint(data: RouteData, eventCode: string): Promise<boolean> {
    if (requesting) return false;
    requesting = true;
    patch({ requesting: true, printError: null });
    try {
      const prev = store.get().print;
      if (prev && prev.jobId === null && prev.editKey !== "" && prev.eventCode !== "") {
        return settle(prev, await send(prev));
      }
      if (!isSaved(data)) {
        const ok = await save(data);
        if (!ok || !isSaved(data)) {
          patch({ printError: store.get().saveError ?? storageFailure() });
          return false;
        }
      }
      const saved = store.get().saved!;
      const rec: PrintRecord = {
        routeId: saved.id!,
        requestId: randomToken(random),
        jobId: null,
        issueNo: null,
        status: null,
        ahead: null,
        fingerprint: routeFingerprint(data),
        eventCode,
        editKey: saved.editKey,
        issuedOn: jstDate(now()),
        card: deps.cardLook ? deps.cardLook() : null,
        prev: prev && prev.jobId !== null ? { ...prev, prev: null } : null,
      };
      writePrint(rec);
      return settle(rec, await send(rec));
    } finally {
      requesting = false;
      patch({ requesting: false });
    }
  }

  /** 記録された申し込みが、今の内容のものか */
  function printMatches(data: RouteData | null): boolean {
    const rec = store.get().print;
    return !!rec && data !== null && rec.fingerprint === routeFingerprint(data);
  }

  // ---- ほかのタブの変更 ----

  const unsubscribe = deps.subscribeExternal?.((key) => {
    if (key === null || key === STORAGE_KEYS.saved) {
      const fresh = readSaved(storage);
      if (!sameSaved(fresh, store.get().saved)) patch({ saved: fresh });
    }
    if (key === null || key === STORAGE_KEYS.print) {
      const fresh = readPrint(storage);
      if (JSON.stringify(fresh) !== JSON.stringify(store.get().print)) {
        patch({ print: fresh });
        resumePolling();
      }
    }
  });

  // ---- 削除・引き継ぎ ----

  /** 端末の保存情報を消す（路線を消したあとなど） */
  function forget(): void {
    stopPolling();
    writeSaved(null);
    writePrint(null);
    patch({ saveError: null, printError: null, pollFailing: false });
  }

  /** サーバーの路線を消す（この端末が鍵を持っているときだけ） */
  async function deleteRoute(id: string): Promise<{ ok: true } | ApiFailure> {
    refreshSaved();
    const rec = store.get().saved;
    if (!rec || rec.id !== id) return { ok: false, code: "forbidden", status: 0 };
    const r = await api.deleteRoute(id, rec.editKey);
    // すでに無い・期限切れなら、端末の情報だけ消す
    if (r.ok || r.code === "not_found" || r.code === "expired") {
      forget();
      return { ok: true };
    }
    return r;
  }

  /** 路線ページで読んだ内容を、保存済みのものとして作りかけに入れるとき。端末に書けたら true */
  function markSaved(id: string, data: RouteData, expiresAt: string): boolean {
    refreshSaved();
    const rec = store.get().saved;
    if (!rec || rec.id !== id) return false;
    return writeSaved({ ...rec, expiresAt, savedJson: routeJson(data) });
  }

  /** この端末がその路線の鍵を持っているか */
  const owns = (id: string) => store.get().saved?.id === id;

  return {
    store,
    save,
    isSaved,
    saveStatus,
    requestPrint,
    printMatches,
    resumePolling,
    stopPolling,
    wake,
    deleteRoute,
    markSaved,
    owns,
    forget,
    clearErrors: () => patch({ saveError: null, printError: null }),
    dispose: () => {
      stopPolling();
      unsubscribe?.();
    },
  };
}
