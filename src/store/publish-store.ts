// サーバーへの保存と印刷の申し込み（docs/api.md「路線の保存」「印刷の申し込み」）。
// 端末に残す情報（編集の鍵、id、jobId など）もここで読み書きする。DOM にも React にも依存しない。
import { toCardLook, type CardLook } from "../../shared/card/index.ts";
import type { RouteData } from "../../shared/route/index.ts";
import type { Api, ApiFailure, PrintStatus } from "../api/client.ts";
import { createStore } from "./create-store.ts";
import { jstDate } from "./dates.ts";
import type { RandomBytes } from "./device.ts";
import { safeGet, safeRemove, safeSet, STORAGE_KEYS, type KeyValueStorage } from "./kv-storage.ts";

/**
 * 保存した路線の記録。editKey は POST の前に書き、id は成功してから書く。
 * 保存ずみかどうかは、サーバーが返した版の印（savedRev）で決める（画面は rev を計算しない）。
 * 送る前に savedRev を null（結果不明）にして書き、成功の応答で確定する。
 */
export type SavedRecord = {
  readonly editKey: string;
  readonly id: string | null;
  readonly expiresAt: string | null;
  /** savedRev の内容（正規化した RouteData の JSON）。変更があるかの判定に使う */
  readonly savedJson: string | null;
  /** サーバーが保存の応答で返した版の印。null は結果不明（送っている途中・応答を受け取りそこねた・古い記録） */
  readonly savedRev: string | null;
  /** 送っている保存の目印（送る前に書く）。応答を反映するときに、ほかのタブが書き換えていないかを確かめる */
  readonly pending: string | null;
};

/** 印刷の申し込みの記録。jobId が null のものは「送ったが結果が分からない」申し込み */
export type PrintRecord = {
  readonly routeId: string;
  readonly requestId: string;
  readonly jobId: number | null;
  readonly issueNo: number | null;
  readonly status: PrintStatus | null;
  readonly ahead: number | null;
  /** 申し込んだときの内容の控え（routeFingerprint）。今の内容と同じかの判定には使わない（printedRev を使う） */
  readonly fingerprint: string;
  /** 申し込みに付けた版の印（結果が分からないときに、同じ rev で送り直すため）。古い記録は null */
  readonly rev: string | null;
  /** その印刷が実際に使った内容の版の印（申し込みの応答の rev）。応答前・古い印刷は null */
  readonly printedRev: string | null;
  /** 申し込んだときの会場コードと編集の鍵（結果が分からないときに、同じ本文で送り直すため） */
  readonly eventCode: string;
  readonly editKey: string;
  /** 発行日（日本時間の「2026.11.20」。申し込みの応答の issuedOn） */
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
/** 版の印（16 桁の 16 進） */
const REV = /^[0-9a-f]{16}$/;
const isStr = (v: unknown): v is string => typeof v === "string";
const isRev = (v: unknown): v is string => isStr(v) && REV.test(v);
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
  return {
    editKey: r.editKey,
    id: opt(r.id),
    expiresAt: opt(r.expiresAt),
    savedJson: opt(r.savedJson),
    // rev の無い古い記録は結果不明（次の保存で送り直して rev を得る）
    savedRev: isRev(r.savedRev) ? r.savedRev : null,
    pending: isStr(r.pending) && TOKEN.test(r.pending) ? r.pending : null,
  };
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
    rev: isRev(r.rev) ? r.rev : null,
    printedRev: isRev(r.printedRev) ? r.printedRev : null,
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
/** 印刷の記録を端末に書けなかった（申し込みは送っていない） */
export const PRINT_RECORD_REASON = "print_record";
const printRecordFailure = (): ApiFailure => ({ ok: false, code: "storage", status: 0, reason: PRINT_RECORD_REASON });

/** 記録した印刷と今の内容の関係。unknown は判定できない（実際に使った内容の印が無い古い印刷） */
export type PrintRelation = "same" | "other" | "unknown";

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

  /**
   * 保存の成功の応答を反映する。端末の記録が、自分が送る前に書いた結果不明の状態（目印 token）のままのときだけ確定する。
   * ほかのタブが書き換えていたら、古い応答で上書きせず、結果不明にする（次の保存で送り直す）
   */
  function settleSave(token: string, editKey: string, id: string, expiresAt: string, rev: unknown, json: string): boolean {
    const fresh = readSaved(storage);
    if (fresh && fresh.pending === token && fresh.editKey === editKey) {
      if (isRev(rev)) {
        // 鍵はもう端末にあるので、ここで書けなくても同じ鍵で送り直せば同じ路線に戻れる
        writeSaved({ editKey, id, expiresAt, savedJson: json, savedRev: rev, pending: null });
        return true;
      }
      // 版の印が無い・形が違う応答は、画面で補わずに結果不明のままにする
      writeSaved({ editKey, id, expiresAt, savedJson: null, savedRev: null, pending: null });
      patch({ saveError: { ok: false, code: "internal", status: 0 } });
      return false;
    }
    if (fresh && fresh.editKey === editKey && (fresh.id === null || fresh.id === id)) {
      // 同じ路線をほかのタブが書いた（どちらの内容がサーバーに残ったか分からない）
      if (fresh.savedRev !== null || fresh.id === null) writeSaved({ ...fresh, id, expiresAt: fresh.expiresAt ?? expiresAt, savedJson: null, savedRev: null });
      else patch({ saved: fresh });
    } else {
      // ほかのタブが消した・別の路線にした → その記録に従う
      patch({ saved: fresh });
    }
    patch({ saveError: { ok: false, code: "conflict", status: 0 } });
    return false;
  }

  async function post(data: RouteData, json: string): Promise<boolean> {
    // 鍵は送る前に端末へ書く（応答を受け取りそこねても、同じ鍵で送り直せば同じ路線が返る）。
    // 書けなかったら送らない（あとで編集も削除もできない URL ができてしまうため）
    const before = store.get().saved;
    let rec = before;
    if (!rec || rec.id !== null) rec = { editKey: randomToken(random), id: null, expiresAt: null, savedJson: null, savedRev: null, pending: null };
    const token = randomToken(random);
    if (!writeSaved({ ...rec, pending: token })) {
      writeSaved(before);
      patch({ saveError: storageFailure() });
      return false;
    }
    const r = await api.createRoute(data, rec.editKey);
    if (r.ok) return settleSave(token, rec.editKey, r.value.id, r.value.expiresAt, r.value.rev, json);
    patch({ saveError: r });
    return false;
  }

  async function put(rec: SavedRecord & { id: string }, data: RouteData, json: string): Promise<boolean | "gone"> {
    // 送る前に結果不明にして端末に書く（応答を受け取りそこねたら、前の内容を「保存ずみ」と扱わない）。書けなければ送らない
    const token = randomToken(random);
    if (!writeSaved({ ...rec, savedJson: null, savedRev: null, pending: token })) {
      writeSaved(rec);
      patch({ saveError: storageFailure() });
      return false;
    }
    const r = await api.updateRoute(rec.id, data, rec.editKey);
    if (r.ok) return settleSave(token, rec.editKey, rec.id, r.value.expiresAt, r.value.rev, json);
    if (isGone(r)) return "gone";
    const fresh = readSaved(storage);
    if (fresh?.pending === token) {
      // 通信の失敗・サーバーの問題は結果不明のまま。はっきり断られた（サーバーは変わっていない）なら送る前の記録に戻す
      writeSaved(r.code === "network" || r.code === "internal" ? { ...fresh, pending: null } : rec);
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
        if (rec.savedRev !== null && rec.savedJson === json) return true;
        const r = await put({ ...rec, id: rec.id }, data, json);
        if (r !== "gone") return r;
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

  /** 保存してあり（結果不明でなく）、期限内で、内容が変わっていないか */
  function isSaved(data: RouteData | null): boolean {
    const rec = store.get().saved;
    return !!rec && rec.id !== null && !isExpired(rec) && rec.savedRev !== null && data !== null && rec.savedJson === routeJson(data);
  }

  function saveStatus(data: RouteData | null): SaveStatus {
    const rec = store.get().saved;
    if (!rec || rec.id === null) return "none";
    if (isExpired(rec)) return "expired";
    // 結果不明は「変更あり」（保存しなおすと送り直す）
    return isSaved(data) ? "clean" : "dirty";
  }

  /**
   * 保存する（新規は POST、2回目以降は PUT）。
   * 保存中に呼ばれたら、その保存が終わるのを待ってから、頼まれた内容が保存ずみかを確かめ、違えば保存し直す。
   */
  async function save(data: RouteData): Promise<boolean> {
    while (saving) await saving;
    // ほかのタブの保存（結果不明を含む）を拾う
    refreshSaved();
    if (isSaved(data)) return true;
    const p = doSave(data).finally(() => {
      if (saving === p) saving = null;
    });
    saving = p;
    return p;
  }

  /** 端末の保存状態を結果不明にする（サーバーの内容が端末の記録と違うと分かったとき） */
  function markUnknown(routeId: string): void {
    const rec = readSaved(storage) ?? store.get().saved;
    if (rec && rec.id === routeId && rec.savedRev !== null) writeSaved({ ...rec, savedJson: null, savedRev: null });
  }

  // ---- 印刷の状態の問い合わせ ----

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  /** 問い合わせの世代。止めたとき・対象の印刷が変わったときに進め、古い世代の応答は捨てる */
  let pollGen = 0;

  function stopPolling(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    polling = false;
    pollGen++;
  }

  function schedulePoll(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    const gen = pollGen;
    pollTimer = setTimeout(() => void pollOnce(gen), pollDelay(store.get().print?.ahead ?? null));
  }

  async function pollOnce(gen: number): Promise<void> {
    if (gen !== pollGen) return;
    pollTimer = null;
    const rec = store.get().print;
    if (!rec || rec.jobId === null || isTerminal(rec.status)) {
      polling = false;
      return;
    }
    // 裏に回っている間は問い合わせない（表に戻ったら wake で再開）
    if (isHidden()) return;
    const r = await api.printStatus(rec.jobId, clientId);
    // 古い世代の応答は捨てる（新しい世代が自分で次を予約している）
    if (gen !== pollGen || !polling) return;
    const cur = store.get().print;
    if (!cur || cur.jobId !== rec.jobId) {
      // 対象が変わった: この応答は捨て、次の問い合わせは確保する（今の対象を見て続けるか決める）
      if (pollTimer === null) schedulePoll();
      return;
    }
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
    void pollOnce(pollGen);
  }

  /** 終わっていない申し込みがあれば、状態の問い合わせを始める（すぐに1回、そのあとは間隔をおいて） */
  function resumePolling(): void {
    const rec = store.get().print;
    if (polling || !rec || rec.jobId === null || isTerminal(rec.status)) return;
    polling = true;
    void pollOnce(pollGen);
  }

  // ---- 印刷の申し込み ----

  let requesting = false;

  /** 申し込みを送る（409 conflict = 画像の準備中なら、少し待って同じ本文で送り直す） */
  async function send(rec: PrintRecord & { rev: string }) {
    const body = { routeId: rec.routeId, editKey: rec.editKey, eventCode: rec.eventCode, clientId, requestId: rec.requestId, rev: rec.rev };
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
      writePrint({
        ...rec,
        jobId: r.value.jobId,
        issueNo: r.value.issueNo,
        status: r.value.status,
        ahead: r.value.ahead,
        card,
        // その印刷が実際に使った内容の印（無い・形が違えば分からないまま）と発行日（null の古い印刷は、従来どおり端末の今日の日付）
        printedRev: isRev(r.value.rev) ? r.value.rev : null,
        issuedOn: isStr(r.value.issuedOn) ? r.value.issuedOn : jstDate(now()),
      });
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

  /** いまの内容を保存ずみにする（進行中の保存は待つ）。できなければ理由を出して false */
  async function ensureSaved(data: RouteData): Promise<boolean> {
    const ok = await save(data);
    if (ok && isSaved(data)) return true;
    patch({ printError: store.get().saveError ?? storageFailure() });
    return false;
  }

  /** 申し込む前に記録を端末に書く。書けなければ前の記録に戻して false（申し込まない） */
  function persist(rec: PrintRecord, restore: PrintRecord | null): boolean {
    if (writePrint(rec)) return true;
    writePrint(restore);
    patch({ printError: printRecordFailure() });
    return false;
  }

  /** いまの保存ずみの内容で、新しい requestId の申し込みの記録を作る */
  function newRecord(data: RouteData, eventCode: string, prev: PrintRecord | null): PrintRecord & { rev: string } {
    const saved = store.get().saved!;
    return {
      routeId: saved.id!,
      requestId: randomToken(random),
      jobId: null,
      issueNo: null,
      status: null,
      ahead: null,
      fingerprint: routeFingerprint(data),
      rev: saved.savedRev!,
      printedRev: null,
      eventCode,
      editKey: saved.editKey,
      issuedOn: null,
      card: deps.cardLook ? deps.cardLook() : null,
      prev,
    };
  }

  /**
   * 送って結果を記録する。409 stale（保存されている内容が申し込みの版と違う。印刷は作られていない）なら、
   * 保存状態を結果不明にして今の内容を保存し直し、新しい requestId と新しい rev で1回だけ申し込み直す
   */
  async function sendAndSettle(rec: PrintRecord & { rev: string }, data: RouteData, eventCode: string): Promise<boolean> {
    const r = await send(rec);
    if (r.ok || r.code !== "stale") return settle(rec, r);
    writePrint(rec.prev);
    markUnknown(rec.routeId);
    if (!(await ensureSaved(data))) return false;
    const again = newRecord(data, eventCode, rec.prev);
    if (!persist(again, rec.prev)) return false;
    // それも stale なら、はっきり断られた扱い（前の記録に戻してエラーを出す）
    return settle(again, await send(again));
  }

  /**
   * 印刷を申し込む（docs/api.md「印刷の申し込み」の画面の決まり 1〜5）。
   * - いまの内容を保存ずみにしてから、その rev を付けて申し込む。requestId は押すたびに新しく作る
   * - 結果が分からない申し込みがあるときは、新しく作らず、元の requestId・元の rev で確かめ直す
   *   （内容を変えたあとでも。200 なら元の印刷で、応答の rev で今の内容のものかを判定する）
   * - 申し込む前に記録を端末に書く。書けなければ申し込まない
   */
  async function requestPrint(data: RouteData, eventCode: string): Promise<boolean> {
    if (requesting) return false;
    requesting = true;
    patch({ requesting: true, printError: null });
    try {
      const prev = store.get().print;
      if (prev && prev.jobId === null && prev.editKey !== "" && prev.eventCode !== "") {
        // 送り直しでも、先に押した時点の内容を保存ずみにする（決まり 1。進行中の保存は待ち、失敗したら送らない）。
        // そのうえで元の requestId と元の rev で送る: 元の印刷があれば再生、無ければ stale になり、
        // 決まり 4 で今の内容が申し込み直される（押した時点の内容と違う版の印刷が新しく作られない）
        if (!(await ensureSaved(data))) return false;
        let rec: PrintRecord = prev;
        if (rec.rev === null) {
          // rev を持たない前の形式の記録: 元の requestId のまま、今の内容の rev を付ける
          // （元の印刷があればそれが返り、無ければその rev の内容でしか作られない）
          rec = { ...rec, rev: store.get().saved!.savedRev };
        }
        if (!persist(rec, prev)) return false;
        return await sendAndSettle(rec as PrintRecord & { rev: string }, data, eventCode);
      }
      if (!(await ensureSaved(data))) return false;
      const rec = newRecord(data, eventCode, prev && prev.jobId !== null ? { ...prev, prev: null } : null);
      if (!persist(rec, prev)) return false;
      return await sendAndSettle(rec, data, eventCode);
    } finally {
      requesting = false;
      patch({ requesting: false });
    }
  }

  /**
   * 記録した印刷が、今の内容のものか。印刷が実際に使った内容の印（printedRev）と、今の内容の保存の印（savedRev）で比べる。
   * 今の内容が未保存・結果不明なら other。印刷の印が分からない（古い印刷）なら unknown
   */
  function printRelation(data: RouteData | null): PrintRelation {
    const rec = store.get().print;
    if (!rec || rec.printedRev === null) return "unknown";
    const saved = store.get().saved;
    return isSaved(data) && saved!.id === rec.routeId && saved!.savedRev === rec.printedRev ? "same" : "other";
  }

  const printMatches = (data: RouteData | null): boolean => printRelation(data) === "same";

  // ---- ほかのタブの変更 ----

  const unsubscribe = deps.subscribeExternal?.((key) => {
    if (key === null || key === STORAGE_KEYS.saved) {
      const fresh = readSaved(storage);
      if (!sameSaved(fresh, store.get().saved)) patch({ saved: fresh });
    }
    if (key === null || key === STORAGE_KEYS.print) {
      const fresh = readPrint(storage);
      const cur = store.get().print;
      if (JSON.stringify(fresh) !== JSON.stringify(cur)) {
        patch({ print: fresh });
        // 対象の印刷が変わったら、前の印刷の問い合わせ（世代）を無効にして、新しい印刷の問い合わせを始める
        if (fresh?.jobId !== cur?.jobId || fresh?.requestId !== cur?.requestId) stopPolling();
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

  /**
   * 路線ページで読んだ内容を、作りかけに入れるとき。端末に書けたら true。
   * 読んだときの版の印（rev）が端末の保存記録の印と同じときだけ保存ずみとして引き継ぎ、
   * 違う・分からないときは結果不明にする（保存しなおすと送り直す。印刷の食い違いは stale で拾う）
   */
  function markSaved(id: string, data: RouteData, expiresAt: string, rev: string | null): boolean {
    refreshSaved();
    const rec = store.get().saved;
    if (!rec || rec.id !== id) return false;
    if (isRev(rev) && rec.savedRev === rev) return writeSaved({ ...rec, expiresAt, savedJson: routeJson(data) });
    return writeSaved({ ...rec, expiresAt, savedJson: null, savedRev: null });
  }

  /** この端末がその路線の鍵を持っているか */
  const owns = (id: string) => store.get().saved?.id === id;

  return {
    store,
    save,
    isSaved,
    saveStatus,
    requestPrint,
    printRelation,
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
