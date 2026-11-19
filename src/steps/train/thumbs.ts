// 候補の小さな絵。表示に必要になったときに描き、キーで使い回す。
// 1フレームで描く量を区切り、色を変えたときなどに画面が固まらないようにする。
import type { IndexedImage } from "../../../shared/pix/index.ts";
import { TRAIN_PALETTE } from "../../../shared/train/index.ts";
import { toImageData } from "../../ui/PixelCanvas.tsx";

const CACHE_LIMIT = 400;
const cache = new Map<string, ImageData>();

type Job = { key: string; make: () => IndexedImage; done: (img: ImageData) => void; canceled: boolean };
const queue: Job[] = [];
let scheduled = false;

/** 1フレームで描く時間の目安（ミリ秒） */
const BUDGET_MS = 6;

function remember(key: string, img: ImageData): void {
  cache.set(key, img);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

function run(): void {
  scheduled = false;
  const t0 = performance.now();
  while (queue.length > 0 && performance.now() - t0 < BUDGET_MS) {
    const job = queue.shift()!;
    if (job.canceled) continue;
    let img = cache.get(job.key);
    if (!img) {
      img = toImageData({ image: job.make(), palette: TRAIN_PALETTE });
      remember(job.key, img);
    }
    job.done(img);
  }
  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(run);
}

/** 作り置きがあればすぐ返す */
export function cachedThumb(key: string): ImageData | null {
  const img = cache.get(key);
  if (img) {
    // 最近使ったものを後ろへ
    cache.delete(key);
    cache.set(key, img);
  }
  return img ?? null;
}

/** 描く順番待ちに入れる。戻り値を呼ぶと取り消す */
export function requestThumb(key: string, make: () => IndexedImage, done: (img: ImageData) => void): () => void {
  const job: Job = { key, make, done, canceled: false };
  queue.push(job);
  schedule();
  return () => {
    job.canceled = true;
  };
}
