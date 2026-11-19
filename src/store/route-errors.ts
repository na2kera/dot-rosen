// 路線データの検査（shared/route の RouteError）の理由を、分かる言葉にする。DOM に依存しない。
import type { RouteError } from "../../shared/route/index.ts";

const TEXT: Record<RouteError, string> = {
  too_large: "路線のデータが大きすぎます",
  invalid_format: "路線のデータの形がちがいます",
  invalid_version: "古い形の路線のデータです",
  invalid_name: "路線の名前を入れてね（1〜12文字）",
  invalid_symbol: "路線記号を英字1〜2文字で入れてね",
  invalid_line_color: "ラインカラーをえらびなおしてね",
  invalid_stations: "駅のならびが読めません",
  too_few_stations: "駅を2つ以上えらんでね",
  too_many_stations: "駅は30駅までです",
  unknown_station: "知らない駅が入っています",
  duplicate_station: "同じ駅が2回入っています",
  invalid_loop: "環状線の設定が読めません",
  loop_too_short: "環状線にするには駅が3つ以上いります",
  invalid_train: "電車のデザインが読めません",
  invalid_face: "電車の顔のパーツが読めません",
  invalid_side: "電車の側面のパーツが読めません",
  invalid_color: "電車の色が読めません",
  invalid_cars: "両数は1〜16両です",
  invalid_logo: "ロゴが読めません",
};

/** 知らない理由なら null */
export function routeErrorText(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(TEXT, code) ? TEXT[code as RouteError] : null;
}

/** 直すために開くステップ */
export function routeErrorStep(code: string): 1 | 2 | 3 | null {
  if (["invalid_name", "invalid_symbol", "invalid_line_color"].includes(code)) return 2;
  if (["too_few_stations", "too_many_stations", "unknown_station", "duplicate_station", "invalid_loop", "loop_too_short", "invalid_stations"].includes(code)) return 1;
  if (code.startsWith("invalid_") && ["invalid_train", "invalid_face", "invalid_side", "invalid_color", "invalid_cars", "invalid_logo"].includes(code)) return 3;
  return null;
}
