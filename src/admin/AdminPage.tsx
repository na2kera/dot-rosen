// 管理画面（/admin）。docs/spec.md「11. 管理画面」、docs/api.md「6. 管理 API」。
// ログイン状態は HttpOnly の Cookie（Path=/api/admin）なので画面からは見えない。開いたら GET /state を呼び、401 ならログイン画面にする。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Board } from "../ui/Board.tsx";
import { Button } from "../ui/Button.tsx";
import { DialogHost } from "../ui/Dialog.tsx";
import { Panel } from "../ui/Panel.tsx";
import { toast, ToastHost } from "../ui/Toast.tsx";
import { AdminApiError, createAdminApi, type AdminState } from "./api.ts";
import { AdminConsole } from "./AdminConsole.tsx";
import { LoginView } from "./LoginView.tsx";
import "./admin.css";

type Phase =
  | { name: "checking" }
  | { name: "offline" }
  | { name: "login" }
  | { name: "in"; state: AdminState; clockOffset: number; key: number };

export function AdminPage() {
  const api = useMemo(() => createAdminApi(), []);
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  /** 見出しに出す待ちの件数（問い合わせのたびに AdminConsole から受け取る） */
  const [queued, setQueued] = useState<number | null>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = "管理 | ドット路線メーカー";
    return () => {
      document.title = prev;
    };
  }, []);

  const enter = useCallback(async () => {
    setPhase({ name: "checking" });
    try {
      const { body, serverTime } = await api.state();
      setPhase({ name: "in", state: body, clockOffset: serverTime === null ? 0 : serverTime - Date.now(), key: Date.now() });
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 401) setPhase({ name: "login" });
      else setPhase({ name: "offline" });
    }
  }, [api]);

  useEffect(() => {
    void enter();
  }, [enter]);

  const onUnauthorized = useCallback(() => {
    toast("ログインが切れました。もう一度ログインしてください", { tone: "alert", ms: 4000 });
    setPhase({ name: "login" });
  }, []);

  return (
    <div className="app admin">
      <Board title="管理" sub={phase.name === "in" && queued !== null ? `待ち${queued}` : undefined} />
      <main className="app__main">
        {phase.name === "checking" && <Centered>確かめています…</Centered>}
        {phase.name === "offline" && (
          <Centered>
            <p>サーバーにつながりません。電波を確かめてください。</p>
            <Button variant="primary" onClick={() => void enter()}>
              もう一度ためす
            </Button>
          </Centered>
        )}
        {phase.name === "login" && <LoginView api={api} onLoggedIn={() => void enter()} />}
        {phase.name === "in" && (
          <AdminConsole
            key={phase.key}
            api={api}
            initial={phase.state}
            initialOffset={phase.clockOffset}
            onUnauthorized={onUnauthorized}
            onQueued={setQueued}
            onLoggedOut={() => setPhase({ name: "login" })}
          />
        )}
      </main>
      <DialogHost />
      <ToastHost />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="app__scroll">
      <Panel>
        <div className="notice">{children}</div>
      </Panel>
    </div>
  );
}
