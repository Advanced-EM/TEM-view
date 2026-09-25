// Draws the detector views (main image + secondary panel) for each mode.
import * as P from './physics.js';
import { stemDetType, AP_MRAD } from './sim.js';
import { drawRonch, drawCBED } from './techniques.js';

const C = {
  accent: '#6fd6ff', warm: '#ffb45e', text: '#e9edf2', muted: '#8a94a3', dim: '#566070',
  grid: 'rgba(255,255,255,0.07)', bg: '#06080b',
};
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Narrow layouts can shrink panels to nothing; never hand the canvas a negative radius.
const _arc = CanvasRenderingContext2D.prototype.arc;
CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) { return _arc.call(this, x, y, Math.max(0, r), ...rest); };

function lut(stops) {
  const L = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const f = clamp((t - t0) / (t1 - t0), 0, 1);
    for (let j = 0; j < 3; j++) L[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return L;
}
export const LUT = {
  gray: lut([[0, [0, 0, 0]], [1, [255, 255, 255]]]),
  magma: lut([[0, [2, 2, 8]], [0.22, [60, 16, 110]], [0.48, [170, 50, 120]], [0.72, [250, 125, 90]], [1, [252, 250, 200]]]),
  ice: lut([[0, [3, 6, 12]], [0.3, [14, 52, 102]], [0.65, [70, 170, 235]], [1, [236, 250, 255]]]),
  phosphor: lut([[0, [2, 7, 4]], [0.45, [28, 120, 62]], [0.8, [150, 235, 150]], [1, [235, 255, 225]]]),
  hits: lut([[0, [2, 4, 8]], [0.25, [20, 70, 110]], [0.6, [90, 200, 250]], [1, [245, 252, 255]]]),
};

const offs = new Map();
function off(w, h) {
  const k = w + 'x' + h;
  let o = offs.get(k);
  if (!o) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    o = { c, ctx, id: ctx.createImageData(w, h) };
    offs.set(k, o);
  }
  return o;
}

export function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { ctx, W: w, H: h, dpr };
}

export function range(arr, pLo = 0.005, pHi = 0.995, fn = null) {
  const n = arr.length, m = Math.min(n, 5000), s = new Float32Array(m);
  for (let i = 0; i < m; i++) { const v = arr[Math.floor((i * n) / m)]; s[i] = fn ? fn(v) : v; }
  s.sort();
  return [s[Math.floor(pLo * (m - 1))], s[Math.floor(pHi * (m - 1))]];
}

// Paint a scalar field. noise: electrons per pixel at mean intensity (Poisson shot noise).
export function paint(ctx, arr, w, h, dst, o = {}) {
  const { lo, hi, lut = LUT.gray, log = false, noise = 0, gamma = 1, rows = h, rowsFill = null } = o;
  const { c, ctx: oc, id } = off(w, h);
  const d = id.data;
  let mean = 1;
  if (noise) { mean = 0; for (let i = 0; i < arr.length; i++) mean += arr[i]; mean = mean / arr.length || 1; }
  const L = lut, span = hi - lo || 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = arr[i];
      if (noise) v = (P.poisson(Math.max(0, (v / mean) * noise)) / noise) * mean;
      if (log) v = Math.log10(1 + Math.max(0, v));
      let t = clamp((v - lo) / span, 0, 1);
      if (gamma !== 1) t = Math.pow(t, gamma);
      if (y >= rows) t = rowsFill === null ? t : rowsFill;
      const k = (t * 255) | 0, p = i * 4;
      d[p] = L[k * 3]; d[p + 1] = L[k * 3 + 1]; d[p + 2] = L[k * 3 + 2]; d[p + 3] = 255;
    }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, w, h, dst[0], dst[1], dst[2], dst[3]);
}

export function font(ctx, px, dpr, weight = 400) { ctx.font = `${weight} ${Math.round(px * dpr)}px ${MONO}`; }

export function label(ctx, text, x, y, dpr, { color = C.text, bg = 'rgba(5,7,10,0.62)', size = 10, align = 'left' } = {}) {
  font(ctx, size, dpr);
  const w = ctx.measureText(text).width, p = 4 * dpr, h = size * dpr + 2 * p;
  const bx = align === 'center' ? x - w / 2 - p : align === 'right' ? x - w - 2 * p : x;
  ctx.fillStyle = bg;
  roundRect(ctx, bx, y - h / 2, w + 2 * p, h, 4 * dpr);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + p, y + 0.5 * dpr);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function scaleBar(ctx, dst, fovA, dpr) {
  const nice = [1, 2, 5, 10, 20, 50, 100, 200];
  const target = fovA * 0.22;
  let L = nice[0];
  for (const v of nice) if (v <= target) L = v;
  const px = (L / fovA) * dst[2];
  const x = dst[0] + dst[2] - px - 12 * dpr, y = dst[1] + dst[3] - 14 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x, y, px, 3 * dpr);
  font(ctx, 10, dpr, 500);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(L >= 10 ? `${L / 10} nm` : `${L} Å`, x + px / 2, y - 3 * dpr);
  ctx.textAlign = 'left';
}

function specimenLabels(ctx, spec, S, dst, fovA, dpr) {
  for (const l of spec.labels) {
    const u = (l.x - S.cx) / fovA + 0.5, v = (l.y - S.cy) / fovA + 0.5;
    if (u < 0.08 || u > 0.92 || v < 0.06 || v > 0.94) continue;
    label(ctx, l.text, dst[0] + u * dst[2], dst[1] + v * dst[3], dpr, { align: 'center', color: '#dff6ff' });
  }
  if (spec.id === 'sto') {
    const u = (0 - S.cx) / fovA + 0.5;
    if (u > 0 && u < 1) {
      ctx.setLineDash([4 * dpr, 5 * dpr]);
      ctx.strokeStyle = 'rgba(111,214,255,0.55)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(dst[0] + u * dst[2], dst[1]); ctx.lineTo(dst[0] + u * dst[2], dst[1] + dst[3] * 0.72); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawHits(ctx, sg, dst, dpr) {
  const { hits, w, h } = sg;
  let mx = 0;
  for (let i = 0; i < hits.length; i++) if (hits[i] > mx) mx = hits[i];
  const hi = Math.log10(1 + Math.max(1, mx));
  paint(ctx, hits, w, h, dst, { lo: 0, hi, log: true, lut: LUT.hits, gamma: 0.8 });
  ctx.globalCompositeOperation = 'lighter';
  for (const i of sg.recent) {
    const x = dst[0] + ((i % w) + 0.5) / w * dst[2], y = dst[1] + (((i / w) | 0) + 0.5) / h * dst[3];
    const g = ctx.createRadialGradient(x, y, 0, x, y, 6 * dpr);
    g.addColorStop(0, 'rgba(220,250,255,0.9)'); g.addColorStop(1, 'rgba(111,214,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 6 * dpr, y - 6 * dpr, 12 * dpr, 12 * dpr);
  }
  ctx.globalCompositeOperation = 'source-over';
  label(ctx, `${sg.count.toLocaleString()} electrons`, dst[0] + 10 * dpr, dst[1] + 16 * dpr, dpr, { color: C.accent });
}

// ------------------------------------------------------------------ public draw entry
export const layout = {};

export function draw(sim, S, mainCv, secCv, hover) {
  const m = fit(mainCv), s = fit(secCv);
  m.ctx.fillStyle = C.bg; m.ctx.fillRect(0, 0, m.W, m.H);
  s.ctx.fillStyle = C.bg; s.ctx.fillRect(0, 0, s.W, s.H);
  const fn = { tem: drawTEM, stem: drawSTEM, diff: drawDiff, '4d': draw4D, eds: drawEDS, eels: drawEELS, ronch: drawRonch, cbed: drawCBED }[S.mode];
  fn(sim, S, m, s, performance.now() / 1000);
  if (sim.single?.hits && sim.single.count && !['4d', 'eds', 'eels'].includes(S.mode)) {
    m.ctx.fillStyle = C.bg; m.ctx.fillRect(0, 0, m.W, m.H);
    drawHits(m.ctx, sim.single, [0, 0, m.W, m.H], m.dpr);
  }
}

const real = (S) => S.clarity === 'real';

function drawTEM(sim, S, m, s) {
  const t = sim.tem;
  if (!t) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H];
  const [lo, hi] = range(t.img);
  const scr = S.camera === 'screen';
  // phosphor screen: lower detection efficiency and light spread; direct detector: counts each electron
  const noise = real(S) ? S.dose * t.dx * t.dx * (scr ? 0.25 : 0.9) : 0;
  if (scr) ctx.filter = `blur(${1.1 * dpr}px)`;
  paint(ctx, t.img, t.c, t.c, dst, { lo, hi, noise, lut: scr ? LUT.phosphor : LUT.gray });
  ctx.filter = 'none';
  label(ctx, scr ? 'fluorescent screen' : 'direct electron detector · counting', W - 10 * dpr, 16 * dpr, dpr, { color: scr ? '#9be39b' : C.accent, size: 9, align: 'right' });
  scaleBar(ctx, dst, S.fov * 10, dpr);
  if (!real(S)) specimenLabels(ctx, sim.spec, S, dst, S.fov * 10, dpr);
  if (S.objAp === 'df') label(ctx, 'DARK FIELD · one Bragg beam', 10 * dpr, 16 * dpr, dpr, { color: C.warm });

  // diffractogram
  const q = s.ctx, sz = Math.min(s.H, s.W * 0.5), d2 = [0, 0, sz, sz];
  const [a, b] = range(t.fft, 0.2, 0.9995);
  paint(q, t.fft, t.n, t.n, d2, { lo: a, hi: b, lut: real(S) ? LUT.gray : LUT.ice, gamma: 1.4 });
  const kPx = sz / (2 * t.kmax), cx = sz / 2, cy = sz / 2;
  q.lineWidth = 1 * s.dpr;
  if (isFinite(t.apK)) {
    q.strokeStyle = S.objAp === 'df' ? C.warm : 'rgba(255,180,94,0.8)';
    q.beginPath(); q.arc(cx + t.apCenter[0] * kPx, cy + t.apCenter[1] * kPx, t.apK * kPx, 0, 7); q.stroke();
  }
  const lam = sim.lam, Cs = sim.CsA();
  const pr = P.pointResolution(Cs, lam), il = P.infoLimit(lam, 32);
  q.setLineDash([3 * s.dpr, 4 * s.dpr]);
  q.strokeStyle = 'rgba(111,214,255,0.5)';
  q.beginPath(); q.arc(cx, cy, (1 / il) * kPx, 0, 7); q.stroke();
  q.setLineDash([]);
  if (!real(S)) {
    label(q, 'Thon rings', 8 * s.dpr, 14 * s.dpr, s.dpr, { color: C.accent });
    if (isFinite(t.apK)) label(q, 'aperture', cx + (t.apCenter[0] + t.apK * 0.72) * kPx, cy - t.apK * 0.72 * kPx, s.dpr, { color: C.warm, size: 9 });
    label(q, `info limit ${il.toFixed(2)} Å`, 8 * s.dpr, sz - 14 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  }
  // CTF plot
  const px0 = sz + 16 * s.dpr, pw = s.W - px0 - 10 * s.dpr, py0 = 18 * s.dpr, ph = s.H - 44 * s.dpr;
  drawCTF(q, sim, S, [px0, py0, pw, ph], s.dpr, t);
}

function drawCTF(q, sim, S, r, dpr, t) {
  const [x0, y0, w, h] = r, lam = sim.lam, df = S.df * 10, Cs = sim.CsA();
  const kmax = Math.min(t.kmax, 1.1);
  q.strokeStyle = C.grid; q.lineWidth = 1 * dpr;
  q.beginPath(); q.moveTo(x0, y0 + h / 2); q.lineTo(x0 + w, y0 + h / 2); q.stroke();
  font(q, 9, dpr);
  q.fillStyle = C.muted; q.textBaseline = 'top';
  for (let k = 0.2; k <= kmax + 1e-6; k += 0.2) {
    const x = x0 + (k / kmax) * w;
    q.fillRect(x, y0 + h / 2 - 2 * dpr, 1 * dpr, 4 * dpr);
    q.textAlign = 'center';
    q.fillText(`${(1 / k).toFixed(1)}Å`, x, y0 + h + 6 * dpr);
  }
  q.textAlign = 'left';
  // envelope
  const env = (k) => {
    const k2 = k * k, g = df * lam * k + Cs * lam ** 3 * k * k2;
    return Math.exp(-0.5 * Math.PI ** 2 * lam ** 2 * 32 ** 2 * k2 * k2) * Math.exp(-Math.pow((Math.PI * 0.08e-3) / lam, 2) * g * g);
  };
  q.strokeStyle = 'rgba(111,214,255,0.35)';
  q.setLineDash([3 * dpr, 3 * dpr]);
  q.beginPath();
  for (let i = 0; i <= 200; i++) { const k = (i / 200) * kmax, x = x0 + (i / 200) * w, y = y0 + h / 2 - env(k) * (h / 2) * 0.92; i ? q.lineTo(x, y) : q.moveTo(x, y); }
  q.stroke(); q.setLineDash([]);
  const ap = isFinite(t.apK) && S.objAp !== 'df' ? t.apK : Infinity;
  q.lineWidth = 1.6 * dpr;
  q.beginPath();
  for (let i = 0; i <= 600; i++) {
    const k = (i / 600) * kmax, x = x0 + (i / 600) * w;
    const v = k > ap ? 0 : -Math.sin(P.chi(k * k, lam, df, Cs)) * env(k);
    const y = y0 + h / 2 - v * (h / 2) * 0.92;
    i ? q.lineTo(x, y) : q.moveTo(x, y);
  }
  const grad = q.createLinearGradient(x0, 0, x0 + w, 0);
  grad.addColorStop(0, C.accent); grad.addColorStop(1, '#b59bff');
  q.strokeStyle = grad; q.stroke();
  // point resolution marker (first zero crossing)
  let kz = null, prev = 0;
  for (let i = 1; i <= 600; i++) {
    const k = (i / 600) * kmax, v = -Math.sin(P.chi(k * k, lam, df, Cs));
    if (i > 5 && Math.sign(v) !== Math.sign(prev) && prev !== 0) { kz = k; break; }
    prev = v;
  }
  if (kz) {
    const x = x0 + (kz / kmax) * w;
    q.strokeStyle = C.warm; q.lineWidth = 1 * dpr;
    q.beginPath(); q.moveTo(x, y0); q.lineTo(x, y0 + h); q.stroke();
    label(q, `1st zero ${(1 / kz).toFixed(2)} Å`, Math.min(x + 4 * dpr, x0 + w - 110 * dpr), y0 + 10 * dpr, dpr, { color: C.warm, size: 9 });
  }
  label(q, 'contrast transfer  −sin χ(k)', x0, y0 + h - 4 * dpr, dpr, { color: C.muted, size: 9 });
}

function drawSTEM(sim, S, m, s) {
  const st = sim.stemImg;
  if (!st) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H];
  const [lo, hi] = range(st.img, 0.002, 0.998);
  const frac = st.type === 'BF' ? 0.9 : st.type === 'ABF' ? 0.6 : st.type === 'ADF' ? 0.12 : 0.04;
  const noise = real(S) ? S.dose * st.dx * st.dx * frac : 0;
  const row = Math.floor(sim.raster * st.c);
  const first = sim.frameNoise === sim._stemPass;
  paint(ctx, st.img, st.c, st.c, dst, { lo, hi, noise, rows: first ? row : st.c, rowsFill: 0 });
  const y = (row / st.c) * H;
  const g = ctx.createLinearGradient(0, y - 10 * dpr, 0, y + 2 * dpr);
  g.addColorStop(0, 'rgba(111,214,255,0)'); g.addColorStop(1, 'rgba(111,214,255,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, y - 10 * dpr, W, 12 * dpr);
  scaleBar(ctx, dst, S.fov * 10, dpr);
  if (!real(S)) specimenLabels(ctx, sim.spec, S, dst, S.fov * 10, dpr);

  // secondary: probe | detector geometry
  const q = s.ctx, sz = Math.min(s.H, s.W / 2 - 6 * s.dpr);
  const pb = sim.probe;
  if (pb) {
    paint(q, pb.I, pb.n, pb.n, [0, 0, sz, sz], { lo: 0, hi: pb.max, lut: real(S) ? LUT.gray : LUT.ice, gamma: 0.55 });
    const pxA = sz / (pb.n * pb.dx);
    q.strokeStyle = 'rgba(255,180,94,0.85)'; q.lineWidth = 1 * s.dpr;
    q.beginPath(); q.arc(sz / 2, sz / 2, (pb.fwhm / 2) * pxA, 0, 7); q.stroke();
    label(q, `probe  FWHM ${pb.fwhm.toFixed(2)} Å`, 8 * s.dpr, 14 * s.dpr, s.dpr, { color: C.accent });
    q.fillStyle = 'rgba(255,255,255,0.9)';
    q.fillRect(sz - 12 * s.dpr - 2 * pxA, sz - 14 * s.dpr, 2 * pxA, 3 * s.dpr);
    font(q, 9, s.dpr); q.textAlign = 'center'; q.textBaseline = 'bottom';
    q.fillText('2 Å', sz - 12 * s.dpr - pxA, sz - 16 * s.dpr); q.textAlign = 'left';
  }
  detectorDiagram(q, S, [sz + 12 * s.dpr, 0, s.W - sz - 12 * s.dpr, s.H], s.dpr, st.type);
}

function detectorDiagram(q, S, r, dpr, type) {
  const [x0, y0, w, h] = r, cx = x0 + w / 2, cy = y0 + h / 2 + 6 * dpr, R = Math.min(w, h) * 0.44;
  const maxM = 240, sc = R / maxM;
  q.fillStyle = 'rgba(255,255,255,0.03)';
  q.beginPath(); q.arc(cx, cy, R, 0, 7); q.fill();
  // scattered intensity falloff
  const g = q.createRadialGradient(cx, cy, S.alpha * sc, cx, cy, R);
  g.addColorStop(0, 'rgba(111,214,255,0.25)'); g.addColorStop(1, 'rgba(111,214,255,0)');
  q.fillStyle = g; q.beginPath(); q.arc(cx, cy, R, 0, 7); q.fill();
  q.fillStyle = 'rgba(111,214,255,0.55)';
  q.beginPath(); q.arc(cx, cy, S.alpha * sc, 0, 7); q.fill();
  q.strokeStyle = C.warm; q.lineWidth = 2 * dpr;
  q.beginPath(); q.arc(cx, cy, Math.min(S.detOut, maxM) * sc, 0, 7); q.stroke();
  q.beginPath(); q.arc(cx, cy, S.detIn * sc, 0, 7); q.stroke();
  q.fillStyle = 'rgba(255,180,94,0.14)';
  q.beginPath(); q.arc(cx, cy, Math.min(S.detOut, maxM) * sc, 0, 7); q.arc(cx, cy, S.detIn * sc, 0, 7, true); q.fill();
  label(q, `${type} detector  ${S.detIn}–${S.detOut} mrad`, x0 + 6 * dpr, y0 + 14 * dpr, dpr, { color: C.warm });
  label(q, `bright-field disk α = ${S.alpha} mrad`, x0 + 6 * dpr, y0 + h - 12 * dpr, dpr, { color: C.accent, size: 9 });
}

function drawDiff(sim, S, m, s) {
  const d = sim.diffDisp, dd = sim.diff;
  if (!d) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H];
  let mx = 0;
  for (let i = 0; i < d.arr.length; i++) if (d.arr[i] > mx) mx = d.arr[i];
  const scale = 1e4 / (mx || 1);
  const arr = new Float32Array(d.arr.length);
  for (let i = 0; i < arr.length; i++) arr[i] = d.arr[i] * scale;
  const noise = real(S) ? 0 : 0;
  const scr = S.camera === 'screen';
  if (scr) ctx.filter = `blur(${1.1 * dpr}px)`;
  paint(ctx, arr, d.W, d.W, dst, { lo: 0.05, hi: real(S) ? 3.3 : 3.0, log: true, lut: scr ? LUT.phosphor : real(S) ? LUT.gray : LUT.magma, gamma: 1.05, noise });
  ctx.filter = 'none';
  const kPx = W / (d.W * d.kPerPx), cx = W / 2, cy = H / 2;
  const spec = sim.spec;
  // Kikuchi lines (fixed to the crystal, so they sweep across the screen as you tilt)
  if (!spec.poly) {
    const lam = sim.lam, sx = -((S.tiltX * Math.PI) / 180) / lam, sy = -((S.tiltY * Math.PI) / 180) / lam;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    for (const gr of spec.grains.slice(0, 1)) {
      const refl = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 0], [0, 2]];
      for (const [a, b] of refl) {
        const gx = a * gr.b[0][0] + b * gr.b[1][0], gy = a * gr.b[0][1] + b * gr.b[1][1];
        const gl = Math.hypot(gx, gy), ux = gx / gl, uy = gy / gl;
        for (const sgn of [-1, 1]) {
          const off = sgn * gl / 2;
          const px = cx + (sx + ux * off) * kPx, py = cy + (sy + uy * off) * kPx;
          ctx.strokeStyle = sgn > 0 ? `rgba(255,255,255,${real(S) ? 0.16 : 0.1})` : `rgba(0,0,0,${real(S) ? 0.35 : 0.2})`;
          ctx.lineWidth = 1.4 * dpr;
          ctx.beginPath(); ctx.moveTo(px - uy * 2000, py + ux * 2000); ctx.lineTo(px + uy * 2000, py - ux * 2000); ctx.stroke();
        }
      }
    }
    ctx.restore();
    if (!real(S)) {
      const zx = cx + sx * kPx, zy = cy + sy * kPx;
      ctx.strokeStyle = 'rgba(111,214,255,0.7)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.arc(zx, zy, 6 * dpr, 0, 7); ctx.moveTo(zx - 10 * dpr, zy); ctx.lineTo(zx + 10 * dpr, zy); ctx.moveTo(zx, zy - 10 * dpr); ctx.lineTo(zx, zy + 10 * dpr); ctx.stroke();
      if (Math.hypot(zx - cx, zy - cy) > 14 * dpr) label(ctx, 'zone axis', zx + 10 * dpr, zy - 12 * dpr, dpr, { color: C.accent, size: 9 });
    }
  }
  if (S.beamStop) {
    ctx.fillStyle = '#050608';
    ctx.beginPath(); ctx.arc(cx, cy, 7 * dpr, 0, 7); ctx.fill();
    ctx.fillRect(cx - 3 * dpr, cy, 6 * dpr, H);
  }
  if (!real(S)) {
    if (spec.poly) {
      for (const r of spec.rings.slice(0, 3)) {
        const rad = (1 / r.d) * kPx;
        if (rad > W * 0.48) continue;
        label(ctx, `{${r.hkl}}  ${r.d.toFixed(2)} Å`, cx + rad * 0.72, cy - rad * 0.7, dpr, { color: '#ffe2b8', size: 9 });
      }
    } else {
      const gr = spec.grains[0];
      const refl = spec.id === 'sto' ? [[1, 0], [0, 1], [1, 1]] : [[1, 1], [0, 2], [2, 0]];
      for (const [a, b] of refl) {
        const gx = a * gr.b[0][0] + b * gr.b[1][0], gy = a * gr.b[0][1] + b * gr.b[1][1];
        const x = cx + gx * kPx, y = cy + gy * kPx;
        if (x < 20 || x > W - 20 || y < 20 || y > H - 20) continue;
        ctx.strokeStyle = 'rgba(255,226,184,0.8)'; ctx.lineWidth = 1 * dpr;
        ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, 7); ctx.stroke();
        label(ctx, gr.label(a, b), x + 10 * dpr, y - 10 * dpr, dpr, { color: '#ffe2b8', size: 9 });
      }
      if (spec.id === 'si') label(ctx, '002: "forbidden", appears by double diffraction', 10 * dpr, H - 16 * dpr, dpr, { color: C.muted, size: 9 });
      if (spec.id === 'sto') label(ctx, 'two grains → two square nets, 36.9° apart', 10 * dpr, H - 16 * dpr, dpr, { color: C.muted, size: 9 });
    }
  }
  label(ctx, `L = ${S.camL} mm   λL = ${(sim.lam * S.camL).toFixed(1)} Å·mm`, 10 * dpr, 16 * dpr, dpr, { color: C.accent, size: 9 });

  // radial profile
  const q = s.ctx, pad = 12 * s.dpr, x0 = 34 * s.dpr, y0 = 20 * s.dpr, w = s.W - x0 - pad, h = s.H - y0 - 28 * s.dpr;
  const prof = dd.prof, kMax = 1.9;
  let pm = 0;
  for (let i = 0; i < prof.length; i++) pm = Math.max(pm, prof[i]);
  q.strokeStyle = C.grid; q.lineWidth = 1 * s.dpr;
  q.beginPath(); q.moveTo(x0, y0 + h); q.lineTo(x0 + w, y0 + h); q.stroke();
  font(q, 9, s.dpr); q.fillStyle = C.muted; q.textAlign = 'center'; q.textBaseline = 'top';
  for (let k = 0.25; k < kMax; k += 0.25) q.fillText(k.toFixed(2), x0 + (k / kMax) * w, y0 + h + 5 * s.dpr);
  q.fillText('k (Å⁻¹)', x0 + w - 18 * s.dpr, y0 + h + 15 * s.dpr);
  q.textAlign = 'left';
  const lg = (v) => Math.log10(1 + (v / (pm || 1)) * 1e4) / 4;
  q.beginPath();
  for (let i = 0; i < prof.length; i++) {
    const x = x0 + ((i + 0.5) * dd.kStep / kMax) * w, y = y0 + h - lg(prof[i]) * h;
    i ? q.lineTo(x, y) : q.moveTo(x, y);
  }
  q.lineTo(x0 + w, y0 + h); q.lineTo(x0, y0 + h); q.closePath();
  const gg = q.createLinearGradient(0, y0, 0, y0 + h);
  gg.addColorStop(0, 'rgba(255,180,94,0.55)'); gg.addColorStop(1, 'rgba(255,180,94,0.03)');
  q.fillStyle = gg; q.fill();
  q.strokeStyle = C.warm; q.lineWidth = 1.4 * s.dpr; q.stroke();
  for (const r of spec.rings) {
    const x = x0 + (1 / r.d / kMax) * w;
    q.strokeStyle = 'rgba(111,214,255,0.4)'; q.setLineDash([2 * s.dpr, 3 * s.dpr]);
    q.beginPath(); q.moveTo(x, y0); q.lineTo(x, y0 + h); q.stroke(); q.setLineDash([]);
    q.save(); q.translate(x + 3 * s.dpr, y0 + 2 * s.dpr); font(q, 9, s.dpr); q.fillStyle = C.accent; q.textBaseline = 'top';
    q.fillText(`${r.hkl} · ${r.d.toFixed(2)}Å`, 0, 0); q.restore();
  }
  label(q, 'rotational average  (log)', x0, y0 - 8 * s.dpr, s.dpr, { color: C.muted, size: 9 });
}

function draw4D(sim, S, m, s, hover) {
  const f = sim.fd;
  if (!f) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H], N = f.N;
  layout.fd = { N, W, H };
  const rows = Math.ceil(f.done / N);
  const vec = S.vdet === 'dpc' ? [f.dpcX, f.dpcY] : [f.comX, f.comY];
  if (S.vdet === 'ptycho') {
    const ph = sim.ptychoPhase(), T = sim.pty;
    if (ph && T) {
      const [lo, hi] = range(ph.arr, 0.01, 0.995);
      paint(ctx, ph.arr, ph.S, ph.S, dst, { lo, hi, lut: real(S) ? LUT.gray : LUT.ice });
      label(ctx, `ePIE iteration ${T.iter}${T.iter < 30 ? ` · ${Math.round((100 * T.k) / (N * N))}%` : ' · converged'}`, 10 * dpr, 38 * dpr, dpr, { color: C.accent });
      // convergence sparkline
      const hst = T.errHist;
      if (hst.length > 1) {
        const w = 90 * dpr, h = 26 * dpr, x0 = W - w - 10 * dpr, y0 = 10 * dpr, m0 = hst[0];
        ctx.fillStyle = 'rgba(5,7,10,0.62)'; ctx.fillRect(x0 - 4 * dpr, y0 - 4 * dpr, w + 8 * dpr, h + 8 * dpr);
        ctx.strokeStyle = C.warm; ctx.lineWidth = 1.2 * dpr; ctx.beginPath();
        hst.forEach((v, i) => { const x = x0 + (i / 29) * w, y = y0 + h - (v / m0) * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
        font(ctx, 8, dpr); ctx.fillStyle = C.muted; ctx.textBaseline = 'top'; ctx.fillText('error', x0, y0 + h + 1);
      }
    } else {
      paint(ctx, f.vimg, N, N, dst, { lo: 0, hi: 1, rows, rowsFill: 0 });
      label(ctx, 'waiting for the full 4D dataset…', 10 * dpr, 36 * dpr, dpr, { color: C.muted, size: 9 });
    }
  } else if (S.vdet === 'com' || S.vdet === 'dpc') {
    const { c, ctx: oc, id } = off(N, N);
    let mx = 0;
    for (let i = 0; i < f.done; i++) mx = Math.max(mx, Math.hypot(vec[0][i], vec[1][i]));
    for (let i = 0; i < N * N; i++) {
      const p = i * 4;
      if (i >= f.done) { id.data[p] = id.data[p + 1] = id.data[p + 2] = 0; id.data[p + 3] = 255; continue; }
      const a = Math.atan2(vec[1][i], vec[0][i]), v = Math.min(1, Math.hypot(vec[0][i], vec[1][i]) / (mx || 1));
      const [r, g, b] = hsv((a / (2 * Math.PI) + 1) % 1, 0.85, v);
      id.data[p] = r; id.data[p + 1] = g; id.data[p + 2] = b; id.data[p + 3] = 255;
    }
    oc.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, N, N, 0, 0, W, H);
    if (!real(S) && f.done === N * N) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1 * dpr;
      const st = 4;
      for (let j = 1; j < N; j += st)
        for (let i = 1; i < N; i += st) {
          const k = j * N + i, vx = vec[0][k] / (mx || 1), vy = vec[1][k] / (mx || 1);
          const x = ((i + 0.5) / N) * W, y = ((j + 0.5) / N) * H, L = 12 * dpr;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + vx * L, y + vy * L); ctx.stroke();
        }
    }
    // colour wheel legend
    const R = 16 * dpr, lx = W - R - 10 * dpr, ly = R + 10 * dpr;
    for (let a = 0; a < 360; a += 6) {
      const [r, g, b] = hsv(a / 360, 0.85, 1);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, R, (a * Math.PI) / 180, ((a + 7) * Math.PI) / 180); ctx.fill();
    }
  } else {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < f.done; i++) { lo = Math.min(lo, f.vimg[i]); hi = Math.max(hi, f.vimg[i]); }
    if (!f.done) { lo = 0; hi = 1; }
    paint(ctx, f.vimg, N, N, dst, { lo, hi, rows, rowsFill: 0 });
  }
  const sel = S.fdSel >= 0 ? S.fdSel : Math.max(0, f.done - 1);
  const si = sel % N, sj = (sel / N) | 0;
  const px = ((si + 0.5) / N) * W, py = ((sj + 0.5) / N) * H;
  ctx.strokeStyle = C.warm; ctx.lineWidth = 1.5 * dpr;
  ctx.strokeRect(px - (W / N) * 0.5 - 1, py - (H / N) * 0.5 - 1, W / N + 2, H / N + 2);
  scaleBar(ctx, dst, f.scan, dpr);
  if (f.done < N * N) label(ctx, `acquiring ${Math.round((100 * f.done) / (N * N))}%`, 10 * dpr, 16 * dpr, dpr, { color: C.accent });
  else label(ctx, S.fdSel >= 0 ? 'hover: pick a probe position' : 'hover the image to read patterns', 10 * dpr, 16 * dpr, dpr, { color: C.muted, size: 9 });

  // CBED with virtual detector
  const q = s.ctx, sz = Math.min(s.H, s.W * 0.52), cb = sim.cbedAt(sel);
  layout.cbed = { x: 0, y: 0, sz, n4: f.n4, mradPx: f.mradPx, dpr: s.dpr };
  if (cb) {
    let mx = 0;
    for (let i = 0; i < cb.length; i++) mx = Math.max(mx, cb[i]);
    const sc = 1e4 / (mx || 1), arr = new Float32Array(cb.length);
    for (let i = 0; i < cb.length; i++) arr[i] = cb[i] * sc;
    paint(q, arr, f.n4, f.n4, [0, 0, sz, sz], { lo: 0.3, hi: 4, log: true, lut: real(S) ? LUT.gray : LUT.ice, noise: real(S) ? 0 : 0 });
    const mp = sz / (f.n4 * f.mradPx), cx = sz / 2, cy = sz / 2;
    q.lineWidth = 1.5 * s.dpr; q.strokeStyle = C.warm; q.fillStyle = 'rgba(255,180,94,0.16)';
    if (S.vdet === 'disk') { q.beginPath(); q.arc(cx + S.vdX * mp, cy + S.vdY * mp, S.vdR * mp, 0, 7); q.fill(); q.stroke(); }
    else if (S.vdet === 'dpc') {
      const r = S.alpha4d * 1.1 * mp, d = r * Math.SQRT1_2;
      q.beginPath(); q.arc(cx, cy, r, 0, 7); q.fill(); q.stroke();
      q.beginPath(); q.moveTo(cx - d, cy - d); q.lineTo(cx + d, cy + d); q.moveTo(cx + d, cy - d); q.lineTo(cx - d, cy + d); q.stroke();
      label(q, 'A−C, B−D: segmented detector', 8 * s.dpr, sz - 14 * s.dpr, s.dpr, { color: C.warm, size: 9 });
    } else if (S.vdet === 'ptycho') {
      q.strokeStyle = 'rgba(255,180,94,0.6)'; q.strokeRect(1, 1, sz - 2, sz - 2);
      label(q, 'every pixel used: amplitudes → phase', 8 * s.dpr, sz - 14 * s.dpr, s.dpr, { color: C.warm, size: 9 });
    }
    else if (S.vdet === 'com') {
      const k = sel, vx = f.comX[k], vy = f.comY[k];
      q.strokeStyle = C.warm; q.beginPath(); q.moveTo(cx, cy); q.lineTo(cx + vx * mp * 25, cy + vy * mp * 25); q.stroke();
      q.beginPath(); q.arc(cx + vx * mp * 25, cy + vy * mp * 25, 3 * s.dpr, 0, 7); q.fillStyle = C.warm; q.fill();
      label(q, 'centre-of-mass shift ×25', 8 * s.dpr, sz - 14 * s.dpr, s.dpr, { color: C.warm, size: 9 });
    } else {
      q.beginPath(); q.arc(cx, cy, S.vdOut * mp, 0, 7); q.arc(cx, cy, S.vdIn * mp, 0, 7, true); q.fill();
      q.beginPath(); q.arc(cx, cy, S.vdOut * mp, 0, 7); q.stroke();
      if (S.vdIn > 0) { q.beginPath(); q.arc(cx, cy, S.vdIn * mp, 0, 7); q.stroke(); }
    }
    if (sim.single?.hits && sim.single.count && sim.single.w === f.n4) drawHits(q, sim.single, [0, 0, sz, sz], s.dpr);
    label(q, `CBED at (${si}, ${sj})`, 8 * s.dpr, 14 * s.dpr + (sim.single ? 20 * s.dpr : 0), s.dpr, { color: C.accent });
    if (!['com', 'dpc', 'ptycho'].includes(S.vdet)) label(q, 'drag to reshape detector', sz - 8 * s.dpr, sz - 14 * s.dpr, s.dpr, { color: C.muted, size: 9, align: 'right' });
  }
  // data cube thumbnails
  const gx0 = sz + 14 * s.dpr, gw = s.W - gx0 - 4 * s.dpr, K = 6, cell = Math.min(gw / K, (s.H - 26 * s.dpr) / K);
  if (cell > 8) {
    label(q, `4D data cube  ${N}×${N}×${f.n4}×${f.n4}`, gx0, 12 * s.dpr, s.dpr, { color: C.muted, size: 9 });
    for (let j = 0; j < K; j++)
      for (let i = 0; i < K; i++) {
        const pi = Math.floor(((i + 0.5) / K) * N), pj = Math.floor(((j + 0.5) / K) * N), k = pj * N + pi;
        const x = gx0 + i * cell, y = 24 * s.dpr + j * cell;
        if (k >= f.done) { q.fillStyle = 'rgba(255,255,255,0.03)'; q.fillRect(x + 1, y + 1, cell - 2, cell - 2); continue; }
        const d = f.data.subarray(k * f.n4 * f.n4, (k + 1) * f.n4 * f.n4);
        let mx = 0;
        for (let t = 0; t < d.length; t++) mx = Math.max(mx, d[t]);
        const arr = new Float32Array(d.length);
        for (let t = 0; t < d.length; t++) arr[t] = (d[t] / (mx || 1)) * 1e4;
        paint(q, arr, f.n4, f.n4, [x + 1, y + 1, cell - 2, cell - 2], { lo: 0.3, hi: 4, log: true, lut: real(S) ? LUT.gray : LUT.ice });
      }
  }
}

export function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const symColor = (sym) => P.EL.find((e) => e.sym === sym && !e.pseudo)?.color ?? '#d9a066';

function drawEDS(sim, S, m, s) {
  const e = sim.eds, a = sim.acc, si = sim.si;
  if (!e || !a) return;
  const { ctx, W, H, dpr } = m, n = si.n, dst = [0, 0, W, H];
  const syms = S.edsSel === 'all' ? e.syms : [S.edsSel];
  const { c, ctx: oc, id } = off(n, n);
  const buf = new Float32Array(n * n * 3);
  for (const sym of syms) {
    const src = real(S) ? a.maps[sym] : e.maps[sym];
    let mx = 0;
    for (let i = 0; i < n * n; i++) mx = Math.max(mx, src[i]);
    const col = syms.length === 1 && real(S) ? [255, 255, 255] : hex(symColor(sym));
    for (let i = 0; i < n * n; i++) {
      const v = src[i] / (mx || 1);
      buf[i * 3] += v * col[0]; buf[i * 3 + 1] += v * col[1]; buf[i * 3 + 2] += v * col[2];
    }
  }
  for (let i = 0; i < n * n; i++) {
    id.data[i * 4] = buf[i * 3]; id.data[i * 4 + 1] = buf[i * 3 + 1]; id.data[i * 4 + 2] = buf[i * 3 + 2]; id.data[i * 4 + 3] = 255;
  }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = !real(S);
  ctx.drawImage(c, 0, 0, n, n, 0, 0, W, H);
  scaleBar(ctx, dst, S.fov * 10, dpr);
  let y = 16 * dpr;
  for (const sym of syms) { label(ctx, sym, 10 * dpr, y, dpr, { color: symColor(sym) }); y += 20 * dpr; }
  label(ctx, `${a.t.toFixed(1)} s · ${Math.round(a.total).toLocaleString()} X-rays`, W - 10 * dpr, 16 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });

  // spectrum
  const q = s.ctx, x0 = 40 * s.dpr, y0 = 16 * s.dpr, w = s.W - x0 - 10 * s.dpr, h = s.H - y0 - 30 * s.dpr, Emax = 16;
  layout.eds = { x0: x0 / s.dpr, w: w / s.dpr, Emax };
  const bins = Math.floor(Emax / e.dE);
  const data = real(S) ? a.spec : e.spec;
  let mx = 0;
  for (let b = Math.floor(0.2 / e.dE); b < bins; b++) mx = Math.max(mx, data[b]);
  mx = mx || 1;
  q.strokeStyle = C.grid; q.lineWidth = 1 * s.dpr;
  font(q, 9, s.dpr); q.fillStyle = C.muted; q.textAlign = 'center'; q.textBaseline = 'top';
  for (let E = 0; E <= Emax; E += 2) { const x = x0 + (E / Emax) * w; q.beginPath(); q.moveTo(x, y0); q.lineTo(x, y0 + h); q.stroke(); q.fillText(`${E}`, x, y0 + h + 5 * s.dpr); }
  q.fillText('keV', x0 + w - 10 * s.dpr, y0 + h + 15 * s.dpr);
  q.textAlign = 'left';
  // selected element lines
  for (const L of P.XRAY) {
    if (!e.compSym[L.el] && L.el !== 'Cu') continue;
    if (L.E > Emax) continue;
    const sel = S.edsSel === L.el;
    if (!sel && real(S)) continue;
    const x = x0 + (L.E / Emax) * w;
    q.strokeStyle = sel ? symColor(L.el) : 'rgba(255,255,255,0.08)';
    q.beginPath(); q.moveTo(x, y0); q.lineTo(x, y0 + h); q.stroke();
  }
  q.beginPath();
  for (let b = 0; b < bins; b++) {
    const x = x0 + ((b + 0.5) / bins) * w, yv = y0 + h - Math.min(1, data[b] / mx) * h * 0.92;
    b ? q.lineTo(x, yv) : q.moveTo(x, yv);
  }
  q.lineTo(x0 + w, y0 + h); q.lineTo(x0, y0 + h); q.closePath();
  const gg = q.createLinearGradient(0, y0, 0, y0 + h);
  gg.addColorStop(0, 'rgba(255,180,94,0.5)'); gg.addColorStop(1, 'rgba(255,180,94,0.04)');
  q.fillStyle = gg; q.fill(); q.strokeStyle = C.warm; q.lineWidth = 1.2 * s.dpr; q.stroke();
  // peak labels
  const placed = [];
  const lines = P.XRAY.filter((L) => (e.compSym[L.el] || L.el === 'Cu') && L.E < Emax && L.w >= 0.5).sort((p, q2) => q2.w - p.w);
  for (const L of lines) {
    const b = Math.floor(L.E / e.dE);
    let pk = 0;
    for (let k = b - 6; k <= b + 6; k++) pk = Math.max(pk, data[k] || 0);
    const x = x0 + (L.E / Emax) * w, yv = y0 + h - Math.min(1, pk / mx) * h * 0.92 - 12 * s.dpr;
    if (placed.some((p) => Math.abs(p[0] - x) < 44 * s.dpr && Math.abs(p[1] - yv) < 16 * s.dpr)) continue;
    placed.push([x, yv]);
    label(q, `${L.el} ${L.line}`, x, Math.max(y0 + 8 * s.dpr, yv), s.dpr, { color: L.el === 'Cu' ? '#d9a066' : symColor(L.el), size: 9, align: 'center' });
  }
  label(q, 'click a peak to map it', x0 + w, y0, s.dpr, { color: C.muted, size: 9, align: 'right' });
}

function drawEELS(sim, S, m, s) {
  const e = sim.eels, a = sim.accE, si = sim.si;
  if (!e || !a) return;
  const { ctx, W, H, dpr } = m, n = si.n, dst = [0, 0, W, H];
  if (real(S)) {
    let mx = 0;
    for (let i = 0; i < n * n; i++) mx = Math.max(mx, a.map[i]);
    paint(ctx, a.map, n, n, dst, { lo: 0, hi: mx || 1, lut: LUT.gray });
  } else paint(ctx, e.map, n, n, dst, { lo: 0, hi: 1, lut: LUT.ice });
  scaleBar(ctx, dst, S.fov * 10, dpr);
  const w0 = S.eelsWin - S.eelsWidth / 2, w1 = S.eelsWin + S.eelsWidth / 2;
  label(ctx, `${w0.toFixed(0)}–${w1.toFixed(0)} eV${e.sub ? ' · background removed' : ''}`, 10 * dpr, 16 * dpr, dpr, { color: C.accent });
  const inWin = P.EDGES.filter((ed) => sim.si.comp[ed.key] && ed.E < w1 && ed.E > w0 - 40);
  if (inWin.length) label(ctx, inWin.map((x) => x.name).join(' · '), 10 * dpr, 36 * dpr, dpr, { color: C.warm, size: 9 });
  else if (e.lowLoss) label(ctx, w1 < 4 ? 'zero-loss: thin areas bright' : 'plasmons: thickness map', 10 * dpr, 36 * dpr, dpr, { color: C.warm, size: 9 });
  label(ctx, `t/λ ≈ ${si.tauMean.toFixed(2)}`, W - 10 * dpr, 16 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });

  const q = s.ctx, x0 = 44 * s.dpr, y0 = 16 * s.dpr, w = s.W - x0 - 10 * s.dpr, h = s.H - y0 - 30 * s.dpr;
  const E0 = e.E0, E1 = e.E1, X = (E) => x0 + ((E - E0) / (E1 - E0)) * w;
  layout.eels = { x0: x0 / s.dpr, w: w / s.dpr, E0, E1 };
  // both views use a log scale: edges sit 10²–10⁴× below the plasmons
  const log = true, edu = !real(S);
  const K = edu ? 1e7 : 1;
  const data = edu ? e.spec : a.spec;
  let mx = 0, mn = Infinity;
  for (let b = 0; b < e.nb; b++) { const v = data[b] * K; mx = Math.max(mx, v); if (v > 0) mn = Math.min(mn, v); }
  const lo = Math.log10(Math.max(1, mn * 0.7)), hi = Math.log10(mx || 10) + 0.08;
  const Y = (v) => y0 + h - clamp((Math.log10(Math.max(1, v * K)) - lo) / (hi - lo || 1), 0, 1) * h;
  // window
  q.fillStyle = 'rgba(111,214,255,0.12)';
  q.fillRect(X(w0), y0, X(w1) - X(w0), h);
  q.strokeStyle = 'rgba(111,214,255,0.8)'; q.lineWidth = 1 * s.dpr;
  q.beginPath(); q.moveTo(X(w0), y0); q.lineTo(X(w0), y0 + h); q.moveTo(X(w1), y0); q.lineTo(X(w1), y0 + h); q.stroke();
  // axes
  font(q, 9, s.dpr); q.fillStyle = C.muted; q.textAlign = 'center'; q.textBaseline = 'top';
  const step = E1 - E0 > 600 ? 200 : E1 - E0 > 200 ? 100 : 10;
  for (let E = Math.ceil(E0 / step) * step; E <= E1; E += step) {
    q.strokeStyle = C.grid; q.beginPath(); q.moveTo(X(E), y0); q.lineTo(X(E), y0 + h); q.stroke();
    q.fillText(`${E}`, X(E), y0 + h + 5 * s.dpr);
  }
  q.fillText('eV', x0 + w - 8 * s.dpr, y0 + h + 15 * s.dpr);
  q.textAlign = 'left';
  // edge contributions (educational)
  if (edu) {
    for (const k in e.edgeCurves) {
      const cv = e.edgeCurves[k], col = P.EL[P.EI[k]].color;
      q.beginPath();
      for (let b = 0; b < e.nb; b++) { const E = E0 + (b + 0.5) * e.dE, yv = Y(e.bgc[b] + cv[b]); b ? q.lineTo(X(E), yv) : q.moveTo(X(E), yv); }
      for (let b = e.nb - 1; b >= 0; b--) { const E = E0 + (b + 0.5) * e.dE; q.lineTo(X(E), Y(e.bgc[b])); }
      q.closePath(); q.fillStyle = col + '55'; q.fill();
    }
    q.setLineDash([3 * s.dpr, 3 * s.dpr]); q.strokeStyle = 'rgba(255,255,255,0.35)'; q.beginPath();
    for (let b = 0; b < e.nb; b++) { const E = E0 + (b + 0.5) * e.dE, yv = Y(e.bgc[b]); b ? q.lineTo(X(E), yv) : q.moveTo(X(E), yv); }
    q.stroke(); q.setLineDash([]);
  }
  q.beginPath();
  for (let b = 0; b < e.nb; b++) { const E = E0 + (b + 0.5) * e.dE, yv = Y(data[b]); b ? q.lineTo(X(E), yv) : q.moveTo(X(E), yv); }
  q.strokeStyle = C.text; q.lineWidth = 1.3 * s.dpr; q.stroke();
  // edge labels
  for (const ed of P.EDGES) {
    if (!si.comp[ed.key] || ed.E < E0 || ed.E > E1) continue;
    const b = Math.floor((ed.E + 6 - E0) / e.dE);
    const yv = Math.max(y0 + 10 * s.dpr, Y(data[Math.min(e.nb - 1, b)] || 0) - 16 * s.dpr);
    label(q, ed.name, X(ed.E), yv, s.dpr, { color: P.EL[P.EI[ed.key]].color, size: 9, align: 'center' });
  }
  if (edu) label(q, '- - background (plasmon tail + power law)', x0 + w, y0 + h - 12 * s.dpr, s.dpr, { color: C.muted, size: 9, align: 'right' });
  label(q, edu ? 'log scale · drag to move the energy window' : 'counts (log)', x0 + w, y0, s.dpr, { color: C.muted, size: 9, align: 'right' });
}
