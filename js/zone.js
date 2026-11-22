// Zone axes: a built-in crystal viewed along any [u v w]. The hand-built specimens are projections along one
// zone (with their boundaries, oxides and defects); any other zone is a single-crystal slab cut from the unit
// cell (physics.CRYST) with [u v w] along the beam, at the set thickness, built as explicit 3D atoms
// (physics.atomSpec): the stage tilt (±30°) then rotates the atoms, so off-axis projections are real too.
// The rotated crystal table (cryst) carries the zone to CBED, precession and orientation mapping.
import * as P from './physics.js';

export const STANDARD_ZONES = [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 1, 2], [0, 1, 3]];
export const hasZones = (id) => { const c = P.CRYST[id]; return !!c && !c.twoD; };
export const zoneLabel = (uvw) => `[${uvw.map((v) => (v < 0 ? `${-v}̅` : `${v}`)).join('')}]`;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
export function reduce(uvw) { const g = uvw.reduce((a, b) => gcd(a, b)) || 1; return uvw.map((v) => Math.round(v / g)); }
export const validZone = (z) => Array.isArray(z) && z.length === 3 && z.every((v) => Number.isInteger(v) && Math.abs(v) <= 9) && z.some((v) => v !== 0);

// the as-built zone of a crystal: its beam direction (cr.z), as the smallest integer triple
export function asBuilt(id) {
  const z = P.CRYST[id].z, m = Math.max(...z.map(Math.abs));
  return reduce(z.map((v) => Math.round((v / m) * 6)));
}
// an in-plane x axis for [u v w]: the shortest lattice direction perpendicular to it (cubic lattices)
function inPlaneX(uvw) {
  let best = null;
  for (let h = -3; h <= 3; h++) for (let k = -3; k <= 3; k++) for (let l = -3; l <= 3; l++) {
    const v = [h, k, l];
    if (!(h || k || l) || dot(v, uvw) !== 0) continue;
    const L = Math.hypot(h, k, l);
    if (!best || L < best.L - 1e-9 || (Math.abs(L - best.L) < 1e-9 && (h > best.v[0] || (h === best.v[0] && k > best.v[1])))) best = { v, L };
  }
  return best.v;
}
// the crystal table rotated to the zone: what CBED, precession and orientation templates read
export function zoneCryst(id, uvw) {
  const base = P.CRYST[id], x = unit(inPlaneX(uvw)), z = unit(uvw), y = cross(z, x);
  return { ...base, xAx: inPlaneX(uvw), yAx: y, x, y, z, zone: uvw };
}
// two shortest reciprocal-lattice vectors in the zone plane (h·u + k·v + l·w = 0): the in-plane lattice and the
// Miller indices of the spots, for the exhibit's indexing labels
function inPlaneLattice(cr) {
  const cand = [];
  for (let h = -4; h <= 4; h++) for (let k = -4; k <= 4; k++) for (let l = -4; l <= 4; l++) {
    if (!(h || k || l) || h * cr.zone[0] + k * cr.zone[1] + l * cr.zone[2] !== 0 || P.structF(cr, h, k, l) < 0.05) continue;
    const g = P.zoneG(cr, h, k, l);
    cand.push({ hkl: [h, k, l], g: [g[0], g[1]], L: Math.hypot(g[0], g[1]) });
  }
  cand.sort((a, b) => a.L - b.L || b.hkl[0] - a.hkl[0]);
  const g1 = cand[0], g2 = cand.find((c) => Math.abs(g1.g[0] * c.g[1] - g1.g[1] * c.g[0]) > 1e-6 * g1.L * c.L);
  const det = g1.g[0] * g2.g[1] - g1.g[1] * g2.g[0];
  // real-space in-plane basis dual to g1, g2
  const a1 = [g2.g[1] / det, -g2.g[0] / det], a2 = [-g1.g[1] / det, g1.g[0] / det];
  const bar = (v) => (v < 0 ? `${-v}̅` : `${v}`);
  return { a1, a2, label: (m, n) => [0, 1, 2].map((i) => bar(m * g1.hkl[i] + n * g2.hkl[i])).join(''), rings: cand.filter((c, i, a) => a.findIndex((d) => Math.abs(d.L - c.L) < 1e-4) === i).slice(0, 8).map((c) => ({ d: +(1 / c.L).toFixed(4), hkl: c.hkl.map(bar).join('') })) };
}

// the specimen: a cylinder of radius R (Å) and thickness t (Å) along the beam, cut from the unit cell
export function zoneSpec(id, uvw, t, R) {
  const base = P.SPECIMENS[id], cr = zoneCryst(id, uvw), a = cr.a, sym = [], pos = [];
  const N = Math.ceil(Math.hypot(R, t / 2) / a) + 1;
  const zsym = (Z, i) => (Z === 13 ? (i % 2 ? 'N' : 'C') : P.SYMBOLS[Z - 1]); // the methylammonium A site: C and N
  let q = 0;
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) for (let k = -N; k <= N; k++)
    for (const [fx, fy, fz, Z] of cr.basis) {
      const r = [(i + fx) * a, (j + fy) * a, (k + fz) * a], X = dot(r, cr.x), Y = dot(r, cr.y), Zc = dot(r, cr.z);
      if (Math.abs(Zc) > t / 2 || X * X + Y * Y > R * R) continue;
      pos.push(X, Y, Zc); sym.push(zsym(Z, q++));
    }
  const lat = inPlaneLattice(cr), label = zoneLabel(uvw), short = (base.short ?? base.name).split(/[ (]/)[0];
  const spec = P.atomSpec(sym, Float64Array.from(pos), {
    name: `${short} single crystal along ${label} (${sym.length.toLocaleString('en')} atoms)`, short: `${short} ${label}`, label: `${short} along ${label}`,
    spec: {
      id, zoneKey: `${id}${label}|${Math.round(t)}`, cryst: cr, zone: label, xyz: false, poly: false, noCBED: !!base.noCBED, filmOnly: false,
      grains: [{ a1: lat.a1, a2: lat.a2, label: lat.label }], grainRot: [0], rings: lat.rings, slabT: t,
      elements: base.elements, plasmon: base.plasmon, zeff: base.zeff, elnes: base.elnes, alpha: base.alpha, fov: base.fov,
      beamSensitive: base.beamSensitive, Dc300: base.Dc300, cryoProtect: base.cryoProtect, thermalLimit: base.thermalLimit,
      grainAt(x, y) { return x * x + y * y < R * R ? 0 : -1; },
      amorph() { return null; },
      thicknessAt() { const [ta, tb] = this.tilt ?? [0, 0]; return t / (Math.cos((ta * Math.PI) / 180) * Math.cos((tb * Math.PI) / 180)); },
      tauAt(x, y, tt, kV) { return this.thicknessAt() / (10 * P.imfp(kV, base.zeff ?? 20)); },
    },
  });
  for (const g of spec.grains) g.b = P.reciprocal(g.a1, g.a2);
  return spec;
}
