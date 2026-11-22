// Instrument operations on the state alone (no DOM): load a specimen, switch mode, change a setting, pick a
// preset. The exhibit calls these and then refreshes its controls; the headless scripting driver
// (tools/temview-py) calls them directly, so a Python script sees the same instrument either way.
import { MODE_IDS, family } from './registry.js';
import * as P from './physics.js';
import { MAGSPECS } from './lorentz.js';
import { CORR_RANGE } from './state.js';
import { HOLDERS } from './holder.js';
import { WINDOWS, ENVIRONMENTS } from './environment.js';
import { analyze } from './analyze.js';
import * as ML from './megalibrary.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// the technique list and beam families come from the registry (one list for every interface)
export const MODES = MODE_IDS;
export const fam = family;
// Lorentz holders tilt far (domains with out-of-plane magnetization, in-plane fields); atomic work stays near the zone
// axis, except on specimens built atom by atom in 3D (an XYZ structure, the megalibrary), which really rotate
// widest field of view, nm: 120 for the atomic-scale specimens; the megalibrary zooms out to the whole chip
export const fovMax = (S) => P.SPECIMENS[S.spec]?.fovMax ?? 120;
// ±30° where the specimen rotates its own 3D atoms (uploads, zone-axis crystals), ±3° for the projected crystals
export const tiltLimit = (S) => (S.mode === 'ltem' || S.mode === 'lstem' || P.SPECIMENS[S.spec]?.ownTilt || (S.zone && P.CRYST[S.spec] && !P.CRYST[S.spec].twoD) ? 30 : 3);
const coreEdge = (spec) => (spec === 'sto' ? 462 : spec === 'si' || spec === 'hesi' ? 102 : spec === 'cspb' ? 726 : spec === 'mapb' ? 401 : spec === 'gr' ? 287 : spec === 'mof' ? 200 : spec === 'bio' ? 405 : spec === 'lib' ? 855 : 100);

export function resetVdet(S, sim) {
  const a = S.alpha4d, mp = sim.fd?.mradPx ?? (P.wavelength(S.kV) * 1000) / (64 * 0.18);
  const edge = 30 * mp;
  if (S.vdet === 'bf') { S.vdIn = 0; S.vdOut = a; }
  if (S.vdet === 'abf') { S.vdIn = a / 2; S.vdOut = a; }
  if (S.vdet === 'adf') { S.vdIn = Math.min(a * 1.15, edge * 0.6); S.vdOut = edge; }
  if (S.vdet === 'disk') {
    const g = sim.spec.grains[0], [m, n] = S.spec === 'sto' || S.spec === 'gr' ? [1, 0] : [1, 1];
    const gx = m * g.b[0][0] + n * g.b[1][0], gy = m * g.b[0][1] + n * g.b[1][1], gm = Math.hypot(gx, gy) * sim.lam * 1000;
    const r = a + gm * 0.5;
    S.vdX = (gx / Math.hypot(gx, gy)) * r; S.vdY = (gy / Math.hypot(gx, gy)) * r; S.vdR = Math.max(1.5, gm * 0.4);
  }
}

// load a specimen with the conditions a microscopist would use for it
export function specState(S, sim, v) {
  const prevSpec = S.spec;
  S.spec = v;
  const sp = P.SPECIMENS[v];
  S.fov = sp.fov; S.cx = sp.center[0]; S.cy = sp.center[1]; S.tiltX = 0; S.tiltY = 0;
  S.zone = null; // a new specimen starts as built
  S.edsSel = 'all';
  S.eelsRange = 'core';
  S.eelsDisp = 0.25; S.eelsOffset = Math.max(50, coreEdge(v) - 200);
  S.eelsWin = coreEdge(v);
  S.eelsWidth = v === 'si' || v === 'hesi' ? 5 : v === 'cspb' ? 30 : v === 'mapb' ? 20 : v === 'au' ? 24 : v === 'gr' ? 6 : v === 'mof' ? 30 : v === 'bio' ? 20 : 16;
  // a MOF needs low-dose conditions; other specimens go back to a normal dose
  if (v === 'mof') { S.dose = 2; S.kV = 300; S.thick = 20; S.camL = 4000; }
  else if (v === 'xyz') { S.thick = 3; if (S.dose < 20) S.dose = 400; } // thickness: the carbon support
  else if (v === 'lib') { S.thick = 10; if (S.dose < 20) S.dose = 400; } // thickness: the Si₃N₄ membrane
  else if (v === 'cspb') { S.dose = 10; S.kV = 300; S.thick = 3; } // low dose; thickness: the carbon support
  else if (v === 'mapb') { S.dose = 2; S.kV = 300; S.thick = 3; }
  else if (v === 'hesi') { S.thick = 30; if (S.dose < 20) S.dose = 400; }
  else if (v === 'bio') {
    // single-particle cryo-EM conditions: frozen grid, 300 kV, no corrector, ~1.5 µm underfocus, ~30 e⁻/Å²
    Object.assign(S, { holder: 'ln2', tempSet: 90, kV: 300, dose: 30, thick: 30, corrector: false, csUnc: S.profile.CsUnc, objAp: 'none', camL: 2000 });
    S.dfFam.tem = -1500; S.dfFam.probe = +(P.probeDefocus(S.profile.CsUnc * 1e7, P.wavelength(300)) / 10).toFixed(1);
    S.alpha = Math.min(S.alpha, 10);
    S.df = S.dfFam[fam(S.mode)];
    sim.newGrid(); // fresh vitreous ice; a freshly inserted cryo holder drifts at first
  } else if (S.dose < 20) S.dose = 400;
  if (v !== 'bio' && prevSpec === 'bio') {
    S.corrector = S.profile.corrector; S.dfFam = { tem: -4, probe: 0 }; S.df = S.dfFam[fam(S.mode)];
    if (S.corrector) S.alpha = 22;
  }
  if (prevSpec === 'hesi' && v !== 'hesi') { const [lo, hi] = dfLimits(S); S.df = clamp(S.df, lo, hi); S.dfFam[fam(S.mode)] = S.df; }
  sim.freshArea();
  resetVdet(S, sim);
  sim.invalidate('spec');
}

export function modeState(S, sim, m) {
  if (m === S.mode) return false;
  S.mode = m;
  S.df = S.dfFam[fam(m)];
  const L = tiltLimit(S);
  if (Math.abs(S.tiltX) > L || Math.abs(S.tiltY) > L) { S.tiltX = clamp(S.tiltX, -L, L); S.tiltY = clamp(S.tiltY, -L, L); sim.invalidate('tilt'); }
  S.fdSel = -1;
  if (m === 'eds' || m === 'eels' || m === 'ilh') { if (sim.single) sim.startSingle(false); }
  sim.invalidate('mode');
  sim.stale.probe = 1;
  if (sim.single) sim.startSingle(true);
  return true;
}

// Lorentz settings (lorentz.js): numeric ranges [min, max, decimals] and the allowed values of the choices
// numeric settings [min, max, decimals] and choices that commands, scripts and agents can set directly
// (Lorentz microscopy, and the EELS spectrometer)
export const LOR_LIMITS = { lorDf: [-3000, 3000, 0], lorFov: [0.3, 10, 3], lorThick: [10, 150, 0], lorField: [0, 600, 0], lorDiv: [0.5, 30, 1], lorAlpha: [20, 3000, 0], lorApR: [2, 40, 1],
  pedPhi: [0, 60, 1], pedSteps: [4, 128, 0], pedDescan: [0, 20, 1],
  tomoMax: [20, 80, 0], envWinT: [1, 50, 1], lcA: [10, 500, 0], lcB: [10, 2000, 0], lcGap: [20, 5000, 0], lcDP: [0, 30, 2], lcFlow: [0, 5, 2], lcPocket: [5, 500, 0], lcRate: [0.01, 1000, 2], tomoStep: [0.5, 10, 1], tomoDose: [1, 1e7, 0], tomoJitter: [0, 5, 1], tomoIter: [1, 100, 0], tomoDepth: [-0.5, 0.5, 2],
  ptMax: [10, 75, 0], ptAlpha: [10, 20, 1], ptDose: [1e3, 1e7, 0], ptIters: [2, 30, 0],
  spaN: [100, 20000, 0], spaDose: [2, 300, 1], spaDf: [0, 4, 2], spaPref: [0, 0.95, 2], spaAngErr: [0, 10, 1],
  edStart: [-70, 0, 1], edEnd: [0, 70, 1], edSpeed: [0.1, 10, 2], edStep: [0.1, 5, 2], edExp: [0.05, 5, 3], edDoseRate: [0.001, 2, 4], edAxis: [0, 180, 1], edLayer: [-3, 3, 0],
  eelsBeta: [1, 100, 1], eelsOffset: [-50, 3000, 1], eelsWin: [0, 6000, 2], eelsWidth: [0.5, 80, 1], eelsCurrent: [5, 2000, 0], eelsExp: [1e-4, 10, 5], eelsExpLow: [1e-5, 0.1, 6] };
export const LOR_CHOICES = { lorView: ['fresnel', 'foucault', 'tie', 'phase'], lstemView: ['color', 'x', 'y', 'sum'], lorFouc: ['+x', '-x', '+y', '-y'],
  eelsSource: ['profile', 'schottky', 'cfeg', 'mono'], eelsDet: ['ccd', 'direct'], eelsYScale: ['log', 'lin', 'split'], eelsDisp: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  pedOn: [true, false], dualEels: [true, false], edMethod: ['cred', 'step', 'pedt'], tomoPhantom: ['specimen', 'beads'], tomoN: [64, 96, 128, 256], gpu: ['auto', 'off'], spaSample: ['apo', 'bgal'], envWin: ['none', 'sinx', 'graphene', 'carbon'], envCell: ['none', 'liquid'], lcClass: ['sinx', 'sinxFlow', 'graphene'], lcDepth: ['top', 'middle', 'bottom'], lcPrecursor: [true, false], lcFilter: [true, false], ptTilts: [1, 3, 5, 7, 9], ptFusion: ['sirt', 'average'], ptView: ['xz', 'xy', 'slices'], spaZpp: [true, false], spaBin: [1, 2], spaView: ['mic', 'ctf', 'classes', 'map'], tomoSignal: ['haadf', 'bf'], tomoScheme: ['linear', 'saxton'], tomoAlign: [true, false], tomoRecon: ['wbp', 'sirt'], tomoFilter: ['ramp', 'hann'], tomoView: ['series', 'xy', 'xz', 'yz'], edFps: [1, 2, 4, 10, 20, 40], edMerge: ['friedel', 'laue'], edSlice: ['hk0', 'h0l', '0kl'], eelsFit: [true, false], eelsDeconv: [true, false], eelsLine: [true, false], bgsub: [true, false] };
// a Lorentz setting from a command, clamped; true if `op` was one
export function lorSet(S, set, op) {
  // zone axis [u, v, w] of a built-in crystal (null: as built); the field returns to the crystal's centre
  if (op.k === 'zone') { const v = Array.isArray(op.v) && op.v.length === 3 && op.v.every((x) => Number.isInteger(+x) && Math.abs(x) <= 9) && op.v.some((x) => +x !== 0) ? op.v.map(Number) : null; S.cx = 0; S.cy = 0; S.tiltX = 0; S.tiltY = 0; set('zone', v, 'zone'); op.v = S.zone; return true; }
  // the EELS probe: a spectrum-image pixel [i, j], or null for the whole field
  if (op.k === 'eelsPx') { const v = Array.isArray(op.v) && op.v.length === 2 && op.v.every(Number.isFinite) ? op.v.map((x) => Math.max(0, Math.min(127, Math.round(x)))) : null; set('eelsPx', v, 'eelsPx'); op.v = S.eelsPx; return true; }
  const L = LOR_LIMITS[op.k];
  if (L) { set(op.k, +clamp(+op.v, L[0], L[1]).toFixed(L[2]), op.k); op.v = S[op.k]; return true; }
  if (LOR_CHOICES[op.k]) { if (LOR_CHOICES[op.k].includes(op.v)) set(op.k, op.v, op.k); return true; }
  return false;
}

// one setting; returns the invalidation key, or null if nothing changed
export function setState(S, sim, key, v, inv = key) {
  if (S[key] === v) return null;
  const prevT = S.tempSet;
  S[key] = v;
  if (key === 'df') S.dfFam[fam(S.mode)] = v;
  if (key === 'detIn' || key === 'detOut') { if (S.detOut < S.detIn + 5) S.detOut = S.detIn + 5; S.detPreset = null; }
  if (key === 'eelsWin' || key === 'eelsWidth') inv = 'eelsWin';
  // a new dispersion or offset: keep the energy window on the spectrum
  if (key === 'eelsDisp' || key === 'eelsOffset') { const [a, b] = sim.eelsRangeBounds(); if (S.eelsWin < a || S.eelsWin > b) S.eelsWin = +((a + b) / 2).toFixed(1); }
  if (key === 'alpha4d') resetVdet(S, sim);
  // a temperature step makes the holder drift until it settles (MEMS heaters settle fastest)
  if (key === 'tempSet') sim.kickDrift(Math.min(4, Math.abs(v - prevT) * (S.holder === 'heat' ? 0.0015 : 0.02)));
  if (!['speed', 'showLabels', 'showElectrons', 'showGlass', 'autoRotate', 'paused'].includes(key)) sim.invalidate(inv);
  return inv;
}

// the preset buttons (chips) that set several things at once; returns the explanation key, or null if `key`
// is a plain setting (the caller then uses setState)
export function chipState(S, sim, key, v) {
  if (key === 'holder') {
    S.holder = v;
    S.tempSet = { room: 293, ln2: 90, lhe: 4.2, heat: 293 }[v];
    sim.kickDrift(HOLDERS[v].kick, true);
    if (['ln2', 'lhe'].includes(v) && S.envCell !== 'none') { S.envCell = 'none'; sim.resetLiquid?.(); } // cryo and a liquid cell exclude each other
    S.tomoMax = Math.min(S.tomoMax, ENVIRONMENTS[v]?.maxTilt ?? 80); // the holder's tilt range
    sim.invalidate('temp'); sim.invalidate('env');
    return 'holder';
  }
  if (key === 'envCell' || key === 'lcClass') { // a liquid cell (liquid.js): no cryo holder with it; each class has its windows
    S[key] = v;
    if (S.envCell === 'liquid') {
      if (HOLDERS[S.holder] && ['ln2', 'lhe'].includes(S.holder)) { S.holder = 'room'; S.tempSet = 293; }
      S.envWinT = S.lcClass === 'graphene' ? 1 : 50;
      S.tomoMax = Math.min(S.tomoMax, 20); // a liquid-cell holder tilts about ±20°
    }
    sim.resetLiquid?.();
    sim.invalidate('env');
    return 'envCell';
  }
  if (key === 'envWin') { // the window membranes (environment.js): a new material starts at its usual thickness
    S.envWin = v;
    S.envWinT = WINDOWS[v]?.def ?? S.envWinT;
    sim.invalidate('env');
    return 'envWin';
  }
  if (key === 'corrector') {
    S.corrector = v;
    const lim = v ? CORR_RANGE.df : 150;
    S.df = clamp(S.df, -lim, lim);
    if (!v && fam(S.mode) === 'tem') S.df = +(P.scherzerDefocus(sim.CsA(), sim.lam) / 10).toFixed(1);
    S.dfFam[fam(S.mode)] = S.df;
    if (!v && fam(S.mode) !== 'tem') { S.alpha = Math.min(S.alpha, 10); S.df = S.dfFam.probe = +(P.probeDefocus(sim.CsA(), sim.lam) / 10).toFixed(1); }
    if (v) { S.alpha = 22; S.dfFam.probe = 0; if (fam(S.mode) === 'probe') S.df = 0; }
    sim.invalidate('corrector');
    return 'corrector';
  }
  if (key === 'detPreset') {
    const a = S.alpha;
    const p = { bf: [0, Math.round(a * 0.6)], abf: [Math.round(a * 0.5), Math.round(a)], adf: [Math.round(a * 1.1), Math.round(a * 3)], haadf: [Math.round(Math.max(3 * a, 60)), 200] }[v];
    S.detPreset = v; S.detIn = p[0]; S.detOut = p[1];
    sim.invalidate('det');
    return 'det';
  }
  if (key === 'vdet') { S.vdet = v; resetVdet(S, sim); sim.invalidate('vdet'); return 'vdet'; }
  // a magnetic specimen (Lorentz modes) comes with its usual field of view and film thickness
  if (key === 'magSpec') {
    const sp = MAGSPECS[v];
    if (!sp) return null;
    Object.assign(S, { magSpec: v, lorFov: sp.fov, lorThick: sp.thick, tiltX: 0, tiltY: 0 });
    sim.invalidate('magSpec');
    return 'magSpec';
  }
  if (key === 'eelsRange') {
    S.eelsRange = v;
    // each preset is a dispersion and an offset, as a microscopist would set them
    [S.eelsDisp, S.eelsOffset, S.eelsExp] = { zlp: [0.01, -5, 0.001], low: [0.05, -5, 0.001], core: [0.25, Math.max(50, coreEdge(S.spec) - 200), 0.5], high: [1, 1300, 2] }[v];
    const [a, b] = sim.eelsRangeBounds();
    const def = { zlp: [0, 3], low: [22, 12], core: [coreEdge(S.spec), S.spec === 'si' || S.spec === 'hesi' ? 5 : S.spec === 'cspb' ? 30 : S.spec === 'mapb' ? 20 : S.spec === 'gr' ? 6 : S.spec === 'mof' ? 30 : S.spec === 'bio' ? 20 : 16], high: [S.spec === 'au' ? 2260 : S.spec === 'si' || S.spec === 'hesi' ? 1860 : S.spec === 'cspb' || S.spec === 'mapb' ? 1570 : 1960, 60] }[v];
    S.eelsWin = clamp(def[0], a, b); S.eelsWidth = def[1];
    sim.invalidate('eelsRange');
    return 'eelsRange';
  }
  return null;
}

// Megalibrary stage moves (S.cx, S.cy are in Å; the library is laid out in µm). goTo drives to particle
// (i, j)'s grid node. A real stage lands within tens of nanometres of where it was sent, so in the realistic
// view each move adds a random error; the particle itself also sits up to ~60 nm from its node.
export const STAGE_ERR_NM = 25;
// onParticle: centre on the particle itself rather than its node (the exhibit's buttons, which know the map)
export function libGoto(S, sim, i, j, onParticle = false) {
  if (!ML.inLibrary(i, j)) throw new Error(`particle (${i}, ${j}) is outside the library: i and j run from 0 to ${ML.LIB.n - 1}`);
  const err = S.clarity === 'real' ? STAGE_ERR_NM * 10 : 0, g = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
  const p = ML.particle(i, j), [x, y] = onParticle ? [p.x_um, p.y_um] : [i * ML.LIB.pitch_um, j * ML.LIB.pitch_um];
  S.cx = x * 1e4 + err * g(); S.cy = y * 1e4 + err * g();
  sim.freshArea(); sim.invalidate('stage');
  return stagePos(S);
}
export function stageMove(S, sim, dx_nm, dy_nm) { S.cx += dx_nm * 10; S.cy += dy_nm * 10; sim.invalidate('stage'); return stagePos(S); }
export function stagePos(S) {
  const out = { stage_um: [+(S.cx / 1e4).toFixed(5), +(S.cy / 1e4).toFixed(5)] };
  if (S.spec === 'lib') { const ij = ML.nearest(S.cx / 1e4, S.cy / 1e4); out.nearest_particle = ij; }
  return out;
}

export const optimalDefocus = (S, sim) => +((fam(S.mode) === 'tem' ? P.scherzerDefocus(sim.CsA(), sim.lam) : P.probeDefocus(sim.CsA(), sim.lam)) / 10).toFixed(1);
export const dfLimits = (S) => (S.spec === 'hesi' ? [-1500, 1500] : S.corrector ? [-CORR_RANGE.df, CORR_RANGE.df] : S.spec === 'bio' ? [-4000, 500] : [-150, 150]);

// the exhibit's operation vocabulary (voice commands, agent tools, scripts), on the state alone: the headless
// counterpart of runOp in main.js. Returns false for operations that only make sense with a screen.
export function runOpState(S, sim, op) {
  const set = (k, v, inv) => setState(S, sim, k, v, inv);
  switch (op.op) {
    case 'mode': if (MODES.includes(op.v)) modeState(S, sim, op.v); return true;
    case 'spec': if (P.SPECIMENS[op.v]) specState(S, sim, op.v); return true;
    case 'set':
      if (op.k === 'df') { set('df', +clamp(op.v, ...dfLimits(S)).toFixed(1), 'df'); op.v = S.df; }
      else if (op.k === 'fov') { set('fov', +clamp(op.v, 1.5, fovMax(S)).toFixed(2), 'fov'); op.v = S.fov; }
      else if (op.k === 'dose') { set('dose', +clamp(op.v, 0.5, 20000).toFixed(2), 'dose'); op.v = S.dose; }
      else if (op.k === 'clarity' && ['edu', 'real'].includes(op.v)) { S.clarity = op.v; sim.invalidate('clarity'); }
      else if (op.k === 'camL') { set('camL', Math.round(clamp(op.v, 80, 6000)), 'camL'); op.v = S.camL; }
      else if (op.k === 'alpha') { const k = S.mode === '4d' ? 'alpha4d' : 'alpha'; set(k, +clamp(op.v, 3, 40).toFixed(1), 'alpha'); op.v = S[k]; }
      else if (op.k === 'tiltX' || op.k === 'tiltY') { set(op.k, +clamp(op.v, -tiltLimit(S), tiltLimit(S)).toFixed(2), 'tilt'); op.v = S[op.k]; }
      else if (op.k === 'thick') { set('thick', +clamp(op.v, 1, 500).toFixed(1), 'thick'); op.v = S.thick; }
      else lorSet(S, set, op);
      return true;
    case 'chip':
      if (op.k === 'kV' && [80, 200, 300].includes(op.v)) set('kV', op.v, 'kV');
      else if (['corrector', 'holder', 'detPreset', 'eelsRange', 'vdet', 'magSpec', 'envWin', 'envCell', 'lcClass'].includes(op.k) && (!LOR_CHOICES[op.k] || LOR_CHOICES[op.k].includes(op.v))) chipState(S, sim, op.k, op.k === 'corrector' ? !!op.v : op.v);
      return true;
    case 'nudge': { const st = S.corrector ? 2 : S.spec === 'bio' ? 100 : 10; set('df', +clamp(S.df + op.d * st, ...dfLimits(S)).toFixed(1), 'df'); return true; }
    case 'zoom': set('fov', +clamp(S.fov * op.f, 1.5, fovMax(S)).toFixed(2), 'fov'); return true;
    case 'scale': set(op.k, +clamp(S[op.k] * op.f, 0.5, 20000).toFixed(2), op.k); return true;
    case 'temp': {
      let h = S.holder;
      if (op.v < HOLDERS[h].min || op.v > HOLDERS[h].max) h = op.v <= 60 ? 'lhe' : op.v < 250 ? 'ln2' : op.v > 320 ? 'heat' : 'room';
      if (h !== S.holder) chipState(S, sim, 'holder', h);
      set('tempSet', +clamp(op.v, HOLDERS[h].min, HOLDERS[h].max).toFixed(1), 'tempSet'); op.v = S.tempSet;
      return true;
    }
    case 'astig':
      S.ab.A1 = +clamp(op.v, 0, S.corrector ? CORR_RANGE.A1 : 100).toFixed(2); op.v = S.ab.A1;
      if (op.a != null) S.ab.A1a = +(((op.a % 180) + 180) % 180).toFixed(1);
      sim.invalidate('ab');
      return true;
    case 'action':
      if (op.v === 'optfocus') { set('df', optimalDefocus(S, sim), 'df'); return true; }
      if (op.v === 'pause') { S.paused = !S.paused; return true; }
      // record the series of a series technique (3D ED, tomography): at once, for scripts and agents
      if (op.v === 'collect') { if (S.mode === 'ed3d') { sim.startED3D(); sim.stepED3D(1e6); return true; } if (S.mode === 'tomo') { sim.startTomo({ instant: true }); return true; } if (S.mode === 'spa') { sim.startSPA({ instant: true }); return true; } if (S.mode === 'ptychotomo') { sim.startPT({ instant: true }); return true; } return false; }
      if (op.v === 'reconstruct' && S.mode === 'tomo') { sim.reconstructTomo({ instant: true }); return true; }
      return false;
    case 'beam': S.paused = !!op.v; return true;
    case 'analyze':
      try { for (let i = 0; i < 3; i++) sim.update(0.05); op.result = analyze(sim, S, op.v ?? undefined); op.v = op.result.analysis; } catch (e) { op.error = e.message; }
      return true;
    case 'acquire': return true; // the caller records the data
    default: return false;
  }
}
