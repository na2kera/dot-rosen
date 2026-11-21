import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Backdrop } from "./Backdrop.tsx";
import { Button } from "./Button.tsx";
import { pushEscape } from "./escape.ts";

type Props = {
  open: boolean;
  title: ReactNode;
  onClose(): void;
  /** 下に固定する操作 */
  footer?: ReactNode;
  children: ReactNode;
  /** 見出しの右に足すもの */
  headExtra?: ReactNode;
  /** 見出しの「とじる」を出すか（既定 true）。false のときは footer の操作で閉じる */
  closeButton?: boolean;
  className?: string;
};

/**
 * 下からせり上がるシート。背景を押すか「とじる」（または Esc）で閉じる。
 * 画面全体（見出しと下のステップの切り替えを含む .app）の上に出し、開いている間は後ろを操作できなくする。
 */
export function Sheet(props: Props) {
  if (!props.open) return null;
  // 出し先（画面全体）。1 つのページに .app は 1 つ。見つからなければ、その場に出す
  // （中身の部品が開いた直後から寸法を測れるよう、最初の描画から出し先に出す）
  const host = document.querySelector<HTMLElement>(".app");
  return host ? createPortal(<SheetLayer {...props} host={host} />, host) : <SheetLayer {...props} host={null} />;
}

function SheetLayer({ title, onClose, footer, children, headExtra, closeButton = true, className, host }: Props & { host: HTMLElement | null }) {
  const id = useId();
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Esc は手前のものだけ（確認ダイアログが出ている間は、ダイアログが受け取る）
  useEffect(() => pushEscape(() => closeRef.current()), []);

  // 後ろを操作できなくし（inert）、シートの中へフォーカスを移す。閉じたら元に戻す
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const blocked: HTMLElement[] = [];
    if (host) {
      for (const el of Array.from(host.children) as HTMLElement[]) {
        if (el === layer.current || el.inert || el.matches(".dialog-layer, .toasts")) continue;
        el.inert = true;
        blocked.push(el);
      }
    }
    panel.current?.focus({ preventScroll: true });
    return () => {
      for (const el of blocked) el.inert = false;
      prev?.focus?.({ preventScroll: true });
    };
  }, [host]);

  return (
    <div className="sheet-layer" ref={layer}>
      <Backdrop onClose={onClose} />
      <div ref={panel} className={`sheet ${className ?? ""}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="sheet__head">
          <h2 id={id} className="sheet__title">
            {title}
          </h2>
          {headExtra}
          {closeButton && (
            <Button variant="primary" icon="close" onClick={onClose}>
              とじる
            </Button>
          )}
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}
