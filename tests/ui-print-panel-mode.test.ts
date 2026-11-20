// 「できあがり」の「印刷する」の欄の出し分け（src/steps/finish/print-panel-mode.ts、Issue #2）の試験。
import { describe, expect, it } from "vitest";
import { PRINT_VENUE_GUIDE, printPanelMode, type EventState } from "../src/steps/finish/print-panel-mode.ts";

describe("印刷の欄の出し分け", () => {
  it("会場コードなし・記録なし → 案内を出す（ボタンは出さない）", () => {
    expect(printPanelMode(false, "none")).toBe("guide");
    expect(PRINT_VENUE_GUIDE).toBe("印刷は イベント会場で できます。会場の QR コードを 読みこんでね");
  });

  it("会場コードが無効（作り直される前の古いコードなど）・記録なし → 同じ案内を出す", () => {
    expect(printPanelMode(false, "invalid")).toBe("guide");
  });

  it("会場コードがあり、確認中・受付中・休止中・失敗 → 今までどおりの欄", () => {
    for (const e of ["checking", "open", "closed", "error"] as EventState[]) expect(printPanelMode(false, e)).toBe("panel");
  });

  it("印刷の記録があれば、会場コードの状態によらず今までどおりの欄", () => {
    for (const e of ["none", "checking", "open", "closed", "invalid", "error"] as EventState[]) expect(printPanelMode(true, e)).toBe("panel");
  });
});
