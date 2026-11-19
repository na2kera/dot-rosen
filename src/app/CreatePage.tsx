// 作る画面（4ステップ）。データを読み込んでからストアを作る。
import { useCallback, useEffect, useMemo, useState } from "react";
import { MIN_STATIONS } from "../../shared/route/index.ts";
import { loadAppData, type AppData } from "../data/load.ts";
import { LineStep } from "../steps/line/LineStep.tsx";
import { PlaceholderStep } from "../steps/PlaceholderStep.tsx";
import { StationsStep } from "../steps/stations/StationsStep.tsx";
import { browserStorage, randomBytes } from "../store/browser.ts";
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
    dataPromise.then(setData, () => {
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
      ui: createUiStore(),
    };
  }, [data]);

  // 開発用: ブラウザの自動操作から状態を確かめる
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __app?: AppContextValue }).__app = ctx;
  }, [ctx]);

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

function boardSub(step: Step, remaining: number, symbol: string): string | undefined {
  if (step === 1) return `あと${remaining}駅`;
  if (step === 2) return symbol || undefined;
  return undefined;
}

function CreateLayout() {
  const { ui } = useApp();
  const draft = useDraft();
  const { step } = useUi();
  const meta = STEPS[step - 1];
  const locked = draft.stations.length < MIN_STATIONS ? { 4: `駅を${MIN_STATIONS}つ以上えらぶと「できあがり」に進めます` } : {};

  return (
    <div className="app">
      <Board title={`${step} ${meta.title}`} sub={boardSub(step, stationsRemaining(draft), draft.symbol)} />
      <main className="app__main">
        {step === 1 && <StationsStep />}
        {step === 2 && <LineStep />}
        {step === 3 && <PlaceholderStep title="電車をつくる" />}
        {step === 4 && <PlaceholderStep title="できあがり" />}
      </main>
      <StepNav current={step} locked={locked} onSelect={ui.setStep} onLocked={(_, reason) => toast(reason, { tone: "alert" })} />
      <DialogHost />
      <ToastHost />
    </div>
  );
}
