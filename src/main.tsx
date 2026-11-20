import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { canonicalUrl } from "./app/canonical-host.ts";
import { browserStorage } from "./store/browser.ts";
import { captureEventCode } from "./store/device.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";

// 古い公開先（workers.dev）で開かれたら、何もせず独自ドメインの同じページへ移す
// （会場コードを古いドメインの端末の記録に入れてしまわないよう、覚える前に移す）
const moved = canonicalUrl(window.location.href);
if (moved !== null) {
  window.location.replace(moved);
} else {
  // 会場の QR コードから開かれたら、会場コードを覚えて URL から消す
  const cleaned = captureEventCode(window.location.href, browserStorage());
  if (cleaned !== null) history.replaceState(null, "", cleaned);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
