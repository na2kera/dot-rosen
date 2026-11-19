// 「準備中」などの、見出しと案内だけの画面
import type { ReactNode } from "react";
import { navigate } from "../router.ts";
import { Board } from "../ui/Board.tsx";
import { Button } from "../ui/Button.tsx";
import { Panel } from "../ui/Panel.tsx";

export function SimplePage({ title, heading, children }: { title: string; heading: string; children: ReactNode }) {
  return (
    <div className="app">
      <Board title={title} />
      <main className="app__main">
        <div className="app__scroll">
          <Panel title={heading}>
            <div className="notice">
              {children}
              <Button variant="primary" onClick={() => navigate("/")}>
                路線を作る
              </Button>
            </div>
          </Panel>
        </div>
      </main>
      <div />
    </div>
  );
}
