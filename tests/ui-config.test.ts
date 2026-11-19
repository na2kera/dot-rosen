// 画面の印刷プレビューをサーバーの設定に合わせる（src/store/server-config.ts、src/card/card-input.ts、
// src/store/publish-store.ts の申し込み時の見た目）の試験。
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_MONO_SETS, CARD_SIDE_LAYOUTS, cardRaster, renderCardColor, renderCardPrint, type CardLook } from "../shared/card/index.ts";
import { defaultRouteDraft, type RouteData } from "../shared/route/index.ts";
import { defaultDesign } from "../shared/train/index.ts";
import { createApi, type FetchLike } from "../src/api/client.ts";
import { APP_NAME, cardInputs, previewLook } from "../src/card/card-input.ts";
import { memoryStorage, STORAGE_KEYS } from "../src/store/kv-storage.ts";
import { createPublishStore, readPrint } from "../src/store/publish-store.ts";
import { createConfigLoader, DEFAULT_SERVER_CONFIG, parseServerConfig } from "../src/store/server-config.ts";
import { FixtureKit, loadFont, loadStations } from "../tools/lib/card-fixtures.ts";
import { buildCardRaster } from "../worker/lib/card.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("サーバーの設定の読み取り", () => {
  it("正しい応答はそのまま、足りない・不正な項目は既定値（bold / two-x1）", () => {
    expect(parseServerConfig({ card: { monoSet: "light", sideLayout: "lead-x2" }, expiryDays: 7 })).toEqual({
      card: { monoSet: "light", sideLayout: "lead-x2" },
      expiryDays: 7,
    });
    expect(parseServerConfig({ card: { monoSet: "light" } })).toEqual({ card: { monoSet: "light", sideLayout: "two-x1" }, expiryDays: null });
    expect(parseServerConfig({ card: { monoSet: "dark", sideLayout: 3 }, expiryDays: "30" })).toEqual(DEFAULT_SERVER_CONFIG);
    expect(parseServerConfig(null)).toEqual(DEFAULT_SERVER_CONFIG);
    expect(parseServerConfig("x")).toEqual(DEFAULT_SERVER_CONFIG);
  });
});

describe("設定の取得", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const loaderWith = (fetchFn: FetchLike) => {
    const calls: string[] = [];
    const api = createApi(async (input, init) => {
      calls.push(`${init?.method} ${input}`);
      return fetchFn(input, init);
    });
    return { loader: createConfigLoader(api), calls };
  };

  it("取れたら store に入れ、2回目からは取りに行かない", async () => {
    const { loader, calls } = loaderWith(async () => json(200, { card: { monoSet: "light", sideLayout: "two-x2-rotated" }, expiryDays: 30 }));
    expect(loader.store.get()).toEqual(DEFAULT_SERVER_CONFIG);
    const cfg = await loader.load();
    expect(cfg.card).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
    expect(loader.store.get()).toBe(cfg);
    await loader.load();
    expect(calls).toEqual(["GET /api/config"]);
  });

  it("通信に失敗したら既定値で進み（reject しない）、次の読み込みで取り直す", async () => {
    let fail = true;
    const { loader, calls } = loaderWith(async () => {
      if (fail) throw new TypeError("Failed to fetch");
      return json(200, { card: { monoSet: "light", sideLayout: "lead-x2" }, expiryDays: 30 });
    });
    await expect(loader.load()).resolves.toEqual(DEFAULT_SERVER_CONFIG);
    expect(loader.store.get()).toEqual(DEFAULT_SERVER_CONFIG);
    fail = false;
    expect((await loader.load()).card).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
    expect(calls).toHaveLength(2);
  });

  it("サーバーのエラー（500）や壊れた本文も既定値", async () => {
    const a = loaderWith(async () => json(500, { error: "internal" }));
    await expect(a.loader.load()).resolves.toEqual(DEFAULT_SERVER_CONFIG);
    const b = loaderWith(async () => new Response("<html>", { status: 200 }));
    await expect(b.loader.load()).resolves.toEqual(DEFAULT_SERVER_CONFIG);
  });

  it("返事が来なければ時間切れで既定値にし、あとから届いたものは取り込む", async () => {
    let release: (r: Response) => void = () => {};
    const { loader } = loaderWith(() => new Promise<Response>((res) => (release = res)));
    const p = loader.load();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual(DEFAULT_SERVER_CONFIG);
    release(json(200, { card: { monoSet: "light", sideLayout: "lead-x2" }, expiryDays: 30 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.store.get().card).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
  });
});

describe("プレビューに見た目が渡る", () => {
  let kit: FixtureKit;
  let route: RouteData;
  beforeAll(() => {
    kit = new FixtureKit(loadFont(ROOT), loadStations(ROOT));
    route = kit.route({ name: "ドット本線", symbol: "DR", lineColor: "orange", stations: ["横浜", "川崎", "品川", "東京"], train: { ...defaultDesign(), cars: 8 } });
  });

  it("印刷版には模様と側面の置き方、カラー版には側面の置き方だけを渡す", () => {
    const look: CardLook = { monoSet: "light", sideLayout: "two-x2-rotated" };
    const inp = cardInputs(route, kit.lookup, kit.font, { url: "https://x.test/r/abc", expiresAt: null, look });
    expect(inp.print).toMatchObject({ monoSet: "light", sideLayout: "two-x2-rotated", appName: APP_NAME, url: "https://x.test/r/abc" });
    expect(inp.color.sideLayout).toBe("two-x2-rotated");
    expect(inp.color.monoSet).toBeUndefined();
    // カラー版の高さも側面の置き方に合わせて変わる
    const hs = CARD_SIDE_LAYOUTS.map(
      (s) => renderCardColor(cardInputs(route, kit.lookup, kit.font, { url: null, expiresAt: null, look: { monoSet: "bold", sideLayout: s } }).color).image.height,
    );
    expect(new Set(hs).size).toBe(3);
  });

  it("6 通りとも、画面の印刷プレビューはサーバーが刷る画像と1ドット単位で一致する", () => {
    const expiresAt = "2026-12-20T03:00:00.000Z";
    for (const sideLayout of CARD_SIDE_LAYOUTS) {
      for (const monoSet of CARD_MONO_SETS) {
        const look = { monoSet, sideLayout };
        const inp = cardInputs(route, kit.lookup, kit.font, { url: "https://x.test/r/abc", expiresAt, issueNo: 7, issuedOn: "2026.11.20", look });
        const preview = cardRaster(renderCardPrint(inp.print));
        const server = buildCardRaster(
          { route, issuedOn: "2026.11.20", expiresOn: "12月20日", url: "https://x.test/r/abc", appName: APP_NAME, monoSet, sideLayout },
          7,
          { lookup: kit.lookup, font: kit.font },
        );
        expect(preview.length, `${monoSet}/${sideLayout}`).toBe(server.raster.length);
        expect(Buffer.from(preview).equals(Buffer.from(server.raster)), `${monoSet}/${sideLayout}`).toBe(true);
      }
    }
  });

  it("申し込んだ内容は申し込んだときの見た目、それ以外はサーバーの設定", () => {
    const server: CardLook = { monoSet: "bold", sideLayout: "two-x1" };
    expect(previewLook({ monoSet: "light", sideLayout: "lead-x2" }, server)).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
    expect(previewLook(null, server)).toBe(server);
    expect(previewLook(undefined, server)).toBe(server);
  });
});

describe("申し込んだときの見た目を覚える", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const data: RouteData = { ...defaultRouteDraft(), name: "テスト線", stations: ["s1", "s2"] };
  let n = 0;
  const random = (k: number) => {
    n++;
    return Uint8Array.from({ length: k }, (_, i) => (n * 13 + i * 5) & 0xff);
  };

  function setup(printBody: (body: Record<string, unknown>) => Record<string, unknown>, cardLook?: () => CardLook) {
    const storage = memoryStorage();
    const fetchFn: FetchLike = async (input, init) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (input === "/api/routes") return json(200, { id: "ROUTE00000000001", expiresAt: "2026-12-20T00:00:00.000Z" });
      if (input === "/api/print") return json(200, printBody(body));
      return json(200, { status: "queued", ahead: 0, issueNo: 41 });
    };
    const p = createPublishStore({ storage, api: createApi(fetchFn), random, clientId: "c".repeat(32), cardLook });
    return { p, storage };
  }

  it("応答の見た目（card）を記録し、端末に残す", async () => {
    const { p, storage } = setup(
      () => ({ jobId: 1, issueNo: 41, ahead: 0, status: "queued", card: { monoSet: "light", sideLayout: "two-x2-rotated" } }),
      () => ({ monoSet: "bold", sideLayout: "two-x1" }),
    );
    expect(await p.requestPrint(data, "CODE1")).toBe(true);
    expect(p.store.get().print?.card).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
    expect(readPrint(storage)?.card).toEqual({ monoSet: "light", sideLayout: "two-x2-rotated" });
    p.stopPolling();
  });

  it("応答に見た目が無ければ、申し込んだときのサーバーの設定を記録する", async () => {
    const { p } = setup(
      () => ({ jobId: 1, issueNo: 41, ahead: 0, status: "queued" }),
      () => ({ monoSet: "light", sideLayout: "lead-x2" }),
    );
    expect(await p.requestPrint(data, "CODE1")).toBe(true);
    expect(p.store.get().print?.card).toEqual({ monoSet: "light", sideLayout: "lead-x2" });
    p.stopPolling();
  });

  it("見た目の無い古い記録は捨てずに読み、card は null（画面は今の設定で描く）", () => {
    const storage = memoryStorage();
    storage.setItem(
      STORAGE_KEYS.print,
      JSON.stringify({
        routeId: "ROUTE00000000001",
        requestId: "r".repeat(22),
        jobId: 3,
        issueNo: 41,
        status: "done",
        ahead: 0,
        fingerprint: "00000000",
        eventCode: "CODE1",
        editKey: "k".repeat(22),
        issuedOn: "2026.11.20",
      }),
    );
    const rec = readPrint(storage);
    expect(rec).toMatchObject({ jobId: 3, card: null });
    expect(previewLook(rec!.card, { monoSet: "bold", sideLayout: "lead-x2" })).toEqual({ monoSet: "bold", sideLayout: "lead-x2" });
  });
});
