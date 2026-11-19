import type { ReactNode } from "react";

/** 画面上部の発車案内板風の見出し。左にステップ名、右に補足（緑） */
export function Board({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <header className="board">
      <h1 className="board__title">{title}</h1>
      {sub !== undefined && sub !== null && <p className="board__sub">{sub}</p>}
    </header>
  );
}
