import type { ReactNode } from "react";

type Props = { title?: ReactNode; className?: string; children: ReactNode };

/** 枠と影のついた入れ物。title を渡すと上に黒地の見出しを付ける */
export function Panel({ title, className, children }: Props) {
  return (
    <section className={`panel ${className ?? ""}`}>
      {title && <h2 className="panel__title">{title}</h2>}
      {children}
    </section>
  );
}
