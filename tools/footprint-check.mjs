// Footprint estimator check (M2): every number against a hand calculation. Run: node tools/footprint-check.mjs
import { footprint, footprintFor, planFor, summary, E_CHARGE } from '../js/footprint.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { wavelength } from '../js/physics.js';
import { MODE_IDS } from '../js/registry.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300);
const ctx = (o = {}) => ({ field_A: 50, dose: 400, current_pA: 100, lambda_A: wavelength(200), alpha_mrad: 20, Dc: null, ...o });

// 4D-STEM, 256² scan, 256² detector, uint16, 1 ms dwell, 5 nm field, 400 e⁻/Å²
{
  const f = footprint('4d', { scan: 256, det: 256, bits: 16, dwell_us: 1000 }, ctx());
  ok(f.raw.bytes === 256 * 256 * 256 * 256 * 2, `4D raw = 256⁴·2 = 8 589 934 592 B (${f.raw.bytes})`);
  ok(near(f.time.acquire_s, 65.536), `4D time = 65 536 × 1 ms = 65.536 s (${f.time.acquire_s})`);
  // inorganic: the plan's 20 pA probe sets the dose
  const dx = 50 / 256, Dpa = (20e-12 * 1e-3) / (E_CHARGE * dx * dx);
  ok(near(f.dose.current_pA, 20) && f.dose_from === 'probe current', '4D inorganic default: 20 pA probe');
  ok(near(f.dose.total, Dpa) && near(Dpa, 3.2723e6, 1e-4), `4D dose = 20 pA·1 ms/(e·Δx²) = 3.272e6 e⁻/Å² (${f.dose.total.toExponential(4)})`);
  ok(near(f.dose.electrons_per_position, 20e-12 * 1e-3 / E_CHARGE), `4D electrons per position = I·τ/e = 124 830 (${f.dose.electrons_per_position.toFixed(0)})`);
  ok(!f.compressed.sparse && f.compressed.ratio[0] === 1.2, '4D 1.9 e⁻ per detector pixel per frame is dense: 1.2–2×');
  // beam-sensitive: dose-limited, the current is solved for the dose set
  const lo = footprint('4d', { scan: 256, det: 256, bits: 16, dwell_us: 1000 }, ctx({ Dc: 1e4 }));
  const I = (400 * E_CHARGE * dx * dx) / 1e-3; // A
  ok(near(lo.dose.current_pA, I * 1e12) && near(lo.dose.current_pA, 0.0024447, 1e-4) && lo.dose_from === 'dose (low-dose)', `4D beam-sensitive: current for 400 e⁻/Å² = 2.445 fA (${lo.dose.current_pA.toFixed(5)} pA)`);
  ok(near(lo.dose.total, 400), '4D beam-sensitive: dose comes back as the dose set');
  ok(lo.compressed.sparse && lo.compressed.ratio[1] === 10, '4D beam-sensitive: 15 e⁻ over 65 536 pixels per frame is sparse: 3–10×');
  const ex = footprint('4d', { scan: 256, det: 256, dwell_us: 1000, current_pA: 5 }, ctx({ Dc: 1e4 }));
  ok(near(ex.dose.current_pA, 5) && ex.dose_from === 'probe current', '4D beam-sensitive with a chosen 5 pA current uses it');
  ok(f.working.bytes === 8589934592 + 4 * 65536 * 4, '4D virtual-detector working set = stack + 4 float32 images');
  ok(near(f.time.process_s.gpu, 8589934592 / 20e9), '4D GPU pass = 8.59 GB / 20 GB/s = 0.43 s');
  ok(f.badge.tier === 'gpu' && /exceeds the 512 MB browser budget/.test(f.badge.reason) && /assuming 24 GB/.test(f.badge.reason), `4D badge gpu: ${f.badge.reason}`);
  const g = footprint('4d', { scan: 256, det: 256, bits: 16, dwell_us: 1000 }, ctx({ vram_bytes: 4 * 2 ** 30 }));
  ok(g.badge.tier === 'hpc' && /exceeds 4.00 GB of GPU memory/.test(g.badge.reason), `4D on a 4 GB worker → hpc: ${g.badge.reason}`);
  const e = footprint('4d', { scan: 256, det: 256, dwell_us: 1000, format: 'events' }, ctx({ Dc: 1e4 }));
  ok(near(e.raw.bytes, 400 * 50 * 50 * 6, 1e-9), `4D event counting (low dose): D·field² = 10⁶ electrons × 6 B = 6 MB (${e.raw.bytes})`);
  const e2 = footprint('4d', { scan: 256, det: 256, dwell_us: 1000, format: 'events' }, ctx());
  ok(near(e2.raw.bytes, (20e-12 * 65.536 / E_CHARGE) * 6), `4D event counting at 20 pA: 8.18e9 electrons × 6 B = 49 GB (${e2.raw.bytes.toExponential(3)})`);
}
// 4D-STEM ptychography (ePIE): 64² scan, 64² detector, α = 20 mrad, 200 kV
{
  const lam = wavelength(200), dxr = lam / (4 * 0.02), Nobj = Math.ceil(50 / dxr) + 64;
  const f = footprint('4d', { scan: 64, det: 64, analysis: 'ptycho', iters: 20 }, ctx());
  ok(f.object_px === Nobj && Nobj === 224, `ePIE object = ⌈50 Å / (λ/4α = ${dxr.toFixed(4)} Å)⌉ + 64 = 224 px (${f.object_px})`);
  ok(f.working.bytes === 64 ** 4 * 4 + 24 * (224 * 224 + 64 * 64), `ePIE working = stack·4 + 3·8·(224² + 64²) = 68 411 392 B (${f.working.bytes})`);
  const flops = 20 * 64 * 64 * 2 * (5 * 64 * 64 * 12);
  ok(near(f.time.process_s.browser, flops / 1e9), `ePIE 20 iterations = ${flops.toExponential(3)} flop → ${(flops / 1e9).toFixed(1)} s in the browser`);
  ok(f.badge.tier === 'browser', `ePIE 64² preview runs in the browser: ${f.badge.reason}`);
  const h = footprint('4d', { scan: 64, det: 64, analysis: 'ptycho', iters: 50 }, ctx());
  ok(h.badge.tier === 'gpu' && /to process in the browser \(limit 60 s\)/.test(h.badge.reason), `ePIE 50 iterations → gpu: ${h.badge.reason}`);
  const big = footprint('4d', { scan: 1024, det: 512 }, ctx());
  ok(big.raw.bytes === 1024 * 1024 * 512 * 512 * 2 && big.badge.tier === 'hpc', `4D 1024² × 512² = 512 GB → hpc: ${big.badge.reason}`);
}
// STEM, 1024² scan, 10 µs dwell, 100 µs flyback per line
{
  const f = footprint('stem', {}, ctx());
  ok(f.raw.bytes === 1024 * 1024 * 2, 'STEM raw = 1024²·2 = 2 MB');
  ok(near(f.time.acquire_s, 1024 * 1024 * 10e-6 + 1024 * 100e-6), `STEM time = 10.486 s + 0.102 s flyback = 10.588 s (${f.time.acquire_s})`);
  const dx = 50 / 1024;
  ok(near(f.dose.current_pA, 50) && near(f.dose.total, (50e-12 * 10e-6) / (E_CHARGE * dx * dx)), `STEM 50 pA, 10 µs: D = ${f.dose.total.toExponential(4)} e⁻/Å² (hand: 1.309e6)`);
  ok(near(f.dose.total, 1.3089e6, 1e-3), 'STEM dose matches 1.309e6 e⁻/Å²');
  ok(f.badge.tier === 'browser', 'STEM badge browser');
}
// TEM, 4096² camera, uint16, 1 s, 400 e⁻/Å² per image
{
  const f = footprint('tem', {}, ctx());
  ok(f.raw.bytes === 4096 * 4096 * 2, 'TEM raw = 4096²·2 = 32 MB');
  ok(f.dose.total === 400 && f.dose.rate === 400, 'TEM dose 400 e⁻/Å² at 400 e⁻/Å²/s');
  ok(f.working.bytes === 4096 * 4096 * 4 + 2 * 4096 * 4096 * 8, 'TEM working = float32 frame + 2 complex FFT buffers = 320 MB');
  ok(near(f.time.process_s.browser, (2 * 5 * 4096 * 4096 * 24) / 1e9), 'TEM 2 FFTs of 4096² = 4.03 s in the browser');
  ok(f.badge.tier === 'browser', `TEM badge browser: ${f.badge.reason}`);
  ok(f.compressed.sparse, 'TEM 5 nm on 4096 px: 400 × (0.0122 Å)² = 0.06 e⁻ per pixel, sparse');
  ok(!footprint('tem', {}, ctx({ field_A: 5000 })).compressed.sparse, 'TEM 500 nm on 4096 px: 596 e⁻ per pixel, dense 1.2–2×');
  const m = footprint('tem', { frames: 40, exposure_s: 0.1 }, ctx({ dose: 1, Dc: 20 }));
  ok(m.raw.bytes === 40 * 4096 * 4096 * 2 && m.dose.total === 40 && near(m.dose.ratio, 2), 'TEM movie: 40 frames × 1 e⁻/Å² = 40 e⁻/Å², 2× a 20 e⁻/Å² critical dose');
  ok(m.notes.some((n) => /2\.0× the critical dose/.test(n)), 'critical-dose note shown');
}
// EELS spectrum image: 128², 2048 channels, float32, 10 ms dwell, 100 pA
{
  const f = footprint('eels', {}, ctx());
  ok(f.raw.bytes === 128 * 128 * 2048 * 4 && f.raw.dtype === 'float32', 'EELS raw = 128²·2048·4 = 128 MB float32');
  ok(near(f.time.acquire_s, 128 * 128 * 0.01 + 128 * 100e-6), 'EELS time = 163.84 s + 12.8 ms');
  const dx = 50 / 128;
  ok(near(f.dose.total, (100e-12 * 0.01) / (E_CHARGE * dx * dx)) && near(f.dose.current_pA, 100), `EELS dose from its own 100 pA = ${f.dose.total.toExponential(4)} e⁻/Å²`);
  ok(f.notes.length === 0 || !f.notes.some((n) => /pA, more than/.test(n)), 'EELS 100 pA is not flagged');
}
// plan handling
{
  ok(planFor('stem', { scan: 512, bits: 12, dwell_us: -1, warp: 3 }).scan === 512 && planFor('stem', { bits: 12 }).bits === 16, 'planFor keeps valid overrides, drops invalid ones');
  let threw = false; try { planFor('nope'); } catch { threw = true; }
  ok(threw, 'planFor rejects an unknown technique');
  const hi = footprint('stem', { dwell_us: 0.5 }, ctx({ dose: 1e7, Dc: 1e12 }));
  ok(hi.dose.current_pA > 1000 && hi.notes.some((n) => /more than a sub-ångström probe/.test(n)), `STEM dose-limited 10⁷ e⁻/Å² at 0.5 µs needs ${hi.dose.current_pA.toFixed(0)} pA: flagged`);
}
// every technique, from a running simulator, with a JSON-safe summary
for (const m of MODE_IDS) {
  const S = defaultState(); S.mode = m;
  const s = summary(footprintFor(S, new Sim(S)));
  ok(s.raw_bytes > 0 && s.acquire_s > 0 && ['browser', 'gpu', 'hpc'].includes(s.tier) && JSON.stringify(s).length > 0, `${m}: ${s.raw_bytes} B raw, ${s.acquire_s} s, ${s.tier}`);
}
{
  const S = defaultState(); S.mode = 'tem'; S.spec = 'bio'; S.dose = 60;
  const s = summary(footprintFor(S, new Sim(S)));
  ok(s.critical_dose_e_per_A2 > 0 && s.dose_over_critical > 1, `proteins in ice at 60 e⁻/Å²: ${s.dose_over_critical}× the critical dose ${s.critical_dose_e_per_A2} e⁻/Å²`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
