// Spectrum-image acquisition (EDS and EELS): the probe steps over an n × n scan and a full spectrum is recorded at
// every position, giving a datacube [y, x, channel] of counts that can be mapped, explored and exported.
//
// Where the signal comes from: the specimen's spectrum-image model (sim.computeSI: element maps blurred by the probe
// and drift, and t/λ), resampled to the scan, with the scan's own drift added row by row.
//   EDS  is linear in the atoms under the probe: each element contributes its X-ray lines (yield × detector
//        efficiency, broadened by the detector) and its share of the bremsstrahlung (∝ Z). The detected X-rays per
//        incident electron scale with the atoms per Å² along the beam (~1e-5 per atom/Å², a large SDD). Plus the
//        grid's Cu system peak where there is a grid.
//   EELS is not linear in thickness (plural scattering), so the spectrum is computed with the full model (eels.js,
//        Fourier-log) on a few thicknesses spanning the scan, for no edges and for each element alone; a pixel's
//        spectrum is the thickness-interpolated background plus its composition × each element's edge part.
//        Electrons per channel = the spectrum × the channel width × the electrons in the dwell; one readout per
//        pixel, so channels above the detector's full well saturate (as the zero loss does at long dwell).
// Noise: Poisson counts (EELS also the detector's excess factor and read noise). Beam-sensitive specimens lose
// signal with the dose per pixel against the critical dose (mass loss, as in the images).
import * as P from './physics.js';
import * as EELS from './eels.js';

export const SCAN_SIZES = [16, 32, 64];
const EDS_CH = 2048, EDS_DE = 0.01; // keV per channel: 0–20.48 keV
const EELS_CH = 1024; // the spectrometer's 2048 channels binned by 2
const E_CHARGE = 1.602e-19, XRAY_PER_ATOM = 1e-5;

// what the scan will be: size, channels, timing, electrons and dose per pixel
export function siPlan(sim, S = sim.S) {
  const mode = S.mode === 'eels' ? 'eels' : 'eds', n = SCAN_SIZES.includes(+S.siN) ? +S.siN : 32;
  const dwell = Math.max(1e-5, +S.siDwell / 1000), flyback = 1e-3, current_pA = mode === 'eels' ? S.eelsCurrent : S.siCurrent;
  const px = sim.fovA() / n, electrons = (current_pA * 1e-12 * dwell) / E_CHARGE;
  const [E0] = mode === 'eels' ? sim.eelsRangeBounds() : [0];
  const nch = mode === 'eels' ? EELS_CH : EDS_CH, dE = mode === 'eels' ? (2 * S.eelsDisp) : EDS_DE;
  return { mode, n, nch, dwell, flyback, current_pA, px, electrons, dosePerPx: electrons / (px * px), E0, dE, unit: mode === 'eels' ? 'eV' : 'keV',
    rowTime: n * dwell + flyback, total_s: n * (n * dwell + flyback), bytes: n * n * nch * 4 };
}

// past the edge of the model's field (drift carries late rows there), mirror it rather than repeat the edge pixels
const mirror = (x, N) => { const m = ((x % (2 * N)) + 2 * N) % (2 * N); return m < N ? m : 2 * N - 1 - m; };
// the scan's samples of the spectrum-image model: block averages of the 128² maps at the drifted positions
function sampler(sim, plan) {
  const si = sim.si, N = si.n, b = N / plan.n, [ux, uy] = sim.driftDir(), v = sim.driftSpeed();
  return (i, j, t) => {
    const sx = (v * ux * t) / si.dx, sy = (v * uy * t) / si.dx; // drift in model pixels
    const out = { atoms: {}, tau: 0, n: 0 };
    for (let q = 0; q < b; q++) for (let p = 0; p < b; p++) {
      const x = mirror(Math.round(i * b + p + sx), N), y = mirror(Math.round(j * b + q + sy), N), k = y * N + x;
      for (const e of si.els) out.atoms[e.key] = (out.atoms[e.key] ?? 0) + e.map[k];
      out.tau += si.tau[k]; out.n++;
    }
    for (const k in out.atoms) out.atoms[k] /= out.n;
    out.tau /= out.n;
    return out;
  };
}

// ---------------------------------------------------------------- EDS basis: per atom of each element
function edsBasis(sim, plan) {
  const S = sim.S, si = sim.si, keys = [...new Set(si.els.map((e) => e.key))], symOf = Object.fromEntries(si.els.map((e) => [e.key, e.sym]));
  const ZofKey = Object.fromEntries(si.els.map((e) => [e.key, P.EL[e.idx].Z]));
  const line = (arr, E, amp) => {
    const s = P.edsFWHM(E, S.profile.edsFWHM) / 2.355, b0 = Math.max(0, Math.floor((E - 4 * s) / EDS_DE)), b1 = Math.min(EDS_CH - 1, Math.ceil((E + 4 * s) / EDS_DE));
    for (let b = b0; b <= b1; b++) { const e = (b + 0.5) * EDS_DE; arr[b] += (amp * EDS_DE * Math.exp(-0.5 * ((e - E) / s) ** 2)) / (s * 2.5066); }
  };
  const basis = {};
  for (const k of keys) {
    const a = new Float32Array(EDS_CH), sym = symOf[k];
    for (const L of P.XRAY) if (L.el === sym) line(a, L.E, L.y * L.w * P.detEff(L.E));
    for (let b = 0; b < EDS_CH; b++) { const E = (b + 0.5) * EDS_DE; if (E >= 0.12 && E < S.kV) a[b] += 7e-7 * ZofKey[k] * ((S.kV - E) / E) * P.detEff(E) * 40; }
    basis[k] = a;
  }
  // the copper grid's system peak, per unit of total signal
  const cu = new Float32Array(EDS_CH);
  if (!sim.spec.noGrid) for (const L of P.XRAY) if (L.el === 'Cu') line(cu, L.E, 0.012 * L.w * P.detEff(L.E));
  // normalise: a "typical" atom (the scan mean composition) gives 1 detected X-ray per unit of XRAY_PER_ATOM
  let mean = 0, tot = 0; for (const k of keys) { const w = si.comp[k] ?? 0; mean += w * basis[k].reduce((s, x) => s + x, 0); tot += w; }
  const norm = mean / (tot || 1) || 1;
  for (const k of keys) basis[k] = basis[k].map((x) => x / norm);
  return { keys, basis, cu };
}

// ---------------------------------------------------------------- EELS basis: thickness grid × (background, each edge)
function eelsBasis(sim, plan, taus) {
  const keys = [...new Set(sim.si.els.map((e) => e.key))].filter((k) => P.EDGES.some((ed) => ed.key === k));
  let lo = Math.min(...taus), hi = Math.max(...taus);
  if (!(hi > lo + 1e-3)) { lo = Math.max(0, lo - 0.01); hi = lo + 0.02; }
  const K = 5, grid = Array.from({ length: K }, (_, i) => lo + ((hi - lo) * i) / (K - 1)), det = sim.eelsDet(), sh = sim.zlpShift();
  const build = (tau, comp) => EELS.applyPSF(EELS.buildSpectrum(sim.eelsModel({ tau, comp, px: null }), { E0: plan.E0, nb: plan.nch, dE: plan.dE, shift: sh }).spec, { ...det, psf: det.psf / 2 });
  const bg = grid.map((t) => build(t, {})), edge = {};
  for (const k of keys) edge[k] = grid.map((t, i) => { const s = build(t, { [k]: 1 }), b = bg[i]; return s.map((x, c) => x - b[c]); });
  return { keys, grid, bg, edge, det };
}

export function siStart(sim) {
  const plan = siPlan(sim), S = sim.S;
  if (!sim.si) sim.computeSI();
  const st = { plan, cube: new Float32Array(plan.n * plan.n * plan.nch), rows: 0, t: 0, running: true, done: false, sat: 0, maxCount: 0, sample: sampler(sim, plan),
    meta: { specimen: sim.spec.name, kV: S.kV, fov_A: sim.fovA(), beta_mrad: S.eelsBeta, alpha_mrad: S.alpha, started: new Date().toISOString() } };
  const Dc = sim.spec.beamSensitive ? sim.critDose() : Infinity;
  st.keep = Number.isFinite(Dc) ? 0.35 + 0.65 * Math.exp(-plan.dosePerPx / Dc) : 1; // signal left after the pixel's dose
  st.Dc = Dc;
  if (plan.mode === 'eds') st.basis = edsBasis(sim, plan);
  else { const taus = []; for (let j = 0; j < plan.n; j += Math.max(1, plan.n / 8)) for (let i = 0; i < plan.n; i += Math.max(1, plan.n / 8)) taus.push(st.sample(i, j, 0).tau); st.basis = eelsBasis(sim, plan, taus); }
  return st;
}

// one pixel's expected spectrum (counts per channel, before noise)
function expected(sim, st, i, j, t) {
  const { plan, basis } = st, smp = st.sample(i, j, t), out = new Float32Array(plan.nch);
  if (plan.mode === 'eds') {
    const dx = sim.si.dx, scale = XRAY_PER_ATOM * plan.electrons * st.keep;
    let atomsA2 = 0;
    for (const k of basis.keys) { const a = ((smp.atoms[k] ?? 0) / (dx * dx)) * 1.45; atomsA2 += a; if (a) { const B = basis.basis[k]; for (let c = 0; c < plan.nch; c++) out[c] += a * B[c] * scale; } }
    let tot = 0; for (let c = 0; c < plan.nch; c++) tot += out[c];
    for (let c = 0; c < plan.nch; c++) out[c] += basis.cu[c] * tot;
    return out;
  }
  const { grid, bg, edge } = basis, K = grid.length, f = Math.max(0, Math.min(K - 1.0001, ((smp.tau - grid[0]) / (grid[K - 1] - grid[0])) * (K - 1))), k0 = Math.floor(f), w = f - k0;
  let all = 0; for (const k in smp.atoms) all += smp.atoms[k];
  const e = plan.electrons * plan.dE;
  for (let c = 0; c < plan.nch; c++) out[c] = (bg[k0][c] * (1 - w) + bg[k0 + 1][c] * w) * e;
  for (const k of basis.keys) {
    const frac = (smp.atoms[k] ?? 0) / (all || 1); if (!frac) continue;
    const E = edge[k], m = frac * st.keep * e;
    for (let c = 0; c < plan.nch; c++) out[c] += (E[k0][c] * (1 - w) + E[k0 + 1][c] * w) * m;
  }
  return out;
}

// record whole rows for the elapsed time dt (s); returns true while the scan runs
export function siStep(sim, st, dt) {
  if (!st?.running) return false;
  st.t += dt;
  const { plan } = st, rows = Math.min(plan.n, Math.floor(st.t / plan.rowTime));
  for (let j = st.rows; j < rows; j++) {
    for (let i = 0; i < plan.n; i++) {
      const tPix = j * plan.rowTime + i * plan.dwell, mu = expected(sim, st, i, j, tPix), o = (j * plan.n + i) * plan.nch;
      if (plan.mode === 'eds') for (let c = 0; c < plan.nch; c++) st.cube[o + c] = P.poisson(mu[c]);
      else {
        const det = st.basis.det;
        let sat = false;
        for (let c = 0; c < plan.nch; c++) {
          const lam = mu[c], pz = P.poisson(lam);
          let v = lam + (pz - lam) * det.excess + det.read * P.gauss();
          if (v > det.fullWell) { v = det.fullWell; sat = true; }
          st.cube[o + c] = v;
        }
        if (sat) st.sat++;
      }
      for (let c = 0; c < plan.nch; c++) if (st.cube[o + c] > st.maxCount) st.maxCount = st.cube[o + c];
    }
  }
  st.rows = rows;
  if (rows >= plan.n) { st.running = false; st.done = true; }
  return st.running;
}
export function siRun(sim) { const st = siStart(sim); siStep(sim, st, Infinity); return st; }

// ---------------------------------------------------------------- reading the cube
export function energyOf(st, c) { return st.plan.E0 + (c + 0.5) * st.plan.dE; }
export function channelOf(st, E) { return Math.max(0, Math.min(st.plan.nch - 1, Math.floor((E - st.plan.E0) / st.plan.dE))); }
export function spectrumAt(st, i, j) { const { n, nch } = st.plan, o = (j * n + i) * nch; return st.cube.subarray(o, o + nch); }
// the mean spectrum over the recorded rows (or a rectangle [i0, j0, i1, j1])
export function meanSpectrum(st, roi = null) {
  const { n, nch } = st.plan, out = new Float64Array(nch), [i0, j0, i1, j1] = roi ?? [0, 0, n - 1, st.rows - 1];
  let m = 0;
  for (let j = j0; j <= Math.min(j1, st.rows - 1); j++) for (let i = i0; i <= i1; i++) { const o = (j * n + i) * nch; for (let c = 0; c < nch; c++) out[c] += st.cube[o + c]; m++; }
  return Float32Array.from(out, (v) => v / (m || 1));
}
// a map: counts in the window [Ea, Eb] (energy units of the plan). Background: EDS, a straight line between equal
// windows either side; EELS, a power law A·E⁻ʳ fitted to the window just below (two-area method), extrapolated
export function windowMap(st, Ea, Eb, { bgsub = false } = {}) {
  const { n, nch, mode } = st.plan, a = channelOf(st, Ea), b = Math.max(a, channelOf(st, Eb)), w = b - a + 1, map = new Float32Array(n * n);
  for (let j = 0; j < st.rows; j++) for (let i = 0; i < n; i++) {
    const o = (j * n + i) * nch;
    let s = 0; for (let c = a; c <= b; c++) s += st.cube[o + c];
    if (bgsub) {
      if (mode === 'eds') {
        const L = Math.max(0, a - w), R = Math.min(nch - 1, b + w); let l = 0, r = 0, nl = 0, nr = 0;
        for (let c = L; c < a; c++) { l += st.cube[o + c]; nl++; } for (let c = b + 1; c <= R; c++) { r += st.cube[o + c]; nr++; }
        s -= ((nl ? l / nl : 0) + (nr ? r / nr : 0)) / 2 * w;
      } else {
        const p0 = Math.max(0, a - w), pm = Math.max(p0 + 1, a - Math.ceil(w / 2)); let A1 = 0, A2 = 0;
        for (let c = p0; c < pm; c++) A1 += st.cube[o + c]; for (let c = pm; c < a; c++) A2 += st.cube[o + c];
        const E1 = energyOf(st, p0), E2 = energyOf(st, pm), E3 = energyOf(st, a);
        if (A1 > 0 && A2 > 0 && A1 > A2) {
          const r = 2 * Math.log(A1 / A2) / Math.log(E3 / E1), Aa = (A1 + A2) * (1 - r) / (Math.pow(E3, 1 - r) - Math.pow(E1, 1 - r)); // fit over the pre-edge window
          const Ec = energyOf(st, b + 1) - st.plan.dE / 2, Eo = E3 - st.plan.dE / 2, bg = (Aa / (1 - r)) * (Math.pow(Ec, 1 - r) - Math.pow(Eo, 1 - r));
          if (r > 0.5 && r < 8 && Number.isFinite(bg)) s -= bg; // a fit outside the physical range (too few counts) is not used
        }
      }
    }
    map[j * n + i] = s;
  }
  return map;
}
// the element line to map in EDS: its strongest line ± 1 FWHM (keV)
export function edsWindow(S, sym) {
  const L = P.XRAY.find((l) => l.el === sym && l.w === 1) ?? P.XRAY.find((l) => l.el === sym);
  if (!L) return null;
  const f = P.edsFWHM(L.E, S.profile.edsFWHM);
  return [L.E - f, L.E + f, L];
}

// ---------------------------------------------------------------- export
// Ripple (.rpl + .raw): read by HyperSpy (hs.load('x.rpl')), Lispix and DigitalMicrograph plug-ins. Float32,
// little-endian, one spectrum after another (record-by vector).
export function rippleFiles(st, name = 'spectrum-image') {
  const { n, nch, mode, E0, dE, px } = st.plan, rows = st.rows;
  const keys = [['width', n], ['height', rows], ['depth', nch], ['offset', 0], ['data-length', 4], ['data-type', 'float'], ['byte-order', 'little-endian'], ['record-by', 'vector'],
    ['width-origin', 0], ['width-scale', +(px / 10).toPrecision(6)], ['width-units', 'nm'], ['width-name', 'X'],
    ['height-origin', 0], ['height-scale', +(px / 10).toPrecision(6)], ['height-units', 'nm'], ['height-name', 'Y'],
    ['depth-origin', +(E0 + dE / 2).toPrecision(8)], ['depth-scale', +dE.toPrecision(8)], ['depth-units', mode === 'eels' ? 'eV' : 'keV'], ['depth-name', mode === 'eels' ? 'Energy loss' : 'Energy'],
    ['signal', mode === 'eels' ? 'EELS' : 'EDS_TEM'], ['beam-energy', st.meta.kV], ['convergence-angle', st.meta.alpha_mrad], ...(mode === 'eels' ? [['collection-angle', st.meta.beta_mrad]] : []),
    ...(mode === 'eels' ? [['ev-per-chan', +dE.toPrecision(8)]] : [['ev-per-chan', +(1000 * dE).toPrecision(8)]]), ['detector-peak-width-ev', 0]];
  const head = `;TEM-view simulated ${mode.toUpperCase()} spectrum image: ${st.meta.specimen}\n;dwell ${st.plan.dwell * 1000} ms, ${st.plan.current_pA} pA; simulated data for teaching and pipeline tests\nkey\tvalue\n${keys.map(([k, v]) => `${k}\t${v}`).join('\n')}\n`;
  const raw = new Uint8Array(st.cube.buffer.slice(0, n * rows * nch * 4));
  return [{ name: `${name}.rpl`, bytes: new TextEncoder().encode(head) }, { name: `${name}.raw`, bytes: raw }];
}
// the cube for collectData (export.js): array + HyperSpy-style axes
export function siArrays(st) {
  const { n, nch, mode, E0, dE, px } = st.plan;
  return { data: st.cube.subarray(0, n * st.rows * nch), shape: [st.rows, n, nch],
    calibration: { pixel_A: px, energy_start: E0, energy_per_channel: dE, energy_units: mode === 'eels' ? 'eV' : 'keV', dwell_s: st.plan.dwell, probe_current_pA: st.plan.current_pA, dose_per_pixel_e_A2: +st.plan.dosePerPx.toPrecision(4), saturated_pixels: st.sat,
      hyperspy: { axes: [{ name: 'y', units: 'nm', scale: px / 10, size: st.rows }, { name: 'x', units: 'nm', scale: px / 10, size: n }, { name: mode === 'eels' ? 'Energy loss' : 'Energy', units: mode === 'eels' ? 'eV' : 'keV', offset: E0 + dE / 2, scale: dE, size: nch }], signal_type: mode === 'eels' ? 'EELS' : 'EDS_TEM' } } };
}
