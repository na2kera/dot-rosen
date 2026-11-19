import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id"> & {
  label: ReactNode;
  value: string;
  /** 入力が変わったとき（かな漢字変換の途中は呼ばない） */
  onValue(v: string): void;
  /** 右上に出す補足（残りの文字数など） */
  aside?: ReactNode;
  note?: ReactNode;
};

/**
 * 1行の入力欄。かな漢字変換の途中は手元の値だけを変え、確定してから onValue を呼ぶ
 * （途中で文字数を切ると変換が壊れるため）。
 */
export function TextField({ label, value, onValue, aside, note, ...rest }: Props) {
  const id = useId();
  const [local, setLocal] = useState(value);
  const composing = useRef(false);
  // 入力のたびに数を進め、外の値が変わらなかったとき（英字以外を打ったなど）も表示を外の値に戻す
  const [tick, setTick] = useState(0);

  // 外から値が変わったら（切り詰め・大文字化など）合わせる
  useEffect(() => {
    if (!composing.current) setLocal(value);
  }, [value, tick]);

  return (
    <div className="field">
      <div className="field__head">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <input
        id={id}
        className="field__input"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          if (!composing.current) {
            onValue(e.target.value);
            setTick((t) => t + 1);
          }
        }}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={(e) => {
          composing.current = false;
          onValue(e.currentTarget.value);
          setTick((t) => t + 1);
        }}
        autoComplete="off"
        {...rest}
      />
      {note && <p className="field__note">{note}</p>}
    </div>
  );
}
