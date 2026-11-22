// Kinetics on documented parameters (kinetics.js): every parameter has a unit, an uncertainty, a source and a label;
// the radiolysis network's integrator reproduces an analytic solution, conserves charge, and gives the published
// behaviour (H₂ in proportion to the dose rate where diffusion clears the beam, acidification, H₂O₂ above H₂).
import * as K from '../js/kinetics.js';
import { doseRateGy } from '../js/liquid.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

const bad = Object.entries(K.P).filter(([, v]) => !(typeof v.v === 'number' && v.unit !== undefined && v.unc >= 0 && ['literature', 'calibrated', 'trend'].includes(v.label) && v.src));
ok(!bad.length, `${Object.keys(K.P).length} parameters, each with a value, unit, uncertainty, source and label${bad.length ? `; incomplete: ${bad.map(([k]) => k)}` : ''}`);
const missing = Object.entries(K.PROCESS).flatMap(([n, pr]) => pr.uses.filter((k) => !K.P[k]).map((k) => `${n}:${k}`));
ok(!missing.length, `${Object.keys(K.PROCESS).length} processes, each naming its parameters and a label (${Object.entries(K.PROCESS).map(([n, pr]) => `${n}: ${pr.label}`).join(', ')})`);

// the integrator: hydrated electrons recombining, 1/c = 1/c₀ + 2kt (other reactions negligible at this time scale)
{
  const env = K.envFor(0, { closed: true }), c0 = new Float64Array(K.SPECIES.length), i = K.SPECIES.indexOf('eaq'), h = K.SPECIES.indexOf('H2');
  c0[i] = 1e-4; c0[K.SPECIES.indexOf('Hp')] = 1e-9; c0[K.SPECIES.indexOf('OHm')] = 1e-9;
  const t = 2e-6, c = K.integrate(c0, env, t), want = 1 / (1 / 1e-4 + 2 * 5.5e9 * t);
  ok(Math.abs(c[i] / want - 1) < 0.02 && Math.abs(c[h] / ((1e-4 - c[i]) / 2) - 1) < 0.02, `backward Euler: e⁻aq + e⁻aq → H₂ follows 1/c = 1/c₀ + 2kt (${c[i].toExponential(3)} vs ${want.toExponential(3)} M after 2 µs), one H₂ per two electrons`);
}
// charge balance at steady state
{
  const s = K.steadyState(doseRateGy(10, 200), { bulk: { O2: 2.5e-4 } });
  const q = s.Hp - s.OHm - s.eaq - s.O2m, scale = s.Hp;
  ok(Math.abs(q) / scale < 0.02, `steady state at 10 e⁻/Å²/s is neutral: H⁺ ${s.Hp.toExponential(2)} M against OH⁻ + e⁻aq + O₂⁻ ${(s.OHm + s.eaq + s.O2m).toExponential(2)} M`);
}
// dose-rate scaling where diffusion clears the beam
{
  const a = K.steadyState(doseRateGy(1, 200)).H2, b = K.steadyState(doseRateGy(10, 200)).H2;
  ok(b / a > 7 && b / a < 10, `H₂ in the beam grows nearly in proportion to the dose rate when diffusion clears it (×${(b / a).toFixed(2)} for ×10; OH consumes a little of it)`);
  const lo = K.steadyState(doseRateGy(0.1, 200)), hi = K.steadyState(doseRateGy(100, 200));
  ok(-Math.log10(hi.Hp) < -Math.log10(lo.Hp) && hi.H2O2 > hi.H2, `the water acidifies with dose rate (pH ${(-Math.log10(lo.Hp)).toFixed(1)} → ${(-Math.log10(hi.Hp)).toFixed(1)}) and H₂O₂ exceeds H₂`);
}
// a closed volume accumulates: far more H₂ than in an open beam at the same dose rate
{
  const open = K.steadyState(doseRateGy(1, 200)).H2, closed = K.steadyState(doseRateGy(1, 200), { closed: true }).H2;
  ok(closed > 30 * open, `closed (no diffusion out): ${(1e3 * closed).toFixed(2)} mM H₂ against ${(1e6 * open).toFixed(1)} µM in an open beam at 1 e⁻/Å²/s`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
