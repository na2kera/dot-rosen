// ステップ3「電車をつくる」。上にプレビュー（固定）、下に選択肢（縦にスクロール）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CAR_H,
  CAR_W,
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
import { Button } from "../../ui/Button.tsx";
import { ColorPicker } from "../../ui/ColorPicker.tsx";
import { PixelCanvas } from "../../ui/PixelCanvas.tsx";
import { PixelIcon } from "../../ui/PixelIcon.tsx";
import { Tabs } from "../../ui/Tabs.tsx";
import { toast } from "../../ui/Toast.tsx";
import { LogoEditor } from "./LogoEditor.tsx";
import { Thumb } from "./Thumb.tsx";

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

/** 画面の高さが低い端末では、編成を等倍で見せる */
function useConsistScale(): number {
  const get = () => (window.innerHeight >= 720 ? 2 : 1);
  const [s, setS] = useState(get);
  useEffect(() => {
    const on = () => setS(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

/** 自分で描いたロゴ（既製ロゴのどれとも違う）か */
const isCustomLogo = (bits: string) => !PRESET_LOGOS.some((p) => p.bits === bits);

export function TrainStep() {
  const { route } = useApp();
  const train = useDraft().train;
  const [tab, setTab] = useState<Tab>("face");
  const [mono, setMono] = useState(false);
  /** ランダムを押す前の状態（新しいものが最後）。自分で変えたら消す */
  const [undo, setUndo] = useState<readonly TrainDesign[]>([]);
  const [rolling, setRolling] = useState(0);
  const optionsRef = useRef<HTMLDivElement>(null);

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
    <div className="train">
      <TrainPreview train={train} mono={mono} rolling={rolling}>
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
        <label className="toggle">
          <input type="checkbox" checked={mono} onChange={(e) => setMono(e.target.checked)} />
          <span className="toggle__box" aria-hidden="true">
            <PixelIcon name="check" />
          </span>
          <span>印刷プレビュー</span>
        </label>
      </TrainPreview>

      <Tabs tabs={TABS} value={tab} onChange={selectTab} label="電車の部位" />

      <div className="train__options" ref={optionsRef} role="tabpanel">
        {tab === "face" && <FaceOptions train={train} onChange={change} />}
        {tab === "side" && <SideOptions train={train} onChange={change} />}
        {tab === "color" && <ColorOptions train={train} onChange={change} />}
        {tab === "logo" && <LogoEditor train={train} onChange={change} />}
        {tab === "cars" && <CarsOptions train={train} onChange={change} />}
      </div>
    </div>
  );
}

// ---- プレビュー ----

function TrainPreview({ train, mono, rolling, children }: { train: TrainDesign; mono: boolean; rolling: number; children: React.ReactNode }) {
  const consistScale = useConsistScale();
  const face = useMemo(() => renderFace(train), [train]);
  const consist = useMemo(() => renderConsist(train), [train]);
  const faceSrc = useMemo(() => (mono ? { image: toMono(face, 2) } : { image: face, palette: TRAIN_PALETTE }), [face, mono]);
  const consistSrc = useMemo(() => (mono ? { image: toMono(consist, 1) } : { image: consist, palette: TRAIN_PALETTE }), [consist, mono]);

  return (
    <div className="train__preview" data-mono={mono}>
      <div className="train__top">
        <div className="train__face" key={rolling} data-pop={rolling > 0}>
          <PixelCanvas source={faceSrc} scale={mono ? 1 : 2} label="正面の顔" />
        </div>
        <div className="train__tools">{children}</div>
      </div>
      <div className="train__consist" tabIndex={0} aria-label={`${train.cars}両編成（横にスクロールできます）`}>
        <PixelCanvas source={consistSrc} scale={consistScale} label={`側面の編成 ${train.cars}両`} />
      </div>
      <p className="train__cars-note text-weak">
        {train.cars}両編成{train.cars > 2 ? " ・ 横にスクロールできます" : ""}
      </p>
    </div>
  );
}

// ---- 選択肢 ----

type OptionsProps = { train: TrainDesign; onChange(next: TrainDesign): void };

/** 顔の絵のキー（顔の形は、顔・色・屋根・両数で決まる） */
const faceKey = (t: TrainDesign) => `f:${JSON.stringify([t.face, t.bodyColor, t.bandColor, t.side.roof, t.cars])}`;
/** 先頭車の絵のキー（ロゴも入る） */
const carKey = (t: TrainDesign) => `c:${JSON.stringify([t.side, t.bodyColor, t.bandColor, t.logo, t.cars])}`;

function FaceOptions({ train, onChange }: OptionsProps) {
  return (
    <>
      {FACE_KEYS.map((k) => (
        <section key={k} className="opt">
          <h3 className="opt__head">{FACE_PART_LABELS[k]}</h3>
          <div className="thumbs thumbs--face">
            {(FACE_CHOICES[k] as readonly Choice<string>[]).map((c) => {
              const t: TrainDesign = { ...train, face: { ...train.face, [k]: c.id } as FaceDesign };
              return (
                <Thumb
                  key={c.id}
                  thumbKey={faceKey(t)}
                  make={() => renderFace(t, { track: false })}
                  width={FACE_W}
                  height={FACE_H}
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
          <div className="thumbs thumbs--side">
            {(SIDE_CHOICES[k] as readonly Choice<string>[]).map((c) => {
              const t: TrainDesign = { ...train, side: { ...train.side, [k]: c.id } as SideDesign };
              return (
                <Thumb
                  key={c.id}
                  thumbKey={carKey(t)}
                  make={() => renderCar(t, "lead", { panto: t.side.roof !== "none", track: false })}
                  width={CAR_W}
                  height={CAR_H}
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
