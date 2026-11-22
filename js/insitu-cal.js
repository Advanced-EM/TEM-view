// Calibration: the kinetics' placeholder parameters (kinetics.js, label "trend") fitted to measured in situ data,
// published series or the user's own, so the simulator becomes a digital twin of a particular experiment.
//
// A dataset says under which conditions it was measured (a TEM-view state: the cell, precursor, gas, holder, ...),
// which parameters it constrains, and what was measured:
//   targets  scalar results with an uncertainty: a nucleation threshold dose rate, an induction dose, an onset
//            temperature, a parameter measured directly (an activation energy), a time to the first bubble
//   series   a time series (rows { t, <observable>: value, <observable>_sd?: σ }) compared point by point with the
//            process model run over the same timeline. Columns named T_K, lcRate, gcP or bsV are inputs (the
//            measured temperature drives the model); the other observables are fitted.
// fit() minimises χ² over the chosen parameters (log scale for rates and amounts, linear for energies and
// potentials) with Nelder–Mead from several starts, reports each parameter with an uncertainty from the Jacobian at
// the optimum, and the checks (predictions the fit did not use). The result is a calibration profile
// (temview-calibration/1) that kinetics.js applies: the published one by default, the user's own on request.
//
// The process model (series) steps the same functions the simulator uses (liquid.js, gas.js, bias.js) without
// forming images, so a fit takes seconds; insitu-cal-check.mjs checks it against the full simulator.
import * as K from './kinetics.js';
import * as LIQ from './liquid.js';
import * as GAS from './gas.js';
import * as BIAS from './bias.js';
import * as I from './insitu.js';
import { specimenT } from './holder.js';
import { defaultState } from './state.js';
import { PUBLISHED } from './calibration-published.js';

const kB = 8.617e-5;
// parameters fitted on a linear scale (energies, potentials, fractions near one); the rest on a log scale
const LINEAR = new Set(['sinter_Ea', 'redox_Ea', 'bv_Eeq', 'bv_alpha', 'G_eaq', 'G_H2']);

// ---------------------------------------------------------------- published datasets
const liquidAg = (S) => Object.assign(S, { envCell: 'liquid', lcClass: 'sinx', lcGap: 800, lcDP: 1, lcPrecursor: true, lcMetal: 'ag', kV: 200, lcRate: 1 });
const heatedAu = (S) => Object.assign(S, { spec: 'au', holder: 'heat', envCell: 'gas', gcGeom: 'windowed', gcGas: 'N2', gcP: 1, tempSet: 973 });
export const PUBLISHED_SETS = [
  {
    id: 'woehl2012', kind: 'published', title: 'Ag nanocrystal nucleation from 1 mM AgNO₃ in liquid-cell STEM (200 kV, 800 nm liquid)',
    ref: 'Woehl, Evans, Arslan, Ristenpart, Browning, ACS Nano 6, 8599 (2012)',
    conditions: liquidAg, fit: ['nuc_c_ag', 'nuc_k_ag'],
    targets: [
      { id: 'threshold', what: 'growth-threshold dose rate', model: 'nuc_threshold', value: 0.5, sigma: 0.1, unit: 'e⁻/Å²/s', note: 'no particles nucleated below 0.5 e⁻/Å²/s (< 7 pA); they did at 0.59' },
      { id: 'induction', what: 'induction dose at 3.37 e⁻/Å²/s', model: 'nuc_dose', at: { lcRate: 3.37 }, value: 27.8, sigma: 7.8, unit: 'e⁻/Å²', note: 'mean over beam current, dwell time and magnification; independent of them' },
    ],
    checks: [
      { id: 'dose_x2', what: 'induction dose at 6.7 e⁻/Å²/s (measured: independent of the beam settings)', model: 'nuc_dose', at: { lcRate: 6.7 }, value: 27.8, sigma: 7.8, unit: 'e⁻/Å²' },
      { id: 'dose_near', what: 'induction dose at 0.59 e⁻/Å²/s, just above the threshold', model: 'nuc_dose', at: { lcRate: 0.59 }, unit: 'e⁻/Å²' },
    ],
    caveats: 'Silver, not gold: the gold parameters stay at trend. The induction time includes growing to the 5 nm detection limit, which k_n absorbs. The irradiated radius is the model’s beam_r (1 µm), close to the scanned field at 100 kx.',
  },
  {
    id: 'horwath2022', kind: 'published', title: 'Size change of 4 nm Au particles on a SiNₓ heating chip, 600–850 °C, ≥ 1 h per step',
    ref: 'Horwath, Lehman-Chong, Vojvodic, Stach, arXiv:2209.15580 (2022)',
    conditions: heatedAu, fit: ['sinter_A', 'sinter_Ea'],
    targets: [
      { id: 'Ea', what: 'activation energy of the size change', model: 'param', key: 'sinter_Ea', value: 1.2, sigma: 0.15, unit: 'eV', note: 'Arrhenius fit of the evaporation rate; no uncertainty reported (σ assumed)' },
      { id: 'onset', what: 'temperature at which the radius changes by 10 % in 1 h', model: 'size_change_T', frac: 0.1, hold: 3600, value: 998, sigma: 25, unit: 'K', note: 'little change below 700 °C, rapid at 750 °C: the onset bracketed between 973 and 1023 K' },
    ],
    checks: [{ id: 'at800', what: 'radius change in 10 min at 800 K (the old E3 onset)', model: 'size_change', T: 800, hold: 600, unit: 'Å' }],
    caveats: 'Measured in vacuum as evaporation (the particles shrink); the model coarsens (they grow) at the same thermally activated rate, in an inert gas. The factor for oxygen stays at trend.',
  },
];

// ---------------------------------------------------------------- the process model
const QK = Object.keys(I.QUANTITIES);
export const INPUTS = ['T_K', 'lcRate', 'gcP', 'bsV'];
export const SERIES_OBS = ['T_K', 'radius_A', 'sinter_A', 'xi', 'h2_beam_uM', 'h2_cell_uM', 'pH', 'supersat', 'bubbles', 'V_specimen', 'I_uA', 'joule_K', 'echem_A_s'];
const rng32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const interp = (rows, key, t) => {
  const r = rows.filter((x) => Number.isFinite(x[key]));
  if (!r.length) return undefined;
  if (t <= r[0].t) return r[0][key];
  for (let i = 1; i < r.length; i++) if (t <= r[i].t) { const a = r[i - 1], b = r[i]; return a[key] + ((b[key] - a[key]) * (t - a.t)) / (b.t - a.t || 1); }
  return r.at(-1)[key];
};
// run the processes of state S0 with its timeline, sampled at `times` (s); `inputs` (rows) drive T_K, lcRate, gcP
// and bsV where they have values. Returns rows { t, ...observables, events }
export function simulateSeries(S0, times, { timeline = S0.timeline ?? [], inputs = null, dtMax = null } = {}) {
  const tEnd = Math.max(0, ...times), dtM = dtMax ?? Math.max(0.05, Math.min(1, tEnd / 4000));
  const S = { ...S0 }, L = { t: 0, bubbles: [], grow: 0, bx: 0, by: 0, res: 0, events: [] }, G = { xi: 0, sinter: 0 };
  const B = S0.bsOn ? { t: 0, dT: 0, broken: false, open: false, em: 0, events: [], trace: [] } : null, rng = rng32(4711), out = [];
  const ins = inputs ? INPUTS.filter((k) => inputs.some((r) => Number.isFinite(r[k]))) : [];
  let t = 0, T = 293, echem = 0;
  const apply = (tt) => {
    for (const k of QK) S[k] = I.valueAt(timeline, k, tt, S0[k]);
    for (const k of ins) if (k !== 'T_K') S[k] = interp(inputs, k, tt);
    const Tin = ins.includes('T_K') ? interp(inputs, 'T_K', tt) : null;
    T = (Tin ?? specimenT(S.holder, S.tempSet, tt)) + (B?.dT ?? 0);
  };
  const record = (tt) => {
    const r = { t: tt, T_K: T, radius_A: 21 + L.grow + G.sinter, sinter_A: G.sinter, xi: G.xi };
    if (S.envCell === 'liquid') Object.assign(r, { h2_beam_uM: 1e6 * (L.h2 ?? 0), h2_cell_uM: 1e6 * L.res, pH: L.pH ?? 7, supersat: L.supersat ?? 0, bubbles: L.bubbles.length });
    if (B?.op) Object.assign(r, { V_specimen: B.op.Vspec, I_uA: 1e6 * B.op.I, joule_K: B.dT, echem_A_s: echem });
    out.push(r);
  };
  const queue = [...times].sort((a, b) => a - b);
  apply(0);
  while (queue.length && queue[0] <= 0) { record(queue.shift()); }
  while (queue.length) {
    const dt = Math.min(dtM, queue[0] - t);
    apply(t + dt / 2);
    if (B) BIAS.step(B, S, T - B.dT, dt);
    if (S.envCell === 'liquid') {
      const c = LIQ.cellOf(S);
      if (c && !c.burst) LIQ.step(L, S, S.kV, dt, rng, S.fov * 10 || 400, c.thicknessA);
      if (B?.op && S.spec === 'au') { echem = BIAS.electrochem(B.op.Vspec, T, S.lcPrecursor).rate; L.grow = Math.max(-10, Math.min(15, L.grow + echem * dt)); }
    }
    if (S.envCell === 'gas') GAS.react(G, S, T, dt);
    t += dt;
    if (t >= queue[0] - 1e-9) { apply(t); record(queue.shift()); }
  }
  return Object.assign(out, { events: [...L.events, ...(B?.events ?? [])], nucleated_s: L.nucleated ?? null });
}

// ---------------------------------------------------------------- what a target predicts
const conditionsOf = (d) => { const S = defaultState(); if (d.session) Object.assign(S, d.session); if (d.conditions) d.conditions(S); return S; };
export function predict(tg, S) {
  const s = { ...S, ...(tg.at ?? {}) };
  switch (tg.model) {
    case 'param': return K.p(tg.key);
    case 'nuc_threshold': return LIQ.nucleationThreshold(s);
    case 'nuc_dose': return LIQ.induction(s).dose_e_A2;
    case 'nuc_time': return LIQ.induction(s).t_s;
    case 'size_change': { const st = { xi: 0, sinter: 0 }; GAS.react(st, s, tg.T, tg.hold); return st.sinter; }
    case 'size_change_T': { // bisection in T for a change of frac·R (R = 21 Å) over the hold
      const want = (tg.frac ?? 0.1) * (tg.R ?? 21), d = (T) => { const st = { xi: 0, sinter: 0 }; GAS.react(st, s, T, tg.hold); return st.sinter - want; };
      let lo = 300, hi = 2500;
      if (d(hi) < 0) return Infinity;
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (d(m) > 0) hi = m; else lo = m; }
      return (lo + hi) / 2;
    }
    case 'first_bubble_s': { const r = simulateSeries(s, Array.from({ length: Math.ceil(tg.tMax ?? 600) }, (_, i) => i + 1)); return r.find((x) => x.bubbles > 0)?.t ?? Infinity; }
    case 'nucleated_s': { const r = simulateSeries(s, [tg.tMax ?? 600]); return r.nucleated_s ?? Infinity; }
    default: throw new Error(`unknown target model ${tg.model}`);
  }
}
// residuals of one dataset (normalised by σ); positive quantities compared in log where σ is relative to them
function residuals(d, S, cache) {
  const r = [];
  for (const tg of d.targets ?? []) {
    const v = predict(tg, S);
    r.push(Number.isFinite(v) ? (v - tg.value) / tg.sigma : 30);
  }
  if (d.series?.length) {
    const cols = seriesColumns(d.series), sim = simulateSeries(S, d.series.map((x) => x.t), { inputs: d.series, timeline: S.timeline });
    for (const c of cols) {
      const sd = cache.sd[c] ??= defaultSigma(d.series, c);
      d.series.forEach((row, i) => { if (Number.isFinite(row[c])) { const v = sim[i]?.[c]; r.push(Number.isFinite(v) ? (v - row[c]) / (Number.isFinite(row[`${c}_sd`]) ? row[`${c}_sd`] : sd) : 30); } });
    }
  }
  return r;
}
// the fitted columns of a series: known observables that are not inputs
export const seriesColumns = (rows) => SERIES_OBS.filter((c) => !INPUTS.includes(c) && rows.some((r) => Number.isFinite(r[c])));
// σ when a column has none: 5 % of its range (at least 1 % of its mean magnitude)
function defaultSigma(rows, c) {
  const v = rows.map((r) => r[c]).filter(Number.isFinite), lo = Math.min(...v), hi = Math.max(...v), m = v.reduce((a, b) => a + Math.abs(b), 0) / v.length;
  return Math.max(0.05 * (hi - lo), 0.01 * m, 1e-12);
}
// the parameters an observable usually constrains, for the designer and the CLI
export function suggestFit(S, cols) {
  const f = new Set();
  for (const c of cols) {
    if ((c === 'radius_A' || c === 'sinter_A') && S.envCell === 'gas') f.add('sinter_A').add('sinter_Ea');
    if (c === 'xi') f.add('redox_A').add('redox_Ea');
    if (c === 'radius_A' && S.envCell === 'liquid') S.bsOn ? f.add('bv_i0').add('bv_Eeq') : f.add('Au_eta');
    if (c === 'echem_A_s') f.add('bv_i0').add('bv_Eeq');
    if (c === 'h2_cell_uM' || c === 'bubbles') f.add('chip_area');
    if (c === 'supersat') K.metalOf(S).nuc.forEach((k) => f.add(k));
  }
  return [...f];
}

// ---------------------------------------------------------------- the fit
function nelderMead(fn, x0, { step = 1, iters = 400, tol = 1e-8 } = {}) {
  const n = x0.length;
  let pts = [x0.slice(), ...x0.map((_, i) => x0.map((v, j) => (j === i ? v + (Array.isArray(step) ? step[i] : step) : v)))].map((x) => ({ x, f: fn(x) }));
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a.f - b.f);
    if (Math.abs(pts[n].f - pts[0].f) <= tol * (Math.abs(pts[0].f) + tol)) break;
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i].x[j] / n;
    const at = (a) => { const x = c.map((v, j) => v + a * (pts[n].x[j] - v)); return { x, f: fn(x) }; };
    const r = at(-1);
    if (r.f < pts[0].f) { const e = at(-2); pts[n] = e.f < r.f ? e : r; }
    else if (r.f < pts[n - 1].f) pts[n] = r;
    else {
      const k = at(r.f < pts[n].f ? -0.5 : 0.5);
      if (k.f < Math.min(r.f, pts[n].f)) pts[n] = k;
      else pts = pts.map((p, i) => (i ? { x: p.x.map((v, j) => pts[0].x[j] + 0.5 * (v - pts[0].x[j])), f: 0 } : p)).map((p, i) => (i ? { x: p.x, f: fn(p.x) } : p));
    }
  }
  pts.sort((a, b) => a.f - b.f);
  return pts[0];
}
function invert(A, n) { // Gauss–Jordan, small n
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; if (Math.abs(d) < 1e-300) return null;
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r) => r.slice(n));
}
// fit datasets: { base: a profile to start from (the published one by default), name, starts }; returns
// { profile, report }. The kinetics are left as they were before the call.
export function fit(datasets, { base = PUBLISHED, name = 'Calibration', created = new Date().toISOString() } = {}) {
  // datasets that constrain different parameters are fitted one at a time, then merged
  if (datasets.length > 1 && datasets.every((d, i) => datasets.every((e, j) => i === j || !d.fit.some((k) => e.fit.includes(k))))) {
    const parts = datasets.map((d) => fit([d], { base, name, created }));
    const pr = parts.reduce((acc, p) => ({ ...p.profile, params: { ...acc.params, ...p.profile.params }, datasets: [...acc.datasets.filter((x) => !p.profile.datasets.some((y) => y.id === x.id)), ...p.profile.datasets] }), { params: {}, datasets: [] });
    const fitAll = { chi2: +parts.reduce((s, p) => s + p.profile.fit.chi2, 0).toPrecision(4), points: parts.reduce((s, p) => s + p.profile.fit.points, 0), report: parts.flatMap((p) => p.report) };
    fitAll.dof = Math.max(1, fitAll.points - Object.keys(pr.params).length + Object.keys(base?.params ?? {}).length); fitAll.reduced_chi2 = +(fitAll.chi2 / fitAll.dof).toPrecision(3);
    return { profile: { ...pr, name, created, fit: fitAll }, report: fitAll.report };
  }
  const before = K.CAL.profile;
  base ? K.applyProfile(base) : K.resetCalibration();
  const keys = [...new Set(datasets.flatMap((d) => d.fit))];
  const bad = keys.filter((k) => !K.P[k]);
  if (bad.length) throw new Error(`unknown parameters: ${bad.join(', ')}`);
  const lin = keys.map((k) => LINEAR.has(k)), start = keys.map((k, i) => (lin[i] ? K.p(k) : Math.log(K.p(k))));
  const Ss = datasets.map(conditionsOf), cache = { sd: {} };
  const setX = (x) => { keys.forEach((k, i) => { K.P[k].v = lin[i] ? x[i] : Math.exp(x[i]); }); K.CAL.version++; };
  const res = (x) => { setX(x); return datasets.flatMap((d, i) => residuals(d, Ss[i], cache)); };
  const chi2 = (x) => res(x).reduce((a, v) => a + v * v, 0);
  // several starts: the base values and decades around them (energies ± 0.3)
  let best = null;
  const offs = keys.length <= 2 ? [-4, -2, 0, 2, 4] : [-2, 0, 2];
  const combos = keys.reduce((acc, _, i) => acc.flatMap((c) => offs.map((o) => [...c, o])), [[]]);
  for (const c of combos) {
    const x0 = start.map((v, i) => v + (lin[i] ? 0.075 * c[i] : 1.15 * c[i]));
    const f0 = chi2(x0);
    if (!best || f0 < best.f0) best = { x0, f0 };
  }
  let opt = nelderMead(chi2, best.x0, { step: lin.map((l) => (l ? 0.1 : 1)) });
  opt = nelderMead(chi2, opt.x, { step: lin.map((l) => (l ? 0.02 : 0.2)), iters: 600 }); // restart: polish
  // uncertainty: J at the optimum, cov = (JᵀJ)⁻¹ (residuals are σ-normalised)
  const r0 = res(opt.x), m = r0.length, n = keys.length, J = Array.from({ length: m }, () => Array(n).fill(0));
  for (let j = 0; j < n; j++) { const h = lin[j] ? 1e-3 : 1e-3, x = opt.x.slice(); x[j] += h; const r1 = res(x); for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r0[i]) / h; }
  const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
  const cov = invert(JtJ, n), dof = Math.max(1, m - n), chi = opt.f;
  setX(opt.x);
  const params = {}, dsOf = (k) => datasets.find((d) => d.fit.includes(k)).id;
  keys.forEach((k, i) => {
    const s = cov ? Math.sqrt(Math.max(0, cov[i][i])) : Infinity, v = K.p(k);
    params[k] = { v: +v.toPrecision(4), unc: +(lin[i] ? s / Math.abs(v || 1) : Math.expm1(s)).toPrecision(2), dataset: dsOf(k) };
  });
  // the report: each target and check with its prediction, under the fitted values
  const report = datasets.map((d, i) => ({
    id: d.id, title: d.title, ref: d.ref,
    targets: (d.targets ?? []).map((tg) => ({ ...strip(tg), predicted: round(predict(tg, Ss[i])) })),
    checks: (d.checks ?? []).map((tg) => ({ ...strip(tg), predicted: round(predict(tg, Ss[i])) })),
    series: d.series?.length ? { points: d.series.length, columns: seriesColumns(d.series) } : undefined,
    caveats: d.caveats,
  }));
  const merged = { ...(base?.params ?? {}), ...params };
  const profile = {
    format: K.CAL_FORMAT, name, created,
    datasets: [...(base?.datasets ?? []).filter((b) => !datasets.some((d) => d.id === b.id)), ...datasets.map((d) => ({ id: d.id, title: d.title, ref: d.ref ?? '', kind: d.kind ?? 'user', ...(d.caveats ? { caveats: d.caveats } : {}) }))],
    params: merged, fit: { chi2: +chi.toPrecision(4), points: m, dof, reduced_chi2: +(chi / dof).toPrecision(3), report },
  };
  before ? K.applyProfile(before) : K.resetCalibration();
  return { profile, report };
}
const round = (v) => (Number.isFinite(v) ? +v.toPrecision(4) : v === Infinity ? 'none (never)' : v);
const strip = (tg) => Object.fromEntries(Object.entries(tg).filter(([k]) => !['model'].includes(k)));

// ---------------------------------------------------------------- the user's data
// a CSV with a header: t_s (or t), then observable columns (SERIES_OBS ids), optional <id>_sd and inputs
export function parseSeriesCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('the CSV needs a header and at least one row');
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
  const ti = head.findIndex((h) => /^t(_s)?$|^time(_s)?$/i.test(h));
  if (ti < 0) throw new Error('no time column (t_s)');
  const rows = lines.slice(1).map((l) => { const c = l.split(sep); const r = { t: +c[ti] }; head.forEach((h, i) => { if (i !== ti && c[i] !== undefined && c[i].trim() !== '') r[h] = +c[i]; }); return r; }).filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  const known = new Set([...SERIES_OBS, ...INPUTS, ...SERIES_OBS.map((c) => `${c}_sd`)]), ignored = head.filter((h, i) => i !== ti && !known.has(h));
  return { rows, columns: head.filter((h, i) => i !== ti && known.has(h)), ignored };
}
// a template CSV for the current conditions: the observables that apply, sampled from the model
export function templateCSV(S, times = Array.from({ length: 11 }, (_, i) => i * ((S.movDur ?? 30) / 10))) {
  const sim = simulateSeries(S, times), cols = SERIES_OBS.filter((c) => sim.some((r) => Number.isFinite(r[c])));
  return ['# TEM-view series template: replace the model values with your measurements (keep the header). Optional: <column>_sd for σ; T_K, lcRate, gcP, bsV are inputs when present.', ['t_s', ...cols].join(','), ...sim.map((r) => [r.t, ...cols.map((c) => +(+r[c]).toPrecision(5))].join(','))].join('\n');
}
// a dataset from the user's own series (and/or targets) under the state S (its timeline included)
export function userDataset(S, { rows = [], targets = [], fitKeys, id = 'mine', title = 'My measurements', ref = '' } = {}) {
  const session = structuredClone(S);
  return { id, kind: 'user', title, ref, session, conditions: null, series: rows, targets, fit: fitKeys ?? suggestFit(S, seriesColumns(rows)) };
}

// keep the kinetics on the profile a state asks for: 'published' (default), 'none' (the defaults) or 'user'
export function syncCalibration(S) {
  const want = S.calib === 'none' ? null : S.calib === 'user' && K.isProfile(S.calibProfile) ? S.calibProfile : PUBLISHED;
  if (K.CAL.profile === want) return false;
  want ? K.applyProfile(want) : K.resetCalibration();
  return true;
}
export { PUBLISHED };
