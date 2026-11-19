// ログイン後の管理画面: 上部の状態表示、下部の切り替え（印刷 / 会場コード / 路線）。
import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "../ui/Dialog.tsx";
import { PixelIcon, type IconName } from "../ui/PixelIcon.tsx";
import { toast } from "../ui/Toast.tsx";
import { AdminApiError, tryLogout, type AdminApi, type AdminState } from "./api.ts";
import { EventCodeTab } from "./EventCodeTab.tsx";
import { actionErrorText, elapsedText, printerView } from "./format.ts";
import { useAdminState, useBusy, useNow } from "./hooks.ts";
import { JobsTab } from "./JobsTab.tsx";
import { RoutesTab } from "./RoutesTab.tsx";

type Tab = "jobs" | "event" | "routes";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "jobs", label: "印刷", icon: "list" },
  { id: "event", label: "会場コード", icon: "card" },
  { id: "routes", label: "路線", icon: "route" },
];

type Props = {
  api: AdminApi;
  initial: AdminState;
  initialOffset: number;
  onUnauthorized(): void;
  onLoggedOut(): void;
  /** 待ちの件数が変わったとき（見出し用） */
  onQueued(n: number): void;
};

export type ActionKind = Parameters<typeof actionErrorText>[1];

/** 操作の共通処理: 実行中の印、失敗のお知らせ、401 ならログインへ、終わったら状態を取り直す */
export type RunAction = (key: string, kind: ActionKind, fn: () => Promise<string | null>) => Promise<void>;

export function AdminConsole({ api, initial, initialOffset, onUnauthorized, onLoggedOut, onQueued }: Props) {
  const polled = useAdminState(api, initial, initialOffset, onUnauthorized);
  const { isBusy, run } = useBusy();
  const [tab, setTab] = useState<Tab>("jobs");
  const state = polled.state ?? initial;
  const queued = state.counts.queued;
  useEffect(() => onQueued(queued), [onQueued, queued]);

  const action: RunAction = useCallback(
    (key, kind, fn) =>
      run(key, async () => {
        polled.bump();
        try {
          const ok = await fn();
          if (ok) toast(ok);
        } catch (e) {
          if (e instanceof AdminApiError && e.status === 401) {
            onUnauthorized();
            return;
          }
          toast(actionErrorText(e, kind), { tone: "alert", ms: 4000 });
        }
        await polled.refresh();
      }),
    [run, polled, onUnauthorized],
  );

  const logout = () =>
    run("logout", async () => {
      if (!(await confirmDialog("この端末からログアウトしますか？", { ok: "ログアウト" }))) return;
      if (!(await tryLogout(api))) {
        // Cookie が消えたか分からないので、ログイン画面には戻さず、やり直せるようにする
        toast("ログアウトできていないかもしれません。電波を確かめて、もういちど押してください", { tone: "alert", ms: 5000 });
        return;
      }
      toast("ログアウトしました");
      onLoggedOut();
    });

  return (
    <div className="adm">
      <StatusBar
        state={state}
        clockOffset={polled.clockOffset}
        updatedAt={polled.updatedAt}
        failing={polled.failing}
        acceptingBusy={isBusy("accepting")}
        onAccepting={(next) =>
          action("accepting", "accepting", async () => {
            if (!next && !(await confirmDialog("印刷の受付を止めますか？ 待ちに入っている印刷はそのまま刷られます。", { ok: "止める", danger: true })))
              return null;
            await api.setAccepting(next);
            return next ? "受付を再開しました" : "受付を止めました";
          })
        }
      />
      <div className="adm__body app__scroll">
        {tab === "jobs" && <JobsTab jobs={state.jobs} isBusy={isBusy} action={action} api={api} />}
        {tab === "event" && (
          <EventCodeTab code={state.eventCode} isBusy={isBusy} action={action} api={api} onLogout={logout} logoutBusy={isBusy("logout")} />
        )}
        {tab === "routes" && <RoutesTab api={api} isBusy={isBusy} action={action} onUnauthorized={onUnauthorized} />}
      </div>
      <nav className="adm-tabs" aria-label="管理の切り替え">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="adm-tabs__btn"
            aria-current={t.id === tab ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            <PixelIcon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

type StatusProps = {
  state: AdminState;
  clockOffset: number;
  updatedAt: number | null;
  failing: boolean;
  acceptingBusy: boolean;
  onAccepting(next: boolean): void;
};

function StatusBar({ state, clockOffset, updatedAt, failing, acceptingBusy, onAccepting }: StatusProps) {
  const now = useNow();
  const printer = printerView(state.printer.lastSeenAt, now + clockOffset);
  const c = state.counts;
  return (
    <section className="adm-status" aria-label="いまの状態">
      <div className="adm-printer" data-online={printer.online} role="status">
        <span className="adm-printer__lamp" aria-hidden="true" />
        <div className="adm-printer__text">
          <p>
            プリンタ: <strong>{printer.label}</strong>
          </p>
          <p className="adm-printer__detail">{printer.detail}</p>
        </div>
      </div>

      <div className="adm-accept" role="group" aria-label="印刷の受付">
        <button
          type="button"
          className="adm-accept__btn"
          data-kind="on"
          aria-pressed={state.accepting}
          disabled={acceptingBusy}
          onClick={() => !state.accepting && onAccepting(true)}
        >
          受付中
        </button>
        <button
          type="button"
          className="adm-accept__btn"
          data-kind="off"
          aria-pressed={!state.accepting}
          disabled={acceptingBusy}
          onClick={() => state.accepting && onAccepting(false)}
        >
          停止中
        </button>
      </div>

      <dl className="adm-counts">
        <Count label="待ち" n={c.queued} tone="wait" />
        <Count label="印刷中" n={c.printing} tone="busy" />
        <Count label="完了" n={c.done} tone="ok" />
        <Count label="失敗" n={c.failed} tone="bad" />
      </dl>

      {failing && (
        <p className="adm-stale" role="alert">
          更新できません（{updatedAt ? `${elapsedText(now - updatedAt)}の表示` : "未取得"}）
        </p>
      )}
    </section>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className="adm-counts__item" data-tone={tone} data-zero={n === 0}>
      <dt>{label}</dt>
      <dd>{n}</dd>
    </div>
  );
}
