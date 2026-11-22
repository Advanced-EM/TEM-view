// Tier 3 (M12): a job bundle for a cluster (temview-job/1), and reading the results back.
//
//   const { files, job } = await buildBundle(S, sim, { runner })     files: [{ name, bytes }] for npy.zip()
//
// The bundle is a zip: session.json (tem-view-session/2), specimen.xyz (the current specimen's 3D model), job.json
// (technique, engine, full-resolution parameters from the footprint estimate, provenance with the session's SHA-256),
// data.npz (the recorded tilt series, for tomography), run.slurm (resources from the estimate), temview-hpc.def (an
// Apptainer recipe), run_job.py (tools/hpc: needs only NumPy) and a README. Nothing in the browser holds cluster
// credentials: the bundle is downloaded and submitted by hand (sbatch run.slurm).
//
//   readResults(arrayBuffer) → { arrays: {name: {data, shape}}, meta }   a result.npz, or a zipped OME-Zarr written by
//                                                                          run_job.py (uncompressed or zlib chunks)
import { toSession } from './session.js';
import { footprintFor, fmtBytes, fmtTime } from './footprint.js';
import { buildStructure } from './structure.js';
import { readNpy } from './npy.js';
import { unzipStored } from './remote.js';

export const JOB_FORMAT = 'temview-job/1';
const enc = new TextEncoder();
const text = (name, s) => ({ name, bytes: enc.encode(s) });

async function sha256(bytes) {
  if (globalThis.crypto?.subtle) { const h = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}
// a .npy file (little-endian float32) for the bundle's data.npz
export function npy(f32, shape) {
  const hdr = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const pad = 64 - ((10 + hdr.length + 1) % 64), h = hdr + ' '.repeat(pad) + '\n', out = new Uint8Array(10 + h.length + f32.byteLength);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, h.length & 255, h.length >> 8]); out.set(enc.encode(h), 10);
  out.set(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength), 10 + h.length);
  return out;
}

// the engine and full-resolution parameters for the current technique
function engineFor(S, sim, f) {
  const p = f.plan;
  if (S.mode === 'tomo') {
    const T = sim.tomo;
    return { engine: { kind: 'tomo', name: S.tomoRecon === 'sirt' ? 'astra' : 'numpy', fallback: 'numpy' },
      parameters: { method: S.tomoRecon, iterations: S.tomoIter, filter: S.tomoFilter, voxel_A: T?.ph?.vox ?? null, gpu: true, full_scale: { scan: p.scan, tilts: p.tilts, recon: p.recon, iters: p.iters } },
      runnable: !!(T?.ser && T.ser.proj.length === T.angles.length) };
  }
  if (['tem', 'stem', '4d', 'diff', 'cbed'].includes(S.mode)) {
    return { engine: { kind: 'abtem', name: 'abtem' }, parameters: { request: null, full_scale: p }, runnable: true, abtem: true };
  }
  const ext = { spa: 'RELION or cryoSPARC (particle stack and CTF from the session)', ptychotomo: 'py4DSTEM or PtyRAD (joint multi-tilt multislice ptychography)', ed3d: 'DIALS or XDS (rotation series)' }[S.mode];
  return { engine: { kind: 'external', name: ext ?? 'your own pipeline' }, parameters: { full_scale: p }, runnable: false };
}

export async function buildBundle(S, sim, { runner = '', abtemRequest = null, version = 'dev' } = {}) {
  const f = footprintFor(S, sim), files = [];
  const sessionBytes = enc.encode(JSON.stringify(toSession(S), null, 1));
  files.push({ name: 'session.json', bytes: sessionBytes });
  try { // the specimen's 3D model as the structure viewer builds it (atoms; amorphous layers are described in job.json)
    const st = buildStructure(S, sim), sym = st.species.map((sp) => sp.sym), lines = [String(st.count), `TEM-view specimen ${S.spec}: ${st.name ?? ''}${st.truncated ? ` (first ${st.count} of ${st.total} atoms)` : ''} (Å; beam along −z)`];
    for (let k = 0; k < st.count; k++) lines.push(`${sym[st.el[k]]} ${st.pos[3 * k].toFixed(4)} ${st.pos[3 * k + 1].toFixed(4)} ${st.pos[3 * k + 2].toFixed(4)}`);
    files.push(text('specimen.xyz', lines.join('\n') + '\n'));
  } catch { /* no 3D model for this specimen */ }
  const e = engineFor(S, sim, f);
  if (e.abtem) { try { e.parameters.request = abtemRequest ? abtemRequest(S, sim, { preset: 'full' }) : null; } catch (err) { e.runnable = false; e.parameters.why = String(err.message ?? err); } }
  let data = null;
  if (S.mode === 'tomo' && e.runnable) {
    const T = sim.tomo, N = T.ph.N, n = T.ser.proj.length, st = new Float32Array(n * N * N);
    T.ser.proj.forEach((p, i) => st.set(p, i * N * N));
    const { zip } = await import('./npy.js');
    files.push({ name: 'data.npz', bytes: zip([{ name: 'tilt_series.npy', bytes: npy(st, [n, N, N]) }, { name: 'angles_deg.npy', bytes: npy(Float32Array.from(T.angles.slice(0, n)), [n]) }]) });
    data = { file: 'data.npz', arrays: { tilt_series: [n, N, N], angles_deg: [n] } };
  }
  const gpuS = f.time.process_s.gpu, wall = Math.min(48 * 3600, Math.max(900, Math.ceil(3 * gpuS + 600)));
  const memGB = Math.max(4, Math.ceil((1.5 * f.working.bytes) / 2 ** 30) + 2), useGPU = gpuS > 1 || e.engine.kind !== 'external';
  const job = {
    format: JOB_FORMAT, created: new Date().toISOString(), technique: S.mode, ...e, data,
    resources: { tier: f.badge.tier, tier_reason: f.badge.reason, raw_bytes: Math.round(f.raw.bytes), working_bytes: Math.round(f.working.bytes), gpu_seconds_estimate: +gpuS.toPrecision(3), memory_gb: memGB, wall_seconds: wall },
    outputs: ['result.npz', 'result.zarr', 'result.zarr.zip', 'result.h5'],
    provenance: { temview: version, session_format: 'tem-view-session/2', session_sha256: await sha256(sessionBytes), specimen: S.spec, kV: S.kV },
  };
  files.push(text('job.json', JSON.stringify(job, null, 1)));
  const hms = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':');
  files.push(text('run.slurm', `#!/bin/bash
# TEM-view job bundle (${JOB_FORMAT}): ${S.mode}. Resources from TEM-view's footprint estimate
# (${f.badge.label}: ${f.badge.reason}). Edit the partition and account for your cluster, then: sbatch run.slurm
#SBATCH --job-name=temview-${S.mode}
#SBATCH --time=${hms(wall)}
#SBATCH --mem=${memGB}G
#SBATCH --cpus-per-task=8
${useGPU ? '#SBATCH --gres=gpu:1\n' : ''}#SBATCH --output=temview-%j.log
##SBATCH --partition=gpu
##SBATCH --account=your-allocation
set -euo pipefail
cd "\${SLURM_SUBMIT_DIR:-.}"
# build the image once: apptainer build temview-hpc.sif temview-hpc.def
apptainer exec ${useGPU ? '--nv ' : ''}temview-hpc.sif python3 run_job.py job.json --out results
`));
  files.push(text('temview-hpc.def', `Bootstrap: docker
From: condaforge/miniforge3:24.9.2-0
# The image for TEM-view job bundles (${JOB_FORMAT}). Pin the versions you validate; record them with your results.
%files
    run_job.py /opt/temview/run_job.py
%post
    mamba install -y -c conda-forge -c astra-toolbox python=3.11 numpy scipy h5py astra-toolbox
    pip install --no-cache-dir abtem "git+https://github.com/Advanced-EM/temview-abtem"
    mamba clean -afy
%environment
    export PYTHONUNBUFFERED=1
%labels
    org.temview.format ${JOB_FORMAT}
%help
    apptainer exec --nv temview-hpc.sif python3 run_job.py job.json --out results
`));
  if (runner) files.push(text('run_job.py', runner));
  files.push(text('README.txt', `TEM-view job bundle (${JOB_FORMAT}) · ${S.mode} · ${job.created}
session.json   the exhibit's session (tem-view-session/2); its SHA-256 is in job.json
specimen.xyz   the specimen's 3D model (Å)
job.json       technique, engine (${e.engine.name}), full-resolution parameters, resources, provenance
${data ? 'data.npz       the recorded tilt series and its angles\n' : ''}run.slurm      a Slurm script (time ${hms(wall)}, ${memGB} GB${useGPU ? ', one GPU' : ''}): edit the partition, then sbatch run.slurm
temview-hpc.def an Apptainer recipe: apptainer build temview-hpc.sif temview-hpc.def
run_job.py     the runner (NumPy; ASTRA, abTEM, h5py when installed); also runs on a workstation:
               python3 run_job.py job.json --out results
Results: results/result.npz, results/result.zarr (OME-Zarr) and result.zarr.zip, result.h5. Load result.npz or
result.zarr.zip into the exhibit (Data, dose and compute → Load results) to view it with its provenance.
${e.runnable ? '' : `This technique's reconstruction runs in ${e.engine.name}; the runner records the parameters but does not run it.\n`}Estimated: ${fmtBytes(f.raw.bytes)} of data, ${fmtBytes(f.working.bytes)} working set, ~${fmtTime(gpuS)} on a GPU.
`));
  return { files, job };
}

// ---------------------------------------------------------------- results back into the exhibit
async function inflate(buf) { // zlib (deflate) chunks, where the browser has DecompressionStream
  const ds = new DecompressionStream('deflate'), s = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(s).arrayBuffer()).buffer;
}
export async function readResults(buf) {
  const files = unzipStored(buf), names = Object.keys(files);
  if (files['metadata.json']) { // TEM-view .npz
    const arrays = {};
    for (const n of names) if (n.endsWith('.npy')) arrays[n.slice(0, -4)] = readNpy(files[n]);
    return { arrays, meta: JSON.parse(new TextDecoder().decode(files['metadata.json'])), kind: 'npz' };
  }
  const zattrsName = names.find((n) => /(^|\/)result\.zarr\/\.zattrs$|^[^/]+\.zarr\/\.zattrs$/.test(n)) ?? names.find((n) => n.endsWith('.zarr/.zattrs'));
  if (!zattrsName) throw new Error('not a TEM-view result (.npz) or a zipped OME-Zarr');
  const root = zattrsName.slice(0, -'.zattrs'.length), top = JSON.parse(new TextDecoder().decode(files[zattrsName])), arrays = {};
  for (const name of top.arrays ?? []) {
    const g = JSON.parse(new TextDecoder().decode(files[`${root}${name}/.zattrs`])), path = g.multiscales[0].datasets[0].path;
    const za = JSON.parse(new TextDecoder().decode(files[`${root}${name}/${path}/.zarray`]));
    if (za.dtype !== '<f4' && za.dtype !== '<f8') throw new Error(`OME-Zarr dtype ${za.dtype} is not supported`);
    if (za.chunks.join() !== za.shape.join()) throw new Error('OME-Zarr with several chunks per array is not supported here (write it with run_job.py)');
    let chunk = files[`${root}${name}/${path}/${za.shape.map(() => '0').join(za.dimension_separator ?? '.')}`];
    if (za.compressor?.id === 'zlib') chunk = await inflate(chunk);
    else if (za.compressor) throw new Error(`OME-Zarr compressor ${za.compressor.id} is not supported (use none or zlib)`);
    const T = za.dtype === '<f4' ? Float32Array : Float64Array;
    arrays[name] = { data: Float32Array.from(new T(chunk)), shape: za.shape };
  }
  return { arrays, meta: top.temview ?? {}, kind: 'ome-zarr' };
}
