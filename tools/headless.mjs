// Run the simulator without a browser and save what a detector records as a NumPy .npz.
//   node tools/headless.mjs --mode tem --spec bio --cryo --kV 300 --df -1500 --out tem.npz
//   node tools/headless.mjs --session my-session.json --out run.npz
// Options: --mode, --spec, --kV, --df (nm), --dose, --thick (nm), --fov (nm), --cryo, --real (shot noise),
// --session <file saved from the exhibit>, --steps <n>, --out <file.npz>.
// Load the result with numpy.load(); metadata.json inside the archive holds calibrations and state.
import { readFileSync, writeFileSync } from 'node:fs';
import { Sim } from '../js/sim.js';
import { defaultState, SESSION_KEYS } from '../js/state.js';
import { sanitizeProfile } from '../js/profile.js';
import * as P from '../js/physics.js';
import { collectData, toNpz } from '../js/export.js';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) { const k = args[i].slice(2), v = args[i + 1]; if (!v || v.startsWith('--')) opt[k] = true; else { opt[k] = v; i++; } }

const S = defaultState();
if (opt.session) {
  const ses = JSON.parse(readFileSync(opt.session, 'utf8'));
  for (const k of SESSION_KEYS) if (k in (ses.state ?? {})) S[k] = k === 'profile' ? sanitizeProfile(ses.state.profile) : ses.state[k];
}
if (opt.spec) { if (!P.SPECIMENS[opt.spec]) throw new Error(`unknown specimen ${opt.spec}`); const sp = P.SPECIMENS[opt.spec]; S.spec = opt.spec; S.fov = sp.fov; [S.cx, S.cy] = sp.center; }
for (const k of ['kV', 'dose', 'thick', 'fov']) if (opt[k] !== undefined) S[k] = +opt[k];
if (opt.mode) S.mode = opt.mode;
const fam = ['tem', 'diff', 'oah', 'ilh'].includes(S.mode) ? 'tem' : 'probe';
S.df = opt.df !== undefined ? +opt.df : S.dfFam[fam];
if (opt.cryo) S.cryo = true;
if (opt.real) S.clarity = 'real';

const sim = new Sim(S);
const steps = +(opt.steps ?? (S.mode === '4d' ? 400 : S.mode === 'ilh' ? 600 : 10));
const t0 = performance.now();
for (let i = 0; i < steps; i++) {
  sim.update(0.05);
  if (S.mode === 'ilh' && sim.ilh.st?.it >= sim.ilh.st.maxIt) break;
}
const data = collectData(sim, S);
const out = opt.out ?? `${S.mode}-${S.spec}.npz`;
writeFileSync(out, toNpz(data));
console.log(`${S.mode} on ${sim.spec.name}${S.cryo ? ' (cryo)' : ''}: ${Object.keys(data.arrays).join(', ')} → ${out} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
