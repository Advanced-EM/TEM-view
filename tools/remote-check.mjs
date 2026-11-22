// Tier 2 (M11): the browser's client (remote.js) against the Python reconstruction service (tools/connect,
// `--adapter recon`), and the Status profiles and limits (resources.js). The service's numpy engine uses the same
// discretisation as tomo.js, so WBP and SIRT must agree with the browser's. Needs python3 with numpy (~20 s).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as TOMO from '../js/tomo.js';
import { RemoteBackend, findCompute } from '../js/remote.js';
import { classify, limitsFor, PROFILES, capFor, benchFFT } from '../js/resources.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const root = fileURLToPath(new URL('..', import.meta.url));

// ---- profiles and limits
{
  const base = { cores: 8, memoryGB: 8, bench: { gflops: 2 }, webgpu: { maxBufferMB: 4096 }, connectors: [] };
  ok(classify(base) === 'strong' && classify({ ...base, webgpu: null }) === 'standard' && classify({ ...base, cores: 2, bench: { gflops: 0.2 } }) === 'basic' && classify({ cores: 8, memoryGB: 8, bench: { gflops: 0.1 } }) === 'basic' && classify({ cores: 4, memoryGB: 8, bench: { gflops: 0.5 } }) === 'standard', 'profiles: strong with WebGPU, standard without, basic on a slow or small device');
  const r = { ...base, webgpu: null, profile: 'standard' };
  let L = limitsFor(r);
  ok(L.tomoN === 128 && L.spaN === PROFILES.standard.limits.spaN, `standard limits: tomography ${L.tomoN}³, ${L.spaN} particles`);
  L = limitsFor({ ...r, profile: 'strong' });
  ok(L.tomoN === 128, '256³ needs WebGPU: without it the strong profile stops at 128³');
  L = limitsFor({ ...r, profile: 'basic', connectors: [{ desc: { acquisitions: ['reconstruct'], modes: ['tomo'] } }] });
  ok(L.tomoN === 256 && L.tomoIter === 100 && L.spaN === PROFILES.basic.limits.spaN, 'a lab computer for reconstructions lifts the tomography limits only');
  ok(capFor(null, 'tomoN') === Infinity && capFor({ limits: { tomoN: 64 } }, 'spaN') === Infinity, 'no profile, or a setting without a limit: unlimited');
  const b = benchFFT(128, 3);
  ok(b.ms > 0 && b.gflops > 0, `benchmark: a 128² FFT in ${b.ms.toFixed(2)} ms (${b.gflops.toFixed(2)} GFLOP/s)`);
}

// ---- the Python service
const port = 18800 + Math.floor(Math.random() * 500);
const py = spawn('python3', ['-m', 'temview_connect.cli', 'serve', '--adapter', 'recon', '--port', String(port), '--log', ''], { cwd: root, env: { ...process.env, PYTHONPATH: `${root}tools/connect` }, stdio: ['ignore', 'pipe', 'pipe'] });
let pyErr = ''; py.stderr.on('data', (d) => (pyErr += d));
try {
  const url = `http://127.0.0.1:${port}`;
  let found = [];
  for (let i = 0; i < 60 && !found.length; i++) { await new Promise((r) => setTimeout(r, 200)); found = await findCompute([url]); }
  ok(found.length === 1 && found[0].desc.kind === 'compute', `found the reconstruction service (${found[0]?.desc.resources?.cpus} CPUs, engines ${Object.entries(found[0]?.desc.engines ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ')})`);
  const be = new RemoteBackend(url, found[0].desc);
  ok(be.takes('tomo') && !be.takes('spa'), 'it takes tomography jobs');

  const ph = TOMO.beadPhantom(48), angles = TOMO.tilts('linear', 60, 3);
  const ser = TOMO.seriesData(TOMO.series({ ph, angles, noise: false }));
  const runRemote = (job) => new Promise((resolve) => {
    const out = {}, t = be.run(job, { out }), its = [];
    const tick = () => { t.pump(); if (out.iter != null) its.push(out.iter); if (t.finished) resolve({ out, t, its }); else setTimeout(tick, 20); };
    tick();
  });
  const rel = (a, b) => { let d = 0, m = 0; for (let i = 0; i < b.length; i++) { d = Math.max(d, Math.abs(a[i] - b[i])); m = Math.max(m, Math.abs(b[i])); } return d / m; };
  {
    const { out, t } = await runRemote({ kind: 'tomo', method: 'wbp', filter: 'ramp', ser });
    const ref = TOMO.wbp(ser, { filter: 'ramp' });
    ok(!t.error && out.x?.length === 48 ** 3 && rel(out.x, ref) < 1e-3, `WBP on the lab computer = WBP in the browser (rel. difference ${out.x ? rel(out.x, ref).toExponential(1) : t.error}; ${out.device})`);
  }
  {
    const { out, t, its } = await runRemote({ kind: 'tomo', method: 'sirt', iterations: 8, ser });
    const st = TOMO.sirtInit(ser, { iterations: 8, positivity: true }); TOMO.sirtStep(st, ser);
    ok(!t.error && rel(out.x, st.x) < 1e-3 && Math.abs(out.resid.at(-1) - st.resid.at(-1)) < 1e-4, `SIRT, 8 iterations, the same as the browser's (rel. ${out.x ? rel(out.x, st.x).toExponential(1) : t.error}; residual ${out.resid?.at(-1)?.toFixed(4)})`);
    ok(new Set(its).size > 3, `progress arrives as server-sent events while it runs (${[...new Set(its)].join(' ')})`);
  }
  {
    const bad = new RemoteBackend(`http://127.0.0.1:${port + 1}`, found[0].desc);
    const out = {}, t = bad.run({ kind: 'tomo', method: 'wbp', ser }, { out });
    for (let i = 0; i < 100 && !t.finished; i++) { await new Promise((r) => setTimeout(r, 30)); t.pump(); }
    ok(t.finished && !!t.error, `a lab computer that is not there reports an error (the exhibit then reconstructs in the browser): ${t.error}`);
  }
} finally { py.kill(); }
if (fails && pyErr) console.log(pyErr.slice(-1500));
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
