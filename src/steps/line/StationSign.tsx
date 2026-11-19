// 選んだ内容がすぐ分かる小さな「駅名標」
import type { ColorId } from "../../../shared/train/colors.ts";
import { colorHex, inkOn } from "../../ui/color.ts";

type Props = {
  lineName: string;
  symbol: string;
  color: ColorId;
  /** 始発駅の名前（無ければ仮の表示） */
  station: string | null;
  next: string | null;
};

export function StationSign({ lineName, symbol, color, station, next }: Props) {
  const hex = colorHex(color);
  return (
    <figure className="sign" aria-label="駅名標のみほん">
      <p className="sign__line">{lineName || "　"}</p>
      <div className="sign__main">
        <span className="sign__num" style={{ borderColor: hex }}>
          <span>{symbol || "　"}</span>
          <span>01</span>
        </span>
        <span className="sign__name text-l">{station ?? "えき"}</span>
      </div>
      <div className="sign__band" style={{ background: hex, color: inkOn(color) }}>
        <span className="sign__next">つぎは</span>
        <span className="sign__next">{next ?? "つぎのえき"} →</span>
      </div>
    </figure>
  );
}
