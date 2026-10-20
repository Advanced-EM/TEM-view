// What a Python script can do to the microscope. One implementation serves every way of running a script:
//   - the Python IDE inside the exhibit (Pyodide, js/ide.js)
//   - desktop Python driving an open exhibit (the agent bridge, method "script")
//   - desktop Python with the headless simulator (tools/temview-py/temview/driver.mjs)
// The host supplies the state, the simulator and how to run one operation; this file holds the rest, so a
// script behaves the same in all three. Every call is synchronous: the simulator computes on demand.
//
// The compute runs on the CPU in JavaScript. The calls here do not depend on how the simulator computes, so a
// future WebGPU backend for the wave optics can speed up the same scripts without changing them.
import * as P from './physics.js';
import { collectData, toNpz } from './export.js';
import { analyze, ANALYSES } from './analyze.js';
import { parseCommand } from './voice.js';
import { SCENARIOS } from './scenarios.js';
import { MODES } from './ops.js';
import { SESSION_KEYS } from './state.js';

export const SCRIPT_API = 1;
const SPECS = ['au', 'si', 'sto', 'gr', 'mof', 'bio'];
// training tasks a script can run as a challenge (the direct-alignment task needs its on-screen controls)
const CHALLENGES = ['tem-focus-stig', 'corrector-ronch'];
const SETTINGS = {
  mode: 'tem, stem, 4d, diff, cbed, eds, eels, ronch, oah, ilh', specimen: 'au, si, sto, gr, mof, bio', kV: '80, 200 or 300',
  defocus_nm: 'C1 in nm, negative is underfocus', fov_nm: 'field of view in nm', dose: 'electrons per Å²', thickness_nm: 'specimen thickness',
  corrector: 'True or False', holder: 'room, ln2, lhe, heat', temperature_K: 'specimen temperature', realistic: 'shot noise and real detectors',
  detector: 'bf, abf, adf, haadf (STEM)', convergence_mrad: 'probe semi-angle', camera_length_mm: 'diffraction camera length',
  tilt_x_deg: 'specimen tilt α', tilt_y_deg: 'specimen tilt β', eels_range: 'zlp, low, core, high', beam: 'True (on) or False (blanked)',
};

export function settingsToOps(a) {
  const bad = Object.keys(a).filter((k) => !(k in SETTINGS));
  if (bad.length) throw new Error(`unknown setting ${bad.join(', ')}. Settings: ${Object.keys(SETTINGS).join(', ')}`);
  const ops = [];
  if (a.specimen !== undefined) { if (!SPECS.includes(a.specimen)) throw new Error(`specimen must be one of ${SPECS.join(', ')}`); ops.push({ op: 'spec', v: a.specimen }); }
  if (a.mode !== undefined) { if (!MODES.includes(a.mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`); ops.push({ op: 'mode', v: a.mode }); }
  if (a.kV !== undefined) { if (![80, 200, 300].includes(+a.kV)) throw new Error('kV must be 80, 200 or 300'); ops.push({ op: 'chip', k: 'kV', v: +a.kV }); }
  if (a.corrector !== undefined) ops.push({ op: 'chip', k: 'corrector', v: !!a.corrector });
  if (a.holder !== undefined) ops.push({ op: 'chip', k: 'holder', v: a.holder });
  if (a.temperature_K !== undefined) ops.push({ op: 'temp', v: +a.temperature_K });
  if (a.realistic !== undefined) ops.push({ op: 'set', k: 'clarity', v: a.realistic ? 'real' : 'edu' });
  if (a.convergence_mrad !== undefined) ops.push({ op: 'set', k: 'alpha', v: +a.convergence_mrad });
  if (a.detector !== undefined) ops.push({ op: 'chip', k: 'detPreset', v: a.detector });
  if (a.camera_length_mm !== undefined) ops.push({ op: 'set', k: 'camL', v: +a.camera_length_mm });
  if (a.eels_range !== undefined) ops.push({ op: 'chip', k: 'eelsRange', v: a.eels_range });
  if (a.thickness_nm !== undefined) ops.push({ op: 'set', k: 'thick', v: +a.thickness_nm });
  if (a.fov_nm !== undefined) ops.push({ op: 'set', k: 'fov', v: +a.fov_nm });
  if (a.dose !== undefined) ops.push({ op: 'set', k: 'dose', v: +a.dose });
  if (a.tilt_x_deg !== undefined) ops.push({ op: 'set', k: 'tiltX', v: +a.tilt_x_deg });
  if (a.tilt_y_deg !== undefined) ops.push({ op: 'set', k: 'tiltY', v: +a.tilt_y_deg });
  if (a.defocus_nm !== undefined) ops.push({ op: 'set', k: 'df', v: +a.defocus_nm });
  if (a.beam !== undefined) ops.push({ op: 'beam', v: !a.beam });
  return ops;
}

export function stateSummary(S, sim) {
  return {
    mode: S.mode, specimen: S.spec, specimen_name: sim.spec.name, kV: S.kV, defocus_nm: S.df, fov_nm: S.fov, dose: S.dose, thickness_nm: S.thick,
    corrector: S.corrector, Cs_um: +(sim.CsA() / 1e4).toFixed(2), aberrations: { ...S.ab }, holder: S.holder, temperature_K: +sim.temp().toFixed(1),
    convergence_mrad: S.alpha, detector: S.detPreset, detector_mrad: [S.detIn, S.detOut], camera_length_mm: S.camL, tilt_deg: [S.tiltX, S.tiltY],
    clarity: S.clarity, beam: S.paused ? 'blanked' : 'on', wavelength_pm: +(sim.lam * 100).toFixed(4),
    scherzer_defocus_nm: +(P.scherzerDefocus(sim.CsA(), sim.lam) / 10).toFixed(1),
  };
}

const plain = (html) => String(html).replace(/<kbd>(.*?)<\/kbd>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export class ScriptCore {
  // host: { name, S, sim, run(op) → description or result, busy() → reason | null, refresh(), scenarioApi }
  constructor(host) { this.h = host; this.ch = null; }
  get S() { return this.h.S; }
  get sim() { return this.h.sim; }
  guard() { const b = this.h.busy?.(); if (b) throw new Error(b); }
  // advance the simulation so the detectors show the current settings
  settle(steps) {
    const S = this.S, n = steps ?? (S.mode === '4d' ? 400 : S.mode === 'ilh' ? 600 : 12);
    for (let i = 0; i < n; i++) { this.sim.update(0.05); if (S.mode === 'ilh' && this.sim.ilh.st?.it >= this.sim.ilh.st.maxIt) break; }
  }

  // ---------------------------------------------------------------- calls (each takes one object of arguments)
  info() {
    return {
      api: SCRIPT_API, backend: this.h.name, modes: MODES, specimens: SPECS, settings: SETTINGS, analyses: Object.keys(ANALYSES),
      challenges: CHALLENGES.map((id) => ({ id, title: SCENARIOS[id].title })),
      webgpu: typeof navigator !== 'undefined' && !!navigator.gpu, compute: 'cpu',
    };
  }
  state() { return { ...stateSummary(this.S, this.sim), challenge: this.ch?.id ?? null }; }
  set(a = {}) {
    this.guard();
    const done = settingsToOps(a).map((op) => this.h.run(op));
    this.h.refresh?.();
    return done;
  }
  command({ text } = {}) {
    this.guard();
    const r = parseCommand(String(text ?? ''), { paused: this.S.paused, mode: this.S.mode });
    if (!r.ops) return { understood: false, text };
    const done = r.ops.filter((op) => op.op !== 'export').map((op) => this.h.run(op));
    this.h.refresh?.();
    return { understood: true, done };
  }
  // A1, B2, A2 in nm and A3 in µm, each as [magnitude, angle in degrees]; Cs_um sets the corrector's C3
  aberrations(a = {}) {
    this.guard();
    const S = this.S, ab = S.ab;
    for (const [k, v] of Object.entries(a)) {
      if (k === 'Cs_um') { if (!S.corrector) throw new Error('Cs_um needs the corrector on'); S.csCor = +v; continue; }
      if (!['A1', 'B2', 'A2', 'A3'].includes(k)) throw new Error(`unknown aberration ${k}: use A1, B2, A2 (nm), A3 (µm) as [magnitude, angle], or Cs_um`);
      const [m, ang = ab[`${k}a`]] = Array.isArray(v) ? v : [v];
      if (!(m >= 0)) throw new Error(`${k} magnitude must be ≥ 0`);
      ab[k] = +m; ab[`${k}a`] = +ang;
    }
    this.sim.invalidate('ab'); this.sim.invalidate('cs');
    this.h.refresh?.();
    return { ...ab, Cs_um: +(this.sim.CsA() / 1e4).toFixed(3) };
  }
  // record the detectors: the data as a NumPy .npz (bytes), with the array shapes and metadata
  acquire({ steps } = {}) {
    this.guard();
    this.settle(steps);
    const data = collectData(this.sim, this.S);
    if (!Object.keys(data.arrays).length) throw new Error(`nothing to record in ${this.S.mode} mode yet`);
    return { npz: toNpz(data), arrays: Object.fromEntries(Object.entries(data.arrays).map(([k, v]) => [k, v.shape])), meta: data.meta };
  }
  analyze({ name } = {}) {
    this.guard();
    this.settle(3);
    return analyze(this.sim, this.S, name ?? undefined);
  }
  step({ n = 1 } = {}) { this.settle(Math.max(1, Math.min(2000, n | 0))); return { time_s: +(this.sim.clock ?? 0).toFixed(2) }; }

  // ---------------------------------------------------------------- challenges: a training task's hidden misalignment, scored
  challenge({ id, seed } = {}) {
    this.guard();
    if (!CHALLENGES.includes(id)) throw new Error(`challenge must be one of ${CHALLENGES.join(', ')}`);
    const sc = SCENARIOS[id], s = Number.isInteger(seed) ? seed : (Math.random() * 2 ** 31) | 0;
    // the instrument as it was, restored by end_challenge (a new challenge keeps the first snapshot)
    this.saved ??= structuredClone(Object.fromEntries(SESSION_KEYS.filter((k) => k !== 'mis').map((k) => [k, this.S[k]])));
    const info = sc.setup(this.h.scenarioApi, P.mulberry32(s));
    this.sim.invalidate('all');
    this.h.refresh?.();
    this.ch = { id, seed: s, ...info };
    return { id, seed: s, title: sc.title, task: plain(sc.brief), target: info.target };
  }
  score() {
    if (!this.ch) throw new Error('no challenge is running: call challenge() first');
    this.settle(3);
    return SCENARIOS[this.ch.id].metrics(this.h.scenarioApi, this.ch);
  }
  reveal() {
    if (!this.ch) throw new Error('no challenge is running');
    return { id: this.ch.id, seed: this.ch.seed, hidden: this.ch.hidden };
  }
  end_challenge() {
    const was = this.ch?.id ?? null;
    this.ch = null; this.S.mis = null;
    if (this.saved) {
      const st = this.saved; this.saved = null;
      if (this.h.scenarioApi?.restoreState) this.h.scenarioApi.restoreState({ ...st, mis: null });
      else { Object.assign(this.S, structuredClone(st)); this.S.mis = null; }
    }
    this.sim.invalidate('all'); this.h.refresh?.();
    return { ended: was, restored: true };
  }

  // one entry point for remote callers (desktop Python): only these names can be called
  call(name, args = {}) {
    if (!['info', 'state', 'set', 'command', 'aberrations', 'acquire', 'analyze', 'step', 'challenge', 'score', 'reveal', 'end_challenge'].includes(name)) throw new Error(`unknown call ${name}`);
    return this[name](args ?? {});
  }
}

// bytes ↔ base64 for transports that carry JSON
export function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64'); }
