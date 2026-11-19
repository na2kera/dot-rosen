// 画面の入口。URL ごとに画面を切り替える。
import { CreatePage } from "./app/CreatePage.tsx";
import { SimplePage } from "./app/SimplePage.tsx";
import { useRoute } from "./router.ts";

export function App() {
  const route = useRoute();
  switch (route.name) {
    case "create":
      return <CreatePage />;
    case "route":
      return (
        <SimplePage title="路線のページ" heading="準備中">
          <p>路線のページは準備中です。</p>
        </SimplePage>
      );
    case "admin":
      return (
        <SimplePage title="管理" heading="準備中">
          <p>管理画面は準備中です。</p>
        </SimplePage>
      );
    default:
      return (
        <SimplePage title="ドット路線メーカー" heading="見つかりません">
          <p>このページは ありません。</p>
        </SimplePage>
      );
  }
}
