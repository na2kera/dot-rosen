// 作る画面（4ステップ）。データを読み込んでからストアを作る。
import { useCallback, useEffect, useMemo, useState } from "react";
import { MIN_STATIONS } from "../../shared/route/index.ts";
import { loadAppData, type AppData } from "../data/load.ts";
import { LineStep } from "../steps/line/LineStep.tsx";
import { FinishStep } from "../steps/finish/FinishStep.tsx";
import { StationsStep } from "../steps/stations/StationsStep.tsx";
import { TrainStep } from "../steps/train/TrainStep.tsx";
import { browserStorage, onExternalStorageChange, randomBytes } from "../store/browser.ts";
import { STORAGE_KEYS } from "../store/kv-storage.ts";
import { useStore } from "../store/use-store.ts";
import { getOrCreateClientId } from "../store/device.ts";
import { stationsRemaining } from "../store/route-ops.ts";
import { createRouteStore } from "../store/route-store.ts";
import { createUiStore, type Step } from "../store/ui-store.ts";
import { Board } from "../ui/Board.tsx";
import { DialogHost } from "../ui/Dialog.tsx";
import { Loading } from "../ui/Loading.tsx";
import { STEPS, StepNav } from "../ui/StepNav.tsx";
import { toast, ToastHost } from "../ui/Toast.tsx";
import { AppContext, useApp, useDraft, useUi, type AppContextValue } from "./AppContext.tsx";
import { getConfig, getPublish, takeInitialStep } from "./services.ts";

/** 一度読んだデータは画面を移っても使い回す */
let dataPromise: Promise<AppData> | null = null;

export function CreatePage() {
  const [data, setData] = useState<AppData | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setProgress(0);
    dataPromise ??= loadAppData(setProgress);
    // サーバーの設定（印刷プレビューの見た目）も同時に取る。失敗しても既定値で進む（reject しない）
    Promise.all([dataPromise, getConfig().load()]).then(([d]) => setData(d), () => {
      dataPromise = null;
      setError("よみこめませんでした。電波のよい所で もういちど ためしてね");
    });
  }, []);

  useEffect(load, [load]);

  if (!data) {
    return (
      <div className="app">
        <Board title="ドット路線メーカー" />
        <main className="app__main">
          <Loading progress={progress} error={error} onRetry={load} />
        </main>
        <div />
      </div>
    );
  }
  return <CreateApp data={data} />;
}

function CreateApp({ data }: { data: AppData }) {
  const ctx = useMemo<AppContextValue>(() => {
    const storage = browserStorage();
    return {
      data,
      storage,
      clientId: getOrCreateClientId(storage, randomBytes),
      route: createRouteStore({ storage, lookup: data.index.lookup }),
      ui: createUiStore({ step: takeInitialStep() ?? 1 }),
    };
  }, [data]);

  // 開発用: ブラウザの自動操作から状態を確かめる
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __app?: AppContextValue }).__app = ctx;
  }, [ctx]);

  // 印刷の申し込みが途中なら、状態の問い合わせを続ける
  useEffect(() => {
    const p = getPublish();
    p.resumePolling();
    return () => p.stopPolling();
  }, []);

  // ほかのタブで作りかけが変わったら取り込む
  useEffect(() => onExternalStorageChange((key) => (key === null || key === STORAGE_KEYS.draft) && ctx.route.syncFromStorage()), [ctx]);

  // ページを離れるときは待たずに保存する
  useEffect(() => {
    const flush = () => ctx.route.flush();
    const onVis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ctx]);

  return (
    <AppContext.Provider value={ctx}>
      <CreateLayout />
    </AppContext.Provider>
  );
}

function boardSub(step: Step, remaining: number, symbol: string, cars: number): string | undefined {
  if (step === 1) return `あと${remaining}駅`;
  if (step === 2) return symbol || undefined;
  if (step === 3) return `${cars}両`;
  return undefined;
}

/** 端末に保存できないことのお知らせは、開いている間に1回だけ */
let storageWarned = false;
const selectPersistFailed = (s: { persistFailed: boolean }) => s.persistFailed;

function useStorageWarning(): void {
  const { route, storage } = useApp();
  const persistFailed = useStore(route.store, selectPersistFailed);
  const mode = (storage as { mode?: string }).mode ?? "ok";
  useEffect(() => {
    if (storageWarned || (mode === "ok" && !persistFailed)) return;
    storageWarned = true;
    toast(
      mode === "ok"
        ? "この端末に保存できませんでした。空き容量を確かめてね（作りかけは このページを開いている間は残ります）"
        : "この端末には保存できません（プライベートモードなど）。ページを読み込み直すと作りかけが消えます",
      { tone: "alert", ms: 6000 },
    );
  }, [mode, persistFailed]);
}

function CreateLayout() {
  const { ui } = useApp();
  useStorageWarning();
  const draft = useDraft();
  const { step } = useUi();
  const meta = STEPS[step - 1];
  const locked = draft.stations.length < MIN_STATIONS ? { 4: `駅を${MIN_STATIONS}つ以上えらぶと「できあがり」に進めます` } : {};

  return (
    <div className="app">
      <Board title={`${step} ${meta.title}`} sub={boardSub(step, stationsRemaining(draft), draft.symbol, draft.train.cars)} />
      <main className="app__main">
        {step === 1 && <StationsStep />}
        {step === 2 && <LineStep />}
        {step === 3 && <TrainStep />}
        {step === 4 && <FinishStep />}
      </main>
      <StepNav current={step} locked={locked} onSelect={ui.setStep} onLocked={(_, reason) => toast(reason, { tone: "alert" })} />
      <DialogHost />
      <ToastHost />
    </div>
  );
}
