// 絵柄の方向性を確認するための見本を作る使い捨てスクリプト
const fs = require('fs'), zlib = require('zlib'), path = require('path');

const OUT = '#1f2233';      // 輪郭線
const GLASS = '#7cc6ea';    // 窓ガラス
const SHINE = '#e9f8ff';    // 窓の反射
const LIGHT = '#fff3b0';    // 前照灯
const TAIL = '#e0483e';     // 尾灯
const DARK = '#2a2d3e';     // 黒い面
const UNDER = '#4a5064';    // 床下機器
const ROOF = '#8b93a5';     // 屋根
const RAIL = '#6b7285';
const TIE = '#9a7652';
const LED = '#ff9d2e';

const PAL = {
  white: '#f4f4f0', silver: '#b8c0cc', black: '#33384a', red: '#d9453d',
  orange: '#f08a2c', yellow: '#f2c530', lime: '#8ac43f', green: '#2f9e5b',
  sky: '#3fa9e0', blue: '#2d5fc4', purple: '#8a55c7', pink: '#e8709a',
};

class Img {
  constructor(w, h, bg = null) { this.w = w; this.h = h; this.d = new Array(w * h).fill(bg); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (this.in(x, y)) this.d[y * this.w + x] = c; }
  get(x, y) { return this.in(x, y) ? this.d[y * this.w + x] : null; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  shape(pts, fill, outline) {
    const s = new Set(pts.map(p => p[0] + ',' + p[1]));
    const has = (x, y) => s.has(x + ',' + y);
    for (const [x, y] of pts) {
      const edge = !has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1);
      this.set(x, y, edge && outline ? outline : fill);
    }
  }
  box(x, y, w, h, fill, outline, r = 0) { this.shape(rr(x, y, w, h, r), fill, outline); }
  line(x0, y0, x1, y1, c) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
    for (;;) { this.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  blit(src, dx, dy, scale = 1) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.d[y * src.w + x]; if (c == null) continue;
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) this.set(dx + x * scale + i, dy + y * scale + j, c);
    }
  }
}
function rr(x, y, w, h, r) {
  const pts = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = i < r ? r - 1 - i : (i >= w - r ? i - (w - r) : -1);
    const dy = j < r ? r - 1 - j : (j >= h - r ? j - (h - r) : -1);
    if (dx >= 0 && dy >= 0 && (dx + 0.5) ** 2 + (dy + 0.5) ** 2 > r * r) continue;
    pts.push([x + i, y + j]);
  }
  return pts;
}
const clipPts = (pts, ok) => pts.filter(([x, y]) => ok(x, y));

// ---------- 正面の顔 48x56 ----------
function face(o) {
  const W = 48, H = 56, img = new Img(W, H);
  const x0 = 6, x1 = 41, top = 8, bot = 45;
  const insetFn = {
    square: yr => (yr === 0 ? 2 : yr === 1 ? 1 : 0),
    round: yr => (yr < 8 ? Math.round(8 - Math.sqrt(64 - (8 - yr - 0.5) ** 2)) : 0),
    taper: yr => (yr < 16 ? Math.round((16 - yr) * 6 / 16) + (yr === 0 ? 1 : 0) : 0),
    dome: yr => (yr < 13 ? Math.min(13, Math.round(18 - 18 * Math.sqrt(1 - ((13 - yr - 0.5) / 13) ** 2))) : 0),
  }[o.contour];
  const body = [];
  for (let y = top; y <= bot; y++) {
    let ins = insetFn(y - top);
    if (y === bot) ins = Math.max(ins, 1);
    for (let x = x0 + ins; x <= x1 - ins; x++) body.push([x, y]);
  }
  const mask = new Set(body.map(p => p[0] + ',' + p[1]));
  const inM = (x, y) => mask.has(x + ',' + y);
  const inside = m => (x, y) => inM(x - m, y) && inM(x + m, y) && inM(x, y - m) && inM(x, y + m);

  // パンタグラフ（正面から見た弓形）
  if (o.panto) {
    img.rect(13, 1, 22, 1, OUT);
    img.line(13, 1, 12, 2, OUT); img.line(34, 1, 35, 2, OUT);
    img.line(18, 2, 21, 7, UNDER); img.line(29, 2, 26, 7, UNDER);
  }
  img.shape(body, o.color, OUT);

  // 塗り分け
  if (o.paint === 'band') {
    for (let y = 29; y <= 32; y++) for (let x = x0; x <= x1; x++) if (inside(1)(x, y)) img.set(x, y, o.bandColor);
  } else if (o.paint === 'warning') {
    for (let y = 39; y <= 44; y++) for (let x = x0; x <= x1; x++) if (inside(1)(x, y)) img.set(x, y, ((x + y) % 6 < 3) ? PAL.yellow : DARK);
  } else if (o.paint === 'blackface') {
    for (let y = top + 2; y <= top + 20; y++) for (let x = x0; x <= x1; x++) if (inside(2)(x, y)) img.set(x, y, DARK);
  }

  // 前面窓
  const wy = top + 5, wh = 13;
  const wins = {
    one: [[10, wy, 28, wh, 1]],
    two: [[10, wy, 13, wh, 1], [25, wy, 13, wh, 1]],
    three: [[10, wy, 8, wh, 1], [20, wy, 8, wh, 1], [30, wy, 8, wh, 1]],
    pano: [[9, wy - 1, 30, wh + 3, 4]],
    small: [[11, wy + 1, 9, 10, 2], [28, wy + 1, 9, 10, 2]],
  }[o.window];
  for (const [x, y, w, h, r] of wins) {
    const pts = clipPts(rr(x, y, w, h, r), inside(3));
    img.shape(pts, GLASS, OUT);
    if (w >= 8) for (let k = 0; k < 4; k++) { // 反射
      const px = x + 2 + k, py = y + 6 - k;
      if (img.get(px, py) === GLASS) img.set(px, py, SHINE);
      if (w >= 12 && k < 3 && img.get(px + 3, py + 1) === GLASS) img.set(px + 3, py + 1, SHINE);
    }
  }

  // 貫通扉
  if (o.door !== 'none') {
    const dx = o.door === 'center' ? 19 : 27;
    const pts = clipPts(rr(dx, top + 3, 10, bot - top - 3, 1), inside(1));
    const s = new Set(pts.map(p => p[0] + ',' + p[1]));
    for (const [x, y] of pts) { // 枠線だけ引き、中は元の塗りを残す
      const edge = !s.has((x - 1) + ',' + y) || !s.has((x + 1) + ',' + y) || !s.has(x + ',' + (y - 1));
      if (edge) img.set(x, y, OUT);
      else if (img.get(x, y) === GLASS || img.get(x, y) === SHINE) img.set(x, y, o.paint === 'blackface' ? DARK : o.color);
    }
    img.box(dx + 2, wy, 6, wh, GLASS, OUT);
    img.set(dx + 4, wy + 3, SHINE); img.set(dx + 5, wy + 2, SHINE);
    img.set(dx + 7, 36, OUT); // 取っ手
  }

  // 行先表示
  if (o.sign === 'top') {
    const pts = clipPts(rr(17, top + 1, 14, 4, 0), inside(1));
    img.shape(pts, DARK, OUT);
    for (let x = 19; x <= 28; x += 2) img.set(x, top + 2 + (x % 4 === 3 ? 0 : 1), LED);
  } else if (o.sign === 'inwin') {
    img.box(11, wy + 1, 11, 4, DARK, OUT);
    for (let x = 12; x <= 20; x += 2) img.set(x, wy + 2 + (x % 4 === 0 ? 0 : 1), LED);
  }

  // ライト
  const ly = { top: top + 2, mid: 34, low: 39 }[o.lightPos];
  const lx = o.lightPos === 'top' ? 9 : 9;
  const drawLight = (x, mirror) => {
    if (o.lightShape === 'round') {
      img.box(x, ly, 4, 4, LIGHT, OUT, 2); img.set(x + 1, ly + 1, LIGHT); img.set(x + 2, ly + 1, '#ffffff'); img.set(x + 1, ly + 2, LIGHT); img.set(x + 2, ly + 2, LIGHT);
      img.set(mirror ? x - 2 : x + 5, ly + 2, TAIL); img.set(mirror ? x - 2 : x + 5, ly + 1, TAIL);
    } else if (o.lightShape === 'square') {
      img.box(x - 1, ly, 6, 4, LIGHT, OUT); img.set(mirror ? x : x + 3, ly + 1, TAIL); img.set(mirror ? x : x + 3, ly + 2, TAIL);
    } else { // led
      img.box(x - 1, ly, 9, 3, LIGHT, OUT); img.set(mirror ? x : x + 6, ly + 1, TAIL);
    }
  };
  if (o.lightShape === 'led') { drawLight(lx, false); drawLight(47 - lx - 7, true); }
  else { drawLight(lx, false); drawLight(47 - lx - 3, true); }

  // 足まわり
  img.rect(13, 47, 4, 5, DARK); img.rect(31, 47, 4, 5, DARK);
  if (o.skirt === 'large') {
    const pts = []; for (let y = 46; y <= 50; y++) { const ins = y - 46; for (let x = 7 + ins; x <= 40 - ins; x++) pts.push([x, y]); }
    img.shape(pts, ROOF, OUT);
  } else if (o.skirt === 'small') {
    img.box(11, 46, 26, 4, ROOF, OUT);
  } else {
    img.rect(9, 46, 30, 2, UNDER);
  }
  img.box(21, 46, 6, 4, UNDER, OUT); // 連結器
  img.rect(2, 52, 44, 1, RAIL);
  for (let x = 4; x < 46; x += 4) img.rect(x, 53, 2, 1, TIE);
  return img;
}

// ---------- 側面 96x40 ----------
function car(o) {
  const W = 96, H = 40, img = new Img(W, H);
  const top = 10, bot = 30, xl = 1, xr = 94;
  const noseFn = {
    flat: () => 0,
    slope: yr => (yr < 11 ? Math.round((11 - yr) * 0.5) : 0),
    round: yr => (yr < 7 ? Math.round(7 - Math.sqrt(49 - (7 - yr - 0.5) ** 2)) : (yr > 17 ? Math.round((yr - 17) * 0.7) : 0)),
    stream: yr => Math.round(14 * Math.pow(1 - yr / 20, 1.6)) + (yr > 18 ? 1 : 0),
    long: yr => (yr < 15 ? Math.round(28 * Math.pow(1 - yr / 15, 0.9)) : (yr > 18 ? yr - 18 : 0)),
    bonnet: yr => (yr < 9 ? 14 : yr < 12 ? [3, 1, 0][yr - 9] : (yr > 18 ? 1 : 0)),
  }[o.lead ? o.nose : 'flat'];
  const body = []; let noseMax = 0;
  for (let y = top; y <= bot; y++) {
    const yr = y - top; const n = noseFn(yr); noseMax = Math.max(noseMax, n);
    const c = (yr === 0 || yr === bot - top) ? 1 : 0;
    for (let x = xl + n + (o.lead && n > 0 ? 0 : c); x <= xr - c; x++) body.push([x, y]);
  }
  const mask = new Set(body.map(p => p[0] + ',' + p[1]));
  const inM = (x, y) => mask.has(x + ',' + y);
  const inside = m => (x, y) => inM(x - m, y) && inM(x + m, y) && inM(x, y - m) && inM(x, y + m);

  // 屋根の機器
  if (o.roof === 'cooler') {
    img.box(30, 7, 28, 4, PAL.silver, OUT);
    for (let x = 33; x < 56; x += 3) img.set(x, 8, ROOF);
  } else if (o.roof === 'panto') {
    img.rect(58, 9, 16, 1, OUT);
    img.line(72, 8, 62, 5, OUT); img.line(62, 5, 70, 1, OUT);
    img.rect(65, 0, 11, 1, OUT);
    img.box(20, 7, 18, 4, PAL.silver, OUT);
  }
  img.shape(body, o.color, OUT);
  for (const [x, y] of body) if (y === top + 1 && inside(1)(x, y)) img.set(x, y, ROOF);

  // 帯
  if (o.band === 'one') { for (const [x, y] of body) if (y >= 23 && y <= 25 && inside(1)(x, y)) img.set(x, y, o.bandColor); }
  if (o.band === 'two') { for (const [x, y] of body) if ((y === 22 || y === 23 || y === 26 || y === 27) && inside(1)(x, y)) img.set(x, y, o.bandColor); }
  if (o.band === 'split') { for (const [x, y] of body) if (y >= 22 && inside(1)(x, y)) img.set(x, y, o.bandColor); }

  let xs = 5;
  if (o.lead) {
    // 運転台の窓と乗務員扉
    const cx = xl + noseFn(4) + 3;
    const pts = clipPts(rr(cx - 3, 13, 10, 7, 1), inside(2));
    img.shape(pts, GLASS, OUT);
    const dx = cx + 9;
    img.rect(dx, 12, 1, 18, OUT); img.rect(dx + 5, 12, 1, 18, OUT); img.rect(dx, 12, 6, 1, OUT);
    img.rect(dx + 2, 14, 2, 6, GLASS);
    xs = dx + 9;
    // 前照灯
    const ny = 26, nx = xl + noseFn(ny - top);
    img.set(nx + 1, ny, LIGHT); img.set(nx + 1, ny - 1, LIGHT);
  }
  const xe = 91;
  const n = o.doors, dw = 9, doors = [];
  for (let k = 0; k < n; k++) doors.push(Math.round(xs + (k + 0.5) * (xe - xs) / n - dw / 2));
  // 客室窓
  const edges = [xs - 3, ...doors.flatMap(d => [d, d + dw - 1]), xe + 3];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i] + 3, b = edges[i + 1] - 3; const w = b - a + 1;
    if (w < 5) continue;
    if (o.win === 'big') {
      img.box(a, 14, w, 7, GLASS, OUT);
      if (w > 12) img.rect(a + Math.floor(w / 2), 14, 1, 7, OUT);
      img.set(a + 2, 17, SHINE); img.set(a + 3, 16, SHINE);
    } else if (o.win === 'small') {
      for (let x = a; x + 4 <= b + 1; x += 6) img.box(x, 14, 5, 6, GLASS, OUT);
    } else if (o.win === 'round') {
      for (let x = a; x + 6 <= b + 1; x += 8) img.box(x, 13, 7, 7, GLASS, OUT, 3);
    }
  }
  // ドア
  for (const d of doors) {
    img.rect(d, 12, 1, 18, OUT); img.rect(d + dw - 1, 12, 1, 18, OUT); img.rect(d, 12, dw, 1, OUT);
    img.rect(d + 4, 13, 1, 17, OUT);
    img.rect(d + 1, 14, 3, 7, GLASS); img.rect(d + 5, 14, 3, 7, GLASS);
  }
  // 床下と台車
  const b1 = o.lead ? Math.max(8, Math.round(noseMax * 0.7) + 6) : 8;
  img.rect(b1 + 22, 31, 96 - 2 * 8 - 44 - (b1 - 8), 3, UNDER);
  for (const bx of [b1, 68]) {
    img.rect(bx, 31, 20, 3, DARK);
    for (const wx of [bx + 2, bx + 12]) { img.box(wx, 32, 6, 6, DARK, null, 3); img.rect(wx + 2, 34, 2, 2, ROOF); }
  }
  img.rect(xr + 1, 28, 1, 2, OUT); if (!o.lead) img.rect(0, 28, 1, 2, OUT);
  img.rect(0, 38, 96, 1, RAIL);
  for (let x = 1; x < 96; x += 4) img.rect(x, 39, 2, 1, TIE);
  return img;
}

// ---------- 印刷用の白黒変換 ----------
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const PATTERN = {
  [PAL.white]: () => 0,
  [PAL.silver]: (x, y) => (x % 4 === 0 && y % 4 === 0) || (x % 4 === 2 && y % 4 === 2),
  [PAL.yellow]: (x, y) => x % 4 === 0 && y % 2 === 0,
  [PAL.pink]: (x, y) => (x + y) % 4 === 0,
  [PAL.sky]: (x, y) => x % 2 === 0 && y % 2 === 0,
  [PAL.lime]: (x, y) => y % 3 === 0,
  [PAL.orange]: (x, y) => x % 3 === 0,
  [PAL.green]: (x, y) => (x + y) % 2 === 0,
  [PAL.red]: (x, y) => y % 2 === 0,
  [PAL.purple]: (x, y) => (x + y) % 4 < 2,
  [PAL.blue]: (x, y) => !(x % 2 === 0 && y % 2 === 0),
  [PAL.black]: (x, y) => !(x % 4 === 0 && y % 4 === 0),
  [GLASS]: () => 0, [SHINE]: () => 1, [LIGHT]: () => 0, ['#ffffff']: () => 0,
  [ROOF]: (x, y) => x % 2 === 0 && y % 2 === 0,
  [RAIL]: () => 1, [TIE]: (x, y) => (x + y) % 2 === 0, [LED]: () => 0,
};
function toMono(src, scale) { // scale 倍に拡大し、模様は印刷2ドット単位で当てる
  const out = new Img(src.w * scale, src.h * scale, null);
  for (let Y = 0; Y < out.h; Y++) for (let X = 0; X < out.w; X++) {
    const c = src.d[Math.floor(Y / scale) * src.w + Math.floor(X / scale)];
    if (c == null) continue;
    const p = PATTERN[c];
    let on;
    if (p) on = p(X >> 1, Y >> 1);
    else { const [r, g, b] = hex(c); on = (0.299 * r + 0.587 * g + 0.114 * b) < 130; }
    out.d[Y * out.w + X] = on ? '#111111' : '#ffffff';
  }
  return out;
}

// ---------- PNG ----------
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(img, bg) {
  const raw = Buffer.alloc((img.w * 3 + 1) * img.h);
  for (let y = 0; y < img.h; y++) { raw[y * (img.w * 3 + 1)] = 0; for (let x = 0; x < img.w; x++) { const [r, g, b] = hex(img.d[y * img.w + x] || bg); const o = y * (img.w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 見本の内容 ----------
const faces = [
  { contour: 'square', window: 'two', door: 'center', lightShape: 'round', lightPos: 'mid', sign: 'top', skirt: 'small', paint: 'band', color: PAL.silver, bandColor: PAL.green, panto: true },
  { contour: 'round', window: 'one', door: 'none', lightShape: 'led', lightPos: 'mid', sign: 'inwin', skirt: 'large', paint: 'blackface', color: PAL.red, bandColor: PAL.white, panto: false },
  { contour: 'taper', window: 'pano', door: 'none', lightShape: 'square', lightPos: 'low', sign: 'none', skirt: 'large', paint: 'band', color: PAL.white, bandColor: PAL.blue, panto: true },
  { contour: 'dome', window: 'small', door: 'center', lightShape: 'round', lightPos: 'mid', sign: 'none', skirt: 'none', paint: 'warning', color: PAL.orange, bandColor: PAL.yellow, panto: false },
];
const trains = [
  [{ lead: true, nose: 'slope', color: PAL.silver, band: 'one', bandColor: PAL.green, doors: 3, win: 'big', roof: 'cooler' },
   { lead: false, color: PAL.silver, band: 'one', bandColor: PAL.green, doors: 4, win: 'big', roof: 'panto' }],
  [{ lead: true, nose: 'stream', color: PAL.red, band: 'two', bandColor: PAL.white, doors: 2, win: 'small', roof: 'cooler' },
   { lead: false, color: PAL.red, band: 'two', bandColor: PAL.white, doors: 2, win: 'small', roof: 'panto' }],
  [{ lead: true, nose: 'long', color: PAL.white, band: 'one', bandColor: PAL.blue, doors: 2, win: 'small', roof: 'none' },
   { lead: false, color: PAL.white, band: 'one', bandColor: PAL.blue, doors: 2, win: 'small', roof: 'panto' }],
  [{ lead: true, nose: 'bonnet', color: PAL.orange, band: 'split', bandColor: PAL.green, doors: 2, win: 'round', roof: 'none' },
   { lead: false, color: PAL.orange, band: 'split', bandColor: PAL.green, doors: 2, win: 'round', roof: 'cooler' }],
];
const dir = __dirname;

// カラー見本
{
  const S = 5, pad = 24, fw = 48 * S, fh = 56 * S, tw = 192 * 3, th = 40 * 3;
  const sheet = new Img(pad + 2 * (tw + pad * 2), pad + fh + pad + 2 * (th + pad) + 60, '#f3ead7');
  faces.forEach((f, i) => sheet.blit(face(f), pad + 30 + i * (fw + 70), pad, S));
  trains.forEach((t, i) => {
    const x = pad + (i % 2) * (tw + pad * 2), y = pad + fh + pad + Math.floor(i / 2) * (th + pad);
    sheet.blit(car(t[0]), x, y, 3); sheet.blit(car(t[1]), x + 96 * 3, y, 3);
  });
  // パレット
  Object.values(PAL).forEach((c, i) => { sheet.rect(pad + i * 44 - 1, sheet.h - 49, 38, 30, OUT); sheet.rect(pad + i * 44, sheet.h - 48, 36, 28, c); });
  fs.writeFileSync(path.join(dir, 'sample_color.png'), png(sheet, '#f3ead7'));
}
// 印刷見本（384ドット幅の紙を2倍に拡大して2本並べる）
{
  const strips = [0, 1, 2, 3].map(i => {
    const p = new Img(384, 224 + 24 + 80 + 24 + 40, '#ffffff');
    p.blit(toMono(face(faces[i]), 4), 96, 8);
    p.blit(toMono(car(trains[i][0]), 2), 0, 224 + 24);
    p.blit(toMono(car(trains[i][1]), 2), 192, 224 + 24);
    Object.values(PAL).forEach((c, k) => { const sw = new Img(30, 26, c); const m = toMono(sw, 1); p.rect(k * 32, p.h - 34, 32, 28, '#111111'); p.blit(m, k * 32 + 1, p.h - 33); });
    return p;
  });
  const pad = 20, sheet = new Img(pad + 2 * (768 + pad), pad + 2 * (strips[0].h * 2 + pad), '#9aa0a8');
  strips.forEach((s, i) => sheet.blit(s, pad + (i % 2) * (768 + pad), pad + Math.floor(i / 2) * (s.h * 2 + pad), 2));
  fs.writeFileSync(path.join(dir, 'sample_print.png'), png(sheet, '#9aa0a8'));
}
console.log('ok');
