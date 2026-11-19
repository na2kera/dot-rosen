// 画面の URL（docs/api.md「8. 画面の URL」）。DOM に依存しない。

export type AppRoute = { name: "create" } | { name: "route"; id: string } | { name: "admin" } | { name: "notFound" };

export function matchRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "create" };
  if (path === "/admin") return { name: "admin" };
  const m = /^\/r\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (m) return { name: "route", id: m[1] };
  return { name: "notFound" };
}
