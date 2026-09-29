// Simulation engine: turns the instrument state into detector signals.
import * as P from './physics.js';
import { Ronch, CBED } from './techniques.js';

const SP = P.SPECIMENS;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const AP_MRAD = { none: Infinity, 40: 12, 20: 6, 10: 3, df: 2.5 };
export const FOCAL_SPREAD = 32; // Å, Schottky FEG with Cc ≈ 1.2 mm
export const CONV_TEM = 0.08e-3; // illumination semi-angle in TEM, rad

export function stemDetType(inner, outer, alpha) {
  if (outer <= alpha * 1.05 && inner < 0.35 * alpha) return 'BF';
  if (outer <= alpha * 1.1) return 'ABF';
  if (inner >= 2.8 * alpha) return 'HAADF';
  return 'ADF';
}

// Separable Gaussian blur in place.
function blur(a, n, s) {
  if (s < 0.3) return a;
  const R = Math.ceil(3 * s), k = [];
  let sum = 0;
  for (let i = -R; i <= R; i++) { const v = Math.exp((-0.5 * i * i) / (s * s)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (let i = -R; i <= R; i++) v += a[y * n + clamp(x + i, 0, n - 1)] * k[i + R];
      t[y * n + x] = v;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (let i = -R; i <= R; i++) v += t[clamp(y + i, 0, n - 1) * n + x] * k[i + R];
      a[y * n + x] = v;
    }
  return a;
}

function cropArr(a, n, c) {
  const o = (n - c) / 2, out = new Float32Array(c * c);
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) out[y * c + x] = a[(y + o) * n + x + o];
  return out;
}

export class Sim {
  constructor(S) {
    this.S = S;
    this.mapCache = new Map();
    this.stale = { tem: 1, stem: 1, diff: 1, fd: 1, vimg: 1, si: 1, eels: 1, probe: 1 };
    this.version = 0;
    this.raster = 0;
    this.frameNoise = 0;
    this.ronch = new Ronch(this);
    this.cbed = new CBED(this);
  }

  get spec() { return SP[this.S.spec]; }
  get lam() { return P.wavelength(this.S.kV); }
  CsA() { return this.S.corrector ? this.S.csCor * 1e4 : this.S.csUnc * 1e7; } // Å
  alpha() {
    const S = this.S;
    return ({ '4d': S.alpha4d, ronch: S.ronchAp, cbed: S.cbedKind === 'lacbed' ? S.alphaLA : S.alphaCB }[S.mode] ?? S.alpha) * 1e-3;
  }
  // residual axial aberrations from the corrector, in Å (A1, B2, A2 in nm; A3 in µm)
  abA() {
    const a = this.S.ab;
    return { A1: a.A1 * 10, A1a: a.A1a, B2: a.B2 * 10, B2a: a.B2a, A2: a.A2 * 10, A2a: a.A2a, A3: a.A3 * 1e4, A3a: a.A3a };
  }

  invalidate(key) {
    const all = ['tem', 'stem', 'diff', 'fd', 'vimg', 'si', 'eels', 'probe'];
    const map = {
      objAp: ['tem'], alpha: ['stem', 'fd', 'vimg', 'si', 'eels', 'probe'], det: ['stem'],
      sa: ['diff'], camL: ['diff'], beamStop: [], camera: [], vdet: ['vimg'], eelsWin: ['eels'], eelsRange: ['eels'], bgsub: ['eels'],
      dose: ['si'], edsSel: [], mode: [],
      // progressive beam damage: refresh images and patterns in place, but don't restart 4D scans or spectrum accumulation
      damage: ['tem', 'stem', 'diff', 'probe'],
    };
    for (const k of map[key] ?? all) this.stale[k] = 1;
    if (!['mode', 'edsSel', 'camera', 'beamStop', 'vdet', 'bgsub', 'eelsWin', 'eelsRange'].includes(key)) { this.ronch.stale = true; this.cbed.stale = true; }
    if (!['vdet', 'edsSel', 'mode', 'camera'].includes(key)) this.resetSingle();
    this.version++;
  }

  maps(opts) {
    const S = this.S;
    const key = [S.spec, this.spec.damageVer ?? 0, S.cx.toFixed(2), S.cy.toFixed(2), S.thick, S.tiltX, S.tiltY, opts.n, opts.dx.toFixed(4), !!opts.elements, !!opts.noTilt, opts.part ?? ''].join('|');
    let m = this.mapCache.get(key);
    if (!m) {
      m = P.projectMaps(this.spec, {
        cx: S.cx, cy: S.cy, n: opts.n, dx: opts.dx, thick: S.thick * 10,
        tiltX: (S.tiltX * Math.PI) / 180, tiltY: (S.tiltY * Math.PI) / 180, elements: opts.elements, noTilt: opts.noTilt, part: opts.part,
      });
      this.mapCache.set(key, m);
      if (this.mapCache.size > 8) this.mapCache.delete(this.mapCache.keys().next().value);
    }
    return m;
  }

  // ------------------------------------------------------------ coherent imaging core
  // Apply the objective-lens transfer function to an exit wave and return |ψ|².
  lensImage(maps, { apK, apCenter = [0, 0], envelopes = true }) {
    const n = maps.n, dx = maps.dx, lam = this.lam, df = this.S.df * 10, Cs = this.CsA(), ab = this.abA();
    const { re, im } = P.transmission(maps.phase, this.S.kV);
    P.fft2(re, im, n);
    const D = FOCAL_SPREAD, ac = CONV_TEM;
    for (let y = 0; y < n; y++) {
      const ky = P.freq(y, n, dx);
      for (let x = 0; x < n; x++) {
        const kx = P.freq(x, n, dx), i = y * n + x;
        const k2 = kx * kx + ky * ky;
        const ax = kx - apCenter[0], ay = ky - apCenter[1];
        if (ax * ax + ay * ay > apK * apK) { re[i] = 0; im[i] = 0; continue; }
        let H = 1;
        if (envelopes) {
          const k = Math.sqrt(k2);
          const Et = Math.exp(-0.5 * Math.PI * Math.PI * lam * lam * D * D * k2 * k2);
          const g = df * lam * k + Cs * lam * lam * lam * k * k2;
          const Es = Math.exp(-Math.pow((Math.PI * ac) / lam, 2) * g * g);
          H = Et * Es;
        }
        const c = P.chiFull(kx, ky, lam, df, Cs, ab), cc = Math.cos(c), ss = Math.sin(c);
        const a = re[i], b = im[i];
        re[i] = H * (a * cc + b * ss);
        im[i] = H * (b * cc - a * ss);
      }
    }
    P.fft2(re, im, n, true);
    const I = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) I[i] = re[i] * re[i] + im[i] * im[i];
    return I;
  }

  computeTEM() {
    const S = this.S, n = 256, c = 224, dx = (S.fov * 10) / c;
    const maps = this.maps({ n, dx });
    const lam = this.lam;
    let apK = AP_MRAD[S.objAp] * 1e-3 / lam, apCenter = [0, 0];
    if (S.objAp === 'df') {
      const g = this.spec.grains[0], [m, k] = this.spec.id === 'sto' || this.spec.twoD ? [1, 0] : [1, 1];
      apCenter = [m * g.b[0][0] + k * g.b[1][0], m * g.b[0][1] + k * g.b[1][1]];
      apK = Math.min(0.13, 0.45 * Math.hypot(apCenter[0], apCenter[1]));
    }
    const I = this.lensImage(maps, { apK, apCenter });
    // Diffractogram: |FFT| of the (windowed) image shows the lens's transfer rings.
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    let mean = 0;
    for (let i = 0; i < n * n; i++) mean += I[i];
    mean /= n * n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / n)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * y) / n));
        re[y * n + x] = (I[y * n + x] - mean) * w;
      }
    P.fft2(re, im, n);
    const F = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x, j = ((y + n / 2) % n) * n + ((x + n / 2) % n);
        F[j] = Math.log(1 + Math.sqrt(re[i] * re[i] + im[i] * im[i]));
      }
    this.tem = { img: cropArr(I, n, c), c, dx, fft: F, n, apK, apCenter, kmax: 1 / (2 * dx) };
    this.main = { arr: this.tem.img, w: c, h: c };
  }

  // Probe at fine sampling (for display and size readouts)
  computeProbe() {
    const n = 128, dx = 0.1, lam = this.lam, a = this.alpha(), kAp = a / lam;
    const df = this.S.df * 10, Cs = this.CsA(), ab = this.abA();
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const kx = P.freq(x, n, dx), ky = P.freq(y, n, dx), k2 = kx * kx + ky * ky;
        const A = clamp((kAp - Math.sqrt(k2)) / 0.03 + 0.5, 0, 1);
        if (!A) continue;
        const c = P.chiFull(kx, ky, lam, df, Cs, ab);
        re[y * n + x] = A * Math.cos(-c);
        im[y * n + x] = A * Math.sin(-c);
      }
    P.fft2(re, im, n, true);
    const I = new Float32Array(n * n);
    let mx = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x, j = ((y + n / 2) % n) * n + ((x + n / 2) % n);
        I[j] = re[i] * re[i] + im[i] * im[i];
        if (I[j] > mx) mx = I[j];
      }
    // FWHM from the peak outward (average of four directions)
    let pk = 0, px = n / 2, py = n / 2;
    for (let i = 0; i < n * n; i++) if (I[i] > pk) { pk = I[i]; px = i % n; py = (i / n) | 0; }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let tot = 0;
    for (const [ux, uy] of dirs) {
      let r = 0, prev = pk;
      for (let s = 1; s < n / 2; s++) {
        const x = px + ux * s, y = py + uy * s;
        if (x < 0 || y < 0 || x >= n || y >= n) { r = s; break; }
        const v = I[y * n + x];
        if (v < pk / 2) { r = s - 1 + (prev - pk / 2) / (prev - v); break; }
        prev = v; r = s;
      }
      tot += r;
    }
    this.probe = { I, n, dx, max: mx, fwhm: (tot / 4) * 2 * dx };
  }

  computeSTEM() {
    const S = this.S, n = 256, c = 224, dx = (S.fov * 10) / c, lam = this.lam, a = this.alpha();
    const maps = this.maps({ n, dx });
    const type = stemDetType(S.detIn, S.detOut, S.alpha);
    let img;
    if (type === 'BF') {
      // Reciprocity: a small axial detector in STEM behaves like conventional TEM.
      img = this.lensImage(maps, { apK: a / lam });
    } else {
      // Probe intensity on this grid, then convolve with the scattering-power map.
      const kAp = a / lam, df = S.df * 10, Cs = this.CsA(), ab = this.abA();
      const pr = new Float64Array(n * n), pi = new Float64Array(n * n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const kx = P.freq(x, n, dx), ky = P.freq(y, n, dx), k2 = kx * kx + ky * ky;
          const A = clamp((kAp - Math.sqrt(k2)) * n * dx + 0.5, 0, 1);
          if (!A) continue;
          const ch = P.chiFull(kx, ky, lam, df, Cs, ab);
          pr[y * n + x] = A * Math.cos(-ch);
          pi[y * n + x] = A * Math.sin(-ch);
        }
      P.fft2(pr, pi, n, true);
      const pre = new Float64Array(n * n), pim = new Float64Array(n * n);
      let ps = 0;
      for (let i = 0; i < n * n; i++) { pre[i] = pr[i] * pr[i] + pi[i] * pi[i]; ps += pre[i]; }
      if (ps === 0) { pre[0] = 1; ps = 1; }
      for (let i = 0; i < n * n; i++) pre[i] /= ps;
      P.fft2(pre, pim, n);
      let src;
      if (type === 'ABF') src = maps.phase;
      else {
        const f = clamp((S.detIn / S.alpha - 1) / 2, 0, 1);
        let mh = 0, ml = 0;
        for (let i = 0; i < n * n; i++) { if (maps.zHi[i] > mh) mh = maps.zHi[i]; if (maps.zLo[i] > ml) ml = maps.zLo[i]; }
        src = new Float32Array(n * n);
        for (let i = 0; i < n * n; i++) src[i] = (1 - f) * (maps.zLo[i] / (ml || 1)) + f * (maps.zHi[i] / (mh || 1));
      }
      const sr = Float64Array.from(src), si = new Float64Array(n * n);
      P.fft2(sr, si, n);
      for (let i = 0; i < n * n; i++) {
        const a1 = sr[i], b1 = si[i], a2 = pre[i], b2 = pim[i];
        sr[i] = a1 * a2 - b1 * b2; si[i] = a1 * b2 + b1 * a2;
      }
      P.fft2(sr, si, n, true);
      img = new Float32Array(n * n);
      let mx = 0;
      for (let i = 0; i < n * n; i++) if (sr[i] > mx) mx = sr[i];
      for (let i = 0; i < n * n; i++) img[i] = type === 'ABF' ? 1 - 0.55 * (sr[i] / (mx || 1)) : Math.max(0, sr[i]);
    }
    // finite effective source size (~0.7 Å FWHM) blurs every real STEM image a little
    blur(img, n, 0.3 / dx);
    this.stemImg = { img: cropArr(img, n, c), c, dx, type };
    this._stemPass = this.frameNoise;
    this.main = { arr: this.stemImg.img, w: c, h: c };
  }

  computeDiff() {
    const S = this.S, n = 512, dx = 0.25, spec = this.spec, lam = this.lam;
    const maps = this.maps({ n, dx, noTilt: true });
    const { re, im } = P.transmission(maps.phase, S.kV, 1.0);
    const R = (S.sa * 10) / 2, edge = 6;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) * dx;
        const f = 0.5 + 0.5 * Math.cos(Math.PI * clamp((r - R + edge) / edge, 0, 1));
        re[y * n + x] *= f; im[y * n + x] *= f;
      }
    P.fft2(re, im, n);
    const I = new Float32Array(n * n);
    const tx = (S.tiltX * Math.PI) / 180, ty = (S.tiltY * Math.PI) / 180;
    const tEff = 30 + 0.25 * S.thick * 10;
    const dk = 1 / (n * dx);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x, j = ((y + n / 2) % n) * n + ((x + n / 2) % n);
        const kx = P.freq(x, n, dx), ky = P.freq(y, n, dx);
        let v = re[i] * re[i] + im[i] * im[i];
        if (!spec.poly && !spec.twoD) {
          // Excitation error: distance of the reflection from the Ewald sphere.
          const s = 0.5 * lam * (kx * kx + ky * ky) + kx * tx + ky * ty;
          v *= Math.exp(-Math.pow(1.6 * tEff * s, 2));
        }
        I[j] = v;
      }
    // azimuthal average (skip the direct beam)
    const nb = 220, prof = new Float32Array(nb), cnt = new Float32Array(nb), kStep = 1.9 / nb;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const k = Math.hypot(x - n / 2, y - n / 2) * dk;
        const b = Math.floor(k / kStep);
        if (b < nb && k > 0.12) { prof[b] += I[y * n + x]; cnt[b]++; }
      }
    for (let b = 0; b < nb; b++) prof[b] = cnt[b] ? prof[b] / cnt[b] : 0;
    this.diff = { I, n, dk, prof, kStep, lam };
    this.resampleDiff();
  }

  // Map k-space onto the camera: radius on the detector = λ·L·k.
  resampleDiff() {
    const d = this.diff, S = this.S;
    if (!d) return;
    const W = 256, halfMM = 22; // detector half-width, mm
    const kPerPx = (2 * halfMM) / (S.camL * this.lam) / W;
    const out = new Float32Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const kx = (x - W / 2 + 0.5) * kPerPx, ky = (y - W / 2 + 0.5) * kPerPx;
        const fx = kx / d.dk + d.n / 2, fy = ky / d.dk + d.n / 2;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        if (x0 < 0 || y0 < 0 || x0 >= d.n - 1 || y0 >= d.n - 1) continue;
        const ax = fx - x0, ay = fy - y0, n = d.n;
        out[y * W + x] = (d.I[y0 * n + x0] * (1 - ax) + d.I[y0 * n + x0 + 1] * ax) * (1 - ay) + (d.I[(y0 + 1) * n + x0] * (1 - ax) + d.I[(y0 + 1) * n + x0 + 1] * ax) * ay;
      }
    this.diffDisp = { arr: out, W, kPerPx };
    this.main = { arr: out, w: W, h: W };
  }

  // ------------------------------------------------------------ 4D-STEM
  start4D() {
    const S = this.S, n4 = 64, dx = 0.18, N = 40, lam = this.lam;
    const scan = clamp(S.fov * 10 * 0.6, 14, 36), step = scan / N;
    const gridN = Math.ceil(scan / dx) + n4 + 8;
    // Multislice specimen: K slices with Fresnel propagation between them, so thick-specimen effects
    // (beam spreading, channelling) are in the recorded patterns. On Au/C the particles sit on top of the film.
    const K = 3, thickA = this.spec.fixedT ?? S.thick * 10, dz = thickA / K;
    const slices = [];
    if (this.spec.id === 'au') {
      const top = this.maps({ n: gridN, dx, part: 'cryst' }), bot = this.maps({ n: gridN, dx, part: 'amorph' });
      for (let k = 0; k < K; k++) slices.push(P.transmission((k < K / 2 ? top : bot).phase, S.kV, 2 / K));
    } else {
      const all = this.maps({ n: gridN, dx }), t = P.transmission(all.phase, S.kV, 1 / K);
      for (let k = 0; k < K; k++) slices.push(t);
    }
    const { re, im } = slices[0];
    const prop = this.fresnel(n4, dx, lam, dz);
    const kAp = (S.alpha4d * 1e-3) / lam, df = S.df * 10, Cs = this.CsA(), ab = this.abA();
    const pr = new Float64Array(n4 * n4), pi = new Float64Array(n4 * n4);
    for (let y = 0; y < n4; y++)
      for (let x = 0; x < n4; x++) {
        const kx = P.freq(x, n4, dx), ky = P.freq(y, n4, dx), k2 = kx * kx + ky * ky;
        const A = clamp((kAp - Math.sqrt(k2)) * n4 * dx + 0.5, 0, 1);
        if (!A) continue;
        const c = P.chiFull(kx, ky, lam, df, Cs, ab);
        pr[y * n4 + x] = A * Math.cos(-c); pi[y * n4 + x] = A * Math.sin(-c);
      }
    P.fft2(pr, pi, n4, true);
    const sr = new Float64Array(n4 * n4), si = new Float64Array(n4 * n4);
    let ps = 0;
    for (let y = 0; y < n4; y++)
      for (let x = 0; x < n4; x++) {
        const i = y * n4 + x, j = ((y + n4 / 2) % n4) * n4 + ((x + n4 / 2) % n4);
        sr[j] = pr[i]; si[j] = pi[i]; ps += pr[i] * pr[i] + pi[i] * pi[i];
      }
    const nrm = 1 / Math.sqrt(ps || 1);
    for (let i = 0; i < n4 * n4; i++) { sr[i] *= nrm; si[i] *= nrm; }
    this.fd = {
      N, n4, dx, scan, step, gridN, re, im, pr: sr, pi: si, lam, K, dz, slices, prop,
      data: new Float32Array(N * N * n4 * n4), done: 0, dk: 1 / (n4 * dx),
      mradPx: (lam * 1000) / (n4 * dx),
      wr: new Float64Array(n4 * n4), wi: new Float64Array(n4 * n4),
      vimg: new Float32Array(N * N), comX: new Float32Array(N * N), comY: new Float32Array(N * N), vDone: 0,
    };
    this.stale.vimg = 1;
  }

  step4D(budget) {
    const f = this.fd;
    if (!f || f.done >= f.N * f.N) return false;
    const t0 = performance.now(), { N, n4, gridN, re, im, pr, pi, wr, wi, data, dx, step, scan } = f;
    const h = n4 / 2;
    while (f.done < N * N && performance.now() - t0 < budget) {
      const idx = f.done, i = idx % N, j = (idx / N) | 0;
      const left = Math.round(gridN / 2 + (-scan / 2 + (i + 0.5) * step) / dx) - h;
      const top = Math.round(gridN / 2 + (-scan / 2 + (j + 0.5) * step) / dx) - h;
      wr.set(pr); wi.set(pi);
      for (let k = 0; k < f.K; k++) {
        const s = f.slices[k];
        for (let y = 0; y < n4; y++) {
          const go = (top + y) * gridN + left, po = y * n4;
          for (let x = 0; x < n4; x++) {
            const g = go + x, p = po + x, a = wr[p], b = wi[p];
            wr[p] = s.re[g] * a - s.im[g] * b;
            wi[p] = s.re[g] * b + s.im[g] * a;
          }
        }
        if (k < f.K - 1) this.propagate(wr, wi, n4, f.prop, false);
      }
      P.fft2(wr, wi, n4);
      const o = idx * n4 * n4;
      for (let y = 0; y < n4; y++)
        for (let x = 0; x < n4; x++) {
          const p = y * n4 + x;
          data[o + ((y + h) % n4) * n4 + ((x + h) % n4)] = wr[p] * wr[p] + wi[p] * wi[p];
        }
      f.done++;
    }
    return true;
  }

  vdetMask() {
    const f = this.fd, S = this.S, n4 = f.n4, m = new Float32Array(n4 * n4), mp = f.mradPx;
    for (let y = 0; y < n4; y++)
      for (let x = 0; x < n4; x++) {
        const tx = (x - n4 / 2) * mp, ty = (y - n4 / 2) * mp;
        let on = 0;
        if (S.vdet === 'disk') on = Math.hypot(tx - S.vdX, ty - S.vdY) <= S.vdR ? 1 : 0;
        else if (S.vdet !== 'com') { const r = Math.hypot(tx, ty); on = r >= S.vdIn && r <= S.vdOut ? 1 : 0; }
        m[y * n4 + x] = on;
      }
    return m;
  }

  computeVirtual(from = 0) {
    const f = this.fd;
    if (!f) return;
    const n4 = f.n4, P2 = n4 * n4, mask = from ? this._mask : (this._mask = this.vdetMask());
    // segmented DPC detector: four quadrants of a disk slightly larger than the bright-field cone
    if (!from || !this._quad) {
      const q = (this._quad = new Int8Array(P2)), rMax = (this.S.alpha4d * 1.1) / f.mradPx;
      for (let p = 0; p < P2; p++) {
        const x = (p % n4) - n4 / 2, y = ((p / n4) | 0) - n4 / 2;
        q[p] = Math.hypot(x, y) > rMax ? -1 : Math.abs(x) >= Math.abs(y) ? (x > 0 ? 0 : 2) : y > 0 ? 1 : 3;
      }
    }
    const quad = this._quad;
    f.dpcX ||= new Float32Array(f.N * f.N); f.dpcY ||= new Float32Array(f.N * f.N);
    for (let idx = from; idx < f.done; idx++) {
      const o = idx * P2;
      let s = 0, t = 0, sx = 0, sy = 0;
      const Q = [0, 0, 0, 0];
      for (let p = 0; p < P2; p++) {
        const v = f.data[o + p];
        s += v * mask[p]; t += v;
        sx += v * ((p % n4) - n4 / 2); sy += v * (((p / n4) | 0) - n4 / 2);
        if (quad[p] >= 0) Q[quad[p]] += v;
      }
      f.vimg[idx] = s;
      f.comX[idx] = t ? (sx / t) * f.mradPx : 0;
      f.comY[idx] = t ? (sy / t) * f.mradPx : 0;
      const qt = Q[0] + Q[1] + Q[2] + Q[3] || 1;
      f.dpcX[idx] = (Q[0] - Q[2]) / qt; f.dpcY[idx] = (Q[1] - Q[3]) / qt;
    }
    f.vDone = f.done;
  }

  // Fresnel propagator over dz (Å), band-limited to 2/3 of Nyquist to avoid aliasing
  fresnel(n, dx, lam, dz) {
    const re = new Float64Array(n * n), im = new Float64Array(n * n), kmax = (2 / 3) * (1 / (2 * dx));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const kx = P.freq(x, n, dx), ky = P.freq(y, n, dx), k2 = kx * kx + ky * ky;
      if (k2 > kmax * kmax) continue;
      const c = -Math.PI * lam * dz * k2;
      re[y * n + x] = Math.cos(c); im[y * n + x] = Math.sin(c);
    }
    return { re, im };
  }
  propagate(wr, wi, n, H, back) {
    P.fft2(wr, wi, n);
    const s = back ? -1 : 1;
    for (let i = 0; i < n * n; i++) { const a = wr[i], b = wi[i], c = H.re[i], d = s * H.im[i]; wr[i] = a * c - b * d; wi[i] = a * d + b * c; }
    P.fft2(wr, wi, n, true);
  }

  // ------------------------------------------------------------ multislice ptychography (MS-ePIE / 3PIE)
  // The object is a stack of K slices; the wave is propagated between them in the forward model, and the
  // correction is back-propagated slice by slice, updating each slice's transmission and the wave entering it.
  startMSPtycho() {
    const f = this.fd, G = f.gridN;
    const O = Array.from({ length: f.K }, () => ({ re: new Float64Array(G * G).fill(1), im: new Float64Array(G * G) }));
    const n2 = f.n4 * f.n4, mk = () => ({ re: new Float64Array(n2), im: new Float64Array(n2) });
    this.mpty = { fd: f, O, iter: 0, k: 0, order: Array.from({ length: f.N * f.N }, (_, i) => i), errSum: 0, errHist: [],
      inc: Array.from({ length: f.K }, mk), ex: Array.from({ length: f.K }, mk), w: mk(), maxIter: 10, win: new Int32Array(f.n4 * f.n4) };
  }
  stepMSPtycho(budget) {
    const T = this.mpty, f = T.fd, { N, n4, gridN, dx, step, scan, K } = f;
    if (T.iter >= T.maxIter) return false;
    const h = n4 / 2, n2 = n4 * n4, t0 = performance.now(), beta = 0.8;
    while (performance.now() - t0 < budget) {
      if (T.k === 0) {
        for (let i = T.order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [T.order[i], T.order[j]] = [T.order[j], T.order[i]]; }
        T.errSum = 0;
      }
      const idx = T.order[T.k], i = idx % N, j = (idx / N) | 0;
      const left = Math.round(gridN / 2 + (-scan / 2 + (i + 0.5) * step) / dx) - h;
      const top = Math.round(gridN / 2 + (-scan / 2 + (j + 0.5) * step) / dx) - h;
      const Wi = T.win;
      for (let y = 0, p = 0; y < n4; y++) { const r = (top + y) * gridN + left; for (let x = 0; x < n4; x++, p++) Wi[p] = r + x; }
      // forward through the slices
      T.inc[0].re.set(f.pr); T.inc[0].im.set(f.pi);
      for (let k = 0; k < K; k++) {
        const O = T.O[k], I = T.inc[k], E = T.ex[k];
        for (let p = 0; p < n2; p++) { const g = Wi[p]; E.re[p] = O.re[g] * I.re[p] - O.im[g] * I.im[p]; E.im[p] = O.re[g] * I.im[p] + O.im[g] * I.re[p]; }
        if (k < K - 1) { T.inc[k + 1].re.set(E.re); T.inc[k + 1].im.set(E.im); this.propagate(T.inc[k + 1].re, T.inc[k + 1].im, n4, f.prop, false); }
      }
      // modulus constraint at the detector
      const W = T.w; W.re.set(T.ex[K - 1].re); W.im.set(T.ex[K - 1].im);
      P.fft2(W.re, W.im, n4);
      const o = idx * n2;
      for (let p = 0; p < n2; p++) {
        const y = (p / n4) | 0, x = p % n4, meas = Math.sqrt(f.data[o + ((y + h) % n4) * n4 + ((x + h) % n4)]);
        const amp = Math.hypot(W.re[p], W.im[p]);
        T.errSum += (amp - meas) ** 2;
        const sc = amp > 1e-12 ? meas / amp : 0;
        W.re[p] *= sc; W.im[p] *= sc;
      }
      P.fft2(W.re, W.im, n4, true);
      // back through the slices: W holds the corrected exit wave of slice k
      for (let k = K - 1; k >= 0; k--) {
        const O = T.O[k], I = T.inc[k], E = T.ex[k];
        let mI = 0, mO = 0;
        for (let p = 0; p < n2; p++) { mI = Math.max(mI, I.re[p] * I.re[p] + I.im[p] * I.im[p]); const g = Wi[p]; mO = Math.max(mO, O.re[g] * O.re[g] + O.im[g] * O.im[g]); }
        for (let p = 0; p < n2; p++) {
          const g = Wi[p], dr = W.re[p] - E.re[p], di = W.im[p] - E.im[p];
          const ir = I.re[p], ii = I.im[p], or = O.re[g], oi = O.im[g];
          O.re[g] += (beta * (ir * dr + ii * di)) / (mI || 1);
          O.im[g] += (beta * (ir * di - ii * dr)) / (mI || 1);
          if (k > 0) { // corrected wave entering this slice, then back-propagate to the previous exit
            W.re[p] = ir + (beta * (or * dr + oi * di)) / (mO || 1);
            W.im[p] = ii + (beta * (or * di - oi * dr)) / (mO || 1);
          }
        }
        if (k > 0) this.propagate(W.re, W.im, n4, f.prop, true);
      }
      if (++T.k >= N * N) { T.k = 0; T.iter++; T.errHist.push(T.errSum); if (T.iter >= T.maxIter) break; }
    }
    return true;
  }
  msPhase(k, S = 96) { // phase of slice k (or the sum when k < 0) over the scanned area
    const T = this.mpty;
    if (!T) return null;
    const f = T.fd, G = f.gridN, out = new Float32Array(S * S), x0 = G / 2 - f.scan / 2 / f.dx;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const g = Math.round(x0 + ((y + 0.5) / S) * (f.scan / f.dx)) * G + Math.round(x0 + ((x + 0.5) / S) * (f.scan / f.dx));
      let v = 0;
      for (let kk = 0; kk < f.K; kk++) if (k < 0 || kk === k) v += Math.atan2(T.O[kk].im[g], T.O[kk].re[g]);
      out[y * S + x] = v;
    }
    return { arr: out, S };
  }

  // ------------------------------------------------------------ ptychography (ePIE, known probe)
  // Reconstruct the specimen's complex transmission from the recorded diffraction intensities alone.
  startPtycho() {
    const f = this.fd, G = f.gridN;
    const re = new Float64Array(G * G).fill(1), im = new Float64Array(G * G);
    let pm = 0;
    for (let i = 0; i < f.n4 * f.n4; i++) pm = Math.max(pm, f.pr[i] * f.pr[i] + f.pi[i] * f.pi[i]);
    const order = Array.from({ length: f.N * f.N }, (_, i) => i);
    this.pty = { fd: f, re, im, pm, iter: 0, k: 0, order, err: 0, errSum: 0, errHist: [] };
  }
  stepPtycho(budget) {
    const T = this.pty, f = T.fd, { N, n4, gridN, pr, pi, data, dx, step, scan, wr, wi } = f;
    if (T.iter >= 30) return false;
    const h = n4 / 2, t0 = performance.now(), beta = 0.9;
    const pr0 = new Float64Array(n4 * n4), pi0 = new Float64Array(n4 * n4);
    while (performance.now() - t0 < budget) {
      if (T.k === 0) {
        for (let i = T.order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [T.order[i], T.order[j]] = [T.order[j], T.order[i]]; }
        T.errSum = 0;
      }
      const idx = T.order[T.k], i = idx % N, j = (idx / N) | 0;
      const left = Math.round(gridN / 2 + (-scan / 2 + (i + 0.5) * step) / dx) - h;
      const top = Math.round(gridN / 2 + (-scan / 2 + (j + 0.5) * step) / dx) - h;
      for (let y = 0; y < n4; y++)
        for (let x = 0; x < n4; x++) {
          const g = (top + y) * gridN + left + x, p = y * n4 + x;
          wr[p] = T.re[g] * pr[p] - T.im[g] * pi[p];
          wi[p] = T.re[g] * pi[p] + T.im[g] * pr[p];
          pr0[p] = wr[p]; pi0[p] = wi[p];
        }
      P.fft2(wr, wi, n4);
      const o = idx * n4 * n4;
      for (let y = 0; y < n4; y++)
        for (let x = 0; x < n4; x++) {
          const p = y * n4 + x, meas = Math.sqrt(data[o + ((y + h) % n4) * n4 + ((x + h) % n4)]);
          const amp = Math.hypot(wr[p], wi[p]);
          T.errSum += (amp - meas) ** 2;
          const sc = amp > 1e-12 ? meas / amp : 0;
          wr[p] *= sc; wi[p] *= sc;
        }
      P.fft2(wr, wi, n4, true);
      for (let y = 0; y < n4; y++)
        for (let x = 0; x < n4; x++) {
          const g = (top + y) * gridN + left + x, p = y * n4 + x;
          const dr = wr[p] - pr0[p], di = wi[p] - pi0[p];
          // O += β · conj(P) · Δψ / max|P|²
          T.re[g] += (beta * (pr[p] * dr + pi[p] * di)) / T.pm;
          T.im[g] += (beta * (pr[p] * di - pi[p] * dr)) / T.pm;
        }
      if (++T.k >= N * N) { T.k = 0; T.iter++; T.errHist.push(T.errSum); T.err = T.errSum; if (T.iter >= 30) break; }
    }
    return true;
  }
  // Reconstructed phase over the scanned area (N·s × N·s samples).
  ptychoPhase(S = 96) {
    const T = this.pty;
    if (!T) return null;
    const f = T.fd, G = f.gridN, out = new Float32Array(S * S);
    const x0 = G / 2 - f.scan / 2 / f.dx;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const gx = Math.round(x0 + ((x + 0.5) / S) * (f.scan / f.dx)), gy = Math.round(x0 + ((y + 0.5) / S) * (f.scan / f.dx));
        const g = gy * G + gx;
        out[y * S + x] = Math.atan2(T.im[g], T.re[g]);
      }
    return { arr: out, S };
  }

  cbedAt(idx) {
    const f = this.fd;
    if (!f) return null;
    idx = clamp(idx, 0, Math.max(0, f.done - 1));
    return f.data.subarray(idx * f.n4 * f.n4, (idx + 1) * f.n4 * f.n4);
  }

  // ------------------------------------------------------------ spectrum imaging (EDS / EELS)
  computeSI() {
    const S = this.S, n = 128, dx = (S.fov * 10) / n, spec = this.spec;
    const maps = this.maps({ n, dx, elements: true });
    if (this.stale.probe) this.computeProbe();
    const s = this.probe.fwhm / 2.355 / dx;
    const els = spec.elements.map((e) => ({ idx: e, key: P.EL[e].key || P.EL[e].sym, sym: P.EL[e].sym, map: blur(Float32Array.from(maps.elem[e]), n, s) }));
    const tau = new Float32Array(n * n), totN = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const wx = maps.x0 + (x + 0.5) * dx, wy = maps.y0 + (y + 0.5) * dx;
        tau[y * n + x] = spec.tauAt(wx, wy, S.thick * 10, S.kV);
      }
    blur(tau, n, s);
    const comp = {};
    let all = 0;
    for (const e of els) {
      let t = 0;
      for (let i = 0; i < n * n; i++) { t += e.map[i]; totN[i] += e.map[i]; }
      comp[e.key] = t; all += t;
    }
    for (const k in comp) comp[k] /= all || 1;
    let tm = 0;
    for (let i = 0; i < n * n; i++) tm += tau[i];
    this.si = { n, dx, els, tau, totN, comp, tauMean: tm / (n * n), x0: maps.x0, y0: maps.y0 };
    this.buildEDS();
    this.stale.eels = 1;
  }

  edsSyms() {
    return [...new Set(this.si.els.map((e) => e.sym))];
  }

  buildEDS() {
    const si = this.si, n = si.n, S = this.S;
    const syms = this.edsSyms();
    const nb = 2000, Emax = 20, dE = Emax / nb;
    const spec = new Float32Array(nb);
    const compSym = {};
    for (const e of si.els) compSym[e.sym] = (compSym[e.sym] || 0) + si.comp[e.key];
    let zMean = 0;
    for (const e of si.els) zMean += si.comp[e.key] * P.EL[e.idx].Z;
    const addLine = (E, amp) => {
      const s = P.edsFWHM(E) / 2.355;
      const b0 = Math.max(0, Math.floor((E - 4 * s) / dE)), b1 = Math.min(nb - 1, Math.ceil((E + 4 * s) / dE));
      for (let b = b0; b <= b1; b++) {
        const e = (b + 0.5) * dE;
        spec[b] += (amp * dE * Math.exp(-0.5 * ((e - E) / s) ** 2)) / (s * 2.5066);
      }
    };
    for (const L of P.XRAY) {
      if (L.el === 'Cu') { addLine(L.E, 0.012 * L.w * P.detEff(L.E)); continue; }
      const c = compSym[L.el];
      if (c) addLine(L.E, c * L.y * L.w * P.detEff(L.E));
    }
    const E0 = S.kV;
    for (let b = 0; b < nb; b++) {
      const E = (b + 0.5) * dE;
      if (E < 0.12) continue;
      spec[b] += 7e-7 * zMean * ((E0 - E) / E) * P.detEff(E) * 40;
    }
    let tot = 0;
    for (let b = 0; b < nb; b++) tot += spec[b];
    for (let b = 0; b < nb; b++) spec[b] /= tot;
    // per-element expected maps
    const maps = {};
    let mx = 0;
    for (const sym of syms) {
      const m = new Float32Array(n * n);
      const y = P.XRAY.find((l) => l.el === sym && l.w === 1)?.y ?? 1;
      for (const e of si.els) if (e.sym === sym) for (let i = 0; i < n * n; i++) m[i] += e.map[i] * y;
      maps[sym] = m;
      for (let i = 0; i < n * n; i++) mx = Math.max(mx, m[i]);
    }
    for (const sym of syms) { const m = maps[sym]; for (let i = 0; i < n * n; i++) m[i] /= mx || 1; }
    this.eds = { spec, nb, dE, Emax, maps, syms, compSym };
    this.acc = { t: 0, spec: new Float32Array(nb), maps: Object.fromEntries(syms.map((s) => [s, new Float32Array(n * n)])), total: 0 };
  }

  eelsRangeBounds() {
    return { low: [-4, 60], core: [60, 720], high: [1500, 2500] }[this.S.eelsRange];
  }
  eelsRes() { return this.S.clarity === 'real' ? 0.75 : 0.9; }

  // Model single-scattering + plural plasmon EELS at energy loss E (per eV, ZLP area = 1 at τ=0)
  eelsModel(E, tau, comp, parts = null) {
    const spec = this.spec, res = this.eelsRes(), real = this.S.clarity === 'real';
    const s = res / 2.355;
    const P0 = Math.exp(-tau);
    const zlp = (P0 * Math.exp(-0.5 * (E / s) ** 2)) / (s * 2.5066);
    let pl = 0, fac = 1;
    for (let k = 1; k <= 4; k++) {
      fac *= k;
      const Pk = (P0 * Math.pow(tau, k)) / fac;
      for (const p of spec.plasmon) {
        const Ep = p.Ep * k, G = p.G * Math.sqrt(k);
        if (E <= 0) continue;
        const v = (E * G * Ep * Ep) / ((E * E - Ep * Ep) ** 2 + (E * G) ** 2);
        pl += Pk * p.frac * v * (2 / Math.PI) / Ep;
      }
    }
    const bg = E > 20 ? 0.012 * tau * Math.pow(E / 30, -3.1) * Math.min(1, (E - 20) / 12) : 0;
    let core = 0;
    const edgesOut = parts ? {} : null;
    for (const ed of P.EDGES) {
      const c = comp[ed.key];
      if (!c) continue;
      const v = 0.00035 * tau * c * P.edgeSignal(ed, E, res, real);
      core += v;
      if (edgesOut) edgesOut[ed.key] = (edgesOut[ed.key] || 0) + v;
    }
    if (parts) { parts.zlp = zlp; parts.pl = pl; parts.bg = bg; parts.core = core; parts.edges = edgesOut; }
    return zlp + pl + bg + core;
  }

  buildEELS() {
    const si = this.si, S = this.S, n = si.n;
    const [E0, E1] = this.eelsRangeBounds();
    const nb = 640, dE = (E1 - E0) / nb;
    const spec = new Float32Array(nb), bgc = new Float32Array(nb);
    const edgeCurves = {};
    const parts = {};
    for (let b = 0; b < nb; b++) {
      const E = E0 + (b + 0.5) * dE;
      spec[b] = this.eelsModel(E, si.tauMean, si.comp, parts);
      bgc[b] = parts.bg + parts.pl + parts.zlp;
      for (const k in parts.edges) (edgeCurves[k] ||= new Float32Array(nb))[b] = parts.edges[k];
    }
    // energy-window integrals for mapping
    const w0 = S.eelsWin - S.eelsWidth / 2, w1 = S.eelsWin + S.eelsWidth / 2, steps = 60, h = (w1 - w0) / steps;
    const edgeW = {};
    let zW = 0, pW = 0, bW = 0;
    const res = this.eelsRes(), real = S.clarity === 'real', s = res / 2.355;
    for (let i = 0; i < steps; i++) {
      const E = w0 + (i + 0.5) * h;
      zW += (Math.exp(-0.5 * (E / s) ** 2) / (s * 2.5066)) * h;
      for (const p of this.spec.plasmon) if (E > 0) pW += p.frac * ((E * p.G * p.Ep * p.Ep) / ((E * E - p.Ep * p.Ep) ** 2 + (E * p.G) ** 2)) * (2 / Math.PI) / p.Ep * h;
      bW += (E > 20 ? 0.012 * Math.pow(E / 30, -3.1) * Math.min(1, (E - 20) / 12) : 0) * h;
      for (const ed of P.EDGES) edgeW[ed.key] = (edgeW[ed.key] || 0) + 0.00035 * P.edgeSignal(ed, E, res, real) * h;
    }
    const lowLoss = w1 < 50;
    const sub = S.bgsub && !lowLoss;
    const map = new Float32Array(n * n);
    let mx = 0;
    for (let i = 0; i < n * n; i++) {
      const t = si.tau[i], P0 = Math.exp(-t);
      let v = 0;
      if (!sub) v += zW * P0 + pW * t * P0 + bW * t;
      if (si.totN[i] > 0) for (const e of si.els) v += (t * e.map[i] / si.totN[i]) * (edgeW[e.key] || 0);
      map[i] = v;
      if (v > mx) mx = v;
    }
    for (let i = 0; i < n * n; i++) map[i] /= mx || 1;
    let tot = 0;
    for (let b = 0; b < nb; b++) tot += spec[b];
    this.eels = { spec, bgc, edgeCurves, nb, dE, E0, E1, map, sub, lowLoss, tot, edgeW };
    this.accE = { t: 0, spec: new Float32Array(nb), map: new Float32Array(n * n), total: 0 };
  }

  accumulate(dt) {
    const S = this.S, rate = S.dose / 500;
    if (S.mode === 'eds' && this.eds && this.acc) {
      const a = this.acc, e = this.eds, n = this.si.n;
      a.t += dt;
      const N = 42000 * rate * dt;
      for (let b = 0; b < e.nb; b++) { const c = P.poisson(e.spec[b] * N); a.spec[b] += c; a.total += c; }
      for (const sym of e.syms) {
        const m = e.maps[sym], acc = a.maps[sym], k = 7 * rate * dt;
        for (let i = 0; i < n * n; i++) acc[i] += P.poisson(m[i] * k);
      }
      this.version++;
    }
    if (S.mode === 'eels' && this.eels && this.accE) {
      const a = this.accE, e = this.eels, n = this.si.n;
      a.t += dt;
      const N = 3e6 * rate * dt;
      for (let b = 0; b < e.nb; b++) { const c = P.poisson(e.spec[b] * N); a.spec[b] += c; a.total += c; }
      const k = 16 * rate * dt;
      for (let i = 0; i < n * n; i++) a.map[i] += P.poisson(e.map[i] * k);
      this.version++;
    }
  }

  // ------------------------------------------------------------ single-electron mode
  resetSingle() {
    if (this.single) this.single = { hits: null, count: 0, t: 0, cdf: null, key: null, recent: [] };
  }
  startSingle(on) {
    this.single = on ? { hits: null, count: 0, t: 0, cdf: null, key: null, recent: [] } : null;
  }
  singleTarget() {
    const S = this.S;
    if (S.mode === '4d') {
      const f = this.fd;
      if (!f || !f.done) return null;
      const arr = this.cbedAt(S.fdSel >= 0 ? S.fdSel : f.done - 1);
      return { arr, w: f.n4, h: f.n4, key: `4d${S.fdSel}` };
    }
    if (S.mode === 'eds' || S.mode === 'eels') return null;
    return this.main ? { ...this.main, key: S.mode + this.version } : null;
  }
  stepSingle(dt) {
    const sg = this.single;
    if (!sg) return;
    const tg = this.singleTarget();
    if (!tg) return;
    if (!sg.cdf || sg.w !== tg.w || sg.src !== tg.arr) {
      const cdf = new Float64Array(tg.w * tg.h);
      let s = 0, mn = Infinity;
      for (let i = 0; i < cdf.length; i++) mn = Math.min(mn, tg.arr[i]);
      if (this.S.mode === 'tem' || (this.S.mode === 'stem' && this.stemImg?.type === 'BF')) mn = 0;
      else if (this.S.mode === 'stem') mn = mn * 0.6;
      else mn = 0;
      // a beam stop physically blocks the direct beam, so those electrons never reach the camera
      const stop = this.S.mode === 'diff' && this.S.beamStop;
      for (let i = 0; i < cdf.length; i++) {
        let v = Math.max(0, tg.arr[i] - mn);
        if (stop) { const x = (i % tg.w) - tg.w / 2, y = ((i / tg.w) | 0) - tg.h / 2; if (Math.hypot(x, y) < 5 || (y > 0 && Math.abs(x) < 2)) v = 0; }
        s += v; cdf[i] = s;
      }
      sg.cdf = cdf; sg.w = tg.w; sg.h = tg.h; sg.src = tg.arr;
      if (!sg.hits || sg.hits.length !== cdf.length) { sg.hits = new Float32Array(cdf.length); sg.count = 0; sg.t = 0; }
    }
    sg.t += dt;
    const want = Math.min(6000, Math.floor(1 + 0.6 * Math.pow(sg.t, 2.4)));
    const cdf = sg.cdf, tot = cdf[cdf.length - 1];
    if (!tot) return;
    sg.recent = [];
    for (let k = 0; k < want; k++) {
      const r = Math.random() * tot;
      let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
      sg.hits[lo] += 1; sg.count++;
      if (k < 40) sg.recent.push(lo);
    }
    this.version++;
  }

  // ------------------------------------------------------------ main update
  // Knock-on damage in graphene: above ~86 kV a head-on collision can displace a carbon atom from the
  // lattice; edge atoms (fewer bonds) go at lower voltage. Holes nucleate at defects and grow from their edges.
  sputter(dt) {
    const S = this.S, spec = this.spec;
    if (!spec.twoD || S.paused || !['tem', 'stem'].includes(S.mode)) return;
    const relP = Math.pow(Math.max(0, (S.kV - 86) / 114), 1.5), relE = Math.pow(Math.max(0, (S.kV - 55) / 145), 1.3) * 5;
    const rMax = Math.max(relP, relE);
    if (!rMax) return;
    const A = spec.atoms, half = (S.fov * 10) / 2, ids = [];
    A.query(S.cx - half, S.cy - half, S.cx + half, S.cy + half, (i) => { if (!A.dead[i] && Math.abs(A.x[i] - S.cx) < half && Math.abs(A.y[i] - S.cy) < half) ids.push(i); });
    if (!ids.length) return;
    // scaled so pristine graphene at 200 kV loses ~1 atom/s from a 6 nm field at the default dose
    const attempts = P.poisson(ids.length * rMax * (S.dose / 400) * (dt * S.speed) / 1200);
    let hit = 0;
    for (let a = 0; a < attempts; a++) {
      const i = ids[(Math.random() * ids.length) | 0];
      if (A.dead[i]) continue;
      let nb = 0;
      A.query(A.x[i] - 1.7, A.y[i] - 1.7, A.x[i] + 1.7, A.y[i] + 1.7, (j) => { if (j !== i && !A.dead[j] && A.g[j] === A.g[i] && (A.x[j] - A.x[i]) ** 2 + (A.y[j] - A.y[i]) ** 2 < 2.4) nb++; });
      const r = nb >= 3 ? relP : relE;
      if (Math.random() < r / rMax) { A.dead[i] = 1; hit++; }
    }
    if (hit) { spec.sputtered += hit; spec.damageVer++; this.invalidate('damage'); this._soft = true; }
  }
  // Radiolysis in beam-sensitive crystals (MOFs): the dose set per image accumulates while the beam is on.
  // Critical dose Dc ∝ β² (inelastic cross-section ∝ 1/β²), so lower voltage destroys the crystal faster.
  critDose() { return this.spec.Dc300 * Math.pow(P.betaOf(this.S.kV) / P.betaOf(300), 2); }
  radiolysis(dt) {
    const S = this.S, spec = this.spec;
    if (!spec.beamSensitive || S.paused || S.mode === 'ronch') return;
    this.doseAcc = (this.doseAcc || 0) + S.dose * 0.5 * dt * S.speed;
    const q = 1 - Math.exp(-this.doseAcc / this.critDose()), qs = Math.round(q * 40) / 40;
    if (qs !== spec.dmg) { spec.dmg = qs; spec.damageVer++; this.invalidate('damage'); this._soft = true; }
  }
  freshArea() {
    const spec = this.spec;
    this.doseAcc = 0;
    if (spec.beamSensitive) { spec.dmg = 0; spec.damageVer++; this.invalidate('damage'); this.stale.fd = 1; this.stale.si = 1; }
  }
  restoreSpecimen() {
    const spec = this.spec;
    if (!spec.atoms.dead) return;
    spec.atoms.dead.fill(0); spec.sputtered = 0; spec.damageVer++;
    this.invalidate('damage');
  }

  update(dt) {
    this.sputter(dt);
    this.radiolysis(dt);
    const S = this.S, m = S.mode;
    if (this.stale.probe && (m !== 'tem' && m !== 'diff')) { this.computeProbe(); this.stale.probe = 0; }
    if (m === 'tem' && this.stale.tem) { this.computeTEM(); this.stale.tem = 0; this.version++; }
    if (m === 'stem' && this.stale.stem) {
      const soft = this._soft; // beam damage: keep scanning, like a live instrument
      const pass = this._stemPass;
      this.computeSTEM(); this.stale.stem = 0;
      if (soft) this._stemPass = pass; else this.raster = 0;
      this.version++;
    }
    this._soft = false;
    if (m === 'diff') {
      if (this.stale.diff) { this.computeDiff(); this.stale.diff = 0; this.version++; }
      else if (this.diffDisp && this._camL !== S.camL + this.lam) { this.resampleDiff(); this.version++; }
      this._camL = S.camL + this.lam;
    }
    if (m === '4d') {
      if (this.stale.fd) { this.start4D(); this.stale.fd = 0; }
      const prev = this.fd.done;
      if (this.step4D(S.paused ? 0 : 7 * Math.min(2, Math.max(0.25, S.speed)))) this.version++;
      if (this.stale.vimg) { this.computeVirtual(0); this.stale.vimg = 0; this.version++; }
      else if (this.fd.done !== prev) this.computeVirtual(this.fd.vDone);
      if (S.vdet === 'mptycho' && this.fd.done === this.fd.N * this.fd.N && !S.paused) {
        if (!this.mpty || this.mpty.fd !== this.fd) this.startMSPtycho();
        if (this.stepMSPtycho(11 * Math.min(2, Math.max(0.3, S.speed)))) this.version++;
      }
      if (S.vdet === 'ptycho' && this.fd.done === this.fd.N * this.fd.N && !S.paused) {
        if (!this.pty || this.pty.fd !== this.fd) this.startPtycho();
        if (this.stepPtycho(9 * Math.min(2, Math.max(0.3, S.speed)))) this.version++;
      }
    }
    if (m === 'eds' || m === 'eels') {
      if (this.stale.si) { this.computeSI(); this.stale.si = 0; this.version++; }
      if (m === 'eels' && this.stale.eels) { this.buildEELS(); this.stale.eels = 0; this.version++; }
      if (!S.paused) this.accumulate(dt * S.speed);
    }
    if (m === 'ronch' && this.ronch.stale) { this.ronch.compute(); this.version++; }
    if (m === 'cbed' && this.cbed.stale) { this.cbed.compute(); this.version++; }
    if (m === 'ronch') this.main = this.ronch.disp ? { arr: this.ronch.disp.arr, w: this.ronch.disp.W, h: this.ronch.disp.W } : null;
    if (m === 'cbed') this.main = this.cbed.disp ? { arr: this.cbed.disp.arr, w: this.cbed.disp.W, h: this.cbed.disp.W } : null;
    if (m === 'tem') this.main = this.tem ? { arr: this.tem.img, w: this.tem.c, h: this.tem.c } : null;
    if (m === 'stem') this.main = this.stemImg ? { arr: this.stemImg.img, w: this.stemImg.c, h: this.stemImg.c } : null;
    if (m === 'diff') this.main = this.diffDisp ? { arr: this.diffDisp.arr, w: this.diffDisp.W, h: this.diffDisp.W } : null;
    if (m === 'stem' && !S.paused) {
      const prev = this.raster;
      this.raster += (dt * S.speed) / 2.4;
      if (this.raster >= 1) { this.raster = 0; this.frameNoise++; }
      if ((this.raster * 224 | 0) !== (prev * 224 | 0)) this.version++;
    }
    if (this.single && !S.paused) this.stepSingle(dt * S.speed);
  }
}
