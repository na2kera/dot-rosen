import { Button } from "./Button.tsx";

type Props = {
  /** 0〜1 */
  progress: number;
  error?: string | null;
  onRetry?(): void;
};

const CELLS = 10;

/** ドット絵らしい読み込み表示（四角が順に埋まる）。失敗したら再試行ボタン */
export function Loading({ progress, error, onRetry }: Props) {
  const on = Math.floor(progress * CELLS);
  return (
    <div className="loading" role={error ? "alert" : "status"}>
      {error ? (
        <>
          <p>{error}</p>
          <Button variant="primary" onClick={onRetry}>
            もういちど よみこむ
          </Button>
        </>
      ) : (
        <>
          <div className="loading__bar" aria-hidden="true">
            {Array.from({ length: CELLS }, (_, i) => (
              <span key={i} className="loading__cell" data-on={i < on} data-blink={i === on} />
            ))}
          </div>
          <p>よみこみ中…</p>
        </>
      )}
    </div>
  );
}
