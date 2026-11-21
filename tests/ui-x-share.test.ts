// X で共有する投稿文と投稿画面の URL（src/share/x-share.ts）の試験。
import { describe, expect, it } from "vitest";
import {
  finishXShare,
  routeXShare,
  X_HASHTAG,
  X_REASON_DIRTY,
  X_REASON_UNSAVED,
  xIntentUrl,
  xShareHref,
  xShareRouteUrl,
  xShareText,
} from "../src/share/x-share.ts";

const ID = "Qk7xZp2LmN9aRt4V";
const REV = "9581c4ed7a1a4e86";

describe("X で共有", () => {
  it("URL は独自ドメイン固定で、v は rev の先頭 6 桁", () => {
    expect(xShareRouteUrl(ID, REV)).toBe(`https://dot-rosen.na2kera.com/r/${ID}?v=9581c4`);
  });

  it("名前ありの投稿文（決めた改行）", () => {
    const url = xShareRouteUrl(ID, REV);
    expect(xShareText("みどり線", url)).toBe(
      `ドット路線メーカーで「みどり線」を作ったよ！\nみんなもオリジナルの路線を作ろう！\n${url}\n\n#ドット路線メーカー`,
    );
  });

  it("名前が空（空白だけを含む）なら「オリジナルの路線」として書く", () => {
    const url = xShareRouteUrl(ID, REV);
    for (const name of ["", "  ", "\n"]) {
      const text = xShareText(name, url);
      expect(text.split("\n")[0]).toBe("ドット路線メーカーでオリジナルの路線を作ったよ！");
      expect(text).not.toContain("「");
    }
  });

  it("名前の改行は空白にする（行の並びが崩れない）", () => {
    const text = xShareText("あ\nい\r\nう\u2028え", "https://x.test");
    expect(text.split("\n")).toHaveLength(5);
    expect(text.split("\n")[0]).toBe("ドット路線メーカーで「あ い う え」を作ったよ！");
  });

  it("投稿画面の URL は text 1 つに全文を入れ、エンコードする", () => {
    const href = xShareHref({ id: ID, rev: REV, name: "A&B #1 線?" });
    expect(href.startsWith("https://x.com/intent/post?text=")).toBe(true);
    const u = new URL(href);
    expect([...u.searchParams.keys()]).toEqual(["text"]);
    const text = u.searchParams.get("text")!;
    expect(text).toBe(xShareText("A&B #1 線?", `https://dot-rosen.na2kera.com/r/${ID}?v=9581c4`));
    expect(text.endsWith(`\n\n${X_HASHTAG}`)).toBe(true);
    // & # ? 改行 はそのまま入らない
    const raw = href.slice("https://x.com/intent/post?text=".length);
    expect(raw).not.toMatch(/[&#?\n ]/);
    expect(xIntentUrl("a b")).toBe("https://x.com/intent/post?text=a%20b");
  });
});

/** href の投稿文 */
const textOf = (href: string) => new URL(href).searchParams.get("text")!;

describe("「できあがり」の X で共有の押せる条件", () => {
  const saved = { id: ID, savedRev: REV };

  it("保存する前: 押せない。理由は「URL をつくると…」", () => {
    expect(finishXShare({ status: "none", saved: null, name: "みどり線" })).toEqual({ href: null, reason: X_REASON_UNSAVED });
    // 鍵だけあって id が無い（初めての保存の途中・失敗）も保存する前
    expect(finishXShare({ status: "none", saved: { id: null, savedRev: null }, name: "みどり線" })).toEqual({ href: null, reason: X_REASON_UNSAVED });
  });

  it("保存ずみ（clean）: 押せる。名前は画面のデータ、v は保存記録の rev", () => {
    const r = finishXShare({ status: "clean", saved, name: "みどり線" });
    expect(r.reason).toBeNull();
    expect(r.href).toBe(xShareHref({ id: ID, rev: REV, name: "みどり線" }));
    expect(textOf(r.href!)).toContain(`「みどり線」`);
    expect(textOf(r.href!)).toContain(`/r/${ID}?v=9581c4`);
  });

  it("変更あり・保存の結果が分からない: 押せない。理由は「保存しなおすと…」", () => {
    expect(finishXShare({ status: "dirty", saved, name: "みどり線" })).toEqual({ href: null, reason: X_REASON_DIRTY });
    expect(finishXShare({ status: "dirty", saved: { id: ID, savedRev: null }, name: "みどり線" })).toEqual({ href: null, reason: X_REASON_DIRTY });
  });

  it("rev が無い・データが検査に通らないときは、clean でも押せない", () => {
    expect(finishXShare({ status: "clean", saved: { id: ID, savedRev: null }, name: "みどり線" })).toEqual({ href: null, reason: X_REASON_DIRTY });
    expect(finishXShare({ status: "clean", saved, name: null })).toEqual({ href: null, reason: X_REASON_DIRTY });
  });
});

describe("路線のページの X で共有", () => {
  const loaded = { data: { name: "あお線" }, rev: "abcdef0123456789" };

  it("持ち主: ページが読んだ名前と rev の組で作る", () => {
    const href = routeXShare({ owner: true, id: ID, loaded });
    expect(href).toBe(xShareHref({ id: ID, rev: "abcdef0123456789", name: "あお線" }));
    expect(textOf(href!)).toContain("「あお線」");
    expect(textOf(href!)).toContain(`/r/${ID}?v=abcdef`);
  });

  it("持ち主以外・rev が無いときは出さない", () => {
    expect(routeXShare({ owner: false, id: ID, loaded })).toBeNull();
    expect(routeXShare({ owner: true, id: ID, loaded: { ...loaded, rev: null } })).toBeNull();
  });
});
