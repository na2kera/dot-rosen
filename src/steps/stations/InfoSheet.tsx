// 出典とつかいかた
import { ATTRIBUTION_LINES, ATTRIBUTION_SOURCES } from "../../../shared/attribution.ts";
import { Sheet } from "../../ui/Sheet.tsx";

export function InfoSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} title="出典とつかいかた" onClose={onClose}>
      <div className="info">
        <h3 className="info__head">つかいかた</h3>
        <ul className="info__list">
          <li>駅をタップすると、線がつながります。タップした順が停車順です。</li>
          <li>1本指で地図を動かし、2本指で大きく・小さくします。ダブルタップでも大きくなります。</li>
          <li>路線に入っている駅をタップすると、外すかどうかを聞きます。</li>
          <li>始発駅をもう一度タップすると、環状線にできます。</li>
          <li>駅は30駅まで。作りかけは この端末に自動で保存されます。</li>
        </ul>
        <h3 className="info__head">出典</h3>
        <ul className="info__list">
          {ATTRIBUTION_LINES.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <ul className="info__list">
          {ATTRIBUTION_SOURCES.map((s) => (
            <li key={s.name}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.name}
              </a>
              （{s.license}）
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
