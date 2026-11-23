// Collect the current detector data and its metadata, and package it as a NumPy .npz.
// Shared by the exhibit's "Export data" button and the headless runner (tools/headless.mjs).
import { npy, zip, jsonBytes } from './npy.js';
import { snapshot, activeMods } from './session.js';
import { footprintFor, summary as fpSummary } from './footprint.js';
import { OBSERVABLES } from './observables.js';
import * as KIN from './kinetics.js';

const A = (data, shape, units) => ({ data, shape, units });

export function collectData(sim, S) {
  const m = S.mode, arrays = {}, cal = {};
  if (m === 'tem' && sim.tem) {
    arrays.image = A(sim.tem.img, [sim.tem.c, sim.tem.c], 'counts (a.u.)');
    arrays.diffractogram = A(sim.tem.fft, [sim.tem.n, sim.tem.n], 'log |FFT|');
    cal.pixel_A = sim.tem.dx;
  } else if (m === 'stem' && sim.stemImg) {
    arrays.image = A(sim.stemImg.img, [sim.stemImg.c, sim.stemImg.c], `${sim.stemImg.type} signal (a.u.)`);
    cal.pixel_A = sim.stemImg.dx;
    if (sim.probe) { arrays.probe = A(sim.probe.I, [sim.probe.n, sim.probe.n], 'intensity'); cal.probe_pixel_A = sim.probe.dx; }
  } else if (m === 'spa' && sim.spa?.out?.mic) {
    // the first micrograph, the class averages and the half maps when processed
    const o = sim.spa.out, N = o.N;
    arrays.micrograph = A(o.mic.img, [o.mic.M, o.mic.M], 'contrast (1 = the beam); dark protein at underfocus');
    if (o.gallery) { const st = new Float32Array(o.gallery.length * N * N); o.gallery.forEach((c, k) => st.set(c.img, k * N * N)); arrays.class_averages = A(st, [o.gallery.length, N, N], 'phase-flipped class averages'); }
    if (o.maps) { arrays.half1 = A(o.maps[0], [N, N, N], 'half map 1 (V); axes z, y, x'); arrays.half2 = A(o.maps[1], [N, N, N], 'half map 2 (V)'); arrays.fsc = A(Float32Array.from(o.fsc.curve.flatMap((c) => [c.k, c.fsc])), [o.fsc.curve.length, 2], 'k (1/Å), FSC'); }
    Object.assign(cal, { pixel_A: o.px, box_px: N, ...sim.spa.o, resolution_A: o.fsc?.res ?? null, kept: o.accepted ?? 0 });
  } else if (m === 'tomo' && sim.tomo) {
    // the reconstruction (z, y, x), the tilt series recorded so far (tilt, v, x) and its angles
    const T = sim.tomo, N = T.ph.N, n = T.ser.proj.length, stack = new Float32Array(N * N * n);
    T.ser.proj.forEach((p, i) => stack.set(p, i * N * N));
    if (n) arrays.tilt_series = A(stack, [n, N, N], 'projections (Σ Z^1.7 per pixel, HAADF); axes: tilt, v, x (tilt axis along x)');
    arrays.tilt_angles = A(Float32Array.from(T.angles.slice(0, n)), [n], 'degrees');
    if (sim.tomoVolume()) arrays.reconstruction = A(sim.tomoVolume(), [N, N, N], 'reconstructed density; axes: z (beam), y, x');
    Object.assign(cal, { voxel_A: T.ph.vox, volume_px: N, max_tilt_deg: S.tomoMax, scheme: S.tomoScheme, signal: S.tomoSignal, method: T.rec?.method ?? null, iterations: T.rec?.iter ?? 0, total_dose: T.o.dose,
      elongation_predicted: T.pred, ...(T.stats ? { correlation: T.stats.corr, elongation_measured: T.stats.meas ?? null } : {}), object: T.ph.name });
  } else if (m === 'ed3d' && sim.ed && !sim.ed.none) {
    // the frame on the detector and the unmerged reflections recorded so far (h, k, l, I, σ, d)
    const e = sim.ed, img = sim.edFrame(e.det.W), acc = new Map(), upTo = Math.max(1, Math.ceil(e.collected));
    e.series.frames.forEach((fr, f) => { if (f < upTo) for (const o of fr) { const a = acc.get(o.i) ?? [0, 0]; a[0] += o.n; a[1] += o.n + o.b; acc.set(o.i, a); } });
    const rows = [...acc].map(([i, [n, v]]) => { const R = e.refl[i]; return [R.h, R.k, R.l, n, Math.sqrt(v), 1 / R.g]; });
    arrays.frame = A(img.arr, [img.W, img.W], 'counts');
    arrays.reflections = A(Float32Array.from(rows.flat()), [rows.length, 6], 'columns: h, k, l, I (counts), sigma, d (Å)');
    const p = e.series.plan;
    Object.assign(cal, { wavelength_A: sim.lam, camera_length_mm: e.det.L, pixel_mm: e.det.pix, detector_px: e.det.W, rotation_axis_deg: S.edAxis, start_deg: e.o.start, end_deg: e.o.end,
      wedge_deg: p.wedge, frames: p.frames, frames_recorded: Math.min(p.frames, upTo), method: S.edMethod, dose_per_frame: p.dosePerFrame, total_dose: p.totalDose,
      completeness: e.stats.completeness, merge: S.edMerge, d_limit_A: e.stats.dLimit, crystal: e.name });
  } else if (m === '4d' && sim.fd) {
    const f = sim.fd;
    arrays.datacube = A(f.data, [f.N, f.N, f.n4, f.n4], 'counts (a.u.); axes: scan y, scan x, ky, kx');
    arrays.virtual_image = A(f.vimg, [f.N, f.N], `virtual ${S.vdet}`);
    arrays.com_x = A(f.comX, [f.N, f.N], 'mrad'); arrays.com_y = A(f.comY, [f.N, f.N], 'mrad');
    Object.assign(cal, { scan_step_A: f.step, detector_mrad_per_px: f.mradPx, detector_mrad_per_px_nominal: f.mradPx * S.profile.camLCal, positions_recorded: f.done });
    if (f.ped) Object.assign(cal, { precession_mrad: f.ped.phi, precession_azimuths: f.ped.steps, descan_error_pct: f.ped.descan });
    if (f.ori && f.oriDone) { // orientation and phase maps (template matching)
      arrays.orientation_deg = A(f.ori, [f.N, f.N], `in-plane ω, 0–${f.oriPeriod}°`); arrays.correlation_index = A(f.oriQ, [f.N, f.N], 'Q');
      arrays.reliability = A(f.oriR, [f.N, f.N], '1 − Q2/Q1'); arrays.phase = A(Float32Array.from(f.phase), [f.N, f.N], '0 vacuum, 1 amorphous, 2 crystal');
      Object.assign(cal, { orientation_period_deg: f.oriPeriod, orientation_template: sim.orientationTemplate()?.name ?? null });
    }
  } else if (m === 'diff' && sim.diffDisp) {
    arrays.pattern = A(sim.diffDisp.arr, [sim.diffDisp.W, sim.diffDisp.W], 'intensity');
    Object.assign(cal, { k_per_px_invA: sim.diffDisp.kPerPx, camera_length_mm_nominal: S.camL, camera_length_mm_true: sim.camLTrue(), ellipticity: S.profile.ellip, ellipticity_axis_deg: S.profile.ellipAng });
  } else if ((m === 'cbed' || m === 'ronch') && sim[m === 'cbed' ? 'cbed' : 'ronch'].disp) {
    const d = sim[m === 'cbed' ? 'cbed' : 'ronch'].disp;
    arrays.pattern = A(d.arr, [d.W, d.W], 'intensity');
  } else if (m === 'eds' && sim.eds) {
    arrays.spectrum = A(sim.acc?.total ? sim.acc.spec : sim.eds.spec, [sim.eds.nb], 'counts');
    cal.energy_keV_per_bin = sim.eds.dE;
    for (const [sym, map] of Object.entries(sim.acc?.maps ?? {})) arrays[`map_${sym}`] = A(map, [sim.si.n, sim.si.n], 'counts');
    cal.map_pixel_A = sim.si?.dx;
  } else if (m === 'eels' && sim.eels) {
    const rec = (acc, fr, sp) => (acc && fr ? acc.map((v) => v / fr) : sp);
    arrays.spectrum = A(rec(sim.accE?.spec, sim.accE?.frames, sim.eels.ro.ro), [sim.eels.nb], 'electrons per channel per readout');
    Object.assign(cal, { energy_start_eV: sim.eels.E0, energy_eV_per_channel: sim.eels.dE, exposure_s: S.eelsExp, probe_current_pA: S.eelsCurrent, saturated_channels: sim.eels.ro.sat, readouts: sim.accE?.frames ?? 0, map_pixel_A: sim.si?.dx });
    const site = sim.eelsSite(), z = sim.zlp();
    Object.assign(cal, {
      collection_semi_angle_mrad: S.eelsBeta, convergence_semi_angle_mrad: S.alpha, beam_energy_keV: S.kV, source: S.eelsSource, zero_loss_fwhm_eV: +z.fwhm.toFixed(4),
      detector: sim.eelsDet().label, probe_pixel: site.px, t_over_lambda: +site.tau.toFixed(4),
      // the same information in HyperSpy's layout (signal axis and Acquisition_instrument.TEM), for hs.signals.EELSSpectrum
      hyperspy: { axes: [{ name: 'Energy loss', units: 'eV', offset: sim.eels.E0 + sim.eels.dE / 2, scale: sim.eels.dE, size: sim.eels.nb }], signal_type: 'EELS',
        Acquisition_instrument: { TEM: { beam_energy: S.kV, convergence_angle: S.alpha, Detector: { EELS: { collection_angle: S.eelsBeta, exposure: S.eelsExp } } } } },
    });
    if (sim.eels.low) {
      arrays.spectrum_low_loss = A(rec(sim.accE?.low, sim.accE?.framesLow, sim.eels.low.ro.ro), [sim.eels.nb], 'electrons per channel per readout');
      Object.assign(cal, { dual_eels: true, low_loss_start_eV: sim.eels.low.E0, low_loss_exposure_s: S.eelsExpLow, low_loss_saturated_channels: sim.eels.low.ro.sat, thickness_t_over_lambda: sim.eels.low.tau });
    }
    if (sim.eels.map) arrays.map = A(sim.eels.map, [sim.si.n, sim.si.n], 'window signal');
  } else if (m === 'oah' && sim.oah.disp) {
    const d = sim.oah.disp;
    arrays.hologram = A(d.holo, [d.c, d.c], 'counts (a.u.)');
    arrays.phase = A(d.ph, [d.c, d.c], 'rad');
    arrays.amplitude = A(d.amp, [d.c, d.c], 'relative');
    Object.assign(cal, { pixel_A: d.dx, fringe_spacing_A: d.s, fringe_contrast: d.mu, resolution_A: d.res });
  } else if (m === 'ilh' && sim.ilh.st) {
    const st = sim.ilh.st, c = st.c, stack = new Float32Array(st.thumbs.length * c * c);
    st.thumbs.forEach((t, j) => stack.set(t, j * c * c));
    arrays.focal_series = A(stack, [st.thumbs.length, c, c], 'intensity');
    if (st.rec) { arrays.exit_phase = A(st.rec.ph, [c, c], 'rad'); arrays.exit_amplitude = A(st.rec.amp, [c, c], 'relative'); }
    Object.assign(cal, { pixel_A: st.dx, defocus_A: st.dfs.slice(0, st.thumbs.length), iterations: st.it });
  } else if ((m === 'ltem' || m === 'lstem') && sim.lor.disp) {
    const d = sim.lor.disp, n = d.n, units = { image: 'intensity', phase: 'rad', induction_x: 'a.u.', induction_y: 'a.u.', dpc_x: 'segment difference / sum', dpc_y: 'segment difference / sum', dpc_sum: 'relative' };
    for (const [k, v] of Object.entries(sim.lor.arrays())) arrays[k] = A(v, [n, n], units[k]);
    Object.assign(cal, { pixel_A: d.dx, lorentz_deflection_urad: +(d.betaS * 1e6).toFixed(3), magnetic_state: d.info.state ?? null,
      ...(m === 'ltem' ? { lorentz_defocus_um: S.lorDf, divergence_urad: S.lorDiv } : { probe_semi_angle_urad: S.lorAlpha, probe_fwhm_A: d.fwhm }) });
  } else if (sim.main) {
    arrays.image = A(sim.main.arr, [sim.main.h, sim.main.w], 'a.u.');
  }
  // an in situ movie (insitu.js): the frames, their times, and each frame's environment and true drift
  const M = sim.movie;
  if (M?.frames.length) {
    const [h, w] = M.shape, st = new Float32Array(M.frames.length * h * w);
    M.frames.forEach((f, k) => st.set(f, k * h * w));
    arrays.movie = A(st, [M.frames.length, h, w], `${M.mode} frames (a.u.)`);
    arrays.movie_time = A(Float32Array.from(M.meta.map((m) => m.t)), [M.meta.length], 's from the start');
    arrays.movie_drift = A(Float32Array.from(M.meta.flatMap((m) => m.drift_A)), [M.meta.length, 2], 'specimen drift (x, y), Å, the truth for drift correction');
    arrays.movie_temperature = A(Float32Array.from(M.meta.map((m) => m.T_K)), [M.meta.length], 'K at the specimen');
    // the design's observables, one array each (observables.js)
    for (const k of Object.keys(M.meta[0]?.obs ?? {})) arrays[`obs_${k}`] = A(Float32Array.from(M.meta.map((m) => m.obs?.[k] ?? NaN)), [M.meta.length], `${OBSERVABLES[k].label}${OBSERVABLES[k].unit ? ` (${OBSERVABLES[k].unit})` : ''}`);
    cal.experiment = { name: S.expName || null, question: S.expGoal || null, observables: Object.keys(M.meta[0]?.obs ?? {}) };
    cal.movie = { mode: M.mode, fps: M.plan.fps, duration_s: M.plan.duration_s, frames_planned: M.plan.frames, frames_kept: M.frames.length, every: M.plan.every, timeline: M.timeline, frame_meta: M.meta };
  }
  const state = snapshot(S);
  // the kinetics behind the in situ processes in play, with each parameter's source and label (kinetics.js)
  const procs = [...(S.envCell === 'liquid' ? ['radiolysis', 'bubbles', ...(S.lcPrecursor ? ['growth'] : [])] : []), ...(S.envCell === 'gas' && S.holder === 'heat' ? ['sintering', 'redox'] : []), ...(S.bsOn && S.envCell === 'liquid' ? ['electrochemistry'] : [])];
  const meta = {
    format: 'tem-view-data/1', generator: 'Seeing with Electrons (TEM-view)', created: new Date().toISOString(),
    simulated: true, mode: m, technique: m, mods: activeMods(S), specimen: sim.spec.name, calibration: cal,
    specimen_temperature_K: sim.temp(), holder: S.holder,
    optics: { wavelength_A: sim.lam, focal_spread_A: sim.focalSpread(), information_limit_A: sim.infoLimit(), Cs_A: sim.CsA() },
    arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, { shape: v.shape, units: v.units }])),
    footprint: fpSummary(footprintFor(S, sim)),
    ...(procs.length ? { kinetics: KIN.provenance(procs) } : {}),
    state,
  };
  return { arrays, meta };
}

export function toNpz({ arrays, meta }) {
  const files = Object.entries(arrays).map(([k, v]) => ({ name: `${k}.npy`, bytes: npy(v.data, v.shape) }));
  files.push({ name: 'metadata.json', bytes: jsonBytes(meta) });
  return zip(files);
}
