// 路線カードの QR コードの段: URL が長いときの置き方（右に文字 → 下に文字 → QR を省く）。
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CARD_WIDTH, layoutCard, renderCardColor, renderCardPrint, type CardInput } from "../shared/card/index.ts";
import { cardFixtures, FixtureKit, loadFont, loadStations } from "../tools/lib/card-fixtures.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
let base: CardInput;

beforeAll(() => {
  const kit = new FixtureKit(loadFont(ROOT), loadStations(ROOT));
  base = cardFixtures(kit).find((f) => f.id === "short-2st-1car")!.input;
});

/** 文字と QR がすべて画像の中に収まっているか */
function inside(input: CardInput) {
  const { width, height, ops } = layoutCard(input);
  for (const o of ops) {
    if (o.k === "qr") {
      const s = o.m.size * o.cell;
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x + s).toBeLessThanOrEqual(width);
      expect(o.y + s).toBeLessThanOrEqual(height);
    }
    if (o.k === "text") {
      expect(o.x, o.s).toBeGreaterThanOrEqual(0);
      expect(o.y + 16 * o.sy, o.s).toBeLessThanOrEqual(height);
    }
  }
  return ops;
}

const textRight = (input: CardInput, s: string) => {
  const ops = layoutCard(input).ops.filter((o) => o.k === "text" && o.s === s);
  return ops.length;
};

describe("QR コードの段（長い URL）", () => {
  it("ふつうの URL では QR の右に文字を置く", () => {
    const url = "https://dot-rosen.example/r/AbCdEfGhIjKlMnOp";
    const ops = inside({ ...base, url, expiresOn: "12月20日" });
    const qr = ops.find((o) => o.k === "qr")!;
    const app = ops.find((o) => o.k === "text" && o.s === "ドット路線メーカー")!;
    expect(qr.k === "qr" && app.k === "text" && app.x > qr.x + qr.m.size * qr.cell).toBe(true);
  });

  it("長い URL で右に文字が入らないときは、QR の下に中央寄せで置き、どれも画像の外へ出ない", () => {
    const url = "https://dot-rosen.example/r/" + "x".repeat(300);
    const input = { ...base, url, expiresOn: "12月20日" };
    const ops = inside(input);
    const qr = ops.find((o) => o.k === "qr")!;
    if (qr.k !== "qr") throw new Error();
    const total = qr.m.size * qr.cell + 32;
    expect(total).toBeLessThanOrEqual(CARD_WIDTH);
    const app = ops.find((o) => o.k === "text" && o.s === "ドット路線メーカー")!;
    if (app.k !== "text") throw new Error();
    expect(app.y).toBeGreaterThan(qr.y + qr.m.size * qr.cell);
    expect(textRight(input, "12月20日まで見られます")).toBe(1);
    // 描いても例外にならない
    expect(renderCardPrint(input).width).toBe(CARD_WIDTH);
    expect(renderCardColor(input).image.width).toBe(CARD_WIDTH);
  });

  it("QR が幅 384 に入らないほど長い URL では QR を省き、文字だけ残す（例外にしない）", () => {
    const url = "https://dot-rosen.example/r/" + "y".repeat(1500);
    const input = { ...base, url, expiresOn: "12月20日" };
    const ops = inside(input);
    expect(ops.some((o) => o.k === "qr")).toBe(false);
    expect(textRight(input, "ドット路線メーカー")).toBe(1);
    expect(renderCardPrint(input).width).toBe(CARD_WIDTH);
  });
});

describe("QR コードにできないほど長い URL", () => {
  it("QR を省くだけで、例外にしない", () => {
    const input = { ...base, url: "https://dot-rosen.example/r/" + "z".repeat(4000), expiresOn: "12月20日" };
    expect(layoutCard(input).ops.some((o) => o.k === "qr")).toBe(false);
    expect(renderCardPrint(input).width).toBe(CARD_WIDTH);
  });
});
