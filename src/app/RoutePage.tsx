// 路線のページ（/r/:id）。見るだけ。この端末が編集の鍵を持っていれば「編集する」「X で共有」「この路線を消す」も出す。
import { useCallback, useEffect, useState } from "react";
import { parseStations, STATIONS_PATH, type StationsFile } from "../../shared/geo/map-data.ts";
import { parseRouteData, type RouteData } from "../../shared/route/index.ts";
import { errorMessage, type ApiFailure } from "../api/client.ts";
import { CardView } from "../card/CardView.tsx";
import { ImageSaver } from "../card/ImageSaver.tsx";
import { useBitmapFont, useCard, useServerCardLook } from "../card/useCard.ts";
import { buildStationIndex, type StationIndex } from "../data/station-index.ts";
import { navigate } from "../router.ts";
import { xShareHref } from "../share/x-share.ts";
import { XShareButton } from "../share/XShareButton.tsx";
import { browserStorage } from "../store/browser.ts";
import { safeGet, STORAGE_KEYS } from "../store/kv-storage.ts";
import { restoreDraft, writeDraft } from "../store/route-store.ts";
import { useStore } from "../store/use-store.ts";
import { Board } from "../ui/Board.tsx";
import { Button } from "../ui/Button.tsx";
import { confirmDialog, DialogHost } from "../ui/Dialog.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Panel } from "../ui/Panel.tsx";
import { toast, ToastHost } from "../ui/Toast.tsx";
import { DeleteRouteButton } from "./DeleteRouteButton.tsx";
import { getApi, getConfig, getPublish, setInitialStep } from "./services.ts";

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

/** rev は、data と同じ応答の版の印（無い・形が違えば null） */
type Loaded = { index: StationIndex; data: RouteData; rev: string | null };
type State = { kind: "loading" } | { kind: "ok"; v: Loaded } | { kind: "error"; fail: ApiFailure | null } | { kind: "deleted" };

export function RoutePage({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    // サーバーの設定（印刷プレビューの見た目）も同時に取る。失敗しても既定値で進む（reject しない）
    Promise.all([loadIndex(), getApi().getRoute(id), getConfig().load()]).then(
      ([index, r]) => {
        if (!alive) return;
        if (!r.ok) return setState({ kind: "error", fail: r });
        const parsed = parseRouteData(r.value.data, index.lookup);
        if (!parsed.ok) return setState({ kind: "error", fail: { ok: false, code: "invalid", status: 200, reason: parsed.error } });
        setState({ kind: "ok", v: { index, data: parsed.value, rev: typeof r.value.rev === "string" ? r.value.rev : null } });
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
            オリジナル路線を作る
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
  const look = useServerCardLook();
  const card = useCard(v.data, v.index.lookup, font, { routeId: id, look });

  const edit = useCallback(async () => {
    const storage = browserStorage();
    const current = restoreDraft(safeGet(storage, STORAGE_KEYS.draft), v.index.lookup);
    const same = JSON.stringify(current) === JSON.stringify(v.data);
    if (current.stations.length > 0 && !same) {
      const ok = await confirmDialog("いま作りかけの路線を、この路線で置きかえますか？", { ok: "置きかえる" });
      if (!ok) return;
    }
    // 端末に書けてから移る（書けないまま移ると、作る画面で前の作りかけが出てしまう）。
    // 読んだときの rev が端末の保存記録と同じときだけ保存ずみとして引き継ぐ（違えば結果不明。印刷の食い違いは stale で拾う）
    if (!publish.markSaved(id, v.data, v.rev) || !writeDraft(storage, v.data)) {
      toast("この端末に保存できないため、編集を始められません（プライベートモードや空き容量を確かめてね）", { tone: "alert", ms: 5000 });
      return;
    }
    setInitialStep(4);
    navigate("/");
  }, [id, v, publish]);

  const imageSaver = <ImageSaver card={card && !("error" in card) ? card.color : null} routeName={v.data.name} />;
  // 作った本人以外（X から来た人など）には、これを主ボタンにしていちばん上に置く
  const makeOwn = (
    <Button variant={owner ? "normal" : "primary"} block onClick={() => navigate("/")}>
      オリジナル路線を作る
    </Button>
  );

  return (
    <div className="app__scroll route-page">
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
        {owner ? (
          <>
            <Button variant="primary" block onClick={edit} disabled={pub.deleting}>
              編集する
            </Button>
            {/* 名前も v も、このページが読んだもの（表示中の名前と別の版の rev を組み合わせない） */}
            {v.rev && <XShareButton href={xShareHref({ id, rev: v.rev, name: v.data.name })} />}
            {imageSaver}
            {makeOwn}
            <DeleteRouteButton id={id} block onDeleted={onDeleted} />
          </>
        ) : (
          <>
            {makeOwn}
            {imageSaver}
          </>
        )}
      </div>
    </div>
  );
}
