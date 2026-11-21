// 路線カードの表示。カラー版と印刷プレビュー（白黒）を切り替えられる。縦に長いので枠の中でスクロールする
import { useMemo, useState } from "react";
import { PixelCanvas } from "../ui/PixelCanvas.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import type { RenderedCard } from "./useCard.ts";

export type ViewMode = "color" | "print";
type Mode = ViewMode;
const MODES: readonly { id: Mode; label: string }[] = [
  { id: "color", label: "カラー" },
  { id: "print", label: "印刷プレビュー" },
];

/** 「カラー／印刷プレビュー」の切り替え（電車をつくるの「大きく見る画面」でも使う） */
export function ViewModeTabs({ value, onChange, label }: { value: ViewMode; onChange(m: ViewMode): void; label: string }) {
  return <Tabs<Mode> tabs={MODES} value={value} onChange={onChange} label={label} />;
}

export function CardView({ card, className }: { card: RenderedCard | null; className?: string }) {
  const [mode, setMode] = useState<Mode>("color");
  const source = useMemo(() => {
    if (!card || "error" in card) return null;
    if (mode === "color") return card.color;
    try {
      return { image: card.print() };
    } catch {
      return null;
    }
  }, [card, mode]);

  return (
    <div className={`cardview ${className ?? ""}`}>
      <ViewModeTabs value={mode} onChange={setMode} label="カードの見え方" />
      <div className="cardview__scroll" data-mode={mode}>
        {card && "error" in card ? (
          <p className="cardview__msg text-alert">カードを描けませんでした（{card.error}）</p>
        ) : source ? (
          <PixelCanvas source={source} fit label={mode === "color" ? "路線カード（カラー）" : "路線カード（印刷プレビュー）"} />
        ) : (
          <p className="cardview__msg">カードを描いています…</p>
        )}
      </div>
    </div>
  );
}
