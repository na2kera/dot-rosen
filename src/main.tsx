import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { browserStorage } from "./store/browser.ts";
import { captureEventCode } from "./store/device.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";

// 会場の QR コードから開かれたら、会場コードを覚えて URL から消す
const cleaned = captureEventCode(window.location.href, browserStorage());
if (cleaned !== null) history.replaceState(null, "", cleaned);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
