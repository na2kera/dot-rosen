// 「できあがり」の「印刷する」の欄の出し分け（Issue #2）。画面の部品から切り離した純粋な判定。

/** 会場コードの確認の状態。none は会場コードを端末に持っていない（確認の通信もしない） */
export type EventState = "none" | "checking" | "open" | "closed" | "invalid" | "error";

/** 使える会場コードが無く、印刷の記録も無いときに、ボタンの代わりに出す案内 */
export const PRINT_VENUE_GUIDE = "印刷は イベント会場で できます。会場の QR コードを 読みこんでね";

/**
 * - guide: 欄を出し、ボタンの代わりに会場の案内を出す（記録が無く、会場コードを持っていないか、持っているコードが無効）
 * - panel: 申し込みや状態を出す欄
 * 欄そのものは常に出す（docs/api.md「9. 画面で伝えること」）
 */
export type PrintPanelMode = "guide" | "panel";

export function printPanelMode(hasRecord: boolean, event: EventState): PrintPanelMode {
  if (hasRecord) return "panel";
  if (event === "none" || event === "invalid") return "guide";
  return "panel";
}
