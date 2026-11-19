// 駅名で探すシート
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../app/AppContext.tsx";
import { searchStations } from "../../data/station-index.ts";
import { Sheet } from "../../ui/Sheet.tsx";

type Props = { open: boolean; onClose(): void; onPick(id: string): void };

export function SearchSheet({ open, onClose, onPick }: Props) {
  const { data } = useApp();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchStations(data.index, q), [data.index, q]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <Sheet open={open} title="駅をさがす" onClose={onClose}>
      <div className="search">
        <label className="sr-only" htmlFor="station-search">
          駅の名前
        </label>
        <input
          id="station-search"
          ref={input}
          className="field__input"
          type="text"
          value={q}
          placeholder="駅の名前（例: 新宿、みなと）"
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
        {q.trim() !== "" && hits.length === 0 && <p className="text-weak">見つかりませんでした。漢字やかなを変えてみてね</p>}
        <ul className="search__list">
          {hits.map((h) => (
            <li key={h.station.id}>
              <button type="button" className="search__item" onClick={() => onPick(h.station.id)}>
                <span>{h.station.name}</span>
                <span className="search__detail text-weak">{h.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
