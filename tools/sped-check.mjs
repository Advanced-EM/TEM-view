// SPED check (M5): precession per scan pixel in 4D-STEM, and orientation / phase maps by template matching.
// Precession off leaves the scan bit-identical (tools/compute-reference.json); precessed patterns keep their
// spots at g (descan); the maps find the SrTiO₃ grains, the Si / SiO₂ phases and the graphene hole; precession
// makes the Si spot intensities near-kinematical. Run: node tools/sped-check.mjs  (~1.5 min: three precessed scans)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import * as P from '../js/physics.js';
import * as K from '../js/kernels.js';
import { collectData } from '../js/export.js';
import { analyze } from '../js/analyze.js';

const REF = JSON.parse(readFileSync(new URL('./compute-reference.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const h = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const scan = (id, o = {}) => {
  const S = defaultState(); S.mode = '4d'; const sp = P.SPECIMENS[id]; S.spec = id; S.fov = sp.fov; [S.cx, S.cy] = sp.center; Object.assign(S, o);
  const sim = new Sim(S); sim.update(0.05);
  while (sim.fd.done < sim.fd.N * sim.fd.N) sim.step4D(1e9);
  sim.computeOrientation();
  return sim;
};
const angErr = (a, b, per) => { const d = Math.abs(a - b) % per; return Math.min(d, per - d); };

// precession off: unchanged
{
  const sim = scan('sto');
  ok(h(sim.fd.data) === REF.sto.data, 'precession off: the 4D scan is bit-identical to the pre-M5 data');
}
// precessed patterns: the descan keeps spots at g (graphene: intensities of a 2D crystal barely change)
{
  const a = scan('gr', { cx: 5, cy: -5, alpha4d: 3 }), b = scan('gr', { cx: 5, cy: -5, alpha4d: 3, pedOn: true, pedPhi: 20 });
  const f = a.fd, i = 20 * 40 + 20, n2 = f.n4 * f.n4, pa = f.data.subarray(i * n2, (i + 1) * n2), pb = b.fd.data.subarray(i * n2, (i + 1) * n2);
  const at = (p, x, y) => { let m = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) m = Math.max(m, p[(y + 32 + v) * 64 + x + 32 + u]); return m; };
  const g100 = [[5, 3], [0, 5], [-5, 3], [-5, -3], [0, -5], [5, -3]], ratio = g100.map(([x, y]) => at(pb, x, y) / at(pa, x, y));
  ok(ratio.every((r) => r > 0.6 && r < 1.6), `graphene {100} spots stay at g under precession (precessed / static: ${ratio.map((r) => r.toFixed(2)).join(' ')})`);
  ok(b.fd.ped.steps === 12 && b.fd.vacDiffuse < 0.01, `SPED: ${b.fd.ped.steps} azimuths per pattern; vacuum reference clean (${b.fd.vacDiffuse.toFixed(4)})`);
  // the hole is vacuum, the lattice crystal, ω = 0 (mod 60°)
  const N = 40, fd = b.fd; let inHole = 0, vac = 0, cry = 0, cnt = 0, good = 0;
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const x = b.S.cx + (-fd.scan / 2 + (k + 0.5) * fd.step), y = b.S.cy + (-fd.scan / 2 + (j + 0.5) * fd.step), idx = j * N + k;
    // the probe (rms ≈ 2 Å) still touches the lattice near the edge: count the hole's inner part
    if (Math.hypot(x + 16, y - 8) < 9 - 3.5) { inHole++; if (fd.phase[idx] !== 2) vac++; }
    else if (Math.hypot(x + 16, y - 8) > 9 + 3 && x < 12) { cnt++; if (fd.phase[idx] === 2) { cry++; if (angErr(fd.ori[idx], 0, fd.oriPeriod) <= 2) good++; } }
  }
  ok(fd.oriPeriod === 60 && inHole > 0 && vac / inHole > 0.8 && cry / cnt > 0.9 && good / cry > 0.95, `graphene: period ${fd.oriPeriod}°, hole ${vac}/${inHole} not crystal, lattice ${cry}/${cnt} crystal, ${(100 * good / cry).toFixed(0)} % at ω = 0° ± 2°`);
}
// SrTiO₃ Σ5 bicrystal: two grains at ±18.43°, split at the boundary
for (const ped of [false, true]) {
  const sim = scan('sto', { alpha4d: 3, pedOn: ped, pedPhi: 20 }), f = sim.fd, N = f.N, per = f.oriPeriod;
  const truth = sim.spec.grainRot.map((g) => (((g * 180) / Math.PI) % per + per) % per); // 18.43, 71.57
  let okL = 0, okR = 0, nL = 0, nR = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = sim.S.cx + (-f.scan / 2 + (i + 0.5) * f.step), k = j * N + i;
    if (Math.abs(x) < 4) continue;
    const want = truth[x < 0 ? 0 : 1];
    if (x < 0) { nL++; if (f.phase[k] === 2 && angErr(f.ori[k], want, per) <= 2) okL++; } else { nR++; if (f.phase[k] === 2 && angErr(f.ori[k], want, per) <= 2) okR++; }
  }
  ok(okL / nL > 0.9 && okR / nR > 0.9, `SrTiO₃${ped ? ' (SPED)' : ''}: grain A ${(100 * okL / nL).toFixed(0)} % at ${truth[0].toFixed(1)}° ± 2°, grain B ${(100 * okR / nR).toFixed(0)} % at ${truth[1].toFixed(1)}° ± 2°`);
  if (ped) {
    const a = analyze(sim, sim.S, 'map_orientation');
    const g = a.result.grains.map((x) => x.omega_deg);
    ok(g.length === 2 && truth.every((t) => g.some((x) => angErr(x, t, per) <= 1.5)), `map_orientation: ${a.summary}`);
    const d = collectData(sim, sim.S);
    ok(d.arrays.orientation_deg && d.arrays.phase && d.arrays.reliability && d.meta.calibration.precession_mrad === 20, 'export: orientation, correlation, reliability and phase arrays, with the precession settings');
  }
}
// Si / SiO₂: crystal and amorphous are told apart, the crystal is indexed at ω = 0°
{
  for (const ped of [false, true]) {
    const sim = scan('si', { cx: 0, alpha4d: 3, pedOn: ped, pedPhi: 20 }), f = sim.fd, n = f.N * f.N;
    let cry = 0, am = 0, good = 0;
    for (let i = 0; i < n; i++) { if (f.phase[i] === 2) { cry++; if (angErr(f.ori[i], 0, f.oriPeriod) <= 2) good++; } else if (f.phase[i] === 1) am++; }
    ok(cry / n > 0.25 && am / n > 0.25 && good / cry > 0.9, `Si/SiO₂${ped ? ' (SPED)' : ''}: ${(100 * cry / n).toFixed(0)} % crystal (${(100 * good / cry).toFixed(0)} % at ω = 0° ± 2°), ${(100 * am / n).toFixed(0)} % amorphous`);
  }
}
// precession makes spot intensities kinematical: log I against log F² over the same spots (Si [110], 30 nm)
{
  const pearson = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let s1 = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s1 += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s1 / Math.sqrt(sa * sb); };
  let spots = null; const r = {};
  for (const ped of [true, false]) {
    const S = defaultState(); Object.assign(S, { mode: '4d', spec: 'si', cx: -100, thick: 30, alpha4d: 1.5, pedOn: ped, pedPhi: 20 });
    const sim = new Sim(S); sim.update(0.05); while (sim.fd.done < 840) sim.step4D(1e9);
    const f = sim.fd; spots ??= sim.orientationTemplate().spots;
    const pat = f.data.subarray(820 * 4096, 821 * 4096), meas = [], kin = [];
    for (const sp of spots) { const x = Math.round(sp.gx / f.dk + 32), y = Math.round(sp.gy / f.dk + 32); let m = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) m = Math.max(m, pat[(y + v) * 64 + x + u]); meas.push(Math.log(m + 1e-12)); kin.push(Math.log(sp.w * sp.w)); }
    r[ped] = pearson(meas, kin);
  }
  ok(r.true > r.false + 0.2 && r.true > 0.75, `Si [110] 30 nm, ${spots.length} spots: correlation of log I with log F² ${r.false.toFixed(2)} static → ${r.true.toFixed(2)} SPED`);
}
// the matcher on a synthetic pattern: spots of the template rotated by 23°
{
  const tpl = { spots: [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]].map(([gx, gy]) => ({ gx, gy, w: 1 })), period: 90, step: 1 };
  const n4 = 64, dk = 0.0868, pat = new Float32Array(n4 * n4), c = Math.cos((23 * Math.PI) / 180), s = Math.sin((23 * Math.PI) / 180);
  pat[32 * 64 + 32] = 100;
  for (const sp of tpl.spots) { const x = (sp.gx * c - sp.gy * s) / dk + 32, y = (sp.gx * s + sp.gy * c) / dk + 32; for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const xx = Math.round(x) + u, yy = Math.round(y) + v; pat[yy * 64 + xx] += Math.exp(-((xx - x) ** 2 + (yy - y) ** 2) / 1.2); } }
  const m = K.matchOrientation(pat, n4, dk, tpl);
  ok(Math.abs(m.omega - 23) <= 1 && m.excess > 0.35 && m.reliability > 0.1, `matchOrientation on a synthetic square net at 23°: ω = ${m.omega}°, excess ${m.excess.toFixed(2)}, reliability ${m.reliability.toFixed(2)}`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
