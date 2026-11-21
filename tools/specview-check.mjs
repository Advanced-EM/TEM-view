// Specimen structures (structure.js): built-in specimens in 3D, thickness along the beam with tilt (and the
// same number in footprint.js), CIF and XYZ parsing, and the preparation tools. Run: node tools/specview-check.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import * as P from '../js/physics.js';
import * as ST from '../js/structure.js';
import { footprintFor } from '../js/footprint.js';

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'structures');
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const stateFor = (id, mode = 'tem') => { const S = defaultState(); S.mode = mode; const sp = P.SPECIMENS[id]; S.spec = id; S.fov = sp.fov; [S.cx, S.cy] = sp.center; return S; };

// ---------------------------------------------------------------- built-in specimens
for (const id of Object.keys(P.SPECIMENS).filter((k) => k !== 'xyz')) {
  const S = stateFor(id), sim = new Sim(S), st = ST.buildStructure(S, sim);
  const drawn = st.voxels.length + st.shells.length + st.count;
  ok(drawn > 0 && st.box.every((v) => v >= 0) && Number.isFinite(st.box[2]), `${id}: ${st.kind}, ${st.count} atoms, ${st.voxels.map((v) => v.mat).join('+') || 'no layers'}, ${st.shells.length} shells, ${st.box.map((v) => (v / 10).toFixed(1)).join(' × ')} nm`);
}
{
  // SrTiO₃: the atom count is the sum over columns of round(L / period), and the stack is the slab thickness
  const S = stateFor('sto'), sim = new Sim(S), st = ST.buildStructure(S, sim), spec = sim.spec, half = st.region.half_A;
  let expect = 0;
  spec.atoms.query(S.cx - half, S.cy - half, S.cx + half, S.cy + half, (i) => {
    const x = spec.atoms.x[i], y = spec.atoms.y[i];
    if (x < S.cx - half || x > S.cx + half || y < S.cy - half || y > S.cy + half) return;
    expect += Math.max(1, Math.round((spec.atoms.L[i] < 0 ? S.thick * 10 : spec.atoms.L[i]) / spec.period));
  });
  ok(st.count === expect, `SrTiO₃ atoms = Σ columns × round(t/period) = ${expect} (${st.count})`);
  ok(near(st.box[2], S.thick * 10, spec.period), `SrTiO₃ stack ${(st.box[2] / 10).toFixed(2)} nm ≈ the 15 nm slab`);
  ok(st.formula === '≈ SrTiO₃', `formula ${st.formula}`);
  const sr = st.species.find((s) => s.sym === 'Sr').count, o = st.species.find((s) => s.sym === 'O').count;
  ok(near(o / sr, 3, 0.15), `O : Sr = ${(o / sr).toFixed(2)} ≈ 3`);
}
{
  const S = stateFor('gr'), st = ST.buildStructure(S, new Sim(S));
  const zs = []; for (let i = 0; i < st.count; i++) if (st.species[st.el[i]].sym === 'C') zs.push(st.pos[3 * i + 2]);
  const levels = [...new Set(zs.map((z) => z.toFixed(2)))].map(Number).sort((a, b) => a - b), gaps = levels.slice(1).map((z, i) => z - levels[i]);
  ok(levels.length >= 1 && gaps.every((g) => near(g, 3.35, 0.05)), `graphene: ${levels.length} atomic plane(s), ${gaps.length ? `spaced ${gaps.map((g) => g.toFixed(2)).join(', ')} Å (bilayer patches)` : 'monolayer'}`);
  ok(st.formula.startsWith('C') && st.formula.includes('+ Si'), `graphene formula ${st.formula}`);
}
{
  const S = stateFor('bio'), st = ST.buildStructure(S, new Sim(S));
  ok(st.shells.some((s) => s.label === 'ferritin shell') && st.shells.some((s) => s.label === 'ferrihydrite core') && st.shells.some((s) => s.label === 'lipid vesicle'), 'proteins in ice: ferritin shells with cores and the vesicle');
  const S2 = stateFor('hesi'), st2 = ST.buildStructure(S2, new Sim(S2));
  ok(st2.shells.length > 0 && st2.shells.every((s) => s.label === 'He bubble / void'), `He in Si: ${st2.shells.length} bubbles drawn`);
  // no atom sits inside a drawn bubble
  let inside = 0;
  for (let i = 0; i < st2.count; i += 7) for (const b of st2.shells) { const d = Math.hypot(st2.pos[3 * i] - b.x, st2.pos[3 * i + 1] - b.y, st2.pos[3 * i + 2] - b.z); if (d < b.R - 0.5) inside++; }
  ok(inside === 0, 'He in Si: the voids are empty of Si atoms');
}
{
  const S = stateFor('sto', 'ltem'), st = ST.buildStructure(S, new Sim(S));
  const R = st.slab.w / 2; let out = 0;
  for (let i = 0; i < st.arrows.n; i++) if (Math.hypot(st.arrows.pos[3 * i], st.arrows.pos[3 * i + 1]) > R + st.arrows.len) out++;
  ok(st.kind === 'magnetic' && st.arrows.n > 50 && out === 0, `Lorentz vortex disc: ${st.arrows.n} magnetization arrows, all on the disc`);
}

// ---------------------------------------------------------------- thickness along the beam, and the footprint
{
  const S = stateFor('sto'), sim = new Sim(S);
  const flat = ST.beamThickness(S, sim);
  S.tiltX = 25; S.tiltY = 10;
  const t = ST.beamThickness(S, sim), want = (S.thick * 10) / (Math.cos(25 * Math.PI / 180) * Math.cos(10 * Math.PI / 180));
  ok(near(flat.t_A, 150, 1e-9) && near(t.t_A, want, 1e-6), `tilt α 25°, β 10°: t = ${(t.t_A / 10).toFixed(3)} nm = 15/(cos α cos β)`);
  ok(near(t.tau / flat.tau, want / 150, 1e-9), 't/λ scales the same way');
  const fp = footprintFor(S, sim);
  ok(near(fp.specimen.thickness_A, t.t_A, 1e-9) && near(fp.specimen.tau, t.tau, 1e-12), 'footprint.js uses the same thickness and t/λ');
}

// ---------------------------------------------------------------- CIF and XYZ
{
  const cif = ST.fromCIFText(readFileSync(join(HERE, 'nacl.cif'), 'utf8'), 'nacl.cif');
  const na = cif.sym.filter((s) => s === 'Na').length, cl = cif.sym.filter((s) => s === 'Cl').length;
  ok(cif.sym.length === 8 && na === 4 && cl === 4, `NaCl CIF: F-centring expands 2 sites to ${na} Na + ${cl} Cl`);
  const c = ST.checkStructure(cif);
  ok(near(c.min_distance_A, 5.6402 / 2, 1e-3), `NaCl nearest neighbour ${c.min_distance_A.toFixed(4)} Å = a/2`);
  const sc = ST.supercell(cif, 2, 2, 2);
  ok(sc.sym.length === 64 && near(ST.bounds(sc).size[0], 5.6402 * 1.5, 1e-3), `supercell 2×2×2: 64 atoms, ${ST.bounds(sc).size[0].toFixed(3)} Å across atom centres`);
  const z = ST.alignZone(ST.clone(cif), [1, 1, 0]);
  const d110 = [0, 1, 2].map((k) => z.cell[0][k] + z.cell[1][k]);
  ok(near(d110[0], 0, 1e-9) && near(d110[1], 0, 1e-9) && d110[2] > 0, `align [110] to the beam: a + b → (${d110.map((v) => v.toFixed(3)).join(', ')})`);
  const gr = ST.fromCIFText(readFileSync(join(HERE, 'graphite-hex.cif'), 'utf8'));
  ok(gr.sym.length === 4 && near(Math.hypot(...gr.cell[1]), 2.464, 1e-9) && near(gr.cell[1][0], -1.232, 1e-3), `hexagonal CIF (γ = 120°): 4 atoms, b = (${gr.cell[1].map((v) => v.toFixed(3)).join(', ')})`);
  let threw = false; try { ST.fromCIFText('data_x\n_cell_length_a 3'); } catch { threw = true; }
  ok(threw, 'a CIF without the cell is rejected');
}
{
  const rod = ST.center(ST.fromXYZText(readFileSync(join(HERE, 'si-rod.xyz'), 'utf8'), 'si-rod.xyz'));
  const c0 = ST.checkStructure(rod);
  ok(c0.atoms === 1408 && near(c0.min_distance_A, 5.431 * Math.sqrt(3) / 4, 1e-3), `Si rod: 1408 atoms, bond ${c0.min_distance_A.toFixed(4)} Å`);
  // stand it on end: the check calls it misoriented, and principal-axis alignment lays it down again
  const up = ST.clone(rod); for (let k = 0; k < up.sym.length; k++) { const x = up.P3[3 * k]; up.P3[3 * k] = up.P3[3 * k + 2]; up.P3[3 * k + 2] = x; }
  ok(ST.checkStructure(up).issues.some((i) => /misoriented/.test(i.text)), 'a rod along the beam is flagged as misoriented');
  ST.alignPrincipal(up);
  const b = ST.bounds(up).size;
  ok(b[0] > b[1] && b[1] >= b[2] - 1e-6 && !ST.checkStructure(up).issues.some((i) => /misoriented/.test(i.text)), `principal axes: ${b.map((v) => (v / 10).toFixed(2)).join(' × ')} nm, longest along x`);
  const dup = ST.clone(rod); dup.sym.push('Si'); dup.P3 = Float64Array.from([...dup.P3, dup.P3[0] + 0.1, dup.P3[1], dup.P3[2]]);
  ok(ST.checkStructure(dup).issues.some((i) => /closer than 0.5/.test(i.text)), 'a duplicated site is reported');
  const cr = ST.cropLateral(rod, 10);
  ok(cr.sym.length < rod.sym.length && [...Array(cr.sym.length).keys()].every((k) => Math.hypot(cr.P3[3 * k], cr.P3[3 * k + 1]) <= 10), `crop to 1 nm: ${cr.sym.length} atoms, all within the radius`);
  const cif = ST.supercell(ST.fromCIFText(readFileSync(join(HERE, 'nacl.cif'), 'utf8'), 'nacl.cif'), 2, 1, 1);
  const back = ST.fromXYZText(ST.toXYZText(cif), 'back.xyz');
  let maxd = 0; for (let k = 0; k < cif.P3.length; k++) maxd = Math.max(maxd, Math.abs(cif.P3[k] - back.P3[k]));
  ok(back.sym.length === cif.sym.length && maxd < 1e-4 && back.cell && near(back.cell[0][0], 2 * 5.6402, 1e-4), `export .xyz round trip: ${back.sym.length} atoms within ${maxd.toExponential(1)} Å, lattice kept (extended XYZ)`);
  const v = ST.structureView(cif);
  ok(v.count === cif.sym.length && v.formula === 'NaCl', `preview view: ${v.count} atoms, formula ${v.formula}`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
