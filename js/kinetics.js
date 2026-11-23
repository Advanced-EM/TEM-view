// Kinetics on documented parameters: every constant the in situ processes use, with its unit, uncertainty, source and
// a confidence label, and the water-radiolysis reaction network that drives the liquid cell.
//
// Labels:
//   literature  a published value (rate constants, yields, diffusion coefficients, solubilities); not yet checked
//               against in situ TEM data in this simulator
//   calibrated  fitted to in situ data by insitu-cal.js: a calibration profile names the dataset (a published series,
//               or the user's own measurements) and replaces the value and its uncertainty
//   trend       chosen to reproduce a published trend; the value itself is a placeholder until calibrated
//
// Calibration profiles (temview-calibration/1, insitu-cal.js): the published one (calibration-published.js) is
// applied when this module loads; applyProfile() switches to another (the user's own) or back, resetCalibration()
// returns to the defaults below.
//
// Radiolysis (after Schneider et al. 2014, J. Phys. Chem. C 118, 22373): the beam deposits D Gy/s in the water; each
// species i is made at G_i molecules per 100 eV (R_i = G_i · 1.036·10⁻⁷ mol/J · D, in M/s for 1 kg/L), reacts by mass
// action (rate constants from the Buxton et al. 1988 compilation) and leaves the irradiated disc of radius r_b by
// diffusion, k_out = D_i (2.405/r_b)², towards the surrounding liquid. The stiff equations are integrated implicitly
// (backward Euler, Newton) to steady state.

import { PUBLISHED } from './calibration-published.js';

export const P = {
  // --- radiolysis (low-LET primary yields, molecules / 100 eV)
  G_eaq: { v: 2.6, unit: '/100 eV', unc: 0.1, label: 'literature', src: 'Buxton (low-LET primary yields)' },
  G_H: { v: 0.6, unit: '/100 eV', unc: 0.15, label: 'literature', src: 'Buxton (low-LET primary yields)' },
  G_OH: { v: 2.7, unit: '/100 eV', unc: 0.1, label: 'literature', src: 'Buxton (low-LET primary yields)' },
  G_H2: { v: 0.45, unit: '/100 eV', unc: 0.1, label: 'literature', src: 'Buxton (low-LET primary yields)' },
  G_H2O2: { v: 0.7, unit: '/100 eV', unc: 0.1, label: 'literature', src: 'Buxton (low-LET primary yields)' },
  G_Hp: { v: 3.1, unit: '/100 eV', unc: 0.1, label: 'literature', src: 'Buxton (low-LET primary yields)' },
  G_OHm: { v: 0.5, unit: '/100 eV', unc: 0.2, label: 'literature', src: 'charge balance with G(e⁻aq) and G(H⁺)' },
  // diffusion coefficients in water at 25 °C (m²/s)
  D_eaq: { v: 4.9e-9, unit: 'm²/s', unc: 0.1, label: 'literature', src: 'Schneider et al. 2014, Table 1' },
  D_H: { v: 7.0e-9, unit: 'm²/s', unc: 0.2, label: 'literature', src: 'Schneider et al. 2014, Table 1' },
  D_OH: { v: 2.2e-9, unit: 'm²/s', unc: 0.2, label: 'literature', src: 'Schneider et al. 2014, Table 1' },
  D_H2: { v: 4.5e-9, unit: 'm²/s', unc: 0.1, label: 'literature', src: 'Schneider et al. 2014, Table 1' },
  D_H2O2: { v: 1.4e-9, unit: 'm²/s', unc: 0.1, label: 'literature', src: 'Schneider et al. 2014, Table 1' },
  D_ion: { v: 5e-9, unit: 'm²/s', unc: 0.5, label: 'literature', src: 'H⁺ 9.3, OH⁻ 5.3, O₂⁻ 1.8·10⁻⁹ (one value for the ions)' },
  D_O2: { v: 2.4e-9, unit: 'm²/s', unc: 0.1, label: 'literature', src: 'Schneider et al. 2014, Table 1' },
  D_Au: { v: 1.0e-9, unit: 'm²/s', unc: 0.3, label: 'literature', src: 'typical for AuCl₄⁻ in water' },
  D_Ag: { v: 1.65e-9, unit: 'm²/s', unc: 0.05, label: 'literature', src: 'Ag⁺ in water at 25 °C (limiting ionic conductivity)' },
  D_NO3: { v: 1.9e-9, unit: 'm²/s', unc: 0.05, label: 'literature', src: 'NO₃⁻ in water at 25 °C (limiting ionic conductivity)' },
  // gases in water
  H2_sat: { v: 7.8e-4, unit: 'M/atm', unc: 0.03, label: 'literature', src: 'Henry solubility of H₂ at 25 °C' },
  O2_air: { v: 2.5e-4, unit: 'M', unc: 0.05, label: 'literature', src: 'air-saturated water at 25 °C' },
  // the cell around the irradiated region
  beam_r: { v: 1.0e-6, unit: 'm', unc: 0.5, label: 'trend', src: 'illuminated radius (instrument setting; ~the field of view in TEM)' },
  chip_area: { v: 4e-6, unit: 'm²', unc: 0.5, label: 'trend', src: 'wetted area of a static cell (2 × 2 mm), its liquid reservoir' },
  flow_bypass: { v: 1.0, unit: '', unc: 0.9, label: 'trend', src: 'fraction of the flow that sweeps the reservoir (most bypasses the window)' },
  // metal precursors reduced by hydrated electrons
  k_Au_e: { v: 1.0e10, unit: '/M/s', unc: 0.3, label: 'literature', src: 'AuCl₄⁻ + e⁻aq, near diffusion-limited' },
  k_Ag_e: { v: 3.6e10, unit: '/M/s', unc: 0.1, label: 'literature', src: 'Ag⁺ + e⁻aq (Buxton et al. 1988)' },
  k_NO3_e: { v: 9.7e9, unit: '/M/s', unc: 0.1, label: 'literature', src: 'NO₃⁻ + e⁻aq (Buxton et al. 1988): the nitrate counter-ion competes for the electrons' },
  prec_bulk: { v: 1.0e-3, unit: 'M', unc: 0, label: 'literature', src: 'precursor concentration (experiment setting)' },
  Au_eta: { v: 0.003, unit: '', unc: 1.0, label: 'trend', src: 'fraction of reduced metal that deposits on existing particles (the rest nucleates in solution)' },
  // nucleation: reduced atoms accumulate in the irradiated liquid, dc/dt = R_red − k_n·c, and particles nucleate once
  // c reaches c_n. Below the dose rate at which R_red/k_n = c_n nothing nucleates (a growth threshold); well above it
  // the induction dose is nearly constant (both seen by Woehl et al. 2012). k_n lumps loss of atoms from the region
  // and the growth of nuclei to the size at which they are detected.
  nuc_c_ag: { v: 1e-6, unit: 'M', unc: 1.0, label: 'trend', src: 'reduced Ag (per litre of irradiated liquid) made before nuclei are seen: effective, it absorbs re-oxidation by OH·, loss from the region and growth to the detection limit; placeholder' },
  nuc_k_ag: { v: 1.0, unit: '/s', unc: 1.0, label: 'trend', src: 'effective loss rate of reduced Ag atoms, placeholder' },
  nuc_c_au: { v: 1e-6, unit: 'M', unc: 1.0, label: 'trend', src: 'reduced Au (per litre of irradiated liquid) made before nuclei are seen: effective, as for Ag; placeholder' },
  nuc_k_au: { v: 1.0, unit: '/s', unc: 1.0, label: 'trend', src: 'effective loss rate of reduced Au atoms, placeholder' },
  // graphene pockets: radical scavenging by the graphene
  k_scav_gr: { v: 0, unit: '/s', unc: 1.0, label: 'trend', src: 'radical scavenging by graphene is reported qualitatively; off until calibrated (scavenging OH would also stop it consuming H₂)' },
  // gas + heat: sintering (Arrhenius) and perovskite reduction
  sinter_A: { v: 6e4, unit: 'Å/s', unc: 1.0, label: 'trend', src: 'chosen so gold coarsens above ~700 K in minutes' },
  sinter_Ea: { v: 1.0, unit: 'eV', unc: 0.3, label: 'trend', src: 'order of surface self-diffusion barriers of Au' },
  sinter_O2: { v: 2.0, unit: '×', unc: 0.5, label: 'trend', src: 'oxygen-accelerated sintering is established for Pt (volatile PtO₂); for gold it is unverified' },
  redox_A: { v: 4e6, unit: '/s', unc: 1.0, label: 'trend', src: 'chosen so SrTiO₃ reduces in minutes at ~800 K' },
  redox_Ea: { v: 1.2, unit: 'eV', unc: 0.3, label: 'trend', src: 'order of oxygen-vacancy migration barriers in perovskites' },
  // electrochemistry
  bv_i0: { v: 0.003, unit: 'Å/s', unc: 1.0, label: 'trend', src: 'exchange rate (exchange current density × molar volume), placeholder' },
  bv_Eeq: { v: 0.1, unit: 'V', unc: 0.2, label: 'trend', src: 'equilibrium potential of the couple, relative' },
  bv_alpha: { v: 0.5, unit: '', unc: 0.2, label: 'literature', src: 'symmetric transfer coefficient' },
};
export const p = (k) => P[k].v;
// the precursor metals: rate constant with e⁻aq, its diffusion coefficient, electrons per atom, atomic volume (Å³),
// a counter-ion that also takes electrons, and the nucleation parameters
export const METALS = {
  au: { label: 'Gold (HAuCl₄)', name: 'gold', salt: 'HAuCl₄', k: 'k_Au_e', D: 'D_Au', ne: 3, vAtom: 16.96, counter: null, nuc: ['nuc_c_au', 'nuc_k_au'] },
  ag: { label: 'Silver (AgNO₃)', name: 'silver', salt: 'AgNO₃', k: 'k_Ag_e', D: 'D_Ag', ne: 1, vAtom: 17.06, counter: 'NO3', nuc: ['nuc_c_ag', 'nuc_k_ag'] },
};
export const metalOf = (S) => METALS[S?.lcMetal] ?? METALS.au;
// the parameters a process uses, for notes and export metadata
export const PROCESS = {
  radiolysis: { labelBy: ['G_eaq', 'G_H', 'G_OH', 'G_H2', 'G_H2O2', 'G_Hp', 'G_OHm', 'D_H2', 'H2_sat', 'O2_air'], uses: ['G_eaq', 'G_H', 'G_OH', 'G_H2', 'G_H2O2', 'G_Hp', 'G_OHm', 'D_H2', 'H2_sat', 'O2_air', 'beam_r', 'chip_area'], note: 'reaction network with published rate constants and yields; the cell geometry (beam radius, reservoir) sets the bubble threshold' },
  growth: { label: 'trend', uses: ['k_Au_e', 'k_Ag_e', 'k_NO3_e', 'prec_bulk', 'D_Au', 'D_Ag', 'Au_eta'], note: 'reduction by hydrated electrons from the network; the share that deposits on existing particles is a placeholder' },
  nucleation: { label: 'trend', uses: ['nuc_c_ag', 'nuc_k_ag', 'nuc_c_au', 'nuc_k_au'], note: 'reduced atoms accumulate to a critical concentration: a growth-threshold dose rate and an induction dose' },
  sintering: { label: 'trend', uses: ['sinter_A', 'sinter_Ea', 'sinter_O2'], note: 'one Arrhenius rate; the oxygen factor is unverified for gold' },
  redox: { label: 'trend', uses: ['redox_A', 'redox_Ea'], note: 'relaxation to the gas’s equilibrium at an Arrhenius rate' },
  electrochemistry: { label: 'trend', uses: ['bv_i0', 'bv_Eeq', 'bv_alpha'], note: 'Butler–Volmer with placeholder exchange rate' },
  bubbles: { label: 'literature', uses: ['H2_sat'], note: 'they nucleate where H₂ exceeds its solubility at the liquid’s pressure' },
};
export const LABEL_TEXT = { literature: 'literature parameters', calibrated: 'calibrated to data', partly: 'partly calibrated', trend: 'trend only' };
// a process's label follows its parameters: any calibrated and none left at trend → calibrated; both → partly
export function processLabel(n, keys = PROCESS[n].labelBy ?? PROCESS[n].uses) { // labelBy: the process itself, not the setup (cell geometry)
  const L = keys.map((k) => P[k].label), cal = L.includes('calibrated'), tr = L.includes('trend');
  return cal ? (tr ? 'partly' : 'calibrated') : tr ? 'trend' : 'literature';
}
for (const n of Object.keys(PROCESS)) Object.defineProperty(PROCESS[n], 'label', { get: () => processLabel(n), enumerable: true });
export function provenance(processes) {
  return Object.fromEntries(processes.map((n) => [n, { label: PROCESS[n].label, note: PROCESS[n].note, calibration: CAL.profile ? { name: CAL.profile.name, datasets: CAL.profile.datasets?.map((d) => d.id) } : null, parameters: Object.fromEntries(PROCESS[n].uses.map((k) => [k, { value: P[k].v, unit: P[k].unit, rel_uncertainty: P[k].unc, label: P[k].label, source: P[k].src }])) }]));
}

// ---------------------------------------------------------------- calibration profiles
// { format: 'temview-calibration/1', name, created, datasets: [{ id, title, ref, kind: 'published'|'user' }],
//   params: { key: { v, unc, dataset, note? } }, fit: { chi2, n, residuals } }
export const CAL_FORMAT = 'temview-calibration/1';
const DEF = Object.fromEntries(Object.entries(P).map(([k, e]) => [k, { ...e }]));
export const CAL = { profile: null, version: 0 };
export const defaults = () => structuredClone(DEF);
export function resetCalibration() {
  for (const [k, e] of Object.entries(DEF)) Object.assign(P[k], e);
  CAL.profile = null; CAL.version++; ssCache.clear();
}
export function isProfile(o) { return typeof o?.format === 'string' && o.format.startsWith('temview-calibration') && o.params && typeof o.params === 'object'; }
// apply a profile on top of the defaults; unknown parameters are reported, not applied
export function applyProfile(pr) {
  if (!isProfile(pr)) throw new Error('not a TEM-view calibration profile');
  resetCalibration();
  const unknown = [], byId = Object.fromEntries((pr.datasets ?? []).map((d) => [d.id, d]));
  for (const [k, e] of Object.entries(pr.params)) {
    if (!P[k] || !Number.isFinite(+e?.v)) { unknown.push(k); continue; }
    const d = byId[e.dataset];
    Object.assign(P[k], { v: +e.v, unc: Number.isFinite(+e.unc) ? +e.unc : P[k].unc, label: 'calibrated', src: `fitted to ${d ? `${d.title}${d.ref ? ` (${d.ref})` : ''}` : e.dataset ?? pr.name}${e.note ? `; ${e.note}` : ''}` });
  }
  CAL.profile = pr; CAL.version++; ssCache.clear();
  return { applied: Object.keys(pr.params).filter((k) => !unknown.includes(k)), unknown };
}

// ---------------------------------------------------------------- the radiolysis network
// M: the metal precursor ion (AuCl₄⁻ or Ag⁺, METALS); NO3: a nitrate counter-ion
export const SPECIES = ['eaq', 'H', 'OH', 'H2', 'H2O2', 'Hp', 'OHm', 'O2', 'HO2', 'O2m', 'M', 'NO3'];
const ix = Object.fromEntries(SPECIES.map((s, i) => [s, i]));
// reactants → products, k (/M/s for two reactants, /s for one); Buxton et al. 1988 and Schneider et al. 2014
export const REACTIONS = [
  [['eaq', 'eaq'], ['H2', 'OHm', 'OHm'], 5.5e9],
  [['eaq', 'H'], ['H2', 'OHm'], 2.5e10],
  [['eaq', 'OH'], ['OHm'], 3.0e10],
  [['eaq', 'H2O2'], ['OH', 'OHm'], 1.1e10],
  [['eaq', 'Hp'], ['H'], 2.3e10],
  [['eaq', 'O2'], ['O2m'], 1.9e10],
  [['eaq', 'O2m'], ['H2O2', 'OHm', 'OHm'], 1.3e10],
  [['eaq'], ['H', 'OHm'], 19],
  [['H', 'H'], ['H2'], 7.8e9],
  [['H', 'OH'], [], 7.0e9],
  [['H', 'H2O2'], ['OH'], 9.0e7],
  [['H', 'O2'], ['HO2'], 2.1e10],
  [['H', 'OHm'], ['eaq'], 2.2e7],
  [['OH', 'OH'], ['H2O2'], 5.5e9],
  [['OH', 'H2'], ['H'], 4.2e7],
  [['OH', 'H2O2'], ['HO2'], 2.7e7],
  [['OH', 'HO2'], ['O2'], 6.0e9],
  [['OH', 'O2m'], ['OHm', 'O2'], 8.0e9],
  [['Hp', 'OHm'], [], 1.4e11],
  [[], ['Hp', 'OHm'], 1.4e-3], // water's autoionisation (k_w · k_recombination), M/s
  [['HO2'], ['Hp', 'O2m'], 7.0e5],
  [['Hp', 'O2m'], ['HO2'], 5.0e10],
  [['HO2', 'HO2'], ['H2O2', 'O2'], 8.3e5],
  [['HO2', 'O2m'], ['H2O2', 'O2', 'OHm'], 9.7e7],
  [['eaq', 'M'], [], 'metal'], // the precursor reduced (one electron; ne of them make an atom: in the growth rate)
  [['eaq', 'NO3'], [], 'k_NO3_e'],
].map(([r, pr, k]) => ({ r: r.map((s) => ix[s]), p: pr.map((s) => ix[s]), k }));
const Dof = { eaq: 'D_eaq', H: 'D_H', OH: 'D_OH', H2: 'D_H2', H2O2: 'D_H2O2', Hp: 'D_ion', OHm: 'D_ion', O2: 'D_O2', HO2: 'D_ion', O2m: 'D_ion', M: 'metal', NO3: 'D_NO3' };
const GOF = { eaq: 'G_eaq', H: 'G_H', OH: 'G_OH', H2: 'G_H2', H2O2: 'G_H2O2', Hp: 'G_Hp', OHm: 'G_OHm' };

function solveLinear(A, b, n) { // in place Gaussian elimination with partial pivoting
  for (let c = 0; c < n; c++) {
    let m = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[m * n + c])) m = r;
    if (m !== c) { for (let k = 0; k < n; k++) [A[c * n + k], A[m * n + k]] = [A[m * n + k], A[c * n + k]]; [b[c], b[m]] = [b[m], b[c]]; }
    const d = A[c * n + c] || 1e-300;
    for (let r = c + 1; r < n; r++) { const f = A[r * n + c] / d; if (!f) continue; for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k]; b[r] -= f * b[c]; }
  }
  for (let c = n - 1; c >= 0; c--) { let s = b[c]; for (let k = c + 1; k < n; k++) s -= A[c * n + k] * b[k]; b[c] = s / (A[c * n + c] || 1e-300); }
  return b;
}
// dc/dt and its Jacobian
export function rhs(c, { gen, kout, bulk, scav, ks }, J = null) {
  const n = SPECIES.length, f = new Float64Array(n);
  if (J) J.fill(0);
  for (let i = 0; i < n; i++) { f[i] = gen[i] - kout[i] * (c[i] - bulk[i]) - (scav?.[i] ?? 0) * c[i]; if (J) J[i * n + i] -= kout[i] + (scav?.[i] ?? 0); }
  for (let q = 0; q < REACTIONS.length; q++) {
    const R = REACTIONS[q], k = ks ? ks[q] : R.k;
    let rate = k;
    for (const i of R.r) rate *= Math.max(0, c[i]);
    for (const i of R.r) f[i] -= rate;
    for (const i of R.p) f[i] += rate;
    if (J) for (let a = 0; a < R.r.length; a++) { // ∂rate/∂c_ra
      let d = k; R.r.forEach((j, b) => { if (b !== a) d *= Math.max(0, c[j]); });
      const ja = R.r[a];
      for (const i of R.r) J[i * n + ja] -= d;
      for (const i of R.p) J[i * n + ja] += d;
    }
  }
  return f;
}
// integrate from c0 over tEnd (s) with backward Euler and growing steps; returns the concentrations
export function integrate(c0, env, tEnd = 10) {
  const n = SPECIES.length, J = new Float64Array(n * n);
  let c = Float64Array.from(c0), t = 0, dt = 1e-13;
  while (t < tEnd) {
    dt = Math.min(dt, tEnd - t);
    let x = Float64Array.from(c), ok = false;
    for (let it = 0; it < 30; it++) {
      const f = rhs(x, env, J), A = new Float64Array(n * n), b = new Float64Array(n);
      for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i * n + j] = (i === j ? 1 : 0) - dt * J[i * n + j]; b[i] = -(x[i] - c[i] - dt * f[i]); }
      const dxv = solveLinear(A, b, n);
      let err = 0;
      for (let i = 0; i < n; i++) { x[i] = Math.max(0, x[i] + dxv[i]); err = Math.max(err, Math.abs(dxv[i]) / (Math.abs(x[i]) + 1e-15)); }
      if (err < 1e-9) { ok = true; break; }
    }
    if (!ok) { dt /= 4; if (dt < 1e-16) break; continue; }
    // step-size control on the largest relative change of any species present (backward Euler is first order)
    let ch = 0;
    for (let i = 0; i < n; i++) if (Math.max(x[i], c[i]) > 1e-12) ch = Math.max(ch, Math.abs(x[i] - c[i]) / Math.max(x[i], c[i]));
    if (ch > 0.05 && dt > 1e-15) { dt /= 2; continue; }
    c = x; t += dt; dt *= ch < 0.01 ? 1.6 : 1.1;
  }
  return c;
}
// the environment for a dose rate D (Gy/s): generation, diffusion out of the beam towards `bulk`, extra sinks
export function envFor(D, { beamR = p('beam_r'), bulk = {}, closed = false, scav = 0, metal = 'au' } = {}) {
  const n = SPECIES.length, gen = new Float64Array(n), kout = new Float64Array(n), b = new Float64Array(n), s = new Float64Array(n);
  const geo = (2.405 / beamR) ** 2, Mt = METALS[metal] ?? METALS.au;
  const ks = REACTIONS.map((R) => (R.k === 'metal' ? p(Mt.k) : typeof R.k === 'string' ? p(R.k) : R.k));
  SPECIES.forEach((sp, i) => {
    gen[i] = GOF[sp] ? p(GOF[sp]) * 1.0364e-7 * D : 0;
    kout[i] = closed ? 0 : p(Dof[sp] === 'metal' ? Mt.D : Dof[sp]) * geo;
    b[i] = bulk[sp] ?? (sp === 'Hp' || sp === 'OHm' ? 1e-7 : 0);
  });
  if (scav) for (const sp of ['eaq', 'OH', 'H']) s[ix[sp]] = scav;
  gen[ix.Hp] += 0; // autoionisation is in REACTIONS
  return { gen, kout, bulk: b, scav: s, ks };
}
// steady state in the beam (cached): concentrations (M) by species name
const ssCache = new Map();
// the parameters the network depends on (a fit that changes others keeps the cache)
const NET = Object.keys(P).filter((k) => /^(G_|D_|k_|prec_bulk|O2_air|beam_r)/.test(k));
const netSig = () => NET.map((k) => P[k].v).join(',');
export function steadyState(D, opts = {}) {
  const key = JSON.stringify([netSig(), opts.metal ?? 'au', +D.toPrecision(6), opts.beamR ?? 0, opts.closed ?? false, opts.scav ?? 0, Object.entries(opts.bulk ?? {}).map(([k, v]) => [k, +(+v).toPrecision(2)])]);
  if (ssCache.has(key)) return ssCache.get(key);
  const env = envFor(D, opts), c0 = Float64Array.from(env.bulk);
  const c = integrate(c0, env, opts.closed ? 1e4 : 1);
  const out = Object.fromEntries(SPECIES.map((s, i) => [s, c[i]]));
  if (ssCache.size > 400) ssCache.clear();
  ssCache.set(key, out);
  return out;
}

// the published calibration is the default
applyProfile(PUBLISHED);
