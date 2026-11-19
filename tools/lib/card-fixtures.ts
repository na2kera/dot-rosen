// 路線カードの確認用・テスト用の路線（tools/card-sheet.ts、tools/bench-card.ts、tests/card.test.ts で共用）。
import fs from "node:fs";
import path from "node:path";
import { parseBitmapFont, type BitmapFont } from "../../shared/font/index.ts";
import type { StationsFile } from "../../shared/geo/map-data.ts";
import { parseRouteData, type RouteData, type StationLookup } from "../../shared/route/index.ts";
import { createRng, defaultDesign, randomDesign, type ColorId, type TrainDesign } from "../../shared/train/index.ts";
import type { CardInput } from "../../shared/card/index.ts";

export function loadFont(root: string): BitmapFont {
  return parseBitmapFont(new Uint8Array(fs.readFileSync(path.join(root, "public/fonts/dotgothic16.bin"))));
}

export function loadStations(root: string): StationsFile {
  return JSON.parse(fs.readFileSync(path.join(root, "public/data/stations.json"), "utf8")) as StationsFile;
}

export type CardFixture = { id: string; label: string; input: CardInput };

/** 山手線の駅（環状線の確認用。30駅） */
export const YAMANOTE = "東京 有楽町 新橋 浜松町 田町 高輪ゲートウェイ 品川 大崎 五反田 目黒 恵比寿 渋谷 原宿 代々木 新宿 新大久保 高田馬場 目白 池袋 大塚 巣鴨 駒込 田端 西日暮里 日暮里 鶯谷 上野 御徒町 秋葉原 神田".split(" ");

/** 長い駅名を含む30駅 */
export const LONG30 = [
  "舞浜",
  "東京ディズニーランド･ステーション",
  "東京国際クルーズターミナル",
  "羽田空港第1・第2ターミナル",
  "品川",
  "高輪ゲートウェイ",
  "東京",
  "秋葉原",
  "上野",
  "とうきょうスカイツリー",
  "押上",
  "日暮里",
  "池袋",
  "新宿",
  "渋谷",
  "三軒茶屋",
  "二子玉川",
  "溝の口",
  "たまプラーザ",
  "長津田",
  "南町田グランベリーパーク",
  "中央林間",
  "町田",
  "相模大野",
  "海老名",
  "大和",
  "湘南台",
  "藤沢",
  "大船",
  "鎌倉",
];

export const APP_NAME = "ドット路線メーカー";
/** 路線ページの URL の例（路線 ID は 96 ビット以上なので base64url で 16 文字） */
export const SAMPLE_URL = "https://dot-rosen.example.workers.dev/r/Qk7xZp2LmN9aRt4V";

type RouteSpec = {
  name: string;
  symbol: string;
  lineColor: ColorId;
  stations: string[];
  loop?: boolean;
  train: TrainDesign;
};

export class FixtureKit {
  readonly lookup: StationLookup;
  private readonly byName = new Map<string, string>();
  constructor(
    readonly font: BitmapFont,
    stations: StationsFile,
  ) {
    const byId = new Map(stations.stations.map((s) => [s.id, s]));
    for (const s of stations.stations) if (!this.byName.has(s.name)) this.byName.set(s.name, s.id);
    this.lookup = (id) => byId.get(id);
  }

  id(name: string): string {
    const id = this.byName.get(name);
    if (!id) throw new Error(`駅が見つかりません: ${name}`);
    return id;
  }

  route(spec: RouteSpec): RouteData {
    const r = parseRouteData({ v: 1, loop: false, ...spec, stations: spec.stations.map((n) => this.id(n)) }, this.lookup);
    if (!r.ok) throw new Error(`路線データが不正です（${spec.name}）: ${r.error}`);
    return r.value;
  }

  input(route: RouteData, extra: Partial<CardInput> = {}): CardInput {
    return {
      route,
      lookup: this.lookup,
      font: this.font,
      issueNo: 42,
      issuedOn: "2026.11.20",
      expiresOn: "12月20日",
      url: SAMPLE_URL,
      appName: APP_NAME,
      ...extra,
    };
  }
}

const design = (seed: number, cars: number): TrainDesign => ({ ...randomDesign(createRng(seed)), cars });

/** 確認用の一覧 */
export function cardFixtures(kit: FixtureKit): CardFixture[] {
  const short = kit.route({ name: "みどり線", symbol: "M", lineColor: "green", stations: ["新宿", "渋谷"], train: { ...defaultDesign(), cars: 1 } });
  const long = kit.route({ name: "多摩川ベイサイド高速鉄道", symbol: "TB", lineColor: "blue", stations: LONG30, train: design(3, 16) });
  const loop = kit.route({ name: "ぐるっと環状線", symbol: "JY", lineColor: "lime", stations: YAMANOTE, loop: true, train: design(11, 11) });
  const mid = kit.route({
    name: "ドット本線",
    symbol: "DR",
    lineColor: "orange",
    stations: ["横浜", "みなとみらい", "川崎", "武蔵小杉", "自由が丘", "渋谷", "新宿", "池袋"],
    train: design(5, 8),
  });
  const ascii = kit.route({ name: "Dot-Rosen 7!", symbol: "DX", lineColor: "red", stations: ["東京", "品川", "横浜"], train: design(8, 4) });
  const unknown = kit.route({ name: "鉄道🚃テスト線", symbol: "Q", lineColor: "purple", stations: ["上野", "秋葉原", "東京"], train: design(9, 2) });
  const list: CardFixture[] = [
    { id: "short-2st-1car", label: "2駅・短い路線名・1両編成", input: kit.input(short) },
    { id: "long-30st-16car", label: "30駅・12文字・16両・長い駅名", input: kit.input(long) },
    { id: "loop-30st", label: "環状線 30 駅", input: kit.input(loop) },
    { id: "ascii-name", label: "半角英数と記号の路線名", input: kit.input(ascii) },
    { id: "unknown-glyph", label: "フォントに無い文字を含む路線名", input: kit.input(unknown) },
    { id: "preview-no-url", label: "プレビュー（未発行・URL なし）", input: kit.input(mid, { issueNo: null, url: undefined, expiresOn: undefined }) },
  ];
  for (const side of ["two-x1", "lead-x2", "two-x2-rotated"] as const) {
    for (const mono of ["light", "bold"] as const) {
      list.push({ id: `side-${side}-${mono}`, label: `${side} / ${mono}`, input: kit.input(mid, { sideLayout: side, monoSet: mono }) });
    }
  }
  for (const side of ["lead-x2", "two-x2-rotated"] as const) {
    list.push({ id: `short-1car-${side}`, label: `1両編成 / ${side}`, input: kit.input(short, { sideLayout: side }) });
  }
  return list;
}
