// 路線の一覧（新しい順に 100 件）と、非公開にする / 公開に戻す
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { confirmDialog } from "../ui/Dialog.tsx";
import { AdminApiError, type AdminApi, type AdminRoute } from "./api.ts";
import type { RunAction } from "./AdminConsole.tsx";
import { actionErrorText, formatTime, routePath } from "./format.ts";

type Props = {
  api: AdminApi;
  isBusy(key: string): boolean;
  action: RunAction;
  onUnauthorized(): void;
};

export function RoutesTab({ api, isBusy, action, onUnauthorized }: Props) {
  const [routes, setRoutes] = useState<AdminRoute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const list = await api.routes();
      if (my !== seq.current) return;
      setRoutes(list);
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof AdminApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      setError(actionErrorText(e, "load"));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [api, onUnauthorized]);

  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  const toggle = (r: AdminRoute) =>
    action(`route:${r.id}`, "hide", async () => {
      const name = `「${r.name ?? "（名前なし）"}」`;
      const ok = r.hidden
        ? await confirmDialog(`${name} を公開に戻しますか？ URL を知っている人が また見られるようになります。`, { ok: "公開に戻す" })
        : await confirmDialog(
            <>
              {name} を非公開にしますか？
              <br />
              路線ページが見られなくなり、この路線の待ちの印刷は取り消されます。
            </>,
            { ok: "非公開にする", danger: true },
          );
      if (!ok) return null;
      const res = await api.setHidden(r.id, !r.hidden);
      // 一覧はこのタブの中で持っているので、ここで読み直す
      void load();
      if (!res.hidden) return `${name} を公開に戻しました`;
      return res.canceled > 0 ? `${name} を非公開にし、待ちの印刷 ${res.canceled}件を取り消しました` : `${name} を非公開にしました`;
    });

  return (
    <>
      <div className="adm-toolbar">
        <p className="text-weak">新しい順（最大100件）</p>
        <Button disabled={loading} onClick={() => void load()}>
          {loading ? "読み込み中…" : "読み直す"}
        </Button>
      </div>
      {error && (
        <p className="adm-stale" role="alert">
          {error}
        </p>
      )}
      {routes === null && !error && <p className="adm-empty">読み込み中…</p>}
      {routes?.length === 0 && <p className="adm-empty">まだ路線はありません。</p>}
      {routes && routes.length > 0 && (
        <ol className="adm-list" aria-label="路線の一覧（新しい順）">
          {routes.map((r) => (
            <li key={r.id} className="adm-item" data-tone={r.hidden ? "off" : "ok"}>
              <div className="adm-item__head">
                <span className="adm-tag" data-tone={r.hidden ? "bad" : "ok"}>
                  {r.hidden ? "非公開" : "公開"}
                </span>
                <span className="adm-item__time">{formatTime(r.createdAt)} 作成</span>
              </div>
              <a className="adm-item__name" href={routePath(r.id)} target="_blank" rel="noopener noreferrer">
                {r.name ?? "（名前なし）"}
              </a>
              <div className="adm-item__actions adm-item__actions--start">
                <Button disabled={isBusy(`route:${r.id}`)} onClick={() => toggle(r)}>
                  {r.hidden ? "公開に戻す" : "非公開にする"}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
