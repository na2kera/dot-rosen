// ロゴ（16×16、2色）を指で描く。ペン・消しゴム・塗りつぶし・1つ戻す・全部消す、既製ロゴ12種。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createIndexed } from "../../../shared/pix/index.ts";
import { COLOR_LABELS, LOGO_SIZE, PRESET_LOGOS, stampLogo, TRAIN_PALETTE, type TrainDesign } from "../../../shared/train/index.ts";
import { floodFill, isEmpty, plot, popHistory, pushHistory, stroke, toBits, toPixels, type LogoHistory, type LogoPixels, type LogoTool } from "../../store/logo-ops.ts";
import { Button } from "../../ui/Button.tsx";
import { colorHex } from "../../ui/color.ts";
import { ColorPicker } from "../../ui/ColorPicker.tsx";
import { confirmDialog } from "../../ui/Dialog.tsx";
import { PixelCanvas } from "../../ui/PixelCanvas.tsx";
import { PixelIcon, type IconName } from "../../ui/PixelIcon.tsx";

const N = LOGO_SIZE;

const TOOLS: readonly { id: LogoTool; label: string; icon: IconName }[] = [
  { id: "pen", label: "ペン", icon: "pen" },
  { id: "eraser", label: "けしゴム", icon: "eraser" },
  { id: "fill", label: "ぬりつぶし", icon: "fill" },
];

/** #rrggbb を target に寄せた色（格子の線に使う） */
function mixHex(c: string, target: string, t: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const ch = (i: number) => Math.round(p(c, i) + (p(target, i) - p(c, i)) * t);
  return `rgb(${ch(1)},${ch(3)},${ch(5)})`;
}

function lum(c: string): number {
  const p = (i: number) => parseInt(c.slice(i, i + 2), 16);
  return 0.299 * p(1) + 0.587 * p(3) + 0.114 * p(5);
}

type Props = { train: TrainDesign; onChange(next: TrainDesign): void };

export function LogoEditor({ train, onChange }: Props) {
  const [tool, setTool] = useState<LogoTool>("pen");
  const [history, setHistory] = useState<LogoHistory>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cell, setCell] = useState(20);
  const logo = train.logo;

  // 最新の値（なぞっている間はストアを待たずに、手元の点で描く）
  const trainRef = useRef(train);
  trainRef.current = train;
  const px = useRef<LogoPixels>(toPixels(logo.bits));
  const drawing = useRef<{ id: number; last: [number, number]; value: 0 | 1 } | null>(null);
  const commitFrame = useRef(0);

  const fg = colorHex(logo.fg);
  const bg = colorHex(logo.bg);

  /** マスの大きさ: 幅いっぱいに近く、左右に指でスクロールできる余白を残す */
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setCell(Math.max(12, Math.min(22, Math.floor((el.clientWidth - 32) / N))));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paint = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const size = cell * N;
    const dev = Math.round(size * dpr);
    if (c.width !== dev) {
      c.width = dev;
      c.height = dev;
    }
    const ctx = c.getContext("2d")!;
    const k = dev / N;
    const edge = (i: number) => Math.round(i * k);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, dev, dev);
    ctx.fillStyle = fg;
    const p = px.current;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) if (p[y * N + x]) ctx.fillRect(edge(x), edge(y), edge(x + 1) - edge(x), edge(y + 1) - edge(y));
    // 格子（地の色に合わせて、少し濃く・明るく）。真ん中の線は少し強く
    const light = lum(bg) > 110;
    const line = Math.max(1, Math.round(dpr));
    for (let i = 1; i < N; i++) {
      ctx.fillStyle = mixHex(bg, light ? "#202931" : "#ffffff", i === N / 2 ? 0.45 : 0.2);
      ctx.fillRect(edge(i), 0, line, dev);
      ctx.fillRect(0, edge(i), dev, line);
    }
  }, [bg, fg, cell]);

  // 外から変わったら（既製ロゴ、ランダム、戻す）手元の点も合わせる
  useEffect(() => {
    if (drawing.current) return;
    px.current = toPixels(logo.bits);
    paint();
  }, [logo.bits, paint]);

  useLayoutEffect(paint, [paint]);

  const commitNow = useCallback(() => {
    cancelAnimationFrame(commitFrame.current);
    commitFrame.current = 0;
    const t = trainRef.current;
    const bits = toBits(px.current);
    if (bits !== t.logo.bits) onChange({ ...t, logo: { ...t.logo, bits } });
  }, [onChange]);

  /** なぞっている間は、1フレームに1回だけストアへ入れる（プレビューにすぐ反映） */
  const commitSoon = useCallback(() => {
    if (commitFrame.current) return;
    commitFrame.current = requestAnimationFrame(() => {
      commitFrame.current = 0;
      commitNow();
    });
  }, [commitNow]);

  useEffect(() => () => cancelAnimationFrame(commitFrame.current), []);

  const cellAt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * N);
    const y = Math.floor(((e.clientY - r.top) / r.height) * N);
    return [Math.min(N - 1, Math.max(0, x)), Math.min(N - 1, Math.max(0, y))];
  };

  const remember = () => setHistory((h) => pushHistory(h, toBits(px.current)));

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const [x, y] = cellAt(e);
    remember();
    if (tool === "fill") {
      const next = floodFill(px.current, x, y, 1);
      if (next !== px.current) {
        px.current = next;
        paint();
        commitNow();
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const value: 0 | 1 = tool === "pen" ? 1 : 0;
    drawing.current = { id: e.pointerId, last: [x, y], value };
    const next = plot(px.current, x, y, value);
    if (next !== px.current) {
      px.current = next;
      paint();
      commitSoon();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    let p = px.current;
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const [x, y] = cellAt(ev);
      p = stroke(p, d.last[0], d.last[1], x, y, d.value);
      d.last = [x, y];
    }
    if (p !== px.current) {
      px.current = p;
      paint();
      commitSoon();
    }
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || drawing.current.id !== e.pointerId) return;
    drawing.current = null;
    commitNow();
  };

  const undo = () => {
    const r = popHistory(history);
    if (!r) return;
    setHistory(r.history);
    px.current = toPixels(r.bits);
    paint();
    commitNow();
  };

  const setBits = (bits: string) => {
    remember();
    px.current = toPixels(bits);
    paint();
    commitNow();
  };

  const clearAll = async () => {
    if (isEmpty(px.current)) return;
    if (await confirmDialog("ロゴを ぜんぶ消しますか？", { ok: "消す", danger: true })) setBits("0".repeat(64));
  };

  const choosePreset = async (bits: string) => {
    const cur = toBits(px.current);
    if (cur === bits) return;
    const drawn = !isEmpty(px.current) && !PRESET_LOGOS.some((p) => p.bits === cur);
    if (drawn && !(await confirmDialog("描きかけのロゴを、えらんだロゴに置きかえますか？", { ok: "置きかえる" }))) return;
    setBits(bits);
  };

  const setColor = (key: "fg" | "bg", c: TrainDesign["logo"]["fg"]) => {
    const t = trainRef.current;
    onChange({ ...t, logo: { ...t.logo, [key]: c } });
  };

  return (
    <div className="logo-ed">
      <section className="opt">
        <h3 className="opt__head">ロゴを描く（16×16）</h3>
        <div className="logo-ed__tools">
          <div className="btn-group" role="radiogroup" aria-label="道具">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tool === t.id}
                className="btn btn--flat logo-ed__tool"
                onClick={() => setTool(t.id)}
              >
                <PixelIcon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="logo-ed__stage" ref={wrap}>
          <canvas
            ref={canvas}
            className="logo-ed__canvas"
            style={{ width: cell * N, height: cell * N }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onContextMenu={(e) => e.preventDefault()}
            role="img"
            aria-label="ロゴを描くマス目。指でなぞって描きます"
          />
        </div>
        <div className="logo-ed__actions">
          <Button icon="undo" onClick={undo} disabled={history.length === 0}>
            1つ戻す
          </Button>
          <Button icon="trash" onClick={clearAll}>
            ぜんぶ消す
          </Button>
        </div>
        <p className="text-weak logo-ed__note">実在の会社のロゴを そのまま使わないでください</p>
      </section>

      <section className="opt">
        <h3 className="opt__head">
          描く色<span className="opt__value">{COLOR_LABELS[logo.fg]}</span>
        </h3>
        <ColorPicker label="描く色" value={logo.fg} onChange={(c) => setColor("fg", c)} />
      </section>
      <section className="opt">
        <h3 className="opt__head">
          地の色<span className="opt__value">{COLOR_LABELS[logo.bg]}</span>
        </h3>
        <ColorPicker label="地の色" value={logo.bg} onChange={(c) => setColor("bg", c)} />
        {logo.fg === logo.bg && <p className="text-alert opt__note">描く色と地の色が同じだと、絵が見えません</p>}
      </section>

      <section className="opt">
        <h3 className="opt__head">できあいのロゴ</h3>
        <p className="text-weak opt__note">えらぶとマス目に入ります。そこから描き足せます</p>
        <PresetGrid train={train} current={logo.bits} onSelect={choosePreset} />
      </section>
    </div>
  );
}

function PresetGrid({ train, current, onSelect }: { train: TrainDesign; current: string; onSelect(bits: string): void }) {
  const { fg, bg } = train.logo;
  const images = useMemo(
    () =>
      PRESET_LOGOS.map((p) => {
        const img = createIndexed(N, N);
        stampLogo(img, { ...train, logo: { bits: p.bits, fg, bg } }, 0, 0);
        return { image: img, palette: TRAIN_PALETTE };
      }),
    // 色だけで決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fg, bg],
  );
  return (
    <div className="presets">
      {PRESET_LOGOS.map((p, i) => (
        <button key={p.id} type="button" className="thumb presets__item" aria-pressed={current === p.bits} onClick={() => onSelect(p.bits)}>
          <PixelCanvas source={images[i]} scale={3} />
          <span className="thumb__label">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
