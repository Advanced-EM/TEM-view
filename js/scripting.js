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
import { abtemRequest } from './abtem.js';
import { collectData, toNpz } from './export.js';
import { analyze, ANALYSES } from './analyze.js';
import { parseCommand } from './voice.js';
import { SCENARIOS } from './scenarios.js';
import { MODES } from './ops.js';
import { SESSION_KEYS } from './state.js';
import { planFor, validPlanValue, footprintFor, summary as fpSummary } from './footprint.js';
import { buildStructure, beamThickness } from './structure.js';
import { toMSA } from './eels.js';
import { libGoto, stageMove, stagePos } from './ops.js';
import * as ML from './megalibrary.js';

export const SCRIPT_API = 1;
const SPECS = ['au', 'si', 'sto', 'gr', 'mof', 'bio', 'lib', 'hesi', 'cspb', 'mapb'];
// training tasks a script can run as a challenge (the direct-alignment task needs its on-screen controls)
const CHALLENGES = ['tem-focus-stig', 'corrector-ronch'];
const SETTINGS = {
  mode: 'tem, stem, 4d, diff, cbed, eds, eels, ronch, oah, ilh, ltem, lstem', specimen: 'au, si, sto, gr, mof, bio, lib (nanoparticle megalibrary), hesi (He bubbles in Si), cspb (CsPbBr₃ nanocubes), mapb (MAPbBr₃ nanocubes)', kV: '80, 200 or 300',
  defocus_nm: 'C1 in nm, negative is underfocus', fov_nm: 'field of view in nm', dose: 'electrons per Å²', thickness_nm: 'specimen thickness',
  corrector: 'True or False', holder: 'room, ln2, lhe, heat', temperature_K: 'specimen temperature', realistic: 'shot noise and real detectors',
  detector: 'bf, abf, adf, haadf (STEM)', convergence_mrad: 'probe semi-angle', camera_length_mm: 'diffraction camera length',
  tilt_x_deg: 'specimen tilt α', tilt_y_deg: 'specimen tilt β', eels_range: 'zlp, low, core, high', beam: 'True (on) or False (blanked)',
  magnetic_specimen: 'vortex, landau, fege (Lorentz modes)', lorentz_view: 'fresnel, foucault, tie, phase (ltem)', lorentz_defocus_um: 'Lorentz-lens defocus in µm',
  lorentz_fov_um: 'field of view in µm (Lorentz modes)', film_thickness_nm: 'magnetic film thickness', field_mT: 'objective-lens field along the beam',
  divergence_urad: 'illumination divergence (ltem)', foucault: '+x, -x, +y, -y: the deflection the Foucault aperture passes', dpc_view: 'color, x, y, sum (lstem)',
  probe_urad: 'Lorentz-STEM probe semi-angle',
  ed_method: 'cred, step, pedt (3D ED)', ed_range_deg: '[start, end] of the rotation (±70°)', ed_speed_deg_s: 'rotation speed (cred)', ed_fps: 'frame rate (cred)', ed_step_deg: 'tilt step (stills)', ed_exposure_s: 'exposure per still', ed_dose_rate: 'e⁻/Å²/s', ed_axis_deg: 'rotation axis in the image plane', ed_merge: 'friedel or laue',
  zone_axis: '[u, v, w] of the crystal along the beam (SrTiO₃, Au, Si, perovskites), or None for the specimen as built',
  precession_mrad: 'precession semi-angle φ in mrad, 0 for off (SAED, CBED)', precession_steps: 'azimuth steps around the cone', descan_error_pct: 'descan error, % of φ',
  eels_offset_eV: 'energy at the first channel', eels_dispersion: '0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1 eV per channel', eels_window_eV: '[centre, width] of the energy window',
  eels_beta_mrad: 'collection semi-angle β, 1–100 mrad', eels_source: 'profile, schottky, cfeg, mono', eels_detector: 'ccd, direct', dual_eels: 'True or False',
  eels_current_pA: 'probe current', eels_exposure_s: 'exposure per readout', eels_probe: '[i, j] spectrum-image pixel (0–127), or None for the whole field',
};

export function settingsToOps(a) {
  const bad = Object.keys(a).filter((k) => !(k in SETTINGS));
  if (bad.length) throw new Error(`unknown setting ${bad.join(', ')}. Settings: ${Object.keys(SETTINGS).join(', ')}`);
  const ops = [];
  if (a.specimen !== undefined) { if (!SPECS.includes(a.specimen) && !(a.specimen === 'xyz' && P.SPECIMENS.xyz)) throw new Error(`specimen must be one of ${SPECS.join(', ')}${P.SPECIMENS.xyz ? ', xyz' : ' (or xyz after load_xyz)'}`); ops.push({ op: 'spec', v: a.specimen }); }
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
  if (a.magnetic_specimen !== undefined) { if (!['vortex', 'landau', 'fege'].includes(a.magnetic_specimen)) throw new Error('magnetic_specimen must be vortex, landau or fege'); ops.push({ op: 'chip', k: 'magSpec', v: a.magnetic_specimen }); }
  if (a.lorentz_view !== undefined) { if (!['fresnel', 'foucault', 'tie', 'phase'].includes(a.lorentz_view)) throw new Error('lorentz_view must be fresnel, foucault, tie or phase'); ops.push({ op: 'set', k: 'lorView', v: a.lorentz_view }); }
  if (a.dpc_view !== undefined) { if (!['color', 'x', 'y', 'sum'].includes(a.dpc_view)) throw new Error('dpc_view must be color, x, y or sum'); ops.push({ op: 'set', k: 'lstemView', v: a.dpc_view }); }
  if (a.foucault !== undefined) { if (!['+x', '-x', '+y', '-y'].includes(a.foucault)) throw new Error('foucault must be +x, -x, +y or -y'); ops.push({ op: 'set', k: 'lorFouc', v: a.foucault }); }
  if (a.lorentz_defocus_um !== undefined) ops.push({ op: 'set', k: 'lorDf', v: +a.lorentz_defocus_um });
  if (a.lorentz_fov_um !== undefined) ops.push({ op: 'set', k: 'lorFov', v: +a.lorentz_fov_um });
  if (a.film_thickness_nm !== undefined) ops.push({ op: 'set', k: 'lorThick', v: +a.film_thickness_nm });
  if (a.field_mT !== undefined) ops.push({ op: 'set', k: 'lorField', v: +a.field_mT });
  if (a.divergence_urad !== undefined) ops.push({ op: 'set', k: 'lorDiv', v: +a.divergence_urad });
  if (a.probe_urad !== undefined) ops.push({ op: 'set', k: 'lorAlpha', v: +a.probe_urad });
  // 3D ED
  const edMap = { ed_method: 'edMethod', ed_speed_deg_s: 'edSpeed', ed_fps: 'edFps', ed_step_deg: 'edStep', ed_exposure_s: 'edExp', ed_dose_rate: 'edDoseRate', ed_axis_deg: 'edAxis', ed_merge: 'edMerge' };
  for (const [k, key] of Object.entries(edMap)) if (a[k] !== undefined) ops.push({ op: 'set', k: key, v: typeof a[k] === 'string' ? a[k] : +a[k] });
  if (a.ed_range_deg !== undefined) { const [s0, s1] = a.ed_range_deg; ops.push({ op: 'set', k: 'edStart', v: +s0 }, { op: 'set', k: 'edEnd', v: +s1 }); }
  if (a.zone_axis !== undefined) { const z = a.zone_axis; if (z !== null && !(Array.isArray(z) && z.length === 3 && z.every((v) => Number.isInteger(+v)) && z.some((v) => +v !== 0))) throw new Error('zone_axis must be [u, v, w] (integers, not all zero) or None'); ops.push({ op: 'set', k: 'zone', v: z }); }
  // precession (modifier ped): φ > 0 switches it on
  if (a.precession_mrad !== undefined) { const v = +a.precession_mrad; if (!(v >= 0 && v <= 60)) throw new Error('precession_mrad must be 0–60'); ops.push({ op: 'set', k: 'pedOn', v: v > 0 }); if (v > 0) ops.push({ op: 'set', k: 'pedPhi', v }); }
  if (a.precession_steps !== undefined) ops.push({ op: 'set', k: 'pedSteps', v: +a.precession_steps });
  if (a.descan_error_pct !== undefined) ops.push({ op: 'set', k: 'pedDescan', v: +a.descan_error_pct });
  // the EELS spectrometer
  const eelsSet = { eels_offset_eV: 'eelsOffset', eels_beta_mrad: 'eelsBeta', eels_current_pA: 'eelsCurrent', eels_exposure_s: 'eelsExp' };
  for (const [k, key] of Object.entries(eelsSet)) if (a[k] !== undefined) ops.push({ op: 'set', k: key, v: +a[k] });
  if (a.eels_dispersion !== undefined) { if (![0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1].includes(+a.eels_dispersion)) throw new Error('eels_dispersion must be 0.01, 0.025, 0.05, 0.1, 0.25, 0.5 or 1'); ops.push({ op: 'set', k: 'eelsDisp', v: +a.eels_dispersion }); }
  if (a.eels_window_eV !== undefined) { const [c, w] = a.eels_window_eV; ops.push({ op: 'set', k: 'eelsWin', v: +c }); if (w !== undefined) ops.push({ op: 'set', k: 'eelsWidth', v: +w }); }
  if (a.eels_source !== undefined) { if (!['profile', 'schottky', 'cfeg', 'mono'].includes(a.eels_source)) throw new Error('eels_source must be profile, schottky, cfeg or mono'); ops.push({ op: 'set', k: 'eelsSource', v: a.eels_source }); }
  if (a.eels_detector !== undefined) { if (!['ccd', 'direct'].includes(a.eels_detector)) throw new Error('eels_detector must be ccd or direct'); ops.push({ op: 'set', k: 'eelsDet', v: a.eels_detector }); }
  if (a.dual_eels !== undefined) ops.push({ op: 'set', k: 'dualEels', v: !!a.dual_eels });
  if (a.eels_probe !== undefined) ops.push({ op: 'set', k: 'eelsPx', v: a.eels_probe });
  return ops;
}

export function stateSummary(S, sim) {
  return {
    mode: S.mode, specimen: S.spec, specimen_name: sim.spec.name, kV: S.kV, defocus_nm: S.df, fov_nm: S.fov, dose: S.dose, thickness_nm: S.thick,
    corrector: S.corrector, Cs_um: +(sim.CsA() / 1e4).toFixed(2), aberrations: { ...S.ab }, holder: S.holder, temperature_K: +sim.temp().toFixed(1),
    convergence_mrad: S.alpha, detector: S.detPreset, detector_mrad: [S.detIn, S.detOut], camera_length_mm: S.camL, tilt_deg: [S.tiltX, S.tiltY],
    clarity: S.clarity, beam: S.paused ? 'blanked' : 'on', wavelength_pm: +(sim.lam * 100).toFixed(4),
    scherzer_defocus_nm: +(P.scherzerDefocus(sim.CsA(), sim.lam) / 10).toFixed(1), ...stagePos(S),
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
    if (S.mode === '4d') { this.sim.update(0); this.sim.syncCompute?.(); } // a worker scan is finished on this thread
    // 4D-STEM: until the scan is complete (a precessed scan takes ~12× longer), unless steps are given
    const full = S.mode === '4d' && steps == null, N = full ? 20000 : n;
    for (let i = 0; i < N; i++) {
      this.sim.update(0.05);
      if (S.mode === 'ilh' && this.sim.ilh.st?.it >= this.sim.ilh.st.maxIt) break;
      if (full && i >= n && this.sim.fd && this.sim.fd.done >= this.sim.fd.N * this.sim.fd.N) break;
    }
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
  // ---------------------------------------------------------------- the stage, and the nanoparticle megalibrary
  move({ dx_nm = 0, dy_nm = 0 } = {}) { this.guard(); const r = stageMove(this.S, this.sim, +dx_nm, +dy_nm); this.h.refresh?.(); return r; }
  library() { return ML.layout(); }
  // a structure of your own from the text of an XYZ file (Å); it becomes specimen "xyz" and is loaded
  load_xyz({ text, name = 'structure.xyz' } = {}) {
    this.guard();
    const r = P.loadXYZ(text, name);
    this.h.run({ op: 'spec', v: 'xyz' });
    this.h.refresh?.();
    return r;
  }
  goto({ i, j } = {}) {
    this.guard();
    if (this.S.spec !== 'lib') this.h.run({ op: 'spec', v: 'lib' });
    const r = libGoto(this.S, this.sim, i, j);
    this.h.refresh?.();
    return r;
  }
  // the true particle, for scoring an automated screen (like reveal() for a challenge)
  particle({ i, j } = {}) { const t = ML.truth(i, j); if (!t) throw new Error(`particle (${i}, ${j}) is outside the library`); return t; }
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

  // the current state as an abTEM request (tools/abtem-bridge): preset quick|standard|full, algorithm multislice|prism
  abtem_request({ preset = 'quick', algorithm = 'multislice', seed = 0 } = {}) {
    this.guard();
    return abtemRequest(this.S, this.sim, { preset, algorithm, seed });
  }

  // data, dose and compute estimate (footprint.js) for the current technique, or `technique`; `plan` overrides
  // the acquisition plan (scan, det, bits, dwell_us, exposure_s, frames, channels, format, analysis, iters);
  // apply=True keeps those overrides for the technique (saved with the session)
  footprint({ technique, plan = {}, apply = false } = {}) {
    const S = this.S, t = technique ?? S.mode;
    if (!MODES.includes(t)) throw new Error(`technique must be one of ${MODES.join(', ')}`);
    const d = planFor(t);
    for (const [k, v] of Object.entries(plan ?? {})) {
      if (!(k in d) || k === 'kind') throw new Error(`${t} has no plan field ${k}: use ${Object.keys(d).filter((x) => x !== 'kind').join(', ')}`);
      if (!validPlanValue(k, v)) throw new Error(`invalid ${k}: ${JSON.stringify(v)}`);
    }
    if (apply) { this.guard(); S.plan = { ...S.plan, [t]: { ...(S.plan?.[t] ?? {}), ...plan } }; this.h.refresh?.(); }
    const merged = { ...(S.plan?.[t] ?? {}), ...plan };
    return fpSummary(footprintFor({ ...S, mode: t, plan: { ...S.plan, [t]: merged } }, this.sim, this.h.vram ? { vram_bytes: this.h.vram } : {}));
  }

  // the specimen as a 3D structure (structure.js): atoms in the region around the stage, formula, size, and the
  // thickness along the beam including the goniometer tilt (the number footprint() uses)
  structure() {
    const st = buildStructure(this.S, this.sim), bt = beamThickness(this.S, this.sim);
    return {
      name: st.name, kind: st.kind, atoms_in_view: st.total, atoms_drawn: st.count, formula: st.formula,
      species: Object.fromEntries(st.species.filter((s) => s.count).map((s) => [s.label, s.count])),
      size_nm: st.box.map((v) => +(v / 10).toFixed(3)), thickness_nm: +(bt.t_A / 10).toFixed(3), flat_thickness_nm: +(bt.slab_A / 10).toFixed(3),
      t_over_lambda: bt.tau != null ? +bt.tau.toFixed(4) : null, tilt_deg: [this.S.tiltX, this.S.tiltY],
      materials: [...st.voxels.map((v) => v.name), ...new Set(st.shells.map((s) => s.label))], notes: st.notes,
    };
  }

  // the EELS spectrum (and the low-loss one with Dual EELS) as EMSA/MSA text, for HyperSpy or DigitalMicrograph
  export_msa({ steps } = {}) {
    if (this.S.mode !== 'eels') throw new Error('export_msa needs EELS mode: set(mode="eels")');
    this.settle(steps ?? 6);
    const S = this.S, sim = this.sim, e = sim.eels, a = sim.accE, real = S.clarity === 'real';
    const one = (sp, acc, fr, t, tag) => toMSA(real && fr ? Float32Array.from(acc, (v) => v / fr) : Float32Array.from(sp.ro.ro), {
      title: `TEM-view ${sim.spec.short ?? S.spec} EELS ${tag}`, offset: +(sp.E0 + e.dE / 2).toFixed(4), dispersion: e.dE, kV: S.kV, alpha_mrad: S.alpha, beta_mrad: S.eelsBeta, exposure_s: t,
      yunits: real ? 'counts per readout (mean)' : 'counts per readout (expected)', comment: `${sim.eelsDet().label}; source ${S.eelsSource}` });
    return { msa: one(e, a?.spec, a?.frames, S.eelsExp, e.low ? 'core-loss' : 'spectrum'), ...(e.low ? { low_loss_msa: one(e.low, a?.low, a?.framesLow, S.eelsExpLow, 'low-loss') } : {}) };
  }

  // one entry point for remote callers (desktop Python): only these names can be called
  call(name, args = {}) {
    if (!['info', 'state', 'set', 'command', 'aberrations', 'acquire', 'analyze', 'step', 'challenge', 'score', 'reveal', 'end_challenge', 'move', 'library', 'goto', 'particle', 'load_xyz', 'abtem_request', 'footprint', 'structure', 'export_msa'].includes(name)) throw new Error(`unknown call ${name}`);
    return this[name](args ?? {});
  }
}

// bytes ↔ base64 for transports that carry JSON
export function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64'); }
