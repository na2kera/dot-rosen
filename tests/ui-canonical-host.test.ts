// 古い公開先から独自ドメインへ移す先の URL（src/app/canonical-host.ts）の試験。
import { describe, expect, it } from "vitest";
import { canonicalUrl } from "../src/app/canonical-host.ts";

describe("独自ドメインへの転送", () => {
  it("workers.dev で開かれたら、同じパス・クエリ・ハッシュで独自ドメインへ", () => {
    expect(canonicalUrl("https://dot-rosen.na2kera.workers.dev/")).toBe("https://dot-rosen.na2kera.com/");
    expect(canonicalUrl("https://dot-rosen.na2kera.workers.dev/?event=ABC123")).toBe("https://dot-rosen.na2kera.com/?event=ABC123");
    expect(canonicalUrl("https://dot-rosen.na2kera.workers.dev/r/abcDEF_-12345678#x")).toBe("https://dot-rosen.na2kera.com/r/abcDEF_-12345678#x");
    expect(canonicalUrl("https://dot-rosen.na2kera.workers.dev/admin")).toBe("https://dot-rosen.na2kera.com/admin");
  });

  it("独自ドメイン・ローカル・ほかのホストでは移さない", () => {
    expect(canonicalUrl("https://dot-rosen.na2kera.com/?event=ABC123")).toBeNull();
    expect(canonicalUrl("http://127.0.0.1:5173/")).toBeNull();
    expect(canonicalUrl("http://localhost:5173/r/x")).toBeNull();
    expect(canonicalUrl("https://evil.example/dot-rosen.na2kera.workers.dev")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
  });
});
