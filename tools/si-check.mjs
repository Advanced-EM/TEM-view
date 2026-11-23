// Spectrum-image acquisition (specimage.js) for EDS and EELS: the plan (time, dose, size), counts that scale with
// dwell and current, element maps that follow the specimen, EELS background subtraction, detector saturation, the
// Ripple export, collectData, the footprint estimate, sessions and scripts.
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import * as SI from '../js/specimage.js';
import { collectData } from '../js/export.js';
import { footprintFor } from '../js/footprint.js';
import { toSession, readSession } from '../js/session.js';
import { runOpState } from '../js/ops.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };
const corr = (a, b) => { const n = a.length, ma = sum(a) / n, mb = sum(b) / n; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; } return ab / Math.sqrt(aa * bb || 1); };
const mk = (o) => { const S = defaultState(); Object.assign(S, { spec: 'sto', siN: 16 }, o); const sim = new Sim(S); sim.update(0.05); return { S, sim }; };

// 1. the plan
{
  const { sim } = mk({ mode: 'eds', siN: 32, siDwell: 10, siCurrent: 200 }), p = SI.siPlan(sim);
  ok(p.n === 32 && p.nch === 2048 && Math.abs(p.total_s - 32 * (32 * 0.01 + 0.001)) < 1e-9 && Math.abs(p.electrons - 200e-12 * 0.01 / 1.602e-19) < 1, `EDS plan: 32 × 32 × 2048, ${p.total_s.toFixed(2)} s, ${p.electrons.toExponential(2)} e⁻ and ${p.dosePerPx.toPrecision(3)} e⁻/Å² per pixel, ${(p.bytes / 2 ** 20).toFixed(0)} MB`);
}
// 2. EDS: counts ∝ dwell × current; the maps follow the specimen's own element maps
{
  const run = (o) => { const { sim } = mk({ mode: 'eds', ...o }); return { sim, st: SI.siRun(sim) }; };
  const a = run({ siDwell: 10, siCurrent: 200 }), b = run({ siDwell: 20, siCurrent: 200 }), c = run({ siDwell: 10, siCurrent: 400 });
  const ta = sum(SI.meanSpectrum(a.st)), tb = sum(SI.meanSpectrum(b.st)), tc = sum(SI.meanSpectrum(c.st));
  ok(Math.abs(tb / ta - 2) < 0.05 && Math.abs(tc / ta - 2) < 0.05, `EDS counts per pixel ${ta.toFixed(0)}: ×${(tb / ta).toFixed(2)} at twice the dwell, ×${(tc / ta).toFixed(2)} at twice the current`);
  const S = a.sim.S, n = a.st.plan.n, si = a.sim.si, N = si.n, bk = N / n, model = (sym) => { const m = new Float32Array(n * n); for (const e of si.els) if (e.sym === sym) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m[Math.floor(y / bk) * n + Math.floor(x / bk)] += e.map[y * N + x]; return m; };
  const rs = ['Sr', 'Ti'].map((sym) => { const w = SI.edsWindow(S, sym); return [sym, corr(SI.windowMap(b.st, w[0], w[1], { bgsub: true }), model(sym))]; });
  ok(rs.every(([, r]) => r > 0.5), `element maps follow the specimen: ${rs.map(([s, r]) => `${s} r = ${r.toFixed(2)}`).join(', ')}`);
}
// 3. EELS: the edge map after background subtraction; long dwell saturates the zero loss
{
  const { sim } = mk({ mode: 'eels', siDwell: 50, eelsOffset: 400, eelsDisp: 0.25 }), st = SI.siRun(sim);
  const raw = SI.windowMap(st, 455, 475), net = SI.windowMap(st, 455, 475, { bgsub: true }), mr = sum(raw) / raw.length, mn = sum(net) / net.length;
  ok(st.plan.nch === 1024 && mn > 0 && mn < 0.8 * mr, `EELS 16 × 16 × 1024 (${st.plan.E0}–${st.plan.E0 + st.plan.nch * st.plan.dE} eV): Ti L₂,₃ window ${mr.toFixed(0)} counts, ${mn.toFixed(0)} after the power-law background`);
  const z = mk({ mode: 'eels', siDwell: 200, eelsOffset: -10, eelsDisp: 0.1, eelsCurrent: 500 }), sz = SI.siRun(z.sim);
  ok(sz.sat > 0.9 * 16 * 16, `the zero loss saturates the detector at 200 ms and 500 pA: ${sz.sat} of 256 pixels`);
}
// 4. export, collectData, footprint
{
  const { S, sim } = mk({ mode: 'eds', siDwell: 5 }); sim.startSI({ instant: true });
  const files = SI.rippleFiles(sim.siAcq, 'x'), head = new TextDecoder().decode(files[0].bytes), kv = Object.fromEntries(head.split('\n').filter((l) => l.includes('\t') && !l.startsWith('key')).map((l) => l.split('\t')));
  ok(+kv.width === 16 && +kv.height === 16 && +kv.depth === 2048 && kv['record-by'] === 'vector' && files[1].bytes.length === 16 * 16 * 2048 * 4 && kv.signal === 'EDS_TEM', `Ripple export: .rpl header (16 × 16 × 2048, float, record-by vector, ${kv['depth-units']}) and ${(files[1].bytes.length / 2 ** 20).toFixed(1)} MB .raw`);
  S.siView = 'si';
  const d = collectData(sim, S);
  ok(d.arrays.spectrum_image?.shape?.join() === '16,16,2048' && d.meta.calibration.hyperspy.axes.length === 3, `collectData: spectrum_image [${d.arrays.spectrum_image?.shape}] with HyperSpy axes`);
  const fp = footprintFor(S, sim);
  ok(fp.raw.bytes === 16 * 16 * 2048 * 2 && fp.plan.scan === 16, `footprint follows the spectrum image: ${fp.plan.scan}² × ${fp.plan.channels} channels, ${(fp.raw.bytes / 2 ** 20).toFixed(1)} MB raw`);
}
// 5. sessions, scripts, specimen change
{
  const { S, sim } = mk({ mode: 'eels', siN: 64, siDwell: 7.5, siView: 'si' }), back = readSession(JSON.parse(JSON.stringify(toSession(S)))).state;
  ok(back.siN === 64 && back.siDwell === 7.5 && back.siView === 'si', 'the spectrum-image settings save with the session');
  const T = mk({ mode: 'eds', siDwell: 2 });
  ok(runOpState(T.S, T.sim, { op: 'action', v: 'collect' }) && T.sim.siAcq?.done && T.S.siView === 'si', 'action collect in EDS records a spectrum image');
  T.sim.invalidate('spec');
  ok(T.sim.siAcq === null, 'a new specimen clears the recorded spectrum image');
  void sim;
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
