// In situ time series (M17): a movie records the timeline's environment at every frame, the specimen drifts by the
// holder's drift model (thermal drift while the temperature ramps) and drift measured from the frames by phase
// correlation matches it, a pressure ramp in the gas cell dims each frame's contrast by its own exp(−nσL), and the
// estimator's volume for the movie equals frames × the detector frame.
import * as I from '../js/insitu.js';
import * as P from '../js/physics.js';
import * as ENV from '../js/environment.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { chipState } from '../js/ops.js';
import { footprintFor, footprint, planFor } from '../js/footprint.js';
import { collectData } from '../js/export.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const record = (S, sim) => { sim.startMovie(); for (let i = 0; i < 5000 && sim.movie.rec; i++) sim.update(0.02); return sim.movie; };

// ---- the timeline
{
  const tl = [{ key: 'tempSet', t0: 2, t1: 12, to: 773 }, { key: 'tempSet', t0: 15, t1: 16, to: 573 }];
  const v = (t) => I.valueAt(tl, 'tempSet', t, 293);
  ok(v(0) === 293 && v(2) === 293 && v(7) === 533 && v(12) === 773 && v(14) === 773 && v(15.5) === 673 && v(20) === 573, 'the timeline: holds, ramps linearly from the value it reaches, and holds again (293 → 773 K over 2–12 s, then to 573 K)');
}

// ---- a heating ramp: environment per frame and drift
{
  const S = defaultState(); S.mode = 'tem'; S.spec = 'au'; S.fov = 10; S.clarity = 'edu';
  const sim = new Sim(S); chipState(S, sim, 'holder', 'heat'); sim.update(0.02);
  S.movDur = 20; S.movFps = 2; S.timeline = [{ key: 'tempSet', t0: 2, t1: 12, to: 773 }];
  const M = record(S, sim);
  ok(M.frames.length === 40 && M.meta.every((m, k) => Math.abs(m.t - k * 0.5) < 1e-9), `20 s at 2 fps: ${M.frames.length} frames at their times`);
  const worst = Math.max(...M.meta.map((m) => Math.abs(m.tempSet - I.valueAt(M.timeline, 'tempSet', m.t, 293))));
  ok(worst < 1e-9 && M.meta.at(-1).T_K > 770, `every frame's setpoint is the timeline's at its time (worst ${worst.toExponential(1)} K); the specimen ends at ${M.meta.at(-1).T_K.toFixed(0)} K (the heater reads ~1 % low)`);
  // the drift model: holder base drift plus DRIFT_PER_KS per K/s while ramping (48 K/s for 10 s)
  const d = M.meta.at(-1).drift_A, L = Math.hypot(...d), want = 0.03 * 19.5 + I.DRIFT_PER_KS * 48 * 10;
  ok(Math.abs(L / want - 1) < 0.06, `drift over the movie: ${L.toFixed(1)} Å (base 0.03 Å/s × 19.5 s + ${I.DRIFT_PER_KS} Å/s per K/s × 48 K/s × 10 s = ${want.toFixed(1)} Å)`);
  // measured from the frames: phase correlation of each frame with the first
  const n = 256, c = M.shape[0], dx = sim.tem.dx;
  const ft = (img) => {
    const re = new Float64Array(n * n), im = new Float64Array(n * n), o = (n - c) >> 1;
    let m = 0; for (const v of img) m += v; m /= img.length;
    for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) { const w = Math.sin((Math.PI * (x + 0.5)) / c) ** 2 * Math.sin((Math.PI * (y + 0.5)) / c) ** 2; re[(y + o) * n + x + o] = (img[y * c + x] - m) * w; }
    P.fft2(re, im, n); return { re, im };
  };
  const F0 = ft(M.frames[0]);
  const shift = (img) => {
    const F = ft(img), re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) { const a = F.re[i] * F0.re[i] + F.im[i] * F0.im[i], b = F.im[i] * F0.re[i] - F.re[i] * F0.im[i], r = Math.hypot(a, b) || 1; re[i] = a / r; im[i] = b / r; }
    P.fft2(re, im, n, true);
    let best = 0; for (let i = 1; i < n * n; i++) if (re[i] > re[best]) best = i;
    const bx = best % n, by = (best / n) | 0, at = (x, y) => re[((y + n) % n) * n + ((x + n) % n)];
    const sub = (m, c0, p) => (m - p) / (2 * (m - 2 * c0 + p));
    const sx = bx + sub(at(bx - 1, by), at(bx, by), at(bx + 1, by)), sy = by + sub(at(bx, by - 1), at(bx, by), at(bx, by + 1));
    return [sx > n / 2 ? sx - n : sx, sy > n / 2 ? sy - n : sy];
  };
  const errs = [];
  M.frames.forEach((f, k) => { if (k % 4) return; const [sx, sy] = shift(f), [tx, ty] = M.meta[k].drift_A; errs.push(Math.hypot(sx * dx + tx, sy * dx + ty)); if (process.env.DBG) console.log(k, M.meta[k].T_K.toFixed(0), (sx * dx).toFixed(2), (-tx).toFixed(2), (sy * dx).toFixed(2), (-ty).toFixed(2)); });
  const rms = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
  ok(rms < 0.5 * dx, `drift measured from the frames (phase correlation with the first) follows the true drift: RMS error ${rms.toFixed(3)} Å = ${(rms / dx).toFixed(2)} px over ${(L / dx).toFixed(0)} px of travel (the image moves against the specimen)`);
  const data = collectData(sim, S);
  ok(data.arrays.movie.shape.join() === `40,${c},${c}` && data.arrays.movie_drift.shape.join() === '40,2' && data.meta.calibration.movie.frame_meta.length === 40, `export: movie [${data.arrays.movie.shape}], times, temperatures and the true drift per frame, with the timeline`);
}

// ---- a pressure ramp in the gas cell: each frame keeps its own exp(−nσL) of the contrast
{
  let seed = 3; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const S = defaultState(); S.mode = 'tem'; S.spec = 'au'; S.clarity = 'edu';
  const sim = new Sim(S); chipState(S, sim, 'envCell', 'gas'); chipState(S, sim, 'gcGeom', 'open'); S.gcGas = 'N2'; S.gcP = 0.01; S.gcPath = 8; sim.invalidate('env'); sim.update(0.02);
  S.movDur = 10; S.movFps = 1; S.timeline = [{ key: 'gcP', t0: 1, t1: 9, to: 20 }];
  const M = record(S, sim);
  const contrast = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / a.length) / m; };
  const c0 = contrast(M.frames[0]), T0 = ENV.gasNow({ ...S, gcP: M.meta[0].gcP }).col.transmitted;
  const dev = M.meta.map((m, k) => Math.abs(contrast(M.frames[k]) / c0 / (ENV.gasNow({ ...S, gcP: m.gcP }).col.transmitted / T0) - 1));
  ok(Math.max(...dev) < 0.02 && M.meta.at(-1).gcP === 20, `N₂ ramped 0.01 → 20 mbar over 8 mm: each frame's contrast follows its own exp(−nσL), down to ${(100 * contrast(M.frames.at(-1)) / c0).toFixed(1)} % (worst deviation ${(100 * Math.max(...dev)).toFixed(2)} %)`);
}

// ---- a bias ramp: the specimen voltage per frame
{
  const S = defaultState(); S.mode = 'tem'; S.clarity = 'edu'; Object.assign(S, { bsOn: true, bsMat: 'insulator', bsRc: 0, bsRs: 0 });
  const sim = new Sim(S); sim.update(0.02);
  S.movDur = 5; S.movFps = 2; S.timeline = [{ key: 'bsV', t0: 0, t1: 4, to: 8 }];
  const M = record(S, sim), worst = Math.max(...M.meta.map((m) => Math.abs(m.V_specimen - I.valueAt(M.timeline, 'bsV', m.t, 0))));
  ok(worst < 1e-6, `a bias ramp 0 → 8 V over 4 s: each frame records the specimen voltage the timeline sets (worst ${worst.toExponential(1)} V)`);
}

// ---- the estimator: the movie's volume
{
  const S = defaultState(); S.mode = 'tem'; S.movOn = true; S.movDur = 60; S.movFps = 25; const sim = new Sim(S);
  const f = footprintFor(S, sim), det = planFor('tem').det, one = footprint('tem', { frames: 1, exposure_s: 1 / 25 }, { field_A: sim.fovA(), dose: S.dose / 25 });
  ok(f.shape.join() === `1500,${det},${det}` && f.raw.bytes === 1500 * det * det * 2 && Math.abs(f.dose.total - 60 * S.dose) < 1e-9 && f.badge.tier !== 'browser', `estimator: 60 s at 25 fps on a ${det}² camera = ${f.shape[0]} frames, ${(f.raw.bytes / 2 ** 30).toFixed(0)} GiB raw (frames × ${det}² × 2 B), dose ${f.dose.total} e⁻/Å² at the camera's rate, analysis tier ${f.badge.tier}`);
  ok(Math.abs(f.dose.per_image - one.dose.per_image) < 1e-12, 'the dose per frame is the camera\'s dose rate ÷ fps');
  const p = I.moviePlan(60, 25);
  ok(p.frames === 1500 && p.every === Math.ceil(1500 / I.MAX_FRAMES) && p.kept === Math.ceil(1500 / p.every), `the browser keeps ${p.kept} of the ${p.frames} frames (every ${p.every}th); the estimator sizes all of them`);
  S.mode = 'stem'; const g = footprintFor(S, sim);
  ok(g.notes.some((x) => /movie runs at/.test(x)) && g.time.acquire_s > 60, `a STEM movie: a ${planFor('stem').scan}² frame takes ${g.movie.frame_s.toFixed(1)} s, so 25 fps is out of reach (${(g.time.acquire_s / 60).toFixed(0)} min for ${g.shape[0]} frames)`);
  // what the browser records equals the estimator's frame count when nothing is decimated
  const S2 = defaultState(); S2.mode = 'diff'; S2.movOn = true; S2.movDur = 6; S2.movFps = 5; const sim2 = new Sim(S2); sim2.update(0.02);
  const M = record(S2, sim2), f2 = footprintFor(S2, sim2);
  ok(M.frames.length === f2.shape[0] && f2.raw.bytes === M.frames.length * f2.movie.frame_bytes, `SAED movie: ${M.frames.length} frames recorded = ${f2.shape[0]} in the estimate (${(f2.raw.bytes / 2 ** 20).toFixed(0)} MiB at full detector size)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
