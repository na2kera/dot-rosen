// ステップ3「電車をつくる」。上に小さなプレビュー（固定。タップで大きく見る画面）、下に選択肢（縦にスクロール）。
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  FACE_CHOICES,
  FACE_H,
  FACE_KEYS,
  FACE_PART_LABELS,
  FACE_W,
  MAX_CARS,
  MIN_CARS,
  PRESET_LOGOS,
  randomDesign,
  renderCar,
  renderConsist,
  renderFace,
  SIDE_CHOICES,
  SIDE_KEYS,
  SIDE_PART_LABELS,
  toMono,
  TRAIN_PALETTE,
  type Choice,
  type FaceDesign,
  type SideDesign,
  type TrainDesign,
} from "../../../shared/train/index.ts";
import { COLOR_LABELS } from "../../../shared/train/colors.ts";
import { useApp, useDraft } from "../../app/AppContext.tsx";
import { ViewModeTabs, type ViewMode } from "../../card/CardView.tsx";
import { useServerCardLook } from "../../card/useCard.ts";
import { Button } from "../../ui/Button.tsx";
import { ColorPicker } from "../../ui/ColorPicker.tsx";
import { PixelCanvas } from "../../ui/PixelCanvas.tsx";
import { PixelIcon } from "../../ui/PixelIcon.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { Tabs } from "../../ui/Tabs.tsx";
import { toast } from "../../ui/Toast.tsx";
import { LogoOptions } from "./LogoEditor.tsx";
import { Thumb } from "./Thumb.tsx";
import { bigFaceDevice, isTap, type Gesture } from "./preview-math.ts";
import { cropIndexed, DOORS_CROP, FACE_CROP, sideCrop } from "./thumb-crop.ts";

type Tab = "face" | "side" | "color" | "logo" | "cars";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "face", label: "かお" },
  { id: "side", label: "よこ" },
  { id: "color", label: "いろ" },
  { id: "logo", label: "ロゴ" },
  { id: "cars", label: "両数" },
];

/** ランダムの「1つ戻す」で覚えておく数 */
const UNDO_LIMIT = 30;

/** 自分で描いたロゴ（既製ロゴのどれとも違う）か */
const isCustomLogo = (bits: string) => !PRESET_LOGOS.some((p) => p.bits === bits);

/**
 * ドット絵を、端末の画素で整数倍（device 倍）になる CSS の大きさにする。
 * 画素比が整数の端末では CSS でも整数倍になる。
 */
function crisp(w: number, h: number, device: number): CSSProperties {
  const dpr = window.devicePixelRatio || 1;
  return { width: (w * device) / dpr, height: (h * device) / dpr };
}

/** CSS で n 倍に近い、端末の画素での整数倍 */
const deviceScale = (n: number) => Math.max(1, Math.round(n * (window.devicePixelRatio || 1)));

/** 画面の大きさと画素比（拡大・縮小、回転、別の画面への移動で変わる）。変わったら描き直す */
const subscribeViewport = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const viewportKey = () => `${window.devicePixelRatio}|${window.innerWidth}|${window.innerHeight}`;
const useViewport = () => useSyncExternalStore(subscribeViewport, viewportKey);

export function TrainStep() {
  const { route } = useApp();
  const train = useDraft().train;
  const [tab, setTab] = useState<Tab>("face");
  const [viewing, setViewing] = useState(false);
  const [mode, setMode] = useState<ViewMode>("color");
  /** ランダムを押す前の状態（新しいものが最後）。自分で変えたら消す */
  const [undo, setUndo] = useState<readonly TrainDesign[]>([]);
  const [rolling, setRolling] = useState(0);
  const optionsRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const change = useCallback(
    (next: TrainDesign) => {
      route.setTrain(next);
      setUndo([]);
    },
    [route],
  );

  const roll = () => {
    const cur = route.getDraft().train;
    let next = randomDesign(Math.random, cur);
    // 自分で描いたロゴは消さない
    if (isCustomLogo(cur.logo.bits)) next = { ...next, logo: cur.logo };
    route.setTrain(next);
    setUndo((u) => [...u, cur].slice(-UNDO_LIMIT));
    setRolling((n) => n + 1);
  };

  const back = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    // 両数とロゴはランダムで変えないので、今のものを残す
    const cur = route.getDraft().train;
    route.setTrain({ ...prev, cars: cur.cars, logo: isCustomLogo(cur.logo.bits) ? cur.logo : prev.logo });
    setUndo((u) => u.slice(0, -1));
  };

  const selectTab = (t: Tab) => {
    setTab(t);
    optionsRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="train" ref={rootRef}>
      <div className="train__preview">
        <TrainPreview train={train} rolling={rolling} onOpen={() => setViewing(true)} />
        <div className="train__tools">
          <Button variant="primary" className="train__dice" icon="dice" onClick={roll} data-rolling={rolling % 2}>
            ランダム
          </Button>
          <Button
            icon="undo"
            softDisabled={undo.length === 0}
            aria-label="ランダムの前に1つ戻す"
            onClick={() => (undo.length > 0 ? back() : toast("ランダムを押したあとに 1つ戻せます"))}
          >
            1つ戻す
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={selectTab} label="電車の部位" />

      <div className="train__options" ref={optionsRef} role="tabpanel">
        {tab === "face" && <FaceOptions train={train} onChange={change} />}
        {tab === "side" && <SideOptions train={train} onChange={change} />}
        {tab === "color" && <ColorOptions train={train} onChange={change} />}
        {tab === "logo" && <LogoOptions train={train} onChange={change} />}
        {tab === "cars" && <CarsOptions train={train} onChange={change} />}
      </div>

      <Sheet open={viewing} title="大きく見る" onClose={() => setViewing(false)} className="sheet--view">
        <BigView train={train} mode={mode} onMode={setMode} appRef={rootRef} />
      </Sheet>
    </div>
  );
}

// ---- プレビュー ----

/** 上の小さなプレビュー（顔と編成を横に 1 段。等倍）。タップで大きく見る画面を開く */
function TrainPreview({ train, rolling, onOpen }: { train: TrainDesign; rolling: number; onOpen(): void }) {
  useViewport();
  const face = useMemo(() => cropIndexed(renderFace(train, { track: false }), FACE_CROP), [train]);
  const consist = useMemo(() => renderConsist(train), [train]);
  const k = deviceScale(1);
  const scroller = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);

  // 右端までスクロールしたら、続きがある印（右端のぼかし）を消す。幅が変わったときも見直す
  const checkEnd = useCallback(() => {
    const el = scroller.current;
    if (el) setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);
  useEffect(checkEnd, [checkEnd, consist]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(checkEnd);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [checkEnd]);

  // タップの判定（編成を横にスクロールした指では開かない）
  const gesture = useRef<(Gesture & { id: number; x: number; y: number; down: Set<number> }) | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g && g.down.size > 0) {
      g.down.add(e.pointerId);
      g.maxPointers = Math.max(g.maxPointers, g.down.size);
      return;
    }
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, down: new Set([e.pointerId]), moved: 0, maxPointers: 1, scrolled: false, canceled: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g && g.id === e.pointerId && g.down.has(e.pointerId)) g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x, e.clientY - g.y));
  };
  const onPointerUp = (e: React.PointerEvent) => gesture.current?.down.delete(e.pointerId);
  const onPointerCancel = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    g.canceled = true;
    g.down.delete(e.pointerId);
  };
  const onScroll = () => {
    checkEnd();
    if (gesture.current) gesture.current.scrolled = true;
  };
  const onClick = (e: React.MouseEvent) => {
    const g = gesture.current;
    gesture.current = null;
    // キーボード・読み上げからの操作（detail 0）は、そのまま開く
    if (e.detail === 0 || (g !== null && isTap(g))) onOpen();
  };

  return (
    <div
      className="train__view"
      role="button"
      tabIndex={0}
      aria-label="電車を大きく見る"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="train__face" key={rolling} data-pop={rolling > 0}>
        <PixelCanvas source={{ image: face, palette: TRAIN_PALETTE }} label="正面の顔" style={crisp(face.width, face.height, k)} />
      </div>
      <div className="train__consist-wrap">
        <div className="train__consist" ref={scroller} onScroll={onScroll}>
          <PixelCanvas source={{ image: consist, palette: TRAIN_PALETTE }} label={`側面の編成 ${train.cars}両`} style={crisp(consist.width, consist.height, k)} />
        </div>
        {!atEnd && <span className="train__fade" aria-hidden="true" />}
      </div>
      <span className="train__zoom" aria-hidden="true">
        <PixelIcon name="search" />
      </span>
    </div>
  );
}

/** 大きく見る画面で、顔と編成のほかに使う高さ（シートの上の余白（見出し 2 つぶん）・シートの見出し・余白・切り替え・間） */
const BIGVIEW_CHROME = 48 * 2 + 56 + 32 + 44 + 16;

/** 大きく見る画面の中身: 顔を大きく、編成の全体を横スクロールで。カラー／印刷プレビューを切り替える */
function BigView({ train, mode, onMode, appRef }: { train: TrainDesign; mode: ViewMode; onMode(m: ViewMode): void; appRef: React.RefObject<HTMLElement | null> }) {
  useViewport();
  // 印刷プレビューの模様は、サーバーの設定（実際の印刷）に合わせる
  const { monoSet } = useServerCardLook();
  const mono = mode === "print";
  const face = useMemo(() => renderFace(train), [train]);
  const consist = useMemo(() => renderConsist(train), [train]);
  const faceSrc = useMemo(() => (mono ? { image: toMono(face, 2, monoSet) } : { image: face, palette: TRAIN_PALETTE }), [face, mono, monoSet]);
  const consistSrc = useMemo(() => (mono ? { image: toMono(consist, 1, monoSet) } : { image: consist, palette: TRAIN_PALETTE }), [consist, mono, monoSet]);

  // シートは画面全体（.app）の上に出るので、その高さから、スクロールせずに収まる顔の大きさを決める。
  // 低い画面では編成を等倍にして、顔の大きさを保つ
  const dpr = window.devicePixelRatio || 1;
  const areaH = (appRef.current?.closest(".app") as HTMLElement | null)?.clientHeight ?? window.innerHeight;
  const faceDeviceFor = (consistDevice: number) => bigFaceDevice(dpr, areaH - BIGVIEW_CHROME - (consist.height * consistDevice) / dpr, FACE_H);
  let consistDevice = deviceScale(2);
  if (faceDeviceFor(consistDevice) < 3 * dpr) consistDevice = deviceScale(1);
  const faceStyle = crisp(FACE_W, FACE_H, faceDeviceFor(consistDevice));
  const consistStyle = crisp(consist.width, consist.height, consistDevice);

  return (
    <div className="bigview" data-mono={mono}>
      <ViewModeTabs value={mode} onChange={onMode} label="電車の見え方" />
      <div className="bigview__face">
        <PixelCanvas source={faceSrc} label={mono ? "正面の顔（印刷プレビュー）" : "正面の顔"} style={faceStyle} />
      </div>
      <div className="bigview__consist">
        <PixelCanvas source={consistSrc} label={`側面の編成 ${train.cars}両${mono ? "（印刷プレビュー）" : ""}`} style={consistStyle} />
      </div>
    </div>
  );
}

// ---- 選択肢 ----

type OptionsProps = { train: TrainDesign; onChange(next: TrainDesign): void };

/** 顔の絵のキー（顔の形は、顔・色・屋根・両数で決まる） */
const faceKey = (t: TrainDesign) => `f:${JSON.stringify([t.face, t.bodyColor, t.bandColor, t.side.roof, t.cars])}`;
/** 先頭車の絵のキー（ロゴも入る）と、切り出す部位 */
const carKey = (t: TrainDesign, part: string) => `c:${part}:${JSON.stringify([t.side, t.bodyColor, t.bandColor, t.logo, t.cars])}`;

function FaceOptions({ train, onChange }: OptionsProps) {
  return (
    <>
      {FACE_KEYS.map((k) => (
        <section key={k} className="opt">
          <h3 className="opt__head">{FACE_PART_LABELS[k]}</h3>
          <div className="thumbs thumbs--grid">
            {(FACE_CHOICES[k] as readonly Choice<string>[]).map((c) => {
              const t: TrainDesign = { ...train, face: { ...train.face, [k]: c.id } as FaceDesign };
              return (
                <Thumb
                  key={c.id}
                  thumbKey={faceKey(t)}
                  make={() => cropIndexed(renderFace(t, { track: false }), FACE_CROP)}
                  width={FACE_CROP.w}
                  height={FACE_CROP.h}
                  label={c.label}
                  selected={train.face[k] === c.id}
                  onSelect={() => onChange(t)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function SideOptions({ train, onChange }: OptionsProps) {
  return (
    <>
      {SIDE_KEYS.map((k) => (
        <section key={k} className="opt">
          <h3 className="opt__head">{SIDE_PART_LABELS[k]}</h3>
          {/* ドアだけは 1 両ぶんを横長に見せ、1 列に縦に並べる（ほかは 5 列） */}
          <div className={`thumbs ${k === "doors" ? "thumbs--rows" : "thumbs--grid"}`}>
            {(SIDE_CHOICES[k] as readonly Choice<string>[]).map((c) => {
              const t: TrainDesign = { ...train, side: { ...train.side, [k]: c.id } as SideDesign };
              const r = k === "doors" ? DOORS_CROP : sideCrop(t, k);
              return (
                <Thumb
                  key={c.id}
                  thumbKey={carKey(t, k)}
                  make={() =>
                    k === "doors"
                      ? cropIndexed(renderCar(t, "middle", { panto: false, track: false }), r)
                      : cropIndexed(renderCar(t, "lead", { panto: t.side.roof !== "none", track: false }), r)
                  }
                  width={r.w}
                  height={r.h}
                  label={c.label}
                  selected={train.side[k] === c.id}
                  onSelect={() => onChange(t)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function ColorOptions({ train, onChange }: OptionsProps) {
  return (
    <>
      <section className="opt">
        <h3 className="opt__head">
          車体の色<span className="opt__value">{COLOR_LABELS[train.bodyColor]}</span>
        </h3>
        <ColorPicker label="車体の色" value={train.bodyColor} onChange={(c) => onChange({ ...train, bodyColor: c })} />
      </section>
      <section className="opt">
        <h3 className="opt__head">
          帯の色<span className="opt__value">{COLOR_LABELS[train.bandColor]}</span>
        </h3>
        <ColorPicker label="帯の色" value={train.bandColor} onChange={(c) => onChange({ ...train, bandColor: c })} />
        {train.side.band === "none" && <p className="text-weak opt__note">いまは「帯なし」です。帯は「よこ」の「帯・柄」でえらべます</p>}
      </section>
    </>
  );
}

function CarsOptions({ train, onChange }: OptionsProps) {
  const set = (n: number) => onChange({ ...train, cars: Math.min(MAX_CARS, Math.max(MIN_CARS, n)) });
  return (
    <section className="opt">
      <h3 className="opt__head">両数（{MIN_CARS}〜{MAX_CARS}両）</h3>
      <div className="cars">
        <Button icon="minus" aria-label="1両へらす" onClick={() => set(train.cars - 1)} disabled={train.cars <= MIN_CARS} />
        <output className="cars__value text-l" aria-live="polite">
          {train.cars}
          <span className="cars__unit">両</span>
        </output>
        <Button icon="plus" aria-label="1両ふやす" onClick={() => set(train.cars + 1)} disabled={train.cars >= MAX_CARS} />
      </div>
      <p className="text-weak opt__note">先頭車、同じ形の中間車、最後尾（先頭車の向きを変えたもの）で自動で組みます</p>
    </section>
  );
}
