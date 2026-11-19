// 短いお知らせ。どこからでも toast() を呼べ、<ToastHost /> が表示する。
import { useSyncExternalStore } from "react";
import { createStore } from "../store/create-store.ts";

type Item = { id: number; text: string; tone: "normal" | "alert" };

const items = createStore<Item[]>([]);
let seq = 0;

/** お知らせを出す（同じ文が出ている間は重ねない） */
export function toast(text: string, opts: { tone?: "normal" | "alert"; ms?: number } = {}): void {
  if (items.get().some((t) => t.text === text)) return;
  const id = ++seq;
  items.set((list) => [...list.slice(-1), { id, text, tone: opts.tone ?? "normal" }]);
  setTimeout(() => items.set((list) => list.filter((t) => t.id !== id)), opts.ms ?? 2400);
}

export function ToastHost() {
  const list = useSyncExternalStore(items.subscribe, items.get);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone === "alert" ? "toast--alert" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
