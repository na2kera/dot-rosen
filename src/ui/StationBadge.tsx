import type { ColorId } from "../../shared/train/colors.ts";
import { colorHex, inkOn } from "./color.ts";

/** 駅ナンバリングの印（例: KR01）。ラインカラーの地に文字 */
export function StationBadge({ number, color }: { number: string; color: ColorId }) {
  return (
    <span className="badge" style={{ background: colorHex(color), color: inkOn(color) }}>
      {number}
    </span>
  );
}
