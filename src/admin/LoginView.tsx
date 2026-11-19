// ログイン画面
import { useState } from "react";
import { Panel } from "../ui/Panel.tsx";
import { TextField } from "../ui/TextField.tsx";
import type { AdminApi } from "./api.ts";
import { loginErrorText } from "./format.ts";

export function LoginView({ api, onLoggedIn }: { api: AdminApi; onLoggedIn(): void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!password) {
      setError("パスワードを入れてください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword("");
      onLoggedIn();
    } catch (e) {
      setError(loginErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app__scroll">
      <Panel title="管理画面にログイン">
        <form
          className="adm-login"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField
            label="パスワード"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onValue={(v) => {
              setPassword(v);
              setError(null);
            }}
          />
          {error && (
            <p className="adm-login__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? "確かめています…" : "ログイン"}
          </button>
          <p className="text-weak">ログインは この端末で 12時間 続きます。</p>
        </form>
      </Panel>
    </div>
  );
}
