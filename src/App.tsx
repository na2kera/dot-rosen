// 動作確認用の画面（土台の確認だけ。作り込みはあとのタスクで行う）。
import { useEffect, useRef, useState } from "react";
import { ATTRIBUTION_LINES } from "../shared/attribution.ts";
import { BITMAP_FONT_PATH, drawText, measureText, parseBitmapFont, type BitmapFont } from "../shared/font/index.ts";
import { decodeMap, MAP_PATH, STATIONS_PATH, type BBox, type MapData, type MapFile, type StationsFile } from "../shared/geo/map-data.ts";
import { renderMap, viewAspect } from "../shared/geo/render-map.ts";
import { createIndexed, indexedToRgba, type IndexedImage, type Palette } from "../shared/pix/index.ts";

/** 確認用の配色（色番号 → RGBA） */
const PALETTE: Palette = [
  [168, 200, 224, 255], // 0 海
  [244, 238, 220, 255], // 1 陸
  [176, 176, 176, 255], // 2 線路
  [96, 144, 208, 255], // 3 川
  [208, 56, 48, 255], // 4 駅
  [255, 252, 242, 255], // 5 文字の地
  [40, 40, 48, 255], // 6 文字
];

/** 地図の表示範囲（1都3県が収まる固定の範囲） */
const VIEW: BBox = [138.95, 34.88, 140.9, 36.3];
const MAP_W = 320;
const MAP_H = Math.round(MAP_W / viewAspect(VIEW));

const SAMPLE_NAMES = ["新宿", "御茶ノ水", "東京", "横浜", "大宮", "千葉", "霞ヶ関", "高輪ゲートウェイ"];

type Loaded = { map: MapData; stations: StationsFile; font: BitmapFont };

async function loadAll(): Promise<Loaded> {
  const [mapRes, stRes, fontRes] = await Promise.all([fetch(MAP_PATH), fetch(STATIONS_PATH), fetch(BITMAP_FONT_PATH)]);
  if (!mapRes.ok || !stRes.ok || !fontRes.ok) throw new Error("データを読み込めませんでした");
  return {
    map: decodeMap((await mapRes.json()) as MapFile),
    stations: (await stRes.json()) as StationsFile,
    font: parseBitmapFont(await fontRes.arrayBuffer()),
  };
}

/** 色番号画像を canvas にそのまま（1ドット = 1px）描く。拡大は CSS で行う */
function PixCanvas({ image, label }: { image: IndexedImage | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !image) return;
    cv.width = image.width;
    cv.height = image.height;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const rgba = indexedToRgba(image, PALETTE);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), image.width, image.height), 0, 0);
  }, [image]);
  return <canvas ref={ref} className="pix" aria-label={label} role="img" />;
}

export function App() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  let mapImage: IndexedImage | null = null;
  let textImage: IndexedImage | null = null;
  if (data) {
    mapImage = createIndexed(MAP_W, MAP_H, 0);
    renderMap(mapImage, data.map, data.stations.stations, VIEW, { land: 1, rail: 2, river: 3, station: 4 });

    // 点データの文字を 2 倍で描く
    const scale = 2;
    const pad = 4;
    const lineH = data.font.height * scale + pad;
    const w = Math.max(...SAMPLE_NAMES.map((n) => measureText(n, scale, { font: data.font }))) + pad * 2;
    textImage = createIndexed(w, lineH * SAMPLE_NAMES.length + pad, 5);
    SAMPLE_NAMES.forEach((name, i) => drawText(textImage!, pad, pad + i * lineH, name, scale, { font: data.font, color: 6 }));
  }

  return (
    <div className="page">
      <header className="board">
        <h1>ドット路線メーカー</h1>
      </header>
      <main>
        <p className="note">土台の動作確認用の画面です。</p>
        {error && <p className="error">{error}</p>}
        {!data && !error && <p>読み込み中…</p>}
        {data && (
          <>
            <section>
              <h2>地図（{data.stations.stations.length} 駅）</h2>
              <PixCanvas image={mapImage} label="首都圏の駅と線路の地図" />
            </section>
            <section>
              <h2>点データの文字（2倍）</h2>
              <div className="text-sample">
                <PixCanvas image={textImage} label={SAMPLE_NAMES.join("、")} />
              </div>
            </section>
          </>
        )}
      </main>
      <footer className="attribution">
        {ATTRIBUTION_LINES.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </footer>
    </div>
  );
}
