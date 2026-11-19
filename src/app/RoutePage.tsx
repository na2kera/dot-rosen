// 路線のページ（/r/:id）。見るだけ。この端末が編集の鍵を持っていれば「編集する」「この路線を消す」も出す。
import { useCallback, useEffect, useState } from "react";
import { parseStations, STATIONS_PATH, type StationsFile } from "../../shared/geo/map-data.ts";
import { parseRouteData, type RouteData } from "../../shared/route/index.ts";
import { errorMessage, type ApiFailure } from "../api/client.ts";
import { CardView } from "../card/CardView.tsx";
import { ImageSaver } from "../card/ImageSaver.tsx";
import { useBitmapFont, useCard } from "../card/useCard.ts";
import { buildStationIndex, type StationIndex } from "../data/station-index.ts";
import { navigate } from "../router.ts";
import { browserStorage } from "../store/browser.ts";
import { localMonthDay } from "../store/dates.ts";
import { safeGet, safeSet, STORAGE_KEYS } from "../store/kv-storage.ts";
import { restoreDraft, serializeDraft } from "../store/route-store.ts";
import { useStore } from "../store/use-store.ts";
import { Board } from "../ui/Board.tsx";
import { Button } from "../ui/Button.tsx";
import { confirmDialog, DialogHost } from "../ui/Dialog.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Panel } from "../ui/Panel.tsx";
import { toast, ToastHost } from "../ui/Toast.tsx";
import { getApi, getPublish, setInitialStep } from "./services.ts";

let indexPromise: Promise<StationIndex> | null = null;

function loadIndex(): Promise<StationIndex> {
  indexPromise ??= fetch(STATIONS_PATH)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<StationsFile>;
    })
    .then((f) => buildStationIndex(parseStations(f)))
    .catch((e: unknown) => {
      indexPromise = null;
      throw e;
    });
  return indexPromise;
}

type Loaded = { index: StationIndex; data: RouteData; expiresAt: string };
type State = { kind: "loading" } | { kind: "ok"; v: Loaded } | { kind: "error"; fail: ApiFailure | null } | { kind: "deleted" };

export function RoutePage({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    Promise.all([loadIndex(), getApi().getRoute(id)]).then(
      ([index, r]) => {
        if (!alive) return;
        if (!r.ok) return setState({ kind: "error", fail: r });
        const parsed = parseRouteData(r.value.data, index.lookup);
        if (!parsed.ok) return setState({ kind: "error", fail: { ok: false, code: "invalid", status: 200, reason: parsed.error } });
        setState({ kind: "ok", v: { index, data: parsed.value, expiresAt: r.value.expiresAt } });
      },
      () => alive && setState({ kind: "error", fail: null }),
    );
    return () => {
      alive = false;
    };
  }, [id, tick]);

  const title = state.kind === "ok" ? state.v.data.name : "路線のページ";
  return (
    <div className="app app--page">
      <Board title={title} sub={state.kind === "ok" ? state.v.data.symbol : undefined} />
      <main className="app__main">
        {state.kind === "loading" && <Loading progress={0.5} />}
        {state.kind === "error" && <RouteError fail={state.fail} onRetry={() => setTick((t) => t + 1)} />}
        {state.kind === "deleted" && (
          <Message heading="消しました">
            <p>この路線を消しました。この URL は もう開けません。</p>
          </Message>
        )}
        {state.kind === "ok" && <RouteView id={id} v={state.v} onDeleted={() => setState({ kind: "deleted" })} />}
      </main>
      <div />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

function Message({ heading, children, onRetry }: { heading: string; children: React.ReactNode; onRetry?(): void }) {
  return (
    <div className="app__scroll">
      <Panel title={heading}>
        <div className="notice">
          {children}
          {onRetry && <Button onClick={onRetry}>もういちど よみこむ</Button>}
          <Button variant="primary" onClick={() => navigate("/")}>
            自分も作ってみる
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function RouteError({ fail, onRetry }: { fail: ApiFailure | null; onRetry(): void }) {
  if (fail?.code === "not_found")
    return (
      <Message heading="見つかりません">
        <p>この路線は見つかりませんでした。URL がまちがっているか、消された路線です。</p>
      </Message>
    );
  if (fail?.code === "expired")
    return (
      <Message heading="期限切れ">
        <p>この路線は 見られる期限が過ぎました。</p>
      </Message>
    );
  return (
    <Message heading="よみこめません" onRetry={onRetry}>
      <p>{fail ? errorMessage(fail) : "よみこめませんでした。電波のよい所で もういちど ためしてね"}</p>
    </Message>
  );
}

function RouteView({ id, v, onDeleted }: { id: string; v: Loaded; onDeleted(): void }) {
  const publish = getPublish();
  const pub = useStore(publish.store);
  const owner = pub.saved?.id === id;
  const { font, error: fontError, retry } = useBitmapFont();
  const card = useCard(v.data, v.index.lookup, font, { routeId: id, expiresAt: v.expiresAt });
  const [busy, setBusy] = useState(false);
  const day = localMonthDay(v.expiresAt);

  const edit = useCallback(async () => {
    const storage = browserStorage();
    const current = restoreDraft(safeGet(storage, STORAGE_KEYS.draft), v.index.lookup);
    const same = JSON.stringify(current) === JSON.stringify(v.data);
    if (current.stations.length > 0 && !same) {
      const ok = await confirmDialog("いま作りかけの路線を、この路線で置きかえますか？", { ok: "置きかえる" });
      if (!ok) return;
    }
    safeSet(storage, STORAGE_KEYS.draft, serializeDraft(v.data));
    publish.markSaved(id, v.data, v.expiresAt);
    setInitialStep(4);
    navigate("/");
  }, [id, v, publish]);

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
      onDeleted();
    } else toast(errorMessage(r), { tone: "alert" });
  };

  return (
    <div className="app__scroll route-page">
      {day && (
        <p className="expiry route-page__expiry">
          <strong>{day}</strong>まで見られます。画像は早めに保存してね
        </p>
      )}
      <div className="route-page__card">
        {fontError ? (
          <div className="notice">
            <p>文字のデータを よみこめませんでした</p>
            <Button onClick={retry}>もういちど よみこむ</Button>
          </div>
        ) : (
          <CardView card={card} className="cardview--page" />
        )}
      </div>
      <div className="route-page__actions">
        <ImageSaver card={card && !("error" in card) ? card.color : null} routeName={v.data.name} />
        {owner && (
          <Button variant="primary" block onClick={edit}>
            編集する
          </Button>
        )}
        <Button block onClick={() => navigate("/")}>
          自分も作ってみる
        </Button>
        {owner && (
          <Button variant="danger" block icon="trash" onClick={remove} disabled={busy}>
            この路線を消す
          </Button>
        )}
      </div>
    </div>
  );
}
