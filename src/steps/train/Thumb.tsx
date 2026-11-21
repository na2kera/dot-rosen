// 候補1つ（小さな絵と名前）。画面に入ったときに絵を描く。選んでいるものには枠を付ける
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IndexedImage } from "../../../shared/pix/index.ts";
import { CardLabel } from "./label-break.tsx";
import { cachedThumb, requestThumb } from "./thumbs.ts";

type Props = {
  /** 絵のキー（絵の中身が変わるときだけ変わるもの） */
  thumbKey: string;
  make(): IndexedImage;
  width: number;
  height: number;
  /** CSS の倍率（整数） */
  scale?: number;
  label: string;
  selected: boolean;
  onSelect(): void;
  className?: string;
};

export function Thumb({ thumbKey, make, width, height, scale = 1, label, selected, onSelect, className }: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const makeRef = useRef(make);
  makeRef.current = make;

  // 画面に入ったら描く（一度見えたら、そのあとは見えている扱い）
  useEffect(() => {
    const el = btn.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    const put = (img: ImageData) => canvas.current?.getContext("2d")?.putImageData(img, 0, 0);
    const hit = cachedThumb(thumbKey);
    if (hit) {
      put(hit);
      return;
    }
    // 描き終わるまでは前の絵のまま（ちらつかせない）
    return requestThumb(thumbKey, () => makeRef.current(), put);
  }, [thumbKey, visible]);

  return (
    <button ref={btn} type="button" className={`thumb ${className ?? ""}`} aria-pressed={selected} onClick={onSelect}>
      <canvas ref={canvas} className="pix thumb__img" width={width} height={height} style={{ width: width * scale, height: height * scale }} aria-hidden="true" />
      <CardLabel text={label} />
    </button>
  );
}
