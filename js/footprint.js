// Data, dose and compute estimator: how big an acquisition is, how long it takes, how much dose it puts on the
// specimen, how much memory its analysis needs, and where that analysis can run (browser, a local GPU worker,
// or an HPC batch job). Pure functions: the exhibit panel, export metadata, Python (scripting.js) and the MCP
// server all call footprint(), so they report the same numbers.
//
// An acquisition plan describes the real experiment (the simulator's own grids are smaller): scan size,
// detector pixels, bit depth, dwell or exposure, frames. Each technique has defaults; S.plan[technique]
// overrides them and is saved with the session (acq.plan).
//
// Formulas (B = bytes per value, e = elementary charge):
//   raw, scanned      Nx·Ny·(values per position)·B           4D-STEM: Nx·Ny·Nk²·B, EELS/EDS: Nx·Ny·channels·B
//   raw, events       N_e·b_evt, N_e = I·t/e, b_evt = 6 bytes
//   raw, camera       frames·N²·B
//   time, scanned     Nx·Ny·τ + Ny·flyback
//   dose, scanned     D = I·τ/(e·Δx²), Δx = field/Nx, from the plan's probe current (pA range: 4D-STEM 20 pA,
//                     STEM 50 pA); EELS uses its own beam-current setting; beam-sensitive specimens are dose-limited,
//                     so I is solved for the dose set in the exhibit unless a current is chosen
//   dose, camera      D per image as set; rate = D/t
//   ePIE working set  3·8·(N_obj² + N_p²) + the diffraction stack as float32, N_obj = field/dx + N_p, dx = λ/(4α)
//   compression       sparse counting data (< 1 e⁻ per pixel per frame) 3–10×, dense data 1.2–2×
//   tomography        a tilt series of scans: tilts·N²·B; volume N³ float32 (N = scan); WBP ≈ tilts·N³·4 flop,
//                     SIRT ≈ iterations·tilts·N³·8 (a projection and a back-projection per iteration)
//   badge (first match)  browser: working set ≤ 512 MB and processing ≤ 60 s; local GPU: ≤ the worker's memory
//                     and ≤ 2 h; HPC otherwise
import { beamThickness } from './structure.js';

export const E_CHARGE = 1.602176634e-19;
export const BROWSER_BYTES = 512 * 2 ** 20;
export const BROWSER_SECONDS = 60;
export const GPU_SECONDS = 2 * 3600;
export const DEFAULT_VRAM = 24 * 2 ** 30; // assumed when no GPU worker is connected
export const RATE = { browser: 1e9, gpu: 5e12 }; // sustained flop/s for FFT-heavy loops (order of magnitude)
export const STREAM = { browser: 200e6, gpu: 20e9 }; // bytes/s for one pass over the data (virtual detectors)
const EVENT_BYTES = 6;

// default plan by technique; `kind` picks the model
const DEFAULTS = {
  tem: { kind: 'camera', det: 4096, bits: 16, exposure_s: 1, frames: 1 },
  stem: { kind: 'scan', scan: 1024, bits: 16, dwell_us: 10, flyback_us: 100, detectors: 1, current_pA: 50 },
  '4d': { kind: '4d', scan: 256, det: 256, bits: 16, dwell_us: 1000, flyback_us: 0, format: 'frames', analysis: 'virtual', iters: 20, current_pA: 20 },
  diff: { kind: 'camera', det: 2048, bits: 16, exposure_s: 1, frames: 1 },
  cbed: { kind: 'camera', det: 2048, bits: 16, exposure_s: 0.5, frames: 1 },
  eds: { kind: 'si', scan: 128, channels: 2048, bits: 16, dwell_us: 50, flyback_us: 100, frames: 1, current_pA: 200 },
  eels: { kind: 'si', scan: 128, channels: 2048, bits: 32, dwell_us: 10000, flyback_us: 100, frames: 1 },
  ronch: { kind: 'camera', det: 1024, bits: 16, exposure_s: 0.1, frames: 1 },
  oah: { kind: 'camera', det: 4096, bits: 16, exposure_s: 4, frames: 1 },
  ilh: { kind: 'camera', det: 4096, bits: 16, exposure_s: 1, frames: 10 },
  ltem: { kind: 'camera', det: 4096, bits: 16, exposure_s: 1, frames: 1 },
  ed3d: { kind: 'camera', det: 512, bits: 16, exposure_s: 0.25, frames: 160 }, // a rotation series (frames from the 3D ED settings)
  tomo: { kind: 'tilt', scan: 1024, bits: 16, dwell_us: 10, flyback_us: 100, current_pA: 50, tilts: 71, recon: 'wbp', iters: 20 }, // a HAADF tilt series (tilts, method from the settings)
  lstem: { kind: 'scan', scan: 256, bits: 32, dwell_us: 20, flyback_us: 100, detectors: 4, current_pA: 5 },
};
export const PLAN_KINDS = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, v.kind]));
// editable plan fields and their allowed values (UI chips, Python validation)
export const PLAN_FIELDS = {
  scan: [64, 128, 256, 512, 1024, 2048, 4096],
  det: [64, 128, 256, 512, 1024, 2048, 4096],
  bits: [8, 16, 32],
  dwell_us: [0.5, 1, 2, 5, 10, 20, 50, 100, 1000, 10000, 100000],
  exposure_s: [0.01, 0.1, 0.5, 1, 2, 4, 10],
  frames: [1, 2, 5, 10, 20, 40, 100],
  channels: [1024, 2048, 4096],
  format: ['frames', 'events'],
  analysis: ['virtual', 'ptycho'],
  iters: [5, 10, 20, 50, 100],
  current_pA: [1, 5, 20, 50, 100, 200, 500],
};

// the plan for a technique: defaults, then the saved overrides that are valid
export function planFor(technique, overrides = {}) {
  const d = DEFAULTS[technique];
  if (!d) throw new Error(`no acquisition plan for ${technique}`);
  const p = { ...d };
  for (const [k, v] of Object.entries(overrides ?? {})) if (k in d && k !== 'kind' && validPlanValue(k, v)) p[k] = v;
  return p;
}
export function validPlanValue(k, v) {
  if (k === 'format' || k === 'analysis') return PLAN_FIELDS[k].includes(v);
  if (k === 'recon') return v === 'wbp' || v === 'sirt';
  return typeof v === 'number' && isFinite(v) && v > 0 && (k !== 'bits' || [8, 16, 32].includes(v));
}

// ---------------------------------------------------------------- small helpers
const log2 = Math.log2;
const fftFlops = (n) => 5 * n * n * log2(n * n); // one 2D complex FFT of n×n
export function fmtBytes(b) {
  if (!isFinite(b)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b < 10 && i ? b.toFixed(2) : b < 100 && i ? b.toFixed(1) : Math.round(b)} ${u[i]}`;
}
export function fmtTime(s) {
  if (!isFinite(s)) return '—';
  if (s < 1e-3) return `${(s * 1e6).toFixed(0)} µs`;
  if (s < 1) return `${(s * 1e3).toFixed(0)} ms`;
  if (s < 120) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
}

// ---------------------------------------------------------------- the estimate
// ctx: { field_A (scanned or imaged field, Å), dose (e⁻/Å² set in the exhibit), current_pA (EELS beam current),
//        lambda_A, alpha_mrad (probe semi-angle), Dc (critical dose e⁻/Å², or null), vram_bytes (connected worker) }
export function footprint(technique, plan, ctx) {
  const p = planFor(technique, plan), B = p.bits / 8, f = { technique, plan: p, notes: [] };
  const field = ctx.field_A, D = ctx.dose;
  let raw, eventsPerPixelFrame = Infinity, procFlops = 0, procBytes = 0;
  const parts = [];

  if (p.kind === 'camera') {
    const n = p.det, img = n * n;
    raw = p.frames * img * B;
    f.shape = p.frames > 1 ? [p.frames, n, n] : [n, n];
    f.time = { acquire_s: p.exposure_s * p.frames };
    f.dose = { total: D * p.frames, per_image: D, rate: D / p.exposure_s, pixel_A: field / n };
    eventsPerPixelFrame = D * (field / n) ** 2;
    parts.push(['frames as float32', p.frames * img * 4], ['FFT buffers', 2 * img * 8]);
    procFlops = p.frames * 2 * fftFlops(n);
  } else {
    const N = p.scan, pos = N * N, dx = field / N, tau = p.dwell_us * 1e-6;
    const tScan = pos * tau + N * p.flyback_us * 1e-6;
    // probe current: EELS uses its own beam-current setting; beam-sensitive specimens are dose-limited (the
    // current is solved for the dose set in the exhibit) unless a current is chosen; otherwise the plan's current
    const doseLimited = technique !== 'eels' && !!ctx.Dc && !(plan && 'current_pA' in plan);
    const I = technique === 'eels' && ctx.current_pA ? ctx.current_pA * 1e-12 : doseLimited || !p.current_pA ? (D * E_CHARGE * dx * dx) / tau : p.current_pA * 1e-12; // A
    f.dose_from = technique === 'eels' ? 'beam current' : doseLimited || !p.current_pA ? 'dose (low-dose)' : 'probe current';
    const Dpix = (I * tau) / (E_CHARGE * dx * dx), ePerPos = (I * tau) / E_CHARGE;
    const reps = p.kind === 'tilt' ? p.tilts : (p.frames ?? 1);
    f.time = { acquire_s: tScan * reps };
    f.dose = { total: Dpix * reps, per_image: Dpix, rate: I / (E_CHARGE * field * field), current_pA: I * 1e12, pixel_A: dx, electrons_per_position: ePerPos };
    if (p.kind === 'tilt') {
      const V = N * N * N;
      raw = p.tilts * pos * B;
      f.shape = [p.tilts, N, N];
      parts.push(['tilt series as float32', p.tilts * pos * 4], ['volume (float32)', V * 4]);
      if (p.recon === 'sirt') { parts.push(['SIRT update and normalisation', 2 * V * 4]); procFlops = p.iters * p.tilts * V * 8; }
      else { parts.push(['filter buffers', 2 * 2 * N * 8]); procFlops = p.tilts * V * 4; }
      f.volume_px = N;
      eventsPerPixelFrame = ePerPos;
    } else if (p.kind === 'scan') {
      raw = pos * p.detectors * B;
      f.shape = p.detectors > 1 ? [p.detectors, N, N] : [N, N];
      parts.push(['images as float32', pos * p.detectors * 4]);
      eventsPerPixelFrame = ePerPos;
    } else if (p.kind === 'si') {
      raw = pos * p.channels * B;
      f.shape = [N, N, p.channels];
      parts.push(['spectrum image as float32', pos * p.channels * 4], ['fit / PCA workspace', 2 * pos * 4 * Math.min(p.channels, 64)]);
      procBytes = pos * p.channels * 4;
      eventsPerPixelFrame = ePerPos / p.channels;
    } else { // 4d
      const K = p.det, frame = K * K;
      eventsPerPixelFrame = ePerPos / frame;
      f.shape = [N, N, K, K];
      if (p.format === 'events') {
        const Ne = I * f.time.acquire_s / E_CHARGE;
        raw = Ne * EVENT_BYTES;
        f.notes.push(`event counting: ${Ne.toExponential(2)} electrons × ${EVENT_BYTES} bytes`);
      } else raw = pos * frame * B;
      const stack = pos * frame * 4;
      if (p.analysis === 'ptycho') {
        const dxr = ctx.lambda_A / (4 * ctx.alpha_mrad * 1e-3); // detector reaching 2α: real-space pixel λ/(2·2α)
        const Nobj = Math.ceil(field / dxr) + K;
        f.object_px = Nobj;
        parts.push(['diffraction stack as float32', stack], ['object, probe and gradients (complex64)', 3 * 8 * (Nobj * Nobj + frame)]);
        procFlops = p.iters * pos * 2 * fftFlops(K);
      } else {
        parts.push(['diffraction stack as stored', pos * frame * B], ['virtual images', 4 * pos * 4]);
        procBytes = pos * frame * B;
      }
    }
  }

  f.raw = { bytes: raw, dtype: p.format === 'events' ? 'events' : { 1: 'uint8', 2: 'uint16', 4: technique === 'eels' ? 'float32' : 'uint32' }[B] };
  const sparse = eventsPerPixelFrame < 1;
  f.compressed = { bytes: sparse ? [raw / 10, raw / 3] : [raw / 2, raw / 1.2], ratio: sparse ? [3, 10] : [1.2, 2], sparse };
  f.working = { bytes: parts.reduce((s, [, b]) => s + b, 0), parts: parts.map(([name, bytes]) => ({ name, bytes })) };
  const proc = (t) => procFlops / RATE[t] + procBytes / STREAM[t];
  f.time.process_s = { browser: proc('browser'), gpu: proc('gpu') };

  // dose against the specimen's critical dose
  if (ctx.Dc) {
    f.dose.Dc = ctx.Dc; f.dose.ratio = f.dose.total / ctx.Dc;
    if (f.dose.ratio > 1) f.notes.push(`total dose ${f.dose.total.toPrecision(3)} e⁻/Å² is ${f.dose.ratio.toFixed(1)}× the critical dose ${ctx.Dc.toPrecision(3)} e⁻/Å²: the structure is destroyed during the acquisition`);
  }
  if (f.dose.current_pA > 1000) f.notes.push(`needs ${f.dose.current_pA.toFixed(0)} pA, more than a sub-ångström probe carries (tens to a few hundred pA): lengthen the dwell or lower the dose`);

  if (ctx.thickness_A) f.specimen = { thickness_A: ctx.thickness_A, tau: ctx.tau ?? null };
  if (ctx.tau > 1) f.notes.push(`t/λ ≈ ${ctx.tau.toFixed(2)} along the beam: plural scattering dominates; spectra and phase need a thinner region`);
  f.badge = badge(f, ctx.vram_bytes);
  return f;
}

// where the analysis can run, with the reason (first match)
export function badge(f, vram) {
  const w = f.working.bytes, tb = f.time.process_s.browser, tg = f.time.process_s.gpu;
  const mem = vram ?? DEFAULT_VRAM, assumed = vram ? '' : ' (no GPU worker connected; assuming 24 GB)';
  const big = f.working.parts.reduce((a, b) => (b.bytes > a.bytes ? b : a), { bytes: 0, name: '' });
  if (w <= BROWSER_BYTES && tb <= BROWSER_SECONDS) return { tier: 'browser', label: 'In browser', reason: `working set ${fmtBytes(w)} within the ${fmtBytes(BROWSER_BYTES)} browser budget, about ${fmtTime(tb)} to process` };
  const why = w > BROWSER_BYTES ? `${big.name} ${fmtBytes(big.bytes)} exceeds the ${fmtBytes(BROWSER_BYTES)} browser budget` : `about ${fmtTime(tb)} to process in the browser (limit ${BROWSER_SECONDS} s)`;
  if (w <= mem && tg <= GPU_SECONDS) return { tier: 'gpu', label: 'Local GPU', reason: `${why}; fits ${fmtBytes(mem)} of GPU memory${assumed}, about ${fmtTime(tg)}` };
  return { tier: 'hpc', label: 'HPC batch', reason: w > mem ? `working set ${fmtBytes(w)} exceeds ${fmtBytes(mem)} of GPU memory${assumed}` : `about ${fmtTime(tg)} on a GPU (limit 2 h)` };
}

// the context for a running exhibit (or headless Sim)
export function contextFor(S, sim, extra = {}) {
  const lor = S.mode === 'ltem' || S.mode === 'lstem';
  return {
    field_A: lor ? S.lorFov * 1e4 : sim.fovA(),
    dose: S.dose, current_pA: S.eelsCurrent, lambda_A: sim.lam, alpha_mrad: S.mode === '4d' ? S.alpha4d : S.alpha,
    Dc: sim.spec?.beamSensitive && !lor ? sim.critDose() : null,
    ...(() => { const b = beamThickness(S, sim); return { thickness_A: b.t_A, tau: b.tau }; })(), // along the beam, with the tilt
    ...extra,
  };
}
export function footprintFor(S, sim, extra = {}) {
  const plan = { ...(S.mode === 'ilh' ? { frames: S.nFocal } : {}), ...(S.plan?.[S.mode] ?? {}) };
  if (S.mode === 'ed3d') { // the series: frames, exposure per frame and the dose per frame from the 3D ED settings
    const p = sim.ed?.series?.plan;
    if (p) { Object.assign(plan, { frames: p.frames, exposure_s: +p.exposure.toFixed(4) }); return footprint('ed3d', plan, contextFor(S, sim, { dose: p.dosePerFrame, field_A: 2000, ...extra })); }
  }
  if (S.mode === 'tomo') { // the series: number of tilts, method and dose per projection from the tomography settings
    const F = sim.tomo?.angles?.length ?? Math.floor(S.tomoMax / S.tomoStep) * 2 + 1;
    Object.assign(plan, { tilts: F, recon: S.tomoRecon, iters: S.tomoIter });
    return footprint('tomo', plan, contextFor(S, sim, { dose: S.tomoDose / F, ...extra }));
  }
  return footprint(S.mode, plan, contextFor(S, sim, extra));
}

// a compact, JSON-friendly summary (export metadata, Python, MCP)
export function summary(f) {
  const r = (x, d = 4) => (typeof x === 'number' ? +x.toPrecision(d) : x);
  return {
    technique: f.technique, plan: f.plan, shape: f.shape, dtype: f.raw.dtype,
    raw_bytes: Math.round(f.raw.bytes), compressed_bytes: f.compressed.bytes.map(Math.round), compression: f.compressed.ratio,
    working_bytes: Math.round(f.working.bytes), working_parts: f.working.parts.map((p) => ({ name: p.name, bytes: Math.round(p.bytes) })),
    acquire_s: r(f.time.acquire_s, 6), process_s: { browser: r(f.time.process_s.browser, 3), gpu: r(f.time.process_s.gpu, 3) },
    dose_e_per_A2: r(f.dose.total), dose_rate_e_per_A2_s: r(f.dose.rate), pixel_A: r(f.dose.pixel_A),
    ...(f.dose.current_pA !== undefined ? { probe_current_pA: r(f.dose.current_pA) } : {}),
    ...(f.dose.Dc ? { critical_dose_e_per_A2: r(f.dose.Dc), dose_over_critical: r(f.dose.ratio, 3) } : {}),
    ...(f.dose_from ? { dose_from: f.dose_from } : {}),
    ...(f.specimen ? { thickness_nm: r(f.specimen.thickness_A / 10), ...(f.specimen.tau != null ? { t_over_lambda: r(f.specimen.tau, 3) } : {}) } : {}),
    tier: f.badge.tier, tier_reason: f.badge.reason, notes: f.notes,
  };
}
