// Electron holography: off-axis (Möllenstedt biprism) and in-line (focal-series exit-wave reconstruction).
// Both recover the complex image wave, amplitude and phase, that an ordinary image throws away.
import * as P from './physics.js';
import { FOCAL_SPREAD, CONV_TEM } from './sim.js';
import { paint, label, font, LUT, range, scaleBar } from './render2d.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = 2 * Math.PI, DEG = Math.PI / 180;
const C = { accent: '#6fd6ff', warm: '#ffb45e', text: '#e9edf2', muted: '#8a94a3', grid: 'rgba(255,255,255,0.07)', violet: '#b59bff' };
const real = (S) => S.clarity === 'real';

// Exhibit-scale biprism: a higher wire voltage deflects the two waves more, giving finer fringes and a
// wider overlap, but the wider overlap needs coherence over a longer distance, so fringe contrast falls.
export function biprism(U) {
  const s = 80 / U; // fringe spacing in the object plane, Å
  const W = 0.12 * U; // overlap (hologram) width, nm
  const mu = 0.8 * Math.exp(-((W / 25) ** 2)); // fringe contrast: detector MTF × spatial coherence
  return { s, W, mu };
}

function crop(a, n, c) {
  const o = (n - c) / 2, out = new Float32Array(c * c);
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) out[y * c + x] = a[(y + o) * n + x + o];
  return out;
}

// Phase of a complex field relative to its mean (removes the arbitrary global phase).
function relPhase(re, im, n, c, mask) {
  const o = (n - c) / 2;
  let mr = 0, mi = 0;
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
    if (mask && !mask[y * c + x]) continue;
    const i = (y + o) * n + x + o;
    mr += re[i]; mi += im[i];
  }
  const ph = new Float32Array(c * c), amp = new Float32Array(c * c);
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
    const i = (y + o) * n + x + o, a = re[i], b = im[i];
    ph[y * c + x] = Math.atan2(b * mr - a * mi, a * mr + b * mi);
    amp[y * c + x] = Math.hypot(a, b);
  }
  return { ph, amp };
}

// Objective-lens transfer function H(k)·exp(−iχ(k)) at defocus df (Å), as in Sim.lensWave.
function transfer(sim, n, dx, df) {
  const lam = sim.lam, Cs = sim.CsA(), ab = sim.abA(), D = FOCAL_SPREAD, ac = CONV_TEM;
  const re = new Float32Array(n * n), im = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const ky = P.freq(y, n, dx);
    for (let x = 0; x < n; x++) {
      const kx = P.freq(x, n, dx), k2 = kx * kx + ky * ky, k = Math.sqrt(k2), i = y * n + x;
      const g = df * lam * k + Cs * lam ** 3 * k * k2;
      const H = Math.exp(-0.5 * Math.PI ** 2 * lam * lam * D * D * k2 * k2) * Math.exp(-(((Math.PI * ac) / lam) ** 2) * g * g);
      const c = P.chiFull(kx, ky, lam, df, Cs, ab);
      re[i] = H * Math.cos(c); im[i] = -H * Math.sin(c);
    }
  }
  return { re, im };
}

// Low-pass a complex field to |k| < kc (1/Å) with a soft edge.
function lowpass(re, im, n, dx, kc) {
  P.fft2(re, im, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = Math.hypot(P.freq(x, n, dx), P.freq(y, n, dx)), w = clamp((kc - k) / (0.15 * kc), 0, 1), i = y * n + x;
    re[i] *= w; im[i] *= w;
  }
  P.fft2(re, im, n, true);
}

// ======================================================================= off-axis holography
export class OffAxis {
  constructor(sim) { this.sim = sim; this.stale = true; this.disp = null; }

  compute() {
    this.stale = false;
    const sim = this.sim, S = sim.S, n = 256, c = 224, dx = (S.fov * 10) / c, L = n * dx;
    const maps = sim.maps({ n, dx });
    const exit = P.transmission(maps.phase, S.kV);
    const img = sim.lensWave(maps, { exit });
    const bp = biprism(S.biprism);
    // carrier frequency on whole FFT bins, at most one fringe per 3 detector pixels
    const th = 20 * DEG, qMax = 1 / (3 * dx);
    const under = 1 / bp.s > qMax;
    const q = Math.min(1 / bp.s, qMax);
    const bx = Math.round(q * Math.cos(th) * L), by = Math.round(q * Math.sin(th) * L);
    const qx = bx / L, qy = by / L, qm = Math.hypot(qx, qy), ux = qx / qm, uy = qy / qm;
    const Wa = bp.W * 10, mu = bp.mu, h = (n * dx) / 2;
    const I = new Float64Array(n * n), inOv = new Uint8Array(c * c), o = (n - c) / 2;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x, px = x * dx - h, py = y * dx - h, d = px * ux + py * uy;
        const a = img.re[i], b = img.im[i], a2 = a * a + b * b;
        let v;
        if (Math.abs(d) <= Wa / 2) {
          // |R + ψ|² with a tilted plane reference wave R = exp(2πi q·r), fringe contrast μ
          const ph = TAU * (qx * px + qy * py);
          v = 1 + a2 + 2 * mu * (a * Math.cos(ph) + b * Math.sin(ph));
          // Fresnel fringes diffracted from the edges of the biprism wire
          const e = Wa / 2 - Math.abs(d), Lf = 0.04 * Wa + 1.5;
          v *= 1 + 0.3 * Math.exp(-e / Lf) * Math.cos(Math.PI * (e / (0.45 * Lf)) ** 2);
          if (x >= o && x < o + c && y >= o && y < o + c) inOv[(y - o) * c + x - o] = 1;
        } else v = d < 0 ? a2 : 1; // beyond the overlap: object wave alone, or reference alone
        I[i] = v;
      }
    if (real(S)) {
      const N0 = (S.dose * dx * dx * 0.9) / 2; // electrons per pixel per unit intensity (mean ≈ 2)
      for (let i = 0; i < n * n; i++) I[i] = P.poisson(I[i] * N0) / N0;
    }
    // Fourier transform of the hologram: center band, sideband ψ at −q, twin ψ* at +q
    const re = Float64Array.from(I), im = new Float64Array(n * n);
    P.fft2(re, im, n);
    const fft = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x, j = ((y + n / 2) % n) * n + ((x + n / 2) % n);
        fft[j] = Math.log(1 + Math.hypot(re[i], im[i]));
      }
    // cut out the sideband, center it, optionally undo the lens aberrations numerically, transform back
    const rk = S.sbR * qm, rb = rk * L;
    const gr = new Float64Array(n * n), gi = new Float64Array(n * n);
    const lam = sim.lam, df = S.df * 10, Cs = sim.CsA(), ab = sim.abA();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = x < n / 2 ? x : x - n, fy = y < n / 2 ? y : y - n, r = Math.hypot(fx, fy);
        if (r > rb) continue;
        const w = clamp((rb - r) / (0.15 * rb), 0, 1);
        const sx = (((fx - bx) % n) + n) % n, sy = (((fy - by) % n) + n) % n, j = sy * n + sx, i = y * n + x;
        let a = re[j] * w, b = im[j] * w;
        if (S.numCorr) {
          const cc = P.chiFull(fx / L, fy / L, lam, df, Cs, ab), cs = Math.cos(cc), sn = Math.sin(cc);
          [a, b] = [a * cs - b * sn, a * sn + b * cs];
        }
        gr[i] = a; gi[i] = b;
      }
    P.fft2(gr, gi, n, true);
    for (let i = 0; i < n * n; i++) { gr[i] /= mu; gi[i] /= mu; }
    const rec = relPhase(gr, gi, n, c, inOv);
    // the true wave at the same resolution, for comparison: exit wave if aberrations were removed
    const tr = Float64Array.from(S.numCorr ? exit.re : img.re), ti = Float64Array.from(S.numCorr ? exit.im : img.im);
    lowpass(tr, ti, n, dx, rk);
    const truth = relPhase(tr, ti, n, c, inOv);
    // electrons per independent reconstructed pixel: one per area 1/(π rk²) of the sideband mask
    const res = 1 / rk, Npx = (S.dose * res * res) / Math.PI;
    this.disp = {
      c, n, dx, holo: crop(I, n, c), ph: rec.ph, amp: rec.amp, truePh: truth.ph, inOv, fft,
      bx, by, rb, s: 1 / qm, under, sReq: bp.s, mu, W: bp.W, res, sig: Math.SQRT2 / (mu * Math.sqrt(Npx)),
      cover: inOv.reduce((a, v) => a + v, 0) / (c * c),
    };
  }
}

// ======================================================================= in-line holography
// Focal series → exit wave by iterative (Gerchberg–Saxton) focal-series reconstruction.
export class FocalSeries {
  constructor(sim) { this.sim = sim; this.stale = true; this.st = null; }

  start() {
    this.stale = false;
    // 128² keeps each iteration fast (2N FFTs); 112 px still sample finer than the information limit
    const sim = this.sim, S = sim.S, n = 128, c = 112, dx = (S.fov * 10) / c, N = S.nFocal;
    const maps = sim.maps({ n, dx });
    const exit = P.transmission(maps.phase, S.kV);
    const Fr = Float64Array.from(exit.re), Fi = Float64Array.from(exit.im);
    P.fft2(Fr, Fi, n);
    const step = S.focalStep * 10, df0 = S.df * 10;
    this.st = {
      n, c, dx, N, exit, Fr, Fi, dfs: Array.from({ length: N }, (_, j) => df0 + (j - (N - 1) / 2) * step),
      T: [], A: [], thumbs: [], acq: 0, tAcq: 0, den: new Float64Array(n * n),
      it: 0, j: 0, maxIt: 30, err: [], errAcc: 0, Ire: null, Iim: null, nr: null, ni: null, rec: null,
    };
    const tr = Float64Array.from(exit.re), ti = Float64Array.from(exit.im);
    lowpass(tr, ti, n, dx, 1 / P.infoLimit(sim.lam, FOCAL_SPREAD));
    this.st.truth = relPhase(tr, ti, n, c, null);
  }

  // record one image of the series
  acquire() {
    const st = this.st, S = this.sim.S, { n, dx } = st, j = st.acq;
    const T = transfer(this.sim, n, dx, st.dfs[j]);
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) {
      re[i] = st.Fr[i] * T.re[i] - st.Fi[i] * T.im[i];
      im[i] = st.Fr[i] * T.im[i] + st.Fi[i] * T.re[i];
      st.den[i] += T.re[i] * T.re[i] + T.im[i] * T.im[i];
    }
    P.fft2(re, im, n, true);
    const A = new Float32Array(n * n), I = new Float32Array(n * n);
    const N0 = ((S.dose / st.N) * dx * dx * 0.9); // the total dose is split over the series
    for (let i = 0; i < n * n; i++) {
      let v = re[i] * re[i] + im[i] * im[i];
      if (real(S)) v = P.poisson(v * N0) / N0;
      I[i] = v; A[i] = Math.sqrt(v);
    }
    st.T.push(T); st.A.push(A); st.thumbs.push(crop(I, n, st.c));
    st.acq++;
    if (st.acq === st.N) {
      // start from a plane wave
      st.Ire = new Float64Array(n * n); st.Iim = new Float64Array(n * n); st.Ire[0] = n * n;
      st.nr = new Float64Array(n * n); st.ni = new Float64Array(n * n);
    }
  }

  // one Gerchberg–Saxton pass for image j: propagate the estimate to that focus, impose the measured
  // amplitude, propagate back and add to the running average
  iterate1() {
    const st = this.st, { n } = st, j = st.j, T = st.T[j], A = st.A[j];
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) {
      re[i] = st.Ire[i] * T.re[i] - st.Iim[i] * T.im[i];
      im[i] = st.Ire[i] * T.im[i] + st.Iim[i] * T.re[i];
    }
    P.fft2(re, im, n, true);
    let e = 0;
    for (let i = 0; i < n * n; i++) {
      const a = Math.hypot(re[i], im[i]), d = a - A[i];
      e += d * d;
      if (a > 1e-9) { re[i] *= A[i] / a; im[i] *= A[i] / a; } else { re[i] = A[i]; im[i] = 0; }
    }
    st.errAcc += e / (n * n);
    P.fft2(re, im, n);
    for (let i = 0; i < n * n; i++) {
      st.nr[i] += re[i] * T.re[i] + im[i] * T.im[i];
      st.ni[i] += im[i] * T.re[i] - re[i] * T.im[i];
    }
    st.j++;
    if (st.j === st.N) {
      const eps = 0.02 * st.N;
      for (let i = 0; i < n * n; i++) { st.Ire[i] = st.nr[i] / (st.den[i] + eps); st.Iim[i] = st.ni[i] / (st.den[i] + eps); }
      st.nr.fill(0); st.ni.fill(0);
      st.err.push(st.errAcc / st.N); st.errAcc = 0;
      st.j = 0; st.it++;
      this.snapshot();
    }
  }

  snapshot() {
    const st = this.st, { n, c } = st;
    const re = Float64Array.from(st.Ire), im = Float64Array.from(st.Iim);
    P.fft2(re, im, n, true);
    st.rec = relPhase(re, im, n, c, null);
  }

  // advance acquisition (paced, so the series visibly builds up) and reconstruction (time-budgeted)
  step(dt) {
    const st = this.st, S = this.sim.S;
    if (!st || S.paused) return false;
    if (st.acq < st.N) {
      st.tAcq += dt * S.speed;
      if (st.tAcq < 0.16) return false;
      st.tAcq = 0;
      this.acquire();
      return true;
    }
    if (st.it >= st.maxIt) return false;
    // a couple of images per frame, so the convergence can be watched (a few seconds in all)
    const t0 = performance.now(), k = Math.max(1, Math.round(2 * S.speed));
    for (let i = 0; i < k && st.it < st.maxIt && performance.now() - t0 < 30; i++) this.iterate1();
    return true;
  }
}

// ======================================================================= drawing
const VIEW_NAMES = { holo: 'hologram', phase: 'reconstructed phase', amp: 'reconstructed amplitude', contour: 'phase contours  cos(4φ)' };

function phasePaint(ctx, ph, c, dst, S, mask, lohi) {
  const arr = mask ? ph.map((v, i) => (mask[i] ? v : NaN)) : ph;
  const [lo, hi] = lohi ?? range(arr.filter((v) => !Number.isNaN(v)), 0.01, 0.995);
  const a2 = arr.map((v) => (Number.isNaN(v) ? lo - 1 : v));
  paint(ctx, a2, c, c, dst, { lo, hi, lut: real(S) ? LUT.gray : LUT.magma });
  return [lo, hi];
}

function profilePlot(q, r, dpr, series, title) {
  const [x0, y0, w, h] = r;
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.v) { if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!Number.isFinite(lo)) return;
  const pad = (hi - lo) * 0.1 || 0.1; lo -= pad; hi += pad;
  q.strokeStyle = C.grid; q.lineWidth = 1 * dpr; q.strokeRect(x0, y0, w, h);
  for (const s of series) {
    q.strokeStyle = s.color; q.lineWidth = (s.width ?? 1.4) * dpr;
    q.setLineDash(s.dash ? [3 * dpr, 3 * dpr] : []);
    q.beginPath();
    let first = true;
    s.v.forEach((v, i) => {
      if (!Number.isFinite(v)) { first = true; return; }
      const x = x0 + (i / (s.v.length - 1)) * w, y = y0 + h - ((v - lo) / (hi - lo)) * h;
      first ? q.moveTo(x, y) : q.lineTo(x, y); first = false;
    });
    q.stroke();
  }
  q.setLineDash([]);
  label(q, title, x0, y0 - 9 * dpr, dpr, { color: C.muted, size: 9 });
  label(q, `${(hi - lo).toFixed(2)} rad span`, x0 + w, y0 + h - 9 * dpr, dpr, { color: C.muted, size: 8, align: 'right' });
}

function statLines(q, x, y, dpr, rows) {
  font(q, 10, dpr);
  q.textBaseline = 'middle';
  rows.forEach(([k, v, col], i) => {
    q.fillStyle = C.muted; q.textAlign = 'left'; q.fillText(k, x, y + i * 15 * dpr);
    q.fillStyle = col ?? C.text; q.fillText(v, x + 118 * dpr, y + i * 15 * dpr);
  });
}

export function drawOAH(sim, S, m, s) {
  const d = sim.oah.disp;
  if (!d) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H], c = d.c;
  const v = S.holoView;
  if (v === 'holo') {
    const [lo, hi] = range(d.holo, 0.01, 0.995);
    paint(ctx, d.holo, c, c, dst, { lo, hi, lut: real(S) ? LUT.gray : LUT.ice });
    // magnifier on the fringes
    const z = 40, o = Math.round(c / 2 - z / 2), sub = new Float32Array(z * z);
    for (let y = 0; y < z; y++) for (let x = 0; x < z; x++) sub[y * z + x] = d.holo[(o + y) * c + o + x];
    const zs = Math.min(W, H) * 0.34, zx = W - zs - 10 * dpr, zy = 30 * dpr;
    ctx.imageSmoothingEnabled = false;
    paint(ctx, sub, z, z, [zx, zy, zs, zs], { lo, hi, lut: real(S) ? LUT.gray : LUT.ice });
    ctx.strokeStyle = C.warm; ctx.lineWidth = 1.2 * dpr; ctx.strokeRect(zx, zy, zs, zs);
    ctx.strokeRect((o / c) * W, (o / c) * H, (z / c) * W, (z / c) * H);
    label(ctx, `fringes ×${(c / z).toFixed(1)}  ·  s = ${d.s.toFixed(2)} Å`, zx + zs, zy + zs + 12 * dpr, dpr, { color: C.warm, size: 9, align: 'right' });
  } else if (v === 'amp') {
    const a = d.amp.map((x, i) => (d.inOv[i] ? x : NaN));
    const [lo, hi] = range(a.filter((x) => !Number.isNaN(x)), 0.01, 0.995);
    paint(ctx, a.map((x) => (Number.isNaN(x) ? lo - 1 : x)), c, c, dst, { lo, hi, lut: real(S) ? LUT.gray : LUT.ice });
  } else if (v === 'contour') {
    const a = d.ph.map((p, i) => (d.inOv[i] ? Math.cos(4 * p) : -1));
    paint(ctx, a, c, c, dst, { lo: -1, hi: 1, lut: LUT.gray });
  } else {
    phasePaint(ctx, d.ph, c, dst, S, d.inOv);
    ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(255,180,94,0.6)'; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.setLineDash([]);
  }
  label(ctx, VIEW_NAMES[v], 10 * dpr, 16 * dpr, dpr, { color: C.accent });
  if (d.under) label(ctx, `fringes finer than ${(3 * d.dx).toFixed(2)} Å are undersampled: reduce the field of view`, 10 * dpr, 36 * dpr, dpr, { color: C.warm, size: 9 });
  else if (d.cover < 0.98) label(ctx, `overlap ${d.W.toFixed(1)} nm < field of view: no fringes outside it`, 10 * dpr, 36 * dpr, dpr, { color: C.warm, size: 9 });
  if (S.numCorr && v !== 'holo') label(ctx, 'aberrations removed numerically', 10 * dpr, H - 30 * dpr, dpr, { color: C.muted, size: 9 });
  scaleBar(ctx, dst, S.fov * 10, dpr);

  // secondary: hologram spectrum with the sideband aperture, phase profile, numbers
  // side by side normally; stacked when the panel is tall (enlarged or popped out)
  const tall = s.H > s.W * 0.85, q = s.ctx, n = d.n;
  const sz = tall ? Math.min(s.W, s.H * 0.5) : Math.min(s.H, s.W * 0.42);
  const [a, b] = range(d.fft, 0.3, 0.9995);
  paint(q, d.fft, n, n, [0, 0, sz, sz], { lo: a, hi: b, lut: real(S) ? LUT.gray : LUT.ice, gamma: 1.3 });
  const px = sz / n, cx = sz / 2, cy = sz / 2;
  q.lineWidth = 1.4 * s.dpr;
  q.strokeStyle = C.warm;
  q.beginPath(); q.arc(cx - d.bx * px, cy - d.by * px, d.rb * px, 0, 7); q.stroke();
  q.setLineDash([3 * s.dpr, 3 * s.dpr]); q.strokeStyle = 'rgba(255,255,255,0.45)';
  q.beginPath(); q.arc(cx + d.bx * px, cy + d.by * px, d.rb * px, 0, 7); q.stroke(); q.setLineDash([]);
  if (!real(S)) {
    label(q, 'sideband ψ', cx - d.bx * px, cy - d.by * px - d.rb * px - 8 * s.dpr, s.dpr, { color: C.warm, size: 9, align: 'center' });
    label(q, 'twin ψ*', cx + d.bx * px, cy + d.by * px + d.rb * px + 8 * s.dpr, s.dpr, { color: C.muted, size: 9, align: 'center' });
    label(q, 'center band', cx, cy + 14 * s.dpr, s.dpr, { color: C.muted, size: 8, align: 'center' });
  }
  label(q, 'FFT of hologram', 8 * s.dpr, 12 * s.dpr, s.dpr, { color: C.accent, size: 9 });
  const x0 = tall ? 8 * s.dpr : sz + 16 * s.dpr, y0 = tall ? sz + 28 * s.dpr : 20 * s.dpr, w = s.W - x0 - 10 * s.dpr, row = (c / 2) | 0;
  const mk = (arr) => Array.from({ length: c }, (_, x) => (d.inOv[row * c + x] ? arr[row * c + x] : NaN));
  const ph = tall ? s.H - y0 - 110 * s.dpr : (s.H - 30 * s.dpr) * 0.48;
  profilePlot(q, [x0, y0, w, ph], s.dpr, [
    { v: mk(d.truePh), color: C.muted, dash: true, width: 1.2 },
    { v: mk(d.ph), color: C.warm },
  ], `phase along the dashed line · ${S.numCorr ? 'true exit wave' : 'true image wave'} (dashed)`);
  statLines(q, x0, y0 + ph + 22 * s.dpr, s.dpr, [
    ['Fringe spacing', `${d.s.toFixed(2)} Å${d.under ? ` (wanted ${d.sReq.toFixed(2)})` : ''}`, d.under ? C.warm : null],
    ['Fringe contrast μ', `${Math.round(d.mu * 100)} %`],
    ['Overlap width', `${d.W.toFixed(1)} nm`],
    ['Resolution', `${d.res.toFixed(2)} Å  (sideband radius)`],
    ['Phase precision', `${d.sig.toFixed(3)} rad  ≈ 2π/${Math.round(TAU / d.sig)}`, C.accent],
  ]);
}

export function drawILH(sim, S, m, s) {
  const st = sim.ilh.st;
  if (!st) return;
  const { ctx, W, H, dpr } = m, dst = [0, 0, W, H], c = st.c;
  const acquiring = st.acq < st.N;
  let tag;
  if (acquiring || S.ilhView === 'series' || !st.rec) {
    const t = performance.now() / 1000;
    const j = acquiring || !st.rec ? Math.max(0, st.acq - 1) : Math.floor(t * 3) % st.N;
    const im = st.thumbs[j];
    if (im) {
      const [lo, hi] = range(im, 0.01, 0.995);
      paint(ctx, im, c, c, dst, { lo, hi, lut: LUT.gray });
      tag = `${acquiring ? `acquiring ${st.acq}/${st.N}` : `image ${j + 1}/${st.N}`} · Δf = ${(st.dfs[j] / 10).toFixed(1)} nm`;
    }
  } else if (S.ilhView === 'amp') {
    const [lo, hi] = range(st.rec.amp, 0.01, 0.995);
    paint(ctx, st.rec.amp, c, c, dst, { lo, hi, lut: real(S) ? LUT.gray : LUT.ice });
    tag = `exit-wave amplitude · iteration ${st.it}/${st.maxIt}`;
  } else {
    phasePaint(ctx, st.rec.ph, c, dst, S, null);
    ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(255,180,94,0.6)'; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.setLineDash([]);
    tag = `exit-wave phase · iteration ${st.it}/${st.maxIt}`;
  }
  if (tag) label(ctx, tag, 10 * dpr, 16 * dpr, dpr, { color: C.accent });
  scaleBar(ctx, dst, S.fov * 10, dpr);

  // secondary: the focal series, convergence and a phase profile
  const tall = s.H > s.W * 0.85, q = s.ctx, cols = Math.ceil(Math.sqrt(st.N)), rows = Math.ceil(st.N / cols);
  const gw = tall ? s.W : Math.min(s.H, s.W * 0.46), gh = tall ? s.H * 0.5 : s.H;
  const cell = Math.min((gw - 4 * s.dpr) / cols, (gh - 22 * s.dpr) / rows);
  label(q, `focal series · ${(Math.abs(st.dfs[1] - st.dfs[0]) / 10 || 0).toFixed(1)} nm steps`, 4 * s.dpr, 10 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  for (let j = 0; j < st.N; j++) {
    const x = (j % cols) * cell, y = 20 * s.dpr + Math.floor(j / cols) * cell;
    if (j >= st.acq) { q.fillStyle = 'rgba(255,255,255,0.03)'; q.fillRect(x + 1, y + 1, cell - 2, cell - 2); continue; }
    const [lo, hi] = range(st.thumbs[j], 0.01, 0.995);
    paint(q, st.thumbs[j], c, c, [x + 1, y + 1, cell - 2, cell - 2], { lo, hi, lut: LUT.gray });
    if (!acquiring && st.it < st.maxIt && j === st.j) { q.strokeStyle = C.warm; q.lineWidth = 1.5 * s.dpr; q.strokeRect(x + 1, y + 1, cell - 2, cell - 2); }
    if (cell > 46 * s.dpr) label(q, `${(st.dfs[j] / 10).toFixed(0)} nm`, x + 3 * s.dpr, y + cell - 9 * s.dpr, s.dpr, { color: C.text, size: 8 });
  }
  const x0 = tall ? 8 * s.dpr : gw + 14 * s.dpr, top = tall ? 20 * s.dpr + rows * cell + 14 * s.dpr : 0;
  const w = s.W - x0 - 10 * s.dpr, hh = (s.H - top - 50 * s.dpr) / 2, yA = top + 20 * s.dpr, yB = top + 40 * s.dpr + hh;
  // convergence
  q.strokeStyle = C.grid; q.lineWidth = 1 * s.dpr; q.strokeRect(x0, yA, w, hh);
  label(q, `fit error · ${st.it}/${st.maxIt} iterations`, x0, yA - 9 * s.dpr, s.dpr, { color: C.muted, size: 9 });
  if (st.err.length > 1) {
    const lg = st.err.map((e) => Math.log10(e + 1e-12)), lo = Math.min(...lg), hi = Math.max(...lg);
    q.strokeStyle = C.accent; q.lineWidth = 1.5 * s.dpr; q.beginPath();
    lg.forEach((v, i) => { const x = x0 + (i / (st.maxIt - 1)) * w, y = yA + hh - ((v - lo) / (hi - lo || 1)) * hh * 0.9 - hh * 0.05; i ? q.lineTo(x, y) : q.moveTo(x, y); });
    q.stroke();
  }
  if (st.rec) {
    const row = (c / 2) | 0, pick = (a) => Array.from(a.subarray(row * c, row * c + c));
    profilePlot(q, [x0, yB, w, hh], s.dpr, [
      { v: pick(st.truth.ph), color: C.muted, dash: true, width: 1.2 },
      { v: pick(st.rec.ph), color: C.warm },
    ], 'phase along the dashed line · true exit wave (dashed)');
  } else label(q, 'reconstruction starts when the series is complete', x0, yB, s.dpr, { color: C.muted, size: 9 });
}
