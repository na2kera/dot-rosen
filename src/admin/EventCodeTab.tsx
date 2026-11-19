// 会場コード: QR コード、URL、コピー、画像で保存、作り直し。ログアウトもここに置く。
import { useMemo, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { confirmDialog } from "../ui/Dialog.tsx";
import { Panel } from "../ui/Panel.tsx";
import { toast } from "../ui/Toast.tsx";
import type { AdminApi } from "./api.ts";
import type { RunAction } from "./AdminConsole.tsx";
import { eventUrl } from "./format.ts";
import { QUIET, qrMatrix, qrPath } from "./qr.ts";
import { downloadBlob, qrPng } from "./qr-png.ts";

type Props = {
  code: string;
  api: AdminApi;
  isBusy(key: string): boolean;
  action: RunAction;
  onLogout(): void;
  logoutBusy: boolean;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 使えないブラウザ向け: 隠した入力欄を選んでコピー
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function EventCodeTab({ code, api, isBusy, action, onLogout, logoutBusy }: Props) {
  const [saving, setSaving] = useState(false);
  const url = eventUrl(window.location.origin, code);
  const qr = useMemo(() => {
    const m = qrMatrix(url);
    return { side: m.size + QUIET * 2, d: qrPath(m) };
  }, [url]);

  return (
    <>
      <Panel title="会場コード">
        <div className="adm-event">
          <p className="text-weak">この QR コードから開いた人だけが印刷できます。別の端末に映すか、紙に印刷して貼ってください。</p>
          <svg
            className="adm-qr"
            viewBox={`0 0 ${qr.side} ${qr.side}`}
            shapeRendering="crispEdges"
            role="img"
            aria-label={`会場の QR コード（${url}）`}
          >
            <rect width={qr.side} height={qr.side} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
          <p className="adm-event__url" data-testid="event-url">
            {url}
          </p>
          <div className="adm-event__btns">
            <Button onClick={() => void copyText(url).then((ok) => (ok ? toast("URL をコピーしました") : toast("コピーできませんでした。長押しで選んでください", { tone: "alert" })))}>
              URL をコピー
            </Button>
            <Button
              icon="down"
              disabled={saving}
              onClick={async () => {
                if (saving) return;
                setSaving(true);
                try {
                  await document.fonts?.load(`32px "DotGothic16"`).catch(() => undefined);
                  downloadBlob(await qrPng(url, "ドット路線メーカー 会場コード"), `dot-rosen-qr-${code}.png`);
                  toast("QR コードの画像を保存しました");
                } catch {
                  toast("画像を作れませんでした", { tone: "alert" });
                } finally {
                  setSaving(false);
                }
              }}
            >
              QR コードを画像で保存
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="作り直す">
        <div className="adm-event">
          <p>
            作り直すと、<strong className="text-alert">今の QR コードは使えなくなります。</strong>
            貼ってある紙や映している画面も差し替えてください。端末ごとの印刷の回数も数え直しになります。
          </p>
          <Button
            variant="danger"
            block
            disabled={isBusy("regenerate")}
            onClick={() =>
              action("regenerate", "regenerate", async () => {
                const ok = await confirmDialog(
                  <>
                    会場コードを作り直しますか？
                    <br />
                    <strong className="text-alert">今の QR コードは使えなくなります。</strong>
                  </>,
                  { ok: "作り直す", danger: true },
                );
                if (!ok) return null;
                await api.regenerateEventCode();
                return "会場コードを作り直しました。新しい QR コードを掲示してください";
              })
            }
          >
            会場コードを作り直す
          </Button>
        </div>
      </Panel>

      <Panel title="この端末">
        <div className="adm-event">
          <p className="text-weak">ログインは 12時間 続きます。</p>
          <Button block disabled={logoutBusy} onClick={onLogout}>
            ログアウト
          </Button>
        </div>
      </Panel>
    </>
  );
}
