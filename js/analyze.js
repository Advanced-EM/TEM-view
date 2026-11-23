// Analyses of what the microscope shows right now. Where the emskills registry (github.com/emskills-mcp/em-skills)
// has a skill for the same job, the analysis uses that skill's tool name:
//   fit_ctf          = emskills ctf-fitter (fit_ctf)            defocus and astigmatism from the Thon rings
//   fit_lattice      = emskills lattice-dspacing (fit_lattice)  lattice spacings from diffraction, indexed (hkl)
//   identify_edges   = emskills eels-edge-id (identify_edges)   core-loss edges in an EELS spectrum
//   fit_eds          not in emskills (edax-phase-map is related: it maps phases, this fits peaks and resolution)
//   fit_zlp          not in emskills                            energy spread from the EELS zero-loss peak
//   fit_hologram     not in emskills                            off-axis hologram fringe spacing and contrast
//
// Each analysis reads the detector data (export.js collectData) with its calibration, runs the fit from
// calibrate.js, and also returns the simulator's true settings, so a measurement can be checked against the truth.
// Runs in browsers and in Node (temview-mcp).
import * as P from './physics.js';
import { edgeStats } from './eels.js';
import { collectData } from './export.js';
import { fitCTF, fitZLP, fitEDS, fitHologram } from './calibrate.js';

const r = (v, n = 3) => (v == null || !Number.isFinite(v) ? v : +v.toFixed(n));

// background-subtracted radial profile of a square array around its center → peaks (radius px, strength)
function radialPeaks(arr, n, { skip = 6, W = 7 } = {}) {
  const c = n / 2, prof = new Float64Array(n), cnt = new Float64Array(n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = Math.round(Math.hypot(x - c, y - c)); if (i < n) { prof[i] += arr[y * n + x]; cnt[i]++; } }
  for (let i = 0; i < n; i++) prof[i] /= cnt[i] || 1;
  const rel = new Float64Array(n), peaks = [];
  for (let i = Math.max(W, skip); i < c - W; i++) { let s = 0; for (let j = -W; j <= W; j++) s += prof[i + j]; rel[i] = prof[i] / (s / (2 * W + 1)) - 1; }
  for (let i = Math.max(W, skip) + 1; i < c - W - 1; i++) if (rel[i] > 0.02 && rel[i] >= rel[i - 1] && rel[i] > rel[i + 1]) {
    const y0 = rel[i - 1], y1 = rel[i], y2 = rel[i + 1];
    peaks.push({ r: i + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 || 1e-9), s: y1 });
  }
  return peaks;
}

// allowed reflections (Å) of each specimen: structure-factor extinctions applied (fcc, diamond, perovskite)
const cubic = (a, hkls) => hkls.map(([h, k, l]) => [`${h}${k}${l}`, +(a / Math.hypot(h, k, l)).toFixed(3)]);
const REFLECTIONS = {
  au: cubic(4.0782, [[1, 1, 1], [2, 0, 0], [2, 2, 0], [3, 1, 1], [2, 2, 2], [4, 0, 0], [3, 3, 1]]),
  si: cubic(5.431, [[1, 1, 1], [2, 2, 0], [3, 1, 1], [4, 0, 0], [3, 3, 1], [4, 2, 2]]),
  sto: cubic(3.905, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 0, 0], [2, 1, 0], [2, 1, 1], [2, 2, 0]]),
  gr: [['100', 2.13], ['110', 1.23], ['200', 1.065], ['210', 0.805]],
  mof: cubic(20.75, [[1, 1, 1], [2, 0, 0], [2, 2, 0], [3, 1, 1], [2, 2, 2], [4, 0, 0]]),
  bio: [],
};

export const ANALYSES = {
  fit_ctf: {
    skill: 'ctf-fitter', registry: true, label: 'CTF fit', modes: ['tem'],
    run(sim, S, data) {
      const img = data.arrays.image, pixA = data.meta.calibration.pixel_A;
      const f = fitCTF(img.data, img.shape[1], img.shape[0], { pixA, kV: S.kV, CsA: sim.CsA() });
      const df = r(f.df / 10, 1), trueDf = r(sim.dfA() / 10, 1), A1 = r(f.A1 / 10, 1), trueA1 = r(sim.abA().A1 / 10, 1);
      // number of Thon rings out to Nyquist: too many and they alias, too few and there is nothing to fit
      const kN = 1 / (2 * pixA), rings = sim.lam * Math.abs(f.df) * kN * kN;
      const advice = rings > 90 ? ' The rings are very dense at this magnification: zoom out for a reliable fit.' : rings < 2 ? ' Few rings at this defocus and magnification: zoom in or defocus more.' : '';
      return { summary: `Defocus ${df} nm (true ${trueDf} nm), astigmatism ${A1} nm at ${Math.round(f.A1a)}° (true ${trueA1} nm); fit to ${r(f.fitRes, 2)} Å.${advice}`,
        result: { defocus_nm: df, astigmatism_nm: A1, astigmatism_deg: r(f.A1a, 1), fit_resolution_A: r(f.fitRes, 2), score: r(f.score, 3) },
        truth: { defocus_nm: trueDf, astigmatism_nm: trueA1 } };
    },
  },
  fit_lattice: {
    skill: 'lattice-dspacing', registry: true, label: 'd-spacings', modes: ['diff'],
    run(sim, S, data) {
      const p = data.arrays.pattern, kPerPx = data.meta.calibration.k_per_px_invA;
      const refl = REFLECTIONS[S.spec] ?? [];
      const measured = radialPeaks(p.data, p.shape[0]).sort((a, b) => b.s - a.s).slice(0, 8).map((q) => 1 / (q.r * kPerPx)).sort((a, b) => b - a);
      if (!measured.length) throw new Error('no rings or spots found: check the beam is on and the selected area covers the specimen');
      const spacings = measured.map((d) => {
        const [hkl, e] = refl.reduce((best, x) => (Math.abs(x[1] / d - 1) < Math.abs(best[1] / d - 1) ? x : best), ['', Infinity]);
        const err = (d / e - 1) * 100;
        return Math.abs(err) < 3 ? { d_A: r(d, 3), hkl, expected_A: e, error_pct: r(err, 2) } : { d_A: r(d, 3), hkl: null };
      });
      const idx = spacings.filter((x) => x.hkl);
      const notes = spacings.length - idx.length ? `; ${spacings.length - idx.length} unindexed (amorphous support or noise)` : '';
      return { summary: idx.length ? `Indexed ${idx.map((x) => `(${x.hkl}) ${x.d_A} Å`).join(', ')}${notes}` : `Spacings ${spacings.map((x) => `${x.d_A} Å`).join(', ')}, none matching ${sim.spec.name}`,
        result: { spacings }, truth: { reflections_A: Object.fromEntries(refl) } };
    },
  },
  fit_zlp: {
    skill: null, registry: false, label: 'zero-loss peak', modes: ['eels'],
    run(sim, S, data) {
      const sp = data.arrays.spectrum, c = data.meta.calibration, n = sp.shape[0];
      const E = Float64Array.from({ length: n }, (_, i) => c.energy_start_eV + i * c.energy_eV_per_channel);
      if (E[0] > 0 || E[n - 1] < 0) throw new Error('the zero-loss peak is not in the spectrum window: set the energy offset below 0 eV (say "zero loss" or choose the ZLP range)');
      const f = fitZLP(E, Float64Array.from(sp.data));
      return { summary: `Zero-loss FWHM ${r(f.fwhm, 3)} eV at ${r(f.center, 2)} eV (${r(c.energy_eV_per_channel, 3)} eV/channel; source energy spread ${r(S.profile?.dE, 2)} eV)`,
        result: { fwhm_eV: r(f.fwhm, 3), center_eV: r(f.center, 3), eV_per_channel: c.energy_eV_per_channel }, truth: { energy_spread_eV: S.profile?.dE } };
    },
  },
  identify_edges: {
    skill: 'eels-edge-id', registry: true, label: 'EELS edges', modes: ['eels'],
    run(sim, S, data) {
      const sp = data.arrays.spectrum, c = data.meta.calibration, n = sp.shape[0], I = sp.data;
      const ch = (e) => Math.round((e - c.energy_start_eV) / c.energy_eV_per_channel);
      const found = [], checked = [];
      for (const ed of P.EDGES) {
        const a0 = ch(ed.E - 40), a1 = ch(ed.E - 4), b0 = ch(ed.E + 4), b1 = ch(ed.E + 30);
        if (a0 < 0 || b1 >= n || a1 - a0 < 4) continue;
        // power-law background fitted before the edge, extrapolated over the window after it
        let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
        for (let i = a0; i <= a1; i++) { const e = c.energy_start_eV + i * c.energy_eV_per_channel, v = I[i]; if (v <= 0 || e <= 0) continue; const x = Math.log(e), y = Math.log(v); sx += x; sy += y; sxx += x * x; sxy += x * y; m++; }
        if (m < 4) continue;
        const b = (m * sxy - sx * sy) / (m * sxx - sx * sx), a = (sy - b * sx) / m;
        let sig = 0, bg = 0;
        for (let i = b0; i <= b1; i++) { const e = c.energy_start_eV + i * c.energy_eV_per_channel; sig += I[i]; bg += Math.exp(a + b * Math.log(e)); }
        const jump = sig / (bg || 1);
        checked.push(ed.name);
        if (jump > 1.08) found.push({ edge: ed.name, element: ed.el, onset_eV: ed.E, jump_ratio: r(jump, 2) });
      }
      const present = [...new Set(sim.spec.elements.map((e) => P.EL[e].sym))];
      return { summary: found.length ? `Edges: ${found.map((f) => `${f.edge} (${f.onset_eV} eV, ×${f.jump_ratio})`).join(', ')}` : `No edges in ${r(c.energy_start_eV, 0)}–${r(c.energy_start_eV + n * c.energy_eV_per_channel, 0)} eV (checked ${checked.join(', ') || 'none in range'})`,
        result: { edges: found, window_eV: [r(c.energy_start_eV, 1), r(c.energy_start_eV + n * c.energy_eV_per_channel, 1)] }, truth: { elements: present } };
    },
  },
  // single-particle cryo-EM: resolution by half-map FSC (global and directional), particles kept, CTF and picking
  spa_stats: {
    skill: null, registry: false, label: 'Single-particle resolution (FSC) and data quality', modes: ['spa'],
    run(sim, S) {
      const A = sim.spa, o = A?.out;
      if (!o?.fsc) throw new Error('collect and process the particles first (action collect)');
      const m = o.mic;
      return { summary: `${o.accepted} particles kept of ${o.made} (+${o.junkMade} false picks): ${o.fsc.res.toFixed(2)} Å at FSC 0.143 (along the preferred axis ${o.fscZ.res.toFixed(2)} Å, across ${o.fscXY.res.toFixed(2)} Å); map correlation with the particle ${o.mapCorr.toFixed(3)}`,
        result: { sample: A.o.sample, particles: o.made, kept: o.accepted, false_picks: o.junkMade, rejected: o.rejected, resolution_A: r(o.fsc.res, 4), resolution_along_z_A: r(o.fscZ.res, 4), resolution_across_z_A: r(o.fscXY.res, 4), fsc_mean: r(o.fsc.mean, 4), fsc_20_8A: { global: r(o.fsc.band, 4), along_z: r(o.fscZ.band, 4), across_z: r(o.fscXY.band, 4) },
          fsc: o.fsc.curve.map((c) => [r(c.k, 4), r(c.fsc, 4)]), pixel_A: o.px, box_px: o.N, dose: A.o.dose, underfocus_um: A.o.df, zernike: A.o.zpp, preferred_fraction: A.o.pref, alignment_error_deg: A.o.angErr,
          ctf_rms_error_A: o.ctfErr != null ? r(o.ctfErr, 3) : null, picking: m ? { precision: r(m.precision, 3), recall: r(m.recall, 3) } : null },
        truth: { map_correlation: r(o.mapCorr, 4) } };
    },
  },
  // tomography: the reconstruction against the phantom, and the missing-wedge elongation (measured on test beads)
  tomo_stats: {
    skill: null, registry: false, label: 'Tomogram quality and missing-wedge elongation', modes: ['tomo'],
    run(sim, S) {
      const T = sim.tomo;
      if (!T || T.ser.proj.length < T.angles.length) throw new Error('collect the tilt series first (action collect)');
      if (!T.stats) sim.tomoStats();
      const st = T.stats;
      return { summary: `${T.angles.length} projections to ±${S.tomoMax}° (${S.tomoScheme}), ${T.rec.method === 'sirt' ? `SIRT ${T.rec.iter} iterations` : 'WBP'}: correlation with the phantom ${st.corr.toFixed(3)}; elongation along the beam predicted ${st.pred.toFixed(3)}${st.meas ? `, measured ${st.meas.toFixed(3)} on the smallest beads` : ''}`,
        result: { projections: T.angles.length, max_tilt_deg: S.tomoMax, scheme: S.tomoScheme, method: T.rec.method, iterations: T.rec.iter, voxel_A: r(T.ph.vox, 4), volume_px: T.ph.N, correlation: r(st.corr, 4), elongation_predicted: r(st.pred, 4), elongation_measured: st.meas ? r(st.meas, 4) : null,
          beads: st.beads?.map((b) => ({ d_nm: r(b.d_nm, 3), elongation: r(b.e, 4), fwhm_y_px: r(b.wy, 3), fwhm_z_px: r(b.wz, 3) })) ?? null, total_dose: r(T.o.dose, 4), mass_left: r(T.ser.massLeft, 3) },
        truth: { elongation_radermacher: r(st.pred, 4) } };
    },
  },
  // 3D ED: completeness and ⟨I/σ⟩ per resolution shell of the series recorded so far, and the dose-limited resolution
  ed3d_stats: {
    skill: null, registry: false, label: '3D ED completeness and resolution', modes: ['ed3d'],
    run(sim, S) {
      const e = sim.ed;
      if (!e || e.none) throw new Error('3D ED needs a crystal or a structure of atoms (load an XYZ or CIF)');
      if (e.diffuse) return { summary: `${e.name}: diffuse scattering only, nothing to index`, result: { lattice: null, completeness: 0, frames: e.series.plan.frames }, truth: {} };
      const st = e.collected >= 1 ? e.stats : e.full, p = e.series.plan;
      return { summary: `${(100 * st.completeness).toFixed(1)} % complete (${S.edMerge === 'laue' ? 'cubic Laue class' : 'Friedel pairs'}) over ${p.range}° in ${p.frames} frames; ${st.dLimit ? `median I/σ ≥ 2 to ${st.dLimit.toFixed(2)} Å` : 'no shell at median I/σ ≥ 2'}; ${p.totalDose.toPrecision(3)} e⁻/Å²${e.collected < 1 ? ' (the full planned series; press Collect to record it)' : ''}`,
        result: { lattice: e.lattice ? Object.fromEntries(Object.entries(e.lattice.params).map(([k, v]) => [k, r(v, 4)])) : null, completeness: r(st.completeness, 4), unique: st.unique, observed: st.observed, d_limit_A: st.dLimit ? r(st.dLimit, 3) : null, range_deg: p.range, frames: p.frames, wedge_deg: r(p.wedge, 4), total_dose: r(p.totalDose, 4), method: S.edMethod, merge: e.merge,
          shells: st.shells.map((s) => ({ d_A: [r(s.dLow, 3), r(s.dHigh, 3)], completeness: r(s.completeness, 3), mean_I_over_sigma: r(s.meanIsig, 2) })) },
        truth: { expected_completeness_friedel: r(Math.min(1, p.range / 180), 4) } };
    },
  },
  // orientation and phase mapping (ACOM) of a 4D-STEM / SPED scan: grains (orientation clusters), phase fractions
  map_orientation: {
    skill: null, registry: false, label: '4D-STEM orientation and phase map', modes: ['4d'],
    run(sim, S) {
      const f = sim.fd;
      if (!f || f.done < f.N * f.N) throw new Error('the 4D scan is not complete yet: acquire first');
      sim.computeOrientation();
      if (f.oriNone) throw new Error(`no crystal template for ${sim.spec.name}`);
      const n = f.N * f.N, per = f.oriPeriod, bins = new Map();
      let nc = 0, na = 0, nv = 0, rel = 0;
      for (let i = 0; i < n; i++) {
        if (f.phase[i] === 2) { nc++; rel += f.oriR[i]; const b = Math.round(f.ori[i] / 2) * 2 % per; bins.set(b, (bins.get(b) ?? 0) + 1); }
        else if (f.phase[i] === 1) na++; else nv++;
      }
      // grains: orientation clusters (±4°) holding at least 5 % of the crystalline pixels
      const grains = [], used = new Set();
      for (const [b] of [...bins].sort((a, c) => c[1] - a[1])) {
        if (used.has(b)) continue;
        let cnt = 0, sum = 0;
        for (const [b2, c2] of bins) { const d = Math.min(Math.abs(b2 - b), per - Math.abs(b2 - b)); if (d <= 4 && !used.has(b2)) { cnt += c2; sum += c2 * (b + (((b2 - b + per / 2) % per + per) % per - per / 2)); used.add(b2); } }
        if (cnt >= 0.05 * nc) grains.push({ omega_deg: r(((sum / cnt) % per + per) % per, 1), fraction: r(cnt / n, 3) });
      }
      const truth = sim.spec.grainRot?.map((g) => r((((g * 180) / Math.PI) % per + per) % per, 2));
      return { summary: `${grains.length} grain orientation${grains.length === 1 ? '' : 's'}: ${grains.map((g) => `ω ${g.omega_deg}° (${Math.round(100 * g.fraction)} %)`).join(', ')}; crystal ${Math.round((100 * nc) / n)} %, amorphous ${Math.round((100 * na) / n)} %, vacuum ${Math.round((100 * nv) / n)} %${f.ped ? ` (precessed, φ ${f.ped.phi} mrad)` : ' (no precession)'}`,
        result: { grains, phase_fraction: { crystal: r(nc / n, 3), amorphous: r(na / n, 3), vacuum: r(nv / n, 3) }, mean_reliability: nc ? r(rel / nc, 3) : 0, period_deg: per, precession_mrad: f.ped?.phi ?? 0 },
        truth: { grain_rotations_deg: truth } };
    },
  },
  // power-law background before an edge, net signal in a window after it: r, S/B and S/N (Egerton's h)
  fit_edge: {
    skill: null, registry: false, label: 'EELS edge: background, S/B, S/N', modes: ['eels'],
    run(sim, S, data, opts = {}) {
      const sp = data.arrays.spectrum, c = data.meta.calibration, n = sp.shape[0], I = Float64Array.from(sp.data);
      const E = Float64Array.from({ length: n }, (_, i) => c.energy_start_eV + (i + 0.5) * c.energy_eV_per_channel);
      const w0 = S.eelsWin - S.eelsWidth / 2, w1 = S.eelsWin + S.eelsWidth / 2, win = opts.window ?? [w0, w1];
      const pre = opts.pre ?? S.eelsPre ?? [Math.max(E[0] + 1, win[0] - Math.max(1, 0.1 * (win[1] - win[0])) - Math.max(15, 1.5 * (win[1] - win[0]))), win[0] - Math.max(1, 0.1 * (win[1] - win[0]))];
      const frames = Math.max(1, c.readouts || 1), st = edgeStats(E, Float64Array.from(I, (v) => v * frames), pre, win);
      if (!st) throw new Error('not enough background before the window: move the energy window onto an edge with ~20 eV of spectrum below it');
      const edge = P.EDGES.filter((ed) => sim.si?.comp[ed.key] && ed.E >= pre[1] - 5 && ed.E <= win[1]).map((ed) => ed.name);
      return { summary: `Background A·E^−r with r = ${r(st.r, 3)}; net ${Math.round(st.S)} counts over ${Math.round(st.B)} background in ${r(win[0], 1)}–${r(win[1], 1)} eV: S/B ${r(st.SB, 3)}, S/N ${r(st.SN, 3)} (h ${r(st.h, 2)})${edge.length ? `; edge ${edge.join(', ')}` : ''}`,
        result: { r: r(st.r, 4), signal_counts: Math.round(st.S), background_counts: Math.round(st.B), S_over_B: r(st.SB, 4), S_over_N: r(st.SN, 4), h: r(st.h, 3), pre_eV: pre.map((v) => r(v, 2)), window_eV: win.map((v) => r(v, 2)), collection_mrad: S.eelsBeta, readouts: frames },
        truth: { edges: edge } };
    },
  },
  fit_eds: {
    skill: null, related: 'edax-phase-map', registry: false, label: 'EDS peaks', modes: ['eds'],
    run(sim, S, data) {
      const sp = data.arrays.spectrum, kev = data.meta.calibration.energy_keV_per_bin, n = sp.shape[0];
      const E = Float64Array.from({ length: n }, (_, i) => (i + 0.5) * kev);
      const syms = [...new Set([...sim.spec.elements.map((e) => P.EL[e].sym), 'Cu'])];
      const lines = P.XRAY.filter((l) => syms.includes(l.el)).map((l) => ({ E: l.E, w: l.w, label: `${l.el} ${l.line}` }));
      let f;
      try { f = fitEDS(E, Float64Array.from(sp.data), lines); }
      catch { throw new Error('Not enough X-ray counts yet: let the EDS spectrum build up for a few seconds, then fit again.'); }
      return { summary: `Peaks ${f.found.map((p) => p.label).join(', ')}; resolution ${Math.round(f.fwhmMn)} eV at Mn Kα (true ${S.profile?.edsFWHM ?? '?'} eV)`,
        result: { peaks: f.found.map((p) => ({ line: p.label, keV: r(p.Emeas, 4), fwhm_eV: Math.round(p.fwhm * 1000), counts: Math.round(p.counts) })), gain: r(f.gain, 5), offset_keV: r(f.offset, 4), fwhm_MnKa_eV: Math.round(f.fwhmMn) },
        truth: { fwhm_MnKa_eV: S.profile?.edsFWHM, elements: syms } };
    },
  },
  fit_hologram: {
    skill: null, registry: false, label: 'hologram fringes', modes: ['oah'],
    run(sim, S, data) {
      const h = data.arrays.hologram, c = data.meta.calibration;
      const f = fitHologram(h.data, h.shape[1], h.shape[0], { pixA: c.pixel_A });
      return { summary: `Fringe spacing ${r(f.spacing, 3)} Å (true ${r(c.fringe_spacing_A, 3)} Å), contrast ${r(f.mu, 3)} (true ${r(c.fringe_contrast, 3)})`,
        result: { fringe_spacing_A: r(f.spacing, 4), contrast: r(f.mu, 4), angle_deg: r(f.angle, 1) }, truth: { fringe_spacing_A: r(c.fringe_spacing_A, 4), contrast: r(c.fringe_contrast, 4) } };
    },
  },
};

// the analysis that fits the current mode
export const defaultAnalysis = (mode) => ({ tem: 'fit_ctf', diff: 'fit_lattice', eels: 'identify_edges', eds: 'fit_eds', oah: 'fit_hologram' })[mode] ?? null;

export const ALIASES = { measure_dspacing: 'fit_lattice' };
export function analyze(sim, S, name) {
  name = ALIASES[name] ?? name ?? defaultAnalysis(S.mode);
  const a = ANALYSES[name];
  if (!a) throw new Error(`nothing to analyze in ${S.mode} mode: try TEM (CTF), diffraction (d-spacings), EELS (edges), EDS (peaks) or off-axis holography`);
  if (!a.modes.includes(S.mode)) throw new Error(`${a.label} needs ${a.modes.map((m) => m.toUpperCase()).join(' or ')} mode; the microscope is in ${S.mode.toUpperCase()}`);
  const data = collectData(sim, S);
  const emskills = a.registry ? { skill: a.skill, tool: name, in_registry: true } : { skill: null, in_registry: false, related: a.related ?? null };
  return { analysis: name, emskills, mode: S.mode, specimen: sim.spec.name, ...a.run(sim, S, data) };
}
