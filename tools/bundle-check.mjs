// Tier 3 (M12), end to end: a job bundle from a tomography session (bundle.js), unpacked and run with its own runner
// (run_job.py, as on a cluster node), and the results read back (readResults: .npz and the zipped OME-Zarr) into the
// tomography viewer. The runner's numpy engine reproduces the browser's reconstruction. Needs python3 + numpy.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { buildBundle, readResults, JOB_FORMAT } from '../js/bundle.js';
import { abtemRequest } from '../js/abtem.js';
import { unzipStored } from '../js/remote.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const root = fileURLToPath(new URL('..', import.meta.url)), runner = readFileSync(join(root, 'tools/hpc/run_job.py'), 'utf8');
const unpack = (files, dir) => { for (const f of files) { const p = join(dir, f.name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.bytes); } };
const run = (dir) => spawnSync('python3', ['run_job.py', 'job.json', '--out', 'results'], { cwd: dir, encoding: 'utf8' });

// ---- tomography: bundle, run, read back
const S = defaultState(); S.mode = 'tomo'; S.tomoPhantom = 'beads'; S.tomoN = 64; S.tomoMax = 60; S.tomoStep = 3; S.tomoDose = 1e7; S.tomoRecon = 'wbp';
const sim = new Sim(S);
sim.startTomo({ instant: true });
const ref = sim.tomoVolume();
const { files, job } = await buildBundle(S, sim, { runner, abtemRequest, version: 'test' });
const names = files.map((f) => f.name);
ok(['session.json', 'specimen.xyz', 'job.json', 'data.npz', 'run.slurm', 'temview-hpc.def', 'run_job.py', 'README.txt'].every((n) => names.includes(n)), `the bundle: ${names.join(', ')}`);
ok(job.format === JOB_FORMAT && job.technique === 'tomo' && job.engine.kind === 'tomo' && job.data?.arrays.tilt_series.join() === `41,64,64`, `job.json: ${job.engine.name} engine, the tilt series [${job.data.arrays.tilt_series}] in data.npz`);
const slurm = new TextDecoder().decode(files.find((f) => f.name === 'run.slurm').bytes);
ok(/#SBATCH --time=\d\d:\d\d:\d\d/.test(slurm) && /#SBATCH --mem=\d+G/.test(slurm) && /apptainer exec .*run_job\.py job\.json/.test(slurm), `run.slurm: ${slurm.match(/--time=\S+/)[0]}, ${slurm.match(/--mem=\S+/)[0]}${/gres=gpu/.test(slurm) ? ', a GPU' : ''}`);
ok(/^Bootstrap: docker/m.test(new TextDecoder().decode(files.find((f) => f.name === 'temview-hpc.def').bytes)), 'temview-hpc.def: an Apptainer recipe');
ok(/^[A-Z][a-z]? /m.test(new TextDecoder().decode(files.find((f) => f.name === 'specimen.xyz').bytes).split('\n').slice(2).join('\n')), 'specimen.xyz: the specimen as atoms');
const dir = mkdtempSync(join(tmpdir(), 'temview-job-'));
unpack(files, dir);
const r = run(dir);
ok(r.status === 0 && existsSync(join(dir, 'results/result.npz')) && existsSync(join(dir, 'results/result.zarr/.zattrs')) && existsSync(join(dir, 'results/result.zarr.zip')), `run_job.py ran the job (exit ${r.status}): ${r.stdout.trim().split('\n').at(-1) ?? r.stderr}`);
const rel = (a, b) => { let d = 0, m = 0; for (let i = 0; i < b.length; i++) { d = Math.max(d, Math.abs(a[i] - b[i])); m = Math.max(m, Math.abs(b[i])); } return d / m; };
for (const file of ['result.npz', 'result.zarr.zip']) {
  const buf = readFileSync(join(dir, 'results', file)), res = await readResults(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const v = res.arrays.reconstruction, pv = res.meta.provenance;
  ok(v?.shape.join() === '64,64,64' && rel(v.data, ref) < 1e-3 && pv.session_sha256 === job.provenance.session_sha256 && pv.engine === 'numpy', `${file} (${res.kind}): the reconstruction = the browser's (rel. ${v ? rel(v.data, ref).toExponential(1) : '—'}), with its provenance (engine ${pv?.engine}, session SHA-256 ${pv?.session_sha256?.slice(0, 8)}…)`);
}
{
  const S2 = defaultState(); S2.mode = 'tomo'; const sim2 = new Sim(S2);
  const buf = readFileSync(join(dir, 'results/result.npz')), res = await readResults(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const out = sim2.importVolume(res.arrays.reconstruction.data, 64, res.meta);
  ok(out.N === 64 && sim2.tomoVolume() && sim2.tomo.rec.method === 'imported' && /numpy/.test(sim2.tomo.rec.device), `imported into the tomography viewer (${sim2.tomo.rec.device})`);
  const odd = new Float32Array(50 ** 3).fill(1), o2 = sim2.importVolume(odd, 50, {});
  ok(o2.N === 64 && o2.resampled && Math.abs(sim2.tomoVolume()[64 ** 3 >> 1] - 1) < 1e-6, 'a 50³ volume is resampled to the nearest viewer size (64³)');
}
// ---- an abTEM job: the request goes in job.json; without abTEM the runner says so (exit 3)
{
  const S3 = defaultState(); S3.mode = 'tem'; S3.spec = 'au';
  const sim3 = new Sim(S3); sim3.update(0.05);
  const b = await buildBundle(S3, sim3, { runner, abtemRequest });
  ok(b.job.engine.kind === 'abtem' && b.job.parameters.request?.format === 'temview-abtem/1' && b.job.parameters.request.preset === 'full', `TEM: an abTEM job with the full preset (${b.job.parameters.request?.mode})`);
  const d3 = mkdtempSync(join(tmpdir(), 'temview-job-')); unpack(b.files, d3);
  const hasAbtem = spawnSync('python3', ['-c', 'import temview_abtem, abtem'], { encoding: 'utf8' }).status === 0;
  if (!hasAbtem) { const r3 = run(d3); ok(r3.status === 3 && JSON.parse(readFileSync(join(d3, 'results/result-error.json'), 'utf8')).engine === 'abtem', 'without abTEM the runner stops with exit 3 and result-error.json names the engine'); }
  else console.log('     (abTEM installed: the TEM job is not run here, it can take minutes)');
}
// ---- a technique whose reconstruction runs elsewhere: parameters only
{
  const S4 = defaultState(); S4.mode = 'spa'; const sim4 = new Sim(S4);
  const b = await buildBundle(S4, sim4, { runner });
  ok(b.job.engine.kind === 'external' && /RELION/.test(b.job.engine.name) && !b.job.data && b.job.resources.wall_seconds > 0, `cryo-EM SPA: parameters for ${b.job.engine.name.split(' (')[0]}, resources ${b.job.resources.memory_gb} GB`);
}
// ---- a zipped OME-Zarr with zlib chunks (other writers): read where DecompressionStream exists
if (typeof DecompressionStream !== 'undefined') {
  const { zip } = await import('../js/npy.js'), { deflateSync } = await import('node:zlib');
  const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]), enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  const z = zip([
    { name: 'x.zarr/.zattrs', bytes: enc({ arrays: ['vol'], temview: { technique: 'tomo' } }) },
    { name: 'x.zarr/vol/.zattrs', bytes: enc({ multiscales: [{ datasets: [{ path: '0' }] }] }) },
    { name: 'x.zarr/vol/0/.zarray', bytes: enc({ shape: [2, 2, 2], chunks: [2, 2, 2], dtype: '<f4', compressor: { id: 'zlib' }, dimension_separator: '.' }) },
    { name: 'x.zarr/vol/0/0.0.0', bytes: new Uint8Array(deflateSync(Buffer.from(a.buffer))) },
  ]);
  const res = await readResults(z.buffer);
  ok(res.arrays.vol.data.join() === a.join(), 'OME-Zarr with zlib chunks reads too');
}
void unzipStored;
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
