// 地図の Canvas（React の部品）。描画と操作は MapEngine が行う。
import { useEffect, useRef } from "react";
import type { Station } from "../../shared/geo/map-data.ts";
import type { Camera } from "./camera.ts";
import { MapEngine, type MapRoute, type MapTheme } from "./engine.ts";
import type { MapWorld } from "./world.ts";

/** 地図の色を CSS 変数（src/styles/tokens.css）から読む */
function readTheme(): MapTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    sea: v("--map-sea"),
    land: v("--map-land"),
    rail: v("--map-rail"),
    river: v("--map-river"),
    station: v("--map-station"),
    stationIn: v("--map-station-in"),
    wave: v("--map-wave"),
    ink: v("--c-ink"),
    mark: v("--c-panel"),
    focus: v("--c-alert"),
    labelBg: v("--map-label-bg"),
    labelInk: v("--c-ink"),
    out: v("--map-out"),
    outDot: v("--map-out-dot"),
  };
}

/** 画面を切り替えても、戻ったときに同じ場所を出す */
let lastCamera: Camera | null = null;

type Props = {
  world: MapWorld;
  stations: readonly Station[];
  route: MapRoute;
  focusId: string | null;
  anchorId: string | null;
  onStationTap(id: string): void;
  /** 地図を外から動かすための口 */
  engineRef?: { current: MapEngine | null };
  label: string;
};

export function MapView({ world, stations, route, focusId, anchorId, onStationTap, engineRef, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const tapRef = useRef(onStationTap);
  tapRef.current = onStationTap;
  const latest = useRef({ route, focusId, anchorId });
  latest.current = { route, focusId, anchorId };

  useEffect(() => {
    const e = new MapEngine(
      canvasRef.current!,
      hostRef.current!,
      world,
      stations,
      readTheme(),
      {
        onStationTap: (id) => tapRef.current(id),
        onCameraChange: (c) => (lastCamera = c),
      },
      lastCamera,
    );
    e.setRoute(latest.current.route);
    e.setFocus(latest.current.focusId);
    e.setAnchor(latest.current.anchorId);
    engine.current = e;
    if (engineRef) engineRef.current = e;
    // 開発用: ブラウザの自動操作から状態を確かめる
    if (import.meta.env.DEV) (window as unknown as { __map?: MapEngine }).__map = e;
    return () => {
      lastCamera = e.getCamera();
      e.dispose();
      engine.current = null;
      if (engineRef) engineRef.current = null;
    };
  }, [world, stations, engineRef]);

  useEffect(() => engine.current?.setRoute(route), [route]);
  useEffect(() => engine.current?.setFocus(focusId), [focusId]);
  useEffect(() => engine.current?.setAnchor(anchorId), [anchorId]);

  return (
    <div ref={hostRef} className="map">
      <canvas ref={canvasRef} className="map__canvas pix" role="img" aria-label={label} />
    </div>
  );
}
