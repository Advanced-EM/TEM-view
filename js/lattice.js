// Lattice finding for explicit atoms (an uploaded XYZ, a CIF tiled into a supercell, a nanoparticle): the
// translations t that map most atoms onto atoms of the same element are the lattice vectors. From central atoms,
// difference vectors to same-element neighbours are binned; the shortest vector carried by most atoms is a₁, the
// shortest not parallel to it a₂, the shortest out of their plane a₃ (each refined as the mean of its bin, then
// reduced to a short basis). Folding the central atoms into that cell gives the basis, and with it the structure
// factors of every reflection, F_hkl = Σ f_j exp(2πi h·x_j), at g = h b₁ + k b₂ + l b₃ in the structure's frame.
// Pure functions, for 3D ED (sim.computeED3D) and tests.
import * as P from './physics.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const det3 = (a, b, c) => dot(a, cross(b, c));

// sym: element symbols; P3: Float64Array of coordinates (Å). Returns { a: [a1, a2, a3], basis: [{ f, Z }], volume,
// params: {a, b, c, alpha, beta, gamma}, coverage } or null when no lattice carries enough of the atoms.
export function findLattice(sym, P3, { maxLen = 14, bin = 0.25, minCoverage = 0.5, maxOrigins = 600 } = {}) {
  const n = sym.length;
  if (n < 8) return null;
  // centre and the central atoms (well inside, so most of their neighbours exist)
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) c[d] += P3[3 * i + d] / n;
  const r = (i) => [P3[3 * i] - c[0], P3[3 * i + 1] - c[1], P3[3 * i + 2] - c[2]];
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => len(r(i)) - len(r(j)));
  const origins = order.slice(0, Math.min(maxOrigins, Math.max(8, Math.floor(n / 4))));
  // neighbour grid
  const G = 3, grid = new Map(), key = (x, y, z) => `${Math.floor(x / G)},${Math.floor(y / G)},${Math.floor(z / G)}`;
  for (let i = 0; i < n; i++) { const k = key(P3[3 * i], P3[3 * i + 1], P3[3 * i + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const reach = Math.ceil(maxLen / G), bins = new Map();
  for (const i of origins) {
    const xi = P3[3 * i], yi = P3[3 * i + 1], zi = P3[3 * i + 2], gi = [Math.floor(xi / G), Math.floor(yi / G), Math.floor(zi / G)], seen = new Set();
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (let cc = -reach; cc <= reach; cc++) {
      for (const j of grid.get(`${gi[0] + a},${gi[1] + b},${gi[2] + cc}`) ?? []) {
        if (j === i || sym[j] !== sym[i]) continue;
        const d = [P3[3 * j] - xi, P3[3 * j + 1] - yi, P3[3 * j + 2] - zi], L = len(d);
        if (L < 1 || L > maxLen) continue;
        const k = `${Math.round(d[0] / bin)},${Math.round(d[1] / bin)},${Math.round(d[2] / bin)}`;
        if (seen.has(k)) continue; seen.add(k); // one count per origin and bin
        let e = bins.get(k); if (!e) bins.set(k, (e = { n: 0, s: [0, 0, 0] }));
        e.n++; e.s[0] += d[0]; e.s[1] += d[1]; e.s[2] += d[2];
      }
    }
  }
  // candidate translations: carried by most origins (merge neighbouring bins split by noise)
  // a lattice translation maps (nearly) every atom onto its kind; an intra-cell vector, like the Si–Si bond of the
  // diamond structure, maps only one sublattice: keep vectors carried by ≥ 80 % of the best-carried one
  let best = 0; for (const e of bins.values()) best = Math.max(best, e.n);
  const cand = [];
  for (const e of bins.values()) { const t = e.s.map((v) => v / e.n); if (e.n >= minCoverage * origins.length && e.n >= 0.8 * best) cand.push({ t, n: e.n, L: len(t) }); }
  if (cand.length < 3) return null;
  cand.sort((x, y) => x.L - y.L || y.n - x.n);
  const a1 = cand[0].t;
  const c2 = cand.find((x) => len(cross(a1, x.t)) > 0.2 * x.L * cand[0].L);
  if (!c2) return null;
  const a2 = c2.t, c3 = cand.find((x) => Math.abs(det3(a1, a2, x.t)) > 0.2 * len(a1) * len(a2) * x.L);
  if (!c3) return null;
  let A = reduce([a1, a2, c3.t]);
  if (det3(...A) < 0) A = [A[0], A[1], A[2].map((v) => -v)];
  const V = det3(...A);
  // the basis: central atoms folded into the cell (fractional coordinates, deduplicated)
  const inv = invert(A), basis = [], o0 = r(origins[0]);
  for (const i of origins) {
    const d = sub(r(i), o0), f = [0, 1, 2].map((k) => { const v = dot(inv[k], d); return v - Math.floor(v + 1e-6); });
    if (basis.some((b) => b.sym === sym[i] && b.f.every((v, k) => { const dd = Math.abs(v - f[k]); return Math.min(dd, 1 - dd) < 0.03; }))) continue;
    basis.push({ f, sym: sym[i], Z: P.SYMBOLS.indexOf(sym[i]) + 1 });
  }
  const p = params(A);
  return { a: A, basis, volume: V, params: p, coverage: Math.min(cand[0].n, c2.n, c3.n) / origins.length, origins: origins.length };
}

// Lagrange–Gauss style reduction: make each vector as short as possible against the others
function reduce(A) {
  A = A.map((v) => [...v]);
  for (let it = 0; it < 20; it++) {
    let changed = false;
    A.sort((x, y) => len(x) - len(y));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      const m = Math.round(dot(A[i], A[j]) / dot(A[j], A[j]));
      if (m) { const v = A[i].map((x, k) => x - m * A[j][k]); if (len(v) < len(A[i]) - 1e-6) { A[i] = v; changed = true; } }
    }
    if (!changed) break;
  }
  return A.sort((x, y) => len(x) - len(y));
}
// rows of the inverse transpose: fractional coordinate k of r is inv[k]·r (inv = reciprocal basis b_k)
export function invert(A) {
  const V = det3(...A);
  return [cross(A[1], A[2]), cross(A[2], A[0]), cross(A[0], A[1])].map((v) => v.map((x) => x / V));
}
export function params(A) {
  const [a, b, c] = A.map(len), ang = (x, y) => (Math.acos(dot(x, y) / (len(x) * len(y))) * 180) / Math.PI;
  return { a, b, c, alpha: ang(A[1], A[2]), beta: ang(A[0], A[2]), gamma: ang(A[0], A[1]) };
}
export const isCubic = (p, tol = 0.02) => Math.abs(p.a - p.b) < tol * p.a && Math.abs(p.a - p.c) < tol * p.a && [p.alpha, p.beta, p.gamma].every((x) => Math.abs(x - 90) < 0.5);

// reflections of a found cell out to gMax (Å⁻¹), in the same form as ed3d.reflections(): { h, k, l, g, F, v, I }
export function cellReflections(lat, gMax) {
  const B = invert(lat.a), out = [];
  const hm = lat.a.map((v) => Math.ceil(gMax * len(v)) + 1);
  for (let h = -hm[0]; h <= hm[0]; h++) for (let k = -hm[1]; k <= hm[1]; k++) for (let l = -hm[2]; l <= hm[2]; l++) {
    if (!(h || k || l)) continue;
    const v = [0, 1, 2].map((j) => h * B[0][j] + k * B[1][j] + l * B[2][j]), g = len(v);
    if (g > gMax) continue;
    let re = 0, im = 0;
    for (const b of lat.basis) { const fe = P.fElec(b.Z, g / 2), ph = 2 * Math.PI * (h * b.f[0] + k * b.f[1] + l * b.f[2]); re += fe * Math.cos(ph); im += fe * Math.sin(ph); }
    const F = Math.hypot(re, im);
    if (F < 0.02 * lat.basis.length ** 0.5) continue;
    out.push({ h, k, l, g, F, v, I: F * F });
  }
  return out;
}
