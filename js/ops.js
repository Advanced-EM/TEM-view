// Instrument operations on the state alone (no DOM): load a specimen, switch mode, change a setting, pick a
// preset. The exhibit calls these and then refreshes its controls; the headless scripting driver
// (tools/temview-py) calls them directly, so a Python script sees the same instrument either way.
import * as P from './physics.js';
import { CORR_RANGE } from './state.js';
import { HOLDERS } from './holder.js';
import { analyze } from './analyze.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const MODES = ['tem', 'stem', '4d', 'diff', 'cbed', 'eds', 'eels', 'ronch', 'oah', 'ilh'];
export const fam = (m) => (['tem', 'diff', 'oah', 'ilh'].includes(m) ? 'tem' : 'probe');
const coreEdge = (spec) => (spec === 'sto' ? 462 : spec === 'si' ? 102 : spec === 'gr' ? 287 : spec === 'mof' ? 200 : spec === 'bio' ? 405 : 100);

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
  S.edsSel = 'all';
  S.eelsRange = 'core';
  S.eelsDisp = 0.25; S.eelsOffset = Math.max(50, coreEdge(v) - 200);
  S.eelsWin = coreEdge(v);
  S.eelsWidth = v === 'si' ? 5 : v === 'au' ? 24 : v === 'gr' ? 6 : v === 'mof' ? 30 : v === 'bio' ? 20 : 16;
  // a MOF needs low-dose conditions; other specimens go back to a normal dose
  if (v === 'mof') { S.dose = 2; S.kV = 300; S.thick = 20; S.camL = 4000; }
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
  sim.freshArea();
  resetVdet(S, sim);
  sim.invalidate('spec');
}

export function modeState(S, sim, m) {
  if (m === S.mode) return false;
  S.mode = m;
  S.df = S.dfFam[fam(m)];
  S.fdSel = -1;
  if (m === 'eds' || m === 'eels' || m === 'ilh') { if (sim.single) sim.startSingle(false); }
  sim.invalidate('mode');
  sim.stale.probe = 1;
  if (sim.single) sim.startSingle(true);
  return true;
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
    sim.invalidate('temp');
    return 'holder';
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
  if (key === 'eelsRange') {
    S.eelsRange = v;
    // each preset is a dispersion and an offset, as a microscopist would set them
    [S.eelsDisp, S.eelsOffset, S.eelsExp] = { zlp: [0.01, -5, 0.001], low: [0.05, -5, 0.001], core: [0.25, Math.max(50, coreEdge(S.spec) - 200), 0.5], high: [1, 1300, 2] }[v];
    const [a, b] = sim.eelsRangeBounds();
    const def = { zlp: [0, 3], low: [22, 12], core: [coreEdge(S.spec), S.spec === 'si' ? 5 : S.spec === 'gr' ? 6 : S.spec === 'mof' ? 30 : S.spec === 'bio' ? 20 : 16], high: [S.spec === 'au' ? 2260 : S.spec === 'si' ? 1860 : 1960, 60] }[v];
    S.eelsWin = clamp(def[0], a, b); S.eelsWidth = def[1];
    sim.invalidate('eelsRange');
    return 'eelsRange';
  }
  return null;
}

export const optimalDefocus = (S, sim) => +((fam(S.mode) === 'tem' ? P.scherzerDefocus(sim.CsA(), sim.lam) : P.probeDefocus(sim.CsA(), sim.lam)) / 10).toFixed(1);
export const dfLimits = (S) => (S.corrector ? [-CORR_RANGE.df, CORR_RANGE.df] : S.spec === 'bio' ? [-4000, 500] : [-150, 150]);

// the exhibit's operation vocabulary (voice commands, agent tools, scripts), on the state alone: the headless
// counterpart of runOp in main.js. Returns false for operations that only make sense with a screen.
export function runOpState(S, sim, op) {
  const set = (k, v, inv) => setState(S, sim, k, v, inv);
  switch (op.op) {
    case 'mode': if (MODES.includes(op.v)) modeState(S, sim, op.v); return true;
    case 'spec': if (P.SPECIMENS[op.v]) specState(S, sim, op.v); return true;
    case 'set':
      if (op.k === 'df') { set('df', +clamp(op.v, ...dfLimits(S)).toFixed(1), 'df'); op.v = S.df; }
      else if (op.k === 'fov') { set('fov', +clamp(op.v, 1.5, 120).toFixed(2), 'fov'); op.v = S.fov; }
      else if (op.k === 'dose') { set('dose', +clamp(op.v, 0.5, 20000).toFixed(2), 'dose'); op.v = S.dose; }
      else if (op.k === 'clarity' && ['edu', 'real'].includes(op.v)) { S.clarity = op.v; sim.invalidate('clarity'); }
      else if (op.k === 'camL') { set('camL', Math.round(clamp(op.v, 80, 6000)), 'camL'); op.v = S.camL; }
      else if (op.k === 'alpha') { const k = S.mode === '4d' ? 'alpha4d' : 'alpha'; set(k, +clamp(op.v, 3, 40).toFixed(1), 'alpha'); op.v = S[k]; }
      else if (op.k === 'tiltX' || op.k === 'tiltY') { set(op.k, +clamp(op.v, -3, 3).toFixed(2), 'tilt'); op.v = S[op.k]; }
      else if (op.k === 'thick') { set('thick', +clamp(op.v, 1, 500).toFixed(1), 'thick'); op.v = S.thick; }
      return true;
    case 'chip':
      if (op.k === 'kV' && [80, 200, 300].includes(op.v)) set('kV', op.v, 'kV');
      else if (['corrector', 'holder', 'detPreset', 'eelsRange', 'vdet'].includes(op.k)) chipState(S, sim, op.k, op.k === 'corrector' ? !!op.v : op.v);
      return true;
    case 'nudge': { const st = S.corrector ? 2 : S.spec === 'bio' ? 100 : 10; set('df', +clamp(S.df + op.d * st, ...dfLimits(S)).toFixed(1), 'df'); return true; }
    case 'zoom': set('fov', +clamp(S.fov * op.f, 1.5, 120).toFixed(2), 'fov'); return true;
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
      return false;
    case 'beam': S.paused = !!op.v; return true;
    case 'analyze':
      try { for (let i = 0; i < 3; i++) sim.update(0.05); op.result = analyze(sim, S, op.v ?? undefined); op.v = op.result.analysis; } catch (e) { op.error = e.message; }
      return true;
    case 'acquire': return true; // the caller records the data
    default: return false;
  }
}
