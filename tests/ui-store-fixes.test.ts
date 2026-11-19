// コードレビューの指摘（端末への保存、路線名の文字、複数タブ、ログアウト）の再現テスト。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRouteDraft, normalizeRouteName, type StationLookup } from "../shared/route/index.ts";
import { AdminApiError, tryLogout } from "../src/admin/api.ts";
import { layeredStorage, memoryStorage, safeSet, STORAGE_KEYS } from "../src/store/kv-storage.ts";
import { clampName } from "../src/store/route-ops.ts";
import { createRouteStore, restoreDraftReport, serializeDraft } from "../src/store/route-store.ts";

const STATIONS: Record<string, { name: string; lat: number; lon: number }> = {};
for (let i = 1; i <= 40; i++) STATIONS[`s${i}`] = { name: `駅${i}`, lat: 35 + i / 100, lon: 139.5 };
const lookup: StationLookup = (id) => STATIONS[id];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("指摘3: 路線名の文字", () => {
  it("shared/route が拒否する文字は、入力の時点で取り除く（ZWJ・異体字セレクタ・制御文字など）", () => {
    const family = "家族\u{1F468}‍\u{1F469}‍\u{1F467}線";
    const cleaned = clampName(family);
    expect(cleaned).toBe("家族\u{1F468}\u{1F469}\u{1F467}線");
    expect(normalizeRouteName(cleaned)).toBe(cleaned);
    for (const raw of ["❤️線", "a​b", "a‮b", "私用", "x\uD800y", "改\n行", "⁦線"]) {
      const c = clampName(raw);
      expect(normalizeRouteName(c), JSON.stringify(raw)).not.toBeNull();
    }
  });

  it("入力欄から入れた名前は、再読み込みしても作りかけごと消えない", () => {
    const storage = memoryStorage();
    const rs = createRouteStore({ storage, lookup });
    rs.addStation("s1");
    rs.addStation("s2");
    rs.setName("家族\u{1F468}‍\u{1F469}‍\u{1F467}線");
    rs.flush();
    const again = createRouteStore({ storage, lookup });
    expect(again.getDraft().stations).toEqual(["s1", "s2"]);
    expect(again.getDraft().name).toBe("家族\u{1F468}\u{1F469}\u{1F467}線");
  });

  it("前の版で保存した、検査に通らない名前があっても、駅・電車は残し、名前だけ初期値に戻す。元の文字列は退避する", () => {
    const def = defaultRouteDraft();
    const bad = { ...def, name: "‍‍", stations: ["s1", "s2", "s3"], loop: true, train: { ...def.train, cars: 3, bodyColor: "red" } };
    const json = JSON.stringify({ ver: 1, draft: bad });
    const r = restoreDraftReport(json, lookup);
    expect(r.damaged).toBe(true);
    expect(r.draft.stations).toEqual(["s1", "s2", "s3"]);
    expect(r.draft.loop).toBe(true);
    expect(r.draft.train.cars).toBe(3);
    expect(r.draft.train.bodyColor).toBe("red");
    expect(r.draft.name).toBe(def.name);

    const storage = memoryStorage({ [STORAGE_KEYS.draft]: json });
    createRouteStore({ storage, lookup });
    expect(storage.getItem(STORAGE_KEYS.draftBackup)).toBe(json);
  });

  it("電車の一部の部位だけ壊れていても、ほかの部位は残す", () => {
    const def = defaultRouteDraft();
    const bad = { ...def, stations: ["s1"], train: { ...def.train, face: { ...def.train.face, window: "???" }, bodyColor: "pink", cars: 5 } };
    const r = restoreDraftReport(JSON.stringify({ ver: 1, draft: bad }), lookup);
    expect(r.damaged).toBe(true);
    expect(r.draft.train.face).toEqual(def.train.face);
    expect(r.draft.train.bodyColor).toBe("pink");
    expect(r.draft.train.cars).toBe(5);
    expect(r.draft.stations).toEqual(["s1"]);
  });

  it("読めない・知らない版のデータは、上書きする前に退避する", () => {
    for (const json of ["{壊れた", JSON.stringify({ ver: 99, draft: {} })]) {
      const storage = memoryStorage({ [STORAGE_KEYS.draft]: json });
      const rs = createRouteStore({ storage, lookup, saveDelayMs: 10 });
      rs.addStation("s1");
      rs.flush();
      expect(storage.getItem(STORAGE_KEYS.draftBackup)).toBe(json);
      expect(storage.getItem(STORAGE_KEYS.draft)).not.toBe(json);
    }
  });
});

describe("指摘1: 作りかけの自動保存の失敗", () => {
  it("書けなかったら未保存の印を残し、次の機会にやり直す", () => {
    const base = memoryStorage();
    let full = true;
    const storage = {
      ...base,
      setItem(k: string, v: string) {
        if (full) throw new Error("QuotaExceededError");
        base.setItem(k, v);
      },
    };
    const rs = createRouteStore({ storage, lookup, saveDelayMs: 100 });
    rs.addStation("s1");
    vi.advanceTimersByTime(100);
    expect(rs.store.get().persistFailed).toBe(true);
    expect(base.getItem(STORAGE_KEYS.draft)).toBeNull();
    // 空きができたら、次の保存で書ける（変更が無くても、ページを離れるときの flush で書く）
    full = false;
    expect(rs.flush()).toBe(true);
    expect(rs.store.get().persistFailed).toBe(false);
    expect(JSON.parse(base.getItem(STORAGE_KEYS.draft)!).draft.stations).toEqual(["s1"]);
  });
});

describe("指摘2: 書けない保存先でも、既存の値は読む", () => {
  it("readonly: 前の値は読める。書いた値はこのページの間だけ読め、setItem は失敗を知らせる", () => {
    const base = memoryStorage({ [STORAGE_KEYS.draft]: serializeDraft({ ...defaultRouteDraft(), stations: ["s1", "s2"] }) });
    const ro = { ...base, setItem: () => { throw new Error("SecurityError"); } };
    const s = layeredStorage(ro, "readonly");
    expect(s.mode).toBe("readonly");
    const rs = createRouteStore({ storage: s, lookup });
    expect(rs.getDraft().stations).toEqual(["s1", "s2"]);
    expect(safeSet(s, "k", "v")).toBe(false);
    expect(s.getItem("k")).toBe("v");
    s.removeItem(STORAGE_KEYS.draft);
    expect(s.getItem(STORAGE_KEYS.draft)).toBeNull();
  });

  it("memory: 保存先が無くても動き、書き込みは失敗として知らせる", () => {
    const s = layeredStorage(null, "memory");
    expect(safeSet(s, "k", "v")).toBe(false);
    expect(s.getItem("k")).toBe("v");
  });

  it("ok: 書けたものは保存先に入り、書けなかったものだけ記憶に残る", () => {
    const base = memoryStorage();
    let fail = false;
    const s = layeredStorage({ ...base, setItem: (k, v) => { if (fail) throw new Error("full"); base.setItem(k, v); } }, "ok");
    expect(safeSet(s, "a", "1")).toBe(true);
    expect(base.getItem("a")).toBe("1");
    fail = true;
    expect(safeSet(s, "a", "2")).toBe(false);
    expect(s.getItem("a")).toBe("2");
    fail = false;
    expect(safeSet(s, "a", "3")).toBe(true);
    expect(base.getItem("a")).toBe("3");
    expect(s.getItem("a")).toBe("3");
  });
});

describe("指摘4: ほかのタブの作りかけ", () => {
  it("ほかのタブの変更を取り込む。こちらに未保存の変更があるときは、こちらを優先する", () => {
    const storage = memoryStorage();
    const listeners: ((k: string | null) => void)[] = [];
    const sub = (cb: (k: string | null) => void) => (listeners.push(cb), () => {});
    const a = createRouteStore({ storage, lookup, saveDelayMs: 100, subscribeExternal: sub });
    const b = createRouteStore({ storage, lookup, saveDelayMs: 100 });
    b.addStation("s5");
    b.flush();
    for (const l of listeners) l(STORAGE_KEYS.draft);
    expect(a.getDraft().stations).toEqual(["s5"]);
    // こちらで変更中（まだ書いていない）なら取り込まない
    a.addStation("s6");
    b.addStation("s7");
    b.flush();
    for (const l of listeners) l(STORAGE_KEYS.draft);
    expect(a.getDraft().stations).toEqual(["s5", "s6"]);
  });
});

describe("指摘7: ログアウト", () => {
  it("成功か 401 なら true。通信の失敗やほかのエラーなら false（ログイン画面に戻さない）", async () => {
    expect(await tryLogout({ logout: async () => ({ ok: true as const }) })).toBe(true);
    expect(await tryLogout({ logout: async () => { throw new AdminApiError(401, "unauthorized"); } })).toBe(true);
    expect(await tryLogout({ logout: async () => { throw new AdminApiError(0, "network"); } })).toBe(false);
    expect(await tryLogout({ logout: async () => { throw new AdminApiError(500, "internal"); } })).toBe(false);
  });
});
