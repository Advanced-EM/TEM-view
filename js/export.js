// Collect the current detector data and its metadata, and package it as a NumPy .npz.
// Shared by the exhibit's "Export data" button and the headless runner (tools/headless.mjs).
import { npy, zip, jsonBytes } from './npy.js';
import { SESSION_KEYS } from './state.js';

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
  } else if (m === '4d' && sim.fd) {
    const f = sim.fd;
    arrays.datacube = A(f.data, [f.N, f.N, f.n4, f.n4], 'counts (a.u.); axes: scan y, scan x, ky, kx');
    arrays.virtual_image = A(f.vimg, [f.N, f.N], `virtual ${S.vdet}`);
    arrays.com_x = A(f.comX, [f.N, f.N], 'mrad'); arrays.com_y = A(f.comY, [f.N, f.N], 'mrad');
    Object.assign(cal, { scan_step_A: f.step, detector_mrad_per_px: f.mradPx, detector_mrad_per_px_nominal: f.mradPx * S.profile.camLCal, positions_recorded: f.done });
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
  } else if (sim.main) {
    arrays.image = A(sim.main.arr, [sim.main.h, sim.main.w], 'a.u.');
  }
  const state = Object.fromEntries(SESSION_KEYS.map((k) => [k, S[k]]));
  const meta = {
    format: 'tem-view-data/1', generator: 'Seeing with Electrons (TEM-view)', created: new Date().toISOString(),
    simulated: true, mode: m, specimen: sim.spec.name, calibration: cal,
    specimen_temperature_K: sim.temp(), holder: S.holder,
    optics: { wavelength_A: sim.lam, focal_spread_A: sim.focalSpread(), information_limit_A: sim.infoLimit(), Cs_A: sim.CsA() },
    arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, { shape: v.shape, units: v.units }])),
    state,
  };
  return { arrays, meta };
}

export function toNpz({ arrays, meta }) {
  const files = Object.entries(arrays).map(([k, v]) => ({ name: `${k}.npy`, bytes: npy(v.data, v.shape) }));
  files.push({ name: 'metadata.json', bytes: jsonBytes(meta) });
  return zip(files);
}
