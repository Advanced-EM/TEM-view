// Electron optics, specimen models, FFT and spectroscopy tables.
// Units: lengths in Ångström unless noted, energies in eV, angles in radians.

export const MC2 = 510998.95; // electron rest energy, eV

export function wavelength(kV) {
  const V = kV * 1e3;
  return 12.2643 / Math.sqrt(V * (1 + 0.978476e-6 * V));
}
export const gammaOf = (kV) => 1 + (kV * 1e3) / MC2;
export function betaOf(kV) {
  const g = gammaOf(kV);
  return Math.sqrt(1 - 1 / (g * g));
}
// interaction constant, rad / (V·Å)
export function sigmaOf(kV) {
  const V = kV * 1e3;
  return ((2 * Math.PI) / (wavelength(kV) * V)) * (MC2 + V) / (2 * MC2 + V);
}
// Optimum defocus mirrors the sign of Cs: positive Cs wants underfocus (atoms dark), negative Cs wants
// overfocus (negative-Cs imaging, atoms bright). Cs = 0 gives no phase contrast at any single optimum.
export const scherzerDefocus = (CsA, lam) => -1.2 * Math.sign(CsA) * Math.sqrt(Math.abs(CsA) * lam);
export const probeDefocus = (CsA, lam) => -0.75 * Math.sign(CsA) * Math.sqrt(Math.abs(CsA) * lam);
export const pointResolution = (CsA, lam) => 0.66 * Math.pow(Math.abs(CsA), 0.25) * Math.pow(lam, 0.75);
export const infoLimit = (lam, focalSpread) => Math.sqrt((Math.PI * lam * focalSpread) / 2);

// Inelastic mean free path (Malis et al.), nm. E0 in keV, beta in mrad.
export function imfp(kV, zeff, betaMrad = 20) {
  const F = (1 + kV / 1022) / Math.pow(1 + kV / 511, 2);
  const Em = 7.6 * Math.pow(zeff, 0.36);
  return (106 * F * kV) / (Em * Math.log((2 * betaMrad * kV) / Em));
}

// ---------------------------------------------------------------- random
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
let spareGauss = null;
export function gauss() {
  if (spareGauss !== null) { const g = spareGauss; spareGauss = null; return g; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt((-2 * Math.log(s)) / s);
  spareGauss = v * m;
  return u * m;
}
export function poisson(l) {
  if (l <= 0) return 0;
  if (l < 25) {
    const L = Math.exp(-l);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(l + Math.sqrt(l) * gauss()));
}

// ---------------------------------------------------------------- FFT
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
function fft1(re, im, n, inv) {
  const { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = cos[k], s = inv ? sin[k] : -sin[k];
        const a = i + j, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
export function fft2(re, im, n, inv = false) {
  const { tr, ti } = plan(n);
  for (let y = 0; y < n; y++) {
    const o = y * n;
    for (let x = 0; x < n; x++) { tr[x] = re[o + x]; ti[x] = im[o + x]; }
    fft1(tr, ti, n, inv);
    for (let x = 0; x < n; x++) { re[o + x] = tr[x]; im[o + x] = ti[x]; }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { tr[y] = re[y * n + x]; ti[y] = im[y * n + x]; }
    fft1(tr, ti, n, inv);
    for (let y = 0; y < n; y++) { re[y * n + x] = tr[y]; im[y * n + x] = ti[y]; }
  }
}
export const freq = (i, n, dx) => (i < n / 2 ? i : i - n) / (n * dx);

// Aberration phase χ(k): defocus (negative = underfocus) and spherical aberration.
export const chi = (k2, lam, df, Cs) => Math.PI * lam * df * k2 + 0.5 * Math.PI * Cs * lam * lam * lam * k2 * k2;

// ---------------------------------------------------------------- elements
export const EL = [
  { sym: 'C', Z: 6, name: 'Carbon', color: '#b5bfcc' },
  { sym: 'O', Z: 8, name: 'Oxygen', color: '#ff7d7d' },
  { sym: 'Si', Z: 14, name: 'Silicon', color: '#5cb4ff' },
  { sym: 'Si', key: 'SiOx', Z: 14, name: 'Silicon in oxide', color: '#a7d6ff', pseudo: true },
  { sym: 'Ti', Z: 22, name: 'Titanium', color: '#c99bff' },
  { sym: 'Sr', Z: 38, name: 'Strontium', color: '#5fe3a8' },
  { sym: 'Au', Z: 79, name: 'Gold', color: '#ffcf5a' },
];
export const EI = { C: 0, O: 1, Si: 2, SiOx: 3, Ti: 4, Sr: 5, Au: 6 };
export const VP = EL.map((e) => Math.pow(e.Z, 0.75)); // projected-potential weight per atom
export const ZH = EL.map((e) => Math.pow(e.Z, 1.7)); // high-angle (Rutherford-like) weight
export const ZL = EL.map((e) => Math.pow(e.Z, 1.2)); // low-angle ADF weight

// ---------------------------------------------------------------- specimens
class AtomList {
  constructor() { this.x = []; this.y = []; this.e = []; this.L = []; this.g = []; }
  push(x, y, e, L, g) { this.x.push(x); this.y.push(y); this.e.push(e); this.L.push(L); this.g.push(g); }
  finalize(ext = 260, bin = 8) {
    this.count = this.x.length;
    this.x = Float32Array.from(this.x); this.y = Float32Array.from(this.y);
    this.e = Uint8Array.from(this.e); this.L = Float32Array.from(this.L); this.g = Uint16Array.from(this.g);
    this.ext = ext; this.bin = bin; this.nb = Math.ceil((2 * ext) / bin);
    const bins = Array.from({ length: this.nb * this.nb }, () => []);
    for (let i = 0; i < this.count; i++) {
      const bx = Math.floor((this.x[i] + ext) / bin), by = Math.floor((this.y[i] + ext) / bin);
      if (bx >= 0 && by >= 0 && bx < this.nb && by < this.nb) bins[by * this.nb + bx].push(i);
    }
    this.bins = bins.map((b) => Int32Array.from(b));
  }
  query(x0, y0, x1, y1, cb) {
    const { ext, bin, nb } = this;
    const bx0 = Math.max(0, Math.floor((x0 + ext) / bin)), bx1 = Math.min(nb - 1, Math.floor((x1 + ext) / bin));
    const by0 = Math.max(0, Math.floor((y0 + ext) / bin)), by1 = Math.min(nb - 1, Math.floor((y1 + ext) / bin));
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = this.bins[by * nb + bx];
        for (let k = 0; k < b.length; k++) cb(b[k]);
      }
  }
}

function rot(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}
function reciprocal(a1, a2) {
  const det = a1[0] * a2[1] - a1[1] * a2[0];
  return [[a2[1] / det, -a2[0] / det], [-a1[1] / det, a1[0] / det]];
}
const bar = (n) => (n < 0 ? `${-n}̅` : `${n}`);

// Fill a rotated 2D lattice inside `inside(x,y)`.
function fillLattice(A, { a1, a2, basis, angle, origin = [0, 0], R = 260, inside, L, g }) {
  const r1 = rot(a1, angle), r2 = rot(a2, angle);
  const nMax = Math.ceil(R / Math.min(Math.hypot(...a1), Math.hypot(...a2))) + 2;
  for (let i = -nMax; i <= nMax; i++)
    for (let j = -nMax; j <= nMax; j++)
      for (const b of basis) {
        const u = i + b[0], v = j + b[1];
        const x = origin[0] + u * r1[0] + v * r2[0], y = origin[1] + u * r1[1] + v * r2[1];
        if (Math.abs(x - origin[0]) > R || Math.abs(y - origin[1]) > R) continue;
        const Lc = inside(x, y);
        if (Lc === false || Lc === 0) continue;
        for (const el of b[2]) A.push(x, y, el, typeof Lc === 'number' ? Lc : L, g);
      }
}

function makeGold() {
  const A = new AtomList();
  const a = 4.078, ax = a / Math.SQRT2, ay = a;
  const rng = mulberry32(20240917);
  const parts = [
    { x: -6, y: 4, r: 21, rot: 0.42 },
    { x: 27, y: -21, r: 11, rot: 1.62 },
    { x: 29, y: 25, r: 8.5, rot: 2.51 },
    { x: -33, y: -27, r: 13, rot: 1.05 },
    { x: -36, y: 33, r: 9, rot: 2.9 },
  ];
  let tries = 0;
  while (parts.length < 46 && tries++ < 4000) {
    const p = { x: (rng() * 2 - 1) * 200, y: (rng() * 2 - 1) * 200, r: 7 + rng() * 22, rot: rng() * Math.PI };
    if (parts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > p.r + q.r + 7)) parts.push(p);
  }
  const basis = [[0, 0, [EI.Au]], [0.5, 0.5, [EI.Au]]];
  parts.forEach((p, gi) => {
    fillLattice(A, {
      a1: [ax, 0], a2: [0, ay], basis, angle: p.rot, origin: [p.x, p.y], R: p.r + 4, g: gi,
      inside: (x, y) => {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
        return d2 < p.r * p.r ? 2 * Math.sqrt(p.r * p.r - d2) : false;
      },
    });
  });
  A.finalize();
  const grains = parts.map((p) => ({ a1: rot([ax, 0], p.rot), a2: rot([0, ay], p.rot), label: (m, n) => `${bar(m)}${bar(-m)}${bar(n)}` }));
  return {
    id: 'au', name: 'Gold nanoparticles on carbon', short: 'Au on C',
    atoms: A, parts, grains, period: ax, poly: true, center: [0, 0], fov: 8, zone: '[110]',
    elements: [EI.Au, EI.C],
    amorph(x, y) { return 'C'; },
    filmOnly: true,
    colLen(t) { return t; },
    thicknessAt(x, y, t) {
      let s = t;
      for (const p of parts) { const d2 = (x - p.x) ** 2 + (y - p.y) ** 2; if (d2 < p.r * p.r) s += 2 * Math.sqrt(p.r * p.r - d2); }
      return s;
    },
    tauAt(x, y, t, kV) {
      let s = t / (10 * imfp(kV, 6));
      for (const p of parts) { const d2 = (x - p.x) ** 2 + (y - p.y) ** 2; if (d2 < p.r * p.r) s += (2 * Math.sqrt(p.r * p.r - d2)) / (10 * imfp(kV, 79)); }
      return s;
    },
    rings: [{ d: 2.355, hkl: '111' }, { d: 2.039, hkl: '200' }, { d: 1.442, hkl: '220' }, { d: 1.23, hkl: '311' }],
    labels: [
      { x: -6, y: -20, text: 'Au nanoparticle' },
      { x: 12, y: 36, text: 'amorphous carbon film' },
    ],
    plasmon: [{ Ep: 24, G: 16, frac: 0.8 }, { Ep: 25, G: 26, frac: 0.2 }],
    zeff: 6,
  };
}

function makeSilicon() {
  const A = new AtomList();
  const a = 5.431, ax = a / Math.SQRT2, ay = a;
  const bnd = (y) => 3 * Math.sin(y / 19) + 1.6 * Math.sin(y / 6.1 + 2) + (Math.sin(y * 0.9) > 0.85 ? 1.5 : 0);
  const basis = [[0, 0, [EI.Si]], [0, 0.25, [EI.Si]], [0.5, 0.5, [EI.Si]], [0.5, 0.75, [EI.Si]]];
  fillLattice(A, { a1: [ax, 0], a2: [0, ay], basis, angle: 0, origin: [0.3, 0.2], R: 250, g: 0, L: -1, inside: (x, y) => x < bnd(y) });
  A.finalize();
  return {
    id: 'si', name: 'Silicon / SiO₂ interface', short: 'Si / SiO₂',
    atoms: A, grains: [{ a1: [ax, 0], a2: [0, ay], label: (m, n) => `${bar(m)}${bar(-m)}${bar(n)}` }],
    period: ax, center: [0, 0], fov: 6, zone: '[110]',
    elements: [EI.Si, EI.SiOx, EI.O],
    amorph(x, y) { return x > bnd(y) + 0.8 ? 'SiO2' : null; },
    bnd,
    thicknessAt(x, y, t) { return t; },
    tauAt(x, y, t, kV) { return t / (10 * imfp(kV, x > bnd(y) ? 10.8 : 14)); },
    rings: [{ d: 3.135, hkl: '111' }, { d: 1.92, hkl: '220' }, { d: 1.638, hkl: '311' }, { d: 1.358, hkl: '400' }],
    labels: [
      { x: -17, y: -22, text: 'crystalline Si  [110]' },
      { x: 17, y: -22, text: 'amorphous SiO₂' },
    ],
    plasmon: [{ Ep: 16.7, G: 3.8, frac: 0.55 }, { Ep: 22.5, G: 12, frac: 0.45 }],
    zeff: 12,
  };
}

function makeSTO() {
  const A = new AtomList();
  const a = 3.905;
  const th = Math.atan(1 / 3); // Σ5 (310) symmetric tilt boundary: ±18.43°
  const basis = [[0, 0, [EI.Sr]], [0.5, 0.5, [EI.Ti, EI.O]], [0.5, 0, [EI.O]], [0, 0.5, [EI.O]]];
  fillLattice(A, { a1: [a, 0], a2: [0, a], basis, angle: th, origin: [0, 0], R: 250, g: 0, L: -1, inside: (x) => x < -0.05 });
  const left = { x: [...A.x], y: [...A.y] };
  const B = new AtomList();
  fillLattice(B, { a1: [a, 0], a2: [0, a], basis, angle: -th, origin: [0, 0], R: 250, g: 1, L: -1, inside: (x) => x >= -0.05 });
  for (let i = 0; i < B.x.length; i++) {
    const x = B.x[i], y = B.y[i];
    let clash = false;
    if (x < 2) for (let j = 0; j < left.x.length; j++) {
      if (left.x[j] < -2.5) continue;
      if ((left.x[j] - x) ** 2 + (left.y[j] - y) ** 2 < 1.3) { clash = true; break; }
    }
    if (!clash) A.push(x, y, B.e[i], B.L[i], 1);
  }
  A.finalize();
  const lab = (m, n) => `${bar(m)}${bar(n)}0`;
  return {
    id: 'sto', name: 'SrTiO₃ grain boundary', short: 'SrTiO₃ Σ5',
    atoms: A, grains: [{ a1: rot([a, 0], th), a2: rot([0, a], th), label: lab }, { a1: rot([a, 0], -th), a2: rot([0, a], -th), label: lab }],
    period: a, center: [0, 0], fov: 5, zone: '[001]',
    elements: [EI.Sr, EI.Ti, EI.O],
    amorph() { return null; },
    thicknessAt(x, y, t) { return t; },
    tauAt(x, y, t, kV) { return t / (10 * imfp(kV, 24)); },
    rings: [{ d: 3.905, hkl: '100' }, { d: 2.761, hkl: '110' }, { d: 1.953, hkl: '200' }, { d: 1.746, hkl: '210' }, { d: 1.381, hkl: '220' }],
    labels: [
      { x: -14, y: -21, text: 'grain A' },
      { x: 14, y: -21, text: 'grain B' },
      { x: 0, y: 21, text: 'Σ5 grain boundary', gb: true },
    ],
    plasmon: [{ Ep: 29, G: 14, frac: 0.7 }, { Ep: 15.5, G: 5, frac: 0.3 }],
    zeff: 24,
  };
}

export const SPECIMENS = { au: makeGold(), si: makeSilicon(), sto: makeSTO() };
for (const s of Object.values(SPECIMENS)) {
  for (const g of s.grains) g.b = reciprocal(g.a1, g.a2);
}

// ---------------------------------------------------------------- projected maps
// Splat atoms onto an n×n grid (pixel size dx, centred at cx,cy). Tilting a crystal
// smears each column along the tilt direction by L·tanθ, which is what kills lattice contrast off-axis.
export function projectMaps(spec, { cx, cy, n, dx, thick, tiltX = 0, tiltY = 0, elements = false, noTilt = false }) {
  const N2 = n * n;
  const phase = new Float32Array(N2), zHi = new Float32Array(N2), zLo = new Float32Array(N2);
  const elem = elements ? EL.map(() => new Float32Array(N2)) : null;
  const x0 = cx - (n / 2) * dx, y0 = cy - (n / 2) * dx;
  const tilt = noTilt ? 0 : Math.hypot(tiltX, tiltY);
  const ux = tilt ? tiltX / tilt : 1, uy = tilt ? tiltY / tilt : 0;
  const tanT = Math.tan(tilt);
  const sA = Math.max(0.3 / dx, 0.6), sA2 = sA * sA;
  const sB = Math.max(0.5 / dx, 0.7), sB2 = sB * sB;

  function splat(px, py, s2, l2, e, wP, wH, wL, wE) {
    const tot = s2 + l2, k = l2 / tot, norm = Math.sqrt(s2 / tot);
    const R = Math.ceil(3 * Math.sqrt(tot));
    const xa = Math.max(0, Math.floor(px - R)), xb = Math.min(n - 1, Math.ceil(px + R));
    const ya = Math.max(0, Math.floor(py - R)), yb = Math.min(n - 1, Math.ceil(py + R));
    const E = elem ? elem[e] : null;
    for (let y = ya; y <= yb; y++) {
      const dy = y - py;
      for (let x = xa; x <= xb; x++) {
        const ddx = x - px, du = ddx * ux + dy * uy;
        const q = (ddx * ddx + dy * dy - k * du * du) / s2;
        if (q > 16) continue;
        const gv = norm * Math.exp(-0.5 * q), i = y * n + x;
        phase[i] += gv * wP; zHi[i] += gv * wH; zLo[i] += gv * wL;
        if (E) E[i] += gv * wE;
      }
    }
  }

  const A = spec.atoms, pad = 4;
  A.query(x0 - pad, y0 - pad, x0 + n * dx + pad, y0 + n * dx + pad, (i) => {
    const L = A.L[i] < 0 ? thick : A.L[i];
    const N = L / spec.period, e = A.e[i];
    const l = (L * tanT) / dx, l2 = (l * l) / 12;
    splat((A.x[i] - x0) / dx - 0.5, (A.y[i] - y0) / dx - 0.5, sA2, l2, e, VP[e] * N, ZH[e] * Math.pow(N, 0.85), ZL[e] * N, N);
  });

  // amorphous material: seeded per 2.2 Å cell so it is stable as the stage moves
  const cell = 2.2;
  const i0 = Math.floor(x0 / cell) - 1, i1 = Math.floor((x0 + n * dx) / cell) + 1;
  const j0 = Math.floor(y0 / cell) - 1, j1 = Math.floor((y0 + n * dx) / cell) + 1;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const rng = mulberry32(hash2(i, j, 77));
      const cnt = rng() < 0.45 ? 2 : 1;
      for (let k = 0; k < cnt; k++) {
        const x = (i + rng()) * cell, y = (j + rng()) * cell;
        const r1 = rng(), r2 = rng();
        const mat = spec.amorph(x, y);
        if (!mat) continue;
        let e, dens;
        if (mat === 'C') { e = EI.C; dens = 0.1; }
        else { e = r1 < 0.333 ? EI.SiOx : EI.O; dens = 0.066; }
        const N = ((dens * cell * cell * thick) / 1.45) * (0.75 + 0.5 * r2);
        splat((x - x0) / dx - 0.5, (y - y0) / dx - 0.5, sB2, 0, e, VP[e] * N, ZH[e] * N, ZL[e] * N, N);
      }
    }
  return { phase, zHi, zLo, elem, n, dx, x0, y0 };
}

// Convert raw projected potential into a phase-object transmission function.
export function transmission(phase, kV, strength = 1) {
  const n2 = phase.length;
  const c = 0.0032 * (sigmaOf(kV) / sigmaOf(200)) * strength;
  let mean = 0;
  for (let i = 0; i < n2; i++) mean += phase[i];
  mean = (mean / n2) * c;
  const re = new Float64Array(n2), im = new Float64Array(n2);
  const S = 1.25;
  for (let i = 0; i < n2; i++) {
    const raw = phase[i] * c;
    const ph = S * Math.tanh((raw - mean) / S);
    const amp = Math.exp(-0.04 * Math.max(0, raw - mean));
    re[i] = amp * Math.cos(ph);
    im[i] = amp * Math.sin(ph);
  }
  return { re, im };
}

// ---------------------------------------------------------------- spectroscopy tables
// Characteristic X-ray lines (keV). w = relative line weight within the family, y = per-atom yield factor.
export const XRAY = [
  { el: 'C', line: 'Kα', E: 0.277, w: 1, y: 0.22 },
  { el: 'O', line: 'Kα', E: 0.525, w: 1, y: 0.45 },
  { el: 'Si', line: 'Kα', E: 1.74, w: 1, y: 1.0 },
  { el: 'Si', line: 'Kβ', E: 1.836, w: 0.03, y: 1.0 },
  { el: 'Ti', line: 'Lα', E: 0.452, w: 0.06, y: 1.1 },
  { el: 'Ti', line: 'Kα', E: 4.511, w: 1, y: 1.1 },
  { el: 'Ti', line: 'Kβ', E: 4.932, w: 0.13, y: 1.1 },
  { el: 'Sr', line: 'Lα', E: 1.806, w: 0.7, y: 1.0 },
  { el: 'Sr', line: 'Lβ', E: 1.872, w: 0.3, y: 1.0 },
  { el: 'Sr', line: 'Kα', E: 14.165, w: 0.9, y: 1.0 },
  { el: 'Sr', line: 'Kβ', E: 15.835, w: 0.16, y: 1.0 },
  { el: 'Au', line: 'Mα', E: 2.123, w: 0.55, y: 1.0 },
  { el: 'Au', line: 'Lα', E: 9.713, w: 1, y: 1.0 },
  { el: 'Au', line: 'Lβ', E: 11.442, w: 0.62, y: 1.0 },
  { el: 'Au', line: 'Lγ', E: 13.381, w: 0.1, y: 1.0 },
  { el: 'Cu', line: 'Kα', E: 8.048, w: 1, y: 0 },
  { el: 'Cu', line: 'Kβ', E: 8.905, w: 0.13, y: 0 },
  { el: 'Cu', line: 'Lα', E: 0.93, w: 0.25, y: 0 },
];
export const detEff = (E) => Math.exp(-Math.pow(0.35 / E, 2)) * Math.exp(-E / 40);
// Energy-dispersive detector resolution: 128 eV FWHM at Mn Kα, Fano-limited.
export const edsFWHM = (E) => Math.sqrt(45.7 * 45.7 + 2.355 * 2.355 * 0.115 * 3.8 * E * 1000) / 1000;

// Core-loss edges (eV). h is per-atom edge height factor.
export const EDGES = [
  { key: 'C', el: 'C', name: 'C K', E: 284, kind: 'sharp', h: 1.0, elnes: [[285.4, 1.1, 1.1], [292.5, 3.5, 0.6], [300, 8, 0.3]] },
  { key: 'O', el: 'O', name: 'O K', E: 532, kind: 'sharp', h: 0.7, elnes: [[533, 1.8, 0.55], [538.5, 3.5, 0.45], [545, 7, 0.35]] },
  { key: 'Si', el: 'Si', name: 'Si L₂,₃', E: 99.8, kind: 'delayed', h: 2.4, delay: 7, elnes: [[100.3, 0.9, 0.25]] },
  { key: 'SiOx', el: 'Si', name: 'Si L₂,₃ (oxide)', E: 105.6, kind: 'delayed', h: 2.4, delay: 5, elnes: [[108.2, 1.6, 0.6], [115, 3, 0.4]] },
  { key: 'Si', el: 'Si', name: 'Si K', E: 1839, kind: 'sharp', h: 0.07 },
  { key: 'SiOx', el: 'Si', name: 'Si K', E: 1844, kind: 'sharp', h: 0.07 },
  { key: 'Ti', el: 'Ti', name: 'Ti L₃,₂', E: 456, kind: 'white', h: 0.9 },
  { key: 'Sr', el: 'Sr', name: 'Sr M₄,₅', E: 133, kind: 'delayed', h: 1.1, delay: 22 },
  { key: 'Sr', el: 'Sr', name: 'Sr L₃', E: 1940, kind: 'sharp', h: 0.09 },
  { key: 'Au', el: 'Au', name: 'Au N₆,₇', E: 84, kind: 'delayed', h: 0.85, delay: 9 },
  { key: 'Au', el: 'Au', name: 'Au M₄,₅', E: 2206, kind: 'delayed', h: 0.11, delay: 55 },
];
const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const gpk = (E, c, w) => Math.exp(-0.5 * ((E - c) / w) ** 2);

// Per-atom edge signal (arbitrary units) at energy loss E.
export function edgeSignal(edge, E, res, realistic) {
  const d = E - edge.E;
  if (d < -4 * res - 3) return 0;
  const step = 0.5 * (1 + erf(d / (res * 0.85 + 0.3)));
  const tail = Math.pow(edge.E / Math.max(E, edge.E * 0.9), 3);
  const base = edge.h * Math.pow(100 / edge.E, 1.5);
  let s;
  if (edge.kind === 'delayed') s = step * (1 - Math.exp(-Math.max(d, 0) / edge.delay)) * tail * 1.6;
  else if (edge.kind === 'white') {
    const pk = realistic
      ? [[457.9, 0.7, 1.0], [460.2, 0.9, 1.2], [463.1, 0.8, 0.9], [465.5, 1.0, 1.1]]
      : [[458.6, 1.4, 1.7], [464.2, 1.6, 1.4]];
    s = step * tail * 0.35;
    for (const [c, w, a] of pk) s += a * gpk(E, c, Math.hypot(w, res * 0.42));
  } else s = step * tail;
  if (edge.elnes) for (const [c, w, a] of edge.elnes) s += a * step * gpk(E, c, Math.hypot(w, res * 0.42));
  return base * s;
}
