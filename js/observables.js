// What an in situ experiment can measure, frame by frame: one registry for the exhibit's experiment designer, the
// movie recorder (each frame's metadata), the export and tools/insitu/experiments.mjs. Each observable says when it
// applies (environment, specimen, technique) and how to read it from the simulator.
import { SPECIMENS } from './physics.js';
import * as ENV from './environment.js';

const img = (sim, S) => (S.mode === 'tem' ? sim.tem?.img : S.mode === 'stem' ? sim.stemImg?.img : null);
const contrast = (a) => { if (!a) return null; let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / a.length) / m; };
const liquid = (S) => S.envCell === 'liquid', gas = (S) => S.envCell === 'gas', bias = (S) => !!S.bsOn;

export const OBSERVABLES = {
  T_K: { label: 'Specimen temperature', unit: 'K', applies: () => true, get: (sim) => sim.temp() },
  drift_A: { label: 'Drift since the start', unit: 'Å', applies: () => true, get: (sim) => (sim.movie ? Math.hypot(sim.driftPos[0] - sim.movie.drift0[0], sim.driftPos[1] - sim.movie.drift0[1]) : 0) },
  contrast: { label: 'Image contrast (σ/mean)', unit: '', applies: (S) => S.mode === 'tem' || S.mode === 'stem', get: (sim, S) => contrast(img(sim, S)) },
  radius_A: { label: 'Gold particle radius', unit: 'Å', applies: (S) => S.spec === 'au' && (liquid(S) || gas(S)), get: (sim) => 21 + (sim.liq?.grow ?? 0) + (sim.gasSt?.sinter ?? 0) },
  // liquid
  bubbles: { label: 'Bubbles in view', unit: '', applies: liquid, get: (sim) => sim.liq?.bubbles.length ?? 0 },
  h2_beam_uM: { label: 'H₂ in the beam', unit: 'µM', applies: liquid, get: (sim) => 1e6 * (sim.liq?.h2 ?? 0) },
  h2_cell_uM: { label: 'H₂ in the rest of the cell', unit: 'µM', applies: (S) => liquid(S) && S.lcClass !== 'graphene', get: (sim) => 1e6 * (sim.liq?.res ?? 0) },
  pH: { label: 'pH in the beam', unit: '', applies: liquid, get: (sim) => sim.liq?.pH ?? 7 },
  supersat: { label: 'Reduced metal relative to nucleation', unit: '', applies: (S) => liquid(S) && S.lcPrecursor, get: (sim) => sim.liq?.supersat ?? 0 },
  nucleated_s: { label: 'Nucleation time', unit: 's', applies: (S) => liquid(S) && S.lcPrecursor, get: (sim) => sim.liq?.nucleated ?? null },
  // gas
  transmitted: { label: 'Contrast kept through the gas', unit: '', applies: gas, get: (sim, S) => ENV.gasNow(S, sim.temp())?.col.transmitted ?? 1 },
  sinter_A: { label: 'Sintering (radius gained)', unit: 'Å', applies: (S) => gas(S) && S.spec === 'au', get: (sim) => sim.gasSt?.sinter ?? 0 },
  xi: { label: 'Reduction of SrTiO₃ (ξ)', unit: '', applies: (S) => gas(S) && S.spec === 'sto', get: (sim) => sim.gasSt?.xi ?? 0 },
  // heating: helium bubbles in silicon
  cavities: { label: 'Cavities in view', unit: '', applies: (S) => S.spec === 'hesi', get: () => SPECIMENS.hesi.bubbles().length },
  cavity_d_nm: { label: 'Mean cavity diameter', unit: 'nm', applies: (S) => S.spec === 'hesi', get: () => { const b = SPECIMENS.hesi.bubbles(); return b.length ? (2 * b.reduce((v, q) => v + q.r, 0)) / b.length / 10 : 0; } },
  he_density: { label: 'Helium density in the bubbles', unit: 'atoms/nm³', applies: (S) => S.spec === 'hesi', get: () => SPECIMENS.hesi.heDensity() },
  // biasing
  V_specimen: { label: 'Voltage on the specimen', unit: 'V', applies: bias, get: (sim) => sim.biasSt?.op?.Vspec ?? 0 },
  I_uA: { label: 'Current', unit: 'µA', applies: bias, get: (sim) => 1e6 * (sim.biasSt?.op?.I ?? 0) },
  joule_K: { label: 'Joule heating', unit: 'K', applies: bias, get: (sim) => sim.biasSt?.dT ?? 0 },
  echem_A_s: { label: 'Deposition (+) or stripping (−) rate', unit: 'Å/s', applies: (S) => bias(S) && liquid(S), get: (sim) => sim.biasSt?.echem?.rate ?? 0 },
  phase_grad: { label: 'Phase gradient at the beam', unit: 'mrad/nm', applies: (S) => bias(S) && S.mode === 'oah', get: (sim) => Math.hypot(...sim.biasGrad()) * 1e4 },
};
export const applicable = (S) => Object.keys(OBSERVABLES).filter((k) => OBSERVABLES[k].applies(S));
// a sensible default selection: what the environment is about
export function suggested(S) {
  const a = applicable(S), want = liquid(S) ? (S.lcPrecursor ? ['radius_A', 'supersat', 'nucleated_s', 'bubbles'] : ['bubbles', 'h2_beam_uM', 'h2_cell_uM', 'pH']) : gas(S) ? ['T_K', 'transmitted', 'sinter_A', 'xi'] : S.spec === 'hesi' ? ['T_K', 'cavities', 'cavity_d_nm', 'he_density'] : ['T_K', 'drift_A'];
  if (bias(S)) want.push('V_specimen', 'I_uA', 'echem_A_s', 'phase_grad');
  return want.filter((k) => a.includes(k));
}
export const read = (ids, sim, S) => Object.fromEntries(ids.filter((k) => OBSERVABLES[k]?.applies(S)).map((k) => { const v = OBSERVABLES[k].get(sim, S); return [k, v == null ? null : +(+v).toPrecision(6)]; }));
