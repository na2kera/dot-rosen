// 地図の Canvas を描き、指・マウスの操作を受ける（DOM を使う部分）。
// 地図は粗い解像度（1ドット = MAP_DOT_PX）で色番号画像に描き、補間なしで拡大して貼る。
// 駅名などの文字だけは画面の解像度で上に重ねる。
import type { Station } from "../../shared/geo/map-data.ts";
import { createIndexed, fillRect, type IndexedImage } from "../../shared/pix/index.ts";
import { clampCamera, fitZ, lerpCamera, originOf, panBy, zoomAround, type Camera, type CameraLimits } from "./camera.ts";
import * as cfg from "./config.ts";
import { hitTest, LABEL_SPACE, placeLabels, type LabelCandidate } from "./hit.ts";
import { MC, renderStatic } from "./raster.ts";
import { toWorldX, toWorldY, type MapWorld } from "./world.ts";

/** 地図の色（CSS の色。#rrggbb） */
export type MapTheme = {
  sea: string;
  land: string;
  rail: string;
  river: string;
  station: string;
  stationIn: string;
  wave: string;
  ink: string;
  mark: string;
  focus: string;
  labelBg: string;
  labelInk: string;
  out: string;
  outDot: string;
};

export type MapRoute = {
  readonly ids: readonly string[];
  readonly loop: boolean;
  /** ラインカラー（#rrggbb） */
  readonly color: string;
  /** 駅ナンバリング（ids と同じ順） */
  readonly numbers: readonly string[];
  /** 駅ナンバリングの文字の色（#rrggbb） */
  readonly numberInk: string;
};

export type MapCallbacks = {
  onStationTap(id: string): void;
  onCameraChange?(c: Camera): void;
};

type Gesture = {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  t0: number;
  moved: boolean;
  multi: boolean;
  pinch: { cam: Camera; midX: number; midY: number; dist: number } | null;
};

const STATIC_MARGIN = 48;
const LABEL_FONT_PX = 16;
const LABEL_PAD = 2;
const LABEL_H = LABEL_FONT_PX + LABEL_PAD * 2;

function hexToU32(hex: string): number {
  const h = hex.trim().replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // ImageData は RGBA の順。リトルエンディアンの Uint32 では ABGR になる
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** 太い線（正方形の筆）。主な向きに1ドットずつ進み、見えている範囲だけを描く */
function thickLine(img: IndexedImage, x0: number, y0: number, x1: number, y1: number, size: number, color: number): void {
  const h = (size - 1) >> 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const W = img.width;
  const H = img.height;
  if (dx === 0 && dy === 0) {
    fillRect(img, x0 - h, y0 - h, size, size, color);
    return;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    const lo = Math.max(Math.min(x0, x1), -size);
    const hi = Math.min(Math.max(x0, x1), W + size);
    for (let x = lo; x <= hi; x++) {
      const y = Math.round(y0 + ((x - x0) * dy) / dx);
      if (y < -size || y > H + size) continue;
      fillRect(img, x - h, y - h, size, size, color);
    }
  } else {
    const lo = Math.max(Math.min(y0, y1), -size);
    const hi = Math.min(Math.max(y0, y1), H + size);
    for (let y = lo; y <= hi; y++) {
      const x = Math.round(x0 + ((y - y0) * dx) / dy);
      if (x < -size || x > W + size) continue;
      fillRect(img, x - h, y - h, size, size, color);
    }
  }
}

function strokeRect(img: IndexedImage, x: number, y: number, w: number, h: number, t: number, color: number): void {
  fillRect(img, x, y, w, t, color);
  fillRect(img, x, y + h - t, w, t, color);
  fillRect(img, x, y, t, h, color);
  fillRect(img, x + w - t, y, t, h, color);
}

export class MapEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly low: HTMLCanvasElement;
  private readonly lowCtx: CanvasRenderingContext2D;
  private readonly lut = new Uint32Array(256);
  private readonly limits: CameraLimits;
  private cam: Camera;

  private dpr = 1;
  /** 地図の1ドットの端末上の画素数 */
  private s = 2;
  private cssW = 0;
  private cssH = 0;
  /** 地図のドットでの大きさ */
  private vw = 0;
  private vh = 0;
  private frame: IndexedImage = createIndexed(1, 1);
  private imageData: ImageData | null = null;
  private u32: Uint32Array = new Uint32Array(1);
  private cache: { img: IndexedImage; bx: number; by: number; z: number } | null = null;

  private route: MapRoute = { ids: [], loop: false, color: "#d9453d", numbers: [], numberInk: "#ffffff" };
  private routeIdx: number[] = [];
  private focusIdx = -1;
  private anchorIdx = -1;
  private pulse: { idx: number; start: number } | null = null;
  private tween: { from: Camera; to: Camera; start: number; dur: number } | null = null;
  private zooming = false;

  private raf = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private lastTap: { t: number; x: number; y: number } | null = null;
  private readonly labelWidths = new Map<string, number>();
  private readonly ro: ResizeObserver;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private readonly world: MapWorld,
    private readonly stations: readonly Station[],
    private readonly theme: MapTheme,
    private readonly cb: MapCallbacks,
    initial: Camera | null,
  ) {
    const ctx = canvas.getContext("2d");
    this.low = document.createElement("canvas");
    const lowCtx = this.low.getContext("2d");
    if (!ctx || !lowCtx) throw new Error("Canvas が使えません");
    this.ctx = ctx;
    this.lowCtx = lowCtx;
    this.setTheme(theme);
    this.limits = this.computeLimits();
    this.measure();
    this.cam = clampCamera(initial ?? this.initialCamera(), this.limits);

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.ro = new ResizeObserver(() => {
      this.measure();
      this.requestRender();
    });
    this.ro.observe(host);
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
    c.removeEventListener("wheel", this.onWheel);
  }

  // ---- 外から変えるもの ----

  setTheme(t: MapTheme): void {
    const set = (i: number, c: string) => (this.lut[i] = hexToU32(c));
    set(MC.SEA, t.sea);
    set(MC.LAND, t.land);
    set(MC.RAIL, t.rail);
    set(MC.RIVER, t.river);
    set(MC.STATION, t.station);
    set(MC.STATION_IN, t.stationIn);
    set(MC.WAVE, t.wave);
    set(MC.INK, t.ink);
    set(MC.MARK, t.mark);
    set(MC.FOCUS, t.focus);
    set(MC.OUT, t.out);
    set(MC.OUT_DOT, t.outDot);
    this.requestRender();
  }

  setRoute(route: MapRoute): void {
    this.route = route;
    this.routeIdx = route.ids.map((id) => this.indexOf(id)).filter((i) => i >= 0);
    this.lut[MC.LINE] = hexToU32(route.color);
    this.requestRender();
  }

  /** 検索で選んだ駅などを点滅で示す（null で消す） */
  setFocus(id: string | null): void {
    this.focusIdx = id ? this.indexOf(id) : -1;
    this.requestRender();
  }

  /** 「この駅の次に追加」の基準の駅 */
  setAnchor(id: string | null): void {
    this.anchorIdx = id ? this.indexOf(id) : -1;
    this.requestRender();
  }

  /** 駅を加えたときの短い効果 */
  pulseStation(id: string): void {
    const idx = this.indexOf(id);
    if (idx < 0) return;
    this.pulse = { idx, start: performance.now() };
    this.requestRender();
  }

  /** 駅へ動かす（見えていて十分に拡大していれば、そのまま） */
  flyTo(id: string, minZ = 9000): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    const z = Math.min(this.limits.maxZ, Math.max(this.cam.z, minZ));
    this.animateTo({ cx: this.world.stationX[i], cy: this.world.stationY[i], z }, 420);
  }

  getCamera(): Camera {
    return this.cam;
  }

  /** 駅の画面上の位置（地図の左上からの CSS px）。確かめ用 */
  stationScreenPos(id: string): { x: number; y: number } | null {
    const i = this.indexOf(id);
    if (i < 0) return null;
    const { ox, oy } = originOf(this.cam, { w: this.vw, h: this.vh });
    const k = this.cssPerDot;
    return { x: (this.dotX(this.world.stationX[i], ox) + 0.5) * k, y: (this.dotY(this.world.stationY[i], oy) + 0.5) * k };
  }

  /** 直近の描画にかかった時間（ミリ秒）。確かめ用 */
  readonly renderTimes: number[] = [];

  // ---- 内部 ----

  private indexOf(id: string): number {
    for (let i = 0; i < this.stations.length; i++) if (this.stations[i].id === id) return i;
    return -1;
  }

  private computeLimits(): CameraLimits {
    const xs = this.world.stationX;
    const ys = this.world.stationY;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      minX = Math.min(minX, xs[i]);
      maxX = Math.max(maxX, xs[i]);
      minY = Math.min(minY, ys[i]);
      maxY = Math.max(maxY, ys[i]);
    }
    // 一番近い駅どうしの間隔（x で並べて近いものだけ比べる）
    const order = Array.from(xs.keys()).sort((a, b) => xs[a] - xs[b]);
    let minSep = Infinity;
    for (let a = 0; a < order.length; a++) {
      for (let b = a + 1; b < order.length; b++) {
        const dx = xs[order[b]] - xs[order[a]];
        if (dx >= minSep) break;
        const d = Math.hypot(dx, ys[order[b]] - ys[order[a]]);
        if (d > 0 && d < minSep) minSep = d;
      }
    }
    // 一番近い駅どうしでも区別して押せるまで拡大できるようにする（ドット = px / MAP_DOT_PX）
    const maxZ = (cfg.DENSE_TARGET_PX / cfg.MAP_DOT_PX) / minSep;
    return { minX, minY, maxX, maxY, minZ: 1, maxZ };
  }

  /** 1都3県の全体が入る拡大度を下限にする（画面の大きさで変わる） */
  private updateMinZ(): void {
    const l = this.limits as { minZ: number; minX: number; maxX: number; minY: number; maxY: number };
    const w = l.maxX - l.minX;
    const h = l.maxY - l.minY;
    l.minZ = Math.min(this.vw / w, this.vh / h) * 0.92;
  }

  private initialCamera(): Camera {
    const v = cfg.INITIAL_VIEW;
    const z = fitZ({ w: this.vw, h: this.vh }, v.minLon, v.minLat, v.maxLon, v.maxLat);
    return { cx: toWorldX((v.minLon + v.maxLon) / 2), cy: toWorldY((v.minLat + v.maxLat) / 2), z };
  }

  private measure(): void {
    const r = this.host.getBoundingClientRect();
    this.cssW = Math.max(1, Math.floor(r.width));
    this.cssH = Math.max(1, Math.floor(r.height));
    this.dpr = window.devicePixelRatio || 1;
    this.s = Math.max(1, Math.round(cfg.MAP_DOT_PX * this.dpr));
    const pw = Math.round(this.cssW * this.dpr);
    const ph = Math.round(this.cssH * this.dpr);
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.vw = Math.ceil(pw / this.s);
    this.vh = Math.ceil(ph / this.s);
    if (this.frame.width !== this.vw || this.frame.height !== this.vh) {
      this.frame = createIndexed(this.vw, this.vh);
      this.imageData = new ImageData(this.vw, this.vh);
      this.u32 = new Uint32Array(this.imageData.data.buffer);
      this.low.width = this.vw;
      this.low.height = this.vh;
      this.cache = null;
    }
    this.updateMinZ();
    if (this.cam) this.cam = clampCamera(this.cam, this.limits);
  }

  /** 1ドットが何 CSS px か */
  private get cssPerDot(): number {
    return this.s / this.dpr;
  }

  private setCamera(c: Camera): void {
    this.cam = clampCamera(c, this.limits);
    this.cb.onCameraChange?.(this.cam);
    this.requestRender();
  }

  private animateTo(to: Camera, dur: number): void {
    this.tween = { from: this.cam, to: clampCamera(to, this.limits), start: performance.now(), dur };
    this.requestRender();
  }

  requestRender(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(this.onFrame);
  }

  private readonly onFrame = (now: number): void => {
    this.raf = 0;
    let again = false;
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.dur);
      const e = 1 - (1 - t) * (1 - t);
      this.cam = clampCamera(lerpCamera(this.tween.from, this.tween.to, e), this.limits);
      this.zooming = this.tween.from.z !== this.tween.to.z && t < 1;
      if (t >= 1) {
        this.tween = null;
        this.cb.onCameraChange?.(this.cam);
      } else again = true;
    }
    if (this.pulse && now - this.pulse.start > cfg.PULSE_MS) this.pulse = null;
    if (this.pulse || this.focusIdx >= 0 || this.anchorIdx >= 0) again = true;
    const t0 = performance.now();
    this.render(now);
    this.renderTimes.push(performance.now() - t0);
    if (this.renderTimes.length > 600) this.renderTimes.splice(0, 300);
    if (again) this.requestRender();
  };

  /** 世界座標 → 地図のドット（整数。原点が整数なので、移動しても形が変わらない） */
  private dotX(x: number, ox: number): number {
    return Math.floor(x * this.cam.z) - ox;
  }

  private dotY(y: number, oy: number): number {
    return Math.floor(y * this.cam.z) - oy;
  }

  private ensureStatic(ox: number, oy: number): IndexedImage {
    const { vw, vh } = this;
    const z = this.cam.z;
    const c = this.cache;
    if (c && c.z === z && ox >= c.bx && oy >= c.by && ox + vw <= c.bx + c.img.width && oy + vh <= c.by + c.img.height) return c.img;
    // 拡大・縮小の途中は余白なしで描く（次に止まったときに余白つきで描き直す）
    const m = this.zooming ? 0 : STATIC_MARGIN;
    const w = vw + m * 2;
    const h = vh + m * 2;
    const img = c && c.img.width === w && c.img.height === h ? c.img : createIndexed(w, h);
    const bx = ox - m;
    const by = oy - m;
    renderStatic(img, this.world, { ox: bx, oy: by, z });
    this.cache = { img, bx, by, z };
    return img;
  }

  private render(now: number): void {
    if (!this.imageData) return;
    const { vw, vh, frame } = this;
    const { ox, oy } = originOf(this.cam, { w: vw, h: vh });
    const st = this.ensureStatic(ox, oy);
    const c = this.cache!;
    for (let y = 0; y < vh; y++) {
      const src = (y + oy - c.by) * st.width + (ox - c.bx);
      frame.data.set(st.data.subarray(src, src + vw), y * vw);
    }
    this.drawRoute(frame, ox, oy, now);

    const d = frame.data;
    const u = this.u32;
    const lut = this.lut;
    for (let i = 0; i < d.length; i++) u[i] = lut[d[i]];
    this.lowCtx.putImageData(this.imageData, 0, 0);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.low, 0, 0, vw * this.s, vh * this.s);
    this.drawLabels(ox, oy);
  }

  private drawRoute(img: IndexedImage, ox: number, oy: number, now: number): void {
    const { stationX: xs, stationY: ys } = this.world;
    const idx = this.routeIdx;
    const pts = idx.map((i) => [this.dotX(xs[i], ox), this.dotY(ys[i], oy)] as const);
    const segs: [number, number][] = [];
    for (let k = 1; k < pts.length; k++) segs.push([k - 1, k]);
    if (this.route.loop && pts.length >= 3) segs.push([pts.length - 1, 0]);
    const lw = cfg.ROUTE_LINE_DOTS;
    const ew = lw + cfg.ROUTE_EDGE_DOTS * 2;
    for (const [a, b] of segs) thickLine(img, pts[a][0], pts[a][1], pts[b][0], pts[b][1], ew, MC.INK);
    for (const [a, b] of segs) thickLine(img, pts[a][0], pts[a][1], pts[b][0], pts[b][1], lw, MC.LINE);

    // 駅の印
    pts.forEach(([x, y], k) => {
      let r = 3;
      if (this.pulse && this.pulse.idx === idx[k]) {
        const t = (now - this.pulse.start) / cfg.PULSE_MS;
        r = t < 0.5 ? 5 : 4;
      }
      fillRect(img, x - r, y - r, r * 2 + 1, r * 2 + 1, MC.INK);
      fillRect(img, x - r + 1, y - r + 1, r * 2 - 1, r * 2 - 1, MC.MARK);
      if (k === 0) fillRect(img, x - 1, y - 1, 3, 3, MC.LINE);
    });

    // 点滅する枠（検索で選んだ駅、途中に加える基準の駅）
    const blinkOn = Math.floor(now / 280) % 2 === 0;
    for (const [i, color] of [
      [this.focusIdx, MC.FOCUS],
      [this.anchorIdx, MC.FOCUS],
    ] as const) {
      if (i < 0) continue;
      const x = this.dotX(xs[i], ox);
      const y = this.dotY(ys[i], oy);
      const r = blinkOn ? 7 : 6;
      strokeRect(img, x - r, y - r, r * 2 + 1, r * 2 + 1, 2, color);
    }
  }

  private textWidth(text: string): number {
    let w = this.labelWidths.get(text);
    if (w === undefined) {
      const ctx = this.ctx;
      ctx.font = `${LABEL_FONT_PX}px DotGothic16`;
      w = Math.ceil(ctx.measureText(text).width);
      this.labelWidths.set(text, w);
    }
    return w;
  }

  private drawLabels(ox: number, oy: number): void {
    const { stationX: xs, stationY: ys } = this.world;
    const k = this.cssPerDot;
    const css = (i: number): [number, number] => [(this.dotX(xs[i], ox) + 0.5) * k, (this.dotY(ys[i], oy) + 0.5) * k];
    type Key = { i: number; text: string; kind: "number" | "name" | "route-name" };
    const cands: LabelCandidate<Key>[] = [];
    const blocked: { x: number; y: number; w: number; h: number }[] = [];
    const inView = (x: number, y: number) => x > -40 && y > -40 && x < this.cssW + 40 && y < this.cssH + 40;
    const mark = 4 * k;
    // 自分の路線: 駅ナンバリング（必ず先に置く）と駅名
    this.routeIdx.forEach((i, n) => {
      const [x, y] = css(i);
      if (!inView(x, y)) return;
      blocked.push({ x: x - mark, y: y - mark, w: mark * 2, h: mark * 2 });
      const num = this.route.numbers[n] ?? "";
      cands.push({ key: { i, text: num, kind: "number" }, x, y, w: this.textWidth(num) + LABEL_PAD * 2, h: LABEL_H });
    });
    const showNames = this.cam.z >= cfg.LABEL_MIN_Z;
    if (showNames) {
      const inRoute = new Set(this.routeIdx);
      for (const i of this.routeIdx) {
        const [x, y] = css(i);
        if (!inView(x, y)) continue;
        const t = this.stations[i].name;
        cands.push({ key: { i, text: t, kind: "route-name" }, x, y, w: this.textWidth(t) + LABEL_PAD * 2, h: LABEL_H });
      }
      const others: { i: number; x: number; y: number; p: number }[] = [];
      for (let i = 0; i < xs.length; i++) {
        if (inRoute.has(i)) continue;
        const [x, y] = css(i);
        if (x < 0 || y < 0 || x > this.cssW || y > this.cssH) continue;
        // 引き気味のときは、乗り入れ路線の多い駅だけ名前を出す
        if (this.cam.z < cfg.LABEL_ALL_Z && this.stations[i].lines.length < 2 && i !== this.focusIdx) continue;
        others.push({ i, x, y, p: (i === this.focusIdx ? 100 : 0) + this.stations[i].lines.length });
      }
      others.sort((a, b) => b.p - a.p);
      for (const o of others) {
        const t = this.stations[o.i].name;
        cands.push({ key: { i: o.i, text: t, kind: "name" }, x: o.x, y: o.y, w: this.textWidth(t) + LABEL_PAD * 2, h: LABEL_H });
      }
    }
    const placed = placeLabels(cands, { w: this.cssW, h: this.cssH }, mark + LABEL_SPACE + 2, blocked);
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${LABEL_FONT_PX}px DotGothic16`;
    ctx.textBaseline = "top";
    for (const p of placed) {
      const isNum = p.key.kind === "number";
      ctx.fillStyle = isNum ? this.route.color : this.theme.labelBg;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      if (isNum || p.key.kind === "route-name") {
        ctx.strokeStyle = this.theme.ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - 1, p.y - 1, p.w + 2, p.h + 2);
      }
      ctx.fillStyle = isNum ? this.route.numberInk : this.theme.labelInk;
      ctx.fillText(p.key.text, p.x + LABEL_PAD, p.y + LABEL_PAD);
    }
  }

  // ---- 操作 ----

  private pos(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    this.tween = null;
    if (this.pointers.size === 1) {
      this.gesture = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, t0: performance.now(), moved: false, multi: false, pinch: null };
    } else if (this.gesture) {
      this.gesture.multi = true;
      this.startPinch();
    }
  };

  private startPinch(): void {
    const g = this.gesture;
    if (!g) return;
    const [a, b] = [...this.pointers.values()];
    g.pinch = { cam: this.cam, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    this.zooming = true;
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    const k = this.cssPerDot;
    if (this.pointers.size >= 2 && g.pinch) {
      const [a, b] = [...this.pointers.values()];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const pc = g.pinch;
      const vp = { w: this.vw, h: this.vh };
      const z = Math.min(this.limits.maxZ, Math.max(this.limits.minZ, pc.cam.z * (dist / pc.dist)));
      const c = zoomAround(pc.cam, vp, z, pc.midX / k, pc.midY / k);
      this.zooming = true;
      this.setCamera(panBy(c, (midX - pc.midX) / k, (midY - pc.midY) / k));
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > cfg.TAP_SLOP_PX) g.moved = true;
    if (g.moved) {
      this.setCamera(panBy(this.cam, (p.x - g.lastX) / k, (p.y - g.lastY) / k));
      g.lastX = p.x;
      g.lastY = p.y;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.pos(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (this.pointers.size === 1) {
      // 2本指から1本指に戻ったら、残った指で移動を続ける
      const [rest] = [...this.pointers.values()];
      g.pinch = null;
      g.lastX = rest.x;
      g.lastY = rest.y;
      g.moved = true;
      this.zooming = false;
      this.requestRender();
      return;
    }
    if (this.pointers.size > 0) {
      this.startPinch();
      return;
    }
    this.gesture = null;
    this.zooming = false;
    this.requestRender();
    if (!g.moved && !g.multi && performance.now() - g.t0 < 600) this.handleTap(p.x, p.y);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.gesture = null;
      this.zooming = false;
      this.requestRender();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const f = Math.exp(-e.deltaY * unit * 0.0018);
    const k = this.cssPerDot;
    const z = Math.min(this.limits.maxZ, Math.max(this.limits.minZ, this.cam.z * f));
    this.tween = null;
    this.zooming = true;
    this.setCamera(zoomAround(this.cam, { w: this.vw, h: this.vh }, z, (e.clientX - r.left) / k, (e.clientY - r.top) / k));
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      this.zooming = false;
      this.requestRender();
    }, 150);
  };
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;

  /** 点 (x, y)（CSS px）を中心に factor 倍に拡大する */
  zoomAt(x: number, y: number, factor: number, dur = 200): void {
    const k = this.cssPerDot;
    const z = Math.min(this.limits.maxZ, this.cam.z * factor);
    this.animateTo(zoomAround(this.cam, { w: this.vw, h: this.vh }, z, x / k, y / k), dur);
  }

  private handleTap(x: number, y: number): void {
    const now = performance.now();
    const last = this.lastTap;
    if (last && now - last.t < cfg.DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < cfg.DOUBLE_TAP_PX) {
      this.lastTap = null;
      this.zoomAt(x, y, 2);
      return;
    }
    this.lastTap = { t: now, x, y };

    const { ox, oy } = originOf(this.cam, { w: this.vw, h: this.vh });
    const k = this.cssPerDot;
    const near: { x: number; y: number }[] = [];
    const nearIdx: number[] = [];
    const reach = cfg.HIT_RADIUS_PX + cfg.DENSE_SEP_PX + 4;
    const { stationX: xs, stationY: ys } = this.world;
    for (let i = 0; i < xs.length; i++) {
      const sx = (this.dotX(xs[i], ox) + 0.5) * k;
      const sy = (this.dotY(ys[i], oy) + 0.5) * k;
      if (Math.abs(sx - x) > reach || Math.abs(sy - y) > reach) continue;
      near.push({ x: sx, y: sy });
      nearIdx.push(i);
    }
    const atMax = this.cam.z >= this.limits.maxZ * 0.98;
    const hit = hitTest(near, { x, y }, { radius: cfg.HIT_RADIUS_PX, denseSep: cfg.DENSE_SEP_PX, margin: cfg.AMBIGUOUS_PX, atMaxZoom: atMax });
    if (hit.kind === "none") return;
    if (hit.kind === "dense") {
      const f = Math.min(8, Math.max(2, cfg.DENSE_TARGET_PX / Math.max(1, hit.sep)));
      const p = near[hit.index];
      this.zoomAt(p.x, p.y, f, 260);
      this.lastTap = null;
      return;
    }
    this.cb.onStationTap(this.stations[nearIdx[hit.index]].id);
  }
}
