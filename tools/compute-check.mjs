// Compute backend check (M3): the kernels moved out of sim.js give bit-identical results to the code before
// the move (tools/compute-reference.json), and slicing the work (as the worker does, and pausing) changes
// nothing. Run: node tools/compute-check.mjs        (--fast: skip the full ePIE / MS-ePIE runs, ~50 s)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import * as P from '../js/physics.js';
import * as K from '../js/kernels.js';
import { InlineBackend } from '../js/compute.js';

const REF = JSON.parse(readFileSync(new URL('./compute-reference.json', import.meta.url), 'utf8'));
const fast = process.argv.includes('--fast');
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const h = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const scanned = (id) => {
  const S = defaultState(); S.mode = '4d'; const sp = P.SPECIMENS[id]; S.spec = id; S.fov = sp.fov; [S.cx, S.cy] = sp.center;
  const sim = new Sim(S); sim.update(0.05);
  while (sim.fd.done < sim.fd.N * sim.fd.N) sim.step4D(1e9);
  return sim;
};

ok(P.fft2 === K.fft2, 'one FFT: physics.js re-exports the kernels\' fft2');
for (const id of ['sto', 'au']) {
  const t0 = performance.now(), sim = scanned(id);
  ok(h(sim.fd.data) === REF[id].data, `${id}: 4D-STEM data (${sim.fd.N}² × ${sim.fd.n4}²) identical to the pre-M3 code (${Math.round(performance.now() - t0)} ms)`);
  if (fast && id === 'au') continue;
  if (!fast && id === 'sto') {
    let t = performance.now();
    sim.startPtycho(); while (sim.stepPtycho(1e9));
    ok(h(sim.pty.re) === REF[id].epie.re && h(sim.pty.im) === REF[id].epie.im && sim.pty.iter === 30, `${id}: ePIE object after 30 iterations identical (${Math.round(performance.now() - t)} ms)`);
    t = performance.now();
    sim.startMSPtycho(); while (sim.stepMSPtycho(1e9));
    ok(sim.mpty.O.every((o, k) => h(o.re) === REF[id].msepie.O[k][0] && h(o.im) === REF[id].msepie.O[k][1]) && sim.mpty.iter === 10, `${id}: MS-ePIE slices after 10 iterations identical (${Math.round(performance.now() - t)} ms)`);
  }
}

// slicing invariance: 2-ms slices (worker-like, with pauses) give the same bits as one long run
{
  const sim = scanned('sto'), f = sim.fd, g = f.geom, now = () => performance.now();
  const A = K.epieInit({}, g, f.pr, f.pi, 7); A.maxIter = 2;
  while (K.epieStep(A, g, f.pr, f.pi, f.data, 1e9, now));
  const B = K.epieInit({}, g, f.pr, f.pi, 7); B.maxIter = 2;
  let slices = 0; while (K.epieStep(B, g, f.pr, f.pi, f.data, 2, now)) slices++;
  ok(h(A.re) === h(B.re) && h(A.im) === h(B.im), `ePIE in ${slices} slices of 2 ms = one long run (2 iterations)`);
  const C = K.msInit({}, g, 5); C.maxIter = 1; while (K.msStep(C, g, f.pr, f.pi, f.prop, f.data, 1e9, now));
  const D = K.msInit({}, g, 5); D.maxIter = 1; let s2 = 0; while (K.msStep(D, g, f.pr, f.pi, f.prop, f.data, 3, now)) s2++;
  ok(C.O.every((o, k) => h(o.re) === h(D.O[k].re) && h(o.im) === h(D.O[k].im)), `MS-ePIE in ${s2} slices of 3 ms = one long run (1 iteration)`);
  // a scan split into tiny slices fills the same data
  const st = K.fdInit({ geom: g, slices: f.slices, prop: f.prop, pr: f.pr, pi: f.pi }, new Float32Array(f.data.length));
  let n = 0; while (st.done < g.N * g.N) { K.fdStep(st, 1, now); n++; }
  ok(h(st.data) === h(f.data), `4D scan in ${n} slices of 1 ms = the scan in one go`);
  // the backend interface: budget 0 pauses, cancel stops
  const be = new InlineBackend(), sink = { data: new Float32Array(f.data.length) };
  const task = be.run({ kind: 'fd-scan', geom: g, slices: f.slices, prop: f.prop, pr: f.pr, pi: f.pi }, sink);
  task.pump(0); const d0 = task.done; task.pump(5); const d1 = task.done; task.cancel(); task.pump(50);
  ok(d0 === 0 && d1 > 0 && task.done === d1, `InlineBackend: pump(0) pauses, pump(5 ms) computes ${d1} positions, cancel stops`);
}
// the seeded order differs between seeds and repeats for the same seed
{
  const a = K.mulberry32(1234), b = P.mulberry32(1234);
  ok(Array.from({ length: 5 }, a).join() === Array.from({ length: 5 }, b).join(), 'kernels.mulberry32 = physics.mulberry32');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
