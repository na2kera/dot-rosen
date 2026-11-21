// ロゴのタブ: 既製ロゴ12種（と「じぶんの」）を選ぶ。「じぶんで描く」で、描くための画面（下からせり上がるシート）を開く。
// 描く画面では 16×16 の2色のロゴを指で描く（ペン・けしゴム・ぬりつぶし・1つ戻す・ぜんぶ消す）。
// 描いている途中の絵は「できた」を押すまで電車（作りかけの保存）に入れない。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createIndexed } from "../../../shared/pix/index.ts";
import { carLayout, COLOR_LABELS, LOGO_SIZE, PRESET_LOGOS, renderCar, stampLogo, TRAIN_PALETTE, type TrainDesign } from "../../../shared/train/index.ts";
import { useApp } from "../../app/AppContext.tsx";
import { onExternalStorageChange } from "../../store/browser.ts";
import { STORAGE_KEYS } from "../../store/kv-storage.ts";
import { floodFill, isEmpty, plot, popHistory, pushHistory, stroke, toBits, toPixels, type LogoHistory, type LogoPixels, type LogoTool } from "../../store/logo-ops.ts";
import { adoptMyLogo, beginDraw, cancelDraw, finishDraw, logoSelection, readMyLogo, type DrawSession } from "../../store/my-logo.ts";
import { Button } from "../../ui/Button.tsx";
import { colorHex } from "../../ui/color.ts";
import { ColorPicker } from "../../ui/ColorPicker.tsx";
import { confirmDialog } from "../../ui/Dialog.tsx";
import { PixelCanvas } from "../../ui/PixelCanvas.tsx";
import { PixelIcon, type IconName } from "../../ui/PixelIcon.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { CardLabel } from "./label-break.tsx";
import { cropIndexed } from "./thumb-crop.ts";

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

/** ロゴのタブの中身 */
export function LogoOptions({ train, onChange }: Props) {
  const { storage } = useApp();
  const logo = train.logo;
  // じぶんの: 端末に覚えたもの。未登録で、いまのロゴが既製と違う絵なら、それを引き継ぐ
  const [mine, setMine] = useState<string | null>(() => adoptMyLogo(storage, logo.bits));
  /** 描く画面を開いている間の記録（開いた時点のロゴと下絵） */
  const [drawing, setDrawing] = useState<DrawSession | null>(null);
  const selected = logoSelection(logo.bits, mine);

  const trainRef = useRef(train);
  trainRef.current = train;
  const setBits = (bits: string) => {
    const t = trainRef.current;
    if (t.logo.bits !== bits) onChange({ ...t, logo: { ...t.logo, bits } });
  };
  // 別のタブで「じぶんの」が変わったら、一覧に入れる
  useEffect(
    () =>
      onExternalStorageChange((key) => {
        if (key === null || key === STORAGE_KEYS.myLogo) setMine(readMyLogo(storage));
      }),
    [storage],
  );

  /** 「じぶんで描く」: 端末のじぶんのを読み直してから開く（別のタブで変わっていても、その続きから） */
  const openDraw = () => {
    const m = readMyLogo(storage) ?? mine;
    setMine(m);
    setDrawing(beginDraw(m, trainRef.current.logo.bits));
  };

  const setColor = (key: "fg" | "bg", c: TrainDesign["logo"]["fg"]) => {
    const t = trainRef.current;
    onChange({ ...t, logo: { ...t.logo, [key]: c } });
  };

  return (
    <div className="logo-tab">
      {/* 見出しは置かない（タブが「ロゴ」。低い画面でも「じぶんで描く」まで見えるように） */}
      <section className="opt" aria-label="ロゴをえらぶ">
        <PresetGrid train={train} mine={mine} selected={selected} onSelect={setBits} />
        <div className="logo-tab__draw">
          <Button icon="pen" block onClick={openDraw}>
            じぶんで描く
          </Button>
        </div>
        <p className="text-weak logo-tab__note">実在の会社のロゴを そのまま使わないでください</p>
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

      {drawing && (
        <DrawSheet
          train={train}
          startBits={drawing.start}
          onDone={(bits) => {
            // 描いている間に別のタブでじぶんのが変わっても、いま描いた絵で上書きする
            const r = finishDraw(storage, bits);
            setMine(r.mine);
            setBits(r.bits);
            setDrawing(null);
          }}
          onCancel={() => {
            // 開いた時点のロゴに戻す（描いている間は電車に入れていない）
            setBits(cancelDraw(drawing));
            setDrawing(null);
          }}
        />
      )}
    </div>
  );
}

/** 既製ロゴ12種。じぶんのがあれば先頭に出す */
function PresetGrid({ train, mine, selected, onSelect }: { train: TrainDesign; mine: string | null; selected: string | null; onSelect(bits: string): void }) {
  const { fg, bg } = train.logo;
  const items = useMemo(() => {
    const list = [...(mine ? [{ id: "mine", label: "じぶんのロゴ", bits: mine }] : []), ...PRESET_LOGOS];
    return list.map((p) => {
      const img = createIndexed(N, N);
      stampLogo(img, { ...train, logo: { bits: p.bits, fg, bg } }, 0, 0);
      return { ...p, source: { image: img, palette: TRAIN_PALETTE } };
    });
    // 色とじぶんのだけで決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fg, bg, mine]);
  return (
    <div className="presets">
      {items.map((p) => (
        <button key={p.id} type="button" className="thumb presets__item" aria-pressed={selected === p.id} onClick={() => onSelect(p.bits)}>
          <PixelCanvas source={p.source} scale={3} />
          <CardLabel text={p.label} />
        </button>
      ))}
    </div>
  );
}

// ---- 描く画面 ----

type DrawProps = {
  train: TrainDesign;
  /** 下絵 */
  startBits: string;
  onDone(bits: string): void;
  onCancel(): void;
};

function DrawSheet({ train, startBits, onDone, onCancel }: DrawProps) {
  const [tool, setTool] = useState<LogoTool>("pen");
  const [history, setHistory] = useState<LogoHistory>([]);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cell, setCell] = useState(16);
  /** 電車に付けたときの見え方に使う、いまの絵（なぞっている間は 1 フレームに 1 回だけ更新） */
  const [bits, setBitsState] = useState(startBits);

  const px = useRef<LogoPixels>(toPixels(startBits));
  const drawing = useRef<{ id: number; last: [number, number]; value: 0 | 1 } | null>(null);
  const frame = useRef(0);

  const fg = colorHex(train.logo.fg);
  const bg = colorHex(train.logo.bg);

  /** マスの大きさ: 描く場所に収まる最大の整数（スクロールせずに全部が見えるように、高さも見る） */
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const update = () => setCell(Math.max(8, Math.min(24, Math.floor((Math.min(el.clientWidth, el.clientHeight) - 4) / N))));
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

  useLayoutEffect(paint, [paint]);

  const syncNow = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setBitsState(toBits(px.current));
  }, []);
  const syncSoon = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setBitsState(toBits(px.current));
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

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
        syncNow();
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
      syncSoon();
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
      syncSoon();
    }
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || drawing.current.id !== e.pointerId) return;
    drawing.current = null;
    syncNow();
  };

  const undo = () => {
    const r = popHistory(history);
    if (!r) return;
    setHistory(r.history);
    px.current = toPixels(r.bits);
    paint();
    syncNow();
  };

  const clearAll = async () => {
    if (isEmpty(px.current)) return;
    if (!(await confirmDialog("ロゴを ぜんぶ消しますか？", { ok: "消す", danger: true }))) return;
    remember();
    px.current = toPixels("0".repeat(64));
    paint();
    syncNow();
  };

  return (
    <Sheet
      open
      title="じぶんで描く"
      onClose={onCancel}
      closeButton={false}
      className="sheet--draw"
      headExtra={
        <>
          <Button variant="primary" onClick={onCancel}>
            やめる
          </Button>
          <Button icon="check" onClick={() => onDone(toBits(px.current))}>
            できた
          </Button>
        </>
      }
    >
      <div className="draw">
        <div className="btn-group draw__tools" role="radiogroup" aria-label="道具">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={tool === t.id} className="btn btn--flat draw__tool" onClick={() => setTool(t.id)}>
              <PixelIcon name={t.icon} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="draw__stage" ref={stage}>
          <canvas
            ref={canvas}
            className="draw__canvas"
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
        <div className="draw__foot">
          <div className="draw__actions">
            <Button icon="undo" onClick={undo} disabled={history.length === 0}>
              1つ戻す
            </Button>
            <Button icon="trash" onClick={clearAll}>
              ぜんぶ消す
            </Button>
          </div>
          <OnTrain train={train} bits={bits} />
        </div>
      </div>
    </Sheet>
  );
}

/** 電車に付けたときの見え方（先頭車の側面の、ロゴのあたり。等倍） */
function OnTrain({ train, bits }: { train: TrainDesign; bits: string }) {
  const source = useMemo(() => {
    const t = { ...train, logo: { ...train.logo, bits } };
    const L = carLayout(t, "lead", t.side.roof !== "none");
    const lx = L.logo ? L.logo.x : 24;
    const img = renderCar(t, "lead", { panto: t.side.roof !== "none", track: false });
    return { image: cropIndexed(img, { x: Math.max(0, lx - 36), y: 20, w: 88, h: 40 }), palette: TRAIN_PALETTE };
  }, [train, bits]);
  return (
    <div className="draw__ontrain">
      <PixelCanvas source={source} label="電車に付けたときの見え方" />
    </div>
  );
}
