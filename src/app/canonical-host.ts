// 古い公開先（workers.dev）で開かれたら、独自ドメインの同じページへ移す。
// 会場の QR コードと路線カードの QR コードには「そのとき開いていたドメイン」の URL が入るので、
// URL が 2 種類に混ざらないよう、画面は独自ドメインに寄せる。API（/api/*）はどちらのドメインでも動く。

import { CANONICAL_ORIGIN } from "../../shared/site.ts";

export { CANONICAL_ORIGIN };

const OLD_HOST = "dot-rosen.na2kera.workers.dev";

/** 移す先の URL。移す必要が無ければ null。パス・クエリ（会場コードを含む）・ハッシュはそのまま持っていく */
export function canonicalUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.hostname !== OLD_HOST) return null;
  return CANONICAL_ORIGIN + u.pathname + u.search + u.hash;
}
