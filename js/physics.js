// Electron optics, specimen models, FFT and spectroscopy tables.
// Units: lengths in Ångström unless noted, energies in eV, angles in radians.
import * as ML from './megalibrary.js';

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
// In-place radix-2 FFT along a strided line (offset o, stride st): no copies for rows or columns.
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
export const freq = (i, n, dx) => (i < n / 2 ? i : i - n) / (n * dx);

// Aberration phase χ(k): defocus (negative = underfocus) and spherical aberration.
export const chi = (k2, lam, df, Cs) => Math.PI * lam * df * k2 + 0.5 * Math.PI * Cs * lam * lam * lam * k2 * k2;

// Full axial aberration function (Krivanek/Haider notation) in Å, angles in degrees:
// χ(θ,φ) = 2π/λ [ ½θ²(C1 + A1 cos2(φ−φ11)) + ⅓θ³(A2 cos3(φ−φ22) + 3B2 cos(φ−φ21)) + ¼θ⁴(C3 + A3 cos4(φ−φ33)) ]
const DEG = Math.PI / 180;
export function chiFull(kx, ky, lam, C1, C3, ab) {
  const t2 = lam * lam * (kx * kx + ky * ky);
  if (!ab) return (2 * Math.PI / lam) * (0.5 * t2 * C1 + 0.25 * t2 * t2 * C3);
  const th = Math.sqrt(t2), ph = Math.atan2(ky, kx);
  const v = 0.5 * t2 * (C1 + ab.A1 * Math.cos(2 * (ph - ab.A1a * DEG)))
    + (th * t2 / 3) * (ab.A2 * Math.cos(3 * (ph - ab.A2a * DEG)) + 3 * ab.B2 * Math.cos(ph - ab.B2a * DEG))
    + 0.25 * t2 * t2 * (C3 + ab.A3 * Math.cos(4 * (ph - ab.A3a * DEG)));
  return (2 * Math.PI / lam) * v;
}
// Same, taking the scattering angle directly (θ in rad, φ in rad).
export function chiAngle(th, ph, lam, C1, C3, ab) {
  const t2 = th * th;
  const v = 0.5 * t2 * (C1 + ab.A1 * Math.cos(2 * (ph - ab.A1a * DEG)))
    + (th * t2 / 3) * (ab.A2 * Math.cos(3 * (ph - ab.A2a * DEG)) + 3 * ab.B2 * Math.cos(ph - ab.B2a * DEG))
    + 0.25 * t2 * t2 * (C3 + ab.A3 * Math.cos(4 * (ph - ab.A3a * DEG)));
  return (2 * Math.PI / lam) * v;
}

// ---------------------------------------------------------------- 3D crystal structures (for CBED and 3D-ED)
const fcc = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
export const CRYST = {
  sto: { a: 3.905, sg: 'Pm3̄m', name: 'SrTiO₃ (perovskite)', basis: [[0, 0, 0, 38], [0.5, 0.5, 0.5, 22], [0.5, 0.5, 0, 8], [0.5, 0, 0.5, 8], [0, 0.5, 0.5, 8]], xAx: [1, 0, 0], yAx: [0, 1, 0] },
  au: { a: 4.078, sg: 'Fm3̄m', name: 'Au (fcc)', basis: fcc.map((p) => [...p, 79]), xAx: [1, -1, 0], yAx: [0, 0, 1] },
  gr: { a: 2.46, sg: 'P6/mmm (2D)', name: 'graphene (monolayer)', twoD: true, basis: [[0, 0, 0, 6], [1 / 3, 1 / 3, 0, 6]], xAx: [1, 0, 0], yAx: [0, 1, 0] },
  si: { a: 5.431, sg: 'Fd3̄m', name: 'Si (diamond)', basis: [...fcc, ...fcc.map((p) => p.map((v) => v + 0.25))].map((p) => [...p, 14]), xAx: [1, -1, 0], yAx: [0, 0, 1] },
};
for (const c of Object.values(CRYST)) {
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  c.x = n(c.xAx); c.y = n(c.yAx);
  c.z = [c.x[1] * c.y[2] - c.x[2] * c.y[1], c.x[2] * c.y[0] - c.x[0] * c.y[2], c.x[0] * c.y[1] - c.x[1] * c.y[0]];
  c.Vc = c.a ** 3;
  if (c.twoD) { // hexagonal net, one layer 3.35 Å thick
    c.b = reciprocal([c.a, 0], [c.a / 2, (c.a * Math.sqrt(3)) / 2]);
    c.Vc = ((c.a * c.a * Math.sqrt(3)) / 2) * 3.35;
  }
}
// Electron scattering factor (Å): screened core at low s plus the Mott–Bethe ~Z/s² tail at high s,
// damped by a Debye–Waller factor (B ≈ 0.4 Å²). Adequate for trends, extinction distances and HOLZ visibility.
export const fElec = (Z, s) => (0.3 * Math.pow(Z, 0.8) * Math.exp(-3.5 * s * s) + (0.0239 * Z) / (s * s + 1)) * Math.exp(-0.4 * s * s);
export function structF(cr, h, k, l, scale = 1) {
  const a = cr.a * scale, s = cr.twoD ? Math.hypot(...zoneG(cr, h, k, 0, scale)) / 2 : Math.hypot(h, k, l) / (2 * a);
  let re = 0, im = 0;
  for (const [x, y, z, Z] of cr.basis) {
    const f = fElec(Z, s), p = 2 * Math.PI * (h * x + k * y + l * z);
    re += f * Math.cos(p); im += f * Math.sin(p);
  }
  return Math.hypot(re, im);
}
// Extinction distance (Å), two-beam theory: ξ_g = π V_c / (λ γ F_g), calibrated to Au(111) ≈ 18 nm at 200 kV.
export const extinction = (cr, F, kV) => (3.7 * cr.Vc) / (wavelength(kV) * gammaOf(kV) * Math.max(F, 1e-6));
// Reciprocal vector of hkl in the zone frame (gx, gy in-plane, gz along the beam), before grain rotation.
export function zoneG(cr, h, k, l, scale = 1) {
  if (cr.twoD) return [(h * cr.b[0][0] + k * cr.b[1][0]) / scale, (h * cr.b[0][1] + k * cr.b[1][1]) / scale, 0];
  const a = cr.a * scale, G = [h / a, k / a, l / a];
  const d = (u) => G[0] * u[0] + G[1] * u[1] + G[2] * u[2];
  return [d(cr.x), d(cr.y), d(cr.z)];
}

// ---------------------------------------------------------------- elements
export const EL = [
  { sym: 'C', Z: 6, name: 'Carbon', color: '#b5bfcc' },
  { sym: 'O', Z: 8, name: 'Oxygen', color: '#ff7d7d' },
  { sym: 'Si', Z: 14, name: 'Silicon', color: '#5cb4ff' },
  { sym: 'Si', key: 'SiOx', Z: 14, name: 'Silicon in oxide', color: '#a7d6ff', pseudo: true },
  { sym: 'Ti', Z: 22, name: 'Titanium', color: '#c99bff' },
  { sym: 'Sr', Z: 38, name: 'Strontium', color: '#5fe3a8' },
  { sym: 'Au', Z: 79, name: 'Gold', color: '#ffcf5a' },
  { sym: 'Zr', Z: 40, name: 'Zirconium', color: '#7fe3ff' },
  { sym: 'N', Z: 7, name: 'Nitrogen', color: '#8fa8ff' },
  { sym: 'S', Z: 16, name: 'Sulfur', color: '#ffe066' },
  { sym: 'P', Z: 15, name: 'Phosphorus', color: '#ff9e4a' },
  { sym: 'Fe', Z: 26, name: 'Iron', color: '#ff6a3d' },
  { sym: 'Ag', Z: 47, name: 'Silver', color: '#d9e2ec' },
  { sym: 'Cu', Z: 29, name: 'Copper', color: '#ff9a4d' },
  { sym: 'Co', Z: 27, name: 'Cobalt', color: '#6f8cff' },
  { sym: 'Ni', Z: 28, name: 'Nickel', color: '#5fe3a8' },
];
export const EI = { C: 0, O: 1, Si: 2, SiOx: 3, Ti: 4, Sr: 5, Au: 6, Zr: 7, N: 8, S: 9, P: 10, Fe: 11, Ag: 12, Cu: 13, Co: 14, Ni: 15 };
export const VP = EL.map((e) => Math.pow(e.Z, 0.75)); // projected-potential weight per atom
export const ZH = EL.map((e) => Math.pow(e.Z, 1.7)); // high-angle (Rutherford-like) weight
export const ZL = EL.map((e) => Math.pow(e.Z, 1.2)); // low-angle ADF weight

// Any element can join the table (a loaded XYZ structure). Elements without tabulated X-ray lines get
// Moseley's-law estimates: Kα ≈ 10.2 eV·(Z − 1)², Lα ≈ 1.89 eV·(Z − 7.4)² (good to a few per cent).
export const SYMBOLS = ['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U'];
export function addElement(sym) {
  if (EI[sym] !== undefined) return EI[sym];
  const Z = SYMBOLS.indexOf(sym) + 1;
  if (Z < 1) throw new Error(`unknown element ${sym}`);
  const i = EL.push({ sym, Z, name: sym, color: `hsl(${(Z * 47) % 360} 70% 70%)` }) - 1;
  EI[sym] = i; VP.push(Math.pow(Z, 0.75)); ZH.push(Math.pow(Z, 1.7)); ZL.push(Math.pow(Z, 1.2));
  if (!XRAY.some((l) => l.el === sym) && Z > 4) {
    const K = 0.0102 * (Z - 1) ** 2, L = 0.00189 * (Z - 7.4) ** 2;
    if (K < 20) XRAY.push({ el: sym, line: 'Kα', E: +K.toFixed(3), w: 1, y: 1, est: true });
    if (Z > 20 && L > 0.2 && L < 20) XRAY.push({ el: sym, line: 'Lα', E: +L.toFixed(3), w: K < 20 ? 0.1 : 1, y: 1, est: true });
  }
  return i;
}

// ---------------------------------------------------------------- specimens
// Positions are relative to an origin (ox, oy), so a specimen far from the stage origin (the megalibrary spans
// a millimetre) keeps Å precision in Float32.
class AtomList {
  constructor(ox = 0, oy = 0) { this.x = []; this.y = []; this.e = []; this.L = []; this.g = []; this.ox = ox; this.oy = oy; }
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
    x0 -= this.ox; x1 -= this.ox; y0 -= this.oy; y1 -= this.oy;
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
    id: 'au', name: 'Gold nanoparticles on carbon', short: 'Au on C', alpha: 1.42e-5,
    grainRot: parts.map((p) => p.rot),
    grainAt(x, y) { for (let i = 0; i < parts.length; i++) { const p = parts[i]; if ((x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r) return i; } return -1; },
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
    id: 'si', name: 'Silicon / SiO₂ interface', short: 'Si / SiO₂', alpha: 2.6e-6,
    grainRot: [0],
    grainAt(x, y) { return x < bnd(y) ? 0 : -1; },
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
    id: 'sto', name: 'SrTiO₃ grain boundary', short: 'SrTiO₃ Σ5', alpha: 1.1e-5,
    grainRot: [th, -th],
    grainAt(x) { return x < 0 ? 0 : 1; },
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


function makeGraphene() {
  const A = new AtomList();
  const a = 2.46, a1 = [a, 0], a2 = [a / 2, (a * Math.sqrt(3)) / 2], LAYER = 3.35;
  const basis = [[0, 0, [EI.C]], [1 / 3, 1 / 3, [EI.C]]]; // honeycomb: C–C bond a/√3 = 1.42 Å
  const hole = { x: -16, y: 8, r: 9 };
  const inHole = (x, y) => (x - hole.x) ** 2 + (y - hole.y) ** 2 < hole.r * hole.r;
  const tw = 5 * (Math.PI / 180), bilayerX = 14;
  fillLattice(A, { a1, a2, basis, angle: 0, origin: [0, 0], R: 250, g: 0, L: LAYER, inside: (x, y) => !inHole(x, y) });
  // second layer, twisted by 5°, on the right: a moiré with period a / (2 sin(θ/2)) ≈ 2.8 nm
  fillLattice(A, { a1, a2, basis, angle: tw, origin: [0.4, 0.7], R: 250, g: 1, L: LAYER, inside: (x) => x > bilayerX + 0.6 * Math.sin(x * 0.3) });
  const nearest = (px, py, g = 0) => { let bi = -1, bd = Infinity; for (let i = 0; i < A.x.length; i++) { if (A.g[i] !== g) continue; const d = (A.x[i] - px) ** 2 + (A.y[i] - py) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const drop = new Set();
  // substitutional Si dopant
  A.e[nearest(4, -6)] = EI.Si;
  // single vacancies
  drop.add(nearest(-2, 16)); drop.add(nearest(9, 11));
  // Stone–Wales defect: rotate one C–C bond by 90° about its center (two pentagons + two heptagons)
  {
    const p = nearest(-6, -13);
    let q = -1, bd = Infinity;
    for (let i = 0; i < A.x.length; i++) { if (i === p || A.g[i] !== 0) continue; const d = (A.x[i] - A.x[p]) ** 2 + (A.y[i] - A.y[p]) ** 2; if (d < bd) { bd = d; q = i; } }
    const mx = (A.x[p] + A.x[q]) / 2, my = (A.y[p] + A.y[q]) / 2;
    for (const i of [p, q]) { const dx = A.x[i] - mx, dy = A.y[i] - my; A.x[i] = mx - dy; A.y[i] = my + dx; }
  }
  if (drop.size) for (const k of ['x', 'y', 'e', 'L', 'g']) A[k] = A[k].filter((_, i) => !drop.has(i));
  A.finalize();
  A.dead = new Uint8Array(A.count);
  const hexLab = (m, n) => `${bar(m)}${bar(n)}${bar(-(m + n))}0`;
  // hydrocarbon contamination: blobs on the surface, especially around the hole edge
  const contam = (x, y) => {
    const d = Math.hypot(x - hole.x, y - hole.y);
    if (d > hole.r - 0.3 && d < hole.r + 1.6 + 1.2 * Math.sin(Math.atan2(y - hole.y, x - hole.x) * 5)) return true;
    const c = 22, gx = Math.floor(x / c), gy = Math.floor(y / c);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const h = hash2(gx + i, gy + j, 91) / 4294967296;
      if (h > 0.35) continue;
      const px = (gx + i + 0.5) * c + (h - 0.2) * 20, py = (gy + j + 0.5) * c - (h - 0.2) * 15, r = 3 + 9 * h;
      if ((x - px) ** 2 + (y - py) ** 2 < r * r && !(Math.abs(px) < 22 && Math.abs(py) < 22)) return true;
    }
    return false;
  };
  const layers = (x, y) => (inHole(x, y) ? 0 : 1) + (x > bilayerX ? 1 : 0);
  return {
    id: 'gr', name: 'Graphene (monolayer + twisted bilayer)', short: 'Graphene', alpha: -7e-6,
    twoD: true, fixedT: LAYER, amorphThick: 4,
    grainRot: [0, tw],
    grainAt(x, y) { return inHole(x, y) ? -1 : 0; },
    atoms: A, grains: [{ a1, a2, label: hexLab }, { a1: rot(a1, tw), a2: rot(a2, tw), label: hexLab }],
    // phase per C atom calibrated to ~0.07 rad at 80 kV (≈4× a bulk column's per-atom weight): each atom counts as N = 4
    period: LAYER / 4, center: [0, 0], fov: 6, zone: '[0001]',
    elements: [EI.C, EI.Si],
    // hydrocarbon contamination desorbs from hot graphene (above ~450 K)
    amorph(x, y, ctx) { return (ctx?.T ?? 293) < 450 && contam(x, y) ? 'C' : null; },
    thicknessAt(x, y) { return LAYER * layers(x, y); },
    tauAt(x, y, t, kV) { return (LAYER * layers(x, y) + (contam(x, y) ? 4 : 0)) / (10 * imfp(kV, 6)); },
    rings: [{ d: 2.13, hkl: '10' }, { d: 1.23, hkl: '11' }, { d: 1.065, hkl: '20' }, { d: 0.805, hkl: '21' }],
    labels: [
      { x: hole.x, y: hole.y, text: 'hole' },
      { x: 4, y: -9.5, text: 'Si dopant' },
      { x: -6, y: -17, text: 'Stone–Wales' },
      { x: 24, y: -22, text: 'twisted bilayer · moiré' },
      { x: -2, y: 20, text: 'vacancy' },
    ],
    plasmon: [{ Ep: 4.8, G: 2.2, frac: 0.3 }, { Ep: 14.8, G: 7, frac: 0.7 }],
    zeff: 6,
    sputtered: 0, damageVer: 0,
  };
}

// UiO-66: Zr6O4(OH)4(BDC)6, Fm-3m, a = 20.7 Å. Zr6 octahedra on fcc sites, each linked to 12 neighbors by
// terephthalate (BDC) linkers along <110>. Built from one 3D conventional cell, then projected along [110].
function makeUiO66() {
  const A = new AtomList();
  const a = 20.7, ax = a / Math.SQRT2, ay = a; // [110] projection cell; repeat along the beam = a/√2
  const n3 = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const x3 = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const fccS = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
  const dirs = [[1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1]];
  const cell = []; // [x, y, z, element, tag]
  fccS.forEach((f, s) => {
    const C = f.map((v) => v * a);
    for (let k = 0; k < 3; k++) for (const sg of [-1, 1]) { const p = [...C]; p[k] += sg * 2.48; cell.push([...p, EI.Zr, `c${s}`]); } // Zr6 octahedron
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) cell.push([C[0] + sx * 1.3, C[1] + sy * 1.3, C[2] + sz * 1.3, EI.O, `c${s}`]); // μ3-O/OH
    for (const d of dirs) { // each Zr6–Zr6 link counted once
      const u = n3(d), L = ax, end = C.map((c, i) => c + u[i] * L);
      const fe = end.map((v) => (((v / a) % 1) + 1) % 1);
      const s2 = fccS.findIndex((q) => q.every((v, i) => Math.min(Math.abs(v - fe[i]), 1 - Math.abs(v - fe[i])) < 1e-6));
      const p = n3(x3(u, Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
      const tag = `l${Math.min(s, s2)}${Math.max(s, s2)}`;
      const put = (t, off, e) => cell.push([C[0] + u[0] * t + p[0] * off, C[1] + u[1] * t + p[1] * off, C[2] + u[2] * t + p[2] * off, e, tag]);
      for (const t of [4.55, L - 4.55]) put(t, 0, EI.C); // carboxylate C
      for (const t of [3.95, L - 3.95]) { put(t, 1.1, EI.O); put(t, -1.1, EI.O); } // carboxylate O
      for (const t of [6.05, L - 6.05]) put(t, 0, EI.C); // ring ipso C
      for (const t of [6.75, L - 6.75]) { put(t, 1.2, EI.C); put(t, -1.2, EI.C); } // ring C
    }
  });
  // project into the [110] prism: x' ∥ [1-10], y' ∥ [001], beam ∥ [110]
  const groups = new Map(), eps = 1e-6;
  for (const [x, y, z, e, tag] of cell)
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 2; j++) for (let k = -1; k <= 1; k++) {
      const X = x + i * a, Yy = y + j * a, Z = z + k * a;
      const xp = (X - Yy) / Math.SQRT2, zp = (X + Yy) / Math.SQRT2;
      if (xp < -eps || xp >= ax - eps || Z < -eps || Z >= ay - eps || zp < -eps || zp >= ax - eps) continue;
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push([xp / ax, Z / ay, [e]]);
    }
  const edge = (y) => -35 + 5 * Math.sin(y / 23) + 2 * Math.sin(y / 7);
  const defect = { x: 25, y: -12, r: 34 };
  const inDefect = (x, y) => (x - defect.x) ** 2 + (y - defect.y) ** 2 < defect.r * defect.r;
  for (const [tag, basis] of groups) {
    const missing = tag === 'c0' || tag.startsWith('l0');
    fillLattice(A, { a1: [ax, 0], a2: [0, ay], basis, angle: 0, origin: [0, 0], R: 170, g: 0, L: -1, inside: (x, y) => x > edge(y) && !(missing && inDefect(x, y)) });
  }
  A.finalize();
  A.jitter = new Float32Array(A.count * 2);
  for (let i = 0; i < A.count; i++) { // fixed random direction per atom for radiolytic disorder
    const u1 = (hash2(i, 1, 5) + 1) / 4294967297, u2 = hash2(i, 2, 5) / 4294967296, r = Math.sqrt(-2 * Math.log(u1));
    A.jitter[2 * i] = r * Math.cos(6.2832 * u2); A.jitter[2 * i + 1] = r * Math.sin(6.2832 * u2);
  }
  const SUP = 60; // amorphous carbon support film, Å
  return {
    id: 'mof', name: 'UiO-66 metal–organic framework', short: 'UiO-66',
    beamSensitive: true, Dc300: 12, noCBED: true, amorphThick: SUP, alpha: -9.7e-6, thermalLimit: 720,
    grainRot: [0], grainAt() { return -1; },
    atoms: A, grains: [{ a1: [ax, 0], a2: [0, ay], label: (m, n) => `${bar(m)}${bar(-m)}${bar(n)}` }],
    period: ax, center: [8, 0], fov: 10, zone: '[110]',
    elements: [EI.Zr, EI.O, EI.C],
    amorph(x, y) { return x < edge(y) - 0.5 ? 'C' : null; },
    thicknessAt(x, y, t) { return x < edge(y) ? SUP : t; },
    tauAt(x, y, t, kV) { return (x < edge(y) ? SUP : t) / (10 * imfp(kV, 8)); },
    rings: [{ d: 11.95, hkl: '111' }, { d: 10.35, hkl: '200' }, { d: 7.32, hkl: '220' }, { d: 6.24, hkl: '311' }, { d: 5.98, hkl: '222' }],
    labels: [
      { x: -46, y: -22, text: 'carbon support' },
      { x: -8, y: -40, text: 'UiO-66 along [110]' },
      { x: defect.x, y: defect.y + defect.r + 4, text: 'missing-cluster (reo) defects' },
    ],
    plasmon: [{ Ep: 22, G: 14, frac: 1 }],
    zeff: 8, dmg: 0, damageVer: 0,
  };
}

// Biological specimen: apoferritin and ferritin particles and a lipid vesicle in vitreous ice, across a hole
// in a carbon support film. Everything here is amorphous: the material along each column is computed from
// exact chord lengths through spheres and spherical shells, then seeded as pseudo-atoms.
// Apoferritin: 24-subunit protein shell, 12 nm outside, 8 nm cavity. Ferritin adds a ferrihydrite core.
function makeBio() {
  const rng = mulberry32(7351);
  const chord = (R, d2) => (d2 < R * R ? 2 * Math.sqrt(R * R - d2) : 0);
  const parts = [];
  const tryPlace = (type, R, n) => {
    for (let k = 0, tries = 0; k < n && tries < 4000; tries++) {
      const x = -230 + rng() * 560, y = -280 + rng() * 560;
      if (parts.some((p) => Math.hypot(p.x - x, p.y - y) < p.R + R + 8)) continue;
      parts.push({ type, x, y, R, rot: rng() * Math.PI }); k++;
    }
  };
  parts.push({ type: 'vesicle', x: 150, y: 120, R: 175 });
  tryPlace('ferritin', 60, 3);
  tryPlace('apo', 60, 16);
  const edge = (y) => -300 + 18 * Math.sin(y / 70) + 6 * Math.sin(y / 23); // carbon film to the left
  const CF = 120; // carbon film, Å
  const spec = {
    id: 'bio', name: 'Apoferritin and a liposome in vitreous ice', short: 'Proteins in ice',
    bio: true, beamSensitive: true, Dc300: 5, cryoProtect: 4, noCBED: true, smoothAmorph: true, alpha: 0, thermalLimit: 315,
    amorphCells: [2.2, 3.1],
    grainRot: [0], grainAt() { return -1; },
    atoms: (() => { const A = new AtomList(); A.finalize(); return A; })(),
    // no crystal: a pseudo-lattice at the ice spacing keeps the diffraction beam drawings sensible
    grains: [{ a1: [3.7, 0], a2: [0, 3.7], label: () => 'ice' }],
    period: 3.7, center: [0, 0], fov: 60, zone: '—',
    elements: [EI.C, EI.N, EI.O, EI.S, EI.P, EI.Fe],
    parts,
    // material along the column at (x, y); ctx.thick is the ice thickness from the slider
    amorph(x, y, ctx) {
      const out = [];
      let solid = 0;
      if (x < edge(y)) { out.push(['C', CF]); }
      for (const p of parts) {
        const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > p.R * p.R) continue;
        if (p.type === 'vesicle') {
          const head = chord(p.R, d2) - chord(p.R - 10, d2) + chord(p.R - 30, d2) - chord(p.R - 40, d2);
          const tail = chord(p.R - 10, d2) - chord(p.R - 30, d2);
          out.push(['head', head], ['lipid', tail]); solid += head + tail;
        } else {
          // the shell's 24 subunits show four-fold symmetry along this view
          const sh = (chord(p.R, d2) - chord(40, d2)) * (1 + 0.22 * Math.cos(4 * (Math.atan2(dy, dx) - p.rot)) * Math.min(1, Math.sqrt(d2) / 45));
          out.push(['protein', sh]); solid += sh;
          if (p.type === 'ferritin') { const c = chord(30, d2); out.push(['ferrihydrite', c]); solid += c; }
        }
      }
      // ice: vitreous while cold; above ~140 K it crystallizes (patchy diffraction contrast), and above
      // ~165 K it sublimes in the vacuum (ctx.iceT shrinks), so at room temperature none is left
      if (ctx.iceT > 0) {
        let t = Math.max(0, ctx.iceT - solid);
        if (ctx.iceCryst) t *= 0.7 + 0.6 * (hash2(Math.floor((x + 0.37 * y) / 140), Math.floor((y - 0.29 * x) / 140), 29) / 4294967296);
        out.push(['ice', t]);
      }
      return out;
    },
    thicknessAt(x, y, t) { return t; },
    tauAt(x, y, t, kV) { return (t + (x < edge(y) ? CF : 0)) / (10 * imfp(kV, 7)); },
    rings: [{ d: 3.7, hkl: 'ice' }, { d: 2.14, hkl: 'ice' }],
    labels: [
      { x: -360, y: 40, text: 'carbon film' },
      ...parts.filter((p) => p.type === 'ferritin').slice(0, 1).map((p) => ({ x: p.x, y: p.y + 78, text: 'ferritin (iron core)' })),
      ...parts.filter((p) => p.type === 'apo').slice(0, 1).map((p) => ({ x: p.x, y: p.y + 78, text: 'apoferritin' })),
      { x: 150, y: 120, text: 'liposome (lipid bilayer)' },
    ],
    plasmon: [{ Ep: 21, G: 13, frac: 1 }],
    zeff: 7, dmg: 0, damageVer: 0,
  };
  return spec;
}

// Nanoparticle megalibrary (megalibrary.js): a million alloy particles on a 1 µm grid on a 10 nm Si₃N₄
// membrane. Only the particle under the beam exists as atoms: locate() builds it, in 3D, from its domains'
// lattices and orientations, rotated by the stage tilt, and projects every atom (no columns are assumed, so a
// particle shows lattice fringes only when it happens to sit near a zone axis, as in a real screen).
function makeLibrary() {
  const empty = new AtomList(); empty.finalize(400, 8);
  const STAGE = 1e4; // Å per µm
  const fccBasis = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
  const rings = (a) => [[1, 1, 1], [2, 0, 0], [2, 2, 0], [3, 1, 1]].map(([h, k, l]) => ({ d: +(a / Math.hypot(h, k, l)).toFixed(3), hkl: `${h}${k}${l}` }));
  const spec = {
    id: 'lib', name: 'Nanoparticle megalibrary (1000 × 1000 alloy particles)', short: 'Megalibrary',
    alpha: 1.4e-5, poly: true, noCBED: true, filmOnly: true, noGrid: true, ownTilt: true, zExp: 1,
    atoms: empty, period: 1, center: [0, 0], fov: 40, fovMax: 1.2e6, zone: '—', grainRot: [0], ver: 0, cur: null,
    grains: [{ a1: [2.88, 0], a2: [0, 4.07], label: () => 'fcc' }],
    get rings() { return rings(this.cur?.p?.a_A ?? 4.0); },
    get elements() {
      const p = this.cur?.p, els = p?.present ? Object.keys(p.comp).map((e) => EI[e]) : [];
      return [...els, EI.Si, EI.N];
    },
    get labels() {
      const c = this.cur;
      if (!c) return [];
      const p = c.p, out = [{ x: c.ox, y: c.oy + (p.present ? p.b_nm * 10 + 45 : 40), text: `particle (${p.i}, ${p.j})${p.present ? '' : ': empty dot'}` }];
      return out;
    },
    // particle-centred coordinates (nm) of a stage position (Å)
    local(x, y) { const c = this.cur; return c ? [(x - c.ox) / 10, (y - c.oy) / 10] : [1e9, 1e9]; },
    grainAt(x, y) { const c = this.cur; if (!c?.p.present) return -1; const [u, v] = this.local(x, y); return ML.rho(c.p, u, v) < 1 ? ML.domainAt(c.p, u, v, 0) : -1; },
    amorph() { return 'SiN'; },
    partT(x, y) { const c = this.cur; if (!c) return 0; const [u, v] = this.local(x, y); return 10 * ML.thicknessAt(c.p, u, v); }, // Å
    thicknessAt(x, y, t) { return t + this.partT(x, y); },
    tauAt(x, y, t, kV) { const p = this.cur?.p; return t / (10 * imfp(kV, 10)) + this.partT(x, y) / (10 * imfp(kV, p ? ML.meanZ(p.comp) : 50)); },
    plasmon: [{ Ep: 23, G: 14, frac: 0.6 }, { Ep: 19, G: 12, frac: 0.4 }],
    zeff: 10,
    // Above a 130 nm field the particles are drawn without atoms: each one's projected mass, element by element,
    // on a membrane laid down as a continuum. High- and low-angle scattering add up atom by atom, weighted as
    // projectMaps weights atoms (the integral of its Gaussians), so they carry on smoothly; the phase is a
    // projected potential, so per area: it is scaled to match projectMaps at the 130 nm handover, (6 Å / dx)².
    // Up to 2500 particles in the field each is the full particle (outline, satellite); up to 20 000 a sketch
    // (position, volume, composition); beyond that (pixels of ~0.6 µm and more, up to the whole chip) the
    // particles are a continuum: each pen block's mean particle per grid cell, averaged over the pixel.
    overviewA: 1300,
    overview({ cx, cy, n, dx, thick, elements, part, tds }) {
      const N2 = n * n, phase = new Float32Array(N2), zHi = new Float32Array(N2), zLo = new Float32Array(N2);
      const elem = elements ? EL.map(() => new Float32Array(N2)) : null;
      const x0 = cx - (n / 2) * dx, y0 = cy - (n / 2) * dx, out = { phase, zHi, zLo, elem, n, dx, x0, y0 };
      const K = 2 * Math.PI * 0.36, ps = 36 / (dx * dx * K); // sA = 0.6 px atoms; phase per area
      if (part !== 'cryst') {
        const M = MAT.SiN, W = M.dens * dx * dx * thick * 2 * Math.PI * 0.49; // sB = 0.7 px blobs
        for (const [e, f] of M.mix) {
          for (let i = 0; i < N2; i++) { phase[i] += VP[e] * W * f * ps; zHi[i] += ZH[e] * W * f; zLo[i] += ZL[e] * W * f; }
          if (elem) elem[e].fill(W * f);
        }
      }
      if (part === 'amorph') return out;
      const put = (k, N, comp) => {
        for (const el in comp) {
          const e = EI[el], w = N * comp[el] * K;
          phase[k] += VP[e] * w * ps; zHi[k] += ZH[e] * w * tds; zLo[k] += ZL[e] * w;
          if (elem) elem[e][k] += w;
        }
      };
      // N atoms at (px, py) pixels, shared bilinearly between the four nearest pixels
      const deposit = (px, py, N, comp) => {
        const fx = Math.floor(px), fy = Math.floor(py), ax = px - fx, ay = py - fy;
        for (const [x, y, w] of [[fx, fy, (1 - ax) * (1 - ay)], [fx + 1, fy, ax * (1 - ay)], [fx, fy + 1, (1 - ax) * ay], [fx + 1, fy + 1, ax * ay]])
          if (x >= 0 && y >= 0 && x < n && y < n && w > 0) put(y * n + x, N * w, comp);
      };
      const PITCH = ML.LIB.pitch_um * STAGE, margin = 1000;
      const i0 = Math.max(0, Math.floor((x0 - margin) / PITCH)), i1 = Math.min(ML.LIB.n - 1, Math.ceil((x0 + n * dx + margin) / PITCH));
      const j0 = Math.max(0, Math.floor((y0 - margin) / PITCH)), j1 = Math.min(ML.LIB.n - 1, Math.ceil((y0 + n * dx + margin) / PITCH));
      if (i1 < i0 || j1 < j0) return out;
      const count = (i1 - i0 + 1) * (j1 - j0 + 1), pix = (x, y) => [(x - x0) / dx - 0.5, (y - y0) / dx - 0.5];
      if (count <= 2500) {
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const p = ML.particle(i, j);
          if (!p.present) continue;
          const px0 = p.x_um * STAGE, py0 = p.y_um * STAGE, rho = 4 / p.a_A ** 3; // fcc: 4 atoms per a³
          // the particle and its satellite: centre offset, bounding radius and volume (nm, nm³)
          const sat = p.satellite, parts = [[0, 0, Math.max(p.a_nm, p.b_nm), ML.sketch(i, j).vol_nm3], ...(sat ? [[sat.dx_nm, sat.dy_nm, sat.d_nm / 2, (Math.PI / 6) * sat.d_nm ** 3]] : [])];
          for (const [ux, uy, r, vol] of parts) {
            const [qx, qy] = pix(px0 + 10 * ux, py0 + 10 * uy), R = (10 * r) / dx;
            if (R < 1.5) { deposit(qx, qy, rho * 1000 * vol, p.comp); continue; }
            const xa = Math.max(0, Math.floor(qx - R)), xb = Math.min(n - 1, Math.ceil(qx + R)), ya = Math.max(0, Math.floor(qy - R)), yb = Math.min(n - 1, Math.ceil(qy + R));
            for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
              // thickness (nm) of this body only at the pixel centre
              const u = ((x + 0.5) * dx + x0 - px0) / 10, v = ((y + 0.5) * dx + y0 - py0) / 10;
              let t;
              if (ux === 0 && uy === 0) { const rr = ML.rho(p, u, v); t = rr < 1 ? 2 * p.c_nm * Math.sqrt(1 - rr * rr) : 0; }
              else { const d2 = (u - ux) ** 2 + (v - uy) ** 2; t = d2 < r * r ? 2 * Math.sqrt(r * r - d2) : 0; }
              if (t > 0) put(y * n + x, rho * 10 * t * dx * dx, p.comp);
            }
          }
        }
      } else if (count <= 20000) {
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const s = ML.sketch(i, j);
          if (s.present) deposit(...pix(s.x_um * STAGE, s.y_um * STAGE), (4000 * s.vol_nm3) / s.a_A ** 3, s.comp);
        }
      } else {
        // mean particle of grid node (i, j): its column in the block sets the size, its pen the ink; 1.5 % of
        // dots are empty; the mean in-plane area factor over the shapes (65 % elliptical, 35 % squarer) is 3.285.
        // Each pixel averages 3 × 3 points over its area, so the blocks' edges and size ramps are not aliased.
        const [d0, d1] = ML.LIB.d_nm, B = ML.LIB.block, L = ML.LIB.n, perArea = (dx * dx) / (PITCH * PITCH);
        const memo = new Map(), mean = (i, j) => {
          const key = (Math.floor(j / B) * ML.LIB.pens + Math.floor(i / B)) * B + (i % B);
          if (!memo.has(key)) {
            const ink = ML.sketchInk(i, j), d = d0 + ((d1 - d0) * (i % B)) / (B - 1);
            memo.set(key, [(0.985 * 4000 * (4 / 3) * 0.43 * d * (d / 2) ** 2 * 3.285) / ML.latticeA(ink) ** 3, ink]);
          }
          return memo.get(key);
        };
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
            const i = Math.round((x0 + (x + (sx + 0.5) / 3) * dx) / PITCH), j = Math.round((y0 + (y + (sy + 0.5) / 3) * dx) / PITCH);
            if (i < 0 || j < 0 || i >= L || j >= L) continue;
            const [N, ink] = mean(i, j);
            put(y * n + x, (N * perArea) / 9, ink);
          }
        }
      }
      return out;
    },
    // build the particle nearest the stage position (Å) at this tilt (degrees); true when it changed
    locate(cx, cy, tiltX = 0, tiltY = 0) {
      const ij = ML.nearest(cx / STAGE, cy / STAGE), tk = `${Math.round(tiltX * 20)}|${Math.round(tiltY * 20)}`;
      const key = ij ? `${ij[0]},${ij[1]}|${tk}` : 'none';
      if (this.cur?.key === key || (!ij && !this.cur)) return false;
      if (!ij) { this.cur = null; this.atoms = empty; this.ver++; return true; }
      const p = ML.particle(ij[0], ij[1]), ox = p.x_um * STAGE, oy = p.y_um * STAGE;
      // stage tilt: α about x, then β about y
      const ta = (tiltX * Math.PI) / 180, tb = (tiltY * Math.PI) / 180;
      const R = ML.mul3([[Math.cos(tb), 0, Math.sin(tb)], [0, 1, 0], [-Math.sin(tb), 0, Math.cos(tb)]], [[1, 0, 0], [0, Math.cos(ta), -Math.sin(ta)], [0, Math.sin(ta), Math.cos(ta)]]);
      const A = new AtomList(ox, oy), rng = mulberry32((p.i * 1000 + p.j) | 0);
      const pick = (comp) => { let r = rng(); for (const el in comp) { if (r < comp[el]) return EI[el]; r -= comp[el]; } return EI[Object.keys(comp)[0]]; };
      // fill a body: every lattice point of the domain's crystal (orientation O, lattice a Å) inside `keep`
      const fill = (O, a, Rb, cxA, cyA, comp, g, keep) => {
        const M = ML.mul3(R, O), m = Math.ceil(Rb / a) + 1;
        for (let u = -m; u <= m; u++) for (let v = -m; v <= m; v++) for (let w = -m; w <= m; w++)
          for (const b of fccBasis) {
            const rc = [(u + b[0]) * a, (v + b[1]) * a, (w + b[2]) * a];
            if (rc[0] * rc[0] + rc[1] * rc[1] + rc[2] * rc[2] > Rb * Rb) continue;
            const rs = ML.mv3(O, rc);
            if (!keep(rs[0] / 10, rs[1] / 10, rs[2] / 10)) continue;
            const rt = ML.mv3(M, rc);
            A.push(cxA + rt[0], cyA + rt[1], pick(comp), 1, g);
          }
      };
      if (p.present) {
        const Rb = 10 * Math.max(p.a_nm, p.b_nm, p.c_nm) + 2;
        p.domains.forEach((d, k) => fill(d.O, d.a_A, Rb, 0, 0, d.comp, k, (x, y, z) => ML.inside(p, x, y, z) && ML.domainAt(p, x, y, z) === k));
        const s = p.satellite;
        if (s) { const r = s.d_nm / 2; fill(s.O, s.a_A, 10 * r + 2, 10 * s.dx_nm, 10 * s.dy_nm, s.comp, p.domains.length, (x, y, z) => x * x + y * y + z * z < r * r); }
      }
      A.finalize(420, 8);
      const a = p.a_A;
      this.grains = [{ a1: [a / Math.SQRT2, 0], a2: [0, a], label: () => 'fcc' }];
      this.grains[0].b = reciprocal(this.grains[0].a1, this.grains[0].a2);
      this.atoms = A; this.cur = { key, p, ox, oy }; this.ver++;
      return true;
    },
  };
  const p0 = ML.particle(0, 0);
  spec.center = [p0.x_um * STAGE, p0.y_um * STAGE]; // the first particle itself, not its grid node
  spec.locate(...spec.center);
  return spec;
}

// A structure of your own: an XYZ file (N, a comment line, then "element x y z" in Å; extended-XYZ extra
// columns are ignored). Atoms keep their 3D positions, centred on the stage origin, and are rotated by the
// stage tilt and projected, so any orientation can be explored; an amorphous carbon support (the thickness
// setting) sits underneath. Replaces any structure loaded before.
export function loadXYZ(text, name = 'structure.xyz') {
  const lines = String(text).split(/\r?\n/);
  const n = parseInt(lines[0], 10);
  if (!(n > 0)) throw new Error('not an XYZ file: the first line must be the number of atoms');
  if (n > 3e6) throw new Error(`${n} atoms is more than this simulator holds (3 million)`);
  const sym = [], P3 = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    const f = (lines[k + 2] ?? '').trim().split(/\s+/);
    if (f.length < 4) throw new Error(`line ${k + 3}: expected "element x y z"`);
    let s = /^\d+$/.test(f[0]) ? SYMBOLS[+f[0] - 1] : f[0].replace(/[^A-Za-z]/g, '');
    s = s ? s[0].toUpperCase() + s.slice(1, 2).toLowerCase() : s;
    if (!SYMBOLS.includes(s)) { s = s?.[0]; if (!SYMBOLS.includes(s)) throw new Error(`line ${k + 3}: unknown element ${f[0]}`); }
    sym.push(s);
    for (let c = 0; c < 3; c++) { const v = +f[c + 1]; if (!Number.isFinite(v)) throw new Error(`line ${k + 3}: bad coordinate`); P3[3 * k + c] = v; }
  }
  const els = [...new Set(sym)], idx = Object.fromEntries(els.map((s) => [s, addElement(s)])), e = Uint8Array.from(sym, (s) => idx[s]);
  // centre on the centroid
  const c = [0, 0, 0];
  for (let k = 0; k < n; k++) for (let d = 0; d < 3; d++) c[d] += P3[3 * k + d] / n;
  let R = 0;
  for (let k = 0; k < n; k++) { for (let d = 0; d < 3; d++) P3[3 * k + d] -= c[d]; R = Math.max(R, Math.hypot(P3[3 * k], P3[3 * k + 1], P3[3 * k + 2])); }
  const zbar = sym.reduce((a, s) => a + SYMBOLS.indexOf(s) + 1, 0) / n;
  const grid = { bin: 4, map: new Map() }; // atoms per 4 Å column, for the inelastic thickness (EELS)
  const spec = {
    id: 'xyz', name: `Your structure: ${name} (${n.toLocaleString('en')} atoms)`, short: name.replace(/\.xyz$/i, ''), xyz: true,
    alpha: 1e-5, poly: true, noCBED: true, filmOnly: true, ownTilt: true, zExp: 1, period: 1, ver: 0, tk: null,
    atoms: null, center: [0, 0], fov: +Math.min(120, Math.max(3, (2.4 * R) / 10)).toFixed(1), zone: '—', grainRot: [0],
    grains: [{ a1: [3, 0], a2: [0, 3], label: () => '—' }], rings: [],
    elements: [...els.map((s) => idx[s]), ...(els.includes('C') ? [] : [EI.C])],
    labels: [{ x: 0, y: R + 25, text: name }],
    grainAt() { return -1; },
    amorph() { return 'C'; },
    thicknessAt(x, y, t) { return t + 15 * (grid.map.get(`${Math.floor(x / grid.bin)},${Math.floor(y / grid.bin)}`) ?? 0) / (grid.bin * grid.bin); },
    tauAt(x, y, t, kV) { return t / (10 * imfp(kV, 6)) + (this.thicknessAt(x, y, 0)) / (10 * imfp(kV, zbar)); },
    plasmon: [{ Ep: 22, G: 14, frac: 1 }], zeff: 6,
    locate(cx, cy, tiltX = 0, tiltY = 0) {
      const tk = `${Math.round(tiltX * 20)}|${Math.round(tiltY * 20)}`;
      if (tk === this.tk) return false;
      const ta = (tiltX * Math.PI) / 180, tb = (tiltY * Math.PI) / 180, ca = Math.cos(ta), sa = Math.sin(ta), cb = Math.cos(tb), sb = Math.sin(tb);
      const A = new AtomList();
      grid.map.clear();
      for (let k = 0; k < n; k++) {
        const x = P3[3 * k], y0 = P3[3 * k + 1], z0 = P3[3 * k + 2];
        const y = y0 * ca - z0 * sa, z = y0 * sa + z0 * ca; // α about x, then β about y
        const X = x * cb + z * sb, Y = y;
        A.push(X, Y, e[k], 1, 0);
        const key = `${Math.floor(X / grid.bin)},${Math.floor(Y / grid.bin)}`;
        grid.map.set(key, (grid.map.get(key) ?? 0) + 1);
      }
      A.finalize(Math.ceil(R + 10), Math.max(8, Math.ceil((2 * R) / 400)));
      this.atoms = A; this.tk = tk; this.ver++;
      return true;
    },
  };
  spec.locate(0, 0);
  for (const g of spec.grains) g.b = reciprocal(g.a1, g.a2);
  SPECIMENS.xyz = spec;
  return { name: spec.name, atoms: n, elements: els, extent_nm: +((2 * R) / 10).toFixed(2), fov_nm: spec.fov };
}

export const SPECIMENS = { au: makeGold(), si: makeSilicon(), sto: makeSTO(), gr: makeGraphene(), mof: makeUiO66(), bio: makeBio(), lib: makeLibrary() };
for (const s of Object.values(SPECIMENS)) {
  for (const g of s.grains) g.b = reciprocal(g.a1, g.a2);
}

// ---------------------------------------------------------------- amorphous materials
// dens: atoms per Å³ (non-hydrogen); pick(r) chooses the element of one pseudo-atom; cell: seeding cell, Å
// (ice uses ~3.1 Å, the mean spacing of water molecules, so its diffuse ring sits near 3.7 Å).
const MAT = {
  C: { cell: 2.2, dens: 0.1, mix: [[EI.C, 1]] },
  SiO2: { cell: 2.2, dens: 0.066, mix: [[EI.SiOx, 0.333], [EI.O, 0.667]] },
  ice: { cell: 3.1, dens: 0.033, mix: [[EI.O, 1]] },
  protein: { cell: 2.2, dens: 0.077, bio: true, mix: [[EI.C, 0.63], [EI.N, 0.17], [EI.O, 0.19], [EI.S, 0.01]] },
  lipid: { cell: 2.2, dens: 0.055, bio: true, mix: [[EI.C, 1]] },
  head: { cell: 2.2, dens: 0.075, bio: true, mix: [[EI.P, 0.12], [EI.O, 0.5], [EI.C, 0.32], [EI.N, 0.06]] },
  ferrihydrite: { cell: 2.2, dens: 0.09, mix: [[EI.Fe, 0.4], [EI.O, 0.6]] },
  SiN: { cell: 2.2, dens: 0.096, mix: [[EI.Si, 0.43], [EI.N, 0.57]] }, // amorphous Si₃N₄ membrane
};
for (const M of Object.values(MAT)) M.pick = (r) => { for (const [e, f] of M.mix) { if (r < f) return e; r -= f; } return M.mix[M.mix.length - 1][0]; };

// ---------------------------------------------------------------- projected maps
// Splat atoms onto an n×n grid (pixel size dx, centered at cx,cy). Tilting a crystal
// smears each column along the tilt direction by L·tanθ, which is what kills lattice contrast off-axis.
// part: 'cryst' or 'amorph' projects only that component (used to stack slices in depth)
export function projectMaps(spec, { cx, cy, n, dx, thick, tiltX = 0, tiltY = 0, elements = false, noTilt = false, part = null, T = 293, u2r = 1, eps = 0, iceT = thick, iceCryst = false }) {
  const N2 = n * n;
  const phase = new Float32Array(N2), zHi = new Float32Array(N2), zLo = new Float32Array(N2);
  const elem = elements ? EL.map(() => new Float32Array(N2)) : null;
  const x0 = cx - (n / 2) * dx, y0 = cy - (n / 2) * dx;
  const tilt = noTilt ? 0 : Math.hypot(tiltX, tiltY);
  const ux = tilt ? tiltX / tilt : 1, uy = tilt ? tiltY / tilt : 0;
  const tanT = Math.tan(tilt);
  // atom width: the projected potential (~0.29 Å) blurred by thermal vibration (u_rms ≈ 0.08 Å at 293 K,
  // zero-point ~0.05 Å near 0 K, ~0.15 Å at 1000 K); in diffraction this is the Debye–Waller factor
  const sA = Math.max(Math.sqrt(0.09 + 0.0064 * (u2r - 1)) / dx, 0.6), sA2 = sA * sA;
  const tds = 0.7 + 0.3 * u2r; // thermal-diffuse share of high-angle scattering grows with ⟨u²⟩
  const sc = 1 + eps; // thermal expansion about the specimen origin
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

  // expansion is about the atom list's origin; a specimen that rotates its own atoms with the tilt (ownTilt)
  // needs no smearing, and zExp is how high-angle scattering grows with the atoms in a column
  if (spec.overview && n * dx > spec.overviewA) return spec.overview({ cx, cy, n, dx, thick, elements, part, tds });
  const A = spec.atoms, pad = 4, ox = A.ox, oy = A.oy, tanA = spec.ownTilt ? 0 : tanT, zExp = spec.zExp ?? 0.85;
  if (part !== 'amorph') A.query(ox + (x0 - pad - ox) / sc, oy + (y0 - pad - oy) / sc, ox + (x0 + n * dx + pad - ox) / sc, oy + (y0 + n * dx + pad - oy) / sc, (i) => {
    if (A.dead && A.dead[i]) return;
    const L = A.L[i] < 0 ? thick : A.L[i];
    let N = L / spec.period;
    const e = A.e[i];
    const l = (L * tanA) / dx, l2 = (l * l) / 12;
    let ax = ox + A.x[i] * sc, ay = oy + A.y[i] * sc;
    if (spec.dmg && A.jitter) { // radiolysis: atoms wander off their sites; linkers lose mass
      const sd = 7 * spec.dmg;
      ax += sd * A.jitter[2 * i]; ay += sd * A.jitter[2 * i + 1];
      if (e !== EI.Zr) N *= 1 - 0.35 * spec.dmg;
    }
    splat((ax - x0) / dx - 0.5, (ay - y0) / dx - 0.5, sA2, l2, e, VP[e] * N, ZH[e] * Math.pow(N, zExp) * tds, ZL[e] * N, N);
  });

  // amorphous material: seeded per cell so it is stable as the stage moves. spec.amorph(x, y, ctx) returns a
  // material name (thickness from amorphThick or the slider) or a list of [material, thickness Å] pairs.
  if (part === 'cryst') return { phase, zHi, zLo, elem, n, dx, x0, y0 };
  const ctx = { thick, iceT, iceCryst, T, dmg: spec.dmg || 0 };
  for (const cell of spec.amorphCells ?? [2.2]) {
    const i0 = Math.floor(x0 / cell) - 1, i1 = Math.floor((x0 + n * dx) / cell) + 1;
    const j0 = Math.floor(y0 / cell) - 1, j1 = Math.floor((y0 + n * dx) / cell) + 1;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const rng = mulberry32(hash2(i, j, cell === 2.2 ? 77 : 91));
        const cnt = rng() < 0.45 ? 2 : 1;
        for (let k = 0; k < cnt; k++) {
          let x = (i + rng()) * cell, y = (j + rng()) * cell;
          const r1 = rng(), r2 = rng(), r3 = rng();
          const m = spec.amorph(x, y, ctx);
          if (!m) continue;
          const list = typeof m === 'string' ? [[m, spec.amorphThick ?? thick]] : m;
          for (const [mat, t] of list) {
            const M = MAT[mat];
            if (!M || M.cell !== cell || t <= 0) continue;
            const e = M.pick(r1);
            let N = ((M.dens * cell * cell * t) / 1.45) * (0.75 + 0.5 * r2);
            // thick layers: a column through them holds many atoms, so the projected texture is only ~1/√N
            // strong; the rest is laid down as a smooth continuum (one broad blob per cell, below)
            if (spec.smoothAmorph) N *= Math.min(1, 1.5 / Math.sqrt(M.dens * cell * cell * t));
            if (M.bio && ctx.dmg) { // radiolysis of organic matter: mass loss, then hydrogen bubbles
              N *= 1 - 0.35 * ctx.dmg;
              if (ctx.dmg > 0.96 && hash2(Math.floor(x / 9), Math.floor(y / 9), 13) / 4294967296 < (ctx.dmg - 0.95) * 8) N *= 0.15; // bubbles past ~4 critical doses
              x += 5 * ctx.dmg * (r3 - 0.5);
            }
            splat((x - x0) / dx - 0.5, (y - y0) / dx - 0.5, sB2, 0, e, VP[e] * N, ZH[e] * N, ZL[e] * N, N);
          }
        }
        if (spec.smoothAmorph) { // continuum part, mass-conserving: broad blobs on the cell grid sum to a flat layer
          const xc = (i + 0.5) * cell, yc = (j + 0.5) * cell, m = spec.amorph(xc, yc, ctx);
          if (!m || typeof m === 'string') continue;
          const sC = (0.6 * cell) / dx, sC2 = sC * sC;
          for (const [mat, t] of m) {
            const M = MAT[mat];
            if (!M || M.cell !== cell || t <= 0) continue;
            const f = 1 - Math.min(1, 1.5 / Math.sqrt(M.dens * cell * cell * t));
            let W = (f * M.dens * cell * cell * t * sB2) / sC2;
            if (M.bio && ctx.dmg) W *= 1 - 0.35 * ctx.dmg;
            for (const [e, fr] of M.mix) splat((xc - x0) / dx - 0.5, (yc - y0) / dx - 0.5, sC2, 0, e, VP[e] * W * fr, ZH[e] * W * fr, ZL[e] * W * fr, W * fr);
          }
        }
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
  { el: 'Zr', line: 'Lα', E: 2.042, w: 1, y: 0.9 },
  { el: 'Zr', line: 'Lβ', E: 2.124, w: 0.5, y: 0.9 },
  { el: 'Zr', line: 'Kα', E: 15.775, w: 0.9, y: 1.0 },
  { el: 'Zr', line: 'Kβ', E: 17.667, w: 0.16, y: 1.0 },
  { el: 'N', line: 'Kα', E: 0.392, w: 1, y: 0.3 },
  { el: 'P', line: 'Kα', E: 2.013, w: 1, y: 1.0 },
  { el: 'S', line: 'Kα', E: 2.307, w: 1, y: 1.0 },
  { el: 'Fe', line: 'Lα', E: 0.705, w: 0.1, y: 1.0 },
  { el: 'Fe', line: 'Kα', E: 6.404, w: 1, y: 1.0 },
  { el: 'Fe', line: 'Kβ', E: 7.058, w: 0.13, y: 1.0 },
  // copper is also the grid's system peak (added in buildEDS whatever the specimen)
  { el: 'Cu', line: 'Kα', E: 8.048, w: 1, y: 1.0 },
  { el: 'Cu', line: 'Kβ', E: 8.905, w: 0.13, y: 1.0 },
  { el: 'Cu', line: 'Lα', E: 0.93, w: 0.25, y: 1.0 },
  { el: 'Ag', line: 'Lα', E: 2.984, w: 1, y: 0.95 },
  { el: 'Ag', line: 'Lβ', E: 3.151, w: 0.55, y: 0.95 },
  { el: 'Co', line: 'Lα', E: 0.776, w: 0.1, y: 1.0 },
  { el: 'Co', line: 'Kα', E: 6.93, w: 1, y: 1.0 },
  { el: 'Co', line: 'Kβ', E: 7.649, w: 0.13, y: 1.0 },
  { el: 'Ni', line: 'Lα', E: 0.851, w: 0.1, y: 1.0 },
  { el: 'Ni', line: 'Kα', E: 7.478, w: 1, y: 1.0 },
  { el: 'Ni', line: 'Kβ', E: 8.265, w: 0.13, y: 1.0 },
];
export const detEff = (E) => Math.exp(-Math.pow(0.35 / E, 2)) * Math.exp(-E / 40);
// Energy-dispersive detector resolution (keV): Fano-limited statistics plus electronic noise, set so the
// FWHM at Mn Kα (5.899 keV) is fwhmMn eV (128 eV is a typical silicon drift detector).
const FANO_TERM = 2.355 * 2.355 * 0.115 * 3.8; // eV per eV of photon energy
export const edsFWHM = (E, fwhmMn = 128) => Math.sqrt(Math.max(0, fwhmMn * fwhmMn - FANO_TERM * 5899) + FANO_TERM * E * 1000) / 1000;

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
  { key: 'Zr', el: 'Zr', name: 'Zr M₄,₅', E: 180, kind: 'delayed', h: 1.0, delay: 25 },
  { key: 'Zr', el: 'Zr', name: 'Zr L₃', E: 2222, kind: 'sharp', h: 0.1 },
  { key: 'N', el: 'N', name: 'N K', E: 401, kind: 'sharp', h: 0.85, elnes: [[401.5, 1.2, 0.6], [407, 4, 0.4]] },
  { key: 'P', el: 'P', name: 'P L₂,₃', E: 132, kind: 'delayed', h: 1.8, delay: 6 },
  { key: 'S', el: 'S', name: 'S L₂,₃', E: 165, kind: 'delayed', h: 1.6, delay: 7 },
  { key: 'Fe', el: 'Fe', name: 'Fe L₃,₂', E: 708, kind: 'sharp', h: 0.45, elnes: [[709.5, 1.2, 1.6], [722.5, 1.4, 0.8]] },
  { key: 'Co', el: 'Co', name: 'Co L₃,₂', E: 779, kind: 'sharp', h: 0.42, elnes: [[779.5, 1.3, 1.5], [794.5, 1.5, 0.75]] },
  { key: 'Ni', el: 'Ni', name: 'Ni L₃,₂', E: 855, kind: 'sharp', h: 0.4, elnes: [[853.5, 1.2, 1.3], [871, 1.4, 0.6]] },
  { key: 'Cu', el: 'Cu', name: 'Cu L₃,₂', E: 931, kind: 'delayed', h: 0.45, delay: 8 }, // metallic Cu: filled 3d, no white lines
  { key: 'Ag', el: 'Ag', name: 'Ag M₄,₅', E: 367, kind: 'delayed', h: 0.9, delay: 30 },
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
