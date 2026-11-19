// 再印刷の確認ダイアログの中に出す、見た目（模様と側面の置き方）の選択。刷り比べ用。
// 選んだ値は onChange で呼び出し側の入れ物に書き戻す（ダイアログは押されたボタンしか返さないため）。
import { useState } from "react";
import { CARD_MONO_SETS, CARD_SIDE_LAYOUTS, type CardLook } from "../../shared/card/index.ts";
import { PixelIcon } from "../ui/PixelIcon.tsx";
import { MONO_SET_LABELS, SIDE_LAYOUT_LABELS } from "./format.ts";

export function ReprintLookPicker({ initial, onChange, idPrefix }: { initial: CardLook; onChange(look: CardLook): void; idPrefix: string }) {
  const [look, setLook] = useState<CardLook>(initial);
  const set = (next: CardLook) => {
    setLook(next);
    onChange(next);
  };
  return (
    <div className="adm-look">
      <fieldset className="adm-look__group">
        <legend>模様</legend>
        {CARD_MONO_SETS.map((m) => (
          <label key={m} className="toggle">
            <input type="radio" name={`${idPrefix}-mono`} value={m} checked={look.monoSet === m} onChange={() => set({ ...look, monoSet: m })} />
            <span className="toggle__box" aria-hidden="true">
              <PixelIcon name="check" />
            </span>
            <span>{MONO_SET_LABELS[m]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="adm-look__group">
        <legend>側面の置き方</legend>
        {CARD_SIDE_LAYOUTS.map((s) => (
          <label key={s} className="toggle">
            <input
              type="radio"
              name={`${idPrefix}-side`}
              value={s}
              checked={look.sideLayout === s}
              onChange={() => set({ ...look, sideLayout: s })}
            />
            <span className="toggle__box" aria-hidden="true">
              <PixelIcon name="check" />
            </span>
            <span>{SIDE_LAYOUT_LABELS[s]}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-weak">はじめは元の印刷と同じ見た目です。</p>
    </div>
  );
}
