import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { bitToRgba, createIndexed } from "../shared/pix/index.ts";
import { ledSign } from "../shared/train/draw.ts";
import {
  C_GLASS,
  C_GLASS2,
  C_INK,
  C_LAMP,
  C_REFLECT,
  CAR_BODY_BOTTOM,
  CAR_BODY_TOP,
  CAR_H,
  CAR_W,
  carLayout,
  COLOR_IDS,
  createRng,
  decodeLogo,
  defaultDesign,
  encodeLogo,
  FACE_BODY_BOTTOM,
  FACE_BODY_TOP,
  FACE_CHOICES,
  FACE_H,
  FACE_KEYS,
  FACE_W,
  faceLayout,
  hasMonoRule,
  isLogoBits,
  maxInkRatio,
  near,
  pantographCars,
  parseTrainDesign,
  PATTERN_SETS,
  PRESET_LOGOS,
  randomDesign,
  renderCar,
  renderConsist,
  renderFace,
  SIDE_CHOICES,
  SIDE_KEYS,
  toMono,
  tones,
  usedColorIndices,
  wiperDots,
  type CarKind,
  type FaceDesign,
  type SideDesign,
  type TrainDesign,
} from "../shared/train/index.ts";

/** 候補の全組み合わせ */
function* product<K extends string>(table: Record<K, readonly { id: string }[]>, keys: K[]): Generator<Record<K, string>> {
  const idx = keys.map(() => 0);
  for (;;) {
    const o = {} as Record<K, string>;
    keys.forEach((k, i) => (o[k] = table[k][idx[i]].id));
    yield o;
    let i = keys.length - 1;
    while (i >= 0) {
      idx[i]++;
      if (idx[i] < table[keys[i]].length) break;
      idx[i] = 0;
      i--;
    }
    if (i < 0) return;
  }
}

const base = defaultDesign();
const glassCount = (data: Uint8Array) => {
  let n = 0;
  for (const c of data) if (c === C_GLASS || c === C_GLASS2 || c === C_REFLECT) n++;
  return n;
};

describe("正面の顔", () => {
  it("全 19,440 通りで、ライト・窓・はみ出しに破綻がない", () => {
    const faces = [...product(FACE_CHOICES, FACE_KEYS)];
    expect(faces.length).toBe(4 * 5 * 3 * 3 * 3 * 3 * 3 * 4);
    const errors: string[] = [];
    faces.forEach((face, n) => {
      const d: TrainDesign = { ...base, face: face as FaceDesign, bodyColor: COLOR_IDS[n % 12], bandColor: COLOR_IDS[(n + 5) % 12] };
      const name = Object.values(face).join("/");
      const img = renderFace(d);
      if (img.width !== FACE_W || img.height !== FACE_H) errors.push(`${name}: 大きさ`);
      const L = faceLayout(d);
      if (L.lamps.length !== 2) errors.push(`${name}: ライトが2つない`);
      let left = 0;
      let right = 0;
      for (let y = 0; y < FACE_H; y++) {
        for (let x = 0; x < FACE_W; x++) {
          const c = img.data[y * FACE_W + x];
          if (c === 0) continue;
          const inBody = y >= FACE_BODY_TOP && y <= FACE_BODY_BOTTOM && x >= L.bodyLeft[y] && x <= L.bodyRight[y];
          if (y >= FACE_BODY_TOP && y <= FACE_BODY_BOTTOM && !inBody) errors.push(`${name}: 車体の外 (${x},${y})`);
          if (c === C_LAMP) {
            // ライトの光は輪郭の線より内側
            if (!inBody || x <= L.bodyLeft[y] || x >= L.bodyRight[y]) errors.push(`${name}: ライトが車体の外 (${x},${y})`);
            if (x < 32) left++;
            else right++;
          }
        }
      }
      if (left === 0 || left !== right) errors.push(`${name}: ライトの点の数 ${left}/${right}`);
      const g = glassCount(img.data);
      if (g < 90) errors.push(`${name}: 窓ガラスが小さい ${g}`);
      // 部品どうしが重ならない（窓・扉・ライト・行先表示）
      for (const l of L.lamps) {
        const rim = { x: l.x - 1, y: l.y - 1, w: l.w + 2, h: l.h + 2 };
        if (L.windows.some((w) => near(rim, w)) || (L.door && near(rim, L.door))) errors.push(`${name}: ライトが窓・扉と重なる`);
        if (L.sign && near(rim, L.sign)) errors.push(`${name}: ライトが行先表示と重なる`);
      }
    });
    expect(errors.slice(0, 20)).toEqual([]);
  }, 120_000);

  it("前面窓 5 種類は、貫通扉があっても見分けられる（Issue #3）", () => {
    // 輪郭 × 扉ごとに、ほかの部位の全組み合わせで、窓のどの 2 種類を比べても違うドットが十分ある。
    // 「十分」は、見分けられている扉なしの最小（直す前に測って 95）の半分以上 = 48。
    const MIN_DIFF = 48;
    const others = [...product(FACE_CHOICES, ["lightShape", "lightPos", "sign", "skirt", "paint"])];
    const wins = FACE_CHOICES.window.map((w) => w.id);
    const mins: Record<string, number> = {};
    for (const contour of FACE_CHOICES.contour) {
      for (const door of FACE_CHOICES.door) {
        let min = Infinity;
        for (const o of others) {
          const imgs = wins.map((window) => renderFace({ ...base, face: { ...(o as Partial<FaceDesign>), contour: contour.id, door: door.id, window } as FaceDesign }).data);
          for (let i = 0; i < imgs.length; i++) {
            for (let j = i + 1; j < imgs.length; j++) {
              let n = 0;
              for (let k = 0; k < imgs[i].length; k++) if (imgs[i][k] !== imgs[j][k]) n++;
              if (n < min) min = n;
            }
          }
        }
        mins[`${contour.id}/${door.id}`] = min;
      }
    }
    const low = Object.entries(mins).filter(([, n]) => n < MIN_DIFF);
    expect(low).toEqual([]);
    // 扉なしの絵は変えていない（しきい値の元になった値）
    for (const contour of FACE_CHOICES.contour) expect(mins[`${contour.id}/none`]).toBe(95);
  }, 120_000);

  it("スカートと床下の線は、車体の下端より外にはみ出さない（角丸の下の角）", () => {
    for (const contour of FACE_CHOICES.contour) {
      for (const skirt of FACE_CHOICES.skirt) {
        const d: TrainDesign = { ...base, face: { ...base.face, contour: contour.id, skirt: skirt.id } };
        const img = renderFace(d);
        const L = faceLayout(d);
        for (const y of [62, 63]) {
          for (let x = 0; x < FACE_W; x++) {
            if (img.data[y * FACE_W + x] === 0) continue;
            expect(x >= L.bodyLeft[FACE_BODY_BOTTOM] && x <= L.bodyRight[FACE_BODY_BOTTOM], `${contour.id}/${skirt.id} (${x},${y})`).toBe(true);
          }
        }
      }
    }
  });

  it("行先表示は、描き終わったあとも全部残っている（ワイパーなどに上書きされない）", () => {
    const errors: string[] = [];
    for (const face of product(FACE_CHOICES, FACE_KEYS)) {
      if (face.sign === "none") continue;
      const d: TrainDesign = { ...base, face: face as FaceDesign };
      const L = faceLayout(d);
      if (!L.sign) continue;
      const img = renderFace(d);
      const ref = createIndexed(FACE_W, FACE_H);
      ledSign(ref, L.sign.x, L.sign.y, L.sign.w);
      let bad = 0;
      for (let y = L.sign.y; y < L.sign.y + L.sign.h; y++)
        for (let x = L.sign.x; x < L.sign.x + L.sign.w; x++) if (img.data[y * FACE_W + x] !== ref.data[y * FACE_W + x]) bad++;
      if (bad > 0) errors.push(`${Object.values(face).join("/")}: ${bad} ドット`);
    }
    expect(errors.slice(0, 20)).toEqual([]);
  }, 120_000);

  it("ワイパーのドットは、すべて窓のガラス（ゴムの縁を含む）の中にある", () => {
    const errors: string[] = [];
    for (const face of product(FACE_CHOICES, FACE_KEYS)) {
      const L = faceLayout({ ...base, face: face as FaceDesign });
      const inGlass = (x: number, y: number) => {
        const t = L.throughGlass;
        if (t && x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return true;
        return L.windows.some((r, i) => {
          if (y < r.y || y >= r.y + r.h) return false;
          const s = L.windowSpans[i];
          const [a, b] = s ? s[y - r.y] : [r.x, r.x + r.w - 1];
          return x >= a && x <= b;
        });
      };
      for (const w of L.wipers) {
        const out = wiperDots(w).find(([x, y]) => !inGlass(x, y));
        if (out) errors.push(`${Object.values(face).join("/")}: (${out[0]},${out[1]})`);
      }
    }
    expect(errors.slice(0, 20)).toEqual([]);
  }, 120_000);

  // ライトの形 3 種・輪郭 4 種も、ほかの部位の全組み合わせで、どの 2 つを比べても 48 ドット以上違う（Issue #3 の続き）
  for (const part of ["lightShape", "contour"] as const) {
    it(`${part === "lightShape" ? "ライトの形" : "輪郭"}は、どの組み合わせでも見分けられる`, () => {
      const MIN_DIFF = 48;
      const rest = FACE_KEYS.filter((k) => k !== part);
      const ids = FACE_CHOICES[part].map((c) => c.id);
      const low = new Map<string, { n: number; at: string }>();
      for (const o of product(FACE_CHOICES, rest)) {
        const imgs = ids.map((id) => renderFace({ ...base, face: { ...(o as Partial<FaceDesign>), [part]: id } as FaceDesign }).data);
        for (let i = 0; i < imgs.length; i++) {
          for (let j = i + 1; j < imgs.length; j++) {
            let n = 0;
            for (let k = 0; k < imgs[i].length; k++) if (imgs[i][k] !== imgs[j][k]) n++;
            const key = `${ids[i]}-${ids[j]}`;
            if (n < MIN_DIFF && !low.has(key)) low.set(key, { n, at: Object.values(o).join("/") });
          }
        }
      }
      expect([...low]).toEqual([]);
    }, 120_000);
  }
});

describe("側面", () => {
  it("全 1,296 通り × 先頭・中間・最後尾で、はみ出し・窓・ロゴに破綻がない", () => {
    const sides = [...product(SIDE_CHOICES, SIDE_KEYS)];
    expect(sides.length).toBe(6 * 4 * 3 * 3 * 6);
    const errors: string[] = [];
    sides.forEach((side, n) => {
      const d: TrainDesign = {
        ...base,
        side: side as SideDesign,
        bodyColor: COLOR_IDS[n % 12],
        bandColor: COLOR_IDS[(n + 7) % 12],
        logo: { bits: PRESET_LOGOS[n % 12].bits, fg: COLOR_IDS[(n + 3) % 12], bg: COLOR_IDS[(n + 9) % 12] },
      };
      const name = Object.values(side).join("/");
      for (const kind of ["lead", "middle", "tail"] as CarKind[]) {
        const img = renderCar(d, kind);
        if (img.width !== CAR_W || img.height !== CAR_H) errors.push(`${name} ${kind}: 大きさ`);
        const L = carLayout(d, kind);
        for (let y = CAR_BODY_TOP; y <= CAR_BODY_BOTTOM; y++) {
          for (let x = 0; x < CAR_W; x++) {
            const c = img.data[y * CAR_W + x];
            if (c === 0) continue;
            const gangway = (x <= 1 || x >= 190) && y >= 29 && y <= 45;
            if (!gangway && (x < L.bodyLeft[y] || x > L.bodyRight[y])) errors.push(`${name} ${kind}: 車体の外 (${x},${y})`);
          }
        }
        const g = glassCount(img.data);
        if (g < 200) errors.push(`${name} ${kind}: 窓ガラスが小さい ${g}`);
        if (kind === "middle") {
          if (L.logo) errors.push(`${name}: 中間車にロゴ`);
          continue;
        }
        const r = L.logo;
        if (!r) {
          errors.push(`${name} ${kind}: ロゴが無い`);
          continue;
        }
        // ロゴが 16×16 そのまま入っている
        const px = decodeLogo(d.logo.bits);
        const fg = tones(d.logo.fg).logoFg;
        const bg = tones(d.logo.bg).logoBg;
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16; i++) {
            if (img.data[(r.y + j) * CAR_W + r.x + i] !== (px[j * 16 + i] ? fg : bg)) {
              errors.push(`${name} ${kind}: ロゴが欠けている (${i},${j})`);
              j = 16;
              break;
            }
          }
        }
        // ドア・窓と重ならない（配置の矩形と、ロゴの有無の差分の両方で確かめる）
        const parts = [...L.doors, ...L.windows, ...(L.crewDoor ? [L.crewDoor] : []), ...(L.ribbon ? [L.ribbon] : [])];
        if (parts.some((p) => near(r, p, 1))) errors.push(`${name} ${kind}: ロゴがドア・窓と重なる`);
        if (L.cab && L.cab.spans.some(([a, b], k) => L.cab!.y + k >= r.y && L.cab!.y + k < r.y + 16 && b >= r.x - 1 && a <= r.x + 16)) errors.push(`${name} ${kind}: ロゴが運転台の窓と重なる`);
        const plain = renderCar(d, kind, { logo: false });
        let glassUnder = 0;
        for (let y = 0; y < CAR_H; y++) {
          for (let x = 0; x < CAR_W; x++) {
            const i = y * CAR_W + x;
            const inside = x >= r.x && x < r.x + 16 && y >= r.y && y < r.y + 16;
            if (!inside && plain.data[i] !== img.data[i]) errors.push(`${name} ${kind}: ロゴの外が変わった (${x},${y})`);
            if (inside && (plain.data[i] === C_GLASS || plain.data[i] === C_GLASS2)) glassUnder++;
          }
        }
        if (glassUnder > 0) errors.push(`${name} ${kind}: ロゴの下に窓ガラス`);
      }
    });
    expect(errors.slice(0, 20)).toEqual([]);
  }, 180_000);

  it("最後尾は先頭の左右反転（ロゴは反転しない）", () => {
    const d = { ...base, cars: 8 };
    const lead = renderCar(d, "lead", { logo: false, panto: false });
    const tail = renderCar(d, "tail", { logo: false, panto: false });
    for (let y = 0; y < CAR_H; y++) {
      for (let x = 0; x < CAR_W; x++) {
        // 線路は左右反転しないので、レールより上だけ比べる
        if (y >= 59) continue;
        expect(tail.data[y * CAR_W + x]).toBe(lead.data[y * CAR_W + CAR_W - 1 - x]);
      }
    }
  });

  it("編成の幅と、パンタグラフの位置", () => {
    expect(pantographCars(1)).toEqual([true]);
    expect(pantographCars(2)).toEqual([false, true]);
    expect(pantographCars(8)).toEqual([false, true, false, false, true, false, false, false]);
    for (let n = 3; n <= 16; n++) {
      const p = pantographCars(n);
      expect(p[0]).toBe(false);
      expect(p[n - 1]).toBe(false);
      expect(p.some(Boolean)).toBe(true);
    }
    for (const cars of [1, 2, 3, 16]) {
      const img = renderConsist({ ...base, cars });
      expect(img.width).toBe(CAR_W * cars);
      expect(img.height).toBe(CAR_H);
    }
    expect(renderConsist({ ...base, cars: 8 }, { limit: 2 }).width).toBe(CAR_W * 2);
  });
});

describe("決まった結果", () => {
  // 絵の変化に気づくための、全通りをまとめたハッシュ。
  // 絵を変えたら、このハッシュを更新すること。更新の前に、比較画像（pnpm sprites:sheet → node tools/run.mjs tools/issue3-sheet.ts）で
  // 変わったのが意図した組み合わせ・意図したドットだけかを確かめること。
  it("顔の全 19,440 通りと、側面の全 1,296 通り × 先頭・中間・最後尾の絵が変わっていない", () => {
    const faceHash = createHash("sha256");
    for (const face of product(FACE_CHOICES, FACE_KEYS)) faceHash.update(renderFace({ ...base, face: face as FaceDesign }).data);
    const sideHash = createHash("sha256");
    for (const side of product(SIDE_CHOICES, SIDE_KEYS)) {
      const d: TrainDesign = { ...base, side: side as SideDesign };
      for (const kind of ["lead", "middle", "tail"] as CarKind[]) sideHash.update(renderCar(d, kind).data);
    }
    expect({ face: faceHash.digest("hex"), side: sideHash.digest("hex") }).toEqual(EXPECTED_SPRITE_HASHES);
  }, 120_000);

  it("同じデザインを2回描くと同じ結果", () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const d = randomDesign(rng, { ...base, cars: 4 });
      expect(renderFace(d).data).toEqual(renderFace(d).data);
      expect(renderConsist(d).data).toEqual(renderConsist(d).data);
      for (const set of PATTERN_SETS) expect(toMono(renderFace(d), 3, set).data).toEqual(toMono(renderFace(d), 3, set).data);
    }
  });

  it("ランダムは両数を変えず、車体色と帯色が違う", () => {
    const rng = createRng(99);
    for (let i = 0; i < 500; i++) {
      const d = randomDesign(rng, { ...base, cars: 5 });
      expect(d.cars).toBe(5);
      expect(d.bodyColor).not.toBe(d.bandColor);
      expect(parseTrainDesign(d)).toEqual({ ok: true, value: d });
      expect(PRESET_LOGOS.some((l) => l.bits === d.logo.bits)).toBe(true);
    }
  });
});

/** 上の「絵が変わっていない」の期待値 */
const EXPECTED_SPRITE_HASHES = {
  face: "4546785448056f89224aae35ff8090cf9a1dafdf13a18405bab168155b4f6d82",
  side: "9c98e0d8064499ef8ef4d252e39a4ac9df5a5407be69faf2f6a94d40317d6100",
};

describe("parseTrainDesign", () => {
  it("正しい値は通り、余計なキーは捨て、16進は小文字にする", () => {
    const d = defaultDesign();
    const r = parseTrainDesign({ ...d, extra: 1, face: { ...d.face, x: 2 }, logo: { ...d.logo, bits: d.logo.bits.toUpperCase() } });
    expect(r).toEqual({ ok: true, value: d });
  });

  it("不正な値を拒否する", () => {
    const d = defaultDesign();
    const bad: [unknown, string][] = [
      [null, "invalid_train"],
      [[], "invalid_train"],
      ["x", "invalid_train"],
      [{ ...d, face: { ...d.face, window: "huge" } }, "invalid_face"],
      [{ ...d, face: { ...d.face, door: undefined } }, "invalid_face"],
      [{ ...d, face: null }, "invalid_face"],
      [{ ...d, side: { ...d.side, doors: 4 } }, "invalid_side"],
      [{ ...d, side: { ...d.side, band: "toString" } }, "invalid_side"],
      [{ ...d, bodyColor: "gold" }, "invalid_color"],
      [{ ...d, bandColor: 3 }, "invalid_color"],
      [{ ...d, cars: 0 }, "invalid_cars"],
      [{ ...d, cars: 17 }, "invalid_cars"],
      [{ ...d, cars: 2.5 }, "invalid_cars"],
      [{ ...d, cars: "8" }, "invalid_cars"],
      [{ ...d, logo: { ...d.logo, bits: "00" } }, "invalid_logo"],
      [{ ...d, logo: { ...d.logo, bits: "g".repeat(64) } }, "invalid_logo"],
      [{ ...d, logo: { ...d.logo, fg: "gold" } }, "invalid_logo"],
      [{ ...d, logo: undefined }, "invalid_logo"],
    ];
    for (const [input, error] of bad) expect(parseTrainDesign(input)).toEqual({ ok: false, error });
  });
});

describe("ロゴ", () => {
  it("既製ロゴは12種で、形式が正しく、互いに違う", () => {
    expect(PRESET_LOGOS.length).toBe(12);
    expect(new Set(PRESET_LOGOS.map((l) => l.bits)).size).toBe(12);
    for (const l of PRESET_LOGOS) {
      expect(isLogoBits(l.bits)).toBe(true);
      expect(encodeLogo(decodeLogo(l.bits))).toBe(l.bits);
    }
  });
});

describe("白黒", () => {
  it("絵に使うすべての色番号に、light と bold の規則がある", () => {
    for (const set of PATTERN_SETS) for (const i of usedColorIndices()) expect(hasMonoRule(set, i), `${set} ${i}`).toBe(true);
  });

  it("出力は白と黒の2値だけ", () => {
    const d = randomDesign(createRng(3));
    for (const set of PATTERN_SETS) {
      for (const scale of [1, 2, 3]) {
        const m = toMono(renderFace(d), scale, set);
        expect(m.width).toBe(FACE_W * scale);
        const rgba = bitToRgba(m);
        for (let i = 0; i < rgba.length; i += 4) expect(rgba[i] === 0 || rgba[i] === 255).toBe(true);
      }
    }
  });

  it("黒の割合を測れる", () => {
    const d = defaultDesign();
    const m = toMono(renderFace(d), 3, "bold");
    const r = maxInkRatio(m, 64);
    expect(r.ratio).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThanOrEqual(1);
  });

  it("12色はどの2色も bold では違う模様になる", () => {
    const seen = new Set<string>();
    for (const id of COLOR_IDS) {
      const img = { kind: "indexed" as const, width: 24, height: 24, data: new Uint8Array(24 * 24).fill(tones(id).base) };
      seen.add(Array.from(toMono(img, 1, "bold").data).join(","));
    }
    expect(seen.size).toBe(12);
  });
});

describe("白黒の変換結果", () => {
  // 印刷の点 (x, y) を "0"/"1" の行にする。幅の端数（バイトの余り）が 0 であることも確かめる
  const rowsOf = (m: ReturnType<typeof toMono>): string[] => {
    const rows: string[] = [];
    for (let y = 0; y < m.height; y++) {
      let s = "";
      for (let x = 0; x < m.stride * 8; x++) {
        const b = (m.data[y * m.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
        if (x < m.width) s += b;
        else expect(b, `余りのビット (${x},${y})`).toBe(0);
      }
      rows.push(s);
    }
    return rows;
  };
  const img = (w: number, h: number, px: number[]) => ({ kind: "indexed" as const, width: w, height: h, data: Uint8Array.from(px) });
  const RED = tones("red").base;
  const ORANGE = tones("orange").base;
  const SILVER = tones("silver").base;

  it("小さな画像を、期待するビット列そのものと比べる（light / bold、倍率 1・2・3）", () => {
    // 1行目: 黒・なし・オレンジ、2行目: 赤・赤・黒（幅 3 は 8 の倍数でない）
    const src = img(3, 2, [C_INK, 0, ORANGE, RED, RED, C_INK]);
    // 模様は印刷2ドットが1マス。bold: オレンジ = マスの x が 4 の倍数、赤 = マスの y が 4 の倍数
    // light: オレンジ = マスの x が 6 の倍数、赤 = マスの y が 5 の倍数
    const expected: Record<"light" | "bold", Record<number, string[]>> = {
      bold: {
        1: ["100", "111"],
        2: ["110000", "110000", "000011", "000011"],
        3: ["111000001", "111000001", "111000001", "000000111", "000000111", "000000111"],
      },
      light: {
        1: ["100", "111"],
        2: ["110000", "110000", "000011", "000011"],
        3: ["111000000", "111000000", "111000000", "000000111", "000000111", "000000111"],
      },
    };
    for (const set of PATTERN_SETS) {
      for (const scale of [1, 2, 3]) {
        const m = toMono(src, scale, set);
        expect([m.width, m.height, m.stride], `${set} ×${scale}`).toEqual([3 * scale, 2 * scale, Math.ceil((3 * scale) / 8)]);
        expect(rowsOf(m), `${set} ×${scale}`).toEqual(expected[set][scale]);
      }
    }
  });

  it("模様の位相は印刷の座標で決まる（縦長の帯、幅 10 と 12）", () => {
    // 10×10 の赤を倍率 2 で。bold の赤はマスの y = 0, 4, 8 の行（印刷の y = 0,1, 8,9, 16,17）が黒
    const red = toMono(img(10, 10, new Array(100).fill(RED)), 2, "bold");
    const want = Array.from({ length: 20 }, (_, y) => ((y >> 1) % 4 === 0 ? "1" : "0").repeat(20));
    expect(rowsOf(red)).toEqual(want);
    // bold のオレンジ: マスの x が 4 の倍数の列（印刷の x = 0,1, 8,9, 16,17）が黒。幅 12（4 の倍数で4ドットずつ読む経路）
    const orange = toMono(img(12, 1, new Array(12).fill(ORANGE)), 2, "bold");
    const line = Array.from({ length: 24 }, (_, x) => ((x >> 1) % 4 === 0 ? "1" : "0")).join("");
    expect(line).toBe("110000001100000011000000");
    expect(rowsOf(orange)).toEqual([line, line]);
  });

  it("色が混ざった画像を、素朴な変換と1ドットずつ比べる", () => {
    // 模様の定義（mono.ts と同じ規則を、テスト側で素朴に書いたもの）
    const rule: Record<"light" | "bold", Record<number, (cx: number, cy: number) => boolean>> = {
      bold: {
        [C_INK]: () => true,
        0: () => false,
        [C_GLASS]: () => false,
        [RED]: (_x, y) => y % 4 === 0,
        [ORANGE]: (x) => x % 4 === 0,
        [SILVER]: (x, y) => x % 3 === 0 && y % 3 === 0,
      },
      light: {
        [C_INK]: () => true,
        0: () => false,
        [C_GLASS]: () => false,
        [RED]: (_x, y) => y % 5 === 0,
        [ORANGE]: (x) => x % 6 === 0,
        [SILVER]: (x, y) => x % 6 === 0 && y % 4 === 0,
      },
    };
    const palette = [C_INK, 0, C_GLASS, RED, ORANGE, SILVER];
    const rng = createRng(7);
    for (const [w, h] of [
      [13, 11],
      [12, 7],
      [1, 1],
      [17, 3],
    ]) {
      // 同じ色が続く区間ができるよう、ときどき前の色を繰り返す
      const px: number[] = [];
      for (let i = 0; i < w * h; i++) px.push(i > 0 && rng() < 0.5 ? px[i - 1] : palette[Math.floor(rng() * palette.length)]);
      const src = img(w, h, px);
      for (const set of PATTERN_SETS) {
        for (const scale of [1, 2, 3]) {
          const want: string[] = [];
          for (let y = 0; y < h * scale; y++) {
            let s = "";
            for (let x = 0; x < w * scale; x++) {
              const c = px[Math.floor(y / scale) * w + Math.floor(x / scale)];
              s += rule[set][c](x >> 1, y >> 1) ? "1" : "0";
            }
            want.push(s);
          }
          expect(rowsOf(toMono(src, scale, set)), `${w}x${h} ${set} ×${scale}`).toEqual(want);
        }
      }
    }
  });
});
