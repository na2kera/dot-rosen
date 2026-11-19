// 画面のストア（src/store）の試験。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRouteDraft, MAX_STATIONS, type StationLookup } from "../shared/route/index.ts";
import { captureEventCode, getEventCode, getOrCreateClientId } from "../src/store/device.ts";
import { memoryStorage, STORAGE_KEYS } from "../src/store/kv-storage.ts";
import { cleanSymbol, clampName, nameRemaining } from "../src/store/route-ops.ts";
import { createRouteStore, restoreDraft, serializeDraft } from "../src/store/route-store.ts";

const STATIONS: Record<string, { name: string; lat: number; lon: number }> = {};
for (let i = 1; i <= 40; i++) STATIONS[`s${i}`] = { name: `駅${i}`, lat: 35 + i / 100, lon: 139.5 };
const lookup: StationLookup = (id) => STATIONS[id];

const setup = (initial: Record<string, string> = {}) => {
  const storage = memoryStorage(initial);
  const rs = createRouteStore({ storage, lookup, saveDelayMs: 100 });
  return { storage, rs, st: () => rs.getDraft().stations };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("駅の並び", () => {
  it("タップした順に加わる。同じ駅は2回入らない", () => {
    const { rs, st } = setup();
    expect(rs.addStation("s1").ok).toBe(true);
    expect(rs.addStation("s2").ok).toBe(true);
    expect(rs.addStation("s1")).toEqual({ ok: false, reason: "duplicate" });
    expect(st()).toEqual(["s1", "s2"]);
  });

  it("30駅で上限", () => {
    const { rs, st } = setup();
    for (let i = 1; i <= MAX_STATIONS; i++) expect(rs.addStation(`s${i}`).ok).toBe(true);
    expect(rs.addStation("s31")).toEqual({ ok: false, reason: "full" });
    expect(rs.insertAfter(0, "s32")).toEqual({ ok: false, reason: "full" });
    expect(st().length).toBe(MAX_STATIONS);
  });

  it("削除", () => {
    const { rs, st } = setup();
    ["s1", "s2", "s3"].forEach(rs.addStation);
    rs.removeAt(1);
    expect(st()).toEqual(["s1", "s3"]);
    rs.removeStation("s1");
    expect(st()).toEqual(["s3"]);
    expect(rs.removeAt(5).ok).toBe(false);
  });

  it("並べ替え（上へ・下へ）", () => {
    const { rs, st } = setup();
    ["s1", "s2", "s3", "s4"].forEach(rs.addStation);
    rs.move(3, 2);
    expect(st()).toEqual(["s1", "s2", "s4", "s3"]);
    rs.move(0, 1);
    expect(st()).toEqual(["s2", "s1", "s4", "s3"]);
    expect(rs.move(0, -1).ok).toBe(false);
    expect(rs.move(3, 4).ok).toBe(false);
  });

  it("途中への追加（この駅の次に追加）", () => {
    const { rs, st } = setup();
    ["s1", "s2", "s3"].forEach(rs.addStation);
    expect(rs.insertAfter(0, "s9").ok).toBe(true);
    expect(st()).toEqual(["s1", "s9", "s2", "s3"]);
    expect(rs.insertAfter(3, "s8").ok).toBe(true);
    expect(st()).toEqual(["s1", "s9", "s2", "s3", "s8"]);
    expect(rs.insertAfter(0, "s2")).toEqual({ ok: false, reason: "duplicate" });
  });

  it("環状線は3駅以上。駅を足すと始発駅に戻る手前に入る。3駅未満になると環状をやめる", () => {
    const { rs, st } = setup();
    rs.addStation("s1");
    rs.addStation("s2");
    expect(rs.setLoop(true)).toEqual({ ok: false, reason: "too_short" });
    rs.addStation("s3");
    expect(rs.setLoop(true).ok).toBe(true);
    rs.addStation("s4");
    expect(st()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(rs.getDraft().loop).toBe(true);
    rs.removeAt(0);
    expect(rs.getDraft().loop).toBe(true);
    rs.removeAt(0);
    expect(st()).toEqual(["s3", "s4"]);
    expect(rs.getDraft().loop).toBe(false);
  });

  it("ぜんぶ消す", () => {
    const { rs, st } = setup();
    ["s1", "s2", "s3"].forEach(rs.addStation);
    rs.setLoop(true);
    rs.clearStations();
    expect(st()).toEqual([]);
    expect(rs.getDraft().loop).toBe(false);
  });
});

describe("1つ戻す", () => {
  it("最後に加えた駅を取り消す", () => {
    const { rs, st } = setup();
    rs.addStation("s1");
    rs.addStation("s2");
    expect(rs.undo()).toBe(true);
    expect(st()).toEqual(["s1"]);
    expect(rs.undo()).toBe(true);
    expect(st()).toEqual([]);
    expect(rs.undo()).toBe(false);
    expect(rs.canUndo()).toBe(false);
  });

  it("途中に加えた駅を戻すと、末尾ではなくその駅が消える", () => {
    const { rs, st } = setup();
    ["s1", "s2", "s3"].forEach(rs.addStation);
    rs.insertAfter(0, "s9");
    rs.undo();
    expect(st()).toEqual(["s1", "s2", "s3"]);
  });

  it("削除・並べ替え・環状・ぜんぶ消すも戻せる。失敗した操作は記録しない", () => {
    const { rs, st } = setup();
    ["s1", "s2", "s3"].forEach(rs.addStation);
    rs.addStation("s1"); // 重複で失敗
    rs.setLoop(true);
    rs.move(0, 2);
    rs.removeAt(0);
    rs.clearStations();
    rs.undo();
    expect(st()).toEqual(["s3", "s1"]);
    rs.undo();
    expect(st()).toEqual(["s2", "s3", "s1"]);
    rs.undo();
    expect(st()).toEqual(["s1", "s2", "s3"]);
    expect(rs.getDraft().loop).toBe(true);
    rs.undo();
    expect(rs.getDraft().loop).toBe(false);
    rs.undo();
    expect(st()).toEqual(["s1", "s2"]);
  });

  it("路線名などの変更は戻す対象にしない", () => {
    const { rs } = setup();
    rs.addStation("s1");
    rs.setName("テスト線");
    rs.undo();
    expect(rs.getDraft().name).toBe("テスト線");
    expect(rs.getDraft().stations).toEqual([]);
  });
});

describe("路線名・路線記号", () => {
  it("路線名は12文字（コードポイント）まで。改行は除く", () => {
    expect(clampName("あいうえおかきくけこさしすせ")).toBe("あいうえおかきくけこさし");
    expect(clampName("𠮷野家𠮷野家𠮷野家𠮷野家𠮷")).toBe("𠮷野家𠮷野家𠮷野家𠮷野家");
    expect(clampName("新\n線")).toBe("新線");
    expect(nameRemaining("𠮷野家")).toBe(9);
  });

  it("路線記号は英字だけ、大文字、2文字まで", () => {
    expect(cleanSymbol("kr")).toBe("KR");
    expect(cleanSymbol("k1r2x")).toBe("KR");
    expect(cleanSymbol("ａｂ")).toBe("AB");
    expect(cleanSymbol("あ")).toBe("");
  });
});

describe("保存と復元", () => {
  it("変更は少し間をおいてまとめて保存される", () => {
    const { rs, storage } = setup();
    rs.addStation("s1");
    rs.addStation("s2");
    rs.setName("テスト線");
    expect(storage.getItem(STORAGE_KEYS.draft)).toBeNull();
    vi.advanceTimersByTime(99);
    expect(storage.getItem(STORAGE_KEYS.draft)).toBeNull();
    vi.advanceTimersByTime(1);
    const saved = JSON.parse(storage.getItem(STORAGE_KEYS.draft)!);
    expect(saved.ver).toBe(1);
    expect(saved.draft.stations).toEqual(["s1", "s2"]);
    expect(saved.draft.name).toBe("テスト線");
  });

  it("flush ですぐ保存し、作り直したストアに復元される", () => {
    const { rs, storage } = setup();
    ["s1", "s2", "s3"].forEach(rs.addStation);
    rs.setLoop(true);
    rs.setSymbol("kr");
    rs.setLineColor("blue");
    rs.flush();
    const rs2 = createRouteStore({ storage, lookup });
    expect(rs2.getDraft()).toEqual({ ...defaultRouteDraft(), stations: ["s1", "s2", "s3"], loop: true, symbol: "KR", lineColor: "blue" });
    expect(rs2.canUndo()).toBe(false);
  });

  it("入力途中で空にした路線名・路線記号でも、駅は消えずに戻る", () => {
    const { rs, storage } = setup();
    rs.addStation("s1");
    rs.addStation("s2");
    rs.setName("");
    rs.setSymbol("");
    rs.flush();
    const d = createRouteStore({ storage, lookup }).getDraft();
    expect(d.stations).toEqual(["s1", "s2"]);
    expect(d.name).toBe("");
    expect(d.symbol).toBe("");
  });

  it("読めない・版が違う保存データは初期値に戻す。検査に通らない項目は、その項目だけ直す", () => {
    const def = defaultRouteDraft();
    expect(restoreDraft(null, lookup)).toEqual(def);
    expect(restoreDraft("{壊れた", lookup)).toEqual(def);
    expect(restoreDraft(JSON.stringify({ ver: 99, draft: def }), lookup)).toEqual(def);
    // 重なった駅は1つにする（全体は捨てない）
    expect(restoreDraft(JSON.stringify({ ver: 1, draft: { ...def, stations: ["s1", "s1"] } }), lookup)).toEqual({ ...def, stations: ["s1"] });
    expect(restoreDraft(JSON.stringify({ ver: 1, draft: { ...def, stations: ["nope"] } }), lookup)).toEqual(def);
    expect(restoreDraft(JSON.stringify({ ver: 1, draft: "x" }), lookup)).toEqual(def);
    expect(restoreDraft(serializeDraft({ ...def, stations: ["s1"] }), lookup).stations).toEqual(["s1"]);
  });

  it("保存先が使えなくても動く", () => {
    const broken = {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("x");
      },
      removeItem: () => {},
    };
    const rs = createRouteStore({ storage: broken, lookup });
    rs.addStation("s1");
    expect(() => rs.flush()).not.toThrow();
    expect(rs.getDraft().stations).toEqual(["s1"]);
  });
});

describe("端末の値", () => {
  it("clientId は最初に作って保存し、次からは同じものを返す", () => {
    const storage = memoryStorage();
    const random = (n: number) => new Uint8Array(n).fill(0xab);
    const id = getOrCreateClientId(storage, random);
    expect(id).toBe("ab".repeat(16));
    expect(getOrCreateClientId(storage, () => new Uint8Array(16))).toBe(id);
  });

  it("?event= の会場コードを覚えて URL から消す", () => {
    const storage = memoryStorage();
    expect(captureEventCode("https://x.test/?event=ABCD2345&a=1#h", storage)).toBe("/?a=1#h");
    expect(getEventCode(storage)).toBe("ABCD2345");
    expect(captureEventCode("https://x.test/r/abc", storage)).toBeNull();
    // 形のおかしいものは覚えないが、URL からは消す
    expect(captureEventCode("https://x.test/?event=%3Cx%3E", memoryStorage())).toBe("/");
  });
});
