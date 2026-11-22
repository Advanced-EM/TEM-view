// Ptychographic tomography preview (M10): the slab projector, the per-tilt MS-ePIE, and the acceptance test: one
// view cannot resolve depth (λ/α² ≫ the object), the fused tilts can: the isolated atom's depth spread falls by more
// than half and the two atoms stacked 8 Å apart along the beam separate. ~40 s.
import * as PT from '../js/ptychotomo.js';
import * as TOMO from '../js/tomo.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const N = 32, K = 4;

// ---- the slab projector
{
  const rnd = (n) => Float32Array.from({ length: n }, () => Math.random());
  const x = rnd(N ** 3), y = Array.from({ length: K }, () => rnd(N * N));
  for (const th of [0, 35, -60]) {
    const Ax = PT.slabProject(x, N, K, th), ATy = PT.slabBack(y, N, K, th, new Float32Array(N ** 3));
    let a = 0, b = 0; Ax.forEach((s, k) => s.forEach((v, i) => (a += v * y[k][i]))); ATy.forEach((v, i) => (b += v * x[i]));
    ok(Math.abs(a - b) / Math.abs(a) < 1e-4, `the slab back-projector is the adjoint of the projector at ${th}° (⟨Ax, y⟩ = ⟨x, Aᵀy⟩ to ${(Math.abs(a - b) / Math.abs(a)).toExponential(1)})`);
    const sum = Ax.reduce((s, t) => s.map((v, i) => v + t[i])), tp = TOMO.project(x, N, th);
    let d = 0, m = 0; for (let i = 0; i < sum.length; i++) { d = Math.max(d, Math.abs(sum[i] - tp[i])); m = Math.max(m, Math.abs(tp[i])); }
    ok(d / m < 1e-4, `the slabs add up to the tomography projection at ${th}°`);
  }
}
// ---- the object
{
  const v = PT.phantom([{ x: 0, y: 0, z: 0, w: 1 }], 64, 0.25), p = TOMO.project(v, 64, 0);
  const pk = Math.max(...p);
  ok(Math.abs(pk - 0.3) < 0.03, `a heavy atom's projected phase peaks at ${pk.toFixed(3)} rad`);
}

// ---- the preview
const t0 = Date.now();
const st = PT.runPT({});
const s = st.stats, secs = (Date.now() - t0) / 1000;
console.log(`   ${st.angles.length} tilts in ${secs.toFixed(0)} s; λ/α² = ${s.depthRes.toFixed(0)} Å for a ${(64 * 0.25).toFixed(0)} Å cube`);
{
  const z = st.data.find((d) => d.th === 0), tr = PT.slabProject(st.truth, st.N, st.p.K, 0);
  const sum = (a) => a.reduce((x, y) => x.map((v, i) => v + y[i]));
  const c = PT.correlation(sum(z.slabs), sum(tr));
  ok(c > 0.7, `MS-ePIE recovers the 0° projected phase from a flat start (correlation ${c.toFixed(3)})`);
}
ok(s.atom.single.z > 3 * s.atom.truth.z, `one view: the isolated atom is smeared along the beam (depth FWHM ${s.atom.single.z.toFixed(1)} Å, the atom ${s.atom.truth.z.toFixed(1)} Å)`);
ok(s.atom.fused.z < 0.5 * s.atom.single.z && s.atom.fused.z < 2 * s.atom.truth.z, `${st.angles.length} tilts fused: depth FWHM ${s.atom.fused.z.toFixed(2)} Å (from ${s.atom.single.z.toFixed(1)} Å; lateral ${s.atom.fused.x.toFixed(2)} Å)`);
ok(s.pair.single < 0.3 && s.pair.fused > 0.5, `the atoms stacked 8 Å apart: not resolved from one view (dip ${Math.round(100 * s.pair.single)} %), resolved after fusion (${Math.round(100 * s.pair.fused)} %)`);
ok(s.corrFused > s.corrSingle, `the fused volume agrees better with the object (${s.corrSingle.toFixed(3)} → ${s.corrFused.toFixed(3)})`);
{
  const avg = PT.fuseAverage(st.data, st.N, st.p.K), w = PT.atomWidths(avg, st.N, st.p.dx, PT.TEST_ATOMS.find((a) => a.tag === 'single'));
  ok(w.z < s.atom.single.z, `averaging the back-projected tilts helps too, less than SIRT (depth FWHM ${w.z.toFixed(1)} Å)`);
}
{
  const one = PT.runPT({ tilts: 1 });
  ok(PT.correlation(one.fused, one.single) > 0.9999, 'with one tilt there is nothing to fuse: the result is the single view');
}
// ---- through the simulator
{
  const S = defaultState(); S.mode = 'ptychotomo'; S.ptTilts = 3; S.ptIters = 3;
  const sim = new Sim(S);
  sim.startPT({ instant: true });
  ok(sim.pt.out.stats?.atom && sim.pt.out.fused?.length === 64 ** 3, `the exhibit's Scan runs the preview (${sim.pt.out.tilts} tilts)`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
