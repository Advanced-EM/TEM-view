// Advanced techniques: Ronchigram & corrector tuning, CBED/LACBED.
import * as P from './physics.js';
import { paint, label, font, LUT, range, hsv } from './render2d.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;
const C = { accent: '#6fd6ff', warm: '#ffb45e', text: '#e9edf2', muted: '#8a94a3', grid: 'rgba(255,255,255,0.07)' };
const real = (S) => S.clarity === 'real';

function blur(a, n, s) {
  const R = Math.ceil(3 * s), k = [];
  let sum = 0;
  for (let i = -R; i <= R; i++) { const v = Math.exp((-0.5 * i * i) / (s * s)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let i = -R; i <= R; i++) v += a[y * n + ((x + i + n) % n)] * k[i + R]; t[y * n + x] = v; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let i = -R; i <= R; i++) v += t[((y + i + n) % n) * n + x] * k[i + R]; a[y * n + x] = v; }
  return a;
}

// ======================================================================= Ronchigram
export const AB_TERMS = [
  // key, label, order n of θ (for phase at aperture edge), prefactor, unit scale (to Å)
  ['C1', 'C1 defocus', 2, 0.5], ['A1', 'A1 2-fold astig.', 2, 0.5], ['B2', 'B2 axial coma', 3, 1], ['A2', 'A2 3-fold astig.', 3, 1 / 3], ['C3', 'C3 spherical', 4, 0.25], ['A3', 'A3 4-fold astig.', 4, 0.25],
];

export class Ronch {
  constructor(sim) { this.sim = sim; this.stale = true; }
  film(n, dx) {
    if (this._film && this._fdx === dx) return this._film;
    const rng = P.mulberry32(99), a = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) a[i] = rng() - 0.5;
    blur(a, n, 0.75 / dx);
    let m = 0, v = 0;
    for (let i = 0; i < n * n; i++) m += a[i];
    m /= n * n;
    for (let i = 0; i < n * n; i++) { a[i] -= m; v += a[i] * a[i]; }
    const sc = 0.45 / Math.sqrt(v / (n * n));
    for (let i = 0; i < n * n; i++) a[i] *= sc;
    this._film = a; this._fdx = dx;
    return a;
  }
  compute() {
    const sim = this.sim, S = sim.S, lam = sim.lam, n = 512;
    const ap = S.ronchAp * 1e-3, thMax = Math.max(0.065, ap * 1.25), dx = lam / (2 * thMax);
    const film = this.film(n, dx);
    const kAp = ap / lam, df = S.df * 10, Cs = sim.CsA(), ab = sim.abA();
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const kx = P.freq(x, n, dx), ky = P.freq(y, n, dx), k = Math.hypot(kx, ky);
        const A = clamp((kAp - k) * n * dx + 0.5, 0, 1);
        if (!A) continue;
        const c = P.chiFull(kx, ky, lam, df, Cs, ab);
        re[y * n + x] = A * Math.cos(-c); im[y * n + x] = A * Math.sin(-c);
      }
    P.fft2(re, im, n, true);
    for (let i = 0; i < n * n; i++) {
      const c = Math.cos(film[i]), s = Math.sin(film[i]), a = re[i], b = im[i];
      re[i] = a * c - b * s; im[i] = a * s + b * c;
    }
    P.fft2(re, im, n);
    const W = 256, thD = ap * 1.08, out = new Float32Array(W * W);
    for (let j = 0; j < W; j++)
      for (let i = 0; i < W; i++) {
        const tx = ((i + 0.5) / W * 2 - 1) * thD, ty = ((j + 0.5) / W * 2 - 1) * thD;
        if (Math.hypot(tx, ty) > ap) continue;
        const fx = (tx / lam) * n * dx, fy = (ty / lam) * n * dx;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
        const g = (x, y) => { const X = (x + n) % n, Y = (y + n) % n, q = Y * n + X; return re[q] * re[q] + im[q] * im[q]; };
        out[j * W + i] = (g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax) * (1 - ay) + (g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax) * ay;
      }
    this.disp = { arr: out, W, thD, ap };
    this.analyze();
    this.stale = false;
  }
  // Flat-phase ("π/4") angle and the phase each aberration contributes at the aperture edge.
  analyze() {
    const sim = this.sim, S = sim.S, lam = sim.lam, ab = sim.abA(), df = S.df * 10, Cs = sim.CsA();
    const ap = S.ronchAp * 1e-3;
    let flat = ap;
    outer: for (let r = 0.0002; r <= ap; r += 0.00025)
      for (let k = 0; k < 90; k++) {
        if (Math.abs(P.chiAngle(r, (k / 90) * 2 * Math.PI, lam, df, Cs, ab)) > Math.PI / 4) { flat = r - 0.00025; break outer; }
      }
    this.flat = Math.max(0.0005, flat);
    const mags = { C1: Math.abs(df), A1: Math.abs(ab.A1), B2: Math.abs(ab.B2) * 3 / 3, A2: Math.abs(ab.A2), C3: Math.abs(Cs), A3: Math.abs(ab.A3) };
    // phase (units of π/4) at θ = 30 mrad, a common reference angle for tuning
    const th = 0.03;
    this.budget = AB_TERMS.map(([k, name, ord, pre]) => [k, name, ((2 * Math.PI / lam) * pre * Math.pow(th, ord) * mags[k] * (k === 'B2' ? 3 : 1)) / (Math.PI / 4)]);
    const PW = 128, pp = new Float32Array(PW * PW);
    for (let j = 0; j < PW; j++)
      for (let i = 0; i < PW; i++) {
        const tx = ((i + 0.5) / PW * 2 - 1) * ap, ty = ((j + 0.5) / PW * 2 - 1) * ap, r = Math.hypot(tx, ty);
        pp[j * PW + i] = r > ap ? NaN : P.chiAngle(r, Math.atan2(ty, tx), lam, df, Cs, ab);
      }
    this.plate = { arr: pp, W: PW };
  }
}

export function drawRonch(sim, S, m, s) {
  const R = sim.ronch, d = R.disp;
  if (!d) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H];
  const [lo, hi] = range(d.arr, 0.02, 0.995);
  paint(ctx, d.arr, d.W, d.W, dst, { lo: lo * 0.5, hi, lut: real(S) ? LUT.gray : LUT.ice, gamma: 0.8, noise: real(S) ? 60 : 0 });
  const cx = W / 2, cy = H / 2, px = W / (2 * d.thD);
  ctx.lineWidth = 1.2 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = C.warm;
  ctx.beginPath(); ctx.arc(cx, cy, R.flat * px, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  label(ctx, `π/4 flat phase: ${(R.flat * 1000).toFixed(1)} mrad`, 10 * dpr, 16 * dpr, dpr, { color: C.warm });
  const dp = (0.61 * sim.lam) / R.flat;
  label(ctx, `→ best probe ≈ ${dp.toFixed(2)} Å`, 10 * dpr, 36 * dpr, dpr, { color: C.accent, size: 9 });
  if (!real(S)) label(ctx, 'amorphous carbon · shadow image', W - 10 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });
  // scale ticks every 10 mrad
  font(ctx, 9, dpr); ctx.fillStyle = C.muted;
  for (let t = 10; t < d.thD * 1000; t += 10) { ctx.fillRect(cx + t * 1e-3 * px, H - 6 * dpr, 1 * dpr, 5 * dpr); }

  // secondary: phase plate + aberration budget
  const q = s.ctx, sz = Math.min(s.H, s.W * 0.44), pl = R.plate;
  const { c, ctx: oc, id } = offscreen(pl.W, pl.W);
  for (let i = 0; i < pl.W * pl.W; i++) {
    const v = pl.arr[i], p = i * 4;
    if (Number.isNaN(v)) { id.data[p] = 6; id.data[p + 1] = 8; id.data[p + 2] = 11; id.data[p + 3] = 255; continue; }
    const within = Math.abs(v) <= Math.PI / 4;
    const [r, g, b] = hsv((((v / (2 * Math.PI)) % 1) + 1) % 1, 0.75, within ? 1 : 0.55);
    id.data[p] = r; id.data[p + 1] = g; id.data[p + 2] = b; id.data[p + 3] = 255;
  }
  oc.putImageData(id, 0, 0);
  q.imageSmoothingEnabled = true;
  q.drawImage(c, 0, 0, pl.W, pl.W, 0, 0, sz, sz);
  q.strokeStyle = '#fff'; q.setLineDash([3 * s.dpr, 3 * s.dpr]); q.lineWidth = 1 * s.dpr;
  q.beginPath(); q.arc(sz / 2, sz / 2, (R.flat / (S.ronchAp * 1e-3)) * sz / 2, 0, 7); q.stroke(); q.setLineDash([]);
  label(q, 'aberration phase χ (wrapped)', 8 * s.dpr, 14 * s.dpr, s.dpr, { color: C.accent, size: 9 });
  // budget bars
  const x0 = sz + 16 * s.dpr, w = s.W - x0 - 10 * s.dpr, rowH = (s.H - 40 * s.dpr) / R.budget.length;
  label(q, 'phase at 30 mrad  (units of π/4)', x0, 12 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  const maxV = Math.max(4, ...R.budget.map((b) => b[2]));
  R.budget.forEach(([k, name, v], i) => {
    const y = 28 * s.dpr + i * rowH, bw = Math.min(1, Math.log10(1 + v) / Math.log10(1 + maxV)) * (w - 80 * s.dpr);
    font(q, 10, s.dpr); q.fillStyle = C.text; q.textBaseline = 'middle';
    q.fillText(name, x0, y + rowH * 0.35);
    q.fillStyle = v <= 1 ? '#5fe3a8' : v <= 4 ? C.warm : '#ff7d7d';
    q.fillRect(x0, y + rowH * 0.55, Math.max(2 * s.dpr, bw), rowH * 0.25);
    font(q, 9, s.dpr); q.fillStyle = C.muted;
    q.fillText(v < 0.05 ? '≈0' : v.toFixed(v < 10 ? 1 : 0), x0 + Math.max(2 * s.dpr, bw) + 6 * s.dpr, y + rowH * 0.68);
  });
  const xl = x0 + (Math.log10(2) / Math.log10(1 + maxV)) * (w - 80 * s.dpr);
  q.strokeStyle = 'rgba(95,227,168,0.6)'; q.setLineDash([2 * s.dpr, 3 * s.dpr]);
  q.beginPath(); q.moveTo(xl, 22 * s.dpr); q.lineTo(xl, s.H - 8 * s.dpr); q.stroke(); q.setLineDash([]);
}

const offs = new Map();
function offscreen(w, h) {
  const k = w + 'x' + h;
  let o = offs.get(k);
  if (!o) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); o = { c, ctx, id: ctx.createImageData(w, h) }; offs.set(k, o); }
  return o;
}

// ======================================================================= CBED / LACBED
export class CBED {
  constructor(sim) { this.sim = sim; this.stale = true; }
  // Reflection lists are built once per crystal (unstrained); strain and voltage only rescale and re-filter them.
  base(spec) {
    if (this._base?.id === spec.id) return this._base;
    const cr = P.CRYST[spec.id], zolz = [], folz = [];
    let H = Infinity;
    for (let h = -4; h <= 4; h++) for (let k = -4; k <= 4; k++) for (let l = -4; l <= 4; l++) {
      const g = P.zoneG(cr, h, k, l);
      if (g[2] > 1e-6 && g[2] < H && P.structF(cr, h, k, l) > 0.01) H = g[2];
    }
    const gMax = Math.sqrt((2 * H) / P.wavelength(300)) + 1.2, gMin = Math.sqrt((2 * H) / P.wavelength(60)) - 1.2;
    const hm = Math.ceil(gMax * cr.a * 1.5) + 1;
    for (let h = -hm; h <= hm; h++) for (let k = -hm; k <= hm; k++) for (let l = -hm; l <= hm; l++) {
      const g = P.zoneG(cr, h, k, l), g2 = Math.hypot(g[0], g[1]);
      if (Math.abs(g[2]) < 1e-6) {
        if (g2 === 0 || g2 > 2.2) continue;
        const F = P.structF(cr, h, k, l);
        if (F > 0.05) zolz.push({ h, k, l, gx: g[0], gy: g[1], g: g2, F });
      } else if (Math.abs(g[2] - H) < 1e-6 && g2 > Math.min(gMin, 2) && g2 < gMax) {
        const F = P.structF(cr, h, k, l);
        if (F > 0.02) folz.push({ h, k, l, gx: g[0], gy: g[1], g: g2, F });
      }
    }
    return (this._base = { id: spec.id, cr, zolz, folz, H });
  }
  lists() {
    const sim = this.sim, S = sim.S, spec = sim.spec, sc = 1 + S.strain / 100, lam = sim.lam;
    const key = [spec.id, S.strain, S.kV].join('|');
    if (this._key === key) return this._lists;
    const B = this.base(spec), H = B.H / sc, GH = Math.sqrt((2 * H) / lam);
    const zolz = B.zolz.map((z) => ({ ...z, gx: z.gx / sc, gy: z.gy / sc, g: z.g / sc, xi: P.extinction(B.cr, z.F, S.kV) }));
    const layers = [];
    for (const o of B.folz) {
      const g = o.g / sc;
      if (Math.abs(g - GH) > 1.1) continue;
      layers.push({ ...o, gx: o.gx / sc, gy: o.gy / sc, g, d: (H - (lam * (g * g + H * H)) / 2) / g });
    }
    const Fm = Math.max(1e-6, ...layers.map((x) => x.F));
    for (const x of layers) x.w = x.F / Fm;
    this._key = key;
    this._lists = { zolz, holz: layers.filter((x) => x.w > 0.08), H, GH };
    return this._lists;
  }
  compute() {
    const sim = this.sim, S = sim.S, spec = sim.spec, lam = sim.lam, t = S.thick * 10;
    const L = this.lists(), lac = S.cbedKind === 'lacbed', a = sim.alpha();
    const W = lac ? 200 : 256, span = lac ? a * 1.12 : Math.max(a * 1.3, 0.022 * (1000 / S.camL));
    const tx0 = S.tiltX * DEG, ty0 = S.tiltY * DEG;
    const rotated = spec.grainRot.map((r) => {
      const c = Math.cos(r), s = Math.sin(r), rot = (o) => ({ ...o, gx: o.gx * c - o.gy * s, gy: o.gx * s + o.gy * c });
      const zolz = L.zolz.map(rot);
      return {
        zolz,
        near: zolz.filter((z) => z.g * lam < 2.6 * a + 0.004), // reflections whose Bragg lines fall inside the disk
        holz: L.holz.filter((o) => Math.abs(o.d) < span * 1.05).map(rot).map((o) => ({ ...o, ux: o.gx / o.g, uy: o.gy / o.g })),
      };
    });
    const Ig = (z, tx, ty) => {
      const s = -(z.gx * tx + z.gy * ty) - (lam * z.g * z.g) / 2, xs = z.xi * s;
      // far from the Bragg condition the fringes are finer than a pixel: use their average, ½/(ξs)²
      if (xs > 6 || xs < -6) return 0.5 / (xs * xs);
      const se = Math.sqrt(s * s + 1 / (z.xi * z.xi)), sn = Math.sin(Math.PI * t * se);
      return (sn * sn) / (z.xi * z.xi * se * se);
    };
    const lw = 0.00011;
    const I0 = (R, tx, ty) => {
      let v = 1;
      for (const z of R.near) v *= 1 - Ig(z, tx, ty);
      if (S.holz) for (const G of R.holz) {
        const dd = tx * G.ux + ty * G.uy - G.d;
        if (Math.abs(dd) < 4 * lw) v *= 1 - 0.6 * G.w * Math.exp(-(dd * dd) / (lw * lw));
      }
      return Math.max(0, v);
    };
    const out = new Float32Array(W * W);
    const grainC = spec.grainAt(S.cx, S.cy);
    let shadow = null, dh = 0;
    if (lac) {
      dh = 210 / a;
      const n = 128, dxs = 440 / n;
      shadow = sim.maps({ n, dx: dxs });
      let mx = 0;
      for (let i = 0; i < n * n; i++) mx = Math.max(mx, shadow.zHi[i]);
      shadow = { ...shadow, mx };
    }
    for (let j = 0; j < W; j++)
      for (let i = 0; i < W; i++) {
        const thx = ((i + 0.5) / W * 2 - 1) * span, thy = ((j + 0.5) / W * 2 - 1) * span;
        let v = 0;
        if (lac) {
          if (Math.hypot(thx, thy) > a) continue;
          const X = S.cx + thx * dh, Y = S.cy + thy * dh, gi = spec.grainAt(X, Y);
          v = gi < 0 ? 0.92 : I0(rotated[gi], thx + tx0, thy + ty0);
          const sx = Math.floor((X - shadow.x0) / shadow.dx), sy = Math.floor((Y - shadow.y0) / shadow.dx);
          if (sx >= 0 && sy >= 0 && sx < shadow.n && sy < shadow.n) v *= 1 - 0.3 * Math.sqrt(shadow.zHi[sy * shadow.n + sx] / shadow.mx);
        } else {
          if (grainC < 0) { if (Math.hypot(thx, thy) <= a) v = 0.9; out[j * W + i] = v; continue; }
          const R = rotated[grainC];
          if (Math.hypot(thx, thy) <= a) v += I0(R, thx + tx0, thy + ty0);
          for (const z of R.zolz) {
            const cx = lam * z.gx, cy = lam * z.gy, dx = thx - cx, dy = thy - cy;
            if (dx * dx + dy * dy <= a * a) v += Ig(z, dx + tx0, dy + ty0);
          }
        }
        out[j * W + i] = v;
      }
    this.disp = { arr: out, W, span, a, lac, grainC };
    this.rot = rotated;
    this.fringeFit(rotated, grainC, t);
    this.stale = false;
  }
  // Kossel–Möllenstedt thickness measurement from the fringes in one diffracted disk.
  fringeFit(rotated, gi, t) {
    this.fit = null;
    if (this.disp.lac || gi < 0) return;
    const sim = this.sim, lam = sim.lam, a = sim.alpha(), R = rotated[gi];
    // like a microscopist: pick the visible, non-overlapping disk that shows the most fringes
    const cand = R.zolz.filter((z) => z.g * lam + a < this.disp.span * 1.05 && z.g * lam > 2 * a * 0.9);
    const tx0 = sim.S.tiltX * DEG, ty0 = sim.S.tiltY * DEG, N = 400;
    const rock = (z) => {
      const prof = [], ux = z.gx / z.g, uy = z.gy / z.g;
      for (let i = 0; i < N; i++) {
        const u = (i / (N - 1) * 2 - 1) * a, tx = u * ux + tx0, ty = u * uy + ty0;
        const s = -(z.gx * tx + z.gy * ty) - (lam * z.g * z.g) / 2;
        const se = Math.sqrt(s * s + 1 / (z.xi * z.xi)), sn = Math.sin(Math.PI * t * se);
        prof.push([s, (sn * sn) / (z.xi * z.xi * se * se)]);
      }
      prof.sort((p, q) => p[0] - q[0]);
      // two-beam intensity is symmetric in s, so fringe minima are indexed by |s| on either side of the Bragg condition
      const raw = [];
      for (let i = 1; i < N - 1; i++) if (prof[i][1] < prof[i - 1][1] && prof[i][1] <= prof[i + 1][1] && prof[i][1] < 0.02) raw.push(Math.abs(prof[i][0]));
      raw.sort((p, q) => p - q);
      const mins = raw.filter((v, i) => i === 0 || v - raw[i - 1] > 2e-5);
      return { prof, mins };
    };
    let z = null, prof = null, mins = [];
    for (const c of cand) {
      const r = rock(c);
      if (!z || r.mins.length > mins.length || (r.mins.length === mins.length && c.F > z.F)) { z = c; prof = r.prof; mins = r.mins; }
    }
    if (!z) return;
    let best = null;
    if (mins.length >= 3) {
      for (let k0 = 1; k0 <= 8; k0++) {
        const X = mins.map((_, i) => 1 / (k0 + i) ** 2), Yv = mins.map((sv, i) => (sv / (k0 + i)) ** 2);
        const n = X.length, mx = X.reduce((p, v) => p + v, 0) / n, my = Yv.reduce((p, v) => p + v, 0) / n;
        let sxy = 0, sxx = 0, res = 0;
        for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Yv[i] - my); sxx += (X[i] - mx) ** 2; }
        const slope = sxx ? sxy / sxx : 0, icpt = my - slope * mx;
        for (let i = 0; i < n; i++) res += (Yv[i] - (icpt + slope * X[i])) ** 2;
        if (icpt > 0 && slope < 0 && (!best || res < best.res)) best = { res, k0, t: 1 / Math.sqrt(icpt), xi: 1 / Math.sqrt(-slope), X, Y: Yv, slope, icpt };
      }
    }
    this.fit = { z, prof, mins, best };
  }
}

export function drawCBED(sim, S, m, s) {
  const cb = sim.cbed, d = cb.disp;
  if (!d) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H];
  let mx = 0;
  for (let i = 0; i < d.arr.length; i++) mx = Math.max(mx, d.arr[i]);
  paint(ctx, d.arr, d.W, d.W, dst, { lo: 0, hi: mx * (d.lac ? 1 : 0.9), lut: real(S) ? LUT.gray : d.lac ? LUT.ice : LUT.magma, gamma: d.lac ? 1.3 : 0.7, noise: real(S) ? 120 : 0 });
  const px = W / (2 * d.span), cx = W / 2, cy = H / 2;
  if (d.lac) {
    label(ctx, `LACBED · α = ${Math.round(d.a * 1000)} mrad · shadow image + Bragg/HOLZ lines`, 10 * dpr, 16 * dpr, dpr, { color: C.accent, size: 9 });
    if (!real(S) && sim.spec.id === 'sto') label(ctx, 'lines break at the grain boundary', cx, H - 16 * dpr, dpr, { color: C.warm, size: 9, align: 'center' });
  } else {
    if (d.grainC < 0) label(ctx, 'probe on amorphous material: drag the stage onto a crystal', cx, 20 * dpr, dpr, { color: C.warm, size: 9, align: 'center' });
    else label(ctx, `CBED · α = ${Math.round(d.a * 1000)} mrad · ${P.CRYST[sim.spec.id].name}`, 10 * dpr, 16 * dpr, dpr, { color: C.accent, size: 9 });
    if (!real(S) && d.grainC >= 0) {
      const R = cb.rot[d.grainC], lam = sim.lam;
      const shown = R.zolz.filter((z) => Math.abs(lam * z.gx) < d.span * 0.9 && Math.abs(lam * z.gy) < d.span * 0.9).sort((p, q) => p.g - q.g).slice(0, 6);
      for (const z of shown) label(ctx, `${z.h}${z.k}${z.l}`.replace(/-(\d)/g, '$1̅'), cx + lam * z.gx * px, cy + lam * z.gy * px - d.a * px - 8 * dpr, dpr, { color: '#ffe2b8', size: 9, align: 'center' });
      if (S.holz) label(ctx, 'HOLZ lines', cx + d.a * px * 0.35, cy - d.a * px * 0.55, dpr, { color: C.accent, size: 9 });
      if (d.a > sim.lam * (shown[0]?.g ?? 1) / 2) label(ctx, 'disks overlap: reduce α (Kossel pattern)', cx, H - 16 * dpr, dpr, { color: C.warm, size: 9, align: 'center' });
    }
  }
  // secondary
  const q = s.ctx;
  if (d.lac) return drawHOLZZoom(sim, S, s, d);
  const f = cb.fit;
  if (!f) { label(q, 'no crystal under the probe', 10 * s.dpr, 16 * s.dpr, s.dpr, { color: C.muted }); return; }
  const x0 = 38 * s.dpr, y0 = 22 * s.dpr, w = s.W * 0.58 - x0, h = s.H - y0 - 30 * s.dpr;
  const smin = f.prof[0][0], smax = f.prof[f.prof.length - 1][0];
  const X = (sv) => x0 + ((sv - smin) / (smax - smin)) * w;
  let pm = 0;
  for (const p of f.prof) pm = Math.max(pm, p[1]);
  q.strokeStyle = C.grid; q.lineWidth = 1 * s.dpr;
  q.beginPath(); q.moveTo(x0, y0 + h); q.lineTo(x0 + w, y0 + h); if (smin < 0 && smax > 0) { q.moveTo(X(0), y0); q.lineTo(X(0), y0 + h); } q.stroke();
  q.beginPath();
  f.prof.forEach(([sv, v], i) => { const y = y0 + h - (v / pm) * h * 0.95; i ? q.lineTo(X(sv), y) : q.moveTo(X(sv), y); });
  q.strokeStyle = C.warm; q.lineWidth = 1.5 * s.dpr; q.stroke();
  for (let i = 1; i < f.prof.length - 1; i++) {
    const [sv, v] = f.prof[i];
    if (v < f.prof[i - 1][1] && v <= f.prof[i + 1][1] && v < 0.02) { q.fillStyle = C.accent; q.beginPath(); q.arc(X(sv), y0 + h, 3 * s.dpr, 0, 7); q.fill(); }
  }
  font(q, 9, s.dpr); q.fillStyle = C.muted; q.textAlign = 'center'; q.textBaseline = 'top';
  q.fillText('excitation error s (Å⁻¹)', x0 + w / 2, y0 + h + 12 * s.dpr);
  q.fillText(smin.toExponential(1), x0, y0 + h + 2 * s.dpr); q.fillText(smax.toExponential(1), x0 + w, y0 + h + 2 * s.dpr); q.textAlign = 'left';
  label(q, `rocking curve across the ${`${f.z.h}${f.z.k}${f.z.l}`.replace(/-(\d)/g, '$1̅')} disk`, x0, 10 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  // K–M plot
  const bx = s.W * 0.62, bw = s.W - bx - 10 * s.dpr, by = 22 * s.dpr, bh = s.H * 0.5;
  if (f.best) {
    const b = f.best, xmax = Math.max(...b.X) * 1.1, ymax = Math.max(b.icpt, ...b.Y) * 1.1;
    q.strokeStyle = C.grid; q.strokeRect(bx, by, bw, bh);
    q.strokeStyle = C.accent; q.beginPath(); q.moveTo(bx, by + bh - (b.icpt / ymax) * bh); q.lineTo(bx + bw, by + bh - ((b.icpt + b.slope * xmax) / ymax) * bh); q.stroke();
    b.X.forEach((xv, i) => { q.fillStyle = C.warm; q.beginPath(); q.arc(bx + (xv / xmax) * bw, by + bh - (b.Y[i] / ymax) * bh, 3 * s.dpr, 0, 7); q.fill(); });
    font(q, 8.5, s.dpr); q.fillStyle = C.muted; q.fillText('(sᵢ/nᵢ)² vs 1/nᵢ²', bx + 4 * s.dpr, by + 4 * s.dpr);
    label(q, `thickness t = ${(b.t / 10).toFixed(1)} nm`, bx, by + bh + 16 * s.dpr, s.dpr, { color: C.accent });
    label(q, `true ${S.thick} nm · ξg = ${(b.xi / 10).toFixed(0)} nm`, bx, by + bh + 36 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  } else label(q, 'need ≥3 fringes: thicken the sample or widen α', bx, by + 10 * s.dpr, s.dpr, { color: C.warm, size: 9 });
}

function drawHOLZZoom(sim, S, s, d) {
  const q = s.ctx, cb = sim.cbed, gi = sim.spec.grainAt(S.cx, S.cy);
  const lam = sim.lam, sc = 1 + S.strain / 100;
  const L = cb.lists();
  label(q, `HOLZ ring: H = ${L.H.toFixed(3)} Å⁻¹, G_H ≈ ${L.GH.toFixed(2)} Å⁻¹ (${(lam * L.GH * 1000).toFixed(0)} mrad)`, 10 * s.dpr, 14 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  if (gi < 0 || !L.holz.length) { label(q, 'no HOLZ lines here (amorphous or no layer)', 10 * s.dpr, 38 * s.dpr, s.dpr, { color: C.warm, size: 9 }); return; }
  // strongest lines inside the disk and their strain sensitivity
  // one representative per symmetry-equivalent family (same distance from the disk centre)
  const seen = new Set();
  const lines = cb.rot[gi].holz.filter((G) => Math.abs(G.d) < d.a).sort((p, q2) => q2.w - p.w)
    .filter((G) => { const k = G.d.toFixed(5); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  const dd = (G) => { // dd/dε in mrad per 0.1% strain (lattice expands → G and H shrink)
    const e = 0.001, H = L.H, g = G.g;
    const d0 = (H - (lam * (g * g + H * H)) / 2) / g;
    const H1 = H / (1 + e), g1 = g / (1 + e), d1 = (H1 - (lam * (g1 * g1 + H1 * H1)) / 2) / g1;
    return (d1 - d0) * 1000;
  };
  let y = 38 * s.dpr;
  label(q, 'strongest HOLZ lines in the disk', 10 * s.dpr, y, s.dpr, { color: C.accent, size: 9 }); y += 20 * s.dpr;
  font(q, 10, s.dpr); q.textBaseline = 'middle';
  for (const G of lines) {
    q.fillStyle = C.text;
    q.fillText(`(${G.h} ${G.k} ${G.l})`, 14 * s.dpr, y);
    q.fillStyle = C.muted;
    q.fillText(`at ${(G.d * 1000).toFixed(2)} mrad`, 120 * s.dpr, y);
    q.fillStyle = C.warm;
    q.fillText(`${dd(G) >= 0 ? '+' : ''}${dd(G).toFixed(3)} mrad per 0.1 % strain`, 240 * s.dpr, y);
    y += 18 * s.dpr;
  }
  label(q, `λ = ${(lam * 100).toFixed(3)} pm · strain ${S.strain >= 0 ? '+' : ''}${S.strain.toFixed(2)} % · a = ${(P.CRYST[sim.spec.id].a * sc).toFixed(4)} Å`, 10 * s.dpr, s.H - 14 * s.dpr, s.dpr, { color: C.muted, size: 9 });
}
