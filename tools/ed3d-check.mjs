// 3D ED / MicroED check (M6). Done criterion: completeness against tilt range matches the analytic expectation
// for a cubic test crystal (Friedel pairs only, flat-Ewald limit: a range Φ records Φ/180° of reciprocal space).
// Run: node tools/ed3d-check.mjs
import * as E from '../js/ed3d.js';
import * as P from '../js/physics.js';
import * as Z from '../js/zone.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { collectData } from '../js/export.js';
import { analyze } from '../js/analyze.js';
import { footprintFor } from '../js/footprint.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const lam = P.wavelength(200), base = { method: 'cred', speed: 1, fps: 10, step: 1, exposure: 0.5, doseRate: 0.01, axis: 23, pedPhi: 20, t: 1500, lam, Dc: Infinity, mosaic: 0.05 };

// a cubic test crystal in a general orientation (CsPbBr₃ pseudocubic cell, [1 2 5] along the beam)
const cr = Z.zoneCryst('cspb', [1, 2, 5]), gMax = 1.25, refl = E.reflections(cr, gMax, 200, 1500);
ok(refl.length > 1000, `test crystal: ${refl.length} reflections out to ${(1 / gMax).toFixed(2)} Å`);

// 1. completeness against tilt range (Friedel): Φ/180°
const rows = [];
let worst = 0;
for (const range of [20, 40, 60, 90, 120, 150, 180]) {
  const s = E.collect(refl, { ...base, start: -range / 2, end: range / 2 });
  const c = E.statistics(refl, s, { merge: 'friedel', gMax }).completeness, cl = E.statistics(refl, s, { merge: 'laue', gMax }).completeness;
  worst = Math.max(worst, Math.abs(c - range / 180));
  rows.push(`${range}°: ${(100 * c).toFixed(1)} % (expected ${(100 * range / 180).toFixed(1)} %), m3̄m ${(100 * cl).toFixed(0)} %`);
  if (cl + 1e-9 < c) ok(false, `cubic Laue merging is at least as complete as Friedel (${range}°)`);
}
ok(worst < 0.03, `completeness vs tilt range = Φ/180° within ${(100 * worst).toFixed(1)} %:\n       ${rows.join('\n       ')}`);

// 2. every recorded crossing is on the Ewald sphere: |k₀ + g(φ)| = 1/λ
{
  const s = E.collect(refl, { ...base, start: -60, end: 60 }), e = [Math.cos(23 * Math.PI / 180), Math.sin(23 * Math.PI / 180), 0];
  let maxErr = 0, n = 0;
  for (const fr of s.frames) for (const o of fr) {
    const g = refl[o.i].v, c = Math.cos(o.phi * Math.PI / 180), sn = Math.sin(o.phi * Math.PI / 180), k = g[0] * e[0] + g[1] * e[1] + g[2] * e[2];
    const x = [e[1] * g[2] - e[2] * g[1], e[2] * g[0] - e[0] * g[2], e[0] * g[1] - e[1] * g[0]], gr = [0, 1, 2].map((j) => g[j] * c + x[j] * sn + e[j] * k * (1 - c));
    const d = Math.hypot(gr[0], gr[1], gr[2] - 1 / lam) * lam - 1; // beam along −z: k₀ = (0, 0, −1/λ), |k₀ + g| with g_z measured towards +z
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(gr[0], gr[1], -1 / lam + gr[2]) * lam - 1)); n++;
  }
  ok(n > 500 && maxErr < 1e-9, `${n} crossings, all on the Ewald sphere (|k₀+g|·λ − 1 ≤ ${maxErr.toExponential(1)})`);
}
// 3. collection methods over 60°: stills leave gaps between steps, precession fills them
{
  const c = (m) => E.statistics(refl, E.collect(refl, { ...base, method: m, start: -30, end: 30 }), { merge: 'friedel', gMax }).completeness;
  const cs = c('step'), cc = c('cred'), cp = c('pedt');
  ok(cs < cc && cp > cs && Math.abs(cp - cc) < 0.08, `60°: stills (1° steps) ${(100 * cs).toFixed(0)} % < continuous ${(100 * cc).toFixed(0)} %; precession stills ${(100 * cp).toFixed(0)} %`);
}
// 4. dose: too little dose is counting-limited, too much destroys a beam-sensitive crystal; a robust one improves
{
  const mapb = E.reflections(Z.zoneCryst('mapb', [1, 2, 5]), 1.1, 200, 1500), o = { ...base, start: -40, end: 40, Dc: 25 };
  const lim = (rate, Dc) => E.statistics(mapb, E.collect(mapb, { ...o, doseRate: rate, Dc }), { merge: 'friedel', gMax: 1.1 }).dLimit ?? Infinity;
  const rates = [0.00002, 0.002, 2], sens = rates.map((r) => lim(r, 25)), rob = rates.map((r) => lim(r, Infinity)), f = (d) => (Number.isFinite(d) ? d.toFixed(2) : '—');
  ok(sens[0] > sens[1] && sens[2] > sens[1], `beam-sensitive (D_c 25 e⁻/Å²), ±40°: ${f(sens[0])} Å at ${rates[0]} e⁻/Å²/s (counting-limited), ${f(sens[1])} Å at ${rates[1]}, ${f(sens[2])} Å at ${rates[2]} (damage-limited)`);
  ok(rob[2] <= rob[1] + 1e-9 && rob[1] <= rob[0] + 1e-9, `robust crystal: ${rob.map(f).join(' → ')} Å with rising dose (never worse)`);
}
// 5. SMV frames round-trip
{
  const s = E.collect(refl, { ...base, start: -5, end: 5 }), img = E.frameImage(refl, s, 3, { W: 128, pix: 0.44, L: 1000, lam, axis: 23, start: -5 });
  const bytes = E.smvFrame(img, 128, { pix: 0.44, L: 1000, lam, oscStart: -5 + 3 * s.plan.wedge, oscRange: s.plan.wedge, axis: 23, exposure: 0.1 }), back = E.parseSMV(bytes);
  let same = true; for (let i = 0; i < img.length; i++) if (back.img[i] !== Math.min(65535, Math.round(img[i]))) { same = false; break; }
  ok(bytes.length === 512 + 128 * 128 * 2 && +back.head.SIZE1 === 128 && Math.abs(+back.head.WAVELENGTH - lam) < 1e-5 && Math.abs(+back.head.OSC_RANGE - s.plan.wedge) < 1e-4 && same, `SMV frame: 512-byte header (SIZE1 ${back.head.SIZE1}, WAVELENGTH ${back.head.WAVELENGTH}, OSC_RANGE ${back.head.OSC_RANGE}), pixels round-trip`);
}
// 6. in the exhibit: the series plays, completeness grows to the planned value, export / footprint / analysis
{
  const S = defaultState(); Object.assign(S, { mode: 'ed3d', spec: 'sto', zone: [1, 2, 5], cx: 0, cy: 0, edStart: -45, edEnd: 45, camL: 600 });
  const sim = new Sim(S); sim.update(0.05);
  const full = sim.ed.full.completeness;
  sim.startED3D();
  const trace = []; let last = -1, mono = true;
  for (let i = 0; i < 400 && sim.ed.running; i++) { sim.update(0.05); const c = sim.ed.stats.completeness; if (c + 1e-12 < last) mono = false; last = c; if (i % 40 === 0) trace.push(c.toFixed(2)); }
  ok(!sim.ed.running && mono && Math.abs(sim.ed.stats.completeness - full) < 1e-12 && Math.abs(sim.edPhi() - 45) < 1e-9, `SrTiO₃ [125], ±45°: completeness grows ${trace.join(' → ')} → ${sim.ed.stats.completeness.toFixed(3)}; goniometer ends at ${sim.edPhi()}°`);
  const d = collectData(sim, S);
  ok(d.arrays.frame && d.arrays.reflections.shape[1] === 6 && d.meta.calibration.frames === sim.ed.series.plan.frames, `export: frame + ${d.arrays.reflections.shape[0]} reflections (h k l I σ d), ${d.meta.calibration.frames} frames`);
  const fp = footprintFor(S, sim);
  ok(fp.raw.bytes === sim.ed.series.plan.frames * 512 * 512 * 2, `footprint: ${sim.ed.series.plan.frames} frames × 512² × 16-bit = ${(fp.raw.bytes / 2 ** 20).toFixed(0)} MB`);
  const a = analyze(sim, S, 'ed3d_stats');
  ok(Math.abs(a.result.completeness - Math.min(1, 90 / 180)) < 0.05, `ed3d_stats: ${a.summary}`);
  // the zone axis sets the crystal orientation on the goniometer
  const S2 = { ...S, zone: [0, 0, 1] }, sim2 = new Sim(S2); sim2.update(0.05);
  ok(sim2.ed.name.includes('[001]') && sim.ed.name.includes('[125]') && sim2.ed.full.completeness !== full, `orientation follows the zone axis (${sim2.ed.name} vs ${sim.ed.name})`);
}

// 7. any structure of atoms (uploaded XYZ): the lattice is found from the atoms; without one, diffuse frames
{
  const ST = await import('../js/structure.js'), fs = await import('node:fs'), L = await import('../js/lattice.js');
  const here = new URL('./structures/', import.meta.url);
  let st = ST.fromCIFText(fs.readFileSync(new URL('nacl.cif', here), 'utf8'), 'nacl.cif'); st = ST.supercell(st, 6, 6, 6); ST.alignZone(st, [1, 2, 5]);
  P.loadXYZ(ST.toXYZText(st), 'nacl-125.xyz');
  const S = defaultState(); Object.assign(S, { mode: 'ed3d', spec: 'xyz', cx: 0, cy: 0, edStart: -45, edEnd: 45, camL: 600 });
  const sim = new Sim(S); sim.update(0.05);
  const e = sim.ed, p = e.lattice?.params;
  ok(p && Math.abs(p.a - 5.6402 / Math.SQRT2) < 0.02 && e.lattice.basis.length === 2 && !e.cubic, `NaCl as XYZ along [125]: lattice found from the atoms (${e.name.split('· ')[1]}, ${e.lattice.basis.length} atoms per cell), Friedel merging`);
  const ds = [...new Set(e.refl.map((R) => (1 / R.g).toFixed(2)))].map(Number).sort((a, b) => b - a);
  ok(Math.abs(ds[0] - 3.26) < 0.01 && Math.abs(ds[1] - 2.82) < 0.01, `NaCl reflections: d = ${ds.slice(0, 4).join(', ')} Å ((111), (200), …)`);
  ok(Math.abs(e.full.completeness - 0.5) < 0.05, `NaCl as XYZ, ±45°: ${(100 * e.full.completeness).toFixed(1)} % complete (Φ/180° = 50 %)`);
  const rod = ST.center(ST.fromXYZText(fs.readFileSync(new URL('si-rod.xyz', here), 'utf8')));
  const lr = L.findLattice(rod.sym, rod.P3);
  ok(lr && Math.abs(lr.params.a - 5.431 / Math.SQRT2) < 0.02 && lr.basis.length === 2, `Si rod: primitive fcc cell a = ${lr?.params.a.toFixed(3)} Å with a 2-atom basis (not the 2.35 Å bond)`);
  // amorphous: random atoms, no lattice → the series shows diffuse frames
  const n = 2000, lines = [String(n), 'random']; let sd = 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) lines.push(`Si ${(rnd() * 30).toFixed(3)} ${(rnd() * 30).toFixed(3)} ${(rnd() * 30).toFixed(3)}`);
  P.loadXYZ(lines.join('\n'), 'amorphous.xyz');
  const S2 = { ...S }, sim2 = new Sim(S2); sim2.update(0.05);
  const img = sim2.edFrame(128); let mx = 0; for (const v of img.arr) mx = Math.max(mx, v);
  const a = analyze(sim2, S2, 'ed3d_stats');
  ok(sim2.ed.diffuse && mx > 0 && a.result.lattice === null, `random atoms: no lattice, diffuse frames (${sim2.ed.series.plan.frames}), ${a.summary}`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
