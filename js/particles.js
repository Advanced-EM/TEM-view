// The protein particles of single-particle cryo-EM (spa.js), shared with every other technique: apoferritin (24
// subunits of four-helix bundles, octahedral symmetry) and β-galactosidase (a D2 tetramer of five-domain monomers).
// Each is a set of primitives (Gaussian rods for α-helices, soft spheres for domains) in Å from the particle
// centre. spa.js renders them as density maps; pseudoAtoms() fills the same density with explicit C, N, O and S
// atoms, so the particle can also be imaged, scanned, tilted, diffracted and reconstructed as a structure
// (physics.js builds the specimens from it). No imports: physics.js and spa.js both depend on this file.

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
export const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
export function renderParts(N, px, { blobs = [], rods = [] }, rodV = 2) {
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
// ---------------------------------------------------------------- the particle as explicit atoms
// Pseudo-atoms: one per non-hydrogen atom of the protein (its mass ÷ 13.9 Da, the mean heavy-atom mass of a protein
// with its hydrogens), drawn from the same density as the map (a rod's Gaussian cross-section, a domain's sphere),
// one asymmetric unit then copied by the point group, so the model has the particle's exact symmetry. Elements in
// protein proportions (C 63 %, N 17 %, O 19 %, S 1 %). Not an atomic model: no residues, bonds or side chains, so it
// carries the particle's shape and mass to about 5 Å, the level the map itself describes.
export const PARTICLES = {
  apo: { name: 'Apoferritin', kDa: 480, symmetry: 'O', size: '12 nm shell' },
  bgal: { name: 'β-Galactosidase', kDa: 465, symmetry: 'D2', size: '17.5 × 13.5 × 9 nm' },
};
const HEAVY_DA = 13.9;
const MIX = [['C', 0.63], ['N', 0.17], ['O', 0.19], ['S', 0.01]];
function rng32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// the asymmetric unit and its group: { group, rods: [[a, b, weight]], blobs: [[x, y, z, R, weight]] }; weights in
// the map's units (V × Å³ per Å of rod, or per sphere), so the atoms follow the map's mass distribution
function asymmetricUnit(sample) {
  if (sample === 'bgal') {
    const all = betaGalParts(), G = d2Group(), nb = all.blobs.length / G.length, nr = all.rods.length / G.length;
    // betaGalParts lists the copies group element by group element: the first block is the asymmetric unit
    return { group: G, blobs: all.blobs.slice(0, nb).map((b) => [...b, 1.6 * (4 / 3) * Math.PI * b[3] ** 3]), rods: all.rods.slice(0, nr).map(([a, b]) => [a, b, 2 * Math.PI * 2 * 2.3 * 2.3 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])]) };
  }
  const G = octahedralGroup(), all = apoferritinRods(), nr = all.length / G.length;
  return { group: G, blobs: [], rods: all.slice(0, nr).map(([a, b]) => [a, b, 3.5 * Math.PI * 2 * 2.3 * 2.3 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])]) };
}
// returns { sym: [element, …], P3: Float64Array (x, y, z Å, centred), n, name }
export function pseudoAtoms(sample = 'apo', { seed = 2024 } = {}) {
  const P = PARTICLES[sample] ?? PARTICLES.apo, U = asymmetricUnit(sample), G = U.group;
  const nTotal = Math.round((P.kDa * 1000) / HEAVY_DA), nUnit = Math.round(nTotal / G.length);
  const prims = [...U.rods.map((r) => ({ rod: r, w: r[2] })), ...U.blobs.map((b) => ({ blob: b, w: b[4] }))];
  const W = prims.reduce((s, p) => s + p.w, 0), cum = []; let acc = 0; for (const p of prims) { acc += p.w / W; cum.push(acc); }
  const rnd = rng32(seed), gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const unit = [], el = [];
  for (let k = 0; k < nUnit; k++) {
    const u = rnd(); let i = cum.findIndex((c) => u <= c); if (i < 0) i = prims.length - 1;
    const p = prims[i];
    if (p.rod) { // along the rod, a Gaussian cross-section (σ 2.3 Å) about its axis
      const [a, b] = p.rod, t = rnd(), ab = b.map((x, j) => x - a[j]), d = norm(ab);
      const e1 = norm(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), e2 = cross(d, e1), g1 = 2.3 * gauss(), g2 = 2.3 * gauss();
      unit.push(a.map((x, j) => x + t * ab[j] + g1 * e1[j] + g2 * e2[j]));
    } else { // uniformly inside the sphere
      const [x, y, z, R] = p.blob; let v;
      do { v = [2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1]; } while (dot(v, v) > 1);
      unit.push([x + R * v[0], y + R * v[1], z + R * v[2]]);
    }
    const r = rnd(); let s = 0, e = 'C'; for (const [sy, f] of MIX) { s += f; if (r <= s) { e = sy; break; } } el.push(e);
  }
  const n = unit.length * G.length, P3 = new Float64Array(3 * n), sym = new Array(n);
  let q = 0;
  for (const g of G) for (let k = 0; k < unit.length; k++) { const v = mv(g, unit[k]); P3[3 * q] = v[0]; P3[3 * q + 1] = v[1]; P3[3 * q + 2] = v[2]; sym[q] = el[k]; q++; }
  return { sym, P3, n, name: P.name };
}
// the same model as XYZ text (for the structure viewer's export, or another program)
export function particleXYZ(sample = 'apo') {
  const { sym, P3, n, name } = pseudoAtoms(sample);
  const lines = [String(n), `${name}: ${n} pseudo-atoms (C, N, O, S in protein proportions) filling the TEM-view particle model; ${PARTICLES[sample].symmetry} symmetry; Å`];
  for (let i = 0; i < n; i++) lines.push(`${sym[i]} ${P3[3 * i].toFixed(3)} ${P3[3 * i + 1].toFixed(3)} ${P3[3 * i + 2].toFixed(3)}`);
  return lines.join('\n') + '\n';
}
