// 画面の入口。URL ごとに画面を切り替える。
import { AdminPage } from "./admin/AdminPage.tsx";
import { CreatePage } from "./app/CreatePage.tsx";
import { RoutePage } from "./app/RoutePage.tsx";
import { SimplePage } from "./app/SimplePage.tsx";
import { useRoute } from "./router.ts";

export function App() {
  const route = useRoute();
  switch (route.name) {
    case "create":
      return <CreatePage />;
    case "route":
      return <RoutePage key={route.id} id={route.id} />;
    case "admin":
      return <AdminPage />;
    default:
      return (
        <SimplePage title="ドット路線メーカー" heading="見つかりません">
          <p>このページは ありません。</p>
        </SimplePage>
      );
  }
}
