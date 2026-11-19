import type { Step } from "../store/ui-store.ts";
import { PixelIcon, type IconName } from "./PixelIcon.tsx";

export const STEPS: readonly { step: Step; label: string; title: string; icon: IconName }[] = [
  { step: 1, label: "駅", title: "駅をえらぶ", icon: "station" },
  { step: 2, label: "路線", title: "路線をきめる", icon: "route" },
  { step: 3, label: "電車", title: "電車をつくる", icon: "train" },
  { step: 4, label: "できあがり", title: "できあがり", icon: "card" },
];

type Props = {
  current: Step;
  /** 押せないステップと、その理由 */
  locked?: Partial<Record<Step, string>>;
  onSelect(step: Step): void;
  /** 押せないステップを押したとき */
  onLocked?(step: Step, reason: string): void;
};

/** 画面下部の4ステップの切り替え。今のステップは反転表示 */
export function StepNav({ current, locked = {}, onSelect, onLocked }: Props) {
  return (
    <nav className="stepnav" aria-label="作る手順">
      {STEPS.map((s) => {
        const reason = locked[s.step];
        return (
          <button
            key={s.step}
            type="button"
            className="stepnav__btn"
            aria-current={s.step === current ? "step" : undefined}
            aria-disabled={reason ? true : undefined}
            onClick={() => (reason ? onLocked?.(s.step, reason) : onSelect(s.step))}
          >
            <PixelIcon name={s.icon} />
            <span>
              {s.step} {s.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
