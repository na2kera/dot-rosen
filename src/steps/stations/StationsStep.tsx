// ステップ1「駅をえらぶ」
import { useEffect, useMemo, useRef, useState } from "react";
import { stationNumber } from "../../../shared/route/index.ts";
import { useApp, useCanUndo, useDraft, useUi } from "../../app/AppContext.tsx";
import type { MapEngine, MapRoute } from "../../map/engine.ts";
import { MapView } from "../../map/MapView.tsx";
import { isHintSeen, markHintSeen } from "../../store/device.ts";
import { Button } from "../../ui/Button.tsx";
import { colorHex, inkOn } from "../../ui/color.ts";
import { createStationActions, eki } from "./actions.ts";
import { FocusCard } from "./FocusCard.tsx";
import { InfoSheet } from "./InfoSheet.tsx";
import { SearchSheet } from "./SearchSheet.tsx";
import { StationListSheet } from "./StationListSheet.tsx";

export function StationsStep() {
  const app = useApp();
  const { data, ui, storage } = app;
  const draft = useDraft();
  const canUndo = useCanUndo();
  const { insertAfterId, focusId, sheet } = useUi();
  const engine = useRef<MapEngine | null>(null);
  const actions = useMemo(() => createStationActions(app, engine), [app]);
  const [hint, setHint] = useState(() => !isHintSeen(storage) && draft.stations.length === 0);

  const mapRoute = useMemo<MapRoute>(
    () => ({
      ids: draft.stations,
      loop: draft.loop,
      color: colorHex(draft.lineColor),
      numbers: draft.stations.map((_, i) => stationNumber(draft.symbol, i)),
      numberInk: inkOn(draft.lineColor),
    }),
    [draft.stations, draft.loop, draft.lineColor, draft.symbol],
  );

  // 「この駅の次に追加」を選んだら、その駅を見せる
  useEffect(() => {
    if (insertAfterId) engine.current?.flyTo(insertAfterId, 2500);
  }, [insertAfterId]);

  const closeHint = () => {
    setHint(false);
    markHintSeen(storage);
  };

  return (
    <div className="stations">
      <MapView
        world={data.world}
        stations={data.stationsFile.stations}
        route={mapRoute}
        focusId={focusId}
        anchorId={insertAfterId}
        engineRef={engine}
        label="首都圏の駅の地図。駅をタップすると路線に加わります"
        onStationTap={(id) => {
          if (hint) closeHint();
          void actions.tap(id);
        }}
      />

      <div className="map-tools map-tools--top">
        <Button icon="search" onClick={() => ui.openSheet("search")}>
          さがす
        </Button>
        <Button icon="undo" onClick={actions.undo} disabled={!canUndo}>
          1つ戻す
        </Button>
        <span className="map-tools__spacer" />
        <Button icon="info" aria-label="出典とつかいかた" onClick={() => ui.openSheet("info")} />
      </div>

      {insertAfterId && (
        <div className="map-banner" role="status">
          <p>
            <span className="map-banner__em">{eki(actions.nameOf(insertAfterId))}</span>の次に追加する駅をタップ
          </p>
          <Button onClick={ui.cancelInsert}>やめる</Button>
        </div>
      )}

      <div className="map-tools map-tools--bottom">
        {focusId ? (
          <FocusCard id={focusId} actions={actions} />
        ) : hint ? (
          <div className="panel map-hint" role="status">
            <p>駅をタップして 線をつなごう</p>
            <Button variant="primary" onClick={closeHint}>
              OK
            </Button>
          </div>
        ) : (
          <Button variant="primary" icon="list" onClick={() => ui.openSheet("list")}>
            駅の一覧（{draft.stations.length}）
          </Button>
        )}
      </div>

      <SearchSheet
        open={sheet === "search"}
        onClose={() => ui.openSheet(null)}
        onPick={(id) => {
          ui.openSheet(null);
          ui.setFocus(id);
          engine.current?.flyTo(id);
        }}
      />
      <StationListSheet open={sheet === "list"} onClose={() => ui.openSheet(null)} actions={actions} />
      <InfoSheet open={sheet === "info"} onClose={() => ui.openSheet(null)} />
    </div>
  );
}
