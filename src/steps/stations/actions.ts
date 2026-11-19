// 駅をえらぶ画面の操作（地図のタップ、検索からの追加、一覧の操作で共通）。
import { MIN_LOOP_STATIONS } from "../../../shared/route/index.ts";
import type { AppContextValue } from "../../app/AppContext.tsx";
import type { MapEngine } from "../../map/engine.ts";
import { markHintSeen } from "../../store/device.ts";
import { ask, confirmDialog } from "../../ui/Dialog.tsx";
import { toast } from "../../ui/Toast.tsx";

/** 「東京駅」のように駅を付ける（もともと「駅」で終わる名前には付けない） */
export function eki(name: string): string {
  return name.endsWith("駅") ? name : `${name}駅`;
}

export const FULL_MESSAGE = "駅は30駅までです。ほかの駅を外すと、また追加できます";

export function createStationActions(app: AppContextValue, engine: { current: MapEngine | null }) {
  const { route, ui, data, storage } = app;
  const nameOf = (id: string) => data.index.byId.get(id)?.name ?? "?";

  const added = (id: string) => {
    engine.current?.pulseStation(id);
    markHintSeen(storage);
    if (ui.store.get().focusId === id) ui.setFocus(null);
  };

  /** 駅を加える（「この駅の次に追加」のときはその位置に） */
  function add(id: string): void {
    const d = route.getDraft();
    const after = ui.store.get().insertAfterId;
    if (d.stations.includes(id)) {
      toast(`${eki(nameOf(id))}は もう路線に入っています`);
      return;
    }
    if (after) {
      const at = d.stations.indexOf(after);
      const r = at >= 0 ? route.insertAfter(at, id) : route.addStation(id);
      if (!r.ok) {
        toast(r.reason === "full" ? FULL_MESSAGE : "追加できませんでした", { tone: "alert" });
        return;
      }
      ui.cancelInsert();
      toast(`${eki(nameOf(after))}の次に ${eki(nameOf(id))}を入れました`);
      added(id);
      return;
    }
    const r = route.addStation(id);
    if (!r.ok) {
      toast(r.reason === "full" ? FULL_MESSAGE : "追加できませんでした", { tone: "alert" });
      return;
    }
    added(id);
  }

  async function confirmRemove(id: string): Promise<void> {
    const ok = await confirmDialog(`${eki(nameOf(id))}を路線から外しますか？`, { ok: "外す", danger: true });
    if (ok) route.removeStation(id);
  }

  /** 地図で駅をタップしたとき */
  async function tap(id: string): Promise<void> {
    const d = route.getDraft();
    const pos = d.stations.indexOf(id);
    if (pos < 0 || ui.store.get().insertAfterId) {
      add(id);
      return;
    }
    if (pos === 0 && d.stations.length >= MIN_LOOP_STATIONS) {
      type Choice = "loop" | "remove" | "cancel";
      const choice = await ask<Choice>({
        message: d.loop ? `${eki(nameOf(id))}は始発駅です。環状線をやめますか？` : `${eki(nameOf(id))}は始発駅です。線を始発駅までつないで、環状線にしますか？`,
        cancelValue: "cancel",
        actions: [
          { value: "loop", label: d.loop ? "環状線をやめる" : "環状線にする", tone: "primary" },
          { value: "remove", label: "路線から外す", tone: "danger" },
          { value: "cancel", label: "やめる" },
        ],
      });
      if (choice === "loop") {
        route.setLoop(!d.loop);
        if (!d.loop) engine.current?.pulseStation(id);
      } else if (choice === "remove") route.removeStation(id);
      return;
    }
    await confirmRemove(id);
  }

  async function clearAll(): Promise<void> {
    const ok = await confirmDialog("駅をぜんぶ消しますか？", { ok: "ぜんぶ消す", danger: true });
    if (ok) route.clearStations();
  }

  function undo(): void {
    if (!route.undo()) toast("もどせる操作がありません");
  }

  return { add, tap, confirmRemove, clearAll, undo, nameOf };
}

export type StationActions = ReturnType<typeof createStationActions>;
