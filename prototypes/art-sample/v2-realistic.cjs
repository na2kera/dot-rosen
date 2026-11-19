// Original Japanese train studies. Node 20+, CommonJS, no dependencies.
// Raster primitives and PNG encoder adapted from v1-simple.cjs.
'use strict';
const fs = require('node:fs'), zlib = require('node:zlib'), path = require('node:path');
const hex = c => [1,3,5].map(i => parseInt(c.slice(i,i+2),16));
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


const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(img, bg) {
  const raw = Buffer.alloc((img.w * 3 + 1) * img.h);
  for (let y = 0; y < img.h; y++) { raw[y * (img.w * 3 + 1)] = 0; for (let x = 0; x < img.w; x++) { const [r, g, b] = hex(img.d[y * img.w + x] || bg); const o = y * (img.w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}


// All body materials retain their palette identity, including computed tones.
const PAL = {
  white: '#f4f4f0', silver: '#b8c0cc', black: '#33384a', red: '#d9453d',
  orange: '#f08a2c', yellow: '#f2c530', lime: '#8ac43f', green: '#2f9e5b',
  sky: '#3fa9e0', blue: '#2d5fc4', purple: '#8a55c7', pink: '#e8709a',
};
const INK = '#202931', FRAME = '#344750', GLASS = '#466978', GLASS2 = '#77959e';
const REFLECT = '#bed2d5', INTERIOR = '#30434d', METAL = '#89949c';
const METAL_LIGHT = '#d4d9d9', METAL_DARK = '#606d77', WHITE = '#ffffff';
const LAMP = '#fff1be', TAIL = '#ce4d48', LED = '#f9b55b';
const colorFamily = new Map();
const edgeColors = new Set();
function edge(c) {
  const e=mix(c, "#091824", .48);
  edgeColors.add(e);
  return e;
}
const EDGE_METAL = "#485761";
edgeColors.add(EDGE_METAL);
const mix = (c, target, amount) => '#' + hex(c).map((n,i) => Math.round(n + (hex(target)[i]-n)*amount).toString(16).padStart(2,'0')).join('');
const tones = {};
for (const [name, base] of Object.entries(PAL)) {
  const t = { light: mix(base, '#ffffff', .28), base, dark: mix(base, '#17252c', .27) };
  tones[base] = t;
  for (const c of Object.values(t)) colorFamily.set(c, name);
}
const shade = c => tones[c] || { light: METAL_LIGHT, base: c, dark: METAL_DARK };

// Scan-converted polygons; every vertex and line stays on the integer grid.
function poly(img, vertices, fill, edge) {
  const ys = vertices.map(p=>p[1]), pts=[];
  for (let y=Math.min(...ys); y<=Math.max(...ys); y++) {
    for (let x=Math.min(...vertices.map(p=>p[0])); x<=Math.max(...vertices.map(p=>p[0])); x++) {
      let inside=false;
      for (let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
        const [a,b]=vertices[i], [c,d]=vertices[j];
        if ((b>y)!==(d>y) && x < (c-a)*(y-b)/(d-b)+a) inside=!inside;
      }
      if (inside) pts.push([x,y]);
    }
  }
  img.shape(pts,fill,null);
  if(edge) vertices.forEach((p,i)=>img.line(...p,...vertices[(i+1)%vertices.length],edge));
}
function glass(img,x,y,w,h,round=0) {
  if(w<3||h<3) return;
  img.box(x,y,w,h,GLASS,INK,round);
  for(let j=1;j<h-1;j++) for(let i=1;i<w-1;i++) {
    if(img.get(x+i,y+j)!==GLASS) continue;
    img.set(x+i,y+j,j<3?INTERIOR:(j>h-4?GLASS2:GLASS));
    if(i+j===Math.floor(w*.6)) img.set(x+i,y+j,REFLECT);
  }
  if(h>9) img.line(x+2,y+h-3,x+w-3,y+h-3,GLASS2);
}
function lamp(img,x,y,w=6,h=4,round=false) {
  // White rim survives every body pattern in the print renderer.
  img.box(x-1,y-1,w+2,h+2,WHITE,null,round?2:0);
  img.box(x,y,w,h,METAL_LIGHT,INK,round?2:0);
  img.rect(x+1,y+1,w-2,h-2,LAMP);
  img.set(x+w-2,y+1,WHITE);
}
function ledSign(img,x,y,w=17) {
  img.box(x,y,w,5,INTERIOR,METAL_DARK);
  for(let i=2;i<w-2;i+=3) {
    img.set(x+i,y+1,LED); img.set(x+i,y+2,LED);
    img.set(x+i+1,y+3,LED);
  }
}
function panto(img,x,y) {
  img.rect(x-9,y+13,20,2,METAL_DARK);
  for(const a of [x-6,x+7]) {
    img.rect(a,y+10,3,3,METAL_LIGHT);
    img.line(a-1,y+11,a+3,y+11,METAL_DARK);
  }
  img.line(x+6,y+10,x-5,y+6,INK);
  img.line(x-5,y+6,x+5,y+1,INK);
  img.line(x+5,y+1,x+9,y+1,METAL_LIGHT);
  img.line(x-3,y,x+14,y,INK);
  img.line(x-3,y,x-5,y+1,INK);
  img.line(x+14,y,x+16,y+1,INK);
}
function track(img,y) {
  // Sparse ballast; no random calls, so generated samples are reproducible.
  for(let x=0;x<img.w;x++) {
    if(x%3===0) img.set(x,y+3,METAL_LIGHT);
    if(x%7===2) img.set(x,y+4,METAL);
  }
  for(let x=2;x<img.w;x+=9) img.rect(x,y+1,5,2,METAL_DARK);
  img.rect(0,y,img.w,1,METAL_LIGHT);
  img.rect(0,y+1,img.w,1,INK);
}

// FRONT: 64 x 76. Rail-to-roof 56 dots; 46-dot body width.
function face(o) {
  const img=new Img(64,76), t=shade(o.color), bt=shade(o.bandColor);
  const inset={
    square:y=>y<2?2-y:0,
    round:y=>y<9?Math.max(0,Math.round(9-Math.sqrt(81-(8-y)**2))):0,
    taper:y=>y<21?Math.round((21-y)*.28):0,
    dome:y=>y<13?Math.max(0,Math.round(16-16*Math.sqrt(1-((12-y)/13)**2))):0,
  }[o.contour];
  const pts=[];
  for(let y=14;y<=61;y++) {
    const n=Math.max(inset(y-14),y>58?Math.floor((y-58)/2):0);
    for(let x=9+n;x<=54-n;x++) pts.push([x,y]);
  }
  const mask=new Set(pts.map(p=>p.join(',')));
  const inside=(x,y,m=1)=>mask.has(`${x-m},${y}`)&&mask.has(`${x+m},${y}`)&&mask.has(`${x},${y-m}`)&&mask.has(`${x},${y+m}`);
  if(o.panto) panto(img,31,0);
  img.shape(pts,t.base,edge(t.base));
  for(const [x,y] of pts) {
    if(!inside(x,y)) continue;
    if(y<19) img.set(x,y,y<17?METAL_DARK:METAL);
    else if(x<13||x>50) img.set(x,y,t.dark);
    else if(x<17||y===19) img.set(x,y,t.light);
    else if(y>57) img.set(x,y,t.dark);
    if(o.paint==='band'&&y>=42&&y<=46) img.set(x,y,y===42?bt.light:bt.base);
    if(o.paint==='blackface'&&y>=20&&y<=41) img.set(x,y,INTERIOR);
    if(o.paint==='warning'&&y>=53&&y<=58) img.set(x,y,((x+y)%10<3)?bt.dark:bt.base);
  }
  // Curved roof and side edge highlight, separate from the rubber seals.
  img.line(18,17,45,17,METAL_LIGHT);
  if(o.color===PAL.silver) for(let y=48;y<58;y+=3) {
    img.line(14,y,49,y,t.light); img.line(14,y+1,49,y+1,t.dark);
  }
  if(o.paint==='band') img.line(11,47,52,47,edge(t.base));
  const layouts={
    one:[[15,24,34,16]], two:[[14,24,17,16],[33,24,17,16]],
    three:[[14,24,10,16],[26,24,12,16],[40,24,10,16]],
    pano:[[17,24,30,16]], small:[[16,26,12,13],[36,26,12,13]],
  };
  for(const [x,y,w,h] of layouts[o.window]) glass(img,x,y,w,h,o.window==='pano'?3:1);
  if(o.door!=='none') {
    const dx=o.door==='center'?26:37;
    img.box(dx,21,12,40,t.base,edge(t.base),1);
    img.line(dx+1,23,dx+1,58,t.light);
    if(o.paint==='band') img.rect(dx+1,42,10,5,bt.base);
    glass(img,dx+2,25,8,15,1);
    img.line(dx+8,48,dx+10,48,INK);
    img.set(dx+8,49,METAL_LIGHT);
    img.line(dx+3,53,dx+7,53,t.light);
    // Gangway step, hinges, handrails and receptacle.
    for(const yy of [30,51]) img.rect(dx,yy,2,2,METAL_DARK);
    img.box(dx-1,59,14,3,METAL,INK);
    for(const xx of [dx-4,dx+15]) {
      img.line(xx,43,xx,55,METAL_LIGHT);
      img.set(xx,43,INK); img.set(xx,55,INK);
    }
  }
  if(o.sign==='top') ledSign(img,23,19,18);
  if(o.sign==='inwin') ledSign(img,18,25,17);
  // Windshield wipers angle out of the lower rubber seal.
  for(const x of [19,42]) {
    img.line(x,38,x+4,32,INK);
    img.line(x+2,33,x+5,31,FRAME);
    img.set(x-1,39,METAL_LIGHT);
  }
  // A shallow nose panel, with curved shoulders on the high-speed face.
  if(o.contour==='taper') {
    img.line(18,49,45,49,t.light);
    img.line(18,50,14,53,t.light); img.line(45,50,49,53,t.dark);
    img.line(29,57,34,57,t.dark);
    img.set(31,58,t.light);
  }
  const ly={top:20,mid:49,low:54}[o.lightPos];
  const lw=o.lightShape==='led'?10:6, lh=o.lightShape==='led'?3:5;
  const lx=o.lightShape==='led'?13:14;
  for(const x of [lx,64-lx-lw]) {
    lamp(img,x,ly,lw,lh,o.lightShape==='round');
    img.box(x+(x<32?lw+2:-4),ly+1,3,3,TAIL,WHITE,1);
  }
  // Small builder plate and maintenance hatch.
  img.box(17,56,6,2,METAL_LIGHT,t.dark);
  img.line(43,57,48,57,t.dark);
  img.rect(17,63,5,6,INTERIOR); img.rect(42,63,5,6,INTERIOR);
  if(o.skirt!=='none') {
    const h=o.skirt==='large'?7:4;
    poly(img,[[12,62],[51,62],[48,62+h],[15,62+h]],METAL,EDGE_METAL);
    img.line(15,63,48,63,METAL_LIGHT);
    for(const x of [18,44]) img.rect(x,65,2,2,INK);
  } else {
    img.line(12,63,51,63,INK);
    img.line(22,64,20,68,METAL_DARK); img.line(43,64,45,68,METAL_DARK);
  }
  img.box(28,63,8,5,METAL_DARK,INK,1);
  img.rect(30,64,4,2,METAL_LIGHT);
  img.box(23,62,3,3,METAL,INK,1); img.box(39,62,3,3,METAL,INK,1);
  track(img,70);
  return img;
}

// SIDE: one 20 m envelope = 192 dots. Rail 59, roof 24, floor 48.
// Bogie centres 29/162 (~13.8 m), axle spacing 20 (~2.1 m), wheels 8 (~.86 m).
function car(o) {
  const img=new Img(192,64),t=shade(o.color),bt=shade(o.bandColor);
  const noseFn={
    flat:y=>0,
    slope:y=>y<13?Math.round((13-y)*.55):0,
    round:y=>y<9?Math.max(0,Math.round(10-Math.sqrt(100-(9-y)**2))):y>21?y-21:0,
    stream:y=>Math.max(0,Math.round(27*Math.pow(1-y/25,1.7))),
    long:y=>y<19?Math.round(52*Math.pow(1-y/19,1.05)):y>22?y-22:0,
    bonnet:y=>y<12?23:y<17?[18,11,5,1,0][y-12]:y>22?y-22:0,
  }[o.lead?o.nose:'flat'];
  const pts=[];
  for(let y=24;y<=48;y++) {
    const n=noseFn(y-24),c=y===24||y===48?1:0;
    for(let x=2+n+c;x<=189-c;x++) pts.push([x,y]);
  }
  const mask=new Set(pts.map(p=>p.join(',')));
  const inside=(x,y)=>mask.has(`${x-1},${y}`)&&mask.has(`${x+1},${y}`)&&mask.has(`${x},${y-1}`)&&mask.has(`${x},${y+1}`);
  img.shape(pts,t.base,edge(t.base));
  for(const [x,y] of pts) {
    if(!inside(x,y)) continue;
    if(y===25) img.set(x,y,METAL_DARK);
    if(y===26) img.set(x,y,METAL);
    if(y===27||y===28) img.set(x,y,t.light);
    if(y>=45) img.set(x,y,t.dark);
    if(y===47) img.set(x,y,t.light);
    let band=o.band==='one'&&y>=40&&y<=42 || o.band==='two'&&(y===40||y===41||y===44) || o.band==='split'&&y>=40;
    if(band) img.set(x,y,y===40?bt.light:y===47?bt.dark:bt.base);
    if(y===43&&o.band==='one') img.set(x,y,t.dark);
    if(o.color===PAL.silver&&y>43&&y<47) img.set(x,y,y%2?t.light:t.dark);
  }
  // Body rub strip and roof curvature run continuously into the cab shape.
  img.line(Math.max(4,noseFn(3)+3),26,187,26,METAL_LIGHT);
  img.line(Math.max(4,noseFn(23)+3),48,186,48,edge(t.base));
  let start=8;
  if(o.lead) {
    const cabX=4+noseFn(7), cabW=o.nose==='long'?16:13;
    glass(img,cabX,29,cabW,9,1);
    if(o.nose==='long'||o.nose==='stream') {
      // Distinct cockpit wedge instead of a flat square floating on the nose.
      poly(img,[[cabX,29],[cabX+cabW-2,29],[cabX+cabW-2,36],[cabX-4,36]],GLASS,INK);
      img.line(cabX+2,30,cabX-1,34,REFLECT);
    }
    const dx=cabX+cabW+3;
    img.box(dx,28,7,20,t.base,edge(t.base),1);
    glass(img,dx+2,30,4,8);
    img.set(dx+5,41,INK); img.line(dx-2,48,dx+8,48,METAL_LIGHT);
    img.line(dx-1,49,dx+7,49,METAL_DARK);
    const nx=3+noseFn(20);
    lamp(img,nx,44,4,3);
    if(o.nose==='bonnet') {
      img.line(5,39,23,39,t.light);
      for(let x=9;x<21;x+=3) img.line(x,41,x,45,t.dark);
    }
    if(o.nose==='long') {
      img.line(5,44,32,43,t.light);
      img.line(9,46,24,46,METAL);
    }
    start=dx+11;
  }
  const end=184, dw=12, doors=[];
  for(let k=0;k<o.doors;k++) doors.push(Math.round(start+8+k*(end-start-20)/Math.max(1,o.doors-1)));
  // Door-pocket seams flank each door, leaving the window gaps intact.
  const spans=[]; let left=start;
  for(const dx of doors) {spans.push([left,dx-3]);left=dx+dw+3;}
  spans.push([left,end]);
  for(const [a,b] of spans) {
    const width=b-a+1;
    if(width<5) continue;
    if(o.win==='big') {
      glass(img,a,30,width,9,1);
      if(width>21) img.line(a+Math.floor(width/2),30,a+Math.floor(width/2),38,FRAME);
    } else {
      const ww=o.win==='round'?10:9, step=ww+3;
      const count=Math.max(1,Math.floor((width+3)/step));
      const off=Math.max(0,Math.floor((width-(count*step-3))/2));
      for(let k=0;k<count;k++) {
        const x=a+off+k*step;
        if(x+ww-1<=b) glass(img,x,30,ww,9,o.win==='round'?2:1);
      }
    }
  }
  for(const d of doors) {
    img.line(d-2,29,d+dw+1,29,edge(t.base)); // external door rail
    img.line(d-2,28,d+dw+1,28,t.light);
    img.box(d,30,dw,18,t.base,edge(t.base));
    if(o.band!=='none') img.rect(d+1,40,dw-2,o.band==='split'?7:3,bt.base);
    img.line(d+6,30,d+6,47,FRAME);
    glass(img,d+2,31,4,8,1); glass(img,d+7,31,4,8,1);
    img.set(d+4,42,INK); img.set(d+8,42,INK);
    img.line(d+1,47,d+10,47,METAL_LIGHT);
    if(d+dw+2<187) img.line(d+dw+2,32,d+dw+2,46,edge(t.base));
  }
  // Actual tiny plates, not unreadable pseudo-lettering across the body.
  img.box(174,43,7,3,t.light,t.dark);
  img.set(176,44,t.dark); img.set(178,44,t.dark);
  img.box(Math.min(164,start+2),27,6,2,PAL.white,METAL_DARK);
  {
    const sx=Math.min(161,start+27);
    img.box(sx,26,12,4,INTERIOR,EDGE_METAL);
    for(let k=2;k<10;k+=3) img.rect(sx+k,27,1,2,LED);
  }
  // AC fins; Shinkansen-like roof equipment is partly faired.
  if(o.roof==='cooler'||o.roof==='panto') {
    for(const [x,w] of [[64,29],[128,27]]) {
      img.box(x,19,w,6,METAL,EDGE_METAL,2);
      img.line(x+3,20,x+w-4,20,METAL_LIGHT);
      for(let a=x+4;a<x+w-3;a+=3) img.line(a,22,a,23,FRAME);
    }
  } else if(o.color===PAL.white) {
    img.box(99,22,50,3,t.light,t.dark,1);
  } else {
    for(let x=63;x<166;x+=24) img.box(x,22,8,3,METAL,METAL_DARK,1);
  }
  if(o.roof==='panto') panto(img,113,5);
  // Varied, separated underfloor equipment with louvers and service covers.
  for(const [x,y,w,h] of [[50,49,20,6],[73,50,15,5],[91,49,27,7],[122,49,18,5]]) {
    img.box(x,y,w,h,METAL,EDGE_METAL);
    img.line(x+1,y+1,x+w-2,y+1,METAL_LIGHT);
    for(let a=x+3;a<x+w-2;a+=4) img.line(a,y+3,a,y+h-2,METAL_DARK);
  }
  img.box(141,50,6,4,METAL_LIGHT,EDGE_METAL,1);
  for(const bx of [29,162]) {
    // Wheel tread, hub, equalizer/frame, axle boxes and spring stacks.
    for(const wx of [bx-10,bx+10]) {
      img.box(wx-4,51,8,8,INK,null,3);
      img.box(wx-2,53,4,4,METAL,METAL_DARK,1);
      img.set(wx,54,METAL_LIGHT);
      img.line(wx-3,58,wx+2,58,METAL_DARK);
    }
    img.box(bx-14,50,29,5,METAL_DARK,INK,1);
    img.line(bx-11,51,bx+11,51,METAL_LIGHT);
    for(const xx of [bx-10,bx+10]) img.box(xx-2,53,5,3,METAL,EDGE_METAL);
    for(const xx of [bx-5,bx+4]) {
      img.rect(xx,49,3,5,METAL);
      for(let y=49;y<54;y+=2) img.line(xx,y,xx+2,y,INK);
    }
  }
  // Gangway bellows at the 192-dot join; 2+2 pixels on adjacent cars.
  img.rect(190,29,2,17,EDGE_METAL);
  if(!o.lead) img.rect(0,29,2,17,EDGE_METAL);
  for(let y=30;y<46;y+=3) {
    img.line(190,y,191,y,METAL_LIGHT);
    if(!o.lead) img.line(0,y,1,y,METAL_LIGHT);
  }
  img.rect(188,49,4,2,INK);
  if(!o.lead) img.rect(0,49,4,2,INK);
  track(img,59);
  return img;
}

// Every pattern is evaluated on a 2 x 2 PRINT-DOT cell, never display pixels.
// Palette families use <= 25% density to leave headroom for detail ink.
const patterns={
  white:(x,y)=>false,
  silver:(x,y)=>x%6===0&&y%4===0,
  black:(x,y)=>x%2===0&&y%2===0,
  red:(x,y)=>y%5===0,
  orange:(x,y)=>x%6===0,
  yellow:(x,y)=>x%6===0&&y%3===0,
  lime:(x,y)=>(x-y+48)%6===0,
  green:(x,y)=>(x+y)%5===0,
  sky:(x,y)=>x%4===0&&y%3===0,
  blue:(x,y)=>y%6===0||(x%6===0&&y%6===3),
  purple:(x,y)=>(x-y+48)%7===0||(x+y)%7===0,
  pink:(x,y)=>x%4===0&&y%4===0,
};
const fixedMono = new Map([
  [INK,()=>true],[FRAME,()=>true],
  [GLASS,()=>false],[GLASS2,()=>false],[INTERIOR,(x,y)=>x%5===0&&y%3===0],
  [REFLECT,()=>true],[WHITE,()=>false],[LAMP,()=>false],[TAIL,()=>true],
  [LED,()=>true],[METAL_LIGHT,()=>false],
  [METAL,(x,y)=>x%5===0&&y%3===0],
  [METAL_DARK,(x,y)=>(x+y)%5===0],
]);
function toMono(src,scale=1) {
  const out=new Img(src.w*scale,src.h*scale);
  for(let y=0;y<out.h;y++) for(let x=0;x<out.w;x++) {
    const c=src.get(Math.floor(x/scale),Math.floor(y/scale));
    if(c==null) continue;
    const family=colorFamily.get(c), pattern=edgeColors.has(c)?()=>true:family?patterns[family]:fixedMono.get(c);
    if(!pattern) throw Error(`Unmapped print material: ${c}`);
    out.set(x,y,pattern(x>>1,y>>1)?'#000000':WHITE);
  }
  return out;
}

const faces=[
  {contour:'square',window:'two',door:'center',lightShape:'round',lightPos:'mid',sign:'top',skirt:'small',paint:'band',color:PAL.silver,bandColor:PAL.green,panto:true},
  {contour:'round',window:'one',door:'none',lightShape:'led',lightPos:'mid',sign:'inwin',skirt:'large',paint:'blackface',color:PAL.red,bandColor:PAL.white,panto:false},
  {contour:'taper',window:'pano',door:'none',lightShape:'square',lightPos:'low',sign:'none',skirt:'large',paint:'band',color:PAL.white,bandColor:PAL.blue,panto:true},
  {contour:'dome',window:'small',door:'center',lightShape:'round',lightPos:'mid',sign:'none',skirt:'none',paint:'warning',color:PAL.orange,bandColor:PAL.green,panto:false},
];
const trains=[
  [{lead:true,nose:'slope',color:PAL.silver,band:'one',bandColor:PAL.green,doors:3,win:'big',roof:'cooler'},
   {lead:false,nose:'flat',color:PAL.silver,band:'one',bandColor:PAL.green,doors:4,win:'big',roof:'panto'}],
  [{lead:true,nose:'stream',color:PAL.red,band:'two',bandColor:PAL.white,doors:2,win:'small',roof:'cooler'},
   {lead:false,nose:'flat',color:PAL.red,band:'two',bandColor:PAL.white,doors:2,win:'small',roof:'panto'}],
  [{lead:true,nose:'long',color:PAL.white,band:'one',bandColor:PAL.blue,doors:2,win:'small',roof:'none'},
   {lead:false,nose:'flat',color:PAL.white,band:'one',bandColor:PAL.blue,doors:2,win:'small',roof:'panto'}],
  [{lead:true,nose:'bonnet',color:PAL.orange,band:'split',bandColor:PAL.green,doors:2,win:'round',roof:'none'},
   {lead:false,nose:'flat',color:PAL.orange,band:'split',bandColor:PAL.green,doors:2,win:'round',roof:'cooler'}],
];

// Tiny hand-set 3 x 5 pixel type, with integer-scale rendering throughout.
const FONT={
  A:'010101111101101',B:'110101110101110',C:'011100100100011',D:'110101101101110',E:'111100110100111',
  F:'111100110100100',G:'011100101101011',H:'101101111101101',I:'111010010010111',J:'001001001101010',
  K:'101101110101101',L:'100100100100111',M:'101111111101101',N:'101111111111101',O:'010101101101010',
  P:'110101110100100',Q:'010101101111011',R:'110101110101101',S:'011100010001110',T:'111010010010010',
  U:'101101101101111',V:'101101101101010',W:'101101111111101',X:'101101010101101',Y:'101101010010010',Z:'111001010100111',
  0:'111101101101111',1:'010110010010111',2:'110001010100111',3:'110001010001110',4:'101101111001001',
  5:'111100110001110',6:'011100111101111',7:'111001010010010',8:'111101111101111',9:'111101111001110',
  '-':'000000111000000','.':'000000000000010','/':'001001010100100',':':'000010000010000',
};
function text(img,str,x,y,c=INK,s=1) {
  for(const ch of str.toUpperCase()) {
    const bits=FONT[ch];
    if(bits) for(let j=0;j<5;j++) for(let i=0;i<3;i++) if(bits[j*3+i]==='1') img.rect(x+i*s,y+j*s,s,s,c);
    x+=4*s;
  }
}
const titles=['01 / URBAN LOCAL','02 / INTERCITY EXPRESS','03 / HIGH SPEED','04 / HERITAGE LOCAL'];
function consist(options) {
  const img=new Img(384,64);
  options.forEach((o,i)=>img.blit(car(o),192*i,0));
  return img;
}
function maxInk(img,size=64) {
  const stride=img.w+1, sum=new Uint32Array(stride*(img.h+1));
  for(let y=0;y<img.h;y++) for(let x=0;x<img.w;x++) {
    const i=(y+1)*stride+x+1;
    sum[i]=(img.get(x,y)==='#000000'?1:0)+sum[i-1]+sum[i-stride]-sum[i-stride-1];
  }
  let max=0,at=[0,0];
  for(let y=0;y<=img.h-size;y++) for(let x=0;x<=img.w-size;x++) {
    const n=sum[(y+size)*stride+x+size]-sum[y*stride+x+size]-sum[(y+size)*stride+x]+sum[y*stride+x];
    if(n>max) {max=n;at=[x,y];}
  }
  return {fraction:Number((max/(size*size)).toFixed(4)),at};
}
function main() {
  const renders=faces.map(face), consists=trains.map(consist);
  const color=new Img(1248,1436,'#f3ead7');
  text(color,'RAIL ATELIER / V2',48,24,INK,3);
  text(color,'PIXEL STUDIES  -  ORIGINAL TRAIN DESIGNS',48,48,METAL_DARK,2);
  renders.forEach((f,i)=>color.blit(f,48+i*298,76,4));
  titles.forEach((title,i)=>text(color,title,48+i*298,392,INK,2));
  consists.forEach((c,i)=> {
    const y=432+i*226;
    text(color,titles[i],48,y,INK,2);
    text(color,'2 X 20 M / 384 DOTS',900,y,METAL_DARK,2);
    color.blit(c,48,y+19,3);
  });
  text(color,'12 BODY COLORS / THREE TONES EACH',48,1348,INK,2);
  Object.entries(PAL).forEach(([name,c],i)=> {
    const x=48+i*96, t=shade(c);
    color.rect(x,1370,84,30,c); color.rect(x,1370,84,5,t.light); color.rect(x,1395,84,5,t.dark);
    text(color,name,x,1410,INK,1);
  });
  fs.writeFileSync(path.join(__dirname,'v2_color.png'),png(color,'#f3ead7'));
  const strips=renders.map((f,i)=> {
    const paper=new Img(384,400,WHITE);
    text(paper,titles[i],16,12,'#000000',1);
    text(paper,'384 DOT / 203 DPI',16,24,'#000000',1);
    paper.blit(toMono(f,3),96,36);
    paper.blit(toMono(consists[i]),0,280);
    text(paper,'12 FIXED PATTERNS / 2 DOT CELLS',8,352,'#000000',1);
    Object.values(PAL).forEach((c,k)=> {
      paper.box(k*32+2,365,28,27,WHITE,'#000000');
      paper.blit(toMono(new Img(26,25,c)),k*32+3,366);
    });
    for(const c of paper.d) if(c!=='#000000'&&c!==WHITE) throw Error('Non-binary paper pixel');
    const density=maxInk(paper);
    console.log(`Strip ${i+1}: worst 64x64 ink ${(density.fraction*100).toFixed(1)}% at ${density.at}`);
    return paper;
  });
  const print=new Img(1596,1660,'#9aa0a8');
  strips.forEach((p,i)=>print.blit(p,20+(i%2)*788,20+Math.floor(i/2)*820,2));
  fs.writeFileSync(path.join(__dirname,'v2_print.png'),png(print,'#9aa0a8'));
  console.log(`Wrote v2_color.png (${color.w}x${color.h}) and v2_print.png (${print.w}x${print.h}).`);
}
if(require.main===module) main();
module.exports={Img,PAL,face,car,consist,toMono,maxInk,png,faces,trains,patterns,shade};
