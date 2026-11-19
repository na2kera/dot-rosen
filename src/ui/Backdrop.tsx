import { useRef } from "react";

/** 開いた直後の押下は無視する時間（ミリ秒）。地図のタップのあとに来る click で、すぐ閉じてしまうのを防ぐ */
const GUARD_MS = 450;

/** 重ねる画面の背景（点の模様）。押すと onClose */
export function Backdrop({ onClose }: { onClose(): void }) {
  const opened = useRef(performance.now());
  return (
    <div
      className="backdrop"
      onClick={() => {
        if (performance.now() - opened.current > GUARD_MS) onClose();
      }}
    />
  );
}
