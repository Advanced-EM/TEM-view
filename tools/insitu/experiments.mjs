// In situ experiment designs (see EXPERIMENTS.md): each one is set up, recorded as a movie with its timeline,
// measured frame by frame and summarised, so the expected results in the designs come from the simulator itself.
// Each design is also written as a session file (sessions/<id>.json) that the exhibit loads (Data → Load session):
// then press Record movie.
//
//   node tools/insitu/experiments.mjs            all designs, results in tools/insitu/results.json
//   node tools/insitu/experiments.mjs E3 E5      only these
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { defaultState } from '../../js/state.js';
import { Sim } from '../../js/sim.js';
import { chipState } from '../../js/ops.js';
import { toSession, readSession } from '../../js/session.js';
import { footprintFor, fmtBytes, fmtTime } from '../../js/footprint.js';
import * as P from '../../js/physics.js';
import * as LIQ from '../../js/liquid.js';
import * as ENV from '../../js/environment.js';
import * as BIAS from '../../js/bias.js';
import * as I from '../../js/insitu.js';

const here = dirname(fileURLToPath(import.meta.url));
let seed = 11; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; // reproducible noise and drift
const contrast = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / a.length) / m; };
const goldR = () => P.SPECIMENS.au.parts[0].r;
// plane fit of a phase map (rad) over a mask: the x gradient, rad/Å
function slopeX(ph, c, dx, mask) {
  let n = 0, sx = 0, sxx = 0, sz = 0, szx = 0;
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) { const i = y * c + x; if (mask && !mask[i]) continue; const X = x * dx; n++; sx += X; sxx += X * X; sz += ph[i]; szx += ph[i] * X; }
  return (szx / n - (sz / n) * (sx / n)) / (sxx / n - (sx / n) ** 2);
}

export const EXPERIMENTS = [
  {
    id: 'E1', kind: 'liquid', title: 'Radiolysis threshold: when do bubbles form?',
    setup(S, sim) { S.mode = 'tem'; S.spec = 'au'; S.fov = 40; chipState(S, sim, 'envCell', 'liquid'); S.lcClass = 'sinx'; S.lcGap = 500; S.lcDP = 0.5; S.lcRate = 0.5; },
    timeline: [{ key: 'lcRate', t0: 10, t1: 70, to: 80 }], dur: 90, fps: 2,
    variants: { static: (S) => { S.lcClass = 'sinx'; }, 'flow 2 µL/min': (S) => { S.lcClass = 'sinxFlow'; S.lcFlow = 2; } },
    probe: (sim) => ({ bubbles: sim.liq?.bubbles.length ?? 0 }),
    summary(rows, S) {
      const first = rows.find((r) => r.bubbles > 0), thr = LIQ.bubbleThresholdGy(S) / LIQ.doseRateGy(1, S.kV);
      return { threshold_e_A2_s: +thr.toFixed(2), first_bubble_s: first?.t ?? null, rate_at_first_bubble: first ? +first.lcRate.toFixed(2) : null, bubbles_at_end: rows.at(-1).bubbles };
    },
  },
  {
    id: 'E2', kind: 'liquid', title: 'Gold growth from a precursor: growth rate against dose rate, below the bubble threshold',
    setup(S, sim) { S.mode = 'tem'; S.spec = 'au'; S.fov = 40; chipState(S, sim, 'envCell', 'liquid'); S.lcGap = 500; S.lcDP = 0.5; S.lcPrecursor = true; S.lcRate = 0.5; },
    timeline: [{ key: 'lcRate', t0: 30, t1: 31, to: 2 }], dur: 60, fps: 2,
    probe: (sim) => ({ r_A: P.SPECIMENS.au.parts[0].r - (P.SPECIMENS.au.grownBy ?? 0) + (sim.liq?.grow ?? 0), bubbles: sim.liq?.bubbles.length ?? 0 }), // the growth itself (the specimen is rebuilt in 0.5 Å steps)
    summary(rows) {
      const at = (t) => rows.reduce((b, r) => (Math.abs(r.t - t) < Math.abs(b.t - t) ? r : b));
      const g1 = (at(29.5).r_A - at(0).r_A) / 29.5, g2 = (at(59.5).r_A - at(32).r_A) / 27.5;
      return { r_start_A: +rows[0].r_A.toFixed(2), r_end_A: +rows.at(-1).r_A.toFixed(2), growth_A_s_at_0_5: +g1.toFixed(3), growth_A_s_at_2: +g2.toFixed(3), ratio: +(g2 / g1).toFixed(2), sqrt_rate_ratio: 2, bubbles_at_end: rows.at(-1).bubbles };
    },
  },
  {
    id: 'E3', kind: 'gas + heating', title: 'Sintering of gold nanoparticles: oxygen versus nitrogen',
    setup(S, sim) { S.mode = 'tem'; S.spec = 'au'; S.fov = 40; chipState(S, sim, 'holder', 'heat'); chipState(S, sim, 'envCell', 'gas'); chipState(S, sim, 'gcGeom', 'windowed'); S.gcP = 1000; S.gcGap = 5; },
    timeline: [{ key: 'tempSet', t0: 10, t1: 60, to: 800 }], dur: 180, fps: 1,
    variants: { O2: (S) => { S.gcGas = 'O2'; }, N2: (S) => { S.gcGas = 'N2'; } },
    probe: (sim) => ({ r_A: goldR(), sinter_A: sim.gasSt?.sinter ?? 0 }),
    summary(rows, S, sim) {
      const onset = rows.find((r) => r.sinter_A > 0.05);
      const g = ENV.gasNow(S, 800);
      return { r_start_A: rows[0].r_A, r_end_A: rows.at(-1).r_A, sinter_end_A: +rows.at(-1).sinter_A.toFixed(2), onset_s: onset?.t ?? null, onset_T_K: onset ? Math.round(onset.T_K) : null, contrast_kept_pct: +(100 * g.col.transmitted).toFixed(1), drift_A: +Math.hypot(...rows.at(-1).drift_A).toFixed(1) };
    },
  },
  {
    id: 'E4', kind: 'gas (ETEM)', title: 'How much gas can the image take? A pressure ramp in an open column',
    setup(S, sim) { S.mode = 'tem'; S.spec = 'au'; S.fov = 20; chipState(S, sim, 'envCell', 'gas'); chipState(S, sim, 'gcGeom', 'open'); S.gcGas = 'N2'; S.gcPath = 5; S.gcP = 0.1; },
    timeline: [{ key: 'gcP', t0: 5, t1: 65, to: 20 }], dur: 70, fps: 1,
    probe: (sim, S) => ({ c: contrast(sim.tem.img), trans: ENV.gasNow(S).col.transmitted }),
    summary(rows) {
      const c0 = rows[0].c / rows[0].trans, half = rows.find((r) => r.c / c0 < 0.5), dev = Math.max(...rows.map((r) => Math.abs(r.c / c0 / r.trans - 1)));
      return { contrast_at_20_mbar_pct: +(100 * rows.at(-1).c / c0).toFixed(1), half_contrast_mbar: half ? +half.gcP.toPrecision(3) : null, worst_deviation_from_exp_pct: +(100 * dev).toFixed(2) };
    },
  },
  {
    id: 'E5', kind: 'gas + heating', title: 'Redox cycling of SrTiO₃: reduce in H₂, re-oxidise in O₂',
    setup(S, sim) { S.mode = 'eds'; S.spec = 'sto'; chipState(S, sim, 'holder', 'heat'); chipState(S, sim, 'envCell', 'gas'); S.gcGas = 'H2'; S.gcP = 1000; },
    timeline: [{ key: 'tempSet', t0: 5, t1: 25, to: 800 }], dur: 120, fps: 1, movieMode: 'tem',
    stages: [{ label: 'H₂, 1 bar', set: (S) => { S.gcGas = 'H2'; } }, { label: 'O₂, 1 bar (gas switched; the temperature holds)', set: (S) => { S.gcGas = 'O2'; S.timeline = []; S.tempSet = 800; } }],
    probe: (sim) => ({ xi: sim.gasSt?.xi ?? 0 }),
    summary(rows) {
      const t90 = (st, f) => { const r = rows.filter((q) => q.stage === st), hit = r.find((q) => f(q.xi)); return hit ? +(hit.t - r[0].t).toFixed(1) : null; };
      return { xi_end_H2: +rows.filter((r) => r.stage === 0).at(-1).xi.toFixed(3), t_90pct_reduced_s: t90(0, (x) => x > 0.9), xi_end_O2: +rows.at(-1).xi.toFixed(3), t_90pct_reoxidised_s: t90(1, (x) => x < 0.1) };
    },
  },
  {
    id: 'E6', kind: 'heating', title: 'Helium bubbles in silicon: coarsening, escape and voids on annealing',
    setup(S, sim) { S.mode = 'tem'; S.spec = 'hesi'; S.fov = 48; S.thick = 40; chipState(S, sim, 'holder', 'heat'); P.SPECIMENS.hesi.reset(); },
    timeline: [{ key: 'tempSet', t0: 20, t1: 220, to: 1100 }], dur: 600, fps: 1,
    probe: (sim) => { const sp = P.SPECIMENS.hesi, b = sp.bubbles(); return { n: b.length, d_nm: b.length ? (2 * b.reduce((v, q) => v + q.r, 0)) / b.length / 10 : 0, he: sp.heDensity(), stage: sp.stage() }; },
    summary(rows) {
      const firstOf = (s) => rows.find((r) => r.stage === s);
      const st = ['coarsening', 'helium escaping', 'empty faceted voids', 'voids annealing out'].map((s) => { const r = firstOf(s); return r ? { stage: s, t_s: r.t, T_K: Math.round(r.T_K) } : { stage: s, t_s: null }; });
      return { cavities_start: rows[0].n, d_start_nm: +rows[0].d_nm.toFixed(2), cavities_end: rows.at(-1).n, d_end_nm: +rows.at(-1).d_nm.toFixed(2), he_end: +rows.at(-1).he.toFixed(1), stages: st, thermal_drift_A: +Math.hypot(...rows.at(-1).drift_A).toFixed(1) };
    },
  },
  {
    id: 'E7', kind: 'biasing', title: 'Mapping the field across a biased gap by holography, then breaking it down',
    setup(S, sim) { S.mode = 'oah'; S.spec = 'sto'; S.thick = 100; S.fov = 5; Object.assign(S, { bsOn: true, bsLayout: 'two', bsGap: 2, bsMat: 'insulator', bsRc: 0, bsRs: 0, bsStray: false, bsV: 0, bsEbd: 30 }); },
    timeline: [{ key: 'bsV', t0: 2, t1: 22, to: 20 }], dur: 25, fps: 1,
    probe: (sim, S) => { const d = sim.oah.disp; return { slope: d ? slopeX(d.ph, d.c, d.dx, d.inOv) : 0, V: sim.biasSt?.op?.Vspec ?? 0 }; },
    summary(rows, S) {
      const b = rows[0].slope, pts = rows.map((r) => [r.V, r.slope - b]), n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
      const k = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), want = (-P.sigmaOf(S.kV) * 1000) / 2e4;
      const sol = BIAS.solve('tip'), Vbd = (10e6 * 5e-6) / sol.Emax;
      return { phase_slope_per_V: +k.toExponential(3), predicted_per_V: +want.toExponential(3), ratio: +(k / want).toFixed(3), breakdown_tip_5um_10MVm_V: +Vbd.toFixed(2) };
    },
  },
  {
    id: 'E8', kind: 'liquid + biasing', title: 'Electrochemistry: deposit gold, then strip it',
    setup(S, sim) { S.mode = 'tem'; S.spec = 'au'; S.fov = 40; Object.assign(S, { bsOn: true, bsMat: 'semi', bsRc: 0, bsRs: 0, bsLimit: 10000, bsV: 0 }); chipState(S, sim, 'envCell', 'liquid'); S.lcPrecursor = true; S.lcRate = 0.05; S.lcGap = 300; S.lcDP = 0.3; },
    timeline: [{ key: 'bsV', t0: 5, t1: 10, to: -0.3 }, { key: 'bsV', t0: 30, t1: 35, to: 0.7 }], dur: 60, fps: 2,
    probe: (sim) => ({ r_A: goldR(), rate: sim.biasSt?.echem?.rate ?? 0 }),
    summary(rows) {
      const max = rows.reduce((b, r) => (r.r_A > b.r_A ? r : b));
      return { r_start_A: rows[0].r_A, r_max_A: max.r_A, t_max_s: max.t, r_end_A: rows.at(-1).r_A, deposition_A_s: +Math.max(...rows.map((r) => r.rate)).toFixed(2), stripping_A_s: +Math.min(...rows.map((r) => r.rate)).toFixed(2) };
    },
  },
];

// one run of a design (and variant): the session file, the estimate, the movie, the per-frame rows
function run(E, variantName = null) {
  const S = defaultState(); S.clarity = 'edu';
  const sim = new Sim(S);
  P.regrowGold(0);
  E.setup(S, sim);
  if (variantName) E.variants[variantName](S);
  sim.invalidate('env'); sim.update(0.02);
  S.movOn = true; S.movDur = E.dur; S.movFps = E.fps; S.timeline = structuredClone(E.timeline);
  if (E.movieMode) S.mode = E.movieMode;
  const est = footprintFor(S, sim);
  const session = toSession(S, { note: `TEM-view in situ experiment ${E.id}${variantName ? ` (${variantName})` : ''}: ${E.title}. Load it, then press Record movie.` });
  const rt = readSession(JSON.parse(JSON.stringify(session))).state; // the file reads back with its timeline
  if (JSON.stringify(rt.timeline) !== JSON.stringify(S.timeline)) throw new Error(`${E.id}: the session did not keep its timeline`);
  const rows = [];
  const stages = E.stages ?? [{ label: null, set: () => {} }];
  stages.forEach((stg, si) => {
    stg.set(S);
    sim.startMovie();
    for (let i = 0; i < 20000 && sim.movie.rec; i++) {
      sim.update(0.02);
      const m = sim.movie.meta.at(-1), k = sim.movie.k - 1;
      if (!m || m.frame !== k) continue; // only frames kept
      rows.push({ stage: si, t: +(m.t + si * E.dur).toFixed(3), T_K: m.T_K, lcRate: m.lcRate, gcP: m.gcP, drift_A: m.drift_A, ...E.probe(sim, S) });
    }
  });
  const res = E.summary(rows, S, sim);
  P.regrowGold(0);
  return { session, rows, res, est: { frames: est.shape[0], raw: fmtBytes(est.raw.bytes), acquire: fmtTime(est.time.acquire_s), dose_total_e_A2: +est.dose.total.toPrecision(3), tier: est.badge.tier, shape: est.shape } };
}

const want = process.argv.slice(2);
const out = {};
mkdirSync(join(here, 'sessions'), { recursive: true });
for (const E of EXPERIMENTS) {
  if (want.length && !want.includes(E.id)) continue;
  out[E.id] = { title: E.title, kind: E.kind, timeline: E.timeline, movie: { duration_s: E.dur, fps: E.fps }, runs: {} };
  for (const v of E.variants ? Object.keys(E.variants) : [null]) {
    const t0 = Date.now(), r = run(E, v), name = v ? `${E.id}-${v.split(' ')[0]}` : E.id;
    writeFileSync(join(here, 'sessions', `${name}.json`), JSON.stringify(r.session, null, 1));
    out[E.id].runs[v ?? 'main'] = { ...r.res, estimate: r.est, session: `sessions/${name}.json` };
    console.log(`${name}: ${JSON.stringify(r.res)}  [${r.est.frames} frames, ${r.est.raw}, ${r.est.tier}; ${((Date.now() - t0) / 1000).toFixed(1)} s]`);
  }
}
writeFileSync(join(here, 'results.json'), JSON.stringify(out, null, 1));
