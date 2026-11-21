// 「じぶんの」ロゴ: 「じぶんで描く」の「できた」で描いたロゴを、端末の中に 1 つだけ覚える。
// 覚えるのは点のデータだけ（色は電車のロゴの色を使う）。路線データの形は変えず、サーバーにも送らない。
// DOM にも React にも依存しない。
import { EMPTY_LOGO, isLogoBits, PRESET_LOGOS } from "../../shared/train/logos.ts";
import { safeGet, safeSet, STORAGE_KEYS, type KeyValueStorage } from "./kv-storage.ts";

const isPreset = (bits: string) => PRESET_LOGOS.some((p) => p.bits === bits);

/** じぶんのとして覚えてよい絵か（正しい形で、既製のどれとも違い、空でない） */
const canBeMine = (bits: string) => isLogoBits(bits) && bits !== EMPTY_LOGO && !isPreset(bits);

export function readMyLogo(storage: KeyValueStorage): string | null {
  const v = safeGet(storage, STORAGE_KEYS.myLogo);
  return v !== null && canBeMine(v) ? v : null;
}

/** 覚える。覚えられない絵（既製・空）なら前のものを残す。戻り値は、いまのじぶんの */
export function saveMyLogo(storage: KeyValueStorage, bits: string): string | null {
  if (!canBeMine(bits)) return readMyLogo(storage);
  // 書けなくても（容量不足など）、開いている間は覚えたものとして返す
  safeSet(storage, STORAGE_KEYS.myLogo, bits);
  return bits;
}

/**
 * 起動時の引き継ぎ: じぶんのが未登録で、いまの電車のロゴが既製と違う絵なら、それをじぶんのにする
 * （これまでに描いた人のロゴを失わないため）。戻り値は、いまのじぶんの
 */
export function adoptMyLogo(storage: KeyValueStorage, currentBits: string): string | null {
  return readMyLogo(storage) ?? (canBeMine(currentBits) ? saveMyLogo(storage, currentBits) : null);
}

/** 選択中のカード: 既製の id、じぶんのなら "mine"、どれでもなければ null */
export function logoSelection(currentBits: string, mine: string | null): string | null {
  const p = PRESET_LOGOS.find((x) => x.bits === currentBits);
  if (p) return p.id;
  return mine !== null && mine === currentBits ? "mine" : null;
}

/** 「じぶんで描く」の下絵: じぶんのがあればその続きから、なければいまのロゴ */
export function drawStartBits(mine: string | null, currentBits: string): string {
  return mine ?? currentBits;
}

/** 「できた」: 描いた絵を電車のロゴにし、じぶんのに覚える（既製と同じ絵なら覚えない） */
export function finishDraw(storage: KeyValueStorage, drawnBits: string): { bits: string; mine: string | null } {
  return { bits: drawnBits, mine: saveMyLogo(storage, drawnBits) };
}

/** 描く画面を開いた時点の記録（opened: 開いた時点の電車のロゴ、start: 下絵） */
export type DrawSession = { opened: string; start: string };

/** 「じぶんで描く」を開く。開いた時点のロゴを覚えておく（開いている間に電車のロゴが変わっても、やめるはここへ戻す） */
export function beginDraw(mine: string | null, currentBits: string): DrawSession {
  return { opened: currentBits, start: drawStartBits(mine, currentBits) };
}

/** 「やめる」（シートの外のタップ・Esc も同じ）: 開いた時点のロゴに戻す */
export function cancelDraw(session: DrawSession): string {
  return session.opened;
}
