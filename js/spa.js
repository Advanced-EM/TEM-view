// Cryo-EM single-particle analysis (M9): thousands of noisy images of one protein in random orientations,
// averaged in 3D. By the projection-slice theorem each image is a central slice of the particle's 3D Fourier
// transform (Crowther, DeRosier & Klug 1970); resolution is judged by the Fourier shell correlation of two
// independent half maps at 0.143 (Rosenthal & Henderson 2003; Scheres 2012).
//
// The pipeline, as a state machine that advances for a time budget (inline, or in the compute worker):
//   setup      the particle (apoferritin, a 24-subunit shell of four-helix bundles with octahedral symmetry, or
//              β-galactosidase, a D2 tetramer of five-domain monomers) as a density map, and its 3D Fourier transform (padded ×2, so slices interpolate well)
//   micrograph one full micrograph (~40 particles in vitreous ice): projections, ice texture, the transfer
//              function (defocus, spherical aberration, amplitude contrast or a Zernike plate, envelopes, radiation
//              damage), shot noise after the energy filter
//   ctf        defocus fitted to the micrograph's power spectrum (Thon rings)
//   pick       template picking on the phase-flipped micrograph: picks, precision and recall; the false picks
//              (ice) enter the particle stack as junk
//   stack      particles micrograph by micrograph, each group's defocus fitted from its own boxes; a first subset
//              is stored for 2D classification
//   classes    2D class averages by viewing direction; particles that do not correlate with their class average
//              (junk) are rejected
//   recon      every accepted particle inserted into the 3D Fourier volume of its half set (even/odd), with its
//              transfer function (Wiener); half maps, FSC, directional FSC along and across the preferred axis
// The approximation stated on screen: orientations come from the simulation plus an error (no projection-matching
// search); classes are by viewing direction. Damage, preferred orientation, coarse pixels and thick ice lower the
// FSC as in practice.
//
// Map convention: vol[x + N (y + N z)], the particle centred at N/2; images img[x + N y]. A view is a frame
// (a, b, d): image pixel (x, y) shows Σ_t f(x a + y b + t d), so the image transform is F(kx a + ky b).
import { wavelength, sigmaOf, imfp, mulberry32 } from './physics.js';
import { fft2 } from './kernels.js';

const TAU = 2 * Math.PI, DEG = Math.PI / 180;

// ---------------------------------------------------------------- the particle
// 24 copies (the rotation group of the cube) of one subunit: four α-helices (~40 Å rods, 10 Å apart) lying in a
// shell between radii ~40 and ~62 Å. Density is the excess potential over ice, in volts.
export function octahedralGroup() {
  const out = [], seen = new Set();
  // all signed permutation matrices with determinant +1
  for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) for (let s = 0; s < 8; s++) {
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) m[3 * r + p[r]] = s & (1 << r) ? -1 : 1;
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const k = m.join();
    if (det > 0 && !seen.has(k)) { seen.add(k); out.push(m); }
  }
  return out;
}
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// the helices (segments) of the 24 subunits, in Å from the centre
export function apoferritinRods() {
  const G = octahedralGroup();
  // the subunit centre: a general position on the shell (r = 51 Å), long axis tangential
  const c = norm([0.32, 0.17, 0.93]).map((x) => x * 51), r = norm(c), u = norm(cross(r, [1, 0.4, 0])), v = cross(r, u);
  const rods = [];
  for (const [p, q] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) { // four helices: ±5 Å across, ±4 Å in radius
    const m = c.map((x, i) => x + p * v[i] + q * r[i]);
    rods.push([m.map((x, i) => x - 20 * u[i]), m.map((x, i) => x + 20 * u[i])]);
  }
  rods.push([c.map((x, i) => x - 9 * r[i] + 12 * u[i]), c.map((x, i) => x - 9 * r[i] + 12 * u[i] + 10 * v[i])]); // the short E helix, inside
  return G.flatMap((g) => rods.map(([a, b]) => [mv(g, a), mv(g, b)]));
}
// the map on an N³ grid of px Å: Gaussian rods (σ 2.3 Å), peak ≈ 3.5 V above the ice
export function apoferritin(N, px) {
  const vol = new Float32Array(N ** 3), c = N / 2, s2 = 2 * 2.3 * 2.3, reach = 3 * 2.3;
  for (const [a, b] of apoferritinRods()) {
    const ab = b.map((x, i) => x - a[i]), L2 = dot(ab, ab);
    const lo = a.map((x, i) => Math.max(0, Math.floor((Math.min(x, b[i]) - reach) / px + c))), hi = a.map((x, i) => Math.min(N - 1, Math.ceil((Math.max(x, b[i]) + reach) / px + c)));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const p = [(x - c) * px - a[0], (y - c) * px - a[1], (z - c) * px - a[2]];
      const t = Math.max(0, Math.min(1, dot(p, ab) / L2)), d = [p[0] - t * ab[0], p[1] - t * ab[1], p[2] - t * ab[2]];
      vol[x + N * (y + N * z)] += 3.5 * Math.exp(-dot(d, d) / s2);
    }
  }
  return vol;
}

// β-galactosidase (E. coli, ~465 kDa): a tetramer with D2 symmetry (three perpendicular two-fold axes), about
// 175 × 135 × 90 Å. Each 116 kDa monomer is five domains (Jacobson et al. 1994): a jelly roll, two
// immunoglobulin-like domains, a β-sandwich and the central TIM barrel (domain 3, the active site), modelled as
// soft spheres with the barrel's ring of eight α-helices. z is the shortest axis: lying flat, the particle is seen
// along z (its preferred orientation on the grid).
export function d2Group() { return [[1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, -1, 0, 0, 0, -1], [-1, 0, 0, 0, 1, 0, 0, 0, -1], [-1, 0, 0, 0, -1, 0, 0, 0, 1]]; }
export function betaGalParts() {
  // one monomer, Å from the tetramer centre: [x, y, z, radius]
  const dom = [[52, 30, 22, 15], [24, 52, 18, 11], [44, 22, -8, 20], [70, 48, 8, 11], [22, 26, 34, 14]];
  const barrel = [44, 22, -8], blobs = [], rods = [];
  for (let i = 0; i < 8; i++) { // the TIM barrel's helices, around its axis (along z), 15 Å out, 16 Å long
    const a = (i * Math.PI) / 4, c = [barrel[0] + 15 * Math.cos(a), barrel[1] + 15 * Math.sin(a), barrel[2]];
    rods.push([[c[0], c[1], c[2] - 8], [c[0] + 3 * Math.sin(a), c[1] - 3 * Math.cos(a), c[2] + 8]]);
  }
  for (const g of d2Group()) { for (const d of dom) blobs.push([...mv(g, d.slice(0, 3)), d[3]]); }
  return { blobs, rods: d2Group().flatMap((g) => rods.map(([a, b]) => [mv(g, a), mv(g, b)])) };
}
// a map from soft spheres (1.6 V, 2 Å edge) and Gaussian rods (σ 2.3 Å, 2 V)
function renderParts(N, px, { blobs = [], rods = [] }, rodV = 2) {
  const vol = new Float32Array(N ** 3), c = N / 2;
  for (const [bx, by, bz, R] of blobs) {
    const lo = [bx, by, bz].map((x) => Math.max(0, Math.floor((x - R - 4) / px + c))), hi = [bx, by, bz].map((x) => Math.min(N - 1, Math.ceil((x + R + 4) / px + c)));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const r = Math.hypot((x - c) * px - bx, (y - c) * px - by, (z - c) * px - bz);
      vol[x + N * (y + N * z)] += 1.6 / (1 + Math.exp((r - R) / 1));
    }
  }
  const s2 = 2 * 2.3 * 2.3, reach = 3 * 2.3;
  for (const [a, b] of rods) {
    const ab = b.map((x, i) => x - a[i]), L2 = dot(ab, ab);
    const lo = a.map((x, i) => Math.max(0, Math.floor((Math.min(x, b[i]) - reach) / px + c))), hi = a.map((x, i) => Math.min(N - 1, Math.ceil((Math.max(x, b[i]) + reach) / px + c)));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const p = [(x - c) * px - a[0], (y - c) * px - a[1], (z - c) * px - a[2]];
      const t = Math.max(0, Math.min(1, dot(p, ab) / L2)), d = [p[0] - t * ab[0], p[1] - t * ab[1], p[2] - t * ab[2]];
      vol[x + N * (y + N * z)] += rodV * Math.exp(-dot(d, d) / s2);
    }
  }
  return vol;
}
// the particles to choose from: name, mass, symmetry, the pixel size that gives a box ≥ 1.5× the particle (64 px)
export const SAMPLES = {
  apo: { name: 'Apoferritin', kDa: 480, symmetry: 'octahedral (O, 24 copies)', size: '12 nm shell', px: 3.2, use: 'high-resolution alignment, CTF and optics checks, fast benchmarking: stable, compact and highly symmetric' },
  bgal: { name: 'β-Galactosidase', kDa: 465, symmetry: 'D2 (4 copies)', size: '17.5 × 13.5 × 9 nm', px: 4.0, use: 'a mid-sized complex: map quality and the whole data-collection pipeline' },
};
// the sample's map on N³ voxels of px Å, its integrated density scaled to its mass relative to apoferritin
export function sampleMap(sample, N, px) {
  if (sample !== 'bgal') return apoferritin(N, px);
  const v = renderParts(N, px, betaGalParts()), ref = apoferritin(N, px);
  let a = 0, b = 0; for (let i = 0; i < v.length; i++) { a += v[i]; b += ref[i]; }
  const f = (b / a) * (SAMPLES.bgal.kDa / SAMPLES.apo.kDa);
  for (let i = 0; i < v.length; i++) v[i] *= f;
  return v;
}

// ---------------------------------------------------------------- FFTs
const plans = new Map();
function plan(n) {
  let p = plans.get(n);
  if (p) return p;
  const lv = Math.round(Math.log2(n)), rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < lv; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((TAU * i) / n); sin[i] = Math.sin((TAU * i) / n); }
  p = { rev, cos, sin, re: new Float64Array(n), im: new Float64Array(n) };
  plans.set(n, p);
  return p;
}
// in place along the line o, o + st, …; no scaling
function fftLine(re, im, n, inv, o, st) {
  const { rev, cos, sin, re: r, im: m } = plan(n);
  for (let i = 0; i < n; i++) { r[rev[i]] = re[o + i * st]; m[rev[i]] = im[o + i * st]; }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const c = cos[k], s = inv ? sin[k] : -sin[k], a = i + j, b = a + half;
      const tr = r[b] * c - m[b] * s, ti = r[b] * s + m[b] * c;
      r[b] = r[a] - tr; m[b] = m[a] - ti; r[a] += tr; m[a] += ti;
    }
  }
  for (let i = 0; i < n; i++) { re[o + i * st] = r[i]; im[o + i * st] = m[i]; }
}
export function fft3(re, im, n, inv = false) {
  const n2 = n * n;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) fftLine(re, im, n, inv, n * (y + n * z), 1);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) fftLine(re, im, n, inv, x + n2 * z, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) fftLine(re, im, n, inv, x + n * y, n2);
  if (inv) { const f = 1 / (n2 * n); for (let i = 0; i < re.length; i++) { re[i] *= f; im[i] *= f; } }
}
const fq = (i, n) => (i < n / 2 ? i : i - n); // index → signed frequency (cycles per box)

// the 3D transform of the map padded to M = 2N, the particle centre at the origin (so the transform is nearly real)
export function projector(vol, N) {
  const M = 2 * N, re = new Float32Array(M ** 3), im = new Float32Array(M ** 3), c = N / 2;
  const R = new Float64Array(M ** 3), I = new Float64Array(M ** 3);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const X = (x - c + M) % M, Y = (y - c + M) % M, Z = (z - c + M) % M;
    R[X + M * (Y + M * Z)] = vol[x + N * (y + N * z)];
  }
  fft3(R, I, M);
  re.set(R); im.set(I);
  return { N, M, re, im };
}
// the transform of the projection in an M × M box (unshifted layout, centre at pixel 0): trilinear samples of the
// padded 3D transform at kx a + ky b (M is a power of 2, so indices wrap with a mask)
export function slice(P, f, out = { re: new Float64Array(P.M ** 2), im: new Float64Array(P.M ** 2) }) {
  const M = P.M, mk = M - 1, M2 = M * M, { a, b } = f, R = P.re, I = P.im, lim = (M / 2) ** 2;
  for (let j = 0; j < M; j++) {
    const ky = fq(j, M);
    for (let i = 0; i < M; i++) {
      const kx = fq(i, M), o = i + M * j;
      if (kx * kx + ky * ky > lim) { out.re[o] = 0; out.im[o] = 0; continue; }
      const X = kx * a[0] + ky * b[0], Y = kx * a[1] + ky * b[1], Z = kx * a[2] + ky * b[2];
      const x0 = Math.floor(X), y0 = Math.floor(Y), z0 = Math.floor(Z), fx = X - x0, fy = Y - y0, fz = Z - z0;
      const xa = x0 & mk, xb = (x0 + 1) & mk, ya = (y0 & mk) * M, yb = ((y0 + 1) & mk) * M, za = (z0 & mk) * M2, zb = ((z0 + 1) & mk) * M2;
      const gx = 1 - fx, gy = 1 - fy, gz = 1 - fz;
      const w0 = gx * gy * gz, w1 = fx * gy * gz, w2 = gx * fy * gz, w3 = fx * fy * gz, w4 = gx * gy * fz, w5 = fx * gy * fz, w6 = gx * fy * fz, w7 = fx * fy * fz;
      const k0 = xa + ya + za, k1 = xb + ya + za, k2 = xa + yb + za, k3 = xb + yb + za, k4 = xa + ya + zb, k5 = xb + ya + zb, k6 = xa + yb + zb, k7 = xb + yb + zb;
      out.re[o] = w0 * R[k0] + w1 * R[k1] + w2 * R[k2] + w3 * R[k3] + w4 * R[k4] + w5 * R[k5] + w6 * R[k6] + w7 * R[k7];
      out.im[o] = w0 * I[k0] + w1 * I[k1] + w2 * I[k2] + w3 * I[k3] + w4 * I[k4] + w5 * I[k5] + w6 * I[k6] + w7 * I[k7];
    }
  }
  return out;
}

// ---------------------------------------------------------------- orientations
// a view: beam direction d in the particle frame, image axes a, b (rotated by ψ about d)
export function viewFrame(d, psi = 0) {
  const e = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], a0 = norm(cross(e, d)), b0 = cross(d, a0), c = Math.cos(psi), s = Math.sin(psi);
  return { a: a0.map((x, i) => c * x + s * b0[i]), b: b0.map((x, i) => -s * a0[i] + c * x), d };
}
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());
const randDir = (rng) => { const z = 2 * rng() - 1, p = TAU * rng(), s = Math.sqrt(1 - z * z); return [s * Math.cos(p), s * Math.sin(p), z]; };
// preferred orientation: a fraction `pref` of the particles lie with their z axis (a four-fold axis) along the beam,
// within ~10°, as on an air–water interface; the rest at random
export function sampleView(rng, pref = 0, spread = 10) {
  let d;
  if (rng() < pref) { const t = Math.abs(gauss(rng)) * spread * DEG, p = TAU * rng(); d = [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), (rng() < 0.5 ? 1 : -1) * Math.cos(t)]; }
  else d = randDir(rng);
  return viewFrame(d, TAU * rng());
}
// the frame turned by a small random rotation (rms angle sigma degrees about a random axis): the alignment error
function rodrigues(v, k, th) { const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v); return v.map((x, i) => x * c + kv[i] * s + k[i] * kd * (1 - c)); }
export function perturb(f, sigma, rng) {
  if (!(sigma > 0)) return f;
  const k = randDir(rng), th = gauss(rng) * sigma * DEG;
  return { a: rodrigues(f.a, k, th), b: rodrigues(f.b, k, th), d: rodrigues(f.d, k, th) };
}
// K directions spread over the sphere (Fibonacci): the 2D classes
export function fibonacci(K) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < K; i++) { const z = 1 - (2 * (i + 0.5)) / K, r = Math.sqrt(1 - z * z); out.push([r * Math.cos(g * i), r * Math.sin(g * i), z]); }
  return out;
}

// ---------------------------------------------------------------- image formation
// critical exposure of protein at 300 kV, liquid-nitrogen temperature (Grant & Grigorieff 2015), e⁻/Å²
export const criticalExposure = (k) => 0.245 * Math.pow(Math.max(k, 1e-3), -1.665) + 2.81;
// amplitude left at frequency k after a total exposure D, averaged over the exposure (no dose weighting):
// (2Ne/D)(1 − e^{−D/2Ne}); `scale` stretches Ne (higher voltage, warmer specimen: < 1)
export function damage(k, D, scale = 1) { const ne = 2 * criticalExposure(k) * scale; return D > 0 ? (ne / D) * (1 - Math.exp(-D / ne)) : 1; }
// the phase-contrast transfer function T(k) (image contrast = T ⊗ phase): 2[√(1 − A²) sin χ − A cos χ] with the
// envelopes; a Zernike plate shifts the scattered waves by π/2 above its cut-on (≈ 1/250 Å⁻¹)
export function ctfParams(o) {
  const lam = wavelength(o.kV ?? 300);
  return { lam, Cs: (o.Cs ?? 2.7) * 1e7, A: o.A ?? 0.07, zpp: !!o.zpp, D: o.focalSpread ?? 40, conv: o.conv ?? 1e-5, dose: o.dose ?? 40, dmgScale: o.dmgScale ?? 1 };
}
export function transfer(k, df, c, { envelope = true, dmg = true } = {}) {
  const lam = c.lam, k2 = k * k;
  let chi = Math.PI * lam * df * k2 + 0.5 * Math.PI * c.Cs * lam ** 3 * k2 * k2;
  if (c.zpp) chi -= (Math.PI / 2) * Math.max(0, Math.min(1, (k - 1 / 250) / (0.4 / 250) + 0.5));
  let T = 2 * (Math.sqrt(1 - c.A * c.A) * Math.sin(chi) - c.A * Math.cos(chi));
  if (envelope) {
    const Et = Math.exp(-0.5 * Math.PI ** 2 * lam * lam * c.D * c.D * k2 * k2), g = df * lam * k + c.Cs * lam ** 3 * k * k2;
    T *= Et * Math.exp(-(((Math.PI * c.conv) / lam) ** 2) * g * g);
  }
  if (dmg) T *= damage(k, c.dose, c.dmgScale);
  return T;
}

// ---------------------------------------------------------------- the pipeline
// 64 pixels of 3.2 Å: a 205 Å box for the 120 Å particle (1.7×; with a tighter box the transfer function's fringes,
// cut by the box edge the same way in every image, would correlate the half maps and inflate the FSC)
export const SPA_DEFAULTS = { sample: 'apo', N: 64, px: 3.2, count: 2000, dose: 40, pref: 0, angErr: 2, df: 1.5, dfSpread: 0.6, zpp: false, kV: 300, Cs: 2.7, A: 0.07, focalSpread: 40, conv: 1e-5, ice: 300, dmgScale: 1, seed: 11, perMic: 40, subset: 1200, classes: 24, mic: 512 }; // mic: a power of 2 (radix-2 FFT)

export function spaInit(o = {}) {
  const p = { ...SPA_DEFAULTS, ...o }, N = p.N;
  const c = ctfParams(p), sig = sigmaOf(p.kV);
  // electrons per pixel through the energy filter (inelastic scattering in the ice removes the rest)
  // window membranes (environment.js) add their own inelastic loss and structural noise
  const win = p.window, nPix = p.dose * p.px * p.px * Math.exp(-p.ice / (10 * imfp(p.kV, 7)) - (win ? win.t / (10 * imfp(p.kV, win.zeff)) : 0));
  return {
    p, c, sig, nPix, stage: 'setup', rng: mulberry32(p.seed), N, M: 2 * N,
    stack: [], groups: [], made: 0, junkMade: 0, accepted: 0, rejected: { junk: 0, good: 0 }, ctfErr: [],
    views: [], log: [], progress: 0,
  };
}
// a time budget's worth of work; returns true while there is more to do
export function spaStep(st, budget = Infinity, now = () => Date.now()) {
  if (st.stage === 'done') return false;
  const t0 = now();
  do STAGES[st.stage](st); while (st.stage !== 'done' && now() - t0 < budget); // at least one unit of work
  return st.stage !== 'done';
}
const STAGES = {
  setup(st) {
    const { N, p } = st;
    st.map = sampleMap(p.sample, N, p.px);
    st.P = projector(st.map, N);
    // radial signal power of the projections |Φ(k)|² (the Wiener prior), shells of the N-box
    const pw = new Float64Array(N), cnt = new Float64Array(N), M = st.M, rad = new Float64Array(M), rc = new Float64Array(M);
    for (let z = 0; z < M; z += 2) for (let y = 0; y < M; y += 2) for (let x = 0; x < M; x += 2) {
      const r = Math.round(Math.hypot(fq(x, M), fq(y, M), fq(z, M)) / 2);
      if (r < N) { const k = x + M * (y + M * z); pw[r] += st.P.re[k] ** 2 + st.P.im[k] ** 2; cnt[r]++; }
    }
    // the rotationally averaged transform (signed, on the fine M grid): the picking template
    for (let z = 0; z < M; z++) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      const r = Math.round(Math.hypot(fq(x, M), fq(y, M), fq(z, M)));
      if (r < M) { rad[r] += st.P.re[x + M * (y + M * z)]; rc[r]++; }
    }
    st.phiRad = rad.map((v, r) => (rc[r] ? v / rc[r] : 0)); // per cycle per M-box (k = r / (M px))
    st.power = pw.map((v, r) => (cnt[r] ? v / cnt[r] : 0)).map((v) => v * (st.sig * p.px) ** 2);
    const K = p.classes;
    st.classDirs = fibonacci(K);
    st.cls = Array.from({ length: K }, () => ({ sum: new Float64Array(N * N), n: 0 }));
    const H = N / 2 + 1;
    st.half = [0, 1].map(() => ({ re: new Float64Array(N * N * N), im: new Float64Array(N * N * N), w: new Float64Array(N * N * N) }));
    st.sigN2 = (N * N) / st.nPix; // noise variance of one Fourier coefficient of a box (contrast units)
    st.H = H;
    st.stage = 'micrograph';
  },
  micrograph(st) { st.mic = makeMicrograph(st); st.stage = 'ctf'; },
  ctf(st) {
    const m = st.mic, f = fitDefocus(m.ps, st.N, st.p.px, st.c, st.p.df);
    Object.assign(m, { fit: f, dfEst: f.df });
    st.stage = 'pick';
  },
  pick(st) {
    const m = st.mic;
    m.picks = pick(m, st);
    const tp = m.picks.filter((q) => q.hit >= 0).length;
    m.precision = m.picks.length ? tp / m.picks.length : 0;
    m.recall = tp / m.parts.length;
    st.junkFrac = Math.min(0.6, 1 - m.precision);
    st.stage = st.p.stopAfter === 'pick' ? 'done' : 'stack'; // a preview stops at the first micrograph
  },
  stack(st) {
    // one micrograph's worth of particles per call
    const { p } = st, g = st.groups.length, dfTrue = -(p.df + p.dfSpread * (2 * st.rng() - 1)) * 1e4;
    const nGood = Math.min(p.perMic, p.count - st.made);
    if (nGood <= 0) { st.stage = 'classes'; return; }
    const nJunk = Math.round((nGood * st.junkFrac) / Math.max(0.4, 1 - st.junkFrac));
    const boxes = [], grp = { Tm: ctfTable(st, dfTrue, st.M, { dmg: false }), Dm: damageTable(st, st.M) };
    for (let i = 0; i < nGood + nJunk; i++) boxes.push(simulateBox(st, grp, i >= nGood));
    // the group's defocus from the power spectrum of its (2N) boxes
    const ps = new Float64Array(st.M * st.M);
    for (const b of boxes) for (let i = 0; i < ps.length; i++) ps[i] += b.FR[i] ** 2 + b.FI[i] ** 2;
    const fit = fitDefocus(ps, st.M, p.px, st.c, p.df);
    st.groups.push({ dfTrue, dfEst: fit.df, n: boxes.length }); st.lastFit = fit;
    st.ctfErr.push(fit.df - dfTrue);
    const Tn = ctfTable(st, fit.df, st.N), TmEst = ctfTable(st, fit.df, st.M);
    for (const b of boxes) {
      prepareBox(st, b, TmEst);
      b.df = fit.df; b.g = g; b.Tn = Tn;
      st.made += b.junk ? 0 : 1; st.junkMade += b.junk ? 1 : 0;
      if (st.stack.length < p.subset) { st.stack.push(b); continue; }
      if (!st.classified) { st.pendingLate = st.pendingLate ?? []; st.pendingLate.push(b); continue; }
      processParticle(st, b);
    }
    st.progress = st.made / p.count;
    if (st.stack.length >= p.subset && !st.classified) STAGES.classes(st, true);
    if (st.made >= p.count) st.stage = st.classified ? 'recon' : 'classes';
  },
  // 2D classes on the stored subset, then their verdicts; later particles are judged against the class averages
  classes(st, midway = false) {
    if (!st.classified) {
      for (const b of st.stack) { b.flip = flipDerotate(st, b); b.k = nearestClass(st, b.est.d); const c = st.cls[b.k]; for (let i = 0; i < c.sum.length; i++) c.sum[i] += b.flip[i]; c.n++; }
      st.avg = st.cls.map((c) => c.sum.map((v) => (c.n ? v / c.n : 0)));
      // reference CC per class: the median over its members
      for (const b of st.stack) b.cc = ncc(b.flip, st.avg[b.k], st.N);
      st.ccMed = st.cls.map((_, k) => { const v = st.stack.filter((b) => b.k === k).map((b) => b.cc).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0; });
      st.classified = true;
      for (const b of st.stack) judgeAndInsert(st, b);
      for (const b of st.pendingLate ?? []) processParticle(st, b);
      st.pendingLate = null;
      for (const b of st.stack) { b.fre = b.fim = b.flip = b.flipRaw = null; }
    }
    if (!midway) st.stage = st.made >= st.p.count ? 'recon' : 'stack';
  },
  recon(st) { finish(st); st.stage = 'done'; st.progress = 1; },
};

// the damage factor on an n × n grid (protein only: the ice keeps giving Thon rings)
function damageTable(st, n) {
  const t = new Float64Array(n * n), px = st.p.px;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t[i + n * j] = damage(Math.hypot(fq(i, n), fq(j, n)) / (n * px), st.c.dose, st.c.dmgScale);
  return t;
}
// T on an n × n grid (unshifted) for one defocus: shared by the boxes of a micrograph
function ctfTable(st, df, n, opts) {
  const t = new Float64Array(n * n), px = st.p.px;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t[i + n * j] = transfer(Math.hypot(fq(i, n), fq(j, n)) / (n * px), df, st.c, opts);
  return t;
}
// soft circular mask of the boxes (radius 0.42–0.48 N): processing programs mask particles before transforming, so
// the box edges (which cut through the defocus-spread signal) do not leak into the transform
function boxMask(N) {
  const m = new Float64Array(N * N), h = N / 2, r0 = 0.42 * N, r1 = 0.48 * N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const r = Math.hypot(x - h, y - h); m[x + N * y] = r < r0 ? 1 : r > r1 ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (r - r0)) / (r1 - r0)); }
  return m;
}
// a box of the stack (2N × 2N, so the signal the defocus spreads beyond the particle stays in it): the particle
// (or, for junk, only ice) projected through the microscope, with shot noise; returned as its transform FR, FI.
// The noise is white and drawn in Fourier space with Hermitian symmetry (the image is real). g.Tm: T at the true
// defocus on the 2N grid.
function simulateBox(st, g, junk) {
  const { M, p, rng } = st;
  const f = sampleView(rng, p.pref);
  const sx = gauss(rng) * 0.5, sy = gauss(rng) * 0.5; // picking/centring error, pixels
  const S = slice(st.P, f);
  const re = S.re, im = S.im, scale = junk ? 0 : st.sig * p.px, T = g.Tm, Dm = g.Dm, ia = st.iceA ?? (st.iceA = iceTable(st, M));
  // centre in the box (shift by M/2) plus the centring error: separable phase factors
  const cx = new Float64Array(2 * M), cy = new Float64Array(2 * M);
  for (let i = 0; i < M; i++) { const k = fq(i, M); let ph = (-TAU * k * (M / 2 + sx)) / M; cx[2 * i] = Math.cos(ph); cx[2 * i + 1] = Math.sin(ph); ph = (-TAU * k * (M / 2 + sy)) / M; cy[2 * i] = Math.cos(ph); cy[2 * i + 1] = Math.sin(ph); }
  const sdShot = M / Math.sqrt(2 * st.nPix); // per real/imaginary part of a coefficient: E|n|² = M²/nPix
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const q = i + M * j, jm = (M - j) % M, im2 = (M - i) % M, qm = im2 + M * jm;
    if (qm < q) { re[q] = re[qm]; im[q] = -im[qm]; continue; } // the conjugate of a coefficient already drawn
    const c = cx[2 * i] * cy[2 * j] - cx[2 * i + 1] * cy[2 * j + 1], s = cx[2 * i] * cy[2 * j + 1] + cx[2 * i + 1] * cy[2 * j];
    let a = re[q] * scale * Dm[q], b = im[q] * scale * Dm[q], u = a * c - b * s, v = a * s + b * c; // the protein, damaged
    const self = qm === q, ice = ia[q] * (self ? 1 : Math.SQRT1_2);
    if (ice) { u += ice * gauss(rng); if (!self) v += ice * gauss(rng); } // ice texture
    u *= T[q]; v *= T[q];
    if (self) { u += Math.SQRT2 * sdShot * gauss(rng); v = 0; } else { u += sdShot * gauss(rng); v += sdShot * gauss(rng); }
    re[q] = u; im[q] = v;
  }
  return { junk, truth: f, est: junk ? sampleView(rng, 0) : perturb(f, p.angErr, rng), FR: re, FI: im, shift: [sx, sy] };
}
// CTF correction in the big box, then the N × N centre: fre/fim (× T, normalized, for insertion) and flip (phase-flipped,
// low-passed, a real image for the 2D classes); the raw image is kept for the first boxes (the particle strip)
function prepareBox(st, b, Tm) {
  const { N, M, p } = st, M2 = M * M, re = new Float64Array(M2), im = new Float64Array(M2), o = N / 2, mask = st.boxMask ?? (st.boxMask = boxMask(N));
  const lp = st.lpM ?? (st.lpM = Float64Array.from({ length: M2 }, (_, q) => Math.exp(-(((Math.hypot(fq(q % M, M), fq((q / M) | 0, M)) / (M * p.px)) * 12) ** 2))));
  const crop = (out, w) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[x + N * y] = re[x + o + M * (y + o)] * (w ? w[x + N * y] : 1); };
  // × T in the big box, where T is finely sampled (on the N grid its rings alias at high frequency), then cropped
  for (let q = 0; q < M2; q++) { re[q] = b.FR[q] * Tm[q]; im[q] = b.FI[q] * Tm[q]; }
  fft2(re, im, M, true);
  b.fre = new Float64Array(N * N); b.fim = new Float64Array(N * N);
  crop(b.fre, null);
  // normalize: subtract the background (the mean outside the particle). No mask: as in RELION's reconstruction the
  // whole box is inserted (a mask would cut the signal the transfer function spreads around the particle, the same
  // way in every image, and that shared artefact would inflate the FSC); the 3D map is masked instead
  let bs = 0, bn = 0;
  for (let q = 0; q < N * N; q++) if (mask[q] < 1) { bs += b.fre[q]; bn++; }
  for (let q = 0; q < N * N; q++) b.fre[q] -= bs / bn;
  fft2(b.fre, b.fim, N);
  for (let q = 0; q < M2; q++) { const w = Math.sign(Tm[q]) * lp[q]; re[q] = b.FR[q] * w; im[q] = b.FI[q] * w; }
  fft2(re, im, M, true);
  b.flipRaw = new Float64Array(N * N); crop(b.flipRaw, null);
  if ((st.strip?.length ?? 0) < 12) {
    re.set(b.FR); im.set(b.FI); fft2(re, im, M, true);
    const img = new Float32Array(N * N); crop(img, null);
    (st.strip ??= []).push({ img, junk: b.junk });
  }
  b.FR = b.FI = null;
}
// ice texture: the amorphous ice's own projected potential. A 2.4 Å column through 300 Å of ice holds ~170 water
// molecules, so its projected density fluctuates by ~7 % (Poisson): ~0.07 rad of phase on the ~1 rad mean. Taken as
// 0.03 rad rms per 2.4 Å pixel, growing as √thickness and falling as 1/pixel size (the same noise per unit area),
// white up to the 3.7 Å ice ring. This structured noise is what makes the Thon rings visible in the power spectrum.
// Returns |n| per Fourier coefficient (E|n|² = (rms·M)²).
// windows count as extra ice for the texture: thickness × their density and mean Z relative to water's
function iceAmp(st, M) { const w = st.p.window, eq = st.p.ice + (w ? (w.t * (w.dens / 0.033) * w.zeff) / 7.4 : 0), a = 0.03 * (2.4 / st.p.px) * Math.sqrt(eq / 300) * M; return (k) => (k < 1 / 3.7 ? a : a * 0.3); }
function iceTable(st, M) {
  const f = iceAmp(st, M), t = new Float64Array(M * M), px = st.p.px;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const k = Math.hypot(fq(i, M), fq(j, M)) / (M * px); t[i + M * j] = k < 1 / (2 * px) ? f(k) : 0; }
  return t;
}

// the phase-flipped image turned into the frame of its class direction
function flipDerotate(st, b) {
  const { N } = st, re = b.flipRaw;
  const k = nearestClass(st, b.est.d), cf = viewFrame(st.classDirs[k], 0), phi = Math.atan2(dot(b.est.a, cf.b), dot(b.est.a, cf.a));
  const c = Math.cos(phi), s = Math.sin(phi), out = new Float64Array(N * N), h = N / 2;
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    const U = u - h, V = v - h, x = c * U + s * V + h, y = -s * U + c * V + h, x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= N - 1 || y0 >= N - 1) continue;
    const fx = x - x0, fy = y - y0, q = x0 + N * y0;
    out[u + N * v] = re[q] * (1 - fx) * (1 - fy) + re[q + 1] * fx * (1 - fy) + re[q + N] * (1 - fx) * fy + re[q + N + 1] * fx * fy;
  }
  return out;
}
function nearestClass(st, d) { let best = 0, bv = -2; st.classDirs.forEach((c, k) => { const v = dot(c, d); if (v > bv) { bv = v; best = k; } }); return best; }
// normalized correlation inside the particle's circle
function ncc(a, b, N) {
  const h = N / 2, r2 = (0.45 * N) ** 2;
  let sa = 0, sb = 0, n = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x - h) ** 2 + (y - h) ** 2 < r2) { sa += a[x + N * y]; sb += b[x + N * y]; n++; }
  sa /= n; sb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x - h) ** 2 + (y - h) ** 2 < r2) { const u = a[x + N * y] - sa, v = b[x + N * y] - sb; ab += u * v; aa += u * u; bb += v * v; }
  return ab / Math.sqrt(aa * bb || 1);
}
function processParticle(st, b) { b.flip = flipDerotate(st, b); b.k = nearestClass(st, b.est.d); b.cc = ncc(b.flip, st.avg[b.k], st.N); judgeAndInsert(st, b); b.fre = b.fim = b.flip = b.flipRaw = null; }
// keep the particle if it correlates with its class average (at least half the class's median), then insert it
function judgeAndInsert(st, b) {
  const ok = b.cc > 0.5 * (st.ccMed[b.k] ?? 0);
  if (!ok) { st.rejected[b.junk ? 'junk' : 'good']++; return; }
  if (b.junk) st.junkKept = (st.junkKept ?? 0) + 1;
  st.views.push(b.est.d);
  insert(st, b, st.half[st.accepted % 2]);
  st.accepted++;
}
// Fourier insertion: the (T-multiplied) box transform at frequency kx a + ky b, trilinear; the weights collect T²
function insert(st, b, h) {
  const { N } = st, { a, b: bb } = b.est, lim = (N / 2) ** 2, mk = N - 1, N2 = N * N, T = b.Tn, R = h.re, I = h.im, W = h.w;
  for (let j = 0; j < N; j++) {
    const ky = fq(j, N);
    for (let i = 0; i < N; i++) {
      const kx = fq(i, N);
      if (kx * kx + ky * ky >= lim) continue;
      // undo the box centring (pixel N/2): × (−1)^(kx+ky), so the particle centre is the origin of the volume
      const q = i + N * j, t = (kx + ky) & 1 ? -1 : 1, vr = t * b.fre[q], vi = t * b.fim[q], tt = T[q] * T[q]; // the data are × T already
      const X = kx * a[0] + ky * bb[0], Y = kx * a[1] + ky * bb[1], Z = kx * a[2] + ky * bb[2];
      const x0 = Math.floor(X), y0 = Math.floor(Y), z0 = Math.floor(Z), fx = X - x0, fy = Y - y0, fz = Z - z0;
      for (let dz = 0; dz < 2; dz++) {
        const wz = dz ? fz : 1 - fz, oz = ((z0 + dz) & mk) * N2;
        for (let dy = 0; dy < 2; dy++) {
          const wy = wz * (dy ? fy : 1 - fy), oy = oz + ((y0 + dy) & mk) * N;
          for (let dx = 0; dx < 2; dx++) {
            const w = wy * (dx ? fx : 1 - fx), o = oy + ((x0 + dx) & mk);
            R[o] += w * vr; I[o] += w * vi; W[o] += w * tt;
          }
        }
      }
    }
  }
}
// the half maps (Wiener: Σ T·I / (Σ T² + σ²/|Φ|²)), masked FSC and its directional versions
function finish(st) {
  const { N, p } = st, N3 = N ** 3, h = N / 2, maps = [];
  for (const H of st.half) {
    const re = new Float64Array(N3), im = new Float64Array(N3);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = x + N * (y + N * z), r = Math.hypot(fq(x, N), fq(y, N), fq(z, N));
      if (r >= h) continue;
      const eps = st.sigN2 / Math.max(st.power[Math.round(r)] ?? 0, 1e-30);
      re[o] = H.re[o] / (H.w[o] + eps); im[o] = H.im[o] / (H.w[o] + eps);
    }
    fft3(re, im, N, true);
    const m = new Float32Array(N3);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m[x + N * (y + N * z)] = re[((x + h) % N) + N * (((y + h) % N) + N * ((z + h) % N))] / (st.sig * p.px);
    maps.push(m);
  }
  st.maps = maps;
  st.mapAvg = maps[0].map((v, i) => (v + maps[1][i]) / 2);
  st.fsc = fsc(maps[0], maps[1], N, p.px);
  // directional FSCs unmasked: a mask's edge would leak the well-sampled directions into the sparse ones
  st.fscZ = fsc(maps[0], maps[1], N, p.px, { cone: 'z', radius: 0.95 });
  st.fscXY = fsc(maps[0], maps[1], N, p.px, { cone: 'xy', radius: 0.95 });
  st.mapCorr = corr(st.mapAvg, st.map);
}
const corr = (a, b) => { let sa = 0, sb = 0; const n = a.length; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; } sa /= n; sb /= n; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { const u = a[i] - sa, v = b[i] - sb; ab += u * v; aa += u * u; bb += v * v; } return ab / Math.sqrt(aa * bb || 1); };

// FSC of two maps inside a soft spherical mask; cone 'z' (within 30° of the z axis, where preferred orientation
// leaves views missing) or 'xy' (within 30° of the plane); resolution where FSC first falls below 0.143
export function fsc(a, b, N, px, { cone = null, radius = 0.485 } = {}) {
  const h = N / 2, R = radius * N, A = [new Float64Array(N ** 3), new Float64Array(N ** 3)], I = [new Float64Array(N ** 3), new Float64Array(N ** 3)];
  [a, b].forEach((m, k) => {
    // the solvent level (mean outside the mask) is arbitrary: removed first, or the mask's edge times that constant,
    // the same in both maps, would correlate them at high frequency
    let bs = 0, bn = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - h, y - h, z - h) > R) { bs += m[x + N * (y + N * z)]; bn++; }
    const off = bn ? bs / bn : 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - h, y - h, z - h), w = r < R - 3 ? 1 : r > R ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (r - R + 3)) / 3);
      A[k][((x - h + N) % N) + N * (((y - h + N) % N) + N * ((z - h + N) % N))] = w * (m[x + N * (y + N * z)] - off);
    }
    fft3(A[k], I[k], N);
  });
  const num = new Float64Array(h + 1), d1 = new Float64Array(h + 1), d2 = new Float64Array(h + 1);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const kx = fq(x, N), ky = fq(y, N), kz = fq(z, N), r = Math.hypot(kx, ky, kz), s = Math.round(r);
    if (s > h || r === 0) continue;
    if (cone === 'z' && Math.abs(kz) / r < Math.cos(30 * DEG)) continue;
    if (cone === 'xy' && Math.abs(kz) / r > Math.sin(30 * DEG)) continue;
    const o = x + N * (y + N * z);
    num[s] += A[0][o] * A[1][o] + I[0][o] * I[1][o]; d1[s] += A[0][o] ** 2 + I[0][o] ** 2; d2[s] += A[1][o] ** 2 + I[1][o] ** 2;
  }
  const curve = [];
  for (let s = 1; s <= h; s++) curve.push({ k: s / (N * px), fsc: d1[s] && d2[s] ? num[s] / Math.sqrt(d1[s] * d2[s]) : 0 });
  // the resolution: where the FSC falls below 0.143 and stays below for three shells (a single shell where the
  // particle itself has almost no signal, like the hollow shell's minimum near 17 Å, does not count)
  let res = 2 * px; // Nyquist unless it falls below earlier
  const below = (i) => curve.slice(i, i + 3).every((c) => c.fsc < 0.143);
  for (let i = 1; i < curve.length; i++) if (below(i)) {
    const c0 = curve[i - 1], c1 = curve[i], t = c0.fsc > c1.fsc ? (c0.fsc - 0.143) / (c0.fsc - c1.fsc) : 0;
    res = 1 / (c0.k + t * (c1.k - c0.k)); break;
  }
  // band: the mean FSC from 20 to 8 Å (steadier than a crossing in a sparse cone, where few voxels share a shell)
  const bandC = curve.filter((c) => c.k >= 1 / 20 && c.k <= 1 / 8);
  return { curve, res, mean: curve.reduce((s, c) => s + c.fsc, 0) / curve.length, band: bandC.length ? bandC.reduce((s, c) => s + c.fsc, 0) / bandC.length : null };
}

// ---------------------------------------------------------------- micrograph, CTF fit, picking
function makeMicrograph(st) {
  const { p, rng, N, M: Mbox } = st, M = p.mic, df = -(p.df + p.dfSpread * (2 * rng() - 1)) * 1e4, parts = [];
  for (let tries = 0; parts.length < p.perMic && tries < 4000; tries++) {
    const x = N / 2 + rng() * (M - N), y = N / 2 + rng() * (M - N);
    if (parts.every((q) => Math.hypot(q.x - x, q.y - y) > 0.9 * N)) parts.push({ x, y, f: sampleView(rng, p.pref) });
  }
  const re = new Float64Array(M * M), im = new Float64Array(M * M), scale = st.sig * p.px;
  for (const q of parts) {
    const S = slice(st.P, q.f), r = S.re, i2 = S.im;
    for (let j = 0; j < Mbox; j++) for (let i = 0; i < Mbox; i++) { const ph = -Math.PI * (fq(i, Mbox) + fq(j, Mbox)), c = Math.cos(ph), s = Math.sin(ph), o = i + Mbox * j, a = r[o], b = i2[o]; r[o] = a * c - b * s; i2[o] = a * s + b * c; }
    fft2(r, i2, Mbox, true);
    const x0 = Math.round(q.x) - Mbox / 2, y0 = Math.round(q.y) - Mbox / 2;
    for (let y = 0; y < Mbox; y++) for (let x = 0; x < Mbox; x++) { const X = x0 + x, Y = y0 + y; if (X >= 0 && Y >= 0 && X < M && Y < M) re[X + M * Y] += r[x + Mbox * y] * scale; }
  }
  fft2(re, im, M);
  const iceA = iceAmp(st, M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const o = i + M * j, k = Math.hypot(fq(i, M), fq(j, M)) / (M * p.px);
    const dm = damage(k, st.c.dose, st.c.dmgScale);
    let a = re[o] * dm, b = im[o] * dm;
    if (k < 1 / (2 * p.px)) { a += iceA(k) * gauss(rng); b += iceA(k) * gauss(rng); }
    const T = o ? transfer(k, df, st.c, { dmg: false }) : 0;
    re[o] = T * a; im[o] = T * b;
  }
  fft2(re, im, M, true);
  const img = new Float32Array(M * M), sd = 1 / Math.sqrt(st.nPix);
  for (let i = 0; i < img.length; i++) img[i] = re[i] + sd * gauss(rng);
  // power spectrum from 4 × 4 tiles of N × N (periodogram average, as CTF-fitting programs do)
  const ps = new Float64Array(N * N), tr = new Float64Array(N * N), ti = new Float64Array(N * N);
  for (let ty = 0; ty + N <= M; ty += N / 2) for (let tx = 0; tx + N <= M; tx += N / 2) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const w = Math.sin((Math.PI * (x + 0.5)) / N) * Math.sin((Math.PI * (y + 0.5)) / N); tr[x + N * y] = w * img[tx + x + M * (ty + y)]; ti[x + N * y] = 0; }
    fft2(tr, ti, N);
    for (let i = 0; i < ps.length; i++) ps[i] += tr[i] ** 2 + ti[i] ** 2;
  }
  return { M, img, parts, dfTrue: df, ps };
}
// defocus from a power spectrum (N × N, unshifted): the radial profile minus its smooth background, correlated
// with T² over defocus (coarse grid, then refined); returns the profile and the fitted model for display
export function fitDefocus(ps, N, px, c, dfGuessUm = 1.5) {
  const h = N / 2, prof = new Float64Array(h), cnt = new Float64Array(h);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const r = Math.round(Math.hypot(fq(i, N), fq(j, N))); if (r < h) { prof[r] += ps[i + N * j]; cnt[r]++; } }
  const lg = Array.from(prof, (v, r) => Math.log((cnt[r] ? v / cnt[r] : 0) + 1e-30));
  // background: a running mean of the log profile, narrower than the rings
  const wdw = Math.max(3, Math.round(N / 20));
  const bg = lg.map((_, r) => { let s = 0, n = 0; for (let q = Math.max(1, r - wdw); q <= Math.min(h - 1, r + wdw); q++) { s += lg[q]; n++; } return s / n; });
  const sub = lg.map((v, r) => v - bg[r]), lo = Math.max(2, Math.round((N * px) / 40)), hi = Math.min(h - 2, Math.round((N * px) / 6));
  const score = (df) => {
    const m = [], d = [];
    for (let r = lo; r <= hi; r++) { const k = r / (N * px), T = transfer(k, df, c, { envelope: false, dmg: false }); m.push(T * T); d.push(sub[r]); }
    return corr(m, d);
  };
  let best = -dfGuessUm * 1e4, bs = -2;
  for (let df = -45000; df <= -1000; df += 100) { const s = score(df); if (s > bs) { bs = s; best = df; } }
  if (c.zpp) for (let df = -1000; df <= 1000; df += 50) { const s = score(df); if (s > bs) { bs = s; best = df; } }
  for (let df = best - 100; df <= best + 100; df += 5) { const s = score(df); if (s > bs) { bs = s; best = df; } }
  return { df: best, score: bs, profile: sub, range: [lo, hi], model: sub.map((_, r) => { const T = transfer(r / (N * px), best, c, { envelope: false, dmg: false }); return T * T; }) };
}
// template picking: the micrograph phase-flipped with the fitted defocus and low-passed, correlated with the
// particle's rotationally averaged projection through the same filter; peaks above median + 3 MAD, at least 0.8 particle diameters apart; hit: the true particle within 8 px
function pick(m, st) {
  const { M } = m, { N, p } = st, re = Float64Array.from(m.img), im = new Float64Array(M * M), sig = 1 / 20;
  fft2(re, im, M);
  // matched filter: the image phase-flipped and low-passed, against the particle's rotationally averaged transform
  // through the same |T| and low-pass (the template of a featureless ~12 nm ball would match edges poorly)
  const Mb = st.M, phi = st.phiRad;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const o = i + M * j, k = Math.hypot(fq(i, M), fq(j, M)) / (M * p.px), T = o ? transfer(k, m.dfEst, st.c, { dmg: false }) : 0, lp = Math.exp(-((k / sig) ** 2));
    const rr = k * Mb * p.px, r0 = Math.floor(rr), f = rr - r0, tmpl = r0 + 1 < Mb ? phi[r0] * (1 - f) + phi[r0 + 1] * f : 0;
    const w = Math.sign(T) * lp * Math.abs(T) * lp * tmpl;
    re[o] *= w; im[o] *= w;
  }
  fft2(re, im, M, true);
  // threshold from robust statistics (median + k·MAD): the particles themselves would inflate a standard deviation
  const sorted = Float64Array.from(re).sort(), med = sorted[sorted.length >> 1];
  const dev = Float64Array.from(re, (v) => Math.abs(v - med)).sort(), mad = 1.4826 * dev[dev.length >> 1];
  const thr = med + (st.p.pickK ?? 3) * mad, minD = 0.8 * N, edge = N / 2;
  const cand = [];
  for (let y = edge; y < M - edge; y++) for (let x = edge; x < M - edge; x++) {
    const v = re[x + M * y];
    if (v < thr) continue;
    let peak = true;
    for (let dy = -2; dy <= 2 && peak; dy++) for (let dx = -2; dx <= 2; dx++) if (re[x + dx + M * (y + dy)] > v) { peak = false; break; }
    if (peak) cand.push({ x, y, v });
  }
  cand.sort((a, b) => b.v - a.v);
  const picks = [];
  for (const c of cand) if (picks.every((q) => Math.hypot(q.x - c.x, q.y - c.y) > minD)) picks.push(c);
  const used = new Set();
  for (const q of picks) {
    let hit = -1, bd = 8;
    m.parts.forEach((t, i) => { const d = Math.hypot(t.x - q.x, t.y - q.y); if (d < bd && !used.has(i)) { bd = d; hit = i; } });
    if (hit >= 0) used.add(hit);
    q.hit = hit;
  }
  return picks;
}

// ---------------------------------------------------------------- results
// a snapshot for display and messages (plain arrays and typed arrays only); light: only the counters and views
// (sent often while the stack is collected), otherwise everything there is so far
export function spaResult(st, { light = false } = {}) {
  const m = st.mic, done = st.stage === 'done' && !!st.maps;
  const out = {
    stage: st.stage, progress: st.progress, N: st.N, px: st.p.px, count: st.p.count, made: st.made, junkMade: st.junkMade, accepted: st.accepted, rejected: { ...st.rejected }, junkKept: st.junkKept ?? 0,
    micrographs: st.groups.length, ctfErr: st.ctfErr.length ? Math.sqrt(st.ctfErr.reduce((s, e) => s + e * e, 0) / st.ctfErr.length) : null,
    views: Float32Array.from(st.views.slice(0, 20000).flat()), preview: st.p.stopAfter === 'pick',
  };
  if (light) return out;
  return Object.assign(out, {
    mic: m ? { M: m.M, img: m.img, parts: m.parts.map((q) => ({ x: q.x, y: q.y })), picks: m.picks?.map((q) => ({ x: q.x, y: q.y, hit: q.hit })) ?? null, dfTrue: m.dfTrue, dfEst: m.dfEst ?? null, precision: m.precision ?? null, recall: m.recall ?? null, ps: m.ps ? Float32Array.from(m.ps) : null, fit: m.fit ? { profile: m.fit.profile, model: m.fit.model, range: m.fit.range, score: m.fit.score } : null } : null,
    gallery: st.avg ? st.avg.map((a, k) => ({ img: Float32Array.from(a), n: st.cls[k].n, dir: st.classDirs[k] })) : null, strip: st.strip ?? null,
    map: st.map ?? null, mapAvg: done ? st.mapAvg : null, maps: done ? st.maps : null,
    fsc: done ? st.fsc : null, fscZ: done ? st.fscZ : null, fscXY: done ? st.fscXY : null, mapCorr: done ? st.mapCorr : null,
  });
}
// the whole pipeline at once (tests, scripts)
export function runSPA(o) { const st = spaInit(o); spaStep(st); return st; }
