// Session format check (M1): v1 files load exactly as before, v2 files open in a build that only knows v1,
// and v2 round-trips. Run: node tools/session-check.mjs   (writes the v1 fixtures on first run with --write)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultState, SESSION_KEYS } from '../js/state.js';
import { sanitizeProfile } from '../js/profile.js';
import { HOLDERS } from '../js/holder.js';
import { KEYS, MODE_IDS } from '../js/registry.js';
import * as P from '../js/physics.js';
import { toSession, readSession, activeMods, SESSION_FORMAT } from '../js/session.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'sessions');
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log(`  FAIL ${msg}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The v1 loader as it shipped (main.js before M1), minus the UI calls: what an older build does with a file.
function legacyLoad(o, S) {
  if (!o.format?.startsWith('tem-view-session') || !o.state) throw new Error('not a TEM-view session or profile');
  const st = o.state, d = defaultState(), mode = typeof st.mode === 'string' && KEYS[st.mode] ? st.mode : S.mode;
  if (st.cryo === true && !st.holder) { st.holder = 'ln2'; st.tempSet = 90; }
  for (const k of SESSION_KEYS) {
    if (!(k in st) || k === 'mode') continue;
    if (k === 'holder' && !HOLDERS[st.holder]) continue;
    if (k === 'profile') S.profile = sanitizeProfile(st.profile);
    else if (k === 'spec') { if (P.SPECIMENS[st.spec]) S.spec = st.spec; }
    else if (k === 'ab' || k === 'dfFam') { if (st[k] && typeof st[k] === 'object') S[k] = { ...d[k], ...Object.fromEntries(Object.entries(st[k]).filter(([, v]) => typeof v === 'number')) }; }
    else if (typeof st[k] === typeof d[k]) S[k] = st[k];
  }
  S.mode = mode;
  return S;
}
const pick = (S) => Object.fromEntries(SESSION_KEYS.map((k) => [k, S[k]]));
const v1 = (state) => ({ format: 'tem-view-session/1', saved: '2026-01-01T00:00:00.000Z', note: 'fixture', state });

// v1 fixtures: every technique, the Zernike plate, the old cryo flag, holders, junk values, partial files
function fixtures() {
  const d = defaultState(), base = pick(d), f = {};
  for (const m of MODE_IDS) f[`mode-${m}`] = v1({ ...base, mode: m });
  f['tem-zpp'] = v1({ ...base, mode: 'tem', spec: 'bio', objAp: 'zpp', df: 0 });
  f['stem-with-zpp-left-in'] = v1({ ...base, mode: 'stem', objAp: 'zpp' });
  f['tem-darkfield'] = v1({ ...base, mode: 'tem', objAp: 'df' });
  f['cryo-flag-pre-holder'] = v1((() => { const s = { ...base, mode: 'tem', spec: 'bio', cryo: true }; delete s.holder; delete s.tempSet; return s; })());
  f['heating-holder'] = v1({ ...base, mode: 'tem', holder: 'heat', tempSet: 900 });
  f['junk-values'] = v1({ ...base, mode: 'warp', holder: 'teleporter', spec: 'unobtanium', kV: '300', ab: { A1: 5, A1a: 'x' }, dfFam: null, mis: { A1: 2 } });
  f['partial'] = v1({ mode: 'diff', kV: 80, spec: 'au' });
  f['misaligned'] = v1({ ...base, mode: 'ronch', ab: { ...d.ab, A1: 40, A1a: 30, B2: 900 }, mis: { A1: 12, A1a: 10 } });
  return f;
}

if (process.argv.includes('--write') || !existsSync(DIR)) {
  mkdirSync(DIR, { recursive: true });
  for (const [k, o] of Object.entries(fixtures())) writeFileSync(join(DIR, `v1-${k}.json`), JSON.stringify(o, null, 1));
  console.log(`wrote v1 fixtures to ${DIR}`);
}
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
console.log(`session check: ${files.length} saved files, writer ${SESSION_FORMAT}`);

for (const f of files) {
  const o = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  // 1. a v1 file loads identically (starting from a non-default state, as in a running exhibit)
  const start = () => { const S = defaultState(); S.mode = 'eels'; S.kV = 120; return S; };
  const old = pick(legacyLoad(structuredClone(o), start()));
  const { state, warnings } = readSession(structuredClone(o), start());
  ok(same(old, pick(state)), `${f}: v1 loads differently`);
  if (o.state.objAp === 'zpp') ok(state.objAp === 'zpp' && activeMods(state).zpp === true, `${f}: plate not carried as mods.zpp`);
  // 2. re-saved as v2: an older build opens it to the same state, and v2 reads it back to the same state
  const v2 = JSON.parse(JSON.stringify(toSession(state)));
  ok(v2.format === SESSION_FORMAT && v2.technique === state.mode, `${f}: v2 header`);
  ok(!!v2.mods.zpp === (state.objAp === 'zpp'), `${f}: v2 mods.zpp`);
  ok(same(pick(legacyLoad(structuredClone(v2), start())), pick(state)), `${f}: older build opens v2 differently`);
  ok(same(pick(readSession(v2, start()).state), pick(state)), `${f}: v2 round trip`);
  console.log(`  ok ${f}${warnings.length ? `  (${warnings.join('; ')})` : ''}`);
}

// 3. v2 blocks win over the mirror: a file edited by a script behaves as written
{
  const S = defaultState(); S.mode = 'tem'; S.objAp = 'zpp';
  const v2 = toSession(S);
  v2.technique = 'diff'; v2.acq.kV = 80; v2.env = { holder: 'lhe', tempSet: 12 }; v2.mods = {};
  const r = readSession(v2);
  ok(r.state.mode === 'diff' && r.state.kV === 80 && r.state.holder === 'lhe' && r.state.tempSet === 12, 'v2 blocks override the mirror');
  ok(r.state.objAp === 'none' && !r.mods.zpp, 'mods {} switches the plate off');
  ok(readSession({ ...v2, mods: { zpp: true, ped: { angle_mrad: 20 } } }).mods.ped?.angle_mrad === 20, 'ped modifier carried');
  ok(readSession({ ...v2, mods: { warp: 1 } }).warnings.some((w) => w.includes('warp')), 'unknown modifier reported');
  const pl = readSession({ ...v2, acq: { ...v2.acq, plan: { '4d': { scan: 512, bits: 8, kind: 'x', det: -3 }, warp: { scan: 1 } } } });
  ok(same(pl.state.plan, { '4d': { scan: 512, bits: 8 } }) && pl.warnings.some((w) => w.includes('warp')), 'acq.plan sanitized');
  ok(same(readSession(JSON.parse(JSON.stringify(toSession({ ...S, plan: { stem: { dwell_us: 2 } } })))).state.plan, { stem: { dwell_us: 2 } }), 'acq.plan round trip');
  let threw = false; try { readSession({ format: 'tem-view-profile/1' }); } catch { threw = true; }
  ok(threw, 'non-session rejected');
  console.log('  ok v2 blocks, modifiers, rejection');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
