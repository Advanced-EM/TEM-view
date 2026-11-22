// Local resources (M11, the Status section at the bottom of the controls): what this computer offers the simulations, and the limits that follow.
//
//   const r = await evaluate({ gpuLabel, urls })   cores, memory, WebGPU and its buffer limits, storage, a quick FFT
//                                                  benchmark, compute connectors found (Tier 2) → r.profile, r.limits
//   capFor(r, key)                                 the largest value allowed for a setting (Infinity: no limit)
//
// Profiles: basic (a phone, an old laptop), standard (a recent laptop), strong (WebGPU with large buffers and a fast
// CPU). The limits keep the heaviest simulations within what the computer finishes in reasonable time; a lab
// computer connected for reconstructions lifts the tomography limits. Visitors can switch the limits off.
import { fft2 } from './kernels.js';
import { findCompute } from './remote.js';

export const PROFILES = {
  basic: { label: 'Basic', text: 'a phone, a tablet or an older laptop', limits: { tomoN: 64, tomoIter: 30, spaN: 2000, ptTilts: 5, ptIters: 8 } },
  standard: { label: 'Standard', text: 'a recent laptop or desktop', limits: { tomoN: 128, tomoIter: 60, spaN: 8000, ptTilts: 7, ptIters: 15 } },
  strong: { label: 'Strong', text: 'WebGPU with large buffers and a fast processor', limits: { tomoN: 256, tomoIter: 100, spaN: 20000, ptTilts: 9, ptIters: 30 } },
};
export const LIMIT_TEXT = { tomoN: ['Tomography volume', (v) => `${v}³`], tomoIter: ['SIRT iterations', (v) => `${v}`], spaN: ['Cryo-EM particles', (v) => v.toLocaleString()], ptTilts: ['Ptycho-tomography tilts', (v) => `${v}`], ptIters: ['MS-ePIE iterations per tilt', (v) => `${v}`] };

// a quick benchmark: the median time of a 256 × 256 complex FFT (the kernel behind multislice, 4D-STEM and SPA)
export function benchFFT(n = 256, reps = 7) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n), t = [];
  for (let i = 0; i < re.length; i++) re[i] = Math.sin(i * 0.37);
  for (let k = 0; k < reps; k++) { const t0 = performance.now(); fft2(re, im, n, k & 1); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  const ms = t[t.length >> 1], flops = 5 * n * n * Math.log2(n * n);
  return { n, ms, gflops: flops / (ms * 1e6) };
}

export function classify(r) {
  const g = r.bench?.gflops ?? 0, cores = r.cores ?? 4, mem = r.memoryGB ?? 8;
  // thresholds from the single-core JS FFT (a 2024 laptop: ~0.5 GFLOP/s; a phone: ~0.1)
  if (g < 0.15 || cores <= 2 || mem <= 2) return 'basic';
  if (r.webgpu && r.webgpu.maxBufferMB >= 1024 && (g >= 0.4 || cores >= 8)) return 'strong';
  return cores >= 4 && g >= 0.25 ? 'standard' : 'basic';
}
export function limitsFor(r) {
  const L = { ...PROFILES[r.profile].limits };
  if (!r.webgpu) L.tomoN = Math.min(L.tomoN, 128); // 256³ needs the GPU kernels
  const lab = r.connectors?.find((c) => (c.desc.acquisitions ?? []).includes('reconstruct') && (c.desc.modes ?? []).includes('tomo'));
  if (lab) Object.assign(L, { tomoN: 256, tomoIter: 100 }); // a lab computer takes the reconstructions
  return L;
}
export const capFor = (r, key) => (r?.limits && key in r.limits ? r.limits[key] : Infinity);

export async function evaluate({ gpuLabel = null, urls = [] } = {}) {
  const nav = globalThis.navigator ?? {};
  const r = { at: new Date().toISOString(), cores: nav.hardwareConcurrency ?? null, memoryGB: nav.deviceMemory ?? null, worker: typeof Worker !== 'undefined', webgpu: null, storage: null, bench: null, connectors: [], ua: nav.userAgent ?? '' };
  const heap = globalThis.performance?.memory?.jsHeapSizeLimit;
  if (heap) r.heapGB = heap / 2 ** 30;
  if (nav.gpu) {
    try {
      const a = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (a) { const info = a.info ?? {}; r.webgpu = { label: gpuLabel || [info.vendor, info.architecture].filter(Boolean).join(' · ') || 'WebGPU', maxBufferMB: a.limits.maxBufferSize / 2 ** 20, maxBindingMB: a.limits.maxStorageBufferBindingSize / 2 ** 20 }; }
    } catch { /* no adapter */ }
  }
  try { const e = await nav.storage?.estimate?.(); if (e) r.storage = { quotaGB: e.quota / 2 ** 30, usageMB: e.usage / 2 ** 20 }; } catch { /* private mode */ }
  r.bench = benchFFT();
  if (urls.length) r.connectors = await findCompute(urls);
  r.profile = classify(r);
  r.limits = limitsFor(r);
  return r;
}
