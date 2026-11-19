// 画面全体で1つだけ持つもの（API、保存と印刷のストア）。作る画面と路線ページで同じものを使う。
import { createApi, type Api } from "../api/client.ts";
import { browserStorage, onExternalStorageChange, randomBytes } from "../store/browser.ts";
import { getOrCreateClientId } from "../store/device.ts";
import { createPublishStore, type PublishStore } from "../store/publish-store.ts";
import { createConfigLoader, type ConfigLoader } from "../store/server-config.ts";
import type { Step } from "../store/ui-store.ts";

let api: Api | null = null;
let publish: PublishStore | null = null;
let config: ConfigLoader | null = null;

export function getApi(): Api {
  api ??= createApi((input, init) => fetch(input, init));
  return api;
}

/** サーバーの設定値（印刷の見た目など）。データの読み込みと同じタイミングで load() する */
export function getConfig(): ConfigLoader {
  config ??= createConfigLoader(getApi());
  return config;
}

export function getPublish(): PublishStore {
  if (!publish) {
    const storage = browserStorage();
    const p = createPublishStore({
      storage,
      api: getApi(),
      random: randomBytes,
      clientId: getOrCreateClientId(storage, randomBytes),
      // 申し込んだときの見た目を覚える（応答に見た目が無いときに使う）
      cardLook: () => getConfig().store.get().card,
      isHidden: () => document.hidden,
      // ほかのタブで保存・印刷したら取り込む
      subscribeExternal: onExternalStorageChange,
    });
    // 表に戻ったら、印刷の状態をすぐに問い合わせる
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) p.wake();
    });
    publish = p;
  }
  return publish;
}

/** 路線ページの「編集する」から作る画面へ移るときに、最初に開くステップ */
let initialStep: Step | null = null;

export function setInitialStep(step: Step): void {
  initialStep = step;
}

export function takeInitialStep(): Step | null {
  const s = initialStep;
  initialStep = null;
  return s;
}
