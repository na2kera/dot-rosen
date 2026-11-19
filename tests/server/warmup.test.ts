// 起動時の温め（worker/lib/warmup.ts）。D1 は使わない。
import { describe, expect, it } from "vitest";
import { parseRouteData } from "../../shared/route/index.ts";
import { createRng } from "../../shared/train/index.ts";
import { WARMUP_COUNT, warmUpCard, warmupRoute } from "../../worker/lib/warmup.ts";
import { loadResources, stationIds } from "./harness.ts";

describe("起動時の温め", () => {
  it("決めた回数だけ、本番と同じ経路で描ける（3種類の側面の置き方と2種類の模様）", () => {
    const res = loadResources();
    const ids = stationIds(2000);
    for (const sideLayout of ["two-x1", "lead-x2", "two-x2-rotated"] as const) {
      for (const monoSet of ["light", "bold"] as const) {
        expect(warmUpCard(res, ids, { monoSet, sideLayout })).toBe(WARMUP_COUNT);
      }
    }
  });

  it("温めの路線は検査に通り、駅数・両数・環状がばらける", () => {
    const res = loadResources();
    const rng = createRng(1);
    const routes = Array.from({ length: 5 }, (_, i) => warmupRoute(rng, stationIds(2000), i));
    for (const r of routes) expect(parseRouteData(r, res.lookup)).toMatchObject({ ok: true });
    expect(new Set(routes.map((r) => r.stations.length))).toEqual(new Set([30, 2, 15, 7]));
    expect(routes.some((r) => r.loop)).toBe(true);
    expect(routes.map((r) => r.train.cars)).toContain(1);
  });
});
