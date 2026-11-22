// Calibration of the in situ kinetics (insitu-cal.js): the published profile is applied by default and is what a
// refit gives; it reproduces its targets and the check it was not fitted to; the process model agrees with the full
// simulator; a series made with known parameters is fitted back to them; profiles follow the session.
import * as K from '../js/kinetics.js';
import * as C from '../js/insitu-cal.js';
import * as LIQ from '../js/liquid.js';
import { PUBLISHED } from '../js/calibration-published.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { chipState } from '../js/ops.js';
import { toSession, readSession } from '../js/session.js';
import * as GAS from '../js/gas.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

// the default profile
ok(K.CAL.profile === PUBLISHED && K.P.sinter_Ea.label === 'calibrated' && K.P.nuc_c_ag.label === 'calibrated' && K.P.redox_A.label === 'trend', `the published profile is applied on load (${Object.keys(PUBLISHED.params).length} parameters from ${PUBLISHED.datasets.map((d) => d.id).join(', ')}); the others keep their labels`);
ok(K.PROCESS.nucleation.label === 'partly' && K.PROCESS.sintering.label === 'partly' && K.PROCESS.redox.label === 'trend', `process labels follow their parameters: nucleation ${K.PROCESS.nucleation.label} (Ag fitted, Au not), sintering ${K.PROCESS.sintering.label} (the oxygen factor), redox ${K.PROCESS.redox.label}`);
ok(/Woehl/.test(K.P.nuc_c_ag.src) && /Horwath/.test(K.P.sinter_A.src), `calibrated parameters name their dataset (${K.P.sinter_A.src.slice(0, 70)}…)`);

// a refit gives the stored profile (published.js is current)
{
  const { profile } = C.fit(C.PUBLISHED_SETS, { base: null, name: 'check' });
  const off = Object.entries(PUBLISHED.params).filter(([k, e]) => !near(profile.params[k]?.v, e.v, 0.01));
  ok(!off.length, `refitting the published datasets reproduces js/calibration-published.js${off.length ? `; differs: ${off.map(([k]) => k)}` : ''}`);
  const w = profile.fit.report.find((r) => r.id === 'woehl2012'), h = profile.fit.report.find((r) => r.id === 'horwath2022');
  ok(w.targets.every((t) => Math.abs(t.predicted - t.value) < 0.1 * t.sigma), `Woehl 2012 targets: threshold ${w.targets[0].predicted} e⁻/Å²/s (0.5), induction dose ${w.targets[1].predicted} e⁻/Å² (27.8)`);
  const x2 = w.checks.find((c) => c.id === 'dose_x2');
  ok(Math.abs(x2.predicted - x2.value) < x2.sigma, `not fitted: the induction dose at twice the dose rate stays within the measured spread (${x2.predicted} vs 27.8 ± 7.8 e⁻/Å²)`);
  ok(h.targets.every((t) => Math.abs(t.predicted - t.value) < 0.1 * t.sigma), `Horwath 2022 targets: Eₐ ${h.targets[0].predicted} eV, 10 % in 1 h at ${h.targets[1].predicted} K`);
}
// the bracket itself: little change at 700 °C, a clear one at 750 °C (1 h)
{
  const S = defaultState(); Object.assign(S, { envCell: 'gas', gcGas: 'N2', gcP: 1 });
  const dR = (T) => { const st = { xi: 0, sinter: 0 }; GAS.react(st, S, T, 3600); return st.sinter; };
  ok(dR(973) < 2.1 && dR(1023) > 2.1, `gold on a heating chip in 1 h: ΔR ${dR(973).toFixed(2)} Å at 973 K, ${dR(1023).toFixed(2)} Å at 1023 K (10 % of R = 2.1 Å between them)`);
}
// nucleation: nothing below the threshold, a first nucleus after the induction dose above it (full simulator)
{
  const run = (rate, secs) => { const S = defaultState(); S.mode = 'tem'; S.spec = 'au'; S.fov = 40; const sim = new Sim(S); chipState(S, sim, 'envCell', 'liquid'); Object.assign(S, { lcGap: 800, lcPrecursor: true, lcMetal: 'ag', lcRate: rate }); for (let i = 0; i < secs * 4; i++) sim.update(0.25); return sim.liq; };
  const below = run(0.4, 60), above = run(3.37, 20), S = { ...defaultState(), envCell: 'liquid', lcGap: 800, lcPrecursor: true, lcMetal: 'ag', lcRate: 3.37, kV: 200 };
  const want = LIQ.induction(S).t_s;
  ok(below.nucleated == null && below.supersat < 1, `silver at 0.4 e⁻/Å²/s (below the ${LIQ.nucleationThreshold(S).toFixed(2)} threshold): no nucleation in 60 s (reduced metal at ${(100 * below.supersat).toFixed(0)} % of what it takes)`);
  ok(above.nucleated != null && Math.abs(above.nucleated - want) < 0.3, `at 3.37 e⁻/Å²/s the simulator nucleates at ${above.nucleated?.toFixed(2)} s, the model's induction time ${want.toFixed(2)} s (${(want * 3.37).toFixed(1)} e⁻/Å²)`);
}
// the process model against the full simulator: gold coarsening on a ramp in gas
{
  const S = defaultState(); S.mode = 'tem'; S.spec = 'au'; S.fov = 40; const sim = new Sim(S);
  chipState(S, sim, 'holder', 'heat'); chipState(S, sim, 'envCell', 'gas'); Object.assign(S, { gcGas: 'O2', gcP: 500, tempSet: 1350 });
  for (let i = 0; i < 300; i++) sim.update(0.2);
  const tw = C.simulateSeries(S, [60]);
  ok(near(tw[0].sinter_A, sim.gasSt.sinter, 0.02), `process model and simulator agree: ${tw[0].sinter_A.toFixed(3)} vs ${sim.gasSt.sinter.toFixed(3)} Å after 60 s at 1350 K in O₂`);
}
// the user's data: a series made with known parameters, written as CSV, fitted back
{
  const S = defaultState(); Object.assign(S, { spec: 'au', holder: 'heat', envCell: 'gas', gcGeom: 'windowed', gcGas: 'N2', gcP: 100, tempSet: 1000, timeline: [{ key: 'tempSet', t0: 0, t1: 7200, to: 1300 }] });
  const truth = { sinter_A: 2500, sinter_Ea: 1.35 };
  for (const [k, v] of Object.entries(truth)) K.P[k].v = v;
  const times = Array.from({ length: 61 }, (_, i) => i * 120), sim = C.simulateSeries(S, times);
  K.applyProfile(PUBLISHED);
  let seed = 3; const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.1; };
  const csv = ['t_s,T_K,radius_A,radius_A_sd', ...sim.map((r) => `${r.t},${r.T_K.toFixed(2)},${(r.radius_A + noise()).toFixed(4)},0.03`)].join('\n');
  const { rows, columns } = C.parseSeriesCSV(csv);
  const d = C.userDataset(S, { rows, title: 'synthetic: known parameters' });
  ok(columns.includes('T_K') && d.fit.join() === 'sinter_A,sinter_Ea', `a CSV series is read (${rows.length} rows: ${columns.join(', ')}); T_K drives the model, radius_A suggests fitting ${d.fit.join(', ')}`);
  const { profile } = C.fit([d], { name: 'mine' });
  const A = profile.params.sinter_A, E = profile.params.sinter_Ea;
  ok(Math.abs(E.v - truth.sinter_Ea) < 3 * E.unc * E.v + 0.01 && near(A.v, truth.sinter_A, 3 * A.unc + 0.05), `fitted back: Eₐ ${E.v} ± ${(E.unc * E.v).toFixed(3)} eV (true 1.35), A ${A.v} Å/s ± ${(100 * A.unc).toFixed(0)} % (true 2500); reduced χ² ${profile.fit.reduced_chi2}`);
  ok(profile.params.nuc_c_ag?.dataset === 'woehl2012' && profile.datasets.some((x) => x.id === 'mine' && x.kind === 'user'), 'the user profile builds on the published one: their parameters added, the published ones kept with their datasets');
  ok(K.CAL.profile === PUBLISHED, 'fitting leaves the kinetics on the profile they were on');
  // the profile follows the session
  const S2 = defaultState(); S2.calib = 'user'; S2.calibProfile = profile;
  C.syncCalibration(S2);
  ok(K.p('sinter_Ea') === E.v && K.P.sinter_Ea.label === 'calibrated' && /synthetic/.test(K.P.sinter_Ea.src), `calib 'user' applies the session's profile (Eₐ ${K.p('sinter_Ea')} eV, "${K.P.sinter_Ea.src.slice(0, 40)}…")`);
  const back = readSession(JSON.parse(JSON.stringify(toSession(S2)))).state;
  ok(back.calib === 'user' && back.calibProfile?.params?.sinter_Ea?.v === E.v, 'a saved session carries its calibration profile, so the twin reopens as calibrated');
  S2.calib = 'none'; C.syncCalibration(S2);
  ok(K.CAL.profile === null && K.P.sinter_Ea.label === 'trend' && K.p('sinter_Ea') === 1.0, "calib 'none' returns to the uncalibrated defaults");
  S2.calib = 'published'; C.syncCalibration(S2);
  ok(K.CAL.profile === PUBLISHED, "calib 'published' restores the default");
  const tpl = C.templateCSV({ ...S, movDur: 600 });
  ok(/^# TEM-view series template/.test(tpl) && C.parseSeriesCSV(tpl).columns.includes('radius_A'), 'a template CSV for the current conditions parses back');
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
