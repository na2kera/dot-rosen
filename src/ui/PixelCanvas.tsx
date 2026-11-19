// ドット絵（色番号画像・白黒画像）を Canvas に等倍で描き、CSS で整数倍に拡大して見せる（補間なし）。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { bitToRgba, indexedToRgba, type BitImage, type IndexedImage, type Palette } from "../../shared/pix/index.ts";

export type PixelSource = { image: IndexedImage; palette: Palette } | { image: BitImage };

/** ImageData にする（白黒は黒と紙の白） */
export function toImageData(src: PixelSource): ImageData {
  const { image } = src;
  const rgba = image.kind === "indexed" ? indexedToRgba(image, (src as { palette: Palette }).palette) : bitToRgba(image, [32, 41, 49, 255], [255, 255, 255, 255]);
  return new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), image.width, image.height);
}

type Props = {
  /** 描くもの。ImageData を渡してもよい（作り置きを使い回すとき） */
  source: PixelSource | ImageData | null;
  /** CSS での倍率（整数） */
  scale?: number;
  /**
   * 親の幅に収まる最大の倍率を、端末の画素で整数倍になるように選ぶ（scale より優先）。
   * 例: 幅 390・画素比 3 で幅 384 の絵 → 画素 3 倍（CSS 384px）
   */
  fit?: boolean;
  className?: string;
  label?: string;
  style?: CSSProperties;
};

export function PixelCanvas({ source, scale = 1, fit, className, label, style }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fitWidth, setFitWidth] = useState(0);
  const data = source === null ? null : source instanceof ImageData ? source : null;
  const w = source === null ? 0 : source instanceof ImageData ? source.width : source.image.width;
  const h = source === null ? 0 : source instanceof ImageData ? source.height : source.image.height;

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || source === null) return;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(data ?? toImageData(source as PixelSource), 0, 0);
  }, [source, data, w, h]);

  // fit のときは親の幅を見張る
  useEffect(() => {
    if (!fit) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const update = () => setFitWidth(parent.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [fit]);

  let cssW = w * scale;
  let cssH = h * scale;
  if (fit && fitWidth > 0 && w > 0) {
    const dpr = window.devicePixelRatio || 1;
    let k = Math.max(1, Math.floor((fitWidth * dpr) / w));
    // 小さくなりすぎるとき（画素比 2 で幅 375 など）は、1段大きくして横にはみ出すぶんはスクロールで見せる
    if ((w * k) / dpr < fitWidth * 0.6) k += 1;
    cssW = (w * k) / dpr;
    cssH = (h * k) / dpr;
  }

  return (
    <canvas
      ref={ref}
      className={`pix ${className ?? ""}`}
      style={{ width: cssW, height: cssH, ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
    />
  );
}
