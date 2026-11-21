// EELS engine: the recorded energy-loss spectrum from a single-scattering model, by Fourier-log plural
// scattering, then the detector. Pure functions (no DOM), shared by the exhibit, headless runs and tests.
//
//   J(E) = I₀ e^(−τ) · Z(E) ⊗ F⁻¹[ exp( F[s(E)] ) ]                       (Egerton, EELS in the EM, ch. 4)
//
// s(E) is the single-scattering distribution per incident electron (plasmons, the valence/core tail and the
// core edges; ∫s ≈ τ = t/λ) and Z(E) the zero-loss peak, an asymmetric pseudo-Voigt for the source. The
// detector's point spread and noise come after, in channel space (applyPSF, readout in sim.js).
//
// Collection angle β and beam energy enter through the angular factor of the Bethe cross-section,
// ln(1 + (β/θ_E)²) with θ_E = E / (2γT), taken relative to the reference (200 kV, β = 20 mrad) at which the
// edge shapes and the background slope were set; so a small β steepens the background (larger r) and
// weakens high-energy edges, as on a real spectrometer.
import * as P from './physics.js';

export const REF = { kV: 200, beta: 20 };
const M0C2 = 510998.95; // eV

// ---------------------------------------------------------------- sources, spectrometer, detectors
export const ZLP_SOURCES = {
  profile: { label: 'Instrument profile', fwhm: null, asym: 1.15, eta: 0.06 },
  schottky: { label: 'Schottky FEG (≈ 0.7 eV)', fwhm: 0.7, asym: 1.25, eta: 0.06 },
  cfeg: { label: 'Cold FEG (≈ 0.35 eV)', fwhm: 0.35, asym: 1.4, eta: 0.1 },
  mono: { label: 'Monochromated (≈ 0.08 eV)', fwhm: 0.08, asym: 1.0, eta: 0.03 },
};
export const SPECTROMETER_FWHM = 0.05; // eV, spectrometer aberrations at a fine dispersion
// asym: the loss-side half width over the gain-side one (the energy distribution of a field emitter has a tail
// on its low-energy side, which shows as a tail towards positive loss)
export function zlpParams(source, profileDE) {
  const z = ZLP_SOURCES[source] ?? ZLP_SOURCES.profile, src = z.fwhm ?? profileDE;
  return { source: ZLP_SOURCES[source] ? source : 'profile', src, fwhm: Math.hypot(src, SPECTROMETER_FWHM), asym: z.asym, eta: z.eta };
}
export function zlpShape(E, { fwhm, asym = 1, eta = 0 }) {
  const wL = (2 * fwhm) / (1 + asym), w = E < 0 ? wL : asym * wL, x = (2 * E) / w;
  return (1 - eta) * Math.exp(-Math.LN2 * x * x) + eta / (1 + x * x);
}

export const DETECTORS = {
  // psf: Gaussian σ (channels); tail: fraction in a Lorentzian of half width tailW (scintillator light spread);
  // fpn: channel-to-channel gain variation; read: read noise (e⁻ rms per channel per readout); excess: noise
  // factor on the shot noise (scintillator gain statistics)
  ccd: { label: 'Scintillator CCD', psf: 0.85, tail: 0.1, tailW: 4, fpn: 0.015, read: 3, excess: 1.4, fullWell: 65535 / 4 },
  direct: { label: 'Direct electron (counting)', psf: 0.3, tail: 0, tailW: 0, fpn: 0, read: 0.15, excess: 1.0, fullWell: 65535 / 4 },
};
export const detector = (k) => DETECTORS[k] ?? DETECTORS.ccd;

export function applyPSF(a, det) {
  const nb = a.length, R = Math.max(3, Math.ceil(3 * det.psf)), Rt = det.tail ? Math.ceil(6 * det.tailW) : 0, K = Math.max(R, Rt), w = new Float64Array(2 * K + 1);
  let sw = 0;
  for (let i = -K; i <= K; i++) {
    const g = Math.abs(i) <= R ? Math.exp(-0.5 * (i / det.psf) ** 2) / (det.psf * 2.5066) : 0;
    const l = det.tail ? 1 / (Math.PI * det.tailW * (1 + (i / det.tailW) ** 2)) : 0;
    w[i + K] = (1 - det.tail) * g + det.tail * l; sw += w[i + K];
  }
  const out = new Float32Array(nb);
  for (let b = 0; b < nb; b++) { let v = 0; for (let i = -K; i <= K; i++) v += a[Math.min(nb - 1, Math.max(0, b + i))] * w[i + K]; out[b] = v / sw; }
  return out;
}
// fixed-pattern gain of a scintillator camera: deterministic per channel (the same camera every time)
export function gainPattern(nb, det) {
  const g = new Float32Array(nb).fill(1);
  if (!det.fpn) return g;
  let s = 0x9e3779b9;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) - 0.5; };
  for (let b = 0; b < nb; b++) g[b] = 1 + det.fpn * 2 * (rnd() + rnd() + rnd()) / 1.5;
  return g;
}

// ---------------------------------------------------------------- cross-sections: β and beam energy
export function relativistic(kV) {
  const gamma = 1 + (kV * 1e3) / M0C2, beta2 = 1 - 1 / (gamma * gamma);
  return { gamma, beta2, T: 0.5 * M0C2 * beta2 }; // T = m₀v²/2 (eV), the "T" of the Bethe formula
}
export const thetaE = (E, kV) => { const r = relativistic(kV); return Math.max(E, 0.5) / (2 * r.gamma * r.T); }; // rad
export const angularFactor = (E, kV, betaMrad) => Math.log(1 + ((betaMrad * 1e-3) / thetaE(E, kV)) ** 2);
// relative to the reference conditions; 1/v² of the Bethe prefactor included
export function crossFactor(E, kV, betaMrad) {
  const r = relativistic(kV), r0 = relativistic(REF.kV);
  return (angularFactor(E, kV, betaMrad) / angularFactor(E, REF.kV, REF.beta)) * (r0.beta2 / r.beta2);
}
// t/λ scales with β through the inelastic mean free path, λ ∝ 1 / ln(2βE₀/E_m), E_m = 7.6 Z^0.36 eV
export function tauBetaFactor(kV, zeff, betaMrad) {
  const Em = 7.6 * Math.pow(zeff || 10, 0.36), f = (b) => Math.log(Math.max(1.0001, (2 * b * kV) / Em));
  return f(betaMrad) / f(REF.beta);
}

// ---------------------------------------------------------------- model
// model = { tau, plasmons: [{Ep, G, frac}], edges: [{ edge, w, peaks? }]  (w = τ × atomic fraction),
//           extraLoss?(E, res), kV, beta, zlp: zlpParams(...), realistic, bg: { amp, s } }
// Drude-type loss function E·Γ·Ep² / ((E² − Ep²)² + (EΓ)²), normalized to unit area numerically (the analytic
// π·Ep/2 holds only for narrow plasmons; broad ones, Γ ~ Ep/2, would lose ~10 % of t/λ)
const plasmonRaw = (E, p) => (E <= 0 ? 0 : (E * p.G * p.Ep * p.Ep) / ((E * E - p.Ep * p.Ep) ** 2 + (E * p.G) ** 2));
const plasmonNorm = new Map();
function plasmonArea(p) {
  const k = `${p.Ep}|${p.G}`;
  if (!plasmonNorm.has(k)) { let s = 0; for (let E = 0.005; E < 5000; E += E < 200 ? 0.01 : 0.5) s += plasmonRaw(E, p) * (E < 200 ? 0.01 : 0.5); plasmonNorm.set(k, s); }
  return plasmonNorm.get(k);
}
const plasmonDensity = (E, p) => plasmonRaw(E, p) / plasmonArea(p); // ∫ = 1
const bgDensity = (E, m) => (E > 20 ? m.bg.amp * Math.pow(E / 30, -m.bg.s) * Math.min(1, (E - 20) / 12) * crossFactor(E, m.kV, m.beta) : 0);
export const EDGE_SCALE = 0.00035;
export function edgeDensity(e, E, m, res = 0) { return EDGE_SCALE * e.w * P.edgeSignal(e.edge, E, res, m.realistic, e.peaks ?? e.edge.elnes) * crossFactor(E, m.kV, m.beta); }

// the share of τ carried by the valence/core tail (so ∫s = τ: the plasmons get the rest)
function tailShare(m) { let s = 0; for (let E = 20.25; E < 3000; E += 0.5) s += bgDensity(E, m) * 0.5; return Math.min(0.6, s); }

// Extra inelastic layers (the in situ hook): windows, a liquid or a gas, each with its own t/λ, plasmons and
// edges. comps: [{ label, tau, plasmons: [{Ep, G, frac}], edges: [{ key | edge, frac }] }]. Returns a new model.
export function addInelasticComponents(model, comps = []) {
  if (!comps.length) return model;
  const tau = model.tau + comps.reduce((a, c) => a + (c.tau || 0), 0);
  const pl = [...model.plasmons.map((p) => ({ ...p, frac: (p.frac * model.tau) / (tau || 1) }))];
  const edges = [...model.edges];
  for (const c of comps) {
    for (const p of c.plasmons ?? []) pl.push({ ...p, frac: (p.frac * (c.tau || 0)) / (tau || 1) });
    for (const e of c.edges ?? []) {
      const edge = e.edge ?? P.EDGES.find((x) => x.key === e.key && (!e.name || x.name === e.name));
      if (edge) edges.push({ edge, w: (c.tau || 0) * (e.frac ?? 1), peaks: e.peaks, label: c.label });
    }
  }
  return { ...model, tau, plasmons: pl, edges, components: [...(model.components ?? []), ...comps.map((c) => c.label)] };
}

// ---------------------------------------------------------------- FFT (radix 2, in place)
export function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

// ---------------------------------------------------------------- the spectrum
// Channels: nb channels of dE eV from E0 (eV), the zero loss shifted by `shift`. Returns per-eV values per
// channel (before the detector): spec (total), bgc (all but the edges) and edgeCurves[key] (each edge's share).
export function buildSpectrum(m, { E0, nb, dE, shift = 0 }) {
  const z = m.zlp, wL = (2 * z.fwhm) / (1 + z.asym), zext = 8 * Math.max(wL, z.asym * wL) + 1.5;
  const Emax = Math.max(1, E0 + nb * dE - shift + zext), Emin = Math.min(0, E0 - shift) - zext;
  let h = Math.max(0.002, Math.min(dE / 4, z.fwhm / 8, 0.1));
  const cap = 1 << 18;
  let Npos = Math.ceil(Emax / h) + 1, Nneg = Math.ceil(-Emin / h) + 1;
  if (2 * Npos + Nneg + 64 > cap) { h = (2 * Emax - Emin) / (cap - 64); Npos = Math.ceil(Emax / h) + 1; Nneg = Math.ceil(-Emin / h) + 1; }
  const N = pow2(2 * Npos + Nneg + 64); // room for s ⊗ s without wrapping into negative energies
  // single scattering, per bin
  const tail = tailShare(m), tauPl = m.tau * (1 - tail) / Math.max(1e-9, m.plasmons.reduce((a, p) => a + p.frac, 0));
  const sr = new Float64Array(N), si = new Float64Array(N), keys = [], edgeBins = {};
  for (const e of m.edges) { const k = e.label ? `${e.edge.key}·${e.label}` : e.edge.key; if (!edgeBins[k]) { edgeBins[k] = new Float64Array(N); keys.push(k); } e._k = k; }
  for (let k = 1; k < Npos; k++) {
    const E = k * h;
    let v = 0;
    for (const p of m.plasmons) v += tauPl * p.frac * plasmonDensity(E, p);
    v += m.tau * bgDensity(E, m);
    if (m.extraLoss) v += m.tau * m.extraLoss(E, 0.05);
    sr[k] = v * h;
    for (const e of m.edges) { const d = edgeDensity(e, E, m); if (d) edgeBins[e._k][k] += d * h; }
  }
  // zero-loss kernel, wrapped, normalized to unit area
  const zr = new Float64Array(N), zi = new Float64Array(N);
  let zs = 0;
  for (let k = -Nneg; k < Npos; k++) { const E = k * h; if (Math.abs(E) > zext) continue; const v = zlpShape(E, z); zr[(k + N) % N] = v; zs += v; }
  for (let k = 0; k < N; k++) zr[k] /= zs;
  fft(sr, si); fft(zr, zi);
  // H = Z · e^(−τ) · exp(S_bg)
  const P0 = Math.exp(-m.tau), Hr = new Float64Array(N), Hi = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const ea = Math.exp(sr[k]) * P0, er = ea * Math.cos(si[k]), ei = ea * Math.sin(si[k]);
    Hr[k] = zr[k] * er - zi[k] * ei; Hi[k] = zr[k] * ei + zi[k] * er;
  }
  const toChannels = (re) => { // per-bin probabilities → per-eV channel values (exact bin integration)
    const out = new Float32Array(nb), cum = (E) => {
      const x = E / h + 0.5, k0 = Math.floor(x); // bins k cover [(k − ½)h, (k + ½)h]
      return cumAt(k0) + (x - k0) * val(k0);
    };
    const val = (k) => (k < -Nneg || k >= Npos ? 0 : re[(k + N) % N]);
    const base = -Nneg, C = new Float64Array(Npos + Nneg + 1);
    for (let k = base; k < Npos; k++) C[k - base + 1] = C[k - base] + val(k);
    const cumAt = (k) => C[Math.max(0, Math.min(C.length - 1, k - base))];
    for (let b = 0; b < nb; b++) { const Ea = E0 + b * dE - shift; out[b] = (cum(Ea + dE) - cum(Ea)) / dE; }
    return out;
  };
  const r1 = Float64Array.from(Hr), i1 = Float64Array.from(Hi);
  fft(r1, i1, true);
  const bgc = toChannels(r1), spec = Float32Array.from(bgc), edgeCurves = {};
  for (const key of keys) { // each edge to first order in its (small) t/λ: Z e^(−τ) exp(S_bg) S_edge
    const er = edgeBins[key], ei = new Float64Array(N);
    fft(er, ei);
    for (let k = 0; k < N; k++) { const a = Hr[k] * er[k] - Hi[k] * ei[k], b = Hr[k] * ei[k] + Hi[k] * er[k]; er[k] = a; ei[k] = b; }
    fft(er, ei, true);
    const cv = toChannels(er), base = key.split('·')[0];
    edgeCurves[base] = edgeCurves[base] ? edgeCurves[base].map((v, i) => v + cv[i]) : cv;
    for (let b = 0; b < nb; b++) spec[b] += cv[b];
  }
  return { spec, bgc, edgeCurves, E0, E1: E0 + nb * dE, dE, nb, grid: { h, N } };
}

// ---------------------------------------------------------------- analysis: background fit, S/B, S/N
// Power law A·E^(−r) fitted to the pre-edge window by weighted least squares on ln I vs ln E (weights ∝ I,
// the Poisson variance of ln I). E, I: channel centres and counts per channel.
export function fitPowerLaw(E, I, a, b) {
  let S = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, n = 0;
  for (let i = 0; i < E.length; i++) {
    if (E[i] < a || E[i] > b || !(I[i] > 0) || !(E[i] > 0)) continue;
    const w = I[i], x = Math.log(E[i]), y = Math.log(I[i]);
    S += w; Sx += w * x; Sy += w * y; Sxx += w * x * x; Sxy += w * x * y; n++;
  }
  if (n < 3) return null;
  const D = S * Sxx - Sx * Sx;
  if (!(Math.abs(D) > 0)) return null;
  const slope = (S * Sxy - Sx * Sy) / D, lnA = (Sy - slope * Sx) / S;
  // covariance of (lnA, slope) for weights = 1/variance
  const cov = [[Sxx / D, -Sx / D], [-Sx / D, S / D]];
  return { A: Math.exp(lnA), r: -slope, lnA, n, cov, predict: (e) => Math.exp(lnA + slope * Math.log(e)), varLn: (e) => { const x = Math.log(e); return cov[0][0] + 2 * x * cov[0][1] + x * x * cov[1][1]; } };
}
// net edge signal in the integration window, with the background extrapolated from the pre-edge fit.
// S/N after Egerton: S / √(S + h·B), h = 1 + var(B)/B from the fit's uncertainty.
export function edgeStats(E, I, pre, win) {
  const fit = fitPowerLaw(E, I, pre[0], pre[1]);
  if (!fit) return null;
  let S = 0, B = 0, n = 0;
  const net = new Float32Array(E.length), bg = new Float32Array(E.length);
  for (let i = 0; i < E.length; i++) {
    bg[i] = E[i] > 0 && E[i] >= pre[0] ? fit.predict(E[i]) : 0;
    if (E[i] < win[0] || E[i] > win[1]) continue;
    net[i] = I[i] - bg[i]; S += net[i]; B += bg[i]; n++;
  }
  const varB = B * B * fit.varLn((win[0] + win[1]) / 2), h = 1 + varB / Math.max(B, 1e-12);
  return { r: fit.r, A: fit.A, S, B, SB: B > 0 ? S / B : Infinity, SN: S / Math.sqrt(Math.max(1e-12, S + h * B)), h, n, net, bg, fit };
}

// ---------------------------------------------------------------- Fourier-ratio deconvolution (Dual EELS)
// The single-scattering core-loss distribution from a core-loss spectrum and the low-loss spectrum recorded
// with it (same dispersion): k = F⁻¹[ G · F(core) / F(low / ΣI_low) ], with G a Gaussian of the zero-loss
// width that limits noise (the "reconvolved" result).
export function fourierRatio(core, low, { dE, E0low, fwhm }) {
  const nb = core.length, N = pow2(2 * Math.max(nb, low.length));
  const i0 = Math.round(-E0low / dE);
  const lr = new Float64Array(N), li = new Float64Array(N), cr = new Float64Array(N), ci = new Float64Array(N);
  let tot = 0; for (let i = 0; i < low.length; i++) tot += low[i];
  for (let i = 0; i < low.length; i++) lr[(i - i0 + N) % N] = low[i] / (tot || 1);
  // taper the core spectrum to zero at its far end so the circular transform has no step
  const ramp = Math.max(4, Math.round(nb * 0.05));
  for (let i = 0; i < nb; i++) cr[i] = core[i] * (i >= nb - ramp ? 0.5 * (1 + Math.cos((Math.PI * (i - nb + ramp)) / ramp)) : 1);
  fft(lr, li); fft(cr, ci);
  const sig = fwhm / 2.355 / dE; // channels
  for (let k = 0; k < N; k++) {
    const f = (k <= N / 2 ? k : k - N) / N, g = Math.exp(-2 * Math.PI * Math.PI * sig * sig * f * f);
    const d = lr[k] * lr[k] + li[k] * li[k] + 1e-12;
    const a = (cr[k] * lr[k] + ci[k] * li[k]) / d, b = (ci[k] * lr[k] - cr[k] * li[k]) / d;
    cr[k] = a * g; ci[k] = b * g;
  }
  fft(cr, ci, true);
  return Float32Array.from(cr.subarray(0, nb));
}

// ---------------------------------------------------------------- export: EMSA/MAS spectral data (.msa)
// Read by HyperSpy (as an EELSSpectrum when SIGNALTYPE is ELS) and by DigitalMicrograph.
export function toMSA(y, { title = 'TEM-view EELS', offset, dispersion, kV, alpha_mrad, beta_mrad, exposure_s, yunits = 'counts', owner = 'TEM-view (simulated)', comment = '' } = {}) {
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  const h = [
    ['FORMAT', 'EMSA/MAS Spectral Data File'], ['VERSION', '1.0'], ['TITLE', title.slice(0, 64)],
    ['DATE', `${pad(d.getDate())}-${mon}-${d.getFullYear()}`], ['TIME', `${pad(d.getHours())}:${pad(d.getMinutes())}`], ['OWNER', owner],
    ['NPOINTS', String(y.length)], ['NCOLUMNS', '1'], ['XUNITS', 'eV'], ['YUNITS', yunits], ['DATATYPE', 'Y'],
    ['XPERCHAN', String(dispersion)], ['OFFSET', String(offset)], ['SIGNALTYPE', 'ELS'],
    ['BEAMKV   -kV', String(kV)], ['CONVANGLE-mR', String(alpha_mrad)], ['COLLANGLE-mR', String(beta_mrad)],
    ...(exposure_s != null ? [['INTEGTIME-ms', String(+(exposure_s * 1e3).toPrecision(6))]] : []),
    ...(comment ? [['COMMENT', comment.slice(0, 64)]] : []),
  ];
  const lines = h.map(([k, v]) => `#${k.padEnd(12)}: ${v}`);
  lines.push('#SPECTRUM    : Spectral Data Starts Here');
  for (let i = 0; i < y.length; i += 5) lines.push(Array.from(y.subarray ? y.subarray(i, i + 5) : y.slice(i, i + 5), (v) => (+v).toPrecision(7)).join(', ') + (i + 5 < y.length ? ',' : ''));
  lines.push('#ENDOFDATA   : ');
  return lines.join('\r\n') + '\r\n';
}
export function parseMSA(text) {
  const head = {}, y = [];
  let data = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#')) {
      const m = /^#([^:]+):\s*(.*)$/.exec(l);
      if (!m) continue;
      const k = m[1].trim().split(/\s+/)[0].split('-')[0].toUpperCase(); // #COLLANGLE-mR, #BEAMKV -kV: units after '-'
      if (k === 'SPECTRUM') { data = true; continue; }
      if (k === 'ENDOFDATA') break;
      head[k] = m[2].trim();
      continue;
    }
    if (data) for (const v of l.split(/[,\s]+/)) if (v) y.push(+v);
  }
  return { head, y };
}
