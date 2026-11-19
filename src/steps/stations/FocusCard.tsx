// 検索で選んだ駅の案内（地図の下に出す）
import { useApp, useDraft, useUi } from "../../app/AppContext.tsx";
import { stationDetail } from "../../data/station-index.ts";
import { Button } from "../../ui/Button.tsx";
import { eki, type StationActions } from "./actions.ts";

export function FocusCard({ id, actions }: { id: string; actions: StationActions }) {
  const { data, ui } = useApp();
  const draft = useDraft();
  const { insertAfterId } = useUi();
  const st = data.index.byId.get(id);
  if (!st) return null;
  const inRoute = draft.stations.includes(id);
  return (
    <div className="panel focus-card">
      <div className="focus-card__text">
        <p>{eki(st.name)}</p>
        <p className="text-weak focus-card__detail">{inRoute ? "路線に入っています" : stationDetail(data.index, st)}</p>
      </div>
      <div className="focus-card__actions">
        <Button icon="close" aria-label="とじる" onClick={() => ui.setFocus(null)} />
        {inRoute ? (
          <Button onClick={() => void actions.confirmRemove(id)}>路線から外す</Button>
        ) : (
          <Button variant="primary" icon="plus" onClick={() => actions.add(id)}>
            {insertAfterId ? "ここに追加" : "路線に追加"}
          </Button>
        )}
      </div>
    </div>
  );
}
