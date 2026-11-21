// The technique registry is the one list of modes: check that every interface agrees with it and that every
// technique still runs headless.   node tools/registry-check.mjs
import { readFileSync } from 'node:fs';
import { TECHNIQUES, GROUPS, MODE_IDS, KEYS, MODIFIERS, DISPLAY, family } from '../js/registry.js';
import { MODES as OPS_MODES, fam } from '../js/ops.js';
import { VOICE_MODES } from '../js/voice.js';
import { Sim } from '../js/sim.js';
import { defaultState } from '../js/state.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const LEGACY = ['tem', 'stem', '4d', 'diff', 'cbed', 'eds', 'eels', 'ronch', 'oah', 'ilh', 'ltem', 'lstem'];
const LEGACY_KEYS = { tem: '1', stem: '2', '4d': '3', diff: '4', cbed: '5', eds: '6', eels: '7', ronch: '8', oah: '9', ilh: '0', ltem: '-', lstem: '=' };
const LEGACY_PARALLEL = ['tem', 'diff', 'oah', 'ilh', 'ltem'];

ok(new Set(MODE_IDS).size === MODE_IDS.length, 'technique ids are unique');
ok(LEGACY.every((m) => MODE_IDS.includes(m)), 'all twelve legacy ids are still techniques');
ok(LEGACY.every((m) => KEYS[m] === LEGACY_KEYS[m]), 'legacy keyboard shortcuts unchanged');
ok(new Set(Object.values(KEYS)).size === Object.values(KEYS).length, 'shortcut keys are unique');
ok(TECHNIQUES.every((t) => GROUPS.includes(t.group)), 'every technique is in a known group');
ok(DISPLAY.length === TECHNIQUES.length, 'display order lists every technique once');
ok(LEGACY.every((m) => (family(m) === 'tem') === LEGACY_PARALLEL.includes(m)), 'beam families unchanged for legacy modes');
ok(MODIFIERS.every((m) => m.needs.length), 'every modifier names the capabilities it needs');
ok(JSON.stringify(OPS_MODES) === JSON.stringify(MODE_IDS) && fam === family, 'ops.js uses the registry');
ok(MODE_IDS.every((m) => VOICE_MODES.some(([id]) => id === m) || m === 'tem'), 'voice commands cover every technique (TEM by default)');
const mcp = readFileSync(new URL('./temview-mcp/server.mjs', import.meta.url), 'utf8');
ok(/const MODES = MODE_IDS/.test(mcp), 'MCP server takes its mode enum from the registry');
const head = readFileSync(new URL('./headless.mjs', import.meta.url), 'utf8');
ok(/family\(S\.mode\)/.test(head), 'headless runner uses the registry family');

for (const m of MODE_IDS) {
  try {
    const S = defaultState(); S.mode = m; S.df = S.dfFam[family(m)];
    const sim = new Sim(S);
    for (let i = 0; i < 3; i++) sim.update(0.1);
    ok(true, `headless step: ${m}`);
  } catch (e) { ok(false, `headless step: ${m}: ${e.message}`); }
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exitCode = fails ? 1 : 0;
