// Compute kernels: the heavy loops of 4D-STEM and ptychography, as plain functions on typed arrays with no
// imports, so the same code runs on the main thread (InlineBackend), in a Web Worker (compute-worker.js) and in
// Node. Each solver keeps its whole state in one object and advances for a time budget, so it can be paused,
// resumed and split into slices without changing the result: the visiting order comes from a seeded generator.
//
// Moved unchanged from sim.js / physics.js (M3): same arithmetic, same order of operations.

// ---------------------------------------------------------------- FFT (in-place radix 2 along strided lines)
const plans = new Map();
function plan(n) {
  let p = plans.get(n);
  if (p) return p;
  const lv = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < lv; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  p = { rev, cos, sin, tr: new Float64Array(n), ti: new Float64Array(n) };
  plans.set(n, p);
  return p;
}
function fft1(re, im, n, inv, o = 0, st = 1) {
  const { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = o + i * st, b = o + j * st;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = cos[k], s = inv ? sin[k] : -sin[k];
        const a = o + (i + j) * st, b = a + half * st;
        const br = re[b], bi = im[b];
        const tr = br * c - bi * s, ti = br * s + bi * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}
export function fft2(re, im, n, inv = false) {
  for (let y = 0; y < n; y++) fft1(re, im, n, inv, y * n, 1);
  for (let x = 0; x < n; x++) fft1(re, im, n, inv, x, n);
  if (inv) { const f = 1 / (n * n); for (let i = 0; i < n * n; i++) { re[i] *= f; im[i] *= f; } }
}
// Fresnel propagation over one slice (H from Sim.fresnel); back = the conjugate propagator
export function propagate(wr, wi, n, H, back) {
  fft2(wr, wi, n);
  const s = back ? -1 : 1;
  for (let i = 0; i < n * n; i++) { const a = wr[i], b = wi[i], c = H.re[i], d = s * H.im[i]; wr[i] = a * c - b * d; wi[i] = a * d + b * c; }
  fft2(wr, wi, n, true);
}
// the same generator as physics.mulberry32
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (order, rng) => { for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; } };
// top-left corner of the n4 × n4 window for scan position (i, j)
const corner = (g, i) => Math.round(g.gridN / 2 + (-g.scan / 2 + (i + 0.5) * g.step) / g.dx) - g.n4 / 2;

// geometry of a 4D-STEM scan: { N, n4, gridN, dx, step, scan, K, dz }

// ---------------------------------------------------------------- 4D-STEM forward multislice
// st: { geom, slices: [{re, im}] (K), prop: {re, im}, pr, pi (probe), data (Float32, N²·n4²), done, wr, wi }
export function fdInit(job, data) {
  const n2 = job.geom.n4 * job.geom.n4;
  return { geom: job.geom, slices: job.slices, prop: job.prop, pr: job.pr, pi: job.pi, data, done: job.done ?? 0, wr: new Float64Array(n2), wi: new Float64Array(n2),
    ped: job.ped ?? null, acc: job.ped ? new Float64Array(n2) : null };
}
// one probe position: multislice through the K slices and the far field, as intensities into out (n4², centred)
function fdPattern(st, i, j, rr, ri, out, back) {
  const g = st.geom, { n4, gridN } = g, { pr, pi, wr, wi } = st, h = n4 / 2, left = corner(g, i), top = corner(g, j);
  if (rr) for (let p = 0; p < n4 * n4; p++) { wr[p] = pr[p] * rr[p] - pi[p] * ri[p]; wi[p] = pr[p] * ri[p] + pi[p] * rr[p]; } // tilted probe
  else { wr.set(pr); wi.set(pi); }
  for (let k = 0; k < g.K; k++) {
    const s = st.slices[k];
    for (let y = 0; y < n4; y++) {
      const go = (top + y) * gridN + left, po = y * n4;
      for (let x = 0; x < n4; x++) {
        const gg = go + x, p = po + x, a = wr[p], b = wi[p];
        wr[p] = s.re[gg] * a - s.im[gg] * b;
        wi[p] = s.re[gg] * b + s.im[gg] * a;
      }
    }
    if (k < g.K - 1) propagate(wr, wi, n4, st.prop, false);
  }
  fft2(wr, wi, n4);
  if (!back) { for (let y = 0; y < n4; y++) for (let x = 0; x < n4; x++) { const p = y * n4 + x; out[((y + h) % n4) * n4 + ((x + h) % n4)] = wr[p] * wr[p] + wi[p] * wi[p]; } return; }
  // descan: move the pattern back by `back` pixels (bilinear), adding into out
  const [bx, by] = back;
  for (let y = 0; y < n4; y++) for (let x = 0; x < n4; x++) {
    const p = y * n4 + x, v = wr[p] * wr[p] + wi[p] * wi[p];
    const fx = ((x + h) % n4) + bx, fy = ((y + h) % n4) + by, x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= n4 - 1 || y0 >= n4 - 1) continue;
    const ax = fx - x0, ay = fy - y0, b = y0 * n4 + x0;
    out[b] += v * (1 - ax) * (1 - ay); out[b + 1] += v * ax * (1 - ay); out[b + n4] += v * (1 - ax) * ay; out[b + n4 + 1] += v * ax * ay;
  }
}
// returns the number of positions computed
export function fdStep(st, budget, now) {
  if (st.ped) return fdStepPED(st, budget, now);
  const g = st.geom, { N, n4, gridN } = g, { pr, pi, wr, wi, data } = st, h = n4 / 2, t0 = now(), from = st.done;
  while (st.done < N * N && now() - t0 < budget) {
    const idx = st.done, i = idx % N, j = (idx / N) | 0, left = corner(g, i), top = corner(g, j);
    wr.set(pr); wi.set(pi);
    for (let k = 0; k < g.K; k++) {
      const s = st.slices[k];
      for (let y = 0; y < n4; y++) {
        const go = (top + y) * gridN + left, po = y * n4;
        for (let x = 0; x < n4; x++) {
          const gg = go + x, p = po + x, a = wr[p], b = wi[p];
          wr[p] = s.re[gg] * a - s.im[gg] * b;
          wi[p] = s.re[gg] * b + s.im[gg] * a;
        }
      }
      if (k < g.K - 1) propagate(wr, wi, n4, st.prop, false);
    }
    fft2(wr, wi, n4);
    const o = idx * n4 * n4;
    for (let y = 0; y < n4; y++)
      for (let x = 0; x < n4; x++) {
        const p = y * n4 + x;
        data[o + ((y + h) % n4) * n4 + ((x + h) % n4)] = wr[p] * wr[p] + wi[p] * wi[p];
      }
    st.done++;
  }
  return st.done - from;
}

// one pattern at scan position (i, j) for a job (with its precession, if any): e.g. the bare probe through
// empty slices, the vacuum reference for phase classification
export function fdPatternOnce(job, i, j) {
  const st = fdInit(job, null), n2 = job.geom.n4 * job.geom.n4, out = new Float64Array(n2);
  if (!job.ped) { fdPattern(st, i, j, null, null, out, null); return out; }
  for (let q = 0; q < job.ped.ramps.length; q++) fdPattern(st, i, j, job.ped.ramps[q].re, job.ped.ramps[q].im, out, job.ped.back[q]);
  for (let p = 0; p < n2; p++) out[p] /= job.ped.ramps.length;
  return out;
}

// Scanning precession electron diffraction (SPED): at every probe position the beam is tilted onto a cone
// (ped.ramps: exp(2πi k_t·r) per azimuth), propagated and descanned (ped.back: the pattern shift that brings it
// back, −(1 − δ)·k_t in pixels), and the patterns of all azimuths are averaged.
function fdStepPED(st, budget, now) {
  const g = st.geom, { N, n4 } = g, { data, acc, ped } = st, n2 = n4 * n4, t0 = now(), from = st.done, M = ped.ramps.length;
  while (st.done < N * N && now() - t0 < budget) {
    const idx = st.done, i = idx % N, j = (idx / N) | 0;
    acc.fill(0);
    for (let q = 0; q < M; q++) fdPattern(st, i, j, ped.ramps[q].re, ped.ramps[q].im, acc, ped.back[q]);
    const o = idx * n2;
    for (let p = 0; p < n2; p++) data[o + p] = acc[p] / M;
    st.done++;
  }
  return st.done - from;
}

// ---------------------------------------------------------------- orientation and phase mapping (ACOM)
// Template matching of each pattern against the crystal's zone-axis spot pattern rotated in-plane by ω, after the
// correlation index of Rauch & Dupuy (2005), with v = √(I/I_max) sampled at the rotated template spots g_ω:
//   Q(ω) = Σ v(g_ω)·w_g / √(Σ w_g² · M · ⟨v²⟩_annulus)
// normalized by the pattern's mean energy over the annulus the template covers (not by the sampled values, which
// would make any uniformly faint sampling score 1): Q rewards template spots that land on bright features.
// Returns the best ω, Q₁, the reliability 1 − Q₂/Q₁ (Q₂: the best other local maximum of Q(ω)), and the spot
// excess Q₁/Q_ring − 1 against the pattern's own azimuthal average (rings, i.e. amorphous, give ≈ 0).
// tpl: { spots: [{gx, gy, w}] (Å⁻¹, zone frame), period (deg), step (deg) }; pattern: n4² centred, dk Å⁻¹/px
export function matchOrientation(pattern, n4, dk, tpl) {
  const h = n4 / 2, scores = [], step = tpl.step, period = tpl.period, M = tpl.spots.length;
  let pmax = 0; for (let p = 0; p < n4 * n4; p++) if (pattern[p] > pmax) pmax = pattern[p];
  const val = (x, y) => Math.max(0, pattern[y * n4 + x]) / (pmax || 1);
  const at = (kx, ky) => {
    const fx = kx / dk + h, fy = ky / dk + h, x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= n4 - 1 || y0 >= n4 - 1) return 0;
    const ax = fx - x0, ay = fy - y0;
    return Math.sqrt((val(x0, y0) * (1 - ax) + val(x0 + 1, y0) * ax) * (1 - ay) + (val(x0, y0 + 1) * (1 - ax) + val(x0 + 1, y0 + 1) * ax) * ay);
  };
  // the annulus the template spans, and the azimuthal average there
  let rmin = Infinity, rmax = 0, t2 = 0;
  for (const sp of tpl.spots) { const r = Math.hypot(sp.gx, sp.gy) / dk; rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); t2 += sp.w * sp.w; }
  const nb = h + 2, prof = new Float64Array(nb), cnt = new Float64Array(nb);
  let aSum = 0, aN = 0;
  for (let y = 0; y < n4; y++) for (let x = 0; x < n4; x++) {
    const r = Math.hypot(x - h, y - h), v = val(x, y), ri = Math.round(r);
    if (ri < nb) { prof[ri] += v; cnt[ri]++; }
    if (r >= rmin - 1.5 && r <= rmax + 1.5) { aSum += v; aN++; }
  }
  const norm = Math.sqrt(t2 * M * (aN ? aSum / aN : 0)) || 1;
  for (let r = 0; r < nb; r++) prof[r] = cnt[r] ? Math.sqrt(prof[r] / cnt[r]) : 0;
  for (let w = 0; w < period; w += step) {
    const c = Math.cos((w * Math.PI) / 180), s = Math.sin((w * Math.PI) / 180);
    let pt = 0;
    for (const sp of tpl.spots) pt += at(sp.gx * c - sp.gy * s, sp.gx * s + sp.gy * c) * sp.w;
    scores.push(pt / norm);
  }
  let b1 = 0; for (let k = 1; k < scores.length; k++) if (scores[k] > scores[b1]) b1 = k;
  const L = scores.length, at2 = (k) => scores[(k + L) % L];
  let q2 = 0;
  for (let k = 0; k < L; k++) if (k !== b1 && at2(k) >= at2(k - 1) && at2(k) >= at2(k + 1) && Math.min(Math.abs(k - b1), L - Math.abs(k - b1)) * step >= 3) q2 = Math.max(q2, scores[k]);
  let rt = 0;
  for (const sp of tpl.spots) { const r = Math.hypot(sp.gx, sp.gy) / dk, r0 = Math.floor(r); rt += (r0 + 1 < nb ? prof[r0] * (r0 + 1 - r) + prof[r0 + 1] * (r - r0) : 0) * sp.w; }
  const q1 = scores[b1], qRing = rt / norm;
  return { omega: b1 * step, Q: q1, reliability: q1 > 0 ? 1 - q2 / q1 : 0, qRing, excess: qRing > 0 ? q1 / qRing - 1 : 0 };
}

// ---------------------------------------------------------------- ePIE with a known probe
// T (the state, also what the display reads): { re, im (object, gridN²), pm, iter, k, order, errSum, errHist, err, maxIter }
export function epieInit(T, g, pr, pi, seed = 1234) {
  const G = g.gridN;
  T.re = new Float64Array(G * G).fill(1); T.im = new Float64Array(G * G);
  let pm = 0;
  for (let i = 0; i < g.n4 * g.n4; i++) pm = Math.max(pm, pr[i] * pr[i] + pi[i] * pi[i]);
  Object.assign(T, { pm, iter: 0, k: 0, order: Array.from({ length: g.N * g.N }, (_, i) => i), err: 0, errSum: 0, errHist: [], maxIter: 30, beta: 0.9, rng: mulberry32(seed) });
  const n2 = g.n4 * g.n4;
  T.wr = new Float64Array(n2); T.wi = new Float64Array(n2);
  return T;
}
export function epieStep(T, g, pr, pi, data, budget, now) {
  const { N, n4, gridN } = g, { wr, wi } = T;
  if (T.iter >= T.maxIter) return false;
  const h = n4 / 2, t0 = now(), beta = T.beta;
  const pr0 = new Float64Array(n4 * n4), pi0 = new Float64Array(n4 * n4);
  while (now() - t0 < budget) {
    if (T.k === 0) { shuffle(T.order, T.rng); T.errSum = 0; }
    const idx = T.order[T.k], i = idx % N, j = (idx / N) | 0, left = corner(g, i), top = corner(g, j);
    for (let y = 0; y < n4; y++)
      for (let x = 0; x < n4; x++) {
        const gg = (top + y) * gridN + left + x, p = y * n4 + x;
        wr[p] = T.re[gg] * pr[p] - T.im[gg] * pi[p];
        wi[p] = T.re[gg] * pi[p] + T.im[gg] * pr[p];
        pr0[p] = wr[p]; pi0[p] = wi[p];
      }
    fft2(wr, wi, n4);
    const o = idx * n4 * n4;
    for (let y = 0; y < n4; y++)
      for (let x = 0; x < n4; x++) {
        const p = y * n4 + x, meas = Math.sqrt(data[o + ((y + h) % n4) * n4 + ((x + h) % n4)]);
        const amp = Math.hypot(wr[p], wi[p]);
        T.errSum += (amp - meas) ** 2;
        const sc = amp > 1e-12 ? meas / amp : 0;
        wr[p] *= sc; wi[p] *= sc;
      }
    fft2(wr, wi, n4, true);
    for (let y = 0; y < n4; y++)
      for (let x = 0; x < n4; x++) {
        const gg = (top + y) * gridN + left + x, p = y * n4 + x;
        const dr = wr[p] - pr0[p], di = wi[p] - pi0[p];
        // O += β · conj(P) · Δψ / max|P|²
        T.re[gg] += (beta * (pr[p] * dr + pi[p] * di)) / T.pm;
        T.im[gg] += (beta * (pr[p] * di - pi[p] * dr)) / T.pm;
      }
    if (++T.k >= N * N) { T.k = 0; T.iter++; T.errHist.push(T.errSum); T.err = T.errSum; if (T.iter >= T.maxIter) break; }
  }
  return true;
}

// ---------------------------------------------------------------- multislice ePIE (MS-ePIE / 3PIE)
// The object is a stack of K slices; the wave is propagated between them in the forward model, and the
// correction is back-propagated slice by slice, updating each slice's transmission and the wave entering it.
// T: { O: [{re, im}] (K slices, gridN²), iter, k, order, errSum, errHist, maxIter, ... scratch }
export function msInit(T, g, seed = 99) {
  const G = g.gridN, n2 = g.n4 * g.n4, mk = () => ({ re: new Float64Array(n2), im: new Float64Array(n2) });
  T.O = Array.from({ length: g.K }, () => ({ re: new Float64Array(G * G).fill(1), im: new Float64Array(G * G) }));
  Object.assign(T, { iter: 0, k: 0, order: Array.from({ length: g.N * g.N }, (_, i) => i), errSum: 0, errHist: [], maxIter: 10, beta: 0.8, rng: mulberry32(seed),
    inc: Array.from({ length: g.K }, mk), ex: Array.from({ length: g.K }, mk), w: mk(), win: new Int32Array(n2) });
  return T;
}
export function msStep(T, g, pr, pi, prop, data, budget, now) {
  const { N, n4, gridN, K } = g;
  if (T.iter >= T.maxIter) return false;
  const h = n4 / 2, n2 = n4 * n4, t0 = now(), beta = T.beta;
  while (now() - t0 < budget) {
    if (T.k === 0) { shuffle(T.order, T.rng); T.errSum = 0; }
    const idx = T.order[T.k], i = idx % N, j = (idx / N) | 0, left = corner(g, i), top = corner(g, j);
    const Wi = T.win;
    for (let y = 0, p = 0; y < n4; y++) { const r = (top + y) * gridN + left; for (let x = 0; x < n4; x++, p++) Wi[p] = r + x; }
    // forward through the slices
    T.inc[0].re.set(pr); T.inc[0].im.set(pi);
    for (let k = 0; k < K; k++) {
      const O = T.O[k], I = T.inc[k], E = T.ex[k];
      for (let p = 0; p < n2; p++) { const gg = Wi[p]; E.re[p] = O.re[gg] * I.re[p] - O.im[gg] * I.im[p]; E.im[p] = O.re[gg] * I.im[p] + O.im[gg] * I.re[p]; }
      if (k < K - 1) { T.inc[k + 1].re.set(E.re); T.inc[k + 1].im.set(E.im); propagate(T.inc[k + 1].re, T.inc[k + 1].im, n4, prop, false); }
    }
    // modulus constraint at the detector
    const W = T.w; W.re.set(T.ex[K - 1].re); W.im.set(T.ex[K - 1].im);
    fft2(W.re, W.im, n4);
    const o = idx * n2;
    for (let p = 0; p < n2; p++) {
      const y = (p / n4) | 0, x = p % n4, meas = Math.sqrt(data[o + ((y + h) % n4) * n4 + ((x + h) % n4)]);
      const amp = Math.hypot(W.re[p], W.im[p]);
      T.errSum += (amp - meas) ** 2;
      const sc = amp > 1e-12 ? meas / amp : 0;
      W.re[p] *= sc; W.im[p] *= sc;
    }
    fft2(W.re, W.im, n4, true);
    // back through the slices: W holds the corrected exit wave of slice k
    for (let k = K - 1; k >= 0; k--) {
      const O = T.O[k], I = T.inc[k], E = T.ex[k];
      let mI = 0, mO = 0;
      for (let p = 0; p < n2; p++) { mI = Math.max(mI, I.re[p] * I.re[p] + I.im[p] * I.im[p]); const gg = Wi[p]; mO = Math.max(mO, O.re[gg] * O.re[gg] + O.im[gg] * O.im[gg]); }
      for (let p = 0; p < n2; p++) {
        const gg = Wi[p], dr = W.re[p] - E.re[p], di = W.im[p] - E.im[p];
        const ir = I.re[p], ii = I.im[p], or = O.re[gg], oi = O.im[gg];
        O.re[gg] += (beta * (ir * dr + ii * di)) / (mI || 1);
        O.im[gg] += (beta * (ir * di - ii * dr)) / (mI || 1);
        if (k > 0) { // corrected wave entering this slice, then back-propagate to the previous exit
          W.re[p] = ir + (beta * (or * dr + oi * di)) / (mO || 1);
          W.im[p] = ii + (beta * (or * di - oi * dr)) / (mO || 1);
        }
      }
      if (k > 0) propagate(W.re, W.im, n4, prop, true);
    }
    if (++T.k >= N * N) { T.k = 0; T.iter++; T.errHist.push(T.errSum); if (T.iter >= T.maxIter) break; }
  }
  return true;
}
