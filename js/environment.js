// The environment registry (M13): what the holder puts in the beam path, as a third axis next to technique and
// modifiers (technique × modifiers × environment). Every environment answers four hooks, so every technique sees it:
//
//   slices(S)          layers added to the projected potential: window membranes (amorphous phase screens)
//   inelastic(S)       extra inelastic layers for EELS (t/λ, plasmon, edges) and their X-ray lines for EDS
//   fields(S)          electrostatic potential and field (biasing, M16): none yet
//   processes          time evolution (temperature, radiolysis, …): the holder's existing models (holder.js)
//
// plus limits other parts read: the holder's tilt range (the missing wedge of the 3D techniques) and whether it can
// be cold. The four holders are its first entries and the session's `holder` key keeps working. Windows are
// described by their physics only (material and thickness), never by product names: two windows, one above and one
// below the specimen, as on a MEMS chip.
import { HOLDERS } from './holder.js';
import { imfp, EDGES } from './physics.js';
import * as LIQ from './liquid.js';
import * as GAS from './gas.js';

// window membranes: projected-potential material (physics.js MAT), atoms per Å³, mean Z, Z^1.7 per atom (HAADF),
// volume plasmon, EELS edges and EDS lines with their atomic fractions
export const WINDOWS = {
  none: { label: 'No windows' },
  sinx: { label: 'Amorphous SiNₓ', material: 'SiN', dens: 0.096, zeff: 10.4, z17: 53.9, Ep: 23.5, G: 9, frac: { Si: 0.43, N: 0.57 }, unit: 'nm', range: [5, 50], def: 20 },
  graphene: { label: 'Graphene', material: 'C', dens: 0.114, zeff: 6, z17: 21.0, Ep: 15, G: 7, frac: { C: 1 }, unit: 'layers', range: [1, 5], def: 2, layerA: 3.35 },
  carbon: { label: 'Amorphous carbon', material: 'C', dens: 0.1, zeff: 6, z17: 21.0, Ep: 24, G: 12, frac: { C: 1 }, unit: 'nm', range: [3, 30], def: 10 },
};
// the holder classes and their limits: the largest stage tilt (°), whether they cool
const LIMITS = { room: { maxTilt: 80, cryo: false }, ln2: { maxTilt: 70, cryo: true }, lhe: { maxTilt: 60, cryo: true }, heat: { maxTilt: 25, cryo: false } };
// cells (M14 on): what the holder seals around the specimen; their holders tilt far less
export const CELL_TILT = { liquid: 20, gas: 20 }; // an open ETEM column takes ordinary holders (see maxTilt)
export const ENVIRONMENTS = Object.fromEntries(Object.entries(HOLDERS).map(([id, h]) => [id, { id, kind: 'holder', name: h.name, short: h.short, ...LIMITS[id] }]));

// the windows in effect: { key, material, each (Å per window), total (Å, both windows), w (the WINDOWS entry) } or null
export function windowsOf(S) {
  const cell = S.envCell === 'liquid' ? LIQ.CELLS[S.lcClass] ?? LIQ.CELLS.sinx : S.envCell === 'gas' && S.gcGeom !== 'open' ? { windows: 'sinx' } : S.envCell === 'gas' ? { windows: 'none' } : null;
  const w = WINDOWS[cell ? cell.windows : S.envWin];
  if (!w || !w.material) return null; // (an open gas column has none)
  const v = Math.max(w.range[0], Math.min(w.range[1], S.envWinT ?? w.def)), each = w.unit === 'layers' ? Math.round(v) * w.layerA : v * 10;
  return { key: cell ? cell.windows : S.envWin, material: w.material, each, total: 2 * each, w };
}
export const envOf = (S) => ENVIRONMENTS[S.holder] ?? ENVIRONMENTS.room;
export const maxTilt = (S) => Math.min(envOf(S).maxTilt, S.envCell === 'gas' && S.gcGeom === 'open' ? 90 : CELL_TILT[S.envCell] ?? 90);
// the gas column now (gas.js; specimenT for the gas temperature): { cell, pathA, col: { N, tau, transmitted, … } } or null
export function gasNow(S, specimenT = 293) {
  const c = GAS.gasOf(S, specimenT);
  if (!c) return null;
  const pathA = GAS.bulgedPath(c, LIQ.deflection, S);
  return { cell: c, pathA, col: GAS.column({ gas: c.gas, pMbar: c.pMbar, pathA, T: c.T, kV: S.kV }) };
}
// the liquid layer under the beam (Å), with the bubbles (liq: the simulator's process state), or 0
export function liquidA(S, liq) {
  const c = LIQ.cellOf(S);
  if (!c || c.burst) return 0;
  return liq?.bubbles?.length ? LIQ.withBubbles(c.thicknessA, liq.bubbles, S.cx, S.cy) : c.thicknessA;
}

// hook: layers for projectMaps ([material, thickness Å]); tilting lengthens the path through flat windows
export function slices(S, liq = null) {
  const W = windowsOf(S), c = Math.max(0.2, Math.cos(((S.tiltX ?? 0) * Math.PI) / 180) * Math.cos(((S.tiltY ?? 0) * Math.PI) / 180)), out = [];
  if (W) out.push([W.material, W.total / c]);
  // the liquid (water: the 'ice' material, amorphous O at water's density), with the bubbles as holes
  const cell = LIQ.cellOf(S);
  if (cell && !cell.burst && cell.thicknessA > 0) out.push(['ice', cell.thicknessA / c, (liq?.bubbles ?? []).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.r) }))]);
  return out;
}
// hook: inelastic layers for EELS (eels.addInelasticComponents) at kV
export function inelastic(S, kV = S.kV, liq = null) {
  const W = windowsOf(S), out = [], tl = liquidA(S, liq), g = gasNow(S);
  if (g) out.push({ label: `${GAS.GASES[g.cell.gas].label}, ${g.cell.pMbar} mbar over ${(g.pathA / 1e4).toFixed(g.pathA > 1e6 ? 0 : 1)} µm`, tau: g.col.tauIn, plasmons: [{ Ep: 14, G: 10, frac: 1 }], edges: GAS.GASES[g.cell.gas].edges.map((e) => { const base = EDGES.find((x) => x.key === e.key); return base ? { ...e, edge: { ...base, E: e.onset ?? base.E, elnes: e.peaks ?? base.elnes } } : e; }) });
  if (tl > 0) out.push({ label: `liquid water, ${(tl / 10).toFixed(0)} nm`, tau: tl / (10 * imfp(kV, 7.4)), plasmons: [{ Ep: 21.4, G: 8, frac: 1 }], edges: [{ key: 'O', frac: 1 }] });
  if (!W) return out;
  const w = W.w, tau = W.total / (10 * imfp(kV, w.zeff));
  return [...out, { label: `windows (${w.label}, 2 × ${(W.each / 10).toFixed(1)} nm)`, tau, plasmons: [{ Ep: w.Ep, G: w.G, frac: 1 }], edges: Object.entries(w.frac).map(([key, frac]) => ({ key, frac })) }];
}
// EDS: the windows' atoms per Å² by element (to weigh their lines against the specimen's)
export function windowAtoms(S, liq = null) {
  const W = windowsOf(S), out = W ? Object.fromEntries(Object.entries(W.w.frac).map(([el, f]) => [el, W.w.dens * W.total * f])) : {}, tl = liquidA(S, liq);
  if (tl > 0) out.O = (out.O ?? 0) + 0.033 * tl; // water's oxygen
  const g = gasNow(S);
  if (g) for (const [Z, el] of GAS.GASES[g.cell.gas].atoms) if (Z > 1) out[el] = (out[el] ?? 0) + g.col.N; // the gas's atoms (no H line)
  return out;
}
// the fraction of the beam the windows scatter elastically (diffuse background in diffraction): 1 − e^(−t/λ_el),
// λ_el ≈ 1.3 λ_in for light amorphous films
export function scatteredFraction(S, kV = S.kV, liq = null) {
  const W = windowsOf(S), tl = liquidA(S, liq);
  const g = gasNow(S);
  return 1 - Math.exp(-(W ? W.total / (13 * imfp(kV, W.w.zeff)) : 0) - tl / (13 * imfp(kV, 7.4)) - (g ? g.col.tauEl : 0));
}
// a one-line description for the panel and exports
export function describeEnv(S) {
  const e = envOf(S), W = windowsOf(S);
  return `${e.short}${W ? ` · ${W.w.label} windows, 2 × ${W.w.unit === 'layers' ? `${Math.round(S.envWinT ?? W.w.def)} layer${Math.round(S.envWinT ?? W.w.def) > 1 ? 's' : ''}` : `${(W.each / 10).toFixed(0)} nm`}` : ''} · tilt up to ±${e.maxTilt}°`;
}
