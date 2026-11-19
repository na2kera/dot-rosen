// 印刷の一覧（新しい順に 100 件。サーバーの並びのまま）
import { Button } from "../ui/Button.tsx";
import { confirmDialog } from "../ui/Dialog.tsx";
import type { AdminApi, AdminJob } from "./api.ts";
import type { RunAction } from "./AdminConsole.tsx";
import { formatTime, issueText, jobActions, jobView, routePath } from "./format.ts";

type Props = {
  jobs: AdminJob[];
  api: AdminApi;
  isBusy(key: string): boolean;
  action: RunAction;
};

export function JobsTab({ jobs, api, isBusy, action }: Props) {
  if (jobs.length === 0) return <p className="adm-empty">まだ印刷の申し込みはありません。</p>;
  return (
    <ol className="adm-list" aria-label="印刷の一覧（新しい順）">
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} api={api} isBusy={isBusy} action={action} />
      ))}
    </ol>
  );
}

function JobRow({ job, api, isBusy, action }: { job: AdminJob } & Omit<Props, "jobs">) {
  const view = jobView(job);
  const acts = jobActions(job.status);
  const name = job.routeName ?? "（名前なし）";
  const label = `${issueText(job.issueNo)}「${name}」`;
  const k = (what: string) => `job:${job.id}:${what}`;
  // 同じ行の操作は1つずつ
  const rowBusy = isBusy(k("cancel")) || isBusy(k("reprint")) || isBusy(k("grant"));

  return (
    <li className="adm-item" data-tone={view.tone}>
      <div className="adm-item__head">
        <span className="adm-item__no">{issueText(job.issueNo)}</span>
        <span className="adm-tag" data-tone={view.tone}>
          {view.label}
        </span>
        {job.reprintOf !== null && <span className="adm-tag adm-tag--plain">再印刷</span>}
        <span className="adm-item__time">{formatTime(job.createdAt)}</span>
      </div>
      <a className="adm-item__name" href={routePath(job.routeId)} target="_blank" rel="noopener noreferrer">
        {name}
      </a>
      {view.note && <p className="adm-item__note">{view.note}</p>}
      <div className="adm-item__actions">
        {acts.cancel && (
          <Button
            variant="danger"
            disabled={rowBusy}
            onClick={() =>
              action(k("cancel"), "cancel", async () => {
                if (!(await confirmDialog(`${label} の印刷を取り消しますか？`, { ok: "取り消す", cancel: "やめる", danger: true }))) return null;
                await api.cancel(job.id);
                return `${issueText(job.issueNo)} を取り消しました`;
              })
            }
          >
            取り消し
          </Button>
        )}
        {acts.reprint && (
          <Button
            variant="primary"
            disabled={rowBusy}
            onClick={() =>
              action(k("reprint"), "reprint", async () => {
                if (!(await confirmDialog(<>{label} を もう一度 印刷しますか？<br />待ちの先頭に入ります。</>, { ok: "再印刷する" }))) return null;
                await api.reprint(job.id);
                return `${issueText(job.issueNo)} を待ちの先頭に入れました`;
              })
            }
          >
            再印刷
          </Button>
        )}
        <Button
          disabled={rowBusy}
          onClick={() =>
            action(k("grant"), "grant", async () => {
              if (
                !(await confirmDialog(
                  <>
                    {label} を申し込んだ端末に、印刷を もう1回 許可しますか？
                    <br />
                    <span className="text-weak">今の会場コードでの回数が1回増えます。</span>
                  </>,
                  { ok: "許可する" },
                ))
              )
                return null;
              const r = await api.grant(job.clientId);
              return `許可しました（この端末の追加 ${r.extra}回）`;
            })
          }
        >
          この端末にもう1回許可
        </Button>
      </div>
    </li>
  );
}
