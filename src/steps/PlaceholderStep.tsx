// 中身がまだ無いステップ（このあと作る）
import { Panel } from "../ui/Panel.tsx";

export function PlaceholderStep({ title }: { title: string }) {
  return (
    <div className="app__scroll">
      <Panel title={title}>
        <p>この画面は このあと作ります。</p>
      </Panel>
    </div>
  );
}
