// Specimen structures in 3D, for the structure viewer (specview.js) and for checks before a simulation.
// Pure functions: no Three.js, no DOM, so they run headless in tests.
//
// The simulator stores crystals as projected atom columns (x, y, element, column length L) with a repeat
// distance `period` along the beam. buildStructure() turns each column into a stack of atoms along z, over
// the region around the stage, so the 3D picture is the same specimen the detectors see. Amorphous layers
// are sampled from each specimen's own amorph() recipe as voxel slabs; particles in ice, helium bubbles and
// magnetic films get their own simple geometry. Coordinates are Å, centred on the stage position, with z
// along the optical axis: the beam enters at +z (top face) and travels towards −z.
import * as P from './physics.js';
import { MAGSPECS, magnetization } from './lorentz.js';

// Jmol / CPK colours and covalent radii (Å)
const JMOL = { H: '#ffffff', He: '#d9ffff', Li: '#cc80ff', B: '#ffb5b5', C: '#909090', N: '#3050f8', O: '#ff0d0d', F: '#90e050', Na: '#ab5cf2', Mg: '#8aff00', Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000', S: '#ffff30', Cl: '#1ff01f', K: '#8f40d4', Ca: '#3dff00', Sc: '#e6e6e6', Ti: '#bfc2c7', V: '#a6a6ab', Cr: '#8a99c7', Mn: '#9c7ac7', Fe: '#e06633', Co: '#f090a0', Ni: '#50d050', Cu: '#c88033', Zn: '#7d80b0', Ga: '#c28f8f', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929', Sr: '#00ff00', Y: '#94ffff', Zr: '#94e0e0', Nb: '#73c2c9', Mo: '#54b5b5', Pd: '#006985', Ag: '#c0c0c0', Cd: '#ffd98f', In: '#a67573', Sn: '#668080', Te: '#d47a00', I: '#940094', Cs: '#57178f', Ba: '#00c900', La: '#70d4ff', Hf: '#4dc2ff', Ta: '#4da6ff', W: '#2194d6', Pt: '#d0d0e0', Au: '#ffd123', Pb: '#575961', Bi: '#9e4fb5' };
const COV = { H: 0.31, He: 0.28, Li: 1.28, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, K: 2.03, Ca: 1.76, Ti: 1.6, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.2, As: 1.19, Se: 1.2, Br: 1.2, Sr: 1.95, Y: 1.9, Zr: 1.75, Nb: 1.64, Mo: 1.54, Pd: 1.39, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39, Te: 1.38, I: 1.39, Cs: 2.44, Ba: 2.15, La: 2.07, Hf: 1.75, Ta: 1.7, W: 1.62, Pt: 1.36, Au: 1.36, Pb: 1.46, Bi: 1.48 };
export const elementColor = (sym) => JMOL[sym] ?? '#ff1493';
export const covalentRadius = (sym) => COV[sym] ?? 1.4;

// amorphous and continuum materials: colour, opacity, and whether they form the matrix (a slab) or inclusions
export const MATERIALS = {
  C: { name: 'amorphous carbon', color: '#7d8590', opacity: 0.22, matrix: true },
  SiO2: { name: 'amorphous SiO₂', color: '#cfe3ff', opacity: 0.28, matrix: true },
  SiN: { name: 'amorphous Si₃N₄', color: '#b9c8d8', opacity: 0.22, matrix: true },
  ice: { name: 'vitreous ice', color: '#9fd8ff', opacity: 0.12, matrix: true },
  protein: { name: 'protein', color: '#f4a261', opacity: 0.85 },
  lipid: { name: 'lipid tails', color: '#e9c46a', opacity: 0.6 },
  head: { name: 'lipid head groups', color: '#e76f51', opacity: 0.8 },
  ferrihydrite: { name: 'ferrihydrite core', color: '#b5482b', opacity: 0.95 },
};

export const POINTS_ABOVE = 50000; // atoms: above this the viewer draws a point cloud
export const BUILD_CAP = 400000; // atoms built for the preview; more are subsampled (and reported)
const SIM_ATOMS_HEAVY = 300000; // uploaded structures above this are slow in multislice modes

const DEG = Math.PI / 180;
const hash01 = (i, j, k = 0) => { let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// thickness along the beam (Å) and t/λ at the stage position, including the goniometer tilt: a slab of
// thickness t seen at tilts α, β has a path t / (cos α cos β). Structures that rotate their own atoms
// with the tilt (uploaded XYZ) already report the path through them.
export function beamThickness(S, sim) {
  const lor = S.mode === 'ltem' || S.mode === 'lstem';
  const tilt = Math.cos(S.tiltX * DEG) * Math.cos(S.tiltY * DEG);
  if (lor) return { t_A: (S.lorThick * 10) / tilt, slab_A: S.lorThick * 10, tau: null };
  const spec = sim.spec, own = !!spec.ownTilt;
  const slab = spec.thicknessAt ? spec.thicknessAt(S.cx, S.cy, S.thick * 10) : S.thick * 10;
  const k = own ? 1 : 1 / tilt;
  const tau = spec.tauAt ? spec.tauAt(S.cx, S.cy, S.thick * 10, S.kV) * k : null;
  return { t_A: slab * k, slab_A: slab, tau };
}

// ---------------------------------------------------------------- built-in specimens
// opts: { half (Å, half-width of the region), cap (atoms) }; ctx from the running Sim (temperature, ice)
export function buildStructure(S, sim, opts = {}) {
  if (S.mode === 'ltem' || S.mode === 'lstem') return buildMagnetic(S, sim);
  const spec = sim.spec, fovA = sim.fovA();
  spec.locate?.(S.cx, S.cy, S.tiltX, S.tiltY);
  // crystals: the field of view plus a margin, up to ±9 nm (atoms grow with area); continuum specimens are cheap,
  // so they cover the whole field up to ±40 nm
  const atomistic = !!(spec.atoms?.count || spec.xyz3 || spec.blobs);
  const half = opts.half ?? Math.min(Math.max(fovA * 0.6, 12), atomistic ? 90 : 400);
  const out = base(spec.name, 'atoms');
  out.region = { fov_A: fovA, half_A: half };
  const thick = S.thick * 10;
  if (spec.xyz3) atomsFromXYZ(out, spec.xyz3, opts.cap ?? BUILD_CAP);
  else if (spec.atoms && !(spec.overview && fovA > spec.overviewA)) atomsFromColumns(out, spec, S, half, thick, opts.cap ?? BUILD_CAP);
  if (spec.blobs && !(spec.overview && fovA > spec.overviewA)) atomsFromBlobs(out, spec, S, half);
  // amorphous layers sampled from the specimen's own recipe
  const th = sim.thermal?.() ?? { T: 293 }, ice = sim.ice?.() ?? { t: 0, cryst: false };
  const ctx = { thick, iceT: ice.t, iceCryst: ice.cryst, T: th.T, dmg: spec.dmg || 0 };
  voxelsFromAmorph(out, spec, S, half, ctx);
  if (spec.parts) shellsFromParts(out, spec, S, half);
  if (spec.bubbles) bubblesFrom(out, spec, S, half);
  if (spec.overview && fovA > spec.overviewA) out.notes.push('wide view: the chip overview, not individual atoms');
  else if (spec.id === 'lib' && !out.count) out.notes.push(spec.labels?.[0]?.text ?? 'no particle under the beam');
  out.kind = out.count ? 'atoms' : 'continuum';
  finish(out);
  return out;
}

function base(name, kind) {
  return { name, kind, count: 0, total: 0, truncated: false, pos: new Float32Array(0), el: new Uint8Array(0), species: [], voxels: [], shells: [], arrows: null, slab: null, notes: [], box: [0, 0, 0] };
}

// species table shared by the atoms: symbol, colour, radius, label (pseudo-elements keep their own label)
function speciesIndex(out) {
  const map = new Map();
  return (key, sym, label) => {
    if (!map.has(key)) { map.set(key, out.species.length); out.species.push({ key, sym, label: label ?? sym, color: elementColor(sym), r: covalentRadius(sym), count: 0 }); }
    return map.get(key);
  };
}

function atomsFromColumns(out, spec, S, half, thick, cap) {
  const A = spec.atoms, x0 = S.cx - half, x1 = S.cx + half, y0 = S.cy - half, y1 = S.cy + half;
  const cols = [];
  A.query(x0, y0, x1, y1, (i) => {
    if (A.dead && A.dead[i]) return;
    const x = A.x[i], y = A.y[i];
    if (x < x0 || x > x1 || y < y0 || y > y1) return;
    cols.push(i);
  });
  // columns that share a position (Ti and O in SrTiO₃'s Ti–O column) are interleaved along z
  const grp = new Map();
  for (const i of cols) { const k = `${Math.round(A.x[i] * 20)},${Math.round(A.y[i] * 20)}`; grp.set(k, (grp.get(k) ?? 0) + 1); }
  // 2D materials: each listed atom is one atom, on the plane of its layer (g); there `period` only weights the
  // projected phase, it is not a repeat distance along the beam
  const twoD = !!spec.twoD, layerT = spec.fixedT ?? 3.35;
  let gMax = 0; if (twoD) for (const i of cols) gMax = Math.max(gMax, A.g[i]);
  const seen = new Map(), per = spec.period || 3;
  const N = (i) => { if (twoD) return { L: layerT, n: 1 }; const L = A.L[i] < 0 ? thick : A.L[i]; return { L, n: Math.max(1, Math.round(L / per)) }; };
  let total = 0;
  for (const i of cols) total += N(i).n;
  out.total = total;
  const stride = total > cap ? Math.ceil(total / cap) : 1;
  if (stride > 1) { out.truncated = true; out.notes.push(`${total.toLocaleString('en')} atoms in the region: every ${stride}th column shown`); }
  const sp = speciesIndex(out), pos = [], el = [];
  const bubbles = spec.bubbles?.() ?? null;
  cols.forEach((i, ci) => {
    if (stride > 1 && ci % stride) return;
    const { L, n } = N(i), x = A.x[i], y = A.y[i], k = `${Math.round(x * 20)},${Math.round(y * 20)}`;
    const m = grp.get(k), j = seen.get(k) ?? 0; seen.set(k, j + 1);
    const e = A.e[i], E = P.EL[e], s = sp(E.key ?? E.sym, E.sym, E.pseudo ? E.name : E.sym);
    if (twoD) { pos.push(x - S.cx, y - S.cy, (gMax / 2 - A.g[i]) * layerT); el.push(s); return; }
    const dz = L / n;
    for (let q = 0; q < n; q++) {
      const z = L / 2 - (q + (j + 0.5) / m) * dz; // m columns at one position interleave along z
      if (bubbles && insideBubble(bubbles, x, y, z, L)) continue;
      pos.push(x - S.cx, y - S.cy, z); el.push(s);
    }
  });
  out.pos = Float32Array.from(pos); out.el = Uint8Array.from(el); out.count = el.length;
}

function atomsFromXYZ(out, xyz, cap) {
  const n = xyz.sym.length, stride = n > cap ? Math.ceil(n / cap) : 1;
  out.total = n;
  if (stride > 1) { out.truncated = true; out.notes.push(`${n.toLocaleString('en')} atoms: every ${stride}th shown`); }
  const sp = speciesIndex(out), m = Math.ceil(n / stride), pos = new Float32Array(3 * m), el = new Uint8Array(m);
  let k = 0;
  for (let i = 0; i < n; i += stride, k++) { pos[3 * k] = xyz.P3[3 * i]; pos[3 * k + 1] = xyz.P3[3 * i + 1]; pos[3 * k + 2] = xyz.P3[3 * i + 2]; el[k] = sp(xyz.sym[i], xyz.sym[i]); }
  out.pos = pos.subarray(0, 3 * k); out.el = el.subarray(0, k); out.count = k;
}

// blobs (the megalibrary particle): b.n atoms of element b.e in a column of radius b.r, stacked along z
function atomsFromBlobs(out, spec, S, half) {
  const list = spec.blobs(S.cx - half, S.cy - half, S.cx + half, S.cy + half) ?? [];
  if (!list.length) return;
  const sp = speciesIndex(out), pos = Array.from(out.pos), el = Array.from(out.el), step = 2.5;
  let total = out.total;
  for (const b of list) {
    const n = Math.max(1, Math.round(b.n)), E = P.EL[b.e], s = sp(E.key ?? E.sym, E.sym, E.pseudo ? E.name : E.sym);
    total += n;
    for (let q = 0; q < n; q++) { pos.push(b.x - S.cx, b.y - S.cy, (n / 2 - q - 0.5) * step); el.push(s); }
  }
  out.total = total; out.pos = Float32Array.from(pos); out.el = Uint8Array.from(el); out.count = el.length;
}

// helium bubbles: spheres at a depth fixed per bubble (the specimen stores them in projection only)
function bubbleZ(b, L) { const r = b.r; return (hash01(Math.round(b.x), Math.round(b.y), 7) - 0.5) * Math.max(0, L - 2 * r); }
function insideBubble(list, x, y, z, L) {
  for (const b of list) { const dx = x - b.x, dy = y - b.y; if (dx * dx + dy * dy > b.r * b.r) continue; const dz = z - bubbleZ(b, L); if (dx * dx + dy * dy + dz * dz < b.r * b.r) return true; }
  return false;
}
function bubblesFrom(out, spec, S, half) {
  const L = S.thick * 10;
  for (const b of spec.bubbles()) {
    if (Math.abs(b.x - S.cx) > half + b.r || Math.abs(b.y - S.cy) > half + b.r) continue;
    out.shells.push({ x: b.x - S.cx, y: b.y - S.cy, z: bubbleZ(b, L), R: b.r, r0: 0, color: '#d9ffff', opacity: 0.35, label: 'He bubble / void' });
  }
}

// amorphous layers: the specimen's recipe sampled on a grid; matrix materials form slabs below the crystal
// (or centred, when there is no crystal), inclusions sit at mid-depth
function voxelsFromAmorph(out, spec, S, half, ctx) {
  if (!spec.amorph) return;
  const G = 40, cell = (2 * half) / G, byMat = new Map(), crystalL = out.count ? zExtent(out) : 0;
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const x = S.cx - half + (i + 0.5) * cell, y = S.cy - half + (j + 0.5) * cell;
      let m = spec.amorph(x, y, ctx);
      if (!m) continue;
      // a bare material name with no support thickness fills the gaps between crystal at the slab thickness
      // (the oxide beside silicon); a support film (amorphThick) lies under the crystal
      const fill = typeof m === 'string' && spec.amorphThick === undefined;
      if (typeof m === 'string') m = [[m, spec.amorphThick ?? ctx.thick]];
      let below = crystalL && !fill ? -crystalL / 2 : null, stackTop = null;
      for (const [mat, t] of m) {
        const M = MATERIALS[mat];
        if (!M || !(t > 0) || (spec.parts && !M.matrix)) continue;
        let zc;
        if (M.matrix) {
          if (below !== null) { zc = below - t / 2; below -= t; } // under the crystal
          else { zc = (stackTop ?? 0); }
        } else zc = 0;
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push(x - S.cx, y - S.cy, zc, cell, cell, t);
      }
    }
  for (const [mat, b] of byMat) out.voxels.push({ mat, ...MATERIALS[mat], boxes: Float32Array.from(b), n: b.length / 6 });
}

function shellsFromParts(out, spec, S, half) {
  for (const p of spec.parts) {
    if (!['vesicle', 'apo', 'apoferritin', 'ferritin'].includes(p.type)) continue;
    if (Math.abs(p.x - S.cx) > half + p.R || Math.abs(p.y - S.cy) > half + p.R) continue;
    const x = p.x - S.cx, y = p.y - S.cy;
    if (p.type === 'vesicle') out.shells.push({ x, y, z: 0, R: p.R, r0: p.R - 40, color: MATERIALS.head.color, opacity: 0.45, label: 'lipid vesicle' });
    else {
      out.shells.push({ x, y, z: 0, R: p.R, r0: 40, color: MATERIALS.protein.color, opacity: 0.4, label: p.type === 'ferritin' ? 'ferritin shell' : 'apoferritin shell' });
      if (p.type === 'ferritin') out.shells.push({ x, y, z: 0, R: 30, r0: 0, color: MATERIALS.ferrihydrite.color, opacity: 1, label: 'ferrihydrite core' });
    }
  }
}

// magnetic films (Lorentz modes): the film outline and magnetization arrows on a coarse grid
function buildMagnetic(S, sim) {
  const sp = MAGSPECS[S.magSpec], out = base(sp.name, 'magnetic'), n = 22;
  const fovA = S.lorFov * 1e4, dx = fovA / n, T = sim.temp?.() ?? 293;
  const m = magnetization(S, T, n, dx), pos = [], dir = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!(m.t[k] > 0)) continue;
      pos.push((i - n / 2 + 0.5) * dx, (j - n / 2 + 0.5) * dx, 0);
      dir.push(m.mx[k], m.my[k], m.mz[k]);
    }
  out.arrows = { pos: Float32Array.from(pos), dir: Float32Array.from(dir), len: dx * 0.8, n: pos.length / 3 };
  out.slab = { shape: S.magSpec === 'vortex' ? 'disc' : 'rect', w: S.magSpec === 'vortex' ? 15000 : S.magSpec === 'landau' ? 24000 : fovA * 1.1, h: S.magSpec === 'vortex' ? 15000 : S.magSpec === 'landau' ? 12000 : fovA * 1.1, t: S.lorThick * 10, color: '#8fa0b8', opacity: 0.35 };
  out.region = { fov_A: fovA, half_A: fovA / 2 };
  out.notes.push(m.info?.state ? `magnetic state: ${m.info.state}` : sp.short);
  finish(out);
  return out;
}

function zExtent(out) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < out.pos.length; i += 3) { lo = Math.min(lo, out.pos[i]); hi = Math.max(hi, out.pos[i]); }
  return Number.isFinite(lo) ? hi - lo : 0;
}

// counts per species, bounding box, formula
function finish(out) {
  for (const s of out.species) s.count = 0;
  for (let i = 0; i < out.count; i++) out.species[out.el[i]].count++;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const add = (x, y, z, rx = 0, ry = 0, rz = 0) => { lo[0] = Math.min(lo[0], x - rx); lo[1] = Math.min(lo[1], y - ry); lo[2] = Math.min(lo[2], z - rz); hi[0] = Math.max(hi[0], x + rx); hi[1] = Math.max(hi[1], y + ry); hi[2] = Math.max(hi[2], z + rz); };
  for (let i = 0; i < out.count; i++) add(out.pos[3 * i], out.pos[3 * i + 1], out.pos[3 * i + 2]);
  for (const v of out.voxels) for (let k = 0; k < v.boxes.length; k += 6) add(v.boxes[k], v.boxes[k + 1], v.boxes[k + 2], v.boxes[k + 3] / 2, v.boxes[k + 4] / 2, v.boxes[k + 5] / 2);
  for (const s of out.shells) add(s.x, s.y, s.z, s.R, s.R, s.R);
  if (out.slab) add(0, 0, 0, out.slab.w / 2, out.slab.h / 2, out.slab.t / 2);
  out.lo = lo.map((v) => (Number.isFinite(v) ? v : 0)); out.hi = hi.map((v) => (Number.isFinite(v) ? v : 0));
  out.box = [0, 1, 2].map((d) => out.hi[d] - out.lo[d]);
  out.formula = formula(out.species);
}

// Pauling electronegativity, for ordering inorganic formulas (cations first)
const EN = { H: 2.2, Li: 0.98, B: 2.04, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Na: 0.93, Mg: 1.31, Al: 1.61, Si: 1.9, P: 2.19, S: 2.58, Cl: 3.16, K: 0.82, Ca: 1, Ti: 1.54, V: 1.63, Cr: 1.66, Mn: 1.55, Fe: 1.83, Co: 1.88, Ni: 1.91, Cu: 1.9, Zn: 1.65, Ga: 1.81, Ge: 2.01, As: 2.18, Se: 2.55, Br: 2.96, Sr: 0.95, Y: 1.22, Zr: 1.33, Nb: 1.6, Mo: 2.16, Pd: 2.2, Ag: 1.93, Cd: 1.69, In: 1.78, Sn: 1.96, Te: 2.1, I: 2.66, Cs: 0.79, Ba: 0.89, La: 1.1, Hf: 1.3, Ta: 1.5, W: 2.36, Pt: 2.28, Au: 2.54, Pb: 2.33, Bi: 2.02 };
export function formula(species) {
  const all = {};
  for (const s of species) all[s.sym] = (all[s.sym] ?? 0) + s.count;
  const tot0 = Object.values(all).reduce((a, b) => a + b, 0);
  if (!tot0) return '';
  // trace elements (under 1 %) are listed apart: graphene with a few Si dopants is C (+ Si)
  const by = {}, trace = [];
  for (const [k, v] of Object.entries(all)) (v / tot0 < 0.01 ? trace.push(k) : (by[k] = v));
  const f = formulaMain(by);
  return trace.length ? `${f} (+ ${trace.join(', ')})` : f;
}
function formulaMain(by) {
  const tot = Object.values(by).reduce((a, b) => a + b, 0);
  const g = Object.values(by).reduce((a, b) => gcd(a, b));
  const sub = (n) => (n === 1 ? '' : String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]));
  // Hill order for carbon compounds, otherwise cations first (by electronegativity)
  const keys = Object.keys(by), hill = keys.includes('C') && keys.length > 1;
  const order = hill ? keys.sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a === 'H' ? -1 : b === 'H' ? 1 : a.localeCompare(b))) : keys.sort((a, b) => (EN[a] ?? 2) - (EN[b] ?? 2));
  if (g > 0 && tot / g <= 40) return order.map((k) => k + sub(by[k] / g)).join('');
  // counts from a finite region are not exact ratios: the smallest multiplier that fits within 8 %
  const mn = Math.min(...Object.values(by));
  for (let f = 1; f <= 8; f++) {
    const r = order.map((k) => (by[k] / mn) * f);
    if (r.every((v) => Math.abs(v - Math.round(v)) <= 0.08 * Math.max(1, v))) return '≈ ' + order.map((k, i) => k + sub(Math.round(r[i]))).join('');
  }
  return order.map((k) => `${k}${sub(by[k])}`).join(' ');
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

// ---------------------------------------------------------------- uploaded structures (preview before loading)
// A structure is { sym: string[], P3: Float64Array (Å), name, cell? (3×3 lattice vectors, rows a, b, c) }.

export function fromXYZText(text, name = 'structure.xyz') {
  const r = P.parseXYZ(text);
  return { sym: r.sym, P3: Float64Array.from(r.P3), name, cell: parseExtXYZLattice(r.comment) };
}
// extended XYZ: Lattice="ax ay az bx by bz cx cy cz" in the comment line
function parseExtXYZLattice(c) {
  const m = /Lattice\s*=\s*"([^"]+)"/i.exec(c ?? '');
  if (!m) return null;
  const v = m[1].trim().split(/\s+/).map(Number);
  return v.length === 9 && v.every(Number.isFinite) ? [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)] : null;
}

// minimal CIF: cell, symmetry operations (xyz form) and fractional atom sites; one unit cell, deduplicated
export function fromCIFText(text, name = 'structure.cif') {
  const lines = String(text).split(/\r?\n/), num = (s) => parseFloat(String(s).replace(/\(.*\)/, ''));
  const tag = (t) => { const l = lines.find((x) => x.trim().toLowerCase().startsWith(t)); return l ? num(l.trim().split(/\s+/)[1]) : NaN; };
  const a = tag('_cell_length_a'), b = tag('_cell_length_b'), c = tag('_cell_length_c');
  const al = tag('_cell_angle_alpha') || 90, be = tag('_cell_angle_beta') || 90, ga = tag('_cell_angle_gamma') || 90;
  if (![a, b, c].every((v) => v > 0)) throw new Error('not a CIF file: _cell_length_a, b and c are needed');
  const loops = readLoops(lines);
  const symLoop = loops.find((L) => L.cols.some((k) => /_symmetry_equiv_pos_as_xyz|_space_group_symop_operation_xyz/.test(k)));
  const ops = symLoop ? symLoop.rows.map((r) => r[symLoop.cols.findIndex((k) => /_xyz$/.test(k))]).filter(Boolean).map(parseSymop) : [parseSymop('x,y,z')];
  const site = loops.find((L) => L.cols.includes('_atom_site_fract_x'));
  if (!site) throw new Error('no _atom_site_fract_x loop in this CIF');
  const ci = (k) => site.cols.indexOf(k), iT = ci('_atom_site_type_symbol'), iL = ci('_atom_site_label'), iX = ci('_atom_site_fract_x'), iY = ci('_atom_site_fract_y'), iZ = ci('_atom_site_fract_z');
  const frac = [], sym = [];
  for (const r of site.rows) {
    const raw = (iT >= 0 ? r[iT] : r[iL]) ?? '';
    let s = raw.replace(/[^A-Za-z]/g, '');
    s = s ? s[0].toUpperCase() + s.slice(1, 2).toLowerCase() : s;
    if (!P.SYMBOLS.includes(s)) { s = s[0]; if (!P.SYMBOLS.includes(s)) throw new Error(`unknown element in atom site ${raw}`); }
    const f0 = [num(r[iX]), num(r[iY]), num(r[iZ])];
    if (!f0.every(Number.isFinite)) throw new Error(`bad coordinates for ${raw}`);
    for (const op of ops) {
      const f = op(f0).map((v) => v - Math.floor(v + 1e-6));
      if (frac.some((g, k) => sym[k] === s && g.every((v, d) => { const dd = Math.abs(v - f[d]); return Math.min(dd, 1 - dd) < 1e-3; }))) continue;
      frac.push(f); sym.push(s);
    }
  }
  const cell = cellVectors(a, b, c, al, be, ga), P3 = new Float64Array(3 * sym.length);
  frac.forEach((f, k) => { for (let d = 0; d < 3; d++) P3[3 * k + d] = f[0] * cell[0][d] + f[1] * cell[1][d] + f[2] * cell[2][d]; });
  return { sym, P3, name, cell, cellParams: { a, b, c, alpha: al, beta: be, gamma: ga } };
}
function readLoops(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() !== 'loop_') continue;
    const cols = [], rows = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim().startsWith('_')) cols.push(lines[j++].trim().split(/\s+/)[0].toLowerCase());
    let buf = [];
    for (; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t || t.startsWith('#')) { if (!t && buf.length === 0) continue; if (!t) continue; continue; }
      if (t.startsWith('_') || t.toLowerCase() === 'loop_' || t.startsWith('data_')) break;
      buf.push(...(t.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((x) => x.replace(/^['"]|['"]$/g, '')));
      while (buf.length >= cols.length) { rows.push(buf.slice(0, cols.length)); buf = buf.slice(cols.length); }
    }
    out.push({ cols, rows });
    i = j - 1;
  }
  return out;
}
function parseSymop(s) {
  const parts = String(s).toLowerCase().replace(/\s/g, '').split(',');
  if (parts.length !== 3) throw new Error(`bad symmetry operation ${s}`);
  const terms = parts.map((p) => {
    const t = { x: 0, y: 0, z: 0, c: 0 };
    for (const m of p.matchAll(/([+-]?)(\d*\.?\d*(?:\/\d+)?)\*?([xyz]?)/g)) {
      if (!m[0]) continue;
      const sign = m[1] === '-' ? -1 : 1, numStr = m[2], v = m[3];
      const val = numStr ? (numStr.includes('/') ? numStr.split('/').reduce((a, b) => +a / +b) : +numStr) : 1;
      if (v) t[v] += sign * (numStr ? val : 1); else if (numStr) t.c += sign * val;
    }
    return t;
  });
  return (f) => terms.map((t) => t.x * f[0] + t.y * f[1] + t.z * f[2] + t.c);
}
export function cellVectors(a, b, c, al, be, ga) {
  const ca = Math.cos(al * DEG), cb = Math.cos(be * DEG), cg = Math.cos(ga * DEG), sg = Math.sin(ga * DEG);
  const cx = c * cb, cy = (c * (ca - cb * cg)) / sg, cz = Math.sqrt(Math.max(0, c * c - cx * cx - cy * cy));
  return [[a, 0, 0], [b * cg, b * sg, 0], [cx, cy, cz]];
}

// ---------------------------------------------------------------- preparation tools
export function clone(st) { return { ...st, sym: [...st.sym], P3: Float64Array.from(st.P3), cell: st.cell?.map((v) => [...v]) ?? null }; }
export function center(st) {
  const n = st.sym.length, c = [0, 0, 0];
  for (let k = 0; k < n; k++) for (let d = 0; d < 3; d++) c[d] += st.P3[3 * k + d] / n;
  for (let k = 0; k < n; k++) for (let d = 0; d < 3; d++) st.P3[3 * k + d] -= c[d];
  return st;
}
// rotate so the principal axes (largest spread first) lie along x, y and the smallest along z (the beam)
export function alignPrincipal(st) {
  center(st);
  const n = st.sym.length, C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < n; k++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (st.P3[3 * k + i] * st.P3[3 * k + j]) / n;
  const { vals, vecs } = jacobi3(C), ord = [0, 1, 2].sort((a, b) => vals[b] - vals[a]);
  let R = ord.map((i) => [vecs[0][i], vecs[1][i], vecs[2][i]]); // rows: new x, y, z axes
  if (det3(R) < 0) R[2] = R[2].map((v) => -v);
  return rotate(st, R);
}
// rotate so the lattice direction [u v w] (u a + v b + w c) lies along the optical axis (z);
// the projection of a stays along x where possible
export function alignZone(st, uvw) {
  if (!st.cell) throw new Error('a zone axis needs the lattice (a CIF, or an extended XYZ with Lattice="…")');
  const [u, v, w] = uvw, cell = st.cell;
  const d = [0, 1, 2].map((k) => u * cell[0][k] + v * cell[1][k] + w * cell[2][k]);
  const z = norm(d);
  if (!z) throw new Error('[0 0 0] is not a direction');
  let x = cell[0].map((a) => a), dot = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
  x = x.map((a, k) => a - dot * z[k]);
  if (Math.hypot(...x) < 1e-6) { x = cell[1].map((a) => a); dot = x[0] * z[0] + x[1] * z[1] + x[2] * z[2]; x = x.map((a, k) => a - dot * z[k]); }
  x = norm(x);
  const y = cross(z, x);
  center(st);
  return rotate(st, [x, y, z]);
}
function rotate(st, R) {
  const n = st.sym.length, p = st.P3;
  for (let k = 0; k < n; k++) {
    const v = [p[3 * k], p[3 * k + 1], p[3 * k + 2]];
    for (let i = 0; i < 3; i++) p[3 * k + i] = R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2];
  }
  if (st.cell) st.cell = st.cell.map((a) => [0, 1, 2].map((i) => R[i][0] * a[0] + R[i][1] * a[1] + R[i][2] * a[2]));
  return st;
}
// repeat the structure nx × ny × nz times along its lattice vectors (or its bounding box if it has none)
export function supercell(st, nx, ny, nz) {
  const cell = st.cell ?? boxCell(st), n = st.sym.length, m = n * nx * ny * nz;
  if (m > 3e6) throw new Error(`${m.toLocaleString('en')} atoms is more than the simulator holds (3 million)`);
  const P3 = new Float64Array(3 * m), sym = new Array(m);
  let k = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let l = 0; l < nz; l++)
    for (let a = 0; a < n; a++, k++) {
      for (let d = 0; d < 3; d++) P3[3 * k + d] = st.P3[3 * a + d] + i * cell[0][d] + j * cell[1][d] + l * cell[2][d];
      sym[k] = st.sym[a];
    }
  return center({ ...st, sym, P3, cell: st.cell ? cell.map((v, q) => v.map((x) => x * [nx, ny, nz][q])) : null });
}
function boxCell(st) { const b = bounds(st); return [[b.size[0] + 2, 0, 0], [0, b.size[1] + 2, 0], [0, 0, b.size[2] + 2]]; }
// keep atoms within radius r (Å) of the beam axis
export function cropLateral(st, r) {
  const keep = [];
  for (let k = 0; k < st.sym.length; k++) if (Math.hypot(st.P3[3 * k], st.P3[3 * k + 1]) <= r) keep.push(k);
  const P3 = new Float64Array(3 * keep.length);
  keep.forEach((k, i) => { P3[3 * i] = st.P3[3 * k]; P3[3 * i + 1] = st.P3[3 * k + 1]; P3[3 * i + 2] = st.P3[3 * k + 2]; });
  return { ...st, sym: keep.map((k) => st.sym[k]), P3, cell: null };
}
export function bounds(st) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < st.sym.length; k++) for (let d = 0; d < 3; d++) { const v = st.P3[3 * k + d]; if (v < lo[d]) lo[d] = v; if (v > hi[d]) hi[d] = v; }
  return { lo, hi, size: lo.map((v, d) => (st.sym.length ? hi[d] - v : 0)) };
}
// checks before loading: size, thickness along the beam, overlapping atoms, browser limits
export function checkStructure(st) {
  const n = st.sym.length, b = bounds(st), issues = [], species = {};
  for (const s of st.sym) species[s] = (species[s] ?? 0) + 1;
  // nearest-neighbour check on a hash grid (up to 200 000 atoms)
  let overl = 0, dmin = Infinity;
  if (n <= 200000) {
    const G = 2.0, grid = new Map(), key = (i, j, k) => `${i},${j},${k}`;
    for (let a = 0; a < n; a++) { const k = key(Math.floor(st.P3[3 * a] / G), Math.floor(st.P3[3 * a + 1] / G), Math.floor(st.P3[3 * a + 2] / G)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a); }
    for (let a = 0; a < n; a++) {
      const i = Math.floor(st.P3[3 * a] / G), j = Math.floor(st.P3[3 * a + 1] / G), l = Math.floor(st.P3[3 * a + 2] / G);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dl = -1; dl <= 1; dl++) {
        for (const c of grid.get(key(i + di, j + dj, l + dl)) ?? []) {
          if (c <= a) continue;
          const d = Math.hypot(st.P3[3 * a] - st.P3[3 * c], st.P3[3 * a + 1] - st.P3[3 * c + 1], st.P3[3 * a + 2] - st.P3[3 * c + 2]);
          if (d < dmin) dmin = d;
          if (d < 0.5) overl++;
        }
      }
    }
    if (overl) issues.push({ level: 'warn', text: `${overl} atom pairs closer than 0.5 Å (duplicated sites?)` });
  } else issues.push({ level: 'info', text: 'over 200 000 atoms: overlap check skipped' });
  if (n > SIM_ATOMS_HEAVY) issues.push({ level: 'warn', text: `${n.toLocaleString('en')} atoms: slow in 4D-STEM and in-line holography; consider a Tier 2 (abTEM) run` });
  if (b.size[2] > 500) issues.push({ level: 'warn', text: `${(b.size[2] / 10).toFixed(1)} nm thick along the beam: plural scattering dominates; a thinner crop is more realistic` });
  if (Math.max(b.size[0], b.size[1]) > 1200) issues.push({ level: 'info', text: 'wider than the 120 nm field the viewer frames by default' });
  if (b.size[2] > 1.5 * Math.max(b.size[0], b.size[1])) issues.push({ level: 'warn', text: 'longest along the beam: probably misoriented; try Align principal axes' });
  return { atoms: n, species, size_A: b.size, thickness_A: b.size[2], min_distance_A: Number.isFinite(dmin) ? dmin : null, issues, ok: !issues.some((i) => i.level === 'error') };
}
export function toXYZText(st, comment) {
  const n = st.sym.length, lat = st.cell ? ` Lattice="${st.cell.flat().map((v) => v.toFixed(5)).join(' ')}"` : '';
  const lines = [String(n), `${comment ?? st.name ?? 'TEM-view structure'}${lat} (Å; beam along −z)`];
  for (let k = 0; k < n; k++) lines.push(`${st.sym[k]} ${st.P3[3 * k].toFixed(5)} ${st.P3[3 * k + 1].toFixed(5)} ${st.P3[3 * k + 2].toFixed(5)}`);
  return lines.join('\n') + '\n';
}
// an uploaded structure in the same form buildStructure() returns, for the viewer
export function structureView(st, cap = BUILD_CAP) {
  const out = base(st.name ?? 'structure', 'atoms');
  atomsFromXYZ(out, { sym: st.sym, P3: st.P3 }, cap);
  finish(out);
  out.cell = st.cell;
  return out;
}

// ---------------------------------------------------------------- small linear algebra
const norm = (v) => { const l = Math.hypot(...v); return l ? v.map((a) => a / l) : null; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
function jacobi3(A) {
  const a = A.map((r) => [...r]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return { vals: [a[0][0], a[1][1], a[2][2]], vecs: v };
}
