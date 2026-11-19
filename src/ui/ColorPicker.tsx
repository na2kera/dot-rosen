import { useId } from "react";
import { COLOR_IDS, COLOR_LABELS, type ColorId } from "../../shared/train/colors.ts";
import { colorHex, inkOn } from "./color.ts";
import { PixelIcon } from "./PixelIcon.tsx";

type Props = {
  value: ColorId;
  onChange(c: ColorId): void;
  /** 読み上げ用の名前（例: ラインカラー） */
  label: string;
};

/** 12色の色見本から1色を選ぶ（ラジオボタン） */
export function ColorPicker({ value, onChange, label }: Props) {
  const name = useId();
  return (
    <fieldset className="swatches" aria-label={label}>
      {COLOR_IDS.map((id) => (
        <label key={id} className="swatch" style={{ background: colorHex(id), color: inkOn(id) }} title={COLOR_LABELS[id]}>
          <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} aria-label={COLOR_LABELS[id]} />
          <span className="swatch__check">
            <PixelIcon name="check" />
          </span>
        </label>
      ))}
    </fieldset>
  );
}
