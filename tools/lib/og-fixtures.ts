// 路線ごとの X 用の絵（shared/og）の見本の路線（tools/og-route-sheet.ts と tests/og.test.ts で共用）。
import { MAX_CARS, type RouteData } from "../../shared/route/index.ts";
import { createRng, defaultDesign, logoFromArt, PRESET_LOGOS, randomDesign, type TrainDesign } from "../../shared/train/index.ts";
import { FixtureKit, LONG30, YAMANOTE } from "./card-fixtures.ts";

export type OgFixture = { id: string; label: string; route: RouteData };

const design = (seed: number, cars: number): TrainDesign => ({ ...randomDesign(createRng(seed)), cars });

/** 自作ロゴの例（線路と電車の形） */
const MY_LOGO = logoFromArt([
  "................",
  "..############..",
  ".##..........##.",
  ".#.###....###.#.",
  ".#.#.#....#.#.#.",
  ".#.###....###.#.",
  ".#............#.",
  ".##############.",
  ".#..##....##..#.",
  ".##############.",
  "...##......##...",
  "..#..#....#..#..",
  "...##......##...",
  "................",
  "################",
  "#..#..#..#..#..#",
]);

export function ogFixtures(kit: FixtureKit): OgFixture[] {
  const base = defaultDesign();
  const mid = ["横浜", "みなとみらい", "川崎", "武蔵小杉", "自由が丘", "渋谷", "新宿", "池袋"];
  const list: OgFixture[] = [
    {
      id: "01-no-name",
      label: "名前なし（空。フォントに無い文字だけの名前もこれと同じ）",
      route: { ...kit.route({ name: "仮", symbol: "DR", lineColor: "green", stations: mid, train: design(5, 8) }), name: "" },
    },
    {
      id: "02-name-12",
      label: "名前 12 文字",
      route: kit.route({ name: "多摩川ベイサイド高速鉄道", symbol: "TB", lineColor: "blue", stations: mid, train: design(3, 6) }),
    },
    {
      id: "03-2st",
      label: "2 駅",
      route: kit.route({ name: "みどり線", symbol: "M", lineColor: "green", stations: ["新宿", "渋谷"], train: { ...base, cars: 4 } }),
    },
    {
      id: "04-30st-max",
      label: "30 駅・最大両数・長い駅名・12 文字",
      route: kit.route({ name: "多摩川ベイサイド高速鉄道", symbol: "TB", lineColor: "purple", stations: LONG30, train: design(3, MAX_CARS) }),
    },
    {
      id: "05-loop",
      label: "環状（30 駅）",
      route: kit.route({ name: "ぐるっと環状線", symbol: "JY", lineColor: "lime", stations: YAMANOTE, loop: true, train: design(11, 11) }),
    },
    {
      id: "06-1car",
      label: "1 両",
      route: kit.route({ name: "ちいさな線", symbol: "C", lineColor: "orange", stations: ["上野", "秋葉原", "東京"], train: { ...base, cars: 1 } }),
    },
    {
      id: "07-pale",
      label: "淡い車体色（白）・黄色の線",
      route: kit.route({
        name: "しろくま線",
        symbol: "SK",
        lineColor: "yellow",
        stations: ["東京", "品川", "横浜", "大船"],
        train: { ...base, bodyColor: "white", bandColor: "sky", cars: 3, logo: { ...base.logo, fg: "sky", bg: "white" } },
      }),
    },
    {
      id: "08-dark",
      label: "濃い車体色（黒）・黒の線",
      route: kit.route({
        name: "よるの急行",
        symbol: "YK",
        lineColor: "black",
        stations: ["池袋", "新宿", "渋谷", "品川", "東京"],
        train: { ...base, bodyColor: "black", bandColor: "red", cars: 8, logo: { ...base.logo, fg: "red", bg: "black" } },
      }),
    },
    {
      id: "09-my-logo",
      label: "自作ロゴ",
      route: kit.route({
        name: "Dot-Rosen 7!",
        symbol: "DX",
        lineColor: "red",
        stations: ["東京", "品川", "横浜"],
        train: { ...design(8, 2), logo: { bits: MY_LOGO, fg: "yellow", bg: "blue" } },
      }),
    },
    {
      id: "10-preset-logo",
      label: "既製ロゴ・フォントに無い文字を含む名前",
      route: kit.route({
        name: "鉄道🚃テスト線",
        symbol: "Q",
        lineColor: "pink",
        stations: ["上野", "秋葉原", "東京", "新橋"],
        train: { ...design(9, 5), logo: { bits: PRESET_LOGOS[5].bits, fg: "pink", bg: "white" } },
      }),
    },
  ];
  return list;
}
