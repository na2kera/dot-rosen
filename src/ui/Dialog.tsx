// 自前の確認ダイアログ（window.confirm は使わない）。
// どこからでも ask() / confirmDialog() を呼べ、<DialogHost /> が表示する。
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createStore } from "../store/create-store.ts";
import { Backdrop } from "./Backdrop.tsx";
import { Button } from "./Button.tsx";

export type DialogAction<T> = {
  value: T;
  label: string;
  tone?: "normal" | "primary" | "danger";
};

type Request = {
  id: number;
  title?: string;
  message: ReactNode;
  actions: DialogAction<unknown>[];
  /** 背景を押したり Esc を押したりしたときの値 */
  cancelValue: unknown;
  /** ボタンを横に並べる（2つのとき） */
  row: boolean;
  resolve(v: unknown): void;
};

const queue = createStore<Request[]>([]);
let seq = 0;

/** 選択肢を出して、押されたものの value を返す */
export function ask<T>(opts: { title?: string; message: ReactNode; actions: DialogAction<T>[]; cancelValue: T }): Promise<T> {
  return new Promise<T>((resolve) => {
    const req: Request = {
      id: ++seq,
      title: opts.title,
      message: opts.message,
      actions: opts.actions as DialogAction<unknown>[],
      cancelValue: opts.cancelValue,
      row: opts.actions.length === 2,
      resolve: resolve as (v: unknown) => void,
    };
    queue.set((q) => [...q, req]);
  });
}

/** はい／いいえの確認 */
export function confirmDialog(message: ReactNode, opts: { ok?: string; cancel?: string; danger?: boolean; title?: string } = {}): Promise<boolean> {
  return ask<boolean>({
    title: opts.title,
    message,
    cancelValue: false,
    actions: [
      { value: false, label: opts.cancel ?? "やめる" },
      { value: true, label: opts.ok ?? "はい", tone: opts.danger ? "danger" : "primary" },
    ],
  });
}

function close(req: Request, value: unknown) {
  queue.set((q) => q.filter((r) => r.id !== req.id));
  req.resolve(value);
}

export function DialogHost() {
  const q = useSyncExternalStore(queue.subscribe, queue.get);
  const req = q[0];
  const first = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!req) return;
    const prev = document.activeElement as HTMLElement | null;
    first.current?.querySelector<HTMLButtonElement>("button:last-child")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(req, req.cancelValue);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [req]);

  if (!req) return null;
  return (
    <div className="dialog-layer">
      <Backdrop key={req.id} onClose={() => close(req, req.cancelValue)} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={`dlg-${req.id}`}>
        <div className="dialog__body">
          {req.title && <h2 className="text-l">{req.title}</h2>}
          <div id={`dlg-${req.id}`}>{req.message}</div>
        </div>
        <div className={`dialog__actions ${req.row ? "dialog__actions--row" : ""}`} ref={first}>
          {req.actions.map((a, i) => (
            <Button key={i} variant={a.tone ?? "normal"} block onClick={() => close(req, a.value)}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
