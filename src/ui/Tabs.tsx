// 横に並んだタブ。選んでいるものは反転表示
import { useId } from "react";

type Props<T extends string> = {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange(id: T): void;
  label: string;
};

export function Tabs<T extends string>({ tabs, value, onChange, label }: Props<T>) {
  const base = useId();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${base}-${t.id}`}
          type="button"
          role="tab"
          className="tabs__btn"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
