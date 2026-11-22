// Ptychographic tomography, a browser preview (M10). Multislice ptychography recovers some depth from one view,
// but its depth resolution (~λ/α², tens of Å) is far worse than its lateral resolution (~λ/2α, under an Å).
// Recording 4D-STEM at several tilts and combining the per-tilt multislice phase volumes in one frame restores a
// nearly isotropic 3D potential (Chen et al. 2021 for multislice electron ptychography; joint multi-tilt methods:
// ptychographic atomic electron tomography, Pelz et al. 2023).
//
// The preview, as a state machine that advances for a time budget (inline or in the compute worker):
//   for each tilt   the phase volume rotated about x, cut into K slabs along the tilted beam (transmission
//                   functions), a 4D-STEM scan simulated through them (kernels.fdStep, with shot noise), then
//                   reconstructed with MS-ePIE (kernels.msStep) from a flat start: K phase slices
//   fuse            the slices of all tilts into one volume, by SIRT on a slab projector (each reconstructed slice
//                   is the tilted volume summed over its slab), or by averaging their back-projections; and the same
//                   for the 0° tilt alone, which shows the single-view depth blurring
// Volume convention (as tomo.js): vol[x + N (y + N z)], tilt axis x, z the beam at 0°; at tilt θ the image row is
// v = (y − c) cos θ − (z − c) sin θ + c and the depth along the tilted beam w = (y − c) sin θ + (z − c) cos θ + c.
// Qualitative and small (a 16 Å cube, 24² positions, 4 slices, 5–7 tilts): the full problem (joint multi-tilt
// reconstruction, mixed-state probes, position correction) is Tier 2/3, and the export prefills its parameters.
import { wavelength, mulberry32 } from './physics.js';
import * as K from './kernels.js';

const DEG = Math.PI / 180;
// seeded Poisson counts (Knuth below 30, Gaussian above), so a run is reproducible
function poisson(l, rng) {
  if (!(l > 0)) return 0;
  if (l < 30) { const L = Math.exp(-l); let k = 0, q = 1; do { k++; q *= rng(); } while (q > L); return k - 1; }
  return Math.max(0, Math.round(l + Math.sqrt(l) * Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())));
}
export const PT_DEFAULTS = { kV: 300, alpha: 20, N: 64, dx: 0.25, K: 4, scan: 24, n4: 32, tilts: 7, maxTilt: 60, iters: 8, dose: 1e5, seed: 5, object: 'test', fusion: 'sirt', sirtIter: 30 };

// ---------------------------------------------------------------- the object
// atoms as Gaussian blobs of projected phase (σ 0.45 Å); w: phase weight (1 ≈ a heavy atom, ~0.3 rad peak)
// The test object: two heavy atoms stacked 8 Å apart along the beam at 0° (one view cannot separate them), an
// isolated heavy atom (its depth spread measures the resolution), and lighter atoms around.
export const TEST_ATOMS = [
  { x: 0, y: 0, z: -4, w: 1, tag: 'pair' }, { x: 0, y: 0, z: 4, w: 1, tag: 'pair' },
  { x: 3.5, y: -3, z: 1, w: 1, tag: 'single' },
  { x: -4, y: 2.5, z: -2, w: 0.5 }, { x: -2, y: -4.5, z: 3, w: 0.5 }, { x: 4, y: 3.5, z: -3.5, w: 0.5 }, { x: -3.5, y: -1, z: 5, w: 0.35 },
];
export function phantom(atoms, N, dx) {
  const vol = new Float32Array(N ** 3), c = N / 2 - 0.5, sig = 0.45, s2 = 2 * sig * sig, reach = Math.ceil((3 * sig) / dx);
  const norm = 0.3 * (dx / (Math.sqrt(2 * Math.PI) * sig)); // projected peak 0.3 rad: the 1D Gaussian along z integrates to 1
  for (const a of atoms) {
    const ax = c + a.x / dx, ay = c + a.y / dx, az = c + a.z / dx;
    for (let z = Math.max(0, Math.floor(az - reach)); z <= Math.min(N - 1, Math.ceil(az + reach)); z++)
      for (let y = Math.max(0, Math.floor(ay - reach)); y <= Math.min(N - 1, Math.ceil(ay + reach)); y++)
        for (let x = Math.max(0, Math.floor(ax - reach)); x <= Math.min(N - 1, Math.ceil(ax + reach)); x++) {
          const r2 = ((x - ax) ** 2 + (y - ay) ** 2 + (z - az) ** 2) * dx * dx;
          vol[x + N * (y + N * z)] += a.w * norm * Math.exp(-r2 / s2);
        }
  }
  return vol;
}

// ---------------------------------------------------------------- the slab projector and its adjoint
// slabs[k][x + N v] = Σ of the volume over slab k of the tilted beam (bilinear in v, nearest slab in depth; what
// lies beyond the first or last slab, the corners of the tilted cube, counts in that slab)
export function slabProject(vol, N, K, th, out = Array.from({ length: K }, () => new Float32Array(N * N))) {
  for (const o of out) o.fill(0);
  const cs = Math.cos(th * DEG), sn = Math.sin(th * DEG), c = N / 2 - 0.5, sT = N / K;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
    const v = (y - c) * cs - (z - c) * sn + c, w = (y - c) * sn + (z - c) * cs + c, k = Math.max(0, Math.min(K - 1, Math.floor((w + 0.5) / sT))); // the tilted cube's corners: in the end slabs
    const v0 = Math.floor(v), f = v - v0, base = N * (y + N * z), o = out[k];
    if (v0 >= 0 && v0 < N) { const a = v0 * N, wa = 1 - f; for (let x = 0; x < N; x++) o[a + x] += wa * vol[base + x]; }
    if (v0 + 1 >= 0 && v0 + 1 < N) { const b = (v0 + 1) * N; for (let x = 0; x < N; x++) o[b + x] += f * vol[base + x]; }
  }
  return out;
}
export function slabBack(slabs, N, K, th, vol, wgt = 1) {
  const cs = Math.cos(th * DEG), sn = Math.sin(th * DEG), c = N / 2 - 0.5, sT = N / K;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
    const v = (y - c) * cs - (z - c) * sn + c, w = (y - c) * sn + (z - c) * cs + c, k = Math.max(0, Math.min(K - 1, Math.floor((w + 0.5) / sT))); // the tilted cube's corners: in the end slabs
    const v0 = Math.floor(v), f = v - v0, base = N * (y + N * z), s = slabs[k];
    if (v0 >= 0 && v0 < N) { const a = v0 * N, wa = wgt * (1 - f); for (let x = 0; x < N; x++) vol[base + x] += wa * s[a + x]; }
    if (v0 + 1 >= 0 && v0 + 1 < N) { const b = (v0 + 1) * N, wb = wgt * f; for (let x = 0; x < N; x++) vol[base + x] += wb * s[b + x]; }
  }
  return vol;
}

// ---------------------------------------------------------------- fusion
// SIRT over all tilts and slabs: x ← max(0, x + C Aᵀ R (p − A x)); data: [{ th, slabs }]
export function fuseSIRT(data, N, K, iterations = 30) {
  const x = new Float32Array(N ** 3), ones = new Float32Array(N ** 3).fill(1), C = new Float32Array(N ** 3);
  const R = data.map((d) => slabProject(ones, N, K, d.th).map((s) => s.map((v) => (v > 1e-6 ? 1 / v : 0))));
  const onesS = Array.from({ length: K }, () => new Float32Array(N * N).fill(1));
  for (const d of data) slabBack(onesS, N, K, d.th, C);
  for (let i = 0; i < C.length; i++) C[i] = C[i] > 1e-6 ? 1 / C[i] : 0;
  const upd = new Float32Array(N ** 3), buf = Array.from({ length: K }, () => new Float32Array(N * N));
  for (let it = 0; it < iterations; it++) {
    upd.fill(0);
    data.forEach((d, t) => {
      const ax = slabProject(x, N, K, d.th, buf);
      for (let k = 0; k < K; k++) { const a = ax[k], p = d.slabs[k], r = R[t][k]; for (let i = 0; i < a.length; i++) a[i] = (p[i] - a[i]) * r[i]; }
      slabBack(ax, N, K, d.th, upd);
    });
    for (let i = 0; i < x.length; i++) { const v = x[i] + C[i] * upd[i]; x[i] = v > 0 ? v : 0; }
  }
  return x;
}
// the per-tilt slices spread back over their slabs and averaged (an unfiltered back-projection)
export function fuseAverage(data, N, K) {
  const x = new Float32Array(N ** 3), sT = N / K;
  for (const d of data) slabBack(d.slabs, N, K, d.th, x, 1 / (sT * data.length));
  return x;
}

// ---------------------------------------------------------------- measurements
// FWHM (Å) of an atom along x (lateral, along the tilt axis) and z (the beam at 0°), through its known centre
export function atomWidths(vol, N, dx, a) {
  const c = N / 2 - 0.5, ix = Math.round(c + a.x / dx), iy = Math.round(c + a.y / dx), iz = Math.round(c + a.z / dx);
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N ? 0 : vol[i + N * (j + N * k)]);
  let pk = 0; for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) pk = Math.max(pk, at(ix + i, iy + j, iz + k));
  const half = pk / 2;
  const width = (f) => { let lo = N, hi = N; for (let s = 1; s < N; s++) if (f(-s) < half) { const v0 = f(-s + 1), v = f(-s); lo = s - 1 + (v0 - half) / (v0 - v || 1); break; } for (let s = 1; s < N; s++) if (f(s) < half) { const v0 = f(s - 1), v = f(s); hi = s - 1 + (v0 - half) / (v0 - v || 1); break; } return (lo + hi) * dx; };
  return { x: width((s) => at(ix + s, iy, iz)), z: width((s) => at(ix, iy, iz + s)), peak: pk };
}
// the profile along z through (x, y) (Å from the centre), and how deep the dip between two peaks is (0: not
// resolved, 1: fully separated)
export function depthProfile(vol, N, dx, x, y) {
  const c = N / 2 - 0.5, ix = Math.round(c + x / dx), iy = Math.round(c + y / dx), p = new Float32Array(N);
  for (let z = 0; z < N; z++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += vol[ix + i + N * (iy + j + N * z)] ?? 0; p[z] = s / 9; }
  return p;
}
export function dipBetween(p, N, dx, z1, z2) {
  const c = N / 2 - 0.5, a = Math.round(c + z1 / dx), b = Math.round(c + z2 / dx), win = Math.round(1 / dx);
  const peak = (i) => Math.max(...Array.from({ length: 2 * win + 1 }, (_, d) => p[i - win + d] ?? 0));
  let mn = Infinity; for (let i = a + win; i <= b - win; i++) mn = Math.min(mn, p[i]);
  const pk = Math.min(peak(a), peak(b));
  return pk > 0 ? Math.max(0, 1 - mn / pk) : 0;
}
export const correlation = (a, b) => { let sa = 0, sb = 0; const n = a.length; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; } sa /= n; sb /= n; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { const u = a[i] - sa, v = b[i] - sb; ab += u * v; aa += u * u; bb += v * v; } return ab / Math.sqrt(aa * bb || 1); };

// ---------------------------------------------------------------- the pipeline
export function tiltAngles(n, max) { return n === 1 ? [0] : Array.from({ length: n }, (_, i) => -max + (2 * max * i) / (n - 1)); }

export function ptInit(o = {}) {
  const p = { ...PT_DEFAULTS, ...o }, N = p.N, lam = wavelength(p.kV);
  const atoms = p.atoms ?? TEST_ATOMS, truth = phantom(atoms, N, p.dx);
  // the scan covers the cube; the object grid adds a window's margin around it
  const gridN = N + p.n4 + 8, step = (N * p.dx) / p.scan, dz = (N * p.dx) / p.K;
  const geom = { N: p.scan, n4: p.n4, gridN, dx: p.dx, step, scan: N * p.dx, K: p.K, dz };
  // the probe: an aperture of α, focused at mid-depth (at the entrance it is defocused by −L/2), normalised so a
  // pattern holds the electrons of one position (dose · step²)
  const n4 = p.n4, pr = new Float64Array(n4 * n4), pi = new Float64Array(n4 * n4), kA = (p.alpha * 1e-3) / lam, L = N * p.dx;
  for (let y = 0; y < n4; y++) for (let x = 0; x < n4; x++) {
    const kx = (x < n4 / 2 ? x : x - n4) / (n4 * p.dx), ky = (y < n4 / 2 ? y : y - n4) / (n4 * p.dx), k2 = kx * kx + ky * ky;
    if (k2 > kA * kA) continue;
    const ch = Math.PI * lam * (L / 2) * k2; pr[x + n4 * y] = Math.cos(ch); pi[x + n4 * y] = Math.sin(ch);
  }
  K.fft2(pr, pi, n4, true);
  // centre the probe in its window
  const sr = new Float64Array(n4 * n4), si = new Float64Array(n4 * n4), h = n4 / 2;
  for (let y = 0; y < n4; y++) for (let x = 0; x < n4; x++) { const q = ((y + h) % n4) * n4 + ((x + h) % n4); sr[x + n4 * y] = pr[q]; si[x + n4 * y] = pi[q]; }
  const perPos = Number.isFinite(p.dose) ? (p.dose / p.tilts) * step * step : 1;
  let s = 0; for (let i = 0; i < sr.length; i++) s += sr[i] ** 2 + si[i] ** 2;
  const sc = Math.sqrt(perPos / (s * n4 * n4)); for (let i = 0; i < sr.length; i++) { sr[i] *= sc; si[i] *= sc; }
  const prop = { re: new Float64Array(n4 * n4), im: new Float64Array(n4 * n4) }, kmax = (2 / 3) * (1 / (2 * p.dx));
  for (let y = 0; y < n4; y++) for (let x = 0; x < n4; x++) {
    const kx = (x < n4 / 2 ? x : x - n4) / (n4 * p.dx), ky = (y < n4 / 2 ? y : y - n4) / (n4 * p.dx), k2 = kx * kx + ky * ky;
    if (k2 > kmax * kmax) continue;
    const ch = -Math.PI * lam * dz * k2; prop.re[x + n4 * y] = Math.cos(ch); prop.im[x + n4 * y] = Math.sin(ch);
  }
  return { p, N, lam, atoms, truth, geom, probe: { re: sr, im: si }, prop, angles: tiltAngles(p.tilts, p.maxTilt), t: 0, stage: 'data', data: [], perPos, rng: mulberry32(p.seed), progress: 0, errHist: [] };
}
export function ptStep(st, budget = Infinity, now = () => Date.now()) {
  if (st.stage === 'done') return false;
  const t0 = now();
  do STAGES[st.stage](st, budget, now, t0); while (st.stage !== 'done' && now() - t0 < budget);
  return st.stage !== 'done';
}
const STAGES = {
  // the tilted object's slabs as transmission functions, and the 4D-STEM scan through them
  data(st) {
    const { p, N, geom } = st, th = st.angles[st.t], G = geom.gridN, off = Math.round((G - N) / 2);
    const slabs = slabProject(st.truth, N, p.K, th);
    const slices = slabs.map((s) => {
      const re = new Float64Array(G * G).fill(1), im = new Float64Array(G * G);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const ph = s[x + N * y], q = x + off + G * (y + off); re[q] = Math.cos(ph); im[q] = Math.sin(ph); }
      return { re, im };
    });
    const n2 = geom.n4 * geom.n4, data = new Float32Array(geom.N * geom.N * n2), fd = K.fdInit({ geom, slices, prop: st.prop, pr: st.probe.re, pi: st.probe.im }, data);
    K.fdStep(fd, Infinity, () => 0);
    if (Number.isFinite(p.dose)) for (let i = 0; i < data.length; i++) data[i] = poisson(data[i], st.rng);
    st.cur = { th, data, T: {} };
    K.msInit(st.cur.T, geom, p.seed + st.t);
    st.cur.T.maxIter = p.iters;
    st.stage = 'recon';
  },
  // MS-ePIE for this tilt (a slice of the budget at a time)
  recon(st, budget, now, t0) {
    const { geom } = st, c = st.cur;
    const more = K.msStep(c.T, geom, st.probe.re, st.probe.im, st.prop, c.data, Math.max(5, budget - (now() - t0)), now);
    st.progress = (st.t + c.T.iter / c.T.maxIter) / st.angles.length;
    if (more && c.T.iter < c.T.maxIter) return;
    // the K phase slices, cropped to the cube
    const { N } = st, G = geom.gridN, off = Math.round((G - N) / 2);
    const slabs = c.T.O.map((O) => { const s = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const q = x + off + G * (y + off); s[x + N * y] = Math.atan2(O.im[q], O.re[q]); } return s; });
    st.data.push({ th: c.th, slabs, err: c.T.errHist.slice() });
    st.cur = null; st.t++;
    st.stage = st.t < st.angles.length ? 'data' : 'fuse';
  },
  // the fused volume from all tilts, and the 0° tilt alone
  fuse(st) {
    const { N, p } = st, fuse = (d) => (p.fusion === 'average' ? fuseAverage(d, N, p.K) : fuseSIRT(d, N, p.K, p.sirtIter));
    const zero = st.data.reduce((a, d) => (Math.abs(d.th) < Math.abs(a.th) ? d : a));
    st.single = fuse([zero]);
    st.fused = fuse(st.data);
    st.stats = ptStats(st);
    st.stage = 'done'; st.progress = 1;
  },
};
// depth spread of the isolated atom, the stacked pair's separation, the correlation with the object
export function ptStats(st) {
  const { N, p, atoms, truth } = st, one = atoms.find((a) => a.tag === 'single'), pair = atoms.filter((a) => a.tag === 'pair');
  const out = { corrSingle: correlation(st.single, truth), corrFused: correlation(st.fused, truth), depthRes: st.lam / (p.alpha * 1e-3) ** 2, latRes: st.lam / (2 * p.alpha * 1e-3) };
  if (one) Object.assign(out, { atom: { truth: atomWidths(truth, N, p.dx, one), single: atomWidths(st.single, N, p.dx, one), fused: atomWidths(st.fused, N, p.dx, one) } });
  if (pair.length === 2) {
    const [a, b] = pair, prof = (v) => depthProfile(v, N, p.dx, a.x, a.y);
    out.pair = { z: [a.z, b.z], truth: dipBetween(prof(truth), N, p.dx, a.z, b.z), single: dipBetween(prof(st.single), N, p.dx, a.z, b.z), fused: dipBetween(prof(st.fused), N, p.dx, a.z, b.z),
      profiles: { truth: prof(truth), single: prof(st.single), fused: prof(st.fused) } };
  }
  return out;
}
// a snapshot for display and messages
export function ptResult(st, { light = false } = {}) {
  const out = { stage: st.stage, progress: st.progress, t: st.t, tilts: st.angles.length, angles: st.angles, N: st.N, dx: st.p.dx, K: st.p.K };
  if (light) return out;
  return Object.assign(out, { truth: st.truth, slices: st.data.map((d) => ({ th: d.th, slabs: d.slabs, err: d.err })), single: st.single ?? null, fused: st.fused ?? null, stats: st.stats ?? null });
}
export function runPT(o) { const st = ptInit(o); ptStep(st); return st; }
