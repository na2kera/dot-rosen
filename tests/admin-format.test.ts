// 管理画面の表示用の処理（src/admin/format.ts、src/admin/qr.ts）の試験。
import { describe, expect, it } from "vitest";
import { AdminApiError } from "../src/admin/api.ts";
import {
  actionErrorText,
  elapsedText,
  eventUrl,
  formatTime,
  issueText,
  jobActions,
  jobView,
  loginErrorText,
  PRINTER_OFFLINE_MS,
  printerView,
} from "../src/admin/format.ts";
import { QUIET, qrMatrix, qrPath } from "../src/admin/qr.ts";

describe("経過時間", () => {
  it("秒・分・時間・日", () => {
    expect(elapsedText(3400)).toBe("3秒前");
    expect(elapsedText(-500)).toBe("0秒前");
    expect(elapsedText(59_999)).toBe("59秒前");
    expect(elapsedText(60_000)).toBe("1分前");
    expect(elapsedText(2 * 3600_000)).toBe("2時間前");
    expect(elapsedText(3 * 86400_000)).toBe("3日前");
  });
});

describe("プリンタの状態", () => {
  const seen = "2026-11-20T05:00:00.000Z";
  const t = Date.parse(seen);
  it("一度も問い合わせが無ければ、つながっていない", () => {
    expect(printerView(null, t)).toMatchObject({ online: false, label: "つながっていません" });
  });
  it("記録の間隔（30秒）の範囲なら、つながっている", () => {
    expect(printerView(seen, t + 3000)).toMatchObject({ online: true, detail: expect.stringContaining("3秒前") });
    expect(printerView(seen, t + 33_000).online).toBe(true);
  });
  it("しきい値を超えたら、つながっていない（経過を出す）", () => {
    expect(printerView(seen, t + PRINTER_OFFLINE_MS).online).toBe(false);
    expect(printerView(seen, t + 5 * 60_000)).toMatchObject({ online: false, detail: "最後の問い合わせ 5分前" });
  });
});

describe("印刷の状態", () => {
  it("状態ごとの文言と色", () => {
    expect(jobView({ status: "queued", error: null })).toMatchObject({ label: "待ち", tone: "wait" });
    expect(jobView({ status: "printing", error: null })).toMatchObject({ label: "印刷中", tone: "busy" });
    expect(jobView({ status: "done", error: null })).toMatchObject({ label: "完了", tone: "ok" });
    expect(jobView({ status: "canceled", error: null })).toMatchObject({ label: "取り消し済み", tone: "off" });
    expect(jobView({ status: "failed", error: "paper" })).toMatchObject({ label: "失敗", tone: "bad", note: "理由: paper" });
  });
  it("timeout の失敗は、結果が分からないと出す", () => {
    expect(jobView({ status: "failed", error: "timeout" }).note).toBe("結果が分かりません（紙が出ているか確かめてください）");
  });
  it("取り消しは queued だけ、再印刷は done / failed だけ", () => {
    expect(jobActions("queued")).toEqual({ cancel: true, reprint: false });
    expect(jobActions("printing")).toEqual({ cancel: false, reprint: false });
    expect(jobActions("done")).toEqual({ cancel: false, reprint: true });
    expect(jobActions("failed")).toEqual({ cancel: false, reprint: true });
    expect(jobActions("canceled")).toEqual({ cancel: false, reprint: false });
  });
});

describe("表示の形", () => {
  it("時刻は日本時間", () => {
    expect(formatTime("2026-11-20T15:04:00.000Z")).toBe("11/21 00:04");
    expect(formatTime("2026-11-20T05:09:00.000Z")).toBe("11/20 14:09");
    expect(formatTime(null)).toBe("—");
  });
  it("発行番号と会場の URL", () => {
    expect(issueText(42)).toBe("No.0042");
    expect(issueText(12345)).toBe("No.12345");
    expect(eventUrl("https://example.test", "ABC123xyz9")).toBe("https://example.test/?event=ABC123xyz9");
  });
});

describe("失敗の理由", () => {
  it("ログイン", () => {
    expect(loginErrorText(new AdminApiError(401, "unauthorized"))).toBe("パスワードが違います");
    expect(loginErrorText(new AdminApiError(429, "rate_limited", 125))).toContain("3分ほど待って");
    expect(loginErrorText(new AdminApiError(429, "rate_limited"))).toContain("しばらく待って");
    expect(loginErrorText(new AdminApiError(0, "network"))).toContain("通信できません");
  });
  it("操作", () => {
    expect(actionErrorText(new AdminApiError(409, "conflict"), "cancel")).toContain("もう印刷が始まっています");
    expect(actionErrorText(new AdminApiError(409, "conflict"), "reprint")).toContain("非公開");
    expect(actionErrorText(new AdminApiError(404, "not_found"), "hide")).toContain("見つかりません");
  });
});

describe("QR コード", () => {
  it("黒のマスの数だけ面積があり、余白の分ずれている", () => {
    const m = qrMatrix("https://example.test/?event=ABC123xyz9");
    const d = qrPath(m);
    let area = 0;
    let minX = Infinity;
    for (const seg of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      area += Number(seg[3]);
      minX = Math.min(minX, Number(seg[1]));
    }
    expect(area).toBe(m.dark.reduce((a, b) => a + b, 0));
    expect(minX).toBe(QUIET);
  });
});

describe("印刷の見た目の名前", () => {
  it("6 通りすべてに分かる名前が付く", async () => {
    const { CARD_MONO_SETS, CARD_SIDE_LAYOUTS } = await import("../shared/card/index.ts");
    const { lookText, MONO_SET_LABELS, SIDE_LAYOUT_LABELS } = await import("../src/admin/format.ts");
    expect(MONO_SET_LABELS).toEqual({ bold: "こい（bold）", light: "うすい（light）" });
    expect(SIDE_LAYOUT_LABELS).toEqual({
      "two-x1": "2両を横に（等倍）",
      "lead-x2": "先頭車を大きく（2倍）",
      "two-x2-rotated": "2両をたてに（2倍・紙の長さ方向）",
    });
    const texts = new Set(CARD_MONO_SETS.flatMap((monoSet) => CARD_SIDE_LAYOUTS.map((sideLayout) => lookText({ monoSet, sideLayout }))));
    expect(texts.size).toBe(6);
    expect(lookText({ monoSet: "bold", sideLayout: "two-x1" })).toBe("こい（bold）・2両を横に（等倍）");
  });
});
