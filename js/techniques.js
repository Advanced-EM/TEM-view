// Advanced techniques: Ronchigram & corrector tuning, CBED/LACBED, 3D electron diffraction (MicroED), tomography.
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

// ======================================================================= 3D electron diffraction (MicroED)
export class MicroED {
  constructor(sim) { this.sim = sim; this.reset(); }
  reset() {
    const sim = this.sim, S = sim.S, cr = P.CRYST[sim.spec.id];
    const rng = P.mulberry32(314 + sim.spec.id.length);
    const [a1, a2, a3] = [rng() * 6.28, Math.acos(2 * rng() - 1), rng() * 6.28];
    this.U = mul(rz(a3), mul(rx(a2), rz(a1)));
    const hm = Math.ceil(1.25 * cr.a), refl = [];
    let Fm = 0;
    for (let h = -hm; h <= hm; h++) for (let k = -hm; k <= hm; k++) for (let l = -hm; l <= hm; l++) {
      const G = [h / cr.a, k / cr.a, l / cr.a], g = Math.hypot(...G);
      if (!g || g > 1.25) continue;
      const F = P.structF(cr, h, k, l);
      refl.push({ h, k, l, G, g, F2: F * F, allowed: F > 0.02 });
      Fm = Math.max(Fm, F * F);
    }
    this.refl = refl; this.Fm = Fm; this.cr = cr;
    this.phi = -S.medRange; this.acc = 0; this.frames = 0; this.obs = new Map(); this.spots = []; this.trail = [];
    this.running = true; this.key = [sim.spec.id, S.medRange, S.medOsc, S.thick, S.kV].join('|');
    this.frame(this.phi, this.phi + S.medOsc);
  }
  update(dt) {
    const S = this.sim.S;
    const key = [this.sim.spec.id, S.medRange, S.medOsc, S.thick, S.kV].join('|');
    if (key !== this.key) this.reset();
    if (!this.running || S.paused) return false;
    this.acc += S.medRate * dt * S.speed;
    let changed = false;
    while (this.acc >= S.medOsc && this.running) {
      this.acc -= S.medOsc;
      this.frame(this.phi, this.phi + S.medOsc);
      this.phi += S.medOsc;
      this.frames++;
      changed = true;
      if (this.phi >= S.medRange) { this.running = false; this.analyze(); }
    }
    return changed;
  }
  frame(p0, p1) {
    const sim = this.sim, lam = sim.lam, t = sim.S.thick * 10, w = 1 / t;
    const R0 = mul(rx(p0 * DEG), this.U), R1 = mul(rx(p1 * DEG), this.U), spots = [];
    const dyn = real(sim.S) ? Math.min(1.2, sim.S.thick / 60) : 0;
    for (const r of this.refl) {
      if (!r.allowed) continue;
      const G0 = mv(R0, r.G), G1 = mv(R1, r.G);
      const s0 = -(G0[2] + (lam * r.g * r.g) / 2), s1 = -(G1[2] + (lam * r.g * r.g) / 2);
      const mn = Math.min(Math.abs(s0), Math.abs(s1));
      const part = s0 * s1 <= 0 ? 1 : Math.exp(-((mn / w) ** 2));
      if (part < 0.02) continue;
      let I = (r.F2 / this.Fm) * part;
      if (dyn) I *= Math.exp(dyn * (P.gauss() * 0.6));
      spots.push({ x: (G0[0] + G1[0]) / 2, y: (G0[1] + G1[1]) / 2, I, r });
      const k = `${r.h},${r.k},${r.l}`, o = this.obs.get(k);
      if (!o || o.I < I) this.obs.set(k, { I, r });
    }
    this.spots = spots;
    (this.trail ||= []).unshift(spots);
    if (this.trail.length > 10) this.trail.pop();
  }
  analyze() {
    const obs = [...this.obs.values()], allowed = this.refl.filter((r) => r.allowed).length;
    const strong = obs.filter((o) => o.I > 1e-3);
    const par = (r) => ((r.h & 1) === (r.k & 1) && (r.k & 1) === (r.l & 1));
    let lattice = 'P (primitive)';
    if (strong.length && strong.every((o) => par(o.r))) lattice = 'F (face-centred)';
    else if (strong.length && strong.every((o) => (((o.r.h + o.r.k + o.r.l) % 2) + 2) % 2 === 0)) lattice = 'I (body-centred)';
    let extra = '';
    if (lattice.startsWith('F')) {
      const evens = strong.filter((o) => o.r.h % 2 === 0);
      if (evens.length && evens.every((o) => (((o.r.h + o.r.k + o.r.l) % 4) + 4) % 4 === 0)) extra = ' + d-glide (h+k+l = 4n for all-even)';
    }
    const aFit = median(strong.map((o) => Math.hypot(o.r.h, o.r.k, o.r.l) / o.r.g));
    this.result = { completeness: obs.length / allowed, lattice: lattice + extra, a: aFit, n: obs.length };
  }
}
const median = (v) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

export function drawMicroED(sim, S, m, s, time) {
  const M = sim.med, { ctx, W, H, dpr } = m;
  const Gd = 1.3, px = W / (2 * Gd), cx = W / 2, cy = H / 2;
  if (real(S)) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.6);
    g.addColorStop(0, '#2a2a2a'); g.addColorStop(1, '#070707');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'lighter';
  // current frame plus fading trail of the last few frames
  const trail = M.trail.length ? M.trail : [M.spots];
  for (let age = trail.length - 1; age >= 0; age--) for (const sp0 of trail[age]) {
    const sp = { ...sp0, I: sp0.I * Math.pow(0.55, age) };
    const x = cx + sp.x * px, y = cy + sp.y * px;
    if (x < 0 || y < 0 || x > W || y > H) continue;
    const I = real(S) ? P.poisson(sp.I * 400) / 400 : sp.I;
    const r = (1.8 + 3 * Math.log10(1 + 200 * I)) * dpr, a = clamp(0.55 + Math.log10(1 + 2000 * I) / 3, 0, 1);
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
    gr.addColorStop(0, real(S) ? `rgba(255,255,255,${a})` : `rgba(255,226,184,${a})`); gr.addColorStop(1, 'rgba(255,180,94,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#050608'; ctx.beginPath(); ctx.arc(cx, cy, 6 * dpr, 0, 7); ctx.fill(); ctx.fillRect(cx - 2.5 * dpr, cy, 5 * dpr, H);
  ctx.setLineDash([4 * dpr, 5 * dpr]); ctx.strokeStyle = 'rgba(111,214,255,0.4)'; ctx.lineWidth = 1 * dpr;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke(); ctx.setLineDash([]);
  label(ctx, 'rotation axis', W - 8 * dpr, cy - 12 * dpr, dpr, { color: C.accent, size: 9, align: 'right' });
  label(ctx, `φ = ${M.phi >= 0 ? '+' : ''}${M.phi.toFixed(1)}° · frame ${M.frames}`, 10 * dpr, 16 * dpr, dpr, { color: C.warm });
  label(ctx, 'fading: previous frames', 10 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 8.5 });
  if (!real(S)) {
    const top = [...M.spots].sort((p, q) => q.I - p.I).slice(0, 5);
    for (const sp of top) label(ctx, `${sp.r.h}${sp.r.k}${sp.r.l}`.replace(/-(\d)/g, '$1̅'), cx + sp.x * px, cy + sp.y * px - 12 * dpr, dpr, { color: '#ffe2b8', size: 8.5, align: 'center' });
  }
  // secondary: reciprocal space reconstruction
  const q = s.ctx, sw = s.W * 0.6, sh = s.H, ox = sw / 2, oy = sh / 2 + 6 * s.dpr, scl = Math.min(sw, sh) / (2 * 1.35);
  const ps = time * 0.35, el = 0.35;
  const V = mul(rx(el), ry(ps));
  const proj = (G) => { const p = mv(V, G); return [ox + p[0] * scl, oy - p[1] * scl, p[2]]; };
  const pts = [];
  for (const r of M.refl) {
    if (!r.allowed) continue;
    const o = M.obs.get(`${r.h},${r.k},${r.l}`);
    const [x, y, z] = proj(r.G);
    pts.push({ x, y, z, o });
  }
  pts.sort((p1, p2) => p1.z - p2.z);
  for (const p of pts) {
    if (!p.o) { q.fillStyle = 'rgba(255,255,255,0.08)'; q.fillRect(p.x - 1 * s.dpr, p.y - 1 * s.dpr, 2 * s.dpr, 2 * s.dpr); continue; }
    const v = clamp(Math.log10(1 + 300 * p.o.I) / 2.5, 0.15, 1);
    const [r, g, b] = hsv(0.08 + 0.45 * (1 - v), 0.7, 1);
    q.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.35 + 0.65 * v})`;
    q.beginPath(); q.arc(p.x, p.y, (1.2 + 2.2 * v) * s.dpr, 0, 7); q.fill();
  }
  const axes = [[[1 / M.cr.a * 3, 0, 0], 'a*'], [[0, 1 / M.cr.a * 3, 0], 'b*'], [[0, 0, 1 / M.cr.a * 3], 'c*']];
  for (const [G, nm] of axes) {
    const [x, y] = proj(G);
    q.strokeStyle = C.accent; q.lineWidth = 1.2 * s.dpr; q.beginPath(); q.moveTo(ox, oy); q.lineTo(x, y); q.stroke();
    font(q, 10, s.dpr); q.fillStyle = C.accent; q.fillText(nm, x + 3 * s.dpr, y);
  }
  label(q, 'reconstructed reciprocal space', 8 * s.dpr, 12 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  // results
  const tx = sw + 12 * s.dpr;
  const allowed = M.refl.filter((r) => r.allowed).length;
  const rows = [
    ['frames', `${M.frames}`],
    ['tilt range', `±${S.medRange}°`],
    ['reflections', `${M.obs.size} / ${allowed}`],
    ['completeness', `${Math.round((100 * M.obs.size) / allowed)} %`],
  ];
  if (M.result) rows.push(['lattice', M.result.lattice], ['a (from spots)', `${M.result.a.toFixed(3)} Å`], ['space group', P.CRYST[sim.spec.id].sg]);
  else rows.push(['status', M.running ? 'rotating…' : 'done']);
  let y = 22 * s.dpr;
  for (const [k, v] of rows) {
    font(q, 9, s.dpr); q.fillStyle = C.muted; q.textBaseline = 'top'; q.fillText(k.toUpperCase(), tx, y);
    font(q, 11, s.dpr, 500); q.fillStyle = C.text;
    const words = v.split(' '); let line = '', yy = y + 12 * s.dpr;
    for (const wd of words) { if (q.measureText(line + wd).width > s.W - tx - 8 * s.dpr) { q.fillText(line, tx, yy); yy += 13 * s.dpr; line = ''; } line += wd + ' '; }
    q.fillText(line, tx, yy);
    y = yy + 18 * s.dpr;
  }
}

// ======================================================================= Tomography
export class Tomo {
  constructor(sim) {
    this.sim = sim; this.N = 64;
    this.truth = this.phantom();
    this.geo = new Map();
    this.start();
  }
  phantom() {
    const N = this.N, V = new Float32Array(N * N * N), rng = P.mulberry32(2718);
    const c = [32, 32, 31], R = 21;
    const pores = Array.from({ length: 26 }, () => { const th = rng() * 6.28, ph = Math.acos(2 * rng() - 1), r = rng() * R * 0.85; return [c[0] + r * Math.sin(ph) * Math.cos(th), c[1] + r * Math.sin(ph) * Math.sin(th), c[2] + r * Math.cos(ph), 2 + rng() * 3.5]; });
    const au = Array.from({ length: 34 }, () => { const th = rng() * 6.28, ph = Math.acos(2 * rng() - 1), r = R + 0.5; return [c[0] + r * Math.sin(ph) * Math.cos(th), c[1] + r * Math.sin(ph) * Math.sin(th), c[2] + r * Math.cos(ph), 1.4 + rng() * 1.8]; });
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      const d = Math.hypot(x - c[0], (y - c[1]) * 1.08, z - c[2]);
      if (d < R) { v = 1; for (const p of pores) if (Math.hypot(x - p[0], y - p[1], z - p[2]) < p[3]) { v = 0; break; } }
      for (const p of au) if (Math.hypot(x - p[0], y - p[1], z - p[2]) < p[3]) v = 7;
      V[(z * N + y) * N + x] = v;
    }
    return V;
  }
  geometry(th) {
    const key = th.toFixed(4);
    let g = this.geo.get(key);
    if (g) return g;
    const N = this.N, c = (N - 1) / 2, cs = Math.cos(th), sn = Math.sin(th);
    const idx = new Int32Array(N * N), len = new Float32Array(N);
    for (let u = 0; u < N; u++)
      for (let v = 0; v < N; v++) {
        const y = Math.round(c + (u - c) * cs - (v - c) * sn), z = Math.round(c + (u - c) * sn + (v - c) * cs);
        const ok = y >= 0 && z >= 0 && y < N && z < N;
        idx[u * N + v] = ok ? (z * N + y) * N : -1;
        if (ok) len[u]++;
      }
    g = { idx, len, cs, sn };
    if (this.geo.size > 400) this.geo.clear();
    this.geo.set(key, g);
    return g;
  }
  project(V, th, op = 'sum') {
    const N = this.N, g = this.geometry(th), p = new Float32Array(N * N);
    for (let u = 0; u < N; u++)
      for (let v = 0; v < N; v++) {
        const b = g.idx[u * N + v];
        if (b < 0) continue;
        const o = u * N;
        if (op === 'max') for (let x = 0; x < N; x++) { const w = V[b + x]; if (w > p[o + x]) p[o + x] = w; }
        else for (let x = 0; x < N; x++) p[o + x] += V[b + x];
      }
    return p;
  }
  backproject(p, th, into, scale = 1) {
    const N = this.N, c = (N - 1) / 2, cs = Math.cos(th), sn = Math.sin(th);
    for (let z = 0; z < N; z++)
      for (let y = 0; y < N; y++) {
        const u = c + (y - c) * cs + (z - c) * sn;
        const u0 = Math.floor(u), f = u - u0;
        if (u0 < 0 || u0 >= N - 1) continue;
        const o = (z * N + y) * N, a = u0 * N, b = (u0 + 1) * N;
        for (let x = 0; x < N; x++) into[o + x] += scale * (p[a + x] * (1 - f) + p[b + x] * f);
      }
  }
  // Ram-Lak ramp filter along the detector (u) direction, with a Hann taper
  filter(p) {
    const N = this.N, out = new Float32Array(N * N), K = N;
    const h = new Float32Array(2 * K + 1);
    for (let n = -K; n <= K; n++) h[n + K] = n === 0 ? 0.25 : n % 2 ? (-1 / (Math.PI * Math.PI * n * n)) * (0.5 + 0.5 * Math.cos((Math.PI * n) / K)) : 0;
    for (let x = 0; x < N; x++)
      for (let u = 0; u < N; u++) {
        let v = 0;
        for (let k = 0; k < N; k++) v += p[k * N + x] * h[u - k + K];
        out[u * N + x] = v;
      }
    return out;
  }
  start() {
    const S = this.sim.S, N = this.N;
    const angles = [];
    for (let a = -S.tomoRange; a <= S.tomoRange + 1e-6; a += S.tomoStep) angles.push(a);
    this.angles = angles; this.k = 0; this.proj = []; this.timer = 0; this.acquiring = true;
    this.wbp = new Float32Array(N * N * N); this.sirt = null; this.theta = angles[0];
    this.key = [S.tomoRange, S.tomoStep].join('|');
  }
  update(dt) {
    const S = this.sim.S;
    if ([S.tomoRange, S.tomoStep].join('|') !== this.key) this.start();
    let changed = false;
    if (this.acquiring && !S.paused) {
      this.timer += dt * S.speed;
      while (this.timer > 0.16 && this.acquiring) {
        this.timer -= 0.16;
        this.acquire();
        changed = true;
      }
    }
    if (!this.acquiring && S.tomoAlg === 'sirt' && !S.paused) {
      if (!this.sirt) this.sirt = { x: new Float32Array(this.N ** 3), corr: new Float32Array(this.N ** 3), j: 0, iter: 0 };
      if (this.sirt.iter < S.tomoIter) { this.stepSIRT(10); changed = true; }
    }
    return changed;
  }
  acquire() {
    const S = this.sim.S, th = this.angles[this.k] * DEG;
    const p = this.project(this.truth, th);
    if (real(S)) {
      const k = S.dose / 400 * 3;
      for (let i = 0; i < p.length; i++) p[i] = P.poisson(Math.max(0, p[i]) * k) / k;
    }
    this.proj.push({ th, p });
    this.backproject(this.filter(p), th, this.wbp, 1);
    this.theta = this.angles[this.k];
    this.k++;
    if (this.k >= this.angles.length) this.acquiring = false;
  }
  stepSIRT(budget) {
    const T = this.sirt, N = this.N, t0 = performance.now(), nA = this.proj.length;
    while (performance.now() - t0 < budget) {
      const { th, p } = this.proj[T.j], g = this.geometry(th);
      const f = this.project(T.x, th), r = new Float32Array(N * N);
      for (let u = 0; u < N; u++) { const L = g.len[u] || 1; for (let x = 0; x < N; x++) r[u * N + x] = (p[u * N + x] - f[u * N + x]) / L; }
      this.backproject(r, th, T.corr, 1);
      T.j++;
      if (T.j >= nA) {
        for (let i = 0; i < T.x.length; i++) { T.x[i] = Math.max(0, T.x[i] + (1.6 * T.corr[i]) / nA); T.corr[i] = 0; }
        T.j = 0; T.iter++;
        if (T.iter >= this.sim.S.tomoIter) break;
      }
    }
  }
  volume() {
    const S = this.sim.S;
    if (S.tomoView === 'truth') return this.truth;
    if (S.tomoAlg === 'sirt' && this.sirt) return this.sirt.x;
    return this.wbp;
  }
}

export function drawTomo(sim, S, m, s, time) {
  const T = sim.tomo, N = T.N, { ctx, W, H, dpr } = m;
  const last = T.proj[T.proj.length - 1];
  const dst = [0, 0, W, H];
  if (last) {
    const [lo, hi] = range(last.p, 0.01, 0.998);
    paint(ctx, last.p, N, N, dst, { lo, hi, lut: real(S) ? LUT.gray : LUT.ice, gamma: 0.9 });
  }
  label(ctx, `HAADF projection · θ = ${T.theta >= 0 ? '+' : ''}${T.theta.toFixed(0)}° · ${T.proj.length}/${T.angles.length}`, 10 * dpr, 16 * dpr, dpr, { color: C.warm });
  // tilt gauge with the missing wedge
  const gx = W - 42 * dpr, gy = H - 34 * dpr, gr = 26 * dpr;
  ctx.fillStyle = 'rgba(255,125,125,0.35)';
  for (const sgn of [1, -1]) { ctx.beginPath(); ctx.moveTo(gx, gy); ctx.arc(gx, gy, gr, -Math.PI / 2 + sgn * S.tomoRange * DEG, -Math.PI / 2 + sgn * Math.PI / 2, sgn < 0); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI, 0); ctx.stroke();
  ctx.strokeStyle = C.accent; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(gx, gy);
  ctx.lineTo(gx + gr * Math.sin(T.theta * DEG), gy - gr * Math.cos(T.theta * DEG)); ctx.stroke();
  font(ctx, 8, dpr); ctx.fillStyle = '#ff9d9d'; ctx.textAlign = 'center'; ctx.fillText('missing wedge', gx, gy + 12 * dpr); ctx.textAlign = 'left';
  label(ctx, 'tilt axis', 10 * dpr, H / 2, dpr, { color: C.muted, size: 8.5 });
  // secondary: orthoslices + rotating MIP
  const q = s.ctx, V = T.volume(), pw = Math.min(s.H - 20 * s.dpr, (s.W - 24 * s.dpr) / 3);
  const zi = Math.round(S.tomoSlice * (N - 1)), xi = Math.round(S.tomoSlice * (N - 1));
  const xy = new Float32Array(N * N), yz = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) xy[y * N + x] = V[(zi * N + y) * N + x];
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) yz[z * N + y] = V[(z * N + y) * N + xi];
  const [lo, hi] = range(V, 0.02, 0.999);
  const lut = real(S) ? LUT.gray : LUT.ice;
  paint(q, xy, N, N, [0, 16 * s.dpr, pw, pw], { lo: Math.max(0, lo), hi, lut });
  paint(q, yz, N, N, [pw + 8 * s.dpr, 16 * s.dpr, pw, pw], { lo: Math.max(0, lo), hi, lut });
  const mip = T.project(V, time * 0.5, 'max');
  const [ml, mh] = range(mip, 0.02, 0.999);
  paint(q, mip, N, N, [2 * pw + 16 * s.dpr, 16 * s.dpr, pw, pw], { lo: ml, hi: mh, lut: real(S) ? LUT.gray : LUT.magma });
  const tag = S.tomoView === 'truth' ? 'truth' : S.tomoAlg === 'sirt' ? `SIRT ${T.sirt ? `it ${T.sirt.iter}` : '…'}` : 'WBP';
  label(q, `XY · ${tag}`, 0, 8 * s.dpr, s.dpr, { color: C.muted, size: 8.5 });
  label(q, 'YZ · beam ↕', pw + 8 * s.dpr, 8 * s.dpr, s.dpr, { color: S.tomoView === 'truth' ? C.muted : C.warm, size: 8.5 });
  label(q, '3D render', 2 * pw + 16 * s.dpr, 8 * s.dpr, s.dpr, { color: C.muted, size: 8.5 });
}

export function tomoStats(S, T) {
  const a = S.tomoRange * DEG, nP = T.angles.length, D = 46;
  const e = Math.sqrt((a + Math.sin(a) * Math.cos(a)) / Math.max(1e-6, a - Math.sin(a) * Math.cos(a)));
  return { crowther: (Math.PI * D) / nP, elong: e, nP };
}
