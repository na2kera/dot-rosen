import { useEffect, useId, type ReactNode } from "react";
import { Backdrop } from "./Backdrop.tsx";
import { Button } from "./Button.tsx";

type Props = {
  open: boolean;
  title: ReactNode;
  onClose(): void;
  /** 下に固定する操作 */
  footer?: ReactNode;
  children: ReactNode;
  /** 見出しの右に足すもの */
  headExtra?: ReactNode;
};

/** 下からせり上がるシート。背景を押すか「とじる」で閉じる */
export function Sheet({ open, title, onClose, footer, children, headExtra }: Props) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-layer">
      <Backdrop onClose={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="sheet__head">
          <h2 id={id} className="sheet__title">
            {title}
          </h2>
          {headExtra}
          <Button variant="primary" icon="close" onClick={onClose}>
            とじる
          </Button>
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}
