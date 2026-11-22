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
import { imfp } from './physics.js';

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
export const ENVIRONMENTS = Object.fromEntries(Object.entries(HOLDERS).map(([id, h]) => [id, { id, kind: 'holder', name: h.name, short: h.short, ...LIMITS[id] }]));

// the windows in effect: { key, material, each (Å per window), total (Å, both windows), w (the WINDOWS entry) } or null
export function windowsOf(S) {
  const w = WINDOWS[S.envWin];
  if (!w || !w.material) return null;
  const v = Math.max(w.range[0], Math.min(w.range[1], S.envWinT ?? w.def)), each = w.unit === 'layers' ? Math.round(v) * w.layerA : v * 10;
  return { key: S.envWin, material: w.material, each, total: 2 * each, w };
}
export const envOf = (S) => ENVIRONMENTS[S.holder] ?? ENVIRONMENTS.room;
export const maxTilt = (S) => envOf(S).maxTilt;

// hook: layers for projectMaps ([material, thickness Å]); tilting lengthens the path through flat windows
export function slices(S) {
  const W = windowsOf(S);
  if (!W) return [];
  const c = Math.cos(((S.tiltX ?? 0) * Math.PI) / 180) * Math.cos(((S.tiltY ?? 0) * Math.PI) / 180);
  return [[W.material, W.total / Math.max(0.2, c)]];
}
// hook: inelastic layers for EELS (eels.addInelasticComponents) at kV
export function inelastic(S, kV = S.kV) {
  const W = windowsOf(S);
  if (!W) return [];
  const w = W.w, tau = W.total / (10 * imfp(kV, w.zeff));
  return [{ label: `windows (${w.label}, 2 × ${(W.each / 10).toFixed(1)} nm)`, tau, plasmons: [{ Ep: w.Ep, G: w.G, frac: 1 }], edges: Object.entries(w.frac).map(([key, frac]) => ({ key, frac })) }];
}
// EDS: the windows' atoms per Å² by element (to weigh their lines against the specimen's)
export function windowAtoms(S) {
  const W = windowsOf(S);
  if (!W) return {};
  return Object.fromEntries(Object.entries(W.w.frac).map(([el, f]) => [el, W.w.dens * W.total * f]));
}
// the fraction of the beam the windows scatter elastically (diffuse background in diffraction): 1 − e^(−t/λ_el),
// λ_el ≈ 1.3 λ_in for light amorphous films
export function scatteredFraction(S, kV = S.kV) {
  const W = windowsOf(S);
  return W ? 1 - Math.exp(-W.total / (13 * imfp(kV, W.w.zeff))) : 0;
}
// a one-line description for the panel and exports
export function describeEnv(S) {
  const e = envOf(S), W = windowsOf(S);
  return `${e.short}${W ? ` · ${W.w.label} windows, 2 × ${W.w.unit === 'layers' ? `${Math.round(S.envWinT ?? W.w.def)} layer${Math.round(S.envWinT ?? W.w.def) > 1 ? 's' : ''}` : `${(W.each / 10).toFixed(0)} nm`}` : ''} · tilt up to ±${e.maxTilt}°`;
}
