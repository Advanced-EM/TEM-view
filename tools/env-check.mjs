// The environment registry (M13): the four holders behave as before (every mode's data against a reference made
// before the registry existed; the one deliberate change: the heating holder's ±25° tilt range bounds a 3D ED
// rotation), and window membranes change contrast, the diffraction background and the spectra in every mode.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { collectData } from '../js/export.js';
import { chipState } from '../js/ops.js';
import * as ENV from '../js/environment.js';
import * as SPA from '../js/spa.js';
import { readSession, toSession } from '../js/session.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const root = fileURLToPath(new URL('..', import.meta.url));

// ---- the holders as before: every mode × holder against the reference (tools/env-sig.mjs)
{
  const r = spawnSync(process.execPath, [`${root}tools/env-sig.mjs`, root.replace(/\/$/, '')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const now = JSON.parse(r.stdout), ref = JSON.parse(readFileSync(`${root}tools/env-reference.json`, 'utf8'));
  const diff = Object.keys(ref).filter((k) => JSON.stringify(ref[k]) !== JSON.stringify(now[k]));
  ok(diff.length === 0, `the four holders, without windows, give the reference data in all ${Object.keys(ref).length} mode × holder cases${diff.length ? `; differ: ${diff.join(', ')}` : ''}`);
}
ok(Object.keys(ENV.ENVIRONMENTS).join() === 'room,ln2,lhe,heat' && ENV.ENVIRONMENTS.heat.maxTilt === 25 && ENV.ENVIRONMENTS.ln2.cryo, 'the registry: the four holders, with their tilt ranges and whether they cool');
{
  const S = defaultState(); S.envWin = 'sinx'; S.envWinT = 30; S.holder = 'heat';
  const back = readSession(JSON.parse(JSON.stringify(toSession(S))));
  ok(back.state.envWin === 'sinx' && back.state.envWinT === 30 && back.state.holder === 'heat', 'the windows travel in the session (env block)');
}

// ---- windows in every mode: the same settings with and without 2 × 20 nm SiNₓ
const median = (a) => { const s = Float32Array.from(a.length > 20000 ? a.filter((_, i) => i % Math.ceil(a.length / 20000) === 0) : a).sort(); return s[s.length >> 1]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function run(mode, win, setup, steps = 6) {
  const S = defaultState(); S.mode = mode; S.clarity = 'edu'; setup?.(S);
  const sim = new Sim(S);
  if (win) chipState(S, sim, 'envWin', win);
  for (let i = 0; i < steps; i++) sim.update(0.05);
  return { S, sim, d: collectData(sim, S).arrays };
}
const cmp = (mode, f, what, setup, steps = 6) => { const a = run(mode, null, setup, steps), b = run(mode, 'sinx', setup, steps); const [x, y] = [f(a), f(b)]; return { x, y, a, b, what }; };
const changed = (a, b) => { const u = a.data, v = b.data; let d = 0, m = 0; for (let i = 0; i < u.length; i++) { d = Math.max(d, Math.abs(u[i] - v[i])); m = Math.max(m, Math.abs(u[i])); } return d / (m || 1); };

{ const r = cmp('tem', (q) => { const im = q.d.image.data, mu = mean(im); return Math.sqrt(mean(im.map((v) => (v - mu) ** 2))) / mu; });
  ok(Math.abs(r.y - r.x) / r.x > 0.02, `TEM: image contrast ${r.x.toFixed(3)} → ${r.y.toFixed(3)} (the windows' amorphous phase)`); }
{ const r = cmp('stem', (q) => median(q.d.image.data));
  ok(r.y > r.x * 1.02, `STEM: HAADF background ${r.x.toPrecision(3)} → ${r.y.toPrecision(3)}`); }
{ const r = cmp('diff', (q) => median(q.d.pattern.data));
  ok(r.y > r.x * 1.05, `SAED: diffuse background ${r.x.toPrecision(3)} → ${r.y.toPrecision(3)}`); }
{ const r = cmp('cbed', (q) => median(q.d.pattern.data));
  ok(r.y > r.x, `CBED: background between the disks ${r.x.toPrecision(3)} → ${r.y.toPrecision(3)}`); }
{ const r = cmp('4d', (q) => median(q.d.datacube.data), null, null, 400);
  ok(r.y > r.x, `4D-STEM: diffuse background in the patterns ${r.x.toPrecision(3)} → ${r.y.toPrecision(3)}`); }
{ // the expected spectrum (no counting noise) on gold (no line near Si Kα): net peaks above the nearby continuum
  const bin = (E) => Math.round(E / 0.01), net = (s, E, a, b) => s[bin(E)] - (s[bin(a)] + s[bin(b)]) / 2;
  const r = cmp('eds', (q) => { const s = q.sim.eds.spec; return [net(s, 1.74, 1.6, 1.9), net(s, 0.392, 0.33, 0.45)]; }, null, (S) => { S.spec = 'au'; });
  ok(r.y[0] > 1e-4 && r.y[0] > 10 * Math.abs(r.x[0]) && r.y[1] > 1.8 * r.x[1], `EDS: net Si Kα ${r.x[0].toExponential(1)} → ${r.y[0].toExponential(1)}, net N Kα ${r.x[1].toExponential(1)} → ${r.y[1].toExponential(1)} (the windows' lines)`); }
{ const f = (q) => { q.S.eelsDisp = 0.25; const sp = q.sim.channelSpectrum(380, 0, q.sim.eelsSite()), at = (E) => sp.spec[Math.round((E - sp.E0) / sp.dE)]; return { jump: at(420) / at(395), tau: q.sim.eelsModel(q.sim.eelsSite()).tau }; };
  const r = cmp('eels', f);
  ok(r.y.jump > r.x.jump * 1.02 && r.y.tau > r.x.tau, `EELS: N K edge jump ${r.x.jump.toFixed(3)} → ${r.y.jump.toFixed(3)}; t/λ ${r.x.tau.toFixed(3)} → ${r.y.tau.toFixed(3)}`); }
for (const [mode, arr, steps] of [['ronch', 'pattern', 6], ['oah', 'phase', 6], ['ilh', 'exit_phase', 60]]) {
  const a = run(mode, null, undefined, steps), b = run(mode, 'sinx', undefined, steps), c = changed(a.d[arr], b.d[arr]);
  ok(c > 1e-3, `${mode}: the ${arr.replace('_', ' ')} changes (by up to ${(100 * c).toFixed(0)} % of its range)`);
}
{ const r = cmp('ltem', (q) => mean(q.d.image.data)); ok(r.y < r.x * 0.99, `Lorentz TEM: intensity ${r.x.toPrecision(3)} → ${r.y.toPrecision(3)} (energy loss in the windows, filtered)`); }
{ const r = cmp('lstem', (q) => mean(q.d.dpc_sum.data)); ok(r.y < r.x, `Lorentz STEM: DPC sum ${r.x.toPrecision(3)} → ${r.y.toPrecision(3)}`); }
{ const r = cmp('ed3d', (q) => median(q.d.frame.data), null, (S) => { S.spec = 'sto'; }, 10);
  ok(r.y > r.x, `3D ED: diffuse background in the frames ${r.x.toPrecision(3)} → ${r.y.toPrecision(3)}`); }
{ // tomography: a flat window is thicker in projection at high tilt (∝ 1/cos θ)
  const go = (win) => { const S = defaultState(); S.mode = 'tomo'; S.tomoPhantom = 'beads'; S.tomoN = 64; S.tomoMax = 60; S.tomoStep = 10; S.tomoDose = 1e9; const sim = new Sim(S); if (win) chipState(S, sim, 'envWin', win); sim.startTomo({ instant: true }); const T = sim.tomo; return T.ser.proj.map((p) => median(p)); };
  const a = go(null), b = go('sinx'), d0 = b[Math.floor(b.length / 2)] - a[Math.floor(a.length / 2)], d60 = b[0] - a[0];
  ok(d0 > 0 && Math.abs(d60 / d0 - 2) < 0.15, `tomography: the windows add a HAADF background that doubles from 0° to 60° (×${(d60 / d0).toFixed(2)}; 1/cos 60° = 2)`); }
{ // cryo-EM: windows add loss and structural noise to the micrographs
  const mic = (window) => { const st = SPA.spaInit({ count: 0, stopAfter: 'pick', window }); SPA.spaStep(st); return { nPix: st.nPix, sd: Math.sqrt(mean(st.mic.img.map((v) => v * v))) }; };
  const a = mic(null), b = mic({ t: 400, dens: 0.096, zeff: 10.4 });
  ok(b.nPix < a.nPix && b.sd > a.sd, `cryo-EM SPA: electrons per pixel ${a.nPix.toFixed(0)} → ${b.nPix.toFixed(0)}, micrograph rms ${a.sd.toFixed(4)} → ${b.sd.toFixed(4)}`); }
// ---- tilt limits
{
  const S = defaultState(); S.mode = 'tomo'; S.tomoMax = 70; const sim = new Sim(S);
  chipState(S, sim, 'holder', 'heat');
  ok(S.tomoMax === 25 && sim.tomoParams().max === 25, 'the heating holder tilts to ±25°: the tomography range follows (a larger missing wedge)');
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
