// 「この路線を消す」（作った端末だけ）。路線ページと「できあがり」で同じものを使う。
// 確認を出してから消す。消すと URL は開けなくなり、待ちの印刷は取り消され、端末の保存と印刷の記録も消える（作りかけは残る）。
import { useState } from "react";
import { errorMessage } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { confirmDialog } from "../ui/Dialog.tsx";
import { toast } from "../ui/Toast.tsx";
import { getPublish } from "./services.ts";

export function DeleteRouteButton({ id, block, className, onDeleted }: { id: string; block?: boolean; className?: string; onDeleted?(): void }) {
  const publish = getPublish();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const ok = await confirmDialog(
      <>
        <p>この路線を消しますか？</p>
        <p className="text-weak">URL は開けなくなり、もとには戻せません。印刷待ちの申し込みも取り消されます。</p>
      </>,
      { ok: "消す", danger: true },
    );
    if (!ok) return;
    setBusy(true);
    const r = await publish.deleteRoute(id);
    setBusy(false);
    if (r.ok) {
      toast("路線を消しました");
      onDeleted?.();
    } else toast(errorMessage(r), { tone: "alert" });
  };

  return (
    <Button variant="danger" block={block} icon="trash" className={className} onClick={remove} disabled={busy}>
      この路線を消す
    </Button>
  );
}
