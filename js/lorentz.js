// Lorentz microscopy of magnetic specimens: Fresnel, Foucault and transport-of-intensity (TIE) imaging in TEM,
// and differential phase contrast (DPC) in STEM.
//
// The objective lens is switched off so its field does not saturate the specimen; a weak Lorentz lens images
// it at micrometre fields of view. The magnetic induction B inside the film deflects the electrons (Lorentz
// force) or, equivalently, shifts their phase (Aharonov-Bohm): for a film of thickness t with in-plane induction
// Bs·m, the phase gradient is ∇φ_m = (π Bs t / Φ0) (m_y, −m_x), Φ0 = h/2e. The mean inner potential V0 adds
// the electrostatic phase σ V0 t. The phase is integrated in Fourier space, which keeps the curl-free part of
// the gradient: the stray fields of magnetic charges are included in the thin-film limit.
//   Fresnel:  defocused image of exp(iφ); domain walls and vortex cores appear as bright or dark lines and dots
//   Foucault: in focus, with a small aperture displaced in the back focal plane to pass one deflection
//   TIE:      the phase from images at ±Δf, then the in-plane induction direction as colour
//   DPC:      a scanned probe, deflected by β = λ∇φ/2π, on a four-segment detector
import * as P from './physics.js';
import { paint, label, LUT, range } from './render2d.js';

const TAU = 2 * Math.PI, DEG = Math.PI / 180;
const PHI0 = 2.067833848e-15; // Wb, magnetic flux quantum h/2e
const C = { accent: '#6fd6ff', warm: '#ffb45e', text: '#e9edf2', muted: '#8a94a3', grid: 'rgba(255,255,255,0.07)', bg: '#05070b' };
const real = (S) => S.clarity === 'real';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Magnetic specimens. Bs: saturation induction μ0Ms (T); V0: mean inner potential (V); L: attenuation length
// for the amplitude (nm, inelastic + scattering outside the small Lorentz aperture).
export const MAGSPECS = {
  vortex: { name: 'Permalloy disc, 1.5 µm', short: 'Py disc · vortex', Bs: 1.0, V0: 21, L: 110, fov: 2.5, thick: 30,
    about: 'Ni₈₀Fe₂₀, a soft magnet: the magnetization curls around the disc (a vortex) to avoid stray field, with a ~10 nm core pointing up or down at the centre.' },
  landau: { name: 'Permalloy rectangle, 2.4 × 1.2 µm', short: 'Py rectangle · domains', Bs: 1.0, V0: 21, L: 110, fov: 3.2, thick: 30,
    about: 'A Landau flux-closure pattern: four domains joined by 90° walls along the diagonals and a 180° wall along the middle, so the flux circulates inside the element.' },
  fege: { name: 'FeGe lamella, B20 chiral magnet', short: 'FeGe · skyrmions', Bs: 0.48, V0: 17, L: 140, fov: 1.0, thick: 70, Tc: 278, period: 70,
    about: 'A chiral magnet: below Tc ≈ 278 K the spins twist into 70 nm helices; a field along the beam turns them into a hexagonal lattice of Bloch skyrmions, and a stronger field aligns them all.' },
};

// Lorentz deflection angle (rad) of the saturated film: β = λ |∇φ| / 2π = λ Bs(T) t / 2Φ0
export function deflection(S, T, kV) {
  const sp = MAGSPECS[S.magSpec], f = S.magSpec === 'fege' ? fegeState(T, S.lorField).f : 1;
  return (P.wavelength(kV) * 1e-10 * sp.Bs * f * S.lorThick * 1e-9) / (2 * PHI0);
}

// FeGe magnetic state from temperature and the field along the beam (a simplified thin-plate phase diagram)
export function fegeState(T, BmT) {
  const sp = MAGSPECS.fege;
  if (T >= sp.Tc) return { phase: 'paramagnetic', f: 0, m0: 0 };
  const f = Math.sqrt(1 - T / sp.Tc), Bc1 = 100 * f, Bc2 = 320 * f; // mT
  const m0 = clamp(BmT / Bc2, 0, 1);
  if (BmT >= Bc2) return { phase: 'field-polarized', f, m0: 1, Bc1, Bc2 };
  if (BmT >= Bc1) return { phase: 'skyrmion lattice', f, m0, Bc1, Bc2 };
  return { phase: 'helical', f, m0, Bc1, Bc2 };
}

function blur(a, n, s) {
  if (s < 0.3) return a;
  const r = Math.ceil(3 * s), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * s * s)));
  const kn = k.reduce((x, y) => x + y, 0), tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * a[y * n + clamp(x + i, 0, n - 1)]; tmp[y * n + x] = v / kn; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * tmp[clamp(y + i, 0, n - 1) * n + x]; out[y * n + x] = v / kn; }
  return out;
}

// The magnetization (unit vector, in-plane and along the beam) and the thickness map of a magnetic specimen.
// n × n pixels of dx Å, centred on the element. Returns also what the controls report about its state.
export function magnetization(S, T, n, dx) {
  const sp = MAGSPECS[S.magSpec], mx = new Float32Array(n * n), my = new Float32Array(n * n), mz = new Float32Array(n * n);
  const t = new Float32Array(n * n), tA = S.lorThick * 10, c = S.lorChir, p = S.lorPol, info = {};
  const X = (i) => (i - n / 2 + 0.5) * dx, BmT = S.lorField;
  // in-plane applied field: the objective field along the beam, projected by the specimen tilt
  const Bin = [BmT * Math.sin(S.tiltX * DEG), BmT * Math.sin(S.tiltY * DEG)];
  if (S.magSpec === 'vortex') {
    const R = 7500, rc = 100, Bann = 75; // Å, Å, mT: the core is pushed across the disc and expelled near Bann
    const b = Math.hypot(...Bin), shift = (b / Bann) * R;
    // the core moves perpendicular to the in-plane field, so that the domain parallel to the field grows
    const dir = b > 0 ? [-c * Bin[1] / b, c * Bin[0] / b] : [0, 0];
    info.state = shift < 0.92 * R ? 'vortex' : 'single domain (vortex expelled by the in-plane field)';
    const x0 = dir[0] * shift, y0 = dir[1] * shift;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = X(i), y = X(j), k = j * n + i;
      if (x * x + y * y > R * R) continue;
      t[k] = tA;
      if (info.state !== 'vortex') { mx[k] = Bin[0] / b; my[k] = Bin[1] / b; continue; }
      const u = x - x0, v = y - y0, r = Math.hypot(u, v), z = p * Math.exp(-((r / rc) ** 2)), s = Math.sqrt(1 - z * z);
      if (r === 0) { mz[k] = p; continue; }
      mx[k] = (-c * v / r) * s; my[k] = (c * u / r) * s; mz[k] = z;
    }
    info.core = r1(Math.hypot(x0, y0) / 10);
  } else if (S.magSpec === 'landau') {
    const a = 12000, h = 6000, w = 30 / (dx / 10); // half-sizes (Å) and wall width in pixels
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = X(i), y = X(j), k = j * n + i;
      if (Math.abs(x) > a || Math.abs(y) > h) continue;
      t[k] = tA;
      // tangent to the nearest edge (45° partition), circulating with chirality c: the Landau pattern
      const dl = a + x, dr = a - x, db = h + y, dt = h - y, m = Math.min(dl, dr, db, dt);
      const v = m === dt ? [1, 0] : m === db ? [-1, 0] : m === dr ? [0, -1] : [0, 1];
      mx[k] = c * v[0]; my[k] = c * v[1];
    }
    // walls of finite width: smooth, then renormalize inside the element
    const bx = blur(mx, n, w / 2), by = blur(my, n, w / 2);
    for (let k = 0; k < n * n; k++) if (t[k]) { const q = Math.hypot(bx[k], by[k]) || 1; mx[k] = bx[k] / q; my[k] = by[k] / q; }
    info.state = 'Landau flux closure';
  } else {
    const st = fegeState(T, BmT), q = TAU / (sp.period * 10), th0 = 17 * DEG, edge = -0.42 * n * dx;
    Object.assign(info, st, { state: st.phase });
    const qs = [0, 1, 2].map((i) => [Math.cos(th0 + (i * TAU) / 3), Math.sin(th0 + (i * TAU) / 3)]);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = X(i), y = X(j), k = j * n + i;
      if (x < edge) continue; // vacuum beside the lamella edge
      t[k] = tA;
      if (st.phase === 'paramagnetic') continue;
      let ax = 0, ay = 0, az = 0;
      if (st.phase === 'helical') {
        const ph = q * (qs[0][0] * x + qs[0][1] * y);
        ax = -qs[0][1] * Math.sin(ph); ay = qs[0][0] * Math.sin(ph); az = Math.cos(ph) + st.m0;
      } else if (st.phase === 'skyrmion lattice') {
        for (const [u, v] of qs) { const ph = q * (u * x + v * y) + Math.PI; ax += -v * Math.sin(ph); ay += u * Math.sin(ph); az += Math.cos(ph); }
        az = az / 1.5 + 1.2 * st.m0 + 0.35;
      } else az = 1;
      const nrm = Math.hypot(ax, ay, az) || 1;
      mx[k] = (st.f * ax) / nrm; my[k] = (st.f * ay) / nrm; mz[k] = (st.f * az) / nrm; // |m| = Ms(T)/Ms(0)
    }
  }
  return { mx, my, mz, t, info };
}
const r1 = (v) => Math.round(v * 10) / 10;

// k-space helpers on an n × n grid of dx Å
function kgrid(n, dx) {
  const kx = new Float32Array(n), k2 = new Float32Array(n * n);
  for (let i = 0; i < n; i++) kx[i] = P.freq(i, n, dx);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) k2[y * n + x] = kx[x] * kx[x] + kx[y] * kx[y];
  return { kx, k2 };
}
// phase from its gradient field (gx, gy in rad/Å), least squares in Fourier space
function integrate(gx, gy, n, dx) {
  const { kx, k2 } = kgrid(n, dx);
  const ar = Float32Array.from(gx), ai = new Float32Array(n * n), br = Float32Array.from(gy), bi = new Float32Array(n * n);
  P.fft2(ar, ai, n); P.fft2(br, bi, n);
  const re = new Float32Array(n * n), im = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, q = k2[i];
    if (!q) continue;
    // ∂/∂x ↔ 2πi kx: Φ = −i (kx Gx + ky Gy) / (2π k²)
    const sr = kx[x] * ar[i] + kx[y] * br[i], si = kx[x] * ai[i] + kx[y] * bi[i];
    re[i] = si / (TAU * q); im[i] = -sr / (TAU * q);
  }
  P.fft2(re, im, n, true);
  return re;
}
function gradient(f, n, dx) {
  const gx = new Float32Array(n * n), gy = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, xp = Math.min(x + 1, n - 1), xm = Math.max(x - 1, 0), yp = Math.min(y + 1, n - 1), ym = Math.max(y - 1, 0);
    gx[i] = (f[y * n + xp] - f[y * n + xm]) / ((xp - xm) * dx); gy[i] = (f[yp * n + x] - f[ym * n + x]) / ((yp - ym) * dx);
  }
  return { gx, gy };
}

export class Lorentz {
  constructor(sim) { this.sim = sim; this.stale = true; this.disp = null; }
  get S() { return this.sim.S; }
  fovA() { return this.S.lorFov * 1e4 * this.S.profile.magCal; }

  // the specimen's exit wave: amplitude and phase (magnetic + electrostatic), and the true induction
  wave(n) {
    const S = this.S, sim = this.sim, dx = this.fovA() / n, sp = MAGSPECS[S.magSpec];
    const M = magnetization(S, sim.temp(), n, dx);
    const kG = (Math.PI * sp.Bs) / PHI0 * 1e-10 * 1e-10; // rad/Å per Å of thickness, per unit m (Bs in T, t in Å)
    const gx = new Float32Array(n * n), gy = new Float32Array(n * n), cx = Math.cos(S.tiltX * DEG), cy = Math.cos(S.tiltY * DEG);
    for (let i = 0; i < n * n; i++) {
      if (!M.t[i]) continue;
      // tilt projects the out-of-plane magnetization into the plane and lengthens the path through the film
      const tt = M.t[i] / (cx * cy), mxp = M.mx[i] * cx + M.mz[i] * Math.sin(S.tiltX * DEG), myp = M.my[i] * cy + M.mz[i] * Math.sin(S.tiltY * DEG);
      gx[i] = kG * tt * myp; gy[i] = -kG * tt * mxp;
    }
    const phM = integrate(gx, gy, n, dx), sig = P.sigmaOf(S.kV);
    const ph = new Float32Array(n * n), amp = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const tt = M.t[i] / (cx * cy);
      ph[i] = phM[i] + sig * sp.V0 * tt;
      amp[i] = Math.exp(-tt / (2 * sp.L * 10));
    }
    // largest deflection anywhere (rad) and the saturation one, β = λ |∇φ| / 2π
    const betaS = deflection(S, sim.temp(), S.kV);
    return { n, dx, ph, phM, amp, M, betaS, BsT: sp.Bs * (S.magSpec === 'fege' ? (M.info.f ?? 0) : 1) * S.lorThick };
  }

  // propagate ψ by Δf (Å) with the spatial-coherence envelope of the illumination divergence θc (rad)
  image(w, dfA, aperture = null) {
    const { n, dx, ph, amp } = w, lam = this.sim.lam, th = this.S.lorDiv * 1e-6;
    const re = new Float32Array(n * n), im = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) { re[i] = amp[i] * Math.cos(ph[i]); im[i] = amp[i] * Math.sin(ph[i]); }
    P.fft2(re, im, n);
    const { kx, k2 } = kgrid(n, dx);
    let bfp = null;
    if (aperture === 'keep') bfp = { re: Float32Array.from(re), im: Float32Array.from(im) };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, q2 = k2[i];
      let a = Math.exp(-((Math.PI * th * dfA) ** 2) * q2);
      if (aperture && aperture !== 'keep') {
        const ux = kx[x] - aperture.kx, uy = kx[y] - aperture.ky;
        if (ux * ux + uy * uy > aperture.kr * aperture.kr) a = 0;
      }
      const c = -Math.PI * lam * dfA * q2, cr = Math.cos(c) * a, ci = Math.sin(c) * a, r = re[i], m = im[i];
      re[i] = r * cr - m * ci; im[i] = r * ci + m * cr;
    }
    P.fft2(re, im, n, true);
    const I = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) I[i] = re[i] * re[i] + im[i] * im[i];
    return { I, bfp };
  }

  // shot noise at the dose set (electrons per Å² → per pixel)
  noisy(I, dx) {
    if (!real(this.S)) return I;
    const N = this.S.dose * dx * dx, out = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) out[i] = P.poisson(I[i] * N) / N;
    return out;
  }

  // transport of intensity: ∇²φ = −(2π/λ) ∂I/∂z / I0 from images at ±Δf, solved with a small Tikhonov term
  tie(w, dfA) {
    const { n, dx } = w, lam = this.sim.lam;
    const Ip = this.noisy(this.image(w, dfA).I, dx), Im = this.noisy(this.image(w, -dfA).I, dx), I0 = this.noisy(this.image(w, 0).I, dx);
    let mean = 0; for (let i = 0; i < n * n; i++) mean += I0[i]; mean /= n * n;
    const re = new Float32Array(n * n), im = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) re[i] = (-(TAU / lam) * (Ip[i] - Im[i])) / (2 * dfA) / mean;
    P.fft2(re, im, n);
    const { k2 } = kgrid(n, dx), eps = (0.02 / (n * dx)) ** 2 * 4 * Math.PI * Math.PI;
    for (let i = 0; i < n * n; i++) { const d = -(4 * Math.PI * Math.PI * k2[i] + eps); re[i] /= d; im[i] /= d; }
    re[0] = im[0] = 0;
    P.fft2(re, im, n, true);
    const g = gradient(re, n, dx);
    // induction direction: (mx, my) ∝ (−∂φ/∂y, ∂φ/∂x)
    const bx = new Float32Array(n * n), by = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) { bx[i] = -g.gy[i]; by[i] = g.gx[i]; }
    return { ph: re, bx, by };
  }

  // DPC on a four-segment detector: the bright-field disc (semi-angle α) shifted by the deflection β, averaged
  // over the probe. Each half-difference of a disc shifted by u radii is D(u) = (2/π)(u√(1−u²) + asin u).
  dpc(w) {
    const S = this.S, { n, dx } = w, lam = this.sim.lam, a = S.lorAlpha * 1e-6;
    // the probe: diffraction-limited spot of the Lorentz-mode aperture (FWHM ≈ 0.51 λ/α)
    const fwhm = (0.51 * lam) / a, sPx = fwhm / 2.355 / dx;
    const g = gradient(w.ph, n, dx);
    let bx = blur(g.gx, n, sPx), by = blur(g.gy, n, sPx);
    const D = (u) => (Math.abs(u) >= 1 ? Math.sign(u) : (2 / Math.PI) * (u * Math.sqrt(1 - u * u) + Math.asin(u)));
    const sx = new Float32Array(n * n), sy = new Float32Array(n * n), sum = new Float32Array(n * n);
    const N = S.dose * dx * dx; // electrons per probe position
    for (let i = 0; i < n * n; i++) {
      const ux = (lam * bx[i]) / TAU / a, uy = (lam * by[i]) / TAU / a, A = w.amp[i] * w.amp[i];
      sx[i] = D(ux); sy[i] = D(uy); sum[i] = A;
      if (real(S)) { const s = 1 / Math.sqrt(Math.max(1, N * A)); sx[i] += s * P.gauss(); sy[i] += s * P.gauss(); sum[i] = P.poisson(A * N) / N; }
    }
    bx = by = null;
    return { sx, sy, sum, fwhm, sat: w.betaS / a };
  }

  compute() {
    this.stale = false;
    const S = this.S, n = 512, w = this.wave(n), dfA = S.lorDf * 1e4, lam = this.sim.lam;
    const d = { n, dx: w.dx, betaS: w.betaS, BsT: w.BsT, info: w.M.info, mode: S.mode, truePh: w.phM };
    d.mx = w.M.mx; d.my = w.M.my; d.t = w.M.t;
    if (S.mode === 'lstem') {
      Object.assign(d, this.dpc(w));
      this.disp = d;
      return;
    }
    // small-angle diffraction (the back focal plane) for the secondary panel and Foucault
    const f = this.image(w, 0, 'keep');
    d.bfp = f.bfp;
    if (S.lorView === 'foucault') {
      const k0 = Math.max(w.betaS, 2e-6) / lam, dir = { '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] }[S.lorFouc] ?? [1, 0];
      d.ap = { kx: dir[0] * k0, ky: dir[1] * k0, kr: (S.lorApR * 1e-6) / lam };
      d.I = this.noisy(this.image(w, 0, d.ap).I, w.dx);
    } else if (S.lorView === 'tie') {
      const dz = Math.max(Math.abs(dfA), 5e5); // at least 50 µm: TIE needs a measurable intensity change
      Object.assign(d, this.tie(w, dz), { tieDf: dz });
    } else if (S.lorView === 'phase') {
      d.phase = w.ph;
    } else {
      d.I = this.noisy(this.image(w, dfA).I, w.dx);
    }
    this.disp = d;
  }

  // what the scripting interface exports
  arrays() {
    const d = this.disp;
    if (!d) return {};
    const out = {};
    if (d.I) out.image = d.I;
    if (d.phase) out.phase = d.phase;
    if (d.bx) { out.induction_x = d.bx; out.induction_y = d.by; out.phase = d.ph; }
    if (d.sx) { out.dpc_x = d.sx; out.dpc_y = d.sy; out.dpc_sum = d.sum; }
    return out;
  }
}

// ------------------------------------------------------------------ drawing
const offs = new Map();
function rgbCanvas(w, h) {
  const k = w + 'x' + h;
  let o = offs.get(k);
  if (!o) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); o = { c, ctx, id: ctx.createImageData(w, h) }; offs.set(k, o); }
  return o;
}
// in-plane vector field as colour: hue = direction, brightness = magnitude (the usual induction colour wheel)
function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}
function paintVector(ctx, vx, vy, n, dst, mask) {
  const mags = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) mags[i] = Math.hypot(vx[i], vy[i]);
  const [, hi] = range(mags, 0, 0.99);
  const o = rgbCanvas(n, n), px = o.id.data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, j = ((n - 1 - y) * n + x) * 4; // y up
    const v = mask && !mask[i] ? 0 : Math.min(1, mags[i] / (hi || 1));
    const [r, g, b] = hsv((Math.atan2(vy[i], vx[i]) / TAU + 1) % 1, 1, v);
    px[j] = r * 255; px[j + 1] = g * 255; px[j + 2] = b * 255; px[j + 3] = 255;
  }
  o.ctx.putImageData(o.id, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(o.c, dst[0], dst[1], dst[2], dst[3]);
}
function wheel(ctx, x, y, r, dpr) {
  const img = ctx.createImageData(Math.ceil(2 * r), Math.ceil(2 * r));
  for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
    const u = (i - r) / r, v = -(j - r) / r, m = Math.hypot(u, v), k = (j * img.width + i) * 4;
    if (m > 1) continue;
    const [a, b, c] = hsv((Math.atan2(v, u) / TAU + 1) % 1, 1, m);
    img.data[k] = a * 255; img.data[k + 1] = b * 255; img.data[k + 2] = c * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, x - r, y - r);
  label(ctx, 'B⊥ direction', x, y + r + 10 * dpr, dpr, { color: C.muted, size: 8, align: 'center' });
}
// the field of view drawn with y up, as the induction maps are
function paintUp(ctx, arr, n, dst, o) {
  const f = new Float32Array(n * n);
  for (let y = 0; y < n; y++) f.set(arr.subarray((n - 1 - y) * n, (n - y) * n), y * n);
  paint(ctx, f, n, n, dst, o);
}
function scaleBarUm(ctx, dst, fovA, dpr) {
  const um = fovA / 1e4, nice = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((v) => v >= um / 6) ?? 5, w = (nice / um) * dst[2];
  const x = dst[0] + dst[2] - w - 12 * dpr, y = dst[1] + dst[3] - 14 * dpr;
  ctx.fillStyle = C.text; ctx.fillRect(x, y, w, 3 * dpr);
  label(ctx, nice < 1 ? `${nice * 1000} nm` : `${nice} µm`, x + w / 2, y - 8 * dpr, dpr, { color: C.text, size: 9, align: 'center' });
}

const VIEWS = { fresnel: 'Fresnel image', foucault: 'Foucault image', tie: 'Induction map (TIE)', phase: 'Phase (magnetic + electrostatic)' };
const SVIEWS = { color: 'DPC induction map', x: 'DPC: right − left segments', y: 'DPC: top − bottom segments', sum: 'Sum of segments (bright field)' };

export function drawLTEM(sim, S, m, s) {
  const d = sim.lor.disp;
  if (!d || d.mode !== 'ltem') return;
  const { ctx, W, H, dpr } = m, sz = Math.min(W, H), dst = [(W - sz) / 2, (H - sz) / 2, sz, sz], n = d.n;
  if (d.I) {
    const [lo, hi] = range(d.I, 0.005, 0.995);
    paintUp(ctx, d.I, n, dst, { lo, hi, lut: LUT.gray });
  } else if (d.phase) {
    const [lo, hi] = range(d.phase, 0.005, 0.995);
    paintUp(ctx, d.phase, n, dst, { lo, hi, lut: real(S) ? LUT.gray : LUT.magma });
  } else if (d.bx) {
    paintVector(ctx, d.bx, d.by, n, dst, null);
    wheel(ctx, dst[0] + sz - 44 * dpr, dst[1] + 44 * dpr, 30 * dpr, dpr);
  }
  label(ctx, VIEWS[S.lorView] + (S.lorView === 'fresnel' ? ` · Δf ${S.lorDf > 0 ? '+' : ''}${S.lorDf} µm` : S.lorView === 'tie' ? ` · ±${(d.tieDf / 1e4).toFixed(0)} µm` : ''), dst[0] + 10 * dpr, dst[1] + 16 * dpr, dpr, { color: C.accent });
  if (S.lorView === 'fresnel' && S.lorDf === 0) label(ctx, 'in focus: a pure phase object shows no contrast. Defocus to see the walls.', dst[0] + 10 * dpr, dst[1] + 34 * dpr, dpr, { color: C.warm, size: 9 });
  if (d.info.state && d.info.state !== 'vortex' && d.info.state !== 'Landau flux closure') label(ctx, d.info.state, dst[0] + 10 * dpr, dst[1] + dst[3] - 34 * dpr, dpr, { color: C.warm, size: 9 });
  scaleBarUm(ctx, dst, sim.lor.fovA(), dpr);
  drawBFP(sim, S, s, d);
}

// secondary panel: small-angle diffraction (back focal plane) with the Foucault aperture, and the numbers
function drawBFP(sim, S, s, d) {
  const q = s.ctx, n = d.n, lam = sim.lam, tall = s.H > s.W * 0.85;
  const sz = tall ? Math.min(s.W, s.H * 0.5) : Math.min(s.H, s.W * 0.42);
  if (d.bfp) {
    // show ±3 saturation deflections around the centre
    const kMax = (3 * Math.max(d.betaS, 5e-6)) / lam, dk = 1 / (n * d.dx), half = Math.min(n / 2 - 1, Math.ceil(kMax / dk)), c = 2 * half;
    const a = new Float32Array(c * c);
    for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
      const iy = (y - half + n) % n, ix = (x - half + n) % n, i = iy * n + ix;
      a[(c - 1 - y) * c + x] = Math.log1p((d.bfp.re[i] ** 2 + d.bfp.im[i] ** 2) * 1e-4);
    }
    const [lo, hi] = range(a, 0.3, 0.995); // let the film-edge streak saturate so the magnetic spots show
    paint(q, a, c, c, [0, 0, sz, sz], { lo, hi, lut: real(S) ? LUT.gray : LUT.ice, gamma: 1.2 });
    const urad = (half * dk * lam) / 1e-6;
    if (d.ap) {
      const px = sz / c, cx = sz / 2 + (d.ap.kx / dk) * px, cy = sz / 2 - (d.ap.ky / dk) * px;
      q.strokeStyle = C.warm; q.lineWidth = 1.4 * s.dpr; q.beginPath(); q.arc(cx, cy, (d.ap.kr / dk) * px, 0, 7); q.stroke();
    }
    label(q, `back focal plane · ±${urad.toFixed(0)} µrad`, 8 * s.dpr, 12 * s.dpr, s.dpr, { color: C.accent, size: 9 });
  }
  const x0 = tall ? 8 * s.dpr : sz + 16 * s.dpr, y0 = tall ? sz + 24 * s.dpr : 20 * s.dpr;
  const sp = MAGSPECS[S.magSpec], rows = [
    ['Specimen', sp.short],
    ['State', d.info.state ?? '—'],
    ['Bs·t', `${(d.BsT).toFixed(1)} T·nm`],
    ['Lorentz deflection β', `${(d.betaS * 1e6).toFixed(1)} µrad`, C.accent],
    ['Illumination divergence', `${S.lorDiv} µrad`],
    ['Objective-lens field', `${S.lorField} mT`],
    ['Specimen temperature', `${sim.temp().toFixed(0)} K`],
  ];
  if (S.magSpec === 'vortex' && d.info.core != null && d.info.state === 'vortex') rows.push(['Core off centre', `${d.info.core} nm`]);
  if (S.magSpec === 'fege' && d.info.Bc2) rows.push(['Skyrmion window', `${d.info.Bc1.toFixed(0)}–${d.info.Bc2.toFixed(0)} mT`]);
  statRows(q, x0, y0, s.dpr, rows);
}
function statRows(q, x, y, dpr, rows) {
  rows.forEach(([k, v, col], i) => {
    label(q, k, x, y + i * 15 * dpr, dpr, { color: C.muted, size: 10 });
    label(q, v, x + 140 * dpr, y + i * 15 * dpr, dpr, { color: col ?? C.text, size: 10 });
  });
}

export function drawLSTEM(sim, S, m, s, hover) {
  const d = sim.lor.disp;
  if (!d || d.mode !== 'lstem') return;
  const { ctx, W, H, dpr } = m, sz = Math.min(W, H), dst = [(W - sz) / 2, (H - sz) / 2, sz, sz], n = d.n, v = S.lstemView;
  if (v === 'color') {
    paintVector(ctx, d.sx, d.sy, n, dst, null);
    wheel(ctx, dst[0] + sz - 44 * dpr, dst[1] + 44 * dpr, 30 * dpr, dpr);
  } else {
    const a = v === 'x' ? d.sx : v === 'y' ? d.sy : d.sum, [lo, hi] = v === 'sum' ? range(a, 0.005, 0.995) : [-1, 1];
    paintUp(ctx, a, n, dst, { lo, hi, lut: LUT.gray });
  }
  label(ctx, SVIEWS[v], dst[0] + 10 * dpr, dst[1] + 16 * dpr, dpr, { color: C.accent });
  if (d.sat > 0.8) label(ctx, `deflection ${Math.round(d.sat * 100)} % of the disc radius: the segments saturate. Use a larger convergence angle.`, dst[0] + 10 * dpr, dst[1] + 34 * dpr, dpr, { color: C.warm, size: 9 });
  else if (d.sat < 0.02) label(ctx, 'deflection < 2 % of the disc: the DPC signal is tiny. Use a smaller convergence angle.', dst[0] + 10 * dpr, dst[1] + 34 * dpr, dpr, { color: C.warm, size: 9 });
  scaleBarUm(ctx, dst, sim.lor.fovA(), dpr);
  // secondary: the four-segment detector with the bright-field disc shifted by the strongest deflection
  const q = s.ctx, R = Math.min(s.H, s.W * 0.42) * 0.36, cx = R * 1.35, cy = s.H / 2;
  q.strokeStyle = C.grid; q.lineWidth = 1 * s.dpr;
  q.beginPath(); q.arc(cx, cy, R * 1.25, 0, 7); q.moveTo(cx - R * 1.25, cy); q.lineTo(cx + R * 1.25, cy); q.moveTo(cx, cy - R * 1.25); q.lineTo(cx, cy + R * 1.25); q.stroke();
  const u = Math.min(1.2, d.sat);
  q.fillStyle = 'rgba(111,214,255,0.35)'; q.beginPath(); q.arc(cx + u * R, cy, R, 0, 7); q.fill();
  q.strokeStyle = C.accent; q.stroke();
  label(q, 'segmented detector · disc at the strongest deflection', 8 * s.dpr, 12 * s.dpr, s.dpr, { color: C.accent, size: 9 });
  const x0 = cx + R * 1.6;
  statRows(q, x0, 30 * s.dpr, s.dpr, [
    ['Specimen', MAGSPECS[S.magSpec].short],
    ['State', d.info.state ?? '—'],
    ['Convergence α', `${S.lorAlpha} µrad`],
    ['Probe size (FWHM)', d.fwhm > 1e4 ? `${(d.fwhm / 1e4).toFixed(2)} µm` : `${(d.fwhm / 10).toFixed(1)} nm`],
    ['Pixel', `${(d.dx / 10).toFixed(1)} nm`],
    ['Max deflection β', `${(d.betaS * 1e6).toFixed(1)} µrad`, C.accent],
    ['β / α', `${(d.sat * 100).toFixed(0)} %`, d.sat > 0.8 ? C.warm : null],
  ]);
}
