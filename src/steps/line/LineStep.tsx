// ステップ2「路線をきめる」
import { MAX_NAME_LENGTH, stationNumber } from "../../../shared/route/index.ts";
import { COLOR_LABELS } from "../../../shared/train/colors.ts";
import { useApp, useDraft } from "../../app/AppContext.tsx";
import { nameRemaining } from "../../store/route-ops.ts";
import { ColorPicker } from "../../ui/ColorPicker.tsx";
import { Panel } from "../../ui/Panel.tsx";
import { StationBadge } from "../../ui/StationBadge.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { StationSign } from "./StationSign.tsx";

export function LineStep() {
  const { route, data } = useApp();
  const draft = useDraft();
  const left = nameRemaining(draft.name);
  const nameOf = (id: string) => data.index.byId.get(id)?.name ?? "?";

  return (
    <div className="app__scroll line-step">
      <Panel title="みほん">
        <StationSign
          lineName={draft.name}
          symbol={draft.symbol}
          color={draft.lineColor}
          station={draft.stations[0] ? nameOf(draft.stations[0]) : null}
          next={draft.stations[1] ? nameOf(draft.stations[1]) : null}
        />
      </Panel>

      <Panel title="路線名">
        <TextField
          label="路線の名前"
          value={draft.name}
          onValue={route.setName}
          maxLength={MAX_NAME_LENGTH * 2}
          placeholder="例: ほしぞら線"
          aside={
            <span className="field__count" data-low={left <= 2}>
              あと{left}文字
            </span>
          }
          note="実在の会社のロゴや名称をそのまま使わないでください"
        />
        {draft.name.trim() === "" && <p className="text-alert">路線の名前を入れてね</p>}
      </Panel>

      <Panel title="ラインカラー">
        <ColorPicker label="ラインカラー" value={draft.lineColor} onChange={route.setLineColor} />
        <p className="line-step__color-name">えらんだ色: {COLOR_LABELS[draft.lineColor]}</p>
      </Panel>

      <Panel title="路線記号">
        <TextField
          label="英字1〜2文字"
          value={draft.symbol}
          onValue={route.setSymbol}
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          placeholder="例: HS"
          className="field__input field__input--symbol"
          aside={<span className="text-weak">駅ナンバリングに使います</span>}
        />
        {draft.symbol === "" && <p className="text-alert">英字を1文字以上入れてね</p>}
      </Panel>

      <Panel title={`停車駅（${draft.stations.length}）`}>
        {draft.stations.length === 0 ? (
          <p>まだ駅がありません。「1 駅」で駅をえらんでね。</p>
        ) : (
          <ol className="stlist stlist--readonly">
            {draft.stations.map((id, i) => (
              <li key={id} className="stlist__row">
                <StationBadge number={stationNumber(draft.symbol, i)} color={draft.lineColor} />
                <span className="stlist__name">{nameOf(id)}</span>
              </li>
            ))}
            {draft.loop && draft.stations.length > 0 && (
              <li className="stlist__row stlist__row--loop">
                <span className="stlist__loop">→ {nameOf(draft.stations[0])}にもどる（環状線）</span>
              </li>
            )}
          </ol>
        )}
      </Panel>
    </div>
  );
}
