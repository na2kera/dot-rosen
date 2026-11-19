// 駅の一覧のシート（並べ替え、削除、途中への追加、環状線、ぜんぶ消す）
import { MIN_LOOP_STATIONS, stationNumber } from "../../../shared/route/index.ts";
import { useApp, useDraft } from "../../app/AppContext.tsx";
import { Button } from "../../ui/Button.tsx";
import { StationBadge } from "../../ui/StationBadge.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { eki, type StationActions } from "./actions.ts";

type Props = { open: boolean; onClose(): void; actions: StationActions };

export function StationListSheet({ open, onClose, actions }: Props) {
  const { route, ui } = useApp();
  const draft = useDraft();
  const n = draft.stations.length;
  const canLoop = n >= MIN_LOOP_STATIONS;

  return (
    <Sheet
      open={open}
      title={`駅の一覧（${n}）`}
      onClose={onClose}
      footer={
        <>
          {canLoop && (
            <Button icon="loop" variant={draft.loop ? "primary" : "normal"} aria-pressed={draft.loop} onClick={() => route.setLoop(!draft.loop)}>
              {draft.loop ? "環状線をやめる" : "環状線にする"}
            </Button>
          )}
          <Button variant="danger" onClick={() => void actions.clearAll()} disabled={n === 0}>
            ぜんぶ消す
          </Button>
        </>
      }
    >
      {n === 0 ? (
        <p>まだ駅がありません。地図の駅をタップしてね。</p>
      ) : (
        <>
          <p className="text-weak list-legend">
            ↑↓ ならべかえ　＋ 次に追加　× 外す
          </p>
          <ol className="stlist">
            {draft.stations.map((id, i) => {
              const name = actions.nameOf(id);
              return (
                <li key={id} className="stlist__row">
                  <StationBadge number={stationNumber(draft.symbol, i)} color={draft.lineColor} />
                  <span className="stlist__name">{name}</span>
                  <span className="btn-group stlist__ops">
                    <Button icon="up" aria-label={`${eki(name)}を上へ`} disabled={i === 0} onClick={() => route.move(i, i - 1)} />
                    <Button icon="down" aria-label={`${eki(name)}を下へ`} disabled={i === n - 1} onClick={() => route.move(i, i + 1)} />
                    <Button icon="plus" aria-label={`${eki(name)}の次に追加`} onClick={() => ui.startInsertAfter(id)} />
                    <Button icon="close" aria-label={`${eki(name)}を外す`} onClick={() => void actions.confirmRemove(id)} />
                  </span>
                </li>
              );
            })}
            {draft.loop && (
              <li className="stlist__row stlist__row--loop">
                <span className="stlist__loop">→ {actions.nameOf(draft.stations[0])}にもどる（環状線）</span>
              </li>
            )}
          </ol>
        </>
      )}
    </Sheet>
  );
}
