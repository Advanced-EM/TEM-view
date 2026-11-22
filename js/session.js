// Saved sessions: one writer and one reader for the exhibit, the headless runner and export metadata.
//
// tem-view-session/2 adds structured blocks on top of the v1 file:
//   technique  the registry id (registry.js); replaces state.mode
//   mods       cross-cutting modifiers by id, e.g. { zpp: true } (the Zernike plate was objAp: 'zpp' in v1)
//   acq        how the data is acquired: beam energy, dose, detector, realism
//   env        the specimen environment: holder and setpoint (in situ cells will extend this block)
//   state      the complete v1 state, kept as a mirror so a build that only reads v1 opens v2 files
//              (legacy techniques load exactly as saved; newer fields are ignored there)
// Reading: the blocks win over the mirror, so a v2 file edited by hand or by a script behaves as written.
import { defaultState, SESSION_KEYS } from './state.js';
import { isMode, MODIFIERS, modifiersFor } from './registry.js';
import { sanitizeProfile } from './profile.js';
import { HOLDERS } from './holder.js';
import * as P from './physics.js';
import { planFor, validPlanValue } from './footprint.js';

export const SESSION_FORMAT = 'tem-view-session/2';
export const ACQ_KEYS = ['kV', 'dose', 'camera', 'clarity']; // plus acq.plan (footprint.js overrides by technique)
export const ENV_KEYS = ['holder', 'tempSet'];
const MOD_IDS = new Set(MODIFIERS.map((m) => m.id));

// modifiers in effect for a state. The Zernike plate still lives in the objective-aperture slot of the
// running state (it occupies the back focal plane), and is written to files as mods.zpp.
export function activeMods(S) {
  const mods = {};
  for (const [k, v] of Object.entries(S.mods ?? {})) if (MOD_IDS.has(k) && k !== 'zpp' && k !== 'ped' && v) mods[k] = v;
  if (S.objAp === 'zpp') mods.zpp = true;
  if (S.pedOn) mods.ped = { phi_mrad: S.pedPhi, steps: S.pedSteps, descan_pct: S.pedDescan }; // precession (pedOn, pedPhi, ...)
  return mods;
}

// the v1 key set of a state (the mirror, scripting snapshots, export metadata)
export const snapshot = (S, keys = SESSION_KEYS) => structuredClone(Object.fromEntries(keys.map((k) => [k, S[k]])));

export function toSession(S, extra = {}) {
  const state = snapshot(S);
  return {
    format: SESSION_FORMAT, saved: new Date().toISOString(), note: 'Seeing with Electrons (TEM-view) session', ...extra,
    technique: S.mode, mods: activeMods(S),
    acq: { ...Object.fromEntries(ACQ_KEYS.map((k) => [k, S[k]])), plan: structuredClone(S.plan ?? {}) },
    env: Object.fromEntries(ENV_KEYS.map((k) => [k, S[k]])),
    state,
  };
}

export const isSession = (o) => typeof o?.format === 'string' && o.format.startsWith('tem-view-session') && !!o.state && typeof o.state === 'object';

// Turn a v1 or v2 file into a sanitized state: only known keys, values of the right type, defaults for the
// rest. Returns { state, technique, mods, version, warnings }. `base` supplies values the file does not set.
export function readSession(o, base = defaultState()) {
  if (!isSession(o)) throw new Error('not a TEM-view session');
  const version = +(o.format.split('/')[1] ?? 1) || 1, warnings = [];
  const st = { ...o.state }, d = defaultState(), out = structuredClone(base);
  // v1 migrations
  if (st.cryo === true && !st.holder) { st.holder = 'ln2'; st.tempSet = 90; } // sessions saved before the temperature setting
  // v2 blocks override the mirror
  if (version >= 2) {
    if (typeof o.technique === 'string') st.mode = o.technique;
    for (const blk of ['acq', 'env']) if (o[blk] && typeof o[blk] === 'object') Object.assign(st, o[blk]);
  }
  for (const k of SESSION_KEYS) {
    if (!(k in st)) continue;
    const v = st[k];
    if (k === 'mode') { if (isMode(v)) out.mode = v; else warnings.push(`unknown technique ${v}`); }
    else if (k === 'holder') { if (HOLDERS[v]) out.holder = v; else warnings.push(`unknown holder ${v}`); }
    else if (k === 'profile') out.profile = sanitizeProfile(v);
    else if (k === 'spec') { if (P.SPECIMENS[v]) out.spec = v; else warnings.push(`unknown specimen ${v}`); }
    else if (k === 'mis') out.mis = v && typeof v === 'object' ? v : null;
    else if (k === 'ab' || k === 'dfFam') { if (v && typeof v === 'object') out[k] = { ...d[k], ...Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')) }; }
    else if (typeof v === typeof d[k]) out[k] = v;
  }
  // modifiers: v2 mods block, else what the v1 state implies
  const mods = version >= 2 && o.mods && typeof o.mods === 'object' ? o.mods : (st.objAp === 'zpp' ? { zpp: true } : {});
  out.mods = {};
  for (const [k, v] of Object.entries(mods)) {
    if (!MOD_IDS.has(k)) { warnings.push(`unknown modifier ${k}`); continue; }
    if (k === 'zpp' || k === 'ped') continue;
    if (v) out.mods[k] = v;
  }
  // precession: mods.ped in a v2 file sets the precession keys (absent: off)
  if (version >= 2) {
    const p = mods.ped && typeof mods.ped === 'object' ? mods.ped : null, num = (x, lo, hi, d) => (Number.isFinite(+x) ? Math.min(hi, Math.max(lo, +x)) : d);
    out.pedOn = !!p;
    if (p) { out.pedPhi = num(p.phi_mrad, 0, 60, d.pedPhi); out.pedSteps = Math.round(num(p.steps, 4, 128, d.pedSteps)); out.pedDescan = num(p.descan_pct, 0, 20, d.pedDescan); }
  }
  if (mods.zpp) out.objAp = 'zpp';
  else if (out.objAp === 'zpp') out.objAp = 'none'; // a v2 file that switched the plate off in mods
  // zone axis: three small integers, not all zero (anything else: as built)
  if (!(Array.isArray(out.zone) && out.zone.length === 3 && out.zone.every((v) => Number.isInteger(v) && Math.abs(v) <= 9) && out.zone.some((v) => v))) out.zone = null;
  // acquisition plan overrides: known techniques and fields with valid values only
  out.plan = {};
  const plan = version >= 2 && o.acq?.plan && typeof o.acq.plan === 'object' ? o.acq.plan : {};
  for (const [t, ov] of Object.entries(plan)) {
    if (!isMode(t) || !ov || typeof ov !== 'object') { warnings.push(`plan for unknown technique ${t}`); continue; }
    const d = planFor(t), keep = Object.fromEntries(Object.entries(ov).filter(([k, v]) => k in d && k !== 'kind' && validPlanValue(k, v)));
    if (Object.keys(keep).length !== Object.keys(ov).length) warnings.push(`plan for ${t}: invalid fields dropped`);
    if (Object.keys(keep).length) out.plan[t] = keep;
  }
  // a modifier that the technique cannot take is kept (it applies again on switching back) but reported
  const ok = new Set(modifiersFor(out.mode).map((m) => m.id));
  for (const k of Object.keys(activeMods(out))) if (!ok.has(k)) warnings.push(`${k} has no effect in ${out.mode}`);
  return { state: out, technique: out.mode, mods: activeMods(out), version, warnings };
}
