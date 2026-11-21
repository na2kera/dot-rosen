// 路線のページへの題と絵の差し込み（worker/lib/page-meta.ts）の試験。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { escapeHtml, injectRouteMeta, type RouteMeta } from "../worker/lib/page-meta.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const meta = (name: string): RouteMeta => ({
  title: `${name}｜ドット路線メーカー`,
  description: `新宿 ⇄ 横浜・5駅。首都圏の実在の駅をつないで、自分だけの路線と電車を作ろう。`,
  url: "https://dot-rosen.na2kera.com/r/Qk7xZp2LmN9aRt4V?v=9581c4",
  image: "https://dot-rosen.na2kera.com/og/Qk7xZp2LmN9aRt4V.png?v=9581c4",
  imageAlt: `${name}の路線カード。電車の正面と側面、路線図。`,
});

/** <meta property|name="key" content="..."> の content（エスケープしたまま） */
function content(html: string, key: string): string[] {
  const re = new RegExp(`<meta\\s+(?:property|name)="${key.replace(/[.:]/g, "\\$&")}"\\s+content="([^"]*)"`, "g");
  return [...html.matchAll(re)].map((m) => m[1]);
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("路線のページへの差し込み", () => {
  it("題・説明・URL・絵を置き換える（足さない）。幅と高さはそのまま", () => {
    const out = injectRouteMeta(HTML, meta("みどり線"));
    expect(out).toContain("<title>みどり線｜ドット路線メーカー</title>");
    expect(out.match(/<title>/g)).toHaveLength(1);
    for (const k of ["og:title", "twitter:title"]) expect(content(out, k)).toEqual(["みどり線｜ドット路線メーカー"]);
    for (const k of ["description", "og:description", "twitter:description"]) expect(content(out, k)).toEqual([meta("x").description]);
    expect(content(out, "og:url")).toEqual([meta("x").url]);
    expect(content(out, "og:image")).toEqual([meta("x").image]);
    expect(content(out, "twitter:image")).toEqual([meta("x").image]);
    expect(content(out, "og:image:alt")).toEqual(["みどり線の路線カード。電車の正面と側面、路線図。"]);
    // og:image の置き換えが og:image:width などに当たらない
    expect(content(out, "og:image:width")).toEqual(["1200"]);
    expect(content(out, "og:image:height")).toEqual(["630"]);
    // meta の数は変わらない
    expect(out.match(/<meta /g)!.length).toBe(HTML.match(/<meta /g)!.length);
    // 置き換えた項目以外は同じ
    expect(content(out, "og:site_name")).toEqual(content(HTML, "og:site_name"));
    expect(out.slice(out.indexOf("</head>"))).toBe(HTML.slice(HTML.indexOf("</head>")));
  });

  it("悪い路線名（タグ・引用符・&・$&・</title>・改行）でもタグが壊れない", () => {
    const bads = ['"><script>alert(1)</script>', "</title><script>x</script>", "A&B", "$&$1$$'", "改\n行", "'\"<>&"];
    for (const name of bads) {
      const m = meta(name);
      const out = injectRouteMeta(HTML, m);
      expect(out, name).not.toContain("<script>");
      expect(out.match(/<title>/g), name).toHaveLength(1);
      expect(out.match(/<\/title>/g), name).toHaveLength(1);
      const title = /<title>([^<]*)<\/title>/.exec(out)![1];
      expect(unescape(title), name).toBe(m.title);
      for (const k of ["og:title", "twitter:title"]) expect(content(out, k).map(unescape), `${name} ${k}`).toEqual([m.title]);
      expect(content(out, "og:image:alt").map(unescape), name).toEqual([m.imageAlt]);
      expect(out.match(/<meta /g)!.length, name).toBe(HTML.match(/<meta /g)!.length);
    }
  });

  it("エスケープ", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("対象のタグが無い HTML は 1 バイトも変えない", () => {
    const plain = "<!doctype html><html><head><meta charset=\"UTF-8\"></head><body></body></html>";
    expect(injectRouteMeta(plain, meta("x"))).toBe(plain);
  });

  it("ソースの index.html で、10 項目すべてが期待どおりの値に置き換わる", () => {
    const m = meta("みどり線");
    const out = injectRouteMeta(HTML, m);
    expect(mismatches(out, m)).toEqual([]);
    // 置き換え前の値とは違う（同じ値のまま通っていない）
    for (const [key] of ITEMS) expect(read(out, key), key).not.toBe(read(HTML, key));
  });

  it("置き換わらなかった項目があれば分かる（index.html の形が変わったら落ちる）", () => {
    const m = meta("みどり線");
    // 形を変えた HTML（title に属性、og:url の属性の順が逆、twitter:image を消す）では、その項目が報告される
    const changed = HTML.replace("<title>", '<title data-x="1">')
      .replace(/<meta property="og:url" content="([^"]*)"/, '<meta content="$1" property="og:url"')
      .replace(/\s*<meta name="twitter:image"[^>]*>/, "");
    expect(mismatches(injectRouteMeta(changed, m), m).sort()).toEqual(["og:url", "title", "twitter:image"]);
  });

  it.runIf(fs.existsSync(path.join(ROOT, "dist/client/index.html")))("ビルドした index.html でも、10 項目すべてが置き換わる", () => {
    const html = fs.readFileSync(path.join(ROOT, "dist/client/index.html"), "utf8");
    const m = meta("みどり線");
    expect(mismatches(injectRouteMeta(html, m), m)).toEqual([]);
  });
});

/** 置き換える 10 項目と、RouteMeta のどの値が入るか */
const ITEMS: [string, keyof RouteMeta][] = [
  ["title", "title"],
  ["og:title", "title"],
  ["twitter:title", "title"],
  ["description", "description"],
  ["og:description", "description"],
  ["twitter:description", "description"],
  ["og:url", "url"],
  ["og:image", "image"],
  ["twitter:image", "image"],
  ["og:image:alt", "imageAlt"],
];

/** 項目の値（エスケープを戻したもの）。1 つも無い・2 つ以上あるときは null */
function read(html: string, key: string): string | null {
  const vals = key === "title" ? [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]) : content(html, key);
  return vals.length === 1 ? unescape(vals[0]) : null;
}

/** 期待した値になっていない項目の名前 */
function mismatches(html: string, m: RouteMeta): string[] {
  return ITEMS.filter(([key, field]) => read(html, key) !== m[field]).map(([key]) => key);
}
