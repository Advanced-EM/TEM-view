// The gas cell and the environmental TEM (M15): gas around the specimen, in one of two geometries described by
// their physics only (no product names): a windowed cell (gas up to about atmospheric pressure in a thin gap
// between two membranes, which bulge and can burst like a liquid cell's: liquid.js) or an open differentially
// pumped column (a few mbar to tens of mbar over a millimetre path, no windows) (Boyes & Gai 1997; Hansen & Wagner
// 2016).
//
// Scattering: n = p/(k_B T) molecules per volume over the path L; each scatters elastically with the screened-
// Rutherford (Lenz) cross-section σ_el ≈ 1.87·10⁻²⁴ Z^(4/3)/β² m² per atom and inelastically with σ_in ≈ σ_el·20/Z
// (Egerton). A fraction 1 − e^(−nσL) of the beam is scattered: the image keeps e^(−nσL) of its contrast and the rest
// becomes a diffuse background. Reactions with gas and heat are simple rate laws: gold particles sinter (grow) when
// hot, a perovskite loses oxygen in hydrogen and takes it back in oxygen.
const KB = 1.380649e-23;

// molecules: atoms (Z, element) and gas-phase EELS edges: their onset (below the solid's: the sharp π* peaks, O₂ at
// 530.8 eV, N₂ at 401.1 eV, CO at 287.4 eV, come before the continuum) and fine structure [E, width, height]
export const GASES = {
  H2: { label: 'H₂', atoms: [[1, 'H'], [1, 'H']], edges: [] },
  O2: { label: 'O₂', atoms: [[8, 'O'], [8, 'O']], edges: [{ key: 'O', frac: 1, onset: 530, peaks: [[530.8, 0.6, 2.2], [539.5, 3, 0.5]] }] },
  N2: { label: 'N₂', atoms: [[7, 'N'], [7, 'N']], edges: [{ key: 'N', frac: 1, onset: 400.5, peaks: [[401.1, 0.25, 3], [412, 3, 0.4]] }] },
  CO: { label: 'CO', atoms: [[6, 'C'], [8, 'O']], edges: [{ key: 'C', frac: 0.5, onset: 286.8, peaks: [[287.4, 0.35, 3]] }, { key: 'O', frac: 0.5, onset: 533.6, peaks: [[534.2, 0.5, 1.8]] }] },
  H2O: { label: 'H₂O vapour', atoms: [[8, 'O'], [1, 'H'], [1, 'H']], edges: [{ key: 'O', frac: 1, onset: 533.3, peaks: [[534, 1, 1]] }] },
  Ar: { label: 'Ar', atoms: [[18, 'Ar']], edges: [{ key: 'Ar', frac: 1 }] },
};
export const GEOMETRIES = { windowed: { label: 'Windowed gas cell', maxP: 2000, windows: 'sinx' }, open: { label: 'Open column (differentially pumped)', maxP: 20, windows: null } };

const beta2 = (kV) => { const g = 1 + kV / 511; return 1 - 1 / (g * g); };
// per molecule (Å²): elastic and inelastic cross-sections
export function crossSections(gas, kV) {
  const G = GASES[gas] ?? GASES.N2;
  let el = 0, inel = 0;
  for (const [Z] of G.atoms) { const s = ((1.87e-24 * Z ** (4 / 3)) / beta2(kV)) * 1e20; el += s; inel += (s * 20) / Z; } // m² → Å²
  return { el, inel, tot: el + inel };
}
// the gas column: pressure (mbar), path (Å), temperature (K) → molecules per Å², and n σ L
export function column({ gas, pMbar, pathA, T, kV }) {
  const n = (pMbar * 100) / (KB * T) * 1e-30, N = n * pathA, cs = crossSections(gas, kV); // molecules per Å³, per Å²
  return { n, N, tauEl: N * cs.el, tauIn: N * cs.inel, tau: N * cs.tot, transmitted: Math.exp(-N * cs.tot) };
}
// the cell from the state: geometry, pressure, path (Å) and the gas temperature (the heater warms the gas near the
// specimen: windowed cells average it with the chip frame; open columns are dominated by the cooler path)
export function gasOf(S, specimenT = 293) {
  if (S.envCell !== 'gas') return null;
  const geo = GEOMETRIES[S.gcGeom] ?? GEOMETRIES.windowed, pMbar = Math.min(geo.maxP, S.gcP);
  const pathA = S.gcGeom === 'open' ? S.gcPath * 1e7 : S.gcGap * 1e4, T = S.gcGeom === 'open' ? 293 + 0.05 * (specimenT - 293) : (293 + specimenT) / 2;
  return { geo, gas: S.gcGas, pMbar, pathA, T };
}
// windows of a windowed cell bulge outwards with the gas pressure, lengthening the path (liquid.js mechanics); the
// caller passes liquid.js's deflection
export function bulgedPath(cell, deflect, S) {
  if (S.gcGeom !== 'windowed') return cell.pathA;
  const w = deflect({ a: (S.lcA / 2) * 1e-6, b: (S.lcB / 2) * 1e-6, t: (S.envWinT ?? 30) * 1e-9, dP: (cell.pMbar / 1000) * 1e5 });
  return cell.pathA + 2 * w * 1e10;
}

// reactions (dt s, T K): the extent ξ of a perovskite's reduction moves towards its equilibrium for the gas (H₂: 1,
// O₂: 0) at an Arrhenius rate ∝ √p; gold sinters (Å of radius) above ~600 K, faster in oxygen
export function react(st, S, T, dt) {
  const pBar = S.gcP / 1000, k = (Ea) => Math.exp(-Ea / (8.617e-5 * T));
  const eq = S.gcGas === 'H2' || S.gcGas === 'CO' ? 1 : S.gcGas === 'O2' ? 0 : st.xi;
  st.xi += (eq - st.xi) * Math.min(1, 4e6 * k(1.2) * Math.sqrt(pBar) * dt);
  if (T > 600) st.sinter = Math.min(20, st.sinter + 6e4 * k(1.0) * (S.gcGas === 'O2' ? 2 : 1) * dt);
  return st;
}
