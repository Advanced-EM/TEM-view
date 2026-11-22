// Kinetics on documented parameters: every constant the in situ processes use, with its unit, uncertainty, source and
// a confidence label, and the water-radiolysis reaction network that drives the liquid cell.
//
// Labels:
//   literature  a published value (rate constants, yields, diffusion coefficients, solubilities); not yet checked
//               against in situ TEM data in this simulator
//   calibrated  fitted to in situ data (none yet: the calibration step adds them, with the dataset named)
//   trend       chosen to reproduce a published trend; the value itself is a placeholder until calibrated
//
// Radiolysis (after Schneider et al. 2014, J. Phys. Chem. C 118, 22373): the beam deposits D Gy/s in the water; each
// species i is made at G_i molecules per 100 eV (R_i = G_i · 1.036·10⁻⁷ mol/J · D, in M/s for 1 kg/L), reacts by mass
// action (rate constants from the Buxton et al. 1988 compilation) and leaves the irradiated disc of radius r_b by
// diffusion, k_out = D_i (2.405/r_b)², towards the surrounding liquid. The stiff equations are integrated implicitly
// (backward Euler, Newton) to steady state.

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
  // gases in water
  H2_sat: { v: 7.8e-4, unit: 'M/atm', unc: 0.03, label: 'literature', src: 'Henry solubility of H₂ at 25 °C' },
  O2_air: { v: 2.5e-4, unit: 'M', unc: 0.05, label: 'literature', src: 'air-saturated water at 25 °C' },
  // the cell around the irradiated region
  beam_r: { v: 1.0e-6, unit: 'm', unc: 0.5, label: 'trend', src: 'illuminated radius (instrument setting; ~the field of view in TEM)' },
  chip_area: { v: 4e-6, unit: 'm²', unc: 0.5, label: 'trend', src: 'wetted area of a static cell (2 × 2 mm), its liquid reservoir' },
  flow_bypass: { v: 1.0, unit: '', unc: 0.9, label: 'trend', src: 'fraction of the flow that sweeps the reservoir (most bypasses the window)' },
  // gold reduction
  k_Au_e: { v: 1.0e10, unit: '/M/s', unc: 0.3, label: 'literature', src: 'AuCl₄⁻ + e⁻aq, near diffusion-limited' },
  Au_bulk: { v: 1.0e-3, unit: 'M', unc: 0, label: 'literature', src: 'precursor concentration (experiment setting)' },
  Au_eta: { v: 0.003, unit: '', unc: 1.0, label: 'trend', src: 'fraction of reduced gold that deposits on existing particles (the rest nucleates in solution)' },
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
// the parameters a process uses, for notes and export metadata
export const PROCESS = {
  radiolysis: { label: 'literature', uses: ['G_eaq', 'G_H', 'G_OH', 'G_H2', 'G_H2O2', 'G_Hp', 'G_OHm', 'D_H2', 'H2_sat', 'O2_air', 'beam_r', 'chip_area'], note: 'reaction network with published rate constants and yields; the cell geometry (beam radius, reservoir) sets the bubble threshold' },
  growth: { label: 'trend', uses: ['k_Au_e', 'Au_bulk', 'D_Au', 'Au_eta'], note: 'reduction by hydrated electrons from the network; the share that deposits on existing particles is a placeholder' },
  sintering: { label: 'trend', uses: ['sinter_A', 'sinter_Ea', 'sinter_O2'], note: 'one Arrhenius rate; the oxygen factor is unverified for gold' },
  redox: { label: 'trend', uses: ['redox_A', 'redox_Ea'], note: 'relaxation to the gas’s equilibrium at an Arrhenius rate' },
  electrochemistry: { label: 'trend', uses: ['bv_i0', 'bv_Eeq', 'bv_alpha'], note: 'Butler–Volmer with placeholder exchange rate' },
  bubbles: { label: 'literature', uses: ['H2_sat'], note: 'they nucleate where H₂ exceeds its solubility at the liquid’s pressure' },
};
export const LABEL_TEXT = { literature: 'literature parameters', calibrated: 'calibrated to data', trend: 'trend only' };
export function provenance(processes) {
  return Object.fromEntries(processes.map((n) => [n, { label: PROCESS[n].label, note: PROCESS[n].note, parameters: Object.fromEntries(PROCESS[n].uses.map((k) => [k, { value: P[k].v, unit: P[k].unit, rel_uncertainty: P[k].unc, label: P[k].label, source: P[k].src }])) }]));
}

// ---------------------------------------------------------------- the radiolysis network
export const SPECIES = ['eaq', 'H', 'OH', 'H2', 'H2O2', 'Hp', 'OHm', 'O2', 'HO2', 'O2m', 'Au'];
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
  [['eaq', 'Au'], [], p('k_Au_e')], // AuCl₄⁻ reduced (one electron; three make an atom: accounted in the growth rate)
].map(([r, pr, k]) => ({ r: r.map((s) => ix[s]), p: pr.map((s) => ix[s]), k }));
const Dof = { eaq: 'D_eaq', H: 'D_H', OH: 'D_OH', H2: 'D_H2', H2O2: 'D_H2O2', Hp: 'D_ion', OHm: 'D_ion', O2: 'D_O2', HO2: 'D_ion', O2m: 'D_ion', Au: 'D_Au' };
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
export function rhs(c, { gen, kout, bulk, scav }, J = null) {
  const n = SPECIES.length, f = new Float64Array(n);
  if (J) J.fill(0);
  for (let i = 0; i < n; i++) { f[i] = gen[i] - kout[i] * (c[i] - bulk[i]) - (scav?.[i] ?? 0) * c[i]; if (J) J[i * n + i] -= kout[i] + (scav?.[i] ?? 0); }
  for (const R of REACTIONS) {
    let rate = R.k;
    for (const i of R.r) rate *= Math.max(0, c[i]);
    for (const i of R.r) f[i] -= rate;
    for (const i of R.p) f[i] += rate;
    if (J) for (let a = 0; a < R.r.length; a++) { // ∂rate/∂c_ra
      let d = R.k; R.r.forEach((j, b) => { if (b !== a) d *= Math.max(0, c[j]); });
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
export function envFor(D, { beamR = p('beam_r'), bulk = {}, closed = false, scav = 0 } = {}) {
  const n = SPECIES.length, gen = new Float64Array(n), kout = new Float64Array(n), b = new Float64Array(n), s = new Float64Array(n);
  const geo = (2.405 / beamR) ** 2;
  SPECIES.forEach((sp, i) => {
    gen[i] = GOF[sp] ? p(GOF[sp]) * 1.0364e-7 * D : 0;
    kout[i] = closed ? 0 : p(Dof[sp]) * geo;
    b[i] = bulk[sp] ?? (sp === 'Hp' || sp === 'OHm' ? 1e-7 : 0);
  });
  if (scav) for (const sp of ['eaq', 'OH', 'H']) s[ix[sp]] = scav;
  gen[ix.Hp] += 0; // autoionisation is in REACTIONS
  return { gen, kout, bulk: b, scav: s };
}
// steady state in the beam (cached): concentrations (M) by species name
const ssCache = new Map();
export function steadyState(D, opts = {}) {
  const key = JSON.stringify([+D.toPrecision(3), opts.beamR ?? 0, opts.closed ?? false, opts.scav ?? 0, Object.entries(opts.bulk ?? {}).map(([k, v]) => [k, +(+v).toPrecision(2)])]);
  if (ssCache.has(key)) return ssCache.get(key);
  const env = envFor(D, opts), c0 = Float64Array.from(env.bulk);
  const c = integrate(c0, env, opts.closed ? 1e4 : 1);
  const out = Object.fromEntries(SPECIES.map((s, i) => [s, c[i]]));
  if (ssCache.size > 400) ssCache.clear();
  ssCache.set(key, out);
  return out;
}
