// Simulation engine: turns the instrument state into detector signals.
import { needsProbe } from './registry.js';
import * as P from './physics.js';
import { Ronch, CBED } from './techniques.js';
import { OffAxis, FocalSeries } from './holography.js';
import { Lorentz } from './lorentz.js';
import { focalSpread } from './profile.js';
import * as EELS from './eels.js';
import * as KR from './kernels.js';
import { hasZones, zoneSpec } from './zone.js';
import * as ED from './ed3d.js';
import * as LAT from './lattice.js';
import { InlineBackend } from './compute.js';
import * as TOMO from './tomo.js';
import * as SPA from './spa.js';
import * as PT from './ptychotomo.js';
import * as ENV from './environment.js';
import * as LIQ from './liquid.js';
import * as GAS from './gas.js';
import * as BIAS from './bias.js';
import * as INSITU from './insitu.js';
import { buildStructure } from './structure.js';
import { HOLDERS, specimenT, u2Ratio, thermalStrain, radiolysisFactor, iceSublimation, DEVITRIFY_K } from './holder.js';

const SP = P.SPECIMENS;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// sub-pixel shift of an n × n image by (sx, sy) pixels (bilinear, edges clamped)
function shiftImg(I, n, sx, sy) {
  if (Math.abs(sx) < 1e-3 && Math.abs(sy) < 1e-3) return I;
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = clamp(x - sx, 0, n - 1.001), fy = clamp(y - sy, 0, n - 1.001), x0 = fx | 0, y0 = fy | 0, a = fx - x0, b = fy - y0;
    out[y * n + x] = (I[y0 * n + x0] * (1 - a) + I[y0 * n + x0 + 1] * a) * (1 - b) + (I[(y0 + 1) * n + x0] * (1 - a) + I[(y0 + 1) * n + x0 + 1] * a) * b;
  }
  return out;
}
// four-segment DPC: the half-difference of a disc shifted by u radii
const dpcD = (u) => (Math.abs(u) >= 1 ? Math.sign(u) : (2 / Math.PI) * (u * Math.sqrt(1 - u * u) + Math.asin(u)));
export const AP_MRAD = { none: Infinity, 40: 12, 20: 6, 10: 3, df: 2.5, zpp: Infinity };
// Zernike phase plate: a thin film in the back focal plane with a small central hole. Unscattered electrons
// pass the hole; scattered ones cross the film and are shifted by π/2. Cut-on frequency set by the hole.
export const EELS_CHANNELS = 2048;
// Detector point-spread function, in channels (σ): even a perfect spectrum is smeared over ~2 channels.
export const EELS_PSF = 0.85;
// orientation mapping: a pattern is crystalline when its spots beat its own azimuthal average by this much
// (measured: crystals ≥ 0.57, amorphous SiO₂ ≤ 0.35 at the 90th percentile)
export const CRYSTAL_EXCESS = 0.45;
// Integrating (CCD/CMOS) spectrometer camera: a 16-bit converter at ~4 counts per electron fills at
// ~16,400 electrons per channel per readout; read noise ~3 electrons rms per channel.
export const EELS_FULL_WELL = 65535 / 4, EELS_READ_NOISE = 3;
// dual EELS: the low-loss spectrum starts just below the zero loss
export const EELS_LOW_OFFSET = -5;
// thickness from a low-loss spectrum: t/λ = ln(I_total / I_zero loss), zero loss integrated to the first minimum
export function lowTau(spec, E0, dE) {
  const i0 = Math.round(-E0 / dE);
  if (i0 < 2 || i0 >= spec.length - 2) return null;
  let r = i0;
  while (r < spec.length - 2 && spec[r + 1] < spec[r]) r++;
  let z = 0, t = 0;
  for (let b = 0; b < spec.length; b++) { t += spec[b]; if (b <= r) z += spec[b]; }
  return z > 0 ? Math.log(t / z) : null;
}
export const ZPP_CUTON = 1 / 250; // 1/Å (hole ≈ 1 µm at f ≈ 3 mm, 200 kV)

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

// Zero-loss peak as recorded: position (centroid of the top half) and full width at half maximum, if it is in range.
export function zlpStats(spec, E0, dE) {
  const nb = spec.length, i0 = Math.round(-E0 / dE);
  if (i0 < 2 || i0 > nb - 3) return null;
  const R = Math.max(3, Math.round(3 / dE));
  let k = Math.max(0, i0 - R);
  for (let i = Math.max(0, i0 - R); i <= Math.min(nb - 1, i0 + R); i++) if (spec[i] > spec[k]) k = i;
  const pk = spec[k], half = pk / 2;
  let l = k, r = k;
  while (l > 0 && spec[l] > half) l--;
  while (r < nb - 1 && spec[r] > half) r++;
  const xl = l + (half - spec[l]) / (spec[l + 1] - spec[l] || 1), xr = r - 1 + (spec[r - 1] - half) / (spec[r - 1] - spec[r] || 1);
  let m0 = 0, m1 = 0;
  for (let i = l; i <= r; i++) { m0 += spec[i]; m1 += spec[i] * i; }
  return { center: E0 + (m1 / (m0 || 1) + 0.5) * dE, fwhm: (xr - xl) * dE, channels: xr - xl, peak: pk };
}

export class Sim {
  constructor(S) {
    this.S = S;
    this.compute = new InlineBackend();
    this.mapCache = new Map();
    this.stale = { tem: 1, stem: 1, diff: 1, fd: 1, vimg: 1, si: 1, eels: 1, probe: 1 };
    this.version = 0;
    this.raster = 0;
    this.frameNoise = 0;
    this.ronch = new Ronch(this);
    this.cbed = new CBED(this);
    this.oah = new OffAxis(this);
    this.ilh = new FocalSeries(this);
    this.lor = new Lorentz(this);
  }

  // the specimen; a crystal viewed along another zone axis (S.zone = [u, v, w]) is a single-crystal slab built in
  // 3D (zone.js), rebuilt when the zone or the thickness changes
  get spec() {
    const S = this.S;
    if (!S.zone || !hasZones(S.spec)) return SP[S.spec];
    const t = Math.round(S.thick * 10), key = `${S.spec}|${S.zone.join(',')}|${t}`;
    if (this._zone?.key !== key) this._zone = { key, spec: zoneSpec(S.spec, S.zone, t, clamp(SP[S.spec].fov * 7, 40, 90)) };
    return this._zone.spec;
  }
  get lam() { return P.wavelength(this.S.kV); }
  // Cs, defocus and the axial aberrations act as knob setting + hidden misalignment (S.mis), as on a real
  // instrument where the readouts are lens settings, not the true aberrations (used by training scenarios).
  CsA() { return this.S.corrector ? (this.S.csCor + (this.S.mis?.C3 ?? 0)) * 1e4 : this.S.csUnc * 1e7; } // Å
  dfA() { return (this.S.df + (this.S.mis?.df ?? 0)) * 10; } // true defocus, Å
  // from the instrument profile (see profile.js)
  focalSpread() { return focalSpread(this.S.profile, this.S.kV); } // Å
  convTEM() { return this.S.profile.convTEM * 1e-3; } // rad
  infoLimit() { return P.infoLimit(this.lam, this.focalSpread()); } // Å
  // true field of view, Å: the nominal value times the instrument's magnification calibration
  fovA() { return this.S.fov * 10 * this.S.profile.magCal; }
  camLTrue() { return this.S.camL * this.S.profile.camLCal; } // mm
  // ------------------------------------------------------------ specimen temperature (holder.js)
  temp() { return specimenT(this.S.holder, this.S.tempSet, this.clock || 0) + (this.biasSt?.dT ?? 0); } // K, at the specimen (with the bias current's Joule heating)
  isCold() { return this.temp() < 170; } // cold enough to keep ice (and slow radiolysis)
  // thermal state used by the maps: vibration amplitude relative to 293 K and thermal strain
  thermal() {
    const T = this.temp();
    return { T, u2r: Math.round(u2Ratio(T) * 20) / 20, eps: Math.round(thermalStrain(T, this.spec.alpha ?? 0) * 1e4) / 1e4 };
  }
  strainPct() { return this.S.strain + this.thermal().eps * 100; } // set strain plus thermal expansion, %
  // vitreous ice left on the grid (Å) and whether it has crystallized
  ice() { return { t: Math.max(0, this.S.thick * 10 - (this.iceLoss || 0) * 10), cryst: !!this.devitrified }; }
  // holder drift, Å/s: each holder's steady drift plus a kick (inserting, cooling, a temperature step) that settles
  driftSpeed() {
    const H = HOLDERS[this.S.holder] ?? HOLDERS.room, t = (this.clock || 0) - (this.kickT || 0);
    return H.base + (this.kick || 0) * Math.exp(-t / H.tau) + (this.rampDrift || 0); // + thermal drift while a temperature ramp runs (insitu.js)
  }
  // a disturbance adds to whatever drift is left; a new holder (replace) starts settling from scratch
  kickDrift(v, replace = false) { this.kick = (replace ? 0 : this.driftSpeed() - (HOLDERS[this.S.holder]?.base ?? 0)) + v; this.kickT = this.clock || 0; }
  driftDir() { return [Math.cos(0.6), Math.sin(0.6)]; }
  alpha() {
    const S = this.S;
    return ({ '4d': S.alpha4d, ronch: S.ronchAp, cbed: S.cbedKind === 'lacbed' ? S.alphaLA : S.alphaCB }[S.mode] ?? S.alpha) * 1e-3;
  }
  // residual axial aberrations from the corrector, in Å (A1, B2, A2 in nm; A3 in µm)
  abA() {
    const a = this.S.ab, m = this.S.mis;
    if (!m) return { A1: a.A1 * 10, A1a: a.A1a, B2: a.B2 * 10, B2a: a.B2a, A2: a.A2 * 10, A2a: a.A2a, A3: a.A3 * 1e4, A3a: a.A3a };
    // n-fold aberrations add as vectors at n·angle
    const add = (mag, ang, n, v, sc) => { const x = mag * Math.cos((n * ang * Math.PI) / 180) + (v?.[0] ?? 0), y = mag * Math.sin((n * ang * Math.PI) / 180) + (v?.[1] ?? 0); return [Math.hypot(x, y) * sc, ((Math.atan2(y, x) * 180) / Math.PI / n + 360) % (360 / n)]; };
    const [A1, A1a] = add(a.A1, a.A1a, 2, m.A1, 10), [B2, B2a] = add(a.B2, a.B2a, 1, m.B2, 10), [A2, A2a] = add(a.A2, a.A2a, 3, m.A2, 10), [A3, A3a] = add(a.A3, a.A3a, 4, m.A3, 1e4);
    return { A1, A1a, B2, B2a, A2, A2a, A3, A3a };
  }

  invalidate(key) {
    const all = ['tem', 'stem', 'diff', 'fd', 'vimg', 'si', 'eels', 'probe'];
    const map = {
      objAp: ['tem'], alpha: ['stem', 'fd', 'vimg', 'si', 'eels', 'probe'], det: ['stem'],
      sa: ['diff'], camL: ['diff'], beamStop: [], camera: [], vdet: ['vimg'], eelsWin: ['eels'], eelsRange: ['eels'], eelsDisp: ['eels'], eelsOffset: ['eels'], eelsExp: ['eels'], eelsExpLow: ['eels'], eelsCurrent: ['eels'], dualEels: ['eels'], bgsub: ['eels'],
      edMethod: [], edStart: [], edEnd: [], edSpeed: [], edFps: [], edStep: [], edExp: [], edDoseRate: [], edAxis: [], edMerge: [], edSlice: [], edLayer: [],
      pedOn: ['diff', 'fd', 'vimg'], pedPhi: ['diff', 'fd', 'vimg'], pedSteps: ['diff', 'fd', 'vimg'], pedDescan: ['diff', 'fd', 'vimg'],
      eelsSource: ['eels'], eelsBeta: ['eels'], eelsDet: ['eels'], eelsPx: ['eels'], eelsYScale: [], eelsFit: [], eelsPre: [], eelsDeconv: [], eelsLine: [],
      dose: ['si'], edsSel: [], mode: [],
      // progressive beam damage: refresh images and patterns in place, but don't restart 4D scans or spectrum accumulation
      damage: ['tem', 'stem', 'diff', 'probe'],
      drift: ['tem', 'stem'],
      // temperature: the projected specimen changes (vibrations, expansion), so everything is recomputed
    };
    for (const k of map[key] ?? all) this.stale[k] = 1;
    const view = ['mode', 'edsSel', 'camera', 'beamStop', 'vdet', 'bgsub', 'eelsWin', 'eelsRange', 'eelsDisp', 'eelsOffset', 'eelsExp', 'eelsExpLow', 'eelsCurrent', 'dualEels', 'eelsSource', 'eelsBeta', 'eelsDet', 'eelsPx', 'eelsYScale', 'eelsFit', 'eelsPre', 'eelsDeconv', 'eelsLine', 'holoView', 'ilhView'];
    if (!view.includes(key)) { this.ronch.stale = true; this.cbed.stale = true; this.oah.stale = true; }
    // a focal series takes a while to record, so only restart it when the physics changes
    if (!view.includes(key) && !['damage', 'drift', 'speed', 'biprism', 'sbR', 'numCorr'].includes(key)) this.ilh.stale = true;
    // Lorentz images depend on their own view too; holder drift and beam damage of the other specimens do not matter
    if (!['damage', 'drift', 'speed', 'holoView', 'ilhView', 'vdet', 'edsSel', 'camera', 'beamStop'].includes(key)) this.lor.stale = true;
    if (!['vdet', 'edsSel', 'mode', 'camera', 'holoView', 'ilhView'].includes(key)) this.resetSingle();
    this.version++;
  }

  maps(opts) {
    const S = this.S;
    const th = this.thermal(), ice = this.ice();
    // a specimen built around the stage position (the megalibrary) builds the particle under the beam first
    this.spec.locate?.(S.cx, S.cy, S.tiltX, S.tiltY);
    const extra = ENV.slices(S, this.liq); // the environment's layers in the beam path (windows, liquid with its bubbles)
    // Brownian offset in a liquid, and the drift accumulated while a movie records (insitu.js)
    const bx = (this.liq ? Math.round(this.liq.bx * 2) / 2 : 0) + (this.driftPos?.[0] ?? 0), by = (this.liq ? Math.round(this.liq.by * 2) / 2 : 0) + (this.driftPos?.[1] ?? 0);
    const key = [S.spec, this.spec.zoneKey ?? '', this.spec.ver ?? 0, JSON.stringify(extra), th.u2r, th.eps, Math.round(ice.t), ice.cryst ? 1 : 0, this.spec.damageVer ?? 0, (S.cx + bx).toFixed(2), (S.cy + by).toFixed(2), S.thick, S.tiltX, S.tiltY, opts.n, opts.dx.toFixed(4), !!opts.elements, !!opts.noTilt, opts.part ?? ''].join('|');
    let m = this.mapCache.get(key);
    if (!m) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      m = P.projectMaps(this.spec, {
        cx: S.cx + bx, cy: S.cy + by, n: opts.n, dx: opts.dx, thick: S.thick * 10,
        tiltX: (S.tiltX * Math.PI) / 180, tiltY: (S.tiltY * Math.PI) / 180, elements: opts.elements, noTilt: opts.noTilt, part: opts.part,
        T: th.T, u2r: th.u2r, eps: th.eps, iceT: ice.t, iceCryst: ice.cryst, extra,
      });
      this._mapsMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      this.mapCache.set(key, m);
      if (this.mapCache.size > 8) this.mapCache.delete(this.mapCache.keys().next().value);
    }
    return m;
  }

  // ------------------------------------------------------------ coherent imaging core
  // Objective-lens transfer function applied to the exit wave: returns the complex image wave.
  // `df` (Å) overrides the current defocus (focal series); `exit` reuses a precomputed exit wave.
  lensWave(maps, { apK = Infinity, apCenter = [0, 0], envelopes = true, df: dfA, exit, zpp = false } = {}) {
    const n = maps.n, dx = maps.dx, lam = this.lam, df = dfA ?? this.dfA(), Cs = this.CsA(), ab = this.abA();
    const ex = exit ?? P.transmission(maps.phase, this.S.kV);
    const re = Float64Array.from(ex.re), im = Float64Array.from(ex.im);
    P.fft2(re, im, n);
    const D = this.focalSpread(), ac = this.convTEM();
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
        let c = P.chiFull(kx, ky, lam, df, Cs, ab);
        // Zernike plate: the unscattered beam (through the hole) is retarded by π/2 relative to the scattered
        // waves, which turns the phase shift into negative (dark-protein) contrast at focus: transfer −cos χ
        if (zpp) c += (Math.PI / 2) * clamp((ZPP_CUTON - Math.sqrt(k2)) / (0.4 * ZPP_CUTON) + 0.5, 0, 1);
        const cc = Math.cos(c), ss = Math.sin(c);
        const a = re[i], b = im[i];
        re[i] = H * (a * cc + b * ss);
        im[i] = H * (b * cc - a * ss);
      }
    }
    P.fft2(re, im, n, true);
    return { re, im };
  }
  // ... and its intensity |ψ|²
  lensImage(maps, opts) {
    const { re, im } = this.lensWave(maps, opts), I = new Float32Array(re.length);
    for (let i = 0; i < re.length; i++) I[i] = re[i] * re[i] + im[i] * im[i];
    return I;
  }

  computeTEM() {
    const S = this.S, n = 256, c = 224, dx = this.fovA() / c;
    const maps = this.maps({ n, dx });
    const lam = this.lam;
    let apK = AP_MRAD[S.objAp] * 1e-3 / lam, apCenter = [0, 0];
    if (S.objAp === 'df') {
      const g = this.spec.grains[0], [m, k] = this.spec.id === 'sto' || this.spec.twoD ? [1, 0] : [1, 1];
      apCenter = [m * g.b[0][0] + k * g.b[1][0], m * g.b[0][1] + k * g.b[1][1]];
      apK = Math.min(0.13, 0.45 * Math.hypot(apCenter[0], apCenter[1]));
    }
    if (S.objAp === 'zpp') apK = Infinity;
    let I = this.lensImage(maps, { apK, apCenter, zpp: S.objAp === 'zpp' });
    // a biased chip tilts the beam (bias.js): the image moves by Δf·β (in focus it does not)
    const bb = this.biasBeta();
    if (bb[0] || bb[1]) I = shiftImg(I, n, (this.dfA() * bb[0]) / dx, (this.dfA() * bb[1]) / dx);
    this.motionBlur(I, n, dx, S.camera === 'ded' ? 0.1 : 1, this.movie?.rec ? this.movie.plan.dt : 1); // a movie frame lasts 1/fps
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
    this.liquidTEM(I, n, dx);
    this.tem = { img: cropArr(I, n, c), c, dx, fft: F, n, apK, apCenter, kmax: 1 / (2 * dx) };
    this.gasContrast(this.tem.img); // on the image as shown (its own mean)
    this.main = { arr: this.tem.img, w: c, h: c };
  }

  // Probe at fine sampling (for display and size readouts)
  computeProbe() {
    const n = 128, dx = 0.1, lam = this.lam, a = this.alpha(), kAp = a / lam;
    const df = this.dfA(), Cs = this.CsA(), ab = this.abA();
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
    const S = this.S, n = 256, c = 224, dx = this.fovA() / c, lam = this.lam, a = this.alpha();
    const maps = this.maps({ n, dx });
    const type = stemDetType(S.detIn, S.detOut, S.alpha);
    let img;
    if (type === 'BF') {
      // Reciprocity: a small axial detector in STEM behaves like conventional TEM.
      img = this.lensImage(maps, { apK: a / lam });
    } else {
      // Probe intensity on this grid, then convolve with the scattering-power map.
      const kAp = a / lam, df = this.dfA(), Cs = this.CsA(), ab = this.abA();
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
        // collection angles scale as 1/L: a longer true camera length than nominal means smaller angles
        const f = clamp((S.detIn / S.profile.camLCal / S.alpha - 1) / 2, 0, 1);
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
    blur(img, n, S.profile.sourceSize / 2.355 / dx);
    this.liquidSTEM(img, n, dx);
    this.scanDrift(img, n, dx);
    this.scanDistort(img, n);
    this.stemImg = { img: cropArr(img, n, c), c, dx, type };
    this.gasContrast(this.stemImg.img);
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
    // a specimen that rotates its own atoms with the stage (zone-axis crystals) is already projected along the
    // tilted beam: its FFT is the tilted reciprocal plane, so only the Ewald curvature remains in s
    const tx = spec.ownTilt ? 0 : (S.tiltX * Math.PI) / 180, ty = spec.ownTilt ? 0 : (S.tiltY * Math.PI) / 180;
    const tEff = 30 + 0.25 * S.thick * 10;
    const dk = 1 / (n * dx);
    const ped = this.pedParams();
    if (ped) this.precessDiff(re, im, I, n, dk, tEff, tx, ty, ped);
    else for (let y = 0; y < n; y++)
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
    this.gasDiffuse(I, n, dk);
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

  // ------------------------------------------------------------ 3D ED / MicroED (ed3d.js)
  // The detector: 56 mm across (512 × 512 binned pixels of 0.11 mm) at the camera length; its edge sets the resolution.
  edParams() {
    const S = this.S, spec = this.spec, lim = ENV.maxTilt(S); // the holder's tilt range bounds the rotation
    return { method: S.edMethod, start: Math.max(-lim, S.edStart), end: Math.min(lim, S.edEnd), speed: S.edSpeed, fps: S.edFps, step: S.edStep, exposure: S.edExp, doseRate: S.edDoseRate, axis: S.edAxis,
      pedPhi: S.pedPhi, t: (spec.slabT ?? S.thick * 10), lam: this.lam, Dc: spec.beamSensitive ? this.critDose() : Infinity, crystalArea: Math.PI * 1000 ** 2, mosaic: 0.05,
      bgScale: 1 + 25 * ENV.scatteredFraction(S) }; // the windows' diffuse scattering under the spots
  }
  computeED3D() {
    const S = this.S, spec = this.spec, cr = spec.cryst ?? P.CRYST[spec.id], o = this.edParams();
    const det = { W: 512, pix: 0.11, L: this.camLTrue() }, gMax = Math.min(2, ((det.W / 2) * det.pix) / det.L / this.lam);
    let refl, name, cubic = true, lattice = null;
    if (cr && !cr.twoD) { refl = ED.reflections(cr, gMax, S.kV, o.t); name = `${cr.name}${spec.zone && spec.zone !== '—' ? ` along ${spec.zone}` : ''}`; }
    else if (spec.xyz3) {
      // any structure of explicit atoms (an uploaded XYZ): find its lattice from the atoms (lattice.js), once
      spec._lattice ??= LAT.findLattice(spec.xyz3.sym, spec.xyz3.P3) ?? false;
      lattice = spec._lattice || null;
      const P3 = spec.xyz3.P3; let z0 = Infinity, z1 = -Infinity; for (let i = 2; i < P3.length; i += 3) { z0 = Math.min(z0, P3[i]); z1 = Math.max(z1, P3[i]); }
      o.t = Math.max(10, z1 - z0); // the structure's own thickness along the beam
      if (!lattice) { // no lattice: amorphous or molecular, the series shows diffuse scattering
        const plan = ED.plan(o);
        this.ed = { diffuse: true, series: { plan, frames: Array.from({ length: plan.frames }, () => []) }, refl: [], gMax, det, o, collected: 0, running: false, img: null, imgF: -1, name: `${spec.short ?? 'structure'}: no lattice found (amorphous or molecular)`, stats: { completeness: 0, shells: [], unique: 0, observed: 0, dLimit: null }, full: { completeness: 0, shells: [], unique: 0, observed: 0, dLimit: null } };
        return;
      }
      refl = LAT.cellReflections(lattice, gMax);
      const p = lattice.params; cubic = false; // hkl refer to the found (primitive) cell: Friedel merging only
      name = `${spec.short ?? 'structure'} · cell ${p.a.toFixed(2)} ${p.b.toFixed(2)} ${p.c.toFixed(2)} Å, ${p.alpha.toFixed(1)}° ${p.beta.toFixed(1)}° ${p.gamma.toFixed(1)}°`;
    } else { this.ed = { none: true, key: '' }; return; }
    const series = ED.collect(refl, o);
    this.ed = { refl, series, gMax, det, o, cr, lattice, cubic, collected: 0, running: false, img: null, imgF: -1, name };
    this.edStats();
  }
  edStats() { const e = this.ed; if (!e || e.none || e.diffuse) return; const merge = e.cubic ? this.S.edMerge : 'friedel'; e.merge = merge; e.stats = ED.statistics(e.refl, e.series, { merge, gMax: e.gMax, upTo: Math.max(1, e.collected) }); e.full = ED.statistics(e.refl, e.series, { merge, gMax: e.gMax }); }
  // the goniometer angle now (during or after a series)
  edPhi() { const e = this.ed; if (!e || e.none) return 0; const p = e.series.plan; return e.o.start + Math.min(p.frames, Math.max(0, e.collected)) * p.wedge; }
  // the series for the current settings, then record it
  startED3D() { this.stepED3D(0); if (!this.ed || this.ed.none) return; this.ed.collected = 0; this.ed.running = true; this.edStats(); this.version++; }
  // a series plays in ~10 s of exhibit time (the real time is in plan.time_s)
  stepED3D(dt) {
    const S = this.S, key = JSON.stringify([this.spec.zoneKey ?? S.spec, S.kV, S.thick, this.camLTrue().toFixed(1), S.edMethod, S.edStart, S.edEnd, S.edSpeed, S.edFps, S.edStep, S.edExp, S.edDoseRate, S.edAxis, S.pedPhi, this.spec.beamSensitive ? this.critDose().toFixed(2) : 0, S.envWin, S.envWinT, S.holder]);
    if (this.ed?.key !== key) { this.computeED3D(); this.ed.key = key; this.version++; }
    const e = this.ed;
    if (e.none) return;
    if (e.mergeKey !== S.edMerge) { e.mergeKey = S.edMerge; this.edStats(); this.version++; }
    if (!e.running || S.paused) return;
    const F = e.series.plan.frames, before = Math.floor(e.collected);
    e.collected = Math.min(F, e.collected + (F / 10) * dt * S.speed);
    if (Math.floor(e.collected) !== before) { this.edStats(); this.version++; }
    if (e.collected >= F) { e.running = false; this.edStats(); this.version++; }
  }
  // the frame on the detector (the last one recorded, or the first before a series)
  edFrame(W = 256) {
    const e = this.ed; if (!e || e.none) return null;
    const f = Math.max(0, Math.min(e.series.plan.frames - 1, Math.ceil(e.collected) - 1));
    if (e.imgF === f && e.img?.W === W) return e.img;
    const real = this.S.clarity === 'real', geo = { W, pix: (e.det.pix * e.det.W) / W, L: e.det.L, lam: this.lam, axis: this.S.edAxis, start: e.o.start };
    if (e.diffuse) { const arr = ED.diffuseFrame(this.spec.xyz3, e.o.start + (f + 0.5) * e.series.plan.wedge, geo); e.img = { arr, W, f }; e.imgF = f; return e.img; }
    const arr = ED.frameImage(e.refl, e.series, f, { ...geo, noise: real ? (v) => P.poisson(v) : null });
    // the sweep so far: every recorded spot at its own frame's rotation, dim under the current frame
    const n = Math.ceil(e.collected), stack = n ? ED.stackImage(e.refl, e.series, n, geo) : null;
    e.img = { arr, stack, W, f }; e.imgF = f;
    return e.img;
  }

  // the precession modifier (registry MODIFIERS: ped) in effect for the current technique, or null
  pedParams() {
    const S = this.S;
    if (!S.pedOn || !['diff', 'cbed', '4d'].includes(S.mode)) return null;
    return { phi: S.pedPhi, steps: Math.max(4, S.pedSteps | 0), descan: S.pedDescan };
  }
  // Precession electron diffraction (Vincent & Midgley 1994): the beam is tilted by φ and rotated on a hollow
  // cone, and descanned below the specimen, so each pattern is an average over N azimuths θ of the excitation
  // error s(θ) = ½λk² + k·(tilt + φ(cos θ, sin θ)). Each crystal reflection gets its two-beam intensity,
  //   I_g = sin²(πt·s_eff) / (ξ_g² s_eff²),   s_eff² = s² + ξ_g⁻²,
  // with ξ_g from the structure factors (CBED.lists); the FFT supplies the spot shapes and anything that is not a
  // crystal reflection (amorphous rings, defects), weighted kinematically. Averaging over the cone integrates
  // through each reflection's rocking curve, which damps the thickness (Pendellösung) oscillation and excites
  // reflections far from the Ewald sphere. A descan error leaves each azimuth's pattern shifted by δφ/λ, so
  // spots smear into small rings.
  precessDiff(re, im, I, n, dk, tEff, tx, ty, ped) {
    const S = this.S, spec = this.spec, lam = this.lam, t = spec.fixedT ?? S.thick * 10;
    const phi = ped.phi * 1e-3, N = ped.steps, del = ped.descan / 100;
    const A = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x; A[((y + n / 2) % n) * n + ((x + n / 2) % n)] = re[i] * re[i] + im[i] * im[i]; }
    const c0 = (n / 2) * n + n / 2, W2 = A[c0] || 1;
    // crystal reflections: their extinction distance and FFT peak over each spot's footprint
    let xiMap = null, pkMap = null;
    const crystal = !spec.poly && !spec.twoD && !!(spec.cryst ?? P.CRYST[spec.id]);
    if (crystal) {
      const L = this.cbed.lists(), rp = Math.max(2, Math.ceil(2 / (S.sa * 10 * dk)));
      xiMap = new Float32Array(n * n); pkMap = new Float32Array(n * n);
      for (const r of spec.grainRot) {
        const cr = Math.cos(r), sr = Math.sin(r);
        for (const z of L.zolz) {
          const gx = z.gx * cr - z.gy * sr, gy = z.gx * sr + z.gy * cr, px = Math.round(gx / dk + n / 2), py = Math.round(gy / dk + n / 2);
          if (px < rp || py < rp || px >= n - rp || py >= n - rp) continue;
          let pk = 0;
          for (let v = -rp; v <= rp; v++) for (let u = -rp; u <= rp; u++) if (u * u + v * v <= rp * rp) pk = Math.max(pk, A[(py + v) * n + px + u]);
          if (!(pk > 0)) continue;
          for (let v = -rp; v <= rp; v++) for (let u = -rp; u <= rp; u++) {
            if (u * u + v * v > rp * rp) continue;
            const j = (py + v) * n + px + u;
            if (!xiMap[j] || z.xi < xiMap[j]) { xiMap[j] = z.xi; pkMap[j] = pk; }
          }
        }
      }
    }
    const shift = (del * phi) / lam / dk, thr = 1e-12 * W2;
    for (let q = 0; q < N; q++) {
      const th = (2 * Math.PI * (q + 0.5)) / N, ct = Math.cos(th), st = Math.sin(th), ex = tx + phi * ct, ey = ty + phi * st, sx = shift * ct, sy = shift * st;
      for (let y = 0; y < n; y++) {
        const ky = (y - n / 2) * dk;
        for (let x = 0; x < n; x++) {
          const j = y * n + x, a = A[j];
          if (a < thr) continue;
          const kx = (x - n / 2) * dk, s = 0.5 * lam * (kx * kx + ky * ky) + kx * ex + ky * ey;
          let v;
          if (xiMap && xiMap[j]) { const xi = xiMap[j], se2 = s * s + 1 / (xi * xi), sn = Math.sin(Math.PI * t * Math.sqrt(se2)); v = ((a / pkMap[j]) * W2 * sn * sn) / (xi * xi * se2); }
          else v = j === c0 || !crystal ? a : a * Math.exp(-Math.pow(1.6 * tEff * s, 2));
          if (!sx && !sy) { I[j] += v; continue; }
          const fx = x + sx, fy = y + sy, x0 = Math.floor(fx), y0 = Math.floor(fy);
          if (x0 < 0 || y0 < 0 || x0 >= n - 1 || y0 >= n - 1) continue;
          const ax = fx - x0, ay = fy - y0, b = y0 * n + x0;
          I[b] += v * (1 - ax) * (1 - ay); I[b + 1] += v * ax * (1 - ay); I[b + n] += v * (1 - ax) * ay; I[b + n + 1] += v * ax * ay;
        }
      }
    }
    for (let j = 0; j < n * n; j++) I[j] /= N;
    // how much of the diffracted FFT power the crystal reflections account for (the rest: amorphous, defects)
    let pin = 0, pall = 0;
    if (xiMap) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const j = y * n + x; if (Math.hypot(x - n / 2, y - n / 2) * dk < 0.08) continue; pall += A[j]; if (xiMap[j]) pin += A[j]; }
    this.pedInfo = { covered: xiMap ? xiMap.reduce((c, v) => c + (v ? 1 : 0), 0) : 0, powerInReflections: pall ? pin / pall : 0, N, phi: ped.phi };
  }

  // Map k-space onto the camera: radius on the detector = λ·L·k.
  resampleDiff() {
    const d = this.diff, S = this.S;
    if (!d) return;
    const W = 256, halfMM = 22; // detector half-width, mm
    const kPerPx = (2 * halfMM) / (this.camLTrue() * this.lam) / W;
    // a biased chip deflects the beam by β: the whole pattern moves by β/λ (bias.js)
    const [bx, by] = this.biasBeta().map((b) => b / this.lam);
    // projector distortion: the pattern is stretched by (1 + e/2) along ellipAng and squeezed across it
    const e = S.profile.ellip, ca = Math.cos((S.profile.ellipAng * Math.PI) / 180), sa = Math.sin((S.profile.ellipAng * Math.PI) / 180);
    const out = new Float32Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        let kx = (x - W / 2 + 0.5) * kPerPx, ky = (y - W / 2 + 0.5) * kPerPx;
        if (e) { const u = (kx * ca + ky * sa) / (1 + e / 2), v = (-kx * sa + ky * ca) / (1 - e / 2); kx = u * ca - v * sa; ky = u * sa + v * ca; }
        const fx = (kx - bx) / d.dk + d.n / 2, fy = (ky - by) / d.dk + d.n / 2;
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
    const scan = clamp(this.fovA() * 0.6, 14, 36), step = scan / N;
    const gridN = Math.ceil(scan / dx) + n4 + 8;
    // Multislice specimen: K slices with Fresnel propagation between them, so thick-specimen effects
    // (beam spreading, channeling) are in the recorded patterns. On Au/C the particles sit on top of the film.
    const K = 3, thickA = this.spec.fixedT ?? S.thick * 10, dz = thickA / K;
    const slices = [];
    if (this.spec.filmOnly) {
      const top = this.maps({ n: gridN, dx, part: 'cryst' }), bot = this.maps({ n: gridN, dx, part: 'amorph' });
      for (let k = 0; k < K; k++) slices.push(P.transmission((k < K / 2 ? top : bot).phase, S.kV, 2 / K));
    } else {
      const all = this.maps({ n: gridN, dx }), t = P.transmission(all.phase, S.kV, 1 / K);
      for (let k = 0; k < K; k++) slices.push(t);
    }
    const { re, im } = slices[0];
    const prop = this.fresnel(n4, dx, lam, dz);
    const kAp = (S.alpha4d * 1e-3) / lam, df = this.dfA(), Cs = this.CsA(), ab = this.abA();
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
    this.fd.geom = { N, n4, gridN, dx, step, scan, K, dz };
    // the scan runs on the compute backend (compute.js): inline, or in a worker in the exhibit
    for (const t of [this.fdTask, this.ptyTask, this.msTask]) t?.cancel();
    this.pty = this.mpty = null;
    // SPED: the probe tilted onto the precession cone at each azimuth, and the descan shift that brings it back
    const ped = S.mode === '4d' ? this.pedParams() : null;
    let pedJob = null;
    if (ped) {
      const M = Math.min(ped.steps, 12), kt = (ped.phi * 1e-3) / lam, dkp = 1 / (n4 * dx), ramps = [], back = [];
      for (let q = 0; q < M; q++) {
        // each tilt on the k-space grid of the 64-pixel window: a tilt between grid points makes the phase ramp
        // non-periodic over the window and leaks the bright central disk into streaks (the cone becomes a fine polygon)
        const th = (2 * Math.PI * (q + 0.5)) / M, kx = Math.round((kt * Math.cos(th)) / dkp) * dkp, ky = Math.round((kt * Math.sin(th)) / dkp) * dkp, re = new Float64Array(n4 * n4), im = new Float64Array(n4 * n4);
        for (let y = 0; y < n4; y++) for (let x = 0; x < n4; x++) { const a = 2 * Math.PI * (kx * x * dx + ky * y * dx); re[y * n4 + x] = Math.cos(a); im[y * n4 + x] = Math.sin(a); }
        ramps.push({ re, im }); back.push([-(1 - ped.descan / 100) * kx / dkp, -(1 - ped.descan / 100) * ky / dkp]);
      }
      pedJob = { ramps, back, phi: ped.phi, steps: M, descan: ped.descan };
      this.fd.ped = pedJob;
    }
    this.fdTask = this.compute.run({ kind: 'fd-scan', geom: this.fd.geom, slices, prop, pr: sr, pi: si, gpu: S.gpu !== 'off', ...(pedJob ? { ped: { ramps: pedJob.ramps, back: pedJob.back } } : {}) }, { data: this.fd.data });
    this.stale.vimg = 1;
  }
  // Scripts step the simulation in a synchronous loop, in which worker results cannot arrive: take what the worker
  // has sent, then finish the scan here (same kernels, same result)
  syncCompute() {
    const f = this.fd, t = this.fdTask;
    if (!f || !t?.remote || f.done >= f.N * f.N) return;
    t.pump(1); f.done = t.done;
    t.cancel();
    this.fdTask = new InlineBackend().run({ ...t.job, done: f.done }, { data: f.data });
  }
  // where the heavy loops run: InlineBackend (default: headless, tests) or WorkerBackend (the exhibit)
  setCompute(backend) { for (const t of [this.fdTask, this.ptyTask, this.msTask]) t?.cancel(); this.compute = backend; this.stale.fd = 1; this.pty = this.mpty = null; }

  step4D(budget) {
    const f = this.fd;
    if (!f || f.done >= f.N * f.N) return false;
    if (this.fdTask.error) { console.warn('compute:', this.fdTask.error, '(running on the main thread)'); this.fdTask = new InlineBackend().run({ ...this.fdTask.job, done: f.done }, { data: f.data }); }
    this.fdTask.pump(budget);
    f.done = this.fdTask.done;
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
    // the bias field across the scan (bias.js): β at each probe position, in mrad
    let bias = null;
    if (this.S.bsOn && this.biasSt?.op) {
      const k = (1000 * this.lam) / (2 * Math.PI);
      bias = (idx) => { const g = this.biasGrad(undefined, ((idx % f.N) - f.N / 2 + 0.5) * f.step, (((idx / f.N) | 0) - f.N / 2 + 0.5) * f.step); return [k * g[0], k * g[1]]; };
    }
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
      // a biased chip: the field at this probe position deflects the pattern by β (mrad), seen by the CoM and DPC
      const bb = bias ? bias(idx) : null;
      f.comX[idx] = (t ? (sx / t) * f.mradPx : 0) + (bb ? bb[0] : 0);
      f.comY[idx] = (t ? (sy / t) * f.mradPx : 0) + (bb ? bb[1] : 0);
      const qt = Q[0] + Q[1] + Q[2] + Q[3] || 1;
      f.dpcX[idx] = (Q[0] - Q[2]) / qt + (bb ? dpcD(bb[0] / this.S.alpha4d) : 0); f.dpcY[idx] = (Q[1] - Q[3]) / qt + (bb ? dpcD(bb[1] / this.S.alpha4d) : 0);
    }
    f.vDone = f.done;
  }

  // ------------------------------------------------------------ orientation and phase maps (ACOM on 4D-STEM / SPED)
  // The template: the crystal's zero-order zone (CBED reflection list, structure-factor weights) out to the
  // detector edge; its in-plane rotational symmetry sets the ω range that is searched.
  orientationTemplate() {
    const spec = this.spec, f = this.fd;
    const cryst = spec.cryst ?? P.CRYST[spec.id];
    if (!f || !cryst || cryst.twoD && false) return null;
    const key = [spec.zoneKey ?? spec.id, this.S.kV, f.dk.toFixed(5), f.ped?.phi ?? 0, this.S.alpha4d].join('|');
    if (this._tpl?.key === key) return this._tpl;
    // reflections the simulated patterns can hold: inside the propagator's band limit (⅔ Nyquist) less the
    // precession tilt and the probe's disk radius, and inside the detector
    const kt = f.ped ? (f.ped.phi * 1e-3) / f.lam : 0, ka = (this.S.alpha4d * 1e-3) / f.lam;
    const edge = Math.min((f.n4 / 2 - 2) * f.dk, (2 / 3) * (1 / (2 * f.dx)) - kt - 0.5 * ka), L = this.cbed.lists();
    const spots = L.zolz.filter((z) => z.g > 0.05 && z.g < Math.min(2.2, edge)).map((z) => ({ gx: z.gx, gy: z.gy, w: z.F })); // F: the strong low-order spots decide
    if (spots.length < 4) return null;
    const maps = (deg) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return spots.every((a) => spots.some((b) => Math.hypot(a.gx * c - a.gy * s - b.gx, a.gx * s + a.gy * c - b.gy) < 0.02)); };
    const period = [60, 90, 120, 180].find(maps) ?? 360;
    return (this._tpl = { key, spots, period, step: 1, name: `${cryst.name}${spec.cryst ? ` ${spec.zone}` : ''}` });
  }
  computeOrientation() {
    const f = this.fd, tpl = this.orientationTemplate();
    if (!f) return;
    if (!tpl) { f.oriNone = true; return; }
    if (!f.ori || f.oriKey !== tpl.key) { const n = f.N * f.N; Object.assign(f, { ori: new Float32Array(n), oriQ: new Float32Array(n), oriR: new Float32Array(n), oriX: new Float32Array(n), phase: new Uint8Array(n), diffuse: new Float32Array(n), oriDone: 0, oriKey: tpl.key, oriPeriod: tpl.period, oriNone: false }); }
    const n4 = f.n4, n2 = n4 * n4, rD = (this.S.alpha4d * 1.15e-3) / f.lam / f.dk + 1.5; // the bright-field disk radius in pixels (+ the descan interpolation)
    const diffuseOf = (pat) => { let tot = 0, out = 0; for (let p = 0; p < n2; p++) { const x = (p % n4) - n4 / 2, y = ((p / n4) | 0) - n4 / 2; tot += pat[p]; if (Math.hypot(x, y) > rD) out += pat[p]; } return tot ? out / tot : 0; };
    if (f.vacDiffuse === undefined) { // the bare probe through empty slices, with the same precession: the vacuum level
      const G = f.gridN, one = { re: new Float64Array(G * G).fill(1), im: new Float64Array(G * G) };
      f.vacDiffuse = diffuseOf(KR.fdPatternOnce({ geom: f.geom, slices: Array(f.K).fill(one), prop: f.prop, pr: f.pr, pi: f.pi, ped: f.ped ? { ramps: f.ped.ramps, back: f.ped.back } : undefined }, f.N >> 1, f.N >> 1));
    }
    for (let idx = f.oriDone; idx < f.done; idx++) {
      const pat = f.data.subarray(idx * n2, (idx + 1) * n2), m = KR.matchOrientation(pat, n4, f.dk, tpl);
      f.ori[idx] = m.omega; f.oriQ[idx] = m.Q; f.oriR[idx] = m.reliability; f.oriX[idx] = m.excess; f.diffuse[idx] = diffuseOf(pat);
      // phase: crystal where the template matches well and uniquely, else amorphous (scattering outside the
      // bright-field disk) or vacuum
      // (crystal also needs some scattering: a probe in a hole still sees faint, clean spots from its tails;
      // a graphene monolayer scatters ~1.5·10⁻⁴ outside the disk, vacuum ~2·10⁻⁶)
      const scat = f.diffuse[idx] - f.vacDiffuse;
      f.phase[idx] = scat > 2e-5 && (m.excess > CRYSTAL_EXCESS || (m.excess > 0.35 && m.reliability > 0.15)) ? 2 : scat > 0.004 ? 1 : 0;
    }
    f.oriDone = f.done;
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
  propagate(wr, wi, n, H, back) { KR.propagate(wr, wi, n, H, back); }


  // ------------------------------------------------------------ electron tomography (tomo.js)
  // The phantom is the specimen as the structure viewer builds it (structure.js: atoms, amorphous layers, shells),
  // voxelised in a cube around the field of view, so it works for every built-in specimen and any uploaded XYZ or
  // CIF; or a set of gold test beads. The series is recorded one projection at a time as the holder turns (~8 s
  // of exhibit time), then reconstructed on the compute backend (a worker in the exhibit).
  // this.tomo: { ph, o, angles, ser, collected, running, rec: { x, iter, iterations, resid }, stats }
  tomoParams() {
    const S = this.S, beads = S.tomoPhantom === 'beads';
    const W = ENV.windowsOf(S);
    return { N: S.tomoN, signal: S.tomoSignal, scheme: S.tomoScheme, max: Math.min(S.tomoMax, ENV.maxTilt(S)), step: S.tomoStep, dose: S.tomoDose, jitter: S.tomoJitter, Dc: !beads && this.spec.beamSensitive ? +this.critDose().toFixed(2) : null,
      win: W ? +(W.w.dens * W.total * W.w.z17).toFixed(3) : 0 }; // the windows' Σ Z^1.7 per Å² at 0° (HAADF background, ∝ 1/cos θ)
  }
  buildTomoPhantom() {
    const S = this.S;
    if (S.tomoPhantom === 'beads') { const ph = TOMO.beadPhantom(S.tomoN); ph.name = `gold test beads, ${ph.beads.map((b) => ((2 * b.r * ph.vox) / 10).toFixed(1)).join(', ')} nm, in a carbon film`; return ph; }
    const st = buildStructure(S, this);
    const ph = TOMO.phantomFromStructure(st, S.tomoN);
    ph.name = st.name; ph.notes = st.notes; ph.empty = !ph.vol.some((v) => v > 0);
    return ph;
  }
  tomoRecKey() { const S = this.S; return JSON.stringify([this.tomo?.acqKey, S.tomoRecon, S.tomoRecon === 'sirt' ? S.tomoIter : S.tomoFilter, S.tomoAlign, S.gpu, this.remote?.url ?? null]); }
  stepTomo(dt) {
    const S = this.S, phKey = JSON.stringify([this.spec.zoneKey ?? S.spec, S.tomoPhantom, S.tomoN, ...(S.tomoPhantom === 'beads' ? [] : [S.thick, S.fov, S.cx, S.cy, this.spec.damageVer ?? 0])]);
    let T = this.tomo;
    if (!T || T.phKey !== phKey || T.spec !== this.spec) {
      T?.task?.cancel();
      const ph = this.buildTomoPhantom();
      T = this.tomo = { phKey, spec: this.spec, ph, acqKey: null, preview: TOMO.project(ph.vol, ph.N, 0), collected: 0, running: false, rec: null, recKey: null, task: null };
      this.version++;
    }
    const o = this.tomoParams(), acqKey = JSON.stringify(o);
    if (T.acqKey !== acqKey) { // new acquisition settings: the series and its reconstruction start over
      T.task?.cancel(); Object.assign(T, { task: null, rec: null, recKey: null, stats: null, o, acqKey, collected: 0, running: false });
      T.angles = TOMO.tilts(o.scheme, o.max, o.step);
      T.ser = this.tomoSeries();
      T.pred = TOMO.predictedElongation(o.max);
      this.version++;
    }
    const F = T.angles.length;
    if (T.running && !S.paused) {
      T.collected = Math.min(F, T.collected + (F / 8) * dt * S.speed);
      while (T.ser.proj.length < Math.ceil(T.collected)) TOMO.seriesNext(T.ser);
      if (T.collected >= F) { T.running = false; this.reconstructTomo(); }
      this.version++;
    }
    if (T.running || T.ser.proj.length < F) return;
    if (T.recKey !== this.tomoRecKey()) this.reconstructTomo();
    if (T.task && !T.taskDone) {
      if (T.task.error) { console.warn('compute:', T.task.error, T.task.b?.name === 'lab' ? '(the lab computer failed: running in the browser)' : '(running on the main thread)'); T.labError = T.task.b?.name === 'lab' ? T.task.error : null; T.task = (T.task.b?.name === 'lab' ? this.compute : new InlineBackend()).run(T.job, { out: T.rec }); }
      const before = T.rec.iter, x0 = T.rec.x;
      T.task.pump(S.paused ? 0 : 12);
      if (T.rec.iter !== before || T.rec.x !== x0) { this.tomoStats(); this.version++; }
      if (T.task.finished && !T.task.queue?.length) { T.taskDone = true; T.recMs = now() - T.recT0; }
    }
  }
  // a volume computed elsewhere (a cluster job's result, Tier 3: bundle.js) shown in the tomography viewer, resampled
  // to the nearest volume size the viewer offers; meta: the result's provenance
  importVolume(vol, n, meta = {}) {
    const S = this.S, sizes = [64, 96, 128, 256], N = sizes.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    let x = vol;
    if (N !== n) { // trilinear resampling onto N³
      x = new Float32Array(N ** 3);
      const f = (n - 1) / (N - 1), at = (i, j, k) => vol[Math.min(n - 1, i) + n * (Math.min(n - 1, j) + n * Math.min(n - 1, k))];
      for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const X = i * f, Y = j * f, Z = k * f, i0 = Math.floor(X), j0 = Math.floor(Y), k0 = Math.floor(Z), a = X - i0, b = Y - j0, c = Z - k0;
        x[i + N * (j + N * k)] = (1 - c) * ((1 - b) * ((1 - a) * at(i0, j0, k0) + a * at(i0 + 1, j0, k0)) + b * ((1 - a) * at(i0, j0 + 1, k0) + a * at(i0 + 1, j0 + 1, k0)))
          + c * ((1 - b) * ((1 - a) * at(i0, j0, k0 + 1) + a * at(i0 + 1, j0, k0 + 1)) + b * ((1 - a) * at(i0, j0 + 1, k0 + 1) + a * at(i0 + 1, j0 + 1, k0 + 1)));
      }
    }
    S.tomoN = N;
    if (S.tomoView === 'series') S.tomoView = 'yz';
    this.stepTomo(0);
    const T = this.tomo, pv = meta.provenance ?? {};
    T.task?.cancel();
    Object.assign(T, { task: null, taskDone: true, recMs: (pv.seconds ?? 0) * 1000, imported: { ...meta, n, N }, rec: { x, method: 'imported', iter: 1, iterations: 1, resid: [], device: `imported · ${pv.engine ?? 'cluster'}${pv.host ? ` on ${pv.host}` : ''}` } });
    T.recKey = this.tomoRecKey();
    this.tomoStats();
    this.version++;
    return { N, resampled: N !== n };
  }
  tomoSeries() { const T = this.tomo, o = T.o; return TOMO.seriesInit({ ph: T.ph, angles: T.angles, signal: o.signal, dosePerImage: o.dose / T.angles.length, Dc: o.Dc ?? Infinity, jitter: o.jitter, seed: 7 + (T.runs ?? 0), winBg: o.win * T.ph.vox * T.ph.vox }); }
  // record the series (instant: at once, for scripts, agents and tests)
  startTomo({ instant = false } = {}) {
    this.stepTomo(0);
    const T = this.tomo;
    T.task?.cancel(); T.runs = (T.runs ?? 0) + 1;
    Object.assign(T, { task: null, rec: null, recKey: null, stats: null, collected: 0, running: true, ser: this.tomoSeries() });
    if (instant) { while (TOMO.seriesNext(T.ser)); T.collected = T.angles.length; T.running = false; this.reconstructTomo({ instant: true }); }
    this.version++;
  }
  reconstructTomo({ instant = false } = {}) {
    const T = this.tomo, S = this.S;
    if (!T?.ser || T.ser.proj.length < T.angles.length) return;
    T.task?.cancel();
    let ser = TOMO.seriesData(T.ser);
    if (S.tomoAlign) ser = TOMO.alignCOM(ser);
    T.rec = {}; T.recKey = this.tomoRecKey(); T.taskDone = false; T.stats = null;
    T.job = { kind: 'tomo', method: S.tomoRecon, filter: S.tomoFilter, iterations: S.tomoIter, ser, gpu: S.gpu !== 'off' };
    T.recT0 = now(); T.recMs = null;
    // a lab computer connected for reconstructions (Status → Tier 2, remote.js) takes them; else the browser
    T.task = (instant ? new InlineBackend() : this.remote?.takes('tomo') ? this.remote : this.compute).run(T.job, { out: T.rec });
    if (instant) { while (!T.task.finished) T.task.pump(Infinity); T.taskDone = true; T.recMs = now() - T.recT0; this.tomoStats(); }
    this.version++;
  }
  // quality: correlation with the phantom; for the test beads, the elongation along the beam against the
  // missing-wedge prediction (mean of the two smallest beads, which are close to points)
  tomoStats() {
    const T = this.tomo, x = T?.rec?.x;
    if (!x) return;
    const N = T.ph.N, st = { corr: TOMO.correlation(x, T.ph.vol), pred: T.pred };
    if (T.ph.beads) {
      st.beads = T.ph.beads.map((b) => ({ d_nm: (2 * b.r * T.ph.vox) / 10, ...TOMO.elongation(x, N, b) }));
      st.meas = (st.beads[0].e + st.beads[1].e) / 2;
    }
    T.stats = st;
  }
  // the volume shown: the reconstruction when there is one, else nothing (the series is shown instead)
  tomoVolume() { return this.tomo?.rec?.x ?? null; }
  // the holder angle now: the tilt being recorded (0 outside a series)
  tomoPhi() { const T = this.tomo; return T?.running && T.ser.proj.length ? T.angles[T.ser.proj.length - 1] : 0; }

  // ------------------------------------------------------------ ptychographic tomography preview (ptychotomo.js)
  // A test object (atoms in a 16 Å cube, two of them stacked along the beam) scanned at several tilts; each tilt is
  // reconstructed by MS-ePIE and the slices are fused. Collect runs it on the compute backend (a minute or so).
  // this.pt: { key, o, out (ptychotomo.ptResult snapshots), task, full, done, t0, ms }
  ptParams() { const S = this.S, W = ENV.windowsOf(S); return { kV: S.kV, alpha: S.ptAlpha, tilts: Math.round(S.ptTilts), maxTilt: Math.min(S.ptMax, ENV.maxTilt(S)), dose: S.ptDose, iters: Math.round(S.ptIters), fusion: S.ptFusion, winPhase: W ? +(0.02 * Math.sqrt(W.total / 400)).toFixed(4) : 0 }; }
  stepPT() {
    const o = this.ptParams(), key = JSON.stringify(o);
    let A = this.pt;
    if (!A || A.key !== key) { A?.task?.cancel(); A = this.pt = { key, o, out: {}, task: null, full: false, done: false, truth: PT.phantom(PT.TEST_ATOMS, PT.PT_DEFAULTS.N, PT.PT_DEFAULTS.dx) }; this.version++; }
    if (A.task && !A.done) {
      const before = `${A.out.stage}|${A.out.t}|${(A.out.progress ?? 0).toFixed(2)}`;
      if (A.task.error) { console.warn('compute:', A.task.error, '(running on the main thread)'); A.task = new InlineBackend().run(A.task.job, { out: A.out }); }
      A.task.pump(this.S.paused ? 0 : 12);
      if (`${A.out.stage}|${A.out.t}|${(A.out.progress ?? 0).toFixed(2)}` !== before) this.version++;
      if (A.task.finished && !A.task.queue?.length) { A.done = true; A.ms = now() - A.t0; this.version++; }
    }
  }
  startPT({ instant = false } = {}) {
    this.stepPT();
    const A = this.pt;
    A.task?.cancel();
    Object.assign(A, { out: {}, full: true, done: false, t0: now(), ms: null });
    A.task = (instant ? new InlineBackend() : this.compute).run({ kind: 'ptychotomo', params: A.o }, { out: A.out });
    if (instant) { while (!A.task.finished) A.task.pump(Infinity); A.done = true; A.ms = now() - A.t0; }
    this.version++;
  }

  // ------------------------------------------------------------ single-particle cryo-EM (spa.js)
  // The grid holds one of the test particles (spa.SAMPLES: apoferritin or β-galactosidase) in the ice of the thickness
  // setting. A preview (the first micrograph, its CTF fit and
  // picks) runs as soon as the settings change; Collect runs the whole pipeline on the compute backend: the stack,
  // 2D classes and the two half maps with their FSC. The microscope enters through the voltage, Cs (the corrector),
  // the focal spread and convergence, and the holder through the radiation damage (a warm grid loses detail faster).
  // this.spa: { key, o, out (spa.spaResult snapshots), task, full, t0, ms }
  spaParams() {
    const S = this.S, bin = S.spaBin === 2 ? 2 : 1, cp = 4, sample = SPA.SAMPLES[S.spaSample] ? S.spaSample : 'apo';
    const dmgScale = (P.betaOf(S.kV) / P.betaOf(300)) ** 2 * radiolysisFactor(this.temp(), cp) / radiolysisFactor(95, cp);
    return { sample, count: Math.round(S.spaN), dose: S.spaDose, df: S.spaDf, zpp: !!S.spaZpp, pref: S.spaPref, angErr: S.spaAngErr, N: 64 / bin, px: SPA.SAMPLES[sample].px * bin, mic: 512 / bin,
      kV: S.kV, Cs: this.CsA() / 1e7, focalSpread: this.focalSpread(), conv: this.convTEM(), ice: clamp(S.thick * 10, 130, 3000), dmgScale: +dmgScale.toPrecision(3),
      window: (() => { const W = ENV.windowsOf(S); return W ? { t: W.total, dens: W.w.dens, zeff: W.w.zeff } : null; })() };
  }
  stepSPA() {
    const S = this.S, o = this.spaParams(), key = this.spaKey(o);
    let A = this.spa;
    // the holder's temperature jitters: the damage scale starts things over only when it changes by > 10 %
    if (!A || A.key !== key || Math.abs(Math.log(o.dmgScale / A.o.dmgScale)) > 0.1) { // new settings: a fresh preview (the first micrograph, its CTF fit and picks)
      A?.task?.cancel();
      A = this.spa = { key, o, out: {}, task: null, full: false, runs: A?.runs ?? 0 };
      A.task = this.compute.run({ kind: 'spa', params: { ...o, count: 0, stopAfter: 'pick', seed: 11 } }, { out: A.out });
      this.version++;
    }
    if (A.task && !A.done) {
      const before = `${A.out.stage}|${A.out.made}|${A.out.accepted}`;
      if (A.task.error) { console.warn('compute:', A.task.error, '(running on the main thread)'); A.task = new InlineBackend().run(A.task.job, { out: A.out }); }
      A.task.pump(S.paused ? 0 : 12);
      if (`${A.out.stage}|${A.out.made}|${A.out.accepted}` !== before) this.version++;
      if (A.task.finished && !A.task.queue?.length) { A.done = true; if (A.full) A.ms = now() - A.t0; this.version++; }
    }
  }
  // the environment (environment.js) for engines with their own models: the windows' elastically scattered fraction
  // (diffraction background) and their inelastic t/λ
  envScatter() { return ENV.scatteredFraction(this.S, this.S.kV, this.liq); }
  envTau() { return ENV.inelastic(this.S, this.S.kV, this.liq).reduce((a, c) => a + c.tau, 0); }
  envWindowMass() { const W = ENV.windowsOf(this.S); return W ? W.w.dens * W.total : 0; } // atoms per Å² in the windows
  // ------------------------------------------------------------ the liquid cell (liquid.js)
  // processes (bubbles, gold growth, Brownian motion) advance with the clock; a burst blanks the beam
  liquidNow() {
    const S = this.S, c = LIQ.cellOf(S);
    if (!c) return null;
    const t = ENV.liquidA(S, this.liq), z = LIQ.depthOf(S);
    return { cell: c, tA: t, above: z * t, below: (1 - z) * t };
  }
  stepLiquid(dt) {
    const S = this.S, c = LIQ.cellOf(S);
    if (!c) { if (this.liq) { this.liq = null; if (SP.au.grownBy) { P.regrowGold(0); this.mapCache.clear(); } this.invalidate('env'); } return; }
    this.liq ??= { t: 0, bubbles: [], grow: 0, bx: 0, by: 0, rng: P.mulberry32(4711), shown: 0, grown: 0, burst: null, events: [] };
    const L = this.liq;
    if (c.burst && !L.burst) { // the window gives way: the column protection blanks the beam, the event is logged
      L.burst = { t: L.t, dP_bar: S.lcDP, burst_bar: c.burstP / 1e5 };
      L.events.push({ event: 'burst', ...L.burst });
      S.paused = true;
      this.invalidate('env');
      return;
    }
    if (L.burst || S.paused || !(dt > 0)) return;
    LIQ.step(L, S, S.kV, dt * S.speed, L.rng, this.fovA(), c.thicknessA);
    // refresh the images in place when the cell has visibly changed (bubbles by ~5 Å, motion by 1 Å): at most every
    // 0.4 s, and every 2 s in scanning modes, where a refresh restarts the raster
    const sig = `${L.bubbles.map((b) => `${Math.round(b.x / 20)},${Math.round(b.y / 20)},${Math.round(b.r / 5)}`).join(';')}|${Math.round(L.bx)}|${Math.round(L.by)}`;
    const every = ['stem', '4d', 'eds', 'eels', 'lstem'].includes(S.mode) ? 2 : 0.4;
    if (sig !== L.sig && L.t - L.shown > every) {
      L.shown = L.t; L.sig = sig;
      this.invalidate('damage');
    }
    if (S.spec === 'au' && !S.zone && Math.abs(L.grow - L.grown) >= 0.5) { L.grown = L.grow; P.regrowGold(Math.round(L.grow * 2) / 2); this.mapCache.clear(); this.invalidate('damage'); }
  }
  // the gas (gas.js): images keep e^(−nσL) of their contrast; the scattered electrons spread as a background
  gasContrast(I) {
    const g = ENV.gasNow(this.S, this.temp());
    if (!g) return;
    const A = g.col.transmitted;
    let m = 0;
    for (let i = 0; i < I.length; i++) m += I[i];
    m /= I.length || 1;
    for (let i = 0; i < I.length; i++) I[i] = A * I[i] + (1 - A) * m;
  }
  // diffraction: the gas's elastically scattered share becomes a diffuse halo falling off with angle
  gasDiffuse(I, n, dk) {
    const g = ENV.gasNow(this.S, this.temp());
    if (!g) return;
    const f = 1 - Math.exp(-g.col.tauEl);
    let tot = 0, h = 0;
    for (let i = 0; i < I.length; i++) tot += I[i];
    const halo = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const k = Math.hypot(x - n / 2, y - n / 2) * dk, v = Math.exp(-k / 0.3); halo[y * n + x] = v; h += v; }
    for (let i = 0; i < I.length; i++) I[i] = (1 - f) * I[i] + (f * tot * halo[i]) / (h || 1);
  }
  // gas reactions with the heating chip (gas.js): gold sinters, a perovskite is reduced in H₂ and re-oxidised in O₂;
  // a windowed cell bursts like a liquid cell when the gas pressure exceeds what its windows hold
  stepGas(dt) {
    const S = this.S;
    if (S.envCell !== 'gas') { if (this.gasSt) { this.gasSt = null; if (SP.au.grownBy) { P.regrowGold(0); this.mapCache.clear(); } this.invalidate('env'); } return; }
    this.gasSt ??= { xi: 0, sinter: 0, grown: 0, burst: null, events: [], t: 0 };
    const G = this.gasSt;
    if (S.gcGeom !== 'open' && !G.burst) {
      const Pb = LIQ.burstPressure({ a: (S.lcA / 2) * 1e-6, b: (S.lcB / 2) * 1e-6, t: (S.envWinT ?? 30) * 1e-9 }) / 1e5;
      if (S.gcP / 1000 >= Pb) { G.burst = { t: G.t, p_bar: S.gcP / 1000, burst_bar: Pb }; G.events.push({ event: 'burst', ...G.burst }); S.paused = true; this.invalidate('env'); return; }
    }
    if (G.burst || S.paused || !(dt > 0)) return;
    G.t += dt * S.speed;
    const xi0 = G.xi;
    GAS.react(G, S, this.temp(), dt * S.speed);
    if (Math.abs(G.xi - xi0) > 0.01) this.stale.si = 1, this.stale.eels = 1;
    if (S.spec === 'au' && !S.zone && G.sinter - G.grown >= 0.5) { G.grown = G.sinter; P.regrowGold(Math.round(G.sinter * 2) / 2); this.mapCache.clear(); this.invalidate('damage'); }
  }
  // ------------------------------------------------------------ biasing (bias.js)
  // the chip's operating point, heating, failures and I–V trace advance with the clock; under liquid the electrode
  // potential deposits or dissolves gold
  stepBias(dt) {
    const S = this.S;
    if (!S.bsOn) { if (this.biasSt) { this.biasSt = null; this.invalidate('env'); } return; }
    this.biasSt ??= { t: 0, dT: 0, broken: false, open: false, em: 0, events: [], trace: [], shown: -1, sig: '' };
    const B = this.biasSt;
    // a new source or circuit setting starts a new I–V trace
    const key = [S.bsLayout, S.bsMat, S.bsGap, S.bsMode, S.bsWave, S.bsV, S.bsI, S.bsRate, S.bsLimit, S.bsRc, S.bsRs, S.bsLeak, S.thick].join('|');
    if (key !== B.key) { B.key = key; B.trace = []; }
    if (!(dt > 0) || S.paused) { if (!B.op) BIAS.step(B, S, specimenT(S.holder, S.tempSet, this.clock || 0), 0); return; }
    const ev = B.events.length;
    BIAS.step(B, S, specimenT(S.holder, S.tempSet, this.clock || 0), dt * S.speed);
    if (S.envCell === 'liquid' && this.liq && S.spec === 'au') {
      const ec = BIAS.electrochem(B.op.Vspec, this.temp(), S.lcPrecursor);
      B.echem = ec;
      this.liq.grow = clamp(this.liq.grow + ec.rate * dt * S.speed, -10, 15);
    } else B.echem = null;
    // refresh the views when the field has visibly changed: at most every 0.5 s, every 2 s in scanning modes
    const sig = `${(B.op.Vspec).toPrecision(2)}|${B.broken}|${B.open}|${Math.round(B.dT)}`;
    const every = ['stem', '4d', 'eds', 'eels', 'lstem'].includes(S.mode) ? 2 : 0.5;
    if (B.events.length !== ev || (sig !== B.sig && B.t - B.shown > every)) {
      B.shown = B.t; B.sig = sig;
      this.oah.stale = true; this.lor.stale = true; this.stale.tem = 1;
      if (this.diff) this.resampleDiff();
      if (B.events.length !== ev || Math.abs(B.dT - (B.dTshown ?? 0)) > 5) { B.dTshown = B.dT; this.invalidate('temp'); }
      this.version++;
    }
  }
  resetBias() { this.biasSt = null; this.invalidate('env'); }
  // the bias phase over an n × n grid of dx Å around the stage (rad): C_E [t V + P_vac], with t the film thickness
  // (Å, or a per-pixel map); plane: the best-fit uniform gradient (rad/Å) at the centre, and the residual without it
  biasPhase(n, dx, tA = this.S.thick * 10, { residual = false, tMap = null } = {}) {
    const S = this.S, B = this.biasSt;
    if (!S.bsOn || !B?.op) return null;
    const sol = BIAS.solve(S.bsLayout), g = S.bsGap * 1e4, V = B.op.Vspec, sig = P.sigmaOf(S.kV);
    const vac = S.bsStray ? BIAS.vacuum(sol, tA / g) : null, ph = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const X = (S.cx + (x - n / 2 + 0.5) * dx) / g, Y = (S.cy + (y - n / 2 + 0.5) * dx) / g, i = y * n + x;
      const t = tMap ? tMap[i] : tA;
      ph[i] = sig * V * (t * BIAS.sample(sol, sol.u, X, Y) + (vac ? g * BIAS.sample(sol, vac, X, Y) : 0));
    }
    const gr = this.biasGrad(tA);
    if (residual) {
      let m = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x; ph[i] -= gr[0] * (x - n / 2 + 0.5) * dx + gr[1] * (y - n / 2 + 0.5) * dx; m += ph[i]; }
      m /= n * n; for (let i = 0; i < n * n; i++) ph[i] -= m;
    }
    return { ph, grad: gr };
  }
  // the phase gradient at the beam (rad/Å) and the deflection β = λ∇φ/2π (rad)
  biasGrad(tA = this.S.thick * 10, ox = 0, oy = 0) {
    const S = this.S, B = this.biasSt;
    if (!S.bsOn || !B?.op) return [0, 0];
    const sol = BIAS.solve(S.bsLayout), g = S.bsGap * 1e4, V = B.op.Vspec, sig = P.sigmaOf(S.kV), h = 0.002;
    const vac = S.bsStray ? BIAS.vacuum(sol, tA / g) : null, X = (S.cx + ox) / g, Y = (S.cy + oy) / g;
    const f = (a, b) => tA * BIAS.sample(sol, sol.u, a, b) + (vac ? g * BIAS.sample(sol, vac, a, b) : 0);
    return [(sig * V * (f(X + h, Y) - f(X - h, Y))) / (2 * h * g), (sig * V * (f(X, Y + h) - f(X, Y - h))) / (2 * h * g)];
  }
  biasBeta(tA) { const [gx, gy] = this.biasGrad(tA), k = this.lam / (2 * Math.PI); return [k * gx, k * gy]; }
  resetGas() { if (SP.au.grownBy) P.regrowGold(0); this.gasSt = null; this.mapCache.clear(); this.invalidate('env'); }
  resetLiquid() { if (SP.au.grownBy) P.regrowGold(0); this.liq = null; this.mapCache.clear(); this.invalidate('env'); }
  // TEM: electrons that lost energy in the liquid are blurred by chromatic aberration (their share e^(−t/λ) is
  // not); the liquid below the particle adds a smaller elastic blur (the top–bottom effect)
  liquidTEM(I, n, dx) {
    const L = this.liquidNow();
    if (!L || !(L.tA > 0)) return;
    const b = LIQ.temBlur(L.tA, L.below, this.S.kV, { Cc: (this.S.profile.Cc ?? 1.4) * 1e7, lambdaA: 10 * P.imfp(this.S.kV, 7.4) });
    if (this.S.lcFilter) b.inelasticShare = 0; // an energy filter removes the inelastic electrons
    if (b.inelasticShare > 0) {
      const B = Float32Array.from(I);
      blur(B, n, (b.chromatic * 10) / 2.355 / dx);
      for (let i = 0; i < I.length; i++) I[i] = (1 - b.inelasticShare) * I[i] + b.inelasticShare * B[i];
    }
    if (b.elastic > 0) blur(I, n, (b.elastic * 10) / 2.355 / dx);
  }
  // STEM: the probe broadens in the liquid above the particle
  liquidSTEM(img, n, dx) {
    const L = this.liquidNow();
    if (L && L.above > 0) blur(img, n, (LIQ.stemBlur(L.above, this.S.kV) * 10) / 2.355 / dx);
  }
  spaKey(o = this.spaParams()) { const { dmgScale, ...rest } = o; return JSON.stringify(rest); }
  // collect and process (instant: at once, for scripts, agents and tests)
  startSPA({ instant = false } = {}) {
    this.stepSPA();
    const A = this.spa;
    A.task?.cancel(); A.runs++;
    Object.assign(A, { out: {}, full: true, done: false, t0: now(), ms: null });
    const job = { kind: 'spa', params: { ...A.o, seed: 11 + A.runs } };
    A.task = (instant ? new InlineBackend() : this.compute).run(job, { out: A.out });
    if (instant) { while (!A.task.finished) A.task.pump(Infinity); A.done = true; A.ms = now() - A.t0; }
    this.version++;
  }
  spaRunning() { const A = this.spa; return !!A?.full && !A.done; }

  // ------------------------------------------------------------ multislice ptychography (MS-ePIE / 3PIE)
  // The object is a stack of K slices; the wave is propagated between them in the forward model, and the
  // correction is back-propagated slice by slice, updating each slice's transmission and the wave entering it.
  // (kernels.js msStep) on the compute backend; the display reads this.mpty (slices O, iter, k, errHist)
  startMSPtycho() {
    const f = this.fd;
    this.msTask?.cancel();
    this.mpty = { fd: f };
    this.msJob = { kind: 'msepie', geom: f.geom, pr: f.pr, pi: f.pi, prop: f.prop, seed: 99, dataset: this.fdTask?.id };
    this.msTask = this.compute.run(this.msJob, { data: f.data, out: this.mpty });
  }
  stepMSPtycho(budget) {
    const T = this.mpty;
    if (this.msTask.error) { console.warn('compute:', this.msTask.error, '(running on the main thread)'); this.msTask = new InlineBackend().run(this.msJob, { data: this.fd.data, out: T }); }
    if (T.iter >= T.maxIter || this.msTask.finished && !this.msTask.queue?.length) return false;
    this.msTask.pump(budget);
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
  // (kernels.js epieStep) on the compute backend; the display reads this.pty (re, im, iter, k, errHist)
  startPtycho() {
    const f = this.fd;
    this.ptyTask?.cancel();
    this.pty = { fd: f };
    this.ptyJob = { kind: 'epie', geom: f.geom, pr: f.pr, pi: f.pi, seed: 1234, dataset: this.fdTask?.id };
    this.ptyTask = this.compute.run(this.ptyJob, { data: f.data, out: this.pty });
  }
  stepPtycho(budget) {
    const T = this.pty;
    if (this.ptyTask.error) { console.warn('compute:', this.ptyTask.error, '(running on the main thread)'); this.ptyTask = new InlineBackend().run(this.ptyJob, { data: this.fd.data, out: T }); }
    if (T.iter >= T.maxIter || this.ptyTask.finished && !this.ptyTask.queue?.length) return false;
    this.ptyTask.pump(budget);
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
    const S = this.S, n = 128, dx = this.fovA() / n, spec = this.spec;
    const maps = this.maps({ n, dx, elements: true });
    if (this.stale.probe) this.computeProbe();
    const s = Math.hypot(this.probe.fwhm / 2.355, (this.driftSpeed() * 20) / 3.5) / dx;
    const els = spec.elements.map((e) => { const map = blur(Float32Array.from(maps.elem[e]), n, s); this.scanDistort(map, n); return { idx: e, key: P.EL[e].key || P.EL[e].sym, sym: P.EL[e].sym, map }; });
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
    if (this.gasSt?.xi && compSym.O && S.spec === 'sto') compSym.O *= 1 - 0.15 * this.gasSt.xi; // reduced in H₂: oxygen vacancies (gas.js)
    // the environment's windows: their atoms against the specimen's (atoms per Å² along the beam), as extra lines
    const wa = ENV.windowAtoms(S, this.liq), specAtoms = (si.totN.reduce((a, b) => a + b, 0) / si.totN.length) / (si.dx * si.dx) * 1.45;
    for (const [el, a] of Object.entries(wa)) compSym[el] = (compSym[el] || 0) + a / Math.max(specAtoms, 1e-3);
    let zMean = 0;
    for (const e of si.els) zMean += si.comp[e.key] * P.EL[e.idx].Z;
    const addLine = (E, amp) => {
      const s = P.edsFWHM(E, S.profile.edsFWHM) / 2.355;
      const b0 = Math.max(0, Math.floor((E - 4 * s) / dE)), b1 = Math.min(nb - 1, Math.ceil((E + 4 * s) / dE));
      for (let b = b0; b <= b1; b++) {
        const e = (b + 0.5) * dE;
        spec[b] += (amp * dE * Math.exp(-0.5 * ((e - E) / s) ** 2)) / (s * 2.5066);
      }
    };
    for (const L of P.XRAY) {
      // the copper grid's system peak (a membrane chip on a silicon frame has none)
      if (L.el === 'Cu' && !this.spec.noGrid) addLine(L.E, 0.012 * L.w * P.detEff(L.E));
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

  // the spectrometer: 2048 channels at the chosen dispersion (eV/channel), starting at the energy offset
  eelsRangeBounds() {
    const S = this.S;
    return [S.eelsOffset, S.eelsOffset + EELS_CHANNELS * S.eelsDisp];
  }
  // where the zero-loss peak actually lands: the high voltage and the prism drift slowly (realistic mode)
  zlpShift() { return this.S.clarity === 'real' ? (this.zlpDrift || 0) : 0; }
  // zero-loss width: the source (instrument profile, or a source preset) with the spectrometer (eels.js)
  zlp() { return EELS.zlpParams(this.S.eelsSource, this.S.profile.dE); }
  eelsRes() { return this.zlp().fwhm; }
  eelsDet() { return EELS.detector(this.S.eelsDet); }
  // where the spectrum is taken: the probe at one spectrum-image pixel (S.eelsPx = [i, j]), or the whole field
  eelsSite(px = this.S.eelsPx) {
    const si = this.si;
    if (!px || !si) return { tau: si.tauMean, comp: si.comp, px: null };
    const n = si.n, i = Math.max(0, Math.min(n - 1, px[0] | 0)), j = Math.max(0, Math.min(n - 1, px[1] | 0)), k = j * n + i, comp = {};
    let tot = 0;
    for (const e of si.els) { comp[e.key] = (comp[e.key] || 0) + e.map[k]; tot += e.map[k]; }
    for (const key in comp) comp[key] /= tot || 1;
    return { tau: si.tau[k], comp, px: [i, j] };
  }
  // the single-scattering model for a site: specimen plasmons, the β- and kV-dependent cross-sections, the
  // specimen's own ELNES (with its damage state), plus extra layers from addInelasticComponents (in situ)
  eelsModel(site) {
    const S = this.S, spec = this.spec, zeff = spec.zeff ?? 10, tau = site.tau * EELS.tauBetaFactor(S.kV, zeff, S.eelsBeta), ctx = { q: spec.dmg ?? 0, T: this.temp() };
    const edges = [];
    const oLeft = this.gasSt?.xi && S.spec === 'sto' ? 1 - 0.15 * this.gasSt.xi : 1;
    for (const ed of P.EDGES) { const c = (site.comp[ed.key] ?? 0) * (ed.key === 'O' ? oLeft : 1); if (c) edges.push({ edge: ed, w: tau * c, peaks: spec.elnes?.[ed.key]?.(ctx) }); }
    const m = { tau, plasmons: spec.plasmon, edges, extraLoss: spec.extraLoss ? (E, r) => spec.extraLoss(E, r) : null, kV: S.kV, beta: S.eelsBeta, zlp: this.zlp(), realistic: S.clarity === 'real', bg: { amp: 0.012, s: 3.1 } };
    return EELS.addInelasticComponents(m, [...ENV.inelastic(S, S.kV, this.liq), ...(this.inelastic ?? [])]); // the environment's windows, then any other layers
  }
  // In situ hook (M13–M15): extra inelastic layers in the beam path, e.g. windows, water, gas:
  // [{ label, tau, plasmons: [{Ep, G, frac}], edges: [{ key, frac, name? }] }]
  addInelasticComponents(list = []) { this.inelastic = list; this.stale.eels = 1; }


  // One recorded spectrum on the 2048-channel detector, starting at E0 (eV), with the zero loss shifted by sh:
  // the Fourier-log plural-scattering spectrum (eels.js), integrated over each channel, then the detector's
  // point spread. Values are per eV of spectrum (per incident electron).
  channelSpectrum(E0, sh, site = this.eelsSite()) {
    const r = EELS.buildSpectrum(this.eelsModel(site), { E0, nb: EELS_CHANNELS, dE: this.S.eelsDisp, shift: sh });
    const det = this.eelsDet(), edgeCurves = {};
    for (const k in r.edgeCurves) edgeCurves[k] = EELS.applyPSF(r.edgeCurves[k], det);
    return { spec: EELS.applyPSF(r.spec, det), bgc: EELS.applyPSF(r.bgc, det), edgeCurves, E0, E1: r.E1, dE: r.dE, nb: r.nb };
  }
  // Line scan: spectra at `n` probe positions across the spectrum image, along the probe's row (or the middle),
  // over the energy range [Ea, Eb] at m channels: what a line-scan acquisition records, for the preview strip
  eelsLineScan(Ea, Eb, n = 24, m = 192) {
    const si = this.si;
    if (!si) return null;
    const j = this.S.eelsPx?.[1] ?? (si.n / 2) | 0, key = [this.eelsBuild, Ea.toFixed(2), Eb.toFixed(2), j, n, m].join('|');
    if (this._line?.key === key) return this._line;
    const rows = [], det = this.eelsDet(), sh = this.zlpShift();
    for (let q = 0; q < n; q++) {
      const i = Math.round(((q + 0.5) / n) * (si.n - 1)), r = EELS.buildSpectrum(this.eelsModel(this.eelsSite([i, j])), { E0: Ea, nb: m, dE: (Eb - Ea) / m, shift: sh });
      rows.push(EELS.applyPSF(r.spec, { ...det, psf: det.psf * (m / EELS_CHANNELS) + 0.3 }));
    }
    return (this._line = { key, rows, n, m, Ea, Eb, j, x: rows.map((_, q) => ((q + 0.5) / n) * si.n * si.dx) });
  }
  // electrons per channel in one readout: fraction per channel × beam current × exposure
  readout(spec, t) {
    const k = this.S.eelsDisp * this.S.eelsCurrent * 1e-12 / 1.602e-19 * t, ro = new Float32Array(spec.length);
    const det = this.eelsDet(), g = (this._gain?.det === det && this._gain.g.length === spec.length) ? this._gain.g : (this._gain = { det, g: EELS.gainPattern(spec.length, det) }).g;
    let sat = 0, peak = 0;
    for (let b = 0; b < spec.length; b++) { ro[b] = spec[b] * k * g[b]; if (ro[b] > det.fullWell) sat++; if (ro[b] > peak) peak = ro[b]; }
    return { ro, sat, peak };
  }

  buildEELS(keepAcc = false) {
    const si = this.si, S = this.S, n = si.n;
    const [E0, E1] = this.eelsRangeBounds();
    const nb = EELS_CHANNELS, dE = S.eelsDisp, sh = this.zlpShift(), dual = S.dualEels;
    // single spectrum: drifts with the zero loss. Dual EELS: the core-loss frames are realigned on the
    // simultaneously recorded zero loss, so they do not smear (shift 0), while the low-loss spectrum shows the drift.
    const main = this.channelSpectrum(E0, dual ? 0 : sh);
    const { spec, bgc, edgeCurves } = main;
    const low = dual ? this.channelSpectrum(EELS_LOW_OFFSET, sh) : null;
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
      for (const ed of P.EDGES) edgeW[ed.key] = (edgeW[ed.key] || 0) + EELS.EDGE_SCALE * P.edgeSignal(ed, E, res, real, this.spec.elnes?.[ed.key]?.({ q: this.spec.dmg ?? 0 })) * EELS.crossFactor(E, S.kV, S.eelsBeta) * h;
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
    const ro = this.readout(spec, S.eelsExp), roLow = low ? this.readout(low.spec, S.eelsExpLow) : null;
    this.eelsBuild = (this.eelsBuild || 0) + 1;
    this.eels = {
      spec, bgc, edgeCurves, nb, dE, E0, E1, map, sub, lowLoss, tot, edgeW, shift: sh, zlp: zlpStats(spec, E0, dE), ro,
      low: low ? { ...low, ro: roLow, zlp: zlpStats(low.spec, low.E0, dE), tau: lowTau(low.spec, low.E0, dE) } : null,
    };
    // a drifting zero loss keeps adding to the same recorded spectrum, smearing it, as on a real instrument
    if (!keepAcc || !this.accE || this.accE.spec.length !== nb) this.accE = { t: 0, spec: new Float32Array(nb), map: new Float32Array(n * n), total: 0, frames: 0, ft: 0, low: new Float32Array(nb), framesLow: 0, ftLow: 0 };
  }
  // high-voltage / prism drift of the zero loss: a slow walk of ~0.3 eV per minute (realistic mode)
  zlpStep(dt) {
    if (this.S.clarity !== 'real' || this.S.paused) return;
    this.zlpDrift = (this.zlpDrift || 0) + (0.005 + 0.004 * (Math.random() - 0.5)) * dt * this.S.speed;
    if (this.S.mode === 'eels' && this.eels && Math.abs(this.zlpDrift - this.eels.shift) > Math.max(0.02, this.S.eelsDisp / 2)) { this.buildEELS(true); this.version++; }
  }
  alignZLP() { this.zlpDrift = 0; if (this.si) { this.buildEELS(true); this.version++; } }

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
      // readouts: each frame counts electrons per channel up to the full well (clipped), plus read noise
      const frames = (spec, ro, t, key, nKey, acc) => {
        a[key] += dt;
        const m = Math.min(400, Math.floor(a[key] / t));
        if (!m) return;
        a[key] -= m * t;
        a[nKey] += m;
        const det = this.eelsDet();
        for (let b = 0; b < e.nb; b++) {
          const lam = Math.min(ro[b], det.fullWell) * m, pz = P.poisson(lam);
          const c = lam + (pz - lam) * det.excess + det.read * Math.sqrt(m) * P.gauss(); // shot noise (× the scintillator's excess factor) and read noise
          acc[b] += c; a.total += Math.max(0, c);
        }
      };
      frames(e.spec, e.ro.ro, S.eelsExp, 'ft', 'frames', a.spec);
      if (e.low) frames(e.low.spec, e.low.ro.ro, S.eelsExpLow, 'ftLow', 'framesLow', a.low);
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
    if (S.mode === 'eds' || S.mode === 'eels' || S.mode === 'ilh') return null;
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
    if (!spec.twoD || S.paused) return;
    // hot graphene heals: above ~750 K carbon from the contamination and adatoms fills vacancies
    const T = this.temp();
    if (T > 750 && spec.sputtered > 0) {
      const A = spec.atoms, p = Math.min(1, 0.03 * Math.exp((T - 1000) / 120) * dt * S.speed);
      let healed = 0;
      for (let i = 0; i < A.count; i++) if (A.dead[i] && Math.random() < p) { A.dead[i] = 0; healed++; }
      if (healed) { spec.sputtered = Math.max(0, spec.sputtered - healed); spec.damageVer++; this.invalidate('damage'); this._soft = true; }
    }
    if (!['tem', 'stem'].includes(S.mode)) return;
    const relP = Math.pow(Math.max(0, (S.kV - 86) / 114), 1.5), relE = Math.pow(Math.max(0, (S.kV - 55) / 145), 1.3) * 5;
    const rMax = Math.max(relP, relE);
    if (!rMax) return;
    const A = spec.atoms, half = this.fovA() / 2, ids = [];
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
  // radiolysis: falls as β² at lower voltage; cooling to liquid-nitrogen temperature slows it several-fold
  critDose() { return this.spec.Dc300 * Math.pow(P.betaOf(this.S.kV) / P.betaOf(300), 2) * radiolysisFactor(this.temp(), this.spec.cryoProtect ?? 3); }
  radiolysis(dt) {
    const S = this.S, spec = this.spec;
    if (!spec.beamSensitive || S.paused || S.mode === 'ronch') return;
    this.doseAcc = (this.doseAcc || 0) + S.dose * 0.5 * dt * S.speed;
    // too hot: the framework or the protein decomposes even without the beam (expressed as equivalent dose)
    if (spec.thermalLimit && this.temp() > spec.thermalLimit) this.doseAcc += this.critDose() * 0.08 * Math.exp((this.temp() - spec.thermalLimit) / 40) * dt * S.speed;
    const q = 1 - Math.exp(-this.doseAcc / this.critDose()), qs = Math.round(q * 40) / 40;
    // refresh at most ~3× a second, and never spend more than about a third of the time recomputing the
    // projected specimen (the expensive part, e.g. ~0.3 s for proteins in ice)
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (qs !== spec.dmg && now - (this._dmgT || 0) > Math.max(330, 3 * (this._mapsMs || 0))) { this._dmgT = now; spec.dmg = qs; spec.damageVer++; this.invalidate('damage'); this._soft = true; }
  }
  freshArea() {
    const spec = this.spec;
    this.doseAcc = 0;
    if (spec.beamSensitive) { spec.dmg = 0; spec.damageVer++; this.invalidate('damage'); this.stale.fd = 1; this.stale.si = 1; }
  }
  restoreSpecimen() {
    const spec = this.spec;
    if (spec.reset) { spec.reset(); this.invalidate('damage'); return; }
    if (!spec.atoms.dead) return;
    spec.atoms.dead.fill(0); spec.sputtered = 0; spec.damageVer++;
    this.invalidate('damage');
  }

  // holder: advance the clock, refresh as the drift settles, follow the temperature, and let ice crystallize
  // or sublime when the grid is too warm
  thermalStep(dt) {
    if (this.S.paused) return;
    const t = dt * this.S.speed;
    this.clock = (this.clock || 0) + t;
    const q = Math.round(this.driftSpeed() * 10) / 10;
    if (q !== this._driftQ) { this._driftQ = q; this.invalidate('drift'); this._soft = true; this.oah.stale = true; }
    const th = this.thermal(), tk = `${th.u2r}|${th.eps}`;
    if (tk !== this._thermQ) { const first = this._thermQ === undefined; this._thermQ = tk; if (!first) { this.invalidate('temp'); this._soft = true; } }
    // specimens that change with temperature (bubbles coarsening, phase transitions): the specimen keeps its own
    // state and says when it looks different; refresh at most ~3× a second, as for beam damage
    const spec = this.spec;
    if (spec.evolve?.(th.T, t)) this._evolved = true;
    if (this._evolved) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - (this._evT || 0) > Math.max(330, 3 * (this._mapsMs || 0))) {
        this._evT = now; this._evolved = false;
        spec.damageVer = (spec.damageVer ?? 0) + 1; this.invalidate('damage'); this._soft = true;
        if (this.cbed) this.cbed.stale = true;
      }
    }
    if (this.spec.bio) {
      const T = th.T;
      if (T > DEVITRIFY_K && !this.devitrified) { this.devitrified = true; this.invalidate('damage'); this._soft = true; }
      const loss = iceSublimation(T) * t;
      if (loss > 0) {
        const before = Math.round(this.ice().t / 10);
        this.iceLoss = Math.min(this.S.thick, (this.iceLoss || 0) + loss);
        if (Math.round(this.ice().t / 10) !== before) { this.invalidate('damage'); this._soft = true; }
      }
    }
  }
  // a new grid: fresh vitreous ice, nothing sublimed, and the holder drifts again after insertion
  newGrid() {
    this.iceLoss = 0; this.devitrified = false; this.freshArea();
    this.kickDrift(HOLDERS[this.S.holder]?.kick ?? 0, true);
  }
  // blur along the drift direction during one exposure (TEM 1 s; a direct detector's motion-corrected movie
  // leaves ~10 % of it)
  motionBlur(I, n, dx, frac = 1, tExp = 1) {
    const L = (this.driftSpeed() * tExp * frac) / dx;
    if (L < 0.3) return;
    const [ux, uy] = this.driftDir(), K = Math.min(24, Math.ceil(L * 2) + 1), src = Float32Array.from(I);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let v = 0;
        for (let k = 0; k < K; k++) {
          const t = (k / (K - 1) - 0.5) * L, xs = clamp(Math.round(x + ux * t), 0, n - 1), ys = clamp(Math.round(y + uy * t), 0, n - 1);
          v += src[ys * n + xs];
        }
        I[y * n + x] = v / K;
      }
  }

  // STEM scan calibration: the y pixel size differs from x by scanAspect, and the axes are sheared by
  // scanShear (non-orthogonal or mis-scaled scan coils). Image pixel (x, y) shows the specimen at (x + y·tanγ, y·a).
  scanDistort(img, n) {
    const a = this.S.profile.scanAspect, t = Math.tan((this.S.profile.scanShear * Math.PI) / 180);
    if (Math.abs(a - 1) < 1e-4 && Math.abs(t) < 1e-4) return;
    const src = Float32Array.from(img), c = n / 2;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = clamp(c + (x - c) + t * (y - c), 0, n - 1.001), fy = clamp(c + a * (y - c), 0, n - 1.001), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
        img[y * n + x] = (src[y0 * n + x0] * (1 - ax) + src[y0 * n + x0 + 1] * ax) * (1 - ay) + (src[(y0 + 1) * n + x0] * (1 - ax) + src[(y0 + 1) * n + x0 + 1] * ax) * ay;
      }
  }
  // a scanned frame takes ~2.4 s; the specimen drifts while the rows are recorded, shearing the image
  scanDrift(img, n, dx, tFrame = 2.4) {
    const v = this.driftSpeed() / dx;
    if (v * tFrame < 0.3) return;
    const [ux, uy] = this.driftDir(), src = Float32Array.from(img);
    for (let y = 0; y < n; y++) {
      const t = (y / n) * tFrame, sx = ux * v * t, sy = uy * v * t;
      for (let x = 0; x < n; x++) {
        const fx = clamp(x + sx, 0, n - 1.001), fy = clamp(y + sy, 0, n - 1.001), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
        img[y * n + x] = (src[y0 * n + x0] * (1 - ax) + src[y0 * n + x0 + 1] * ax) * (1 - ay) + (src[(y0 + 1) * n + x0] * (1 - ax) + src[(y0 + 1) * n + x0 + 1] * ax) * ay;
      }
    }
  }

  // ------------------------------------------------------------ in situ movies (insitu.js)
  // A movie records in simulated time: each update is one frame interval 1/fps. At each frame the timeline sets the
  // environment, the processes advance, the specimen drifts by the holder's drift (plus thermal drift while the
  // temperature ramps), and the frame is kept with its time, environment and true drift.
  startMovie() {
    const S = this.S, plan = INSITU.moviePlan(S.movDur, S.movFps);
    const base = Object.fromEntries(Object.keys(INSITU.QUANTITIES).map((k) => [k, S[k]]));
    this.movie = { plan, base, timeline: JSON.parse(JSON.stringify(S.timeline ?? [])), k: 0, rec: true, mode: S.mode, frames: [], meta: [], shape: null };
    this.driftPos ??= [0, 0];
    this.movie.drift0 = [...this.driftPos];
    S.paused = false;
  }
  stopMovie() { if (this.movie) { this.movie.rec = false; this.rampDrift = 0; } }
  discardMovie() { this.movie = null; this.driftPos = [0, 0]; this.rampDrift = 0; this.mapCache.clear(); this.invalidate('drift'); }
  // before a frame: the timeline's values, the drift step, and the images to recompute; returns the frame's dt
  movieBefore() {
    const M = this.movie, S = this.S, p = M.plan, t = M.k * p.dt;
    const env = INSITU.envAt(M.timeline, t, M.base);
    for (const [k, v] of Object.entries(env)) if (M.timeline.some((s) => s.key === k) && S[k] !== v) { S[k] = v; if (k !== 'tempSet') this.invalidate(k); }
    this.rampDrift = S.holder !== 'room' ? INSITU.DRIFT_PER_KS * Math.abs(INSITU.rateAt(M.timeline, 'tempSet', t, M.base.tempSet)) : 0;
    if (M.k > 0) { const [ux, uy] = this.driftDir(), v = this.driftSpeed() * p.dt; this.driftPos[0] += ux * v; this.driftPos[1] += uy * v; }
    M.keep = M.k % p.every === 0;
    if (M.keep) { for (const k of ['tem', 'stem', 'diff']) this.stale[k] = 1; this.oah.stale = true; this.lor.stale = true; }
    return M.k > 0 ? p.dt : 0;
  }
  movieAfter() {
    const M = this.movie, S = this.S, p = M.plan;
    if (M.keep && this.main?.arr) {
      M.shape ??= [this.main.h, this.main.w];
      M.frames.push(Float32Array.from(this.main.arr));
      const env = Object.fromEntries(Object.keys(INSITU.QUANTITIES).map((k) => [k, S[k]]));
      M.meta.push({ frame: M.k, t: +(M.k * p.dt).toFixed(6), T_K: this.temp(), ...env, drift_A: [this.driftPos[0] - M.drift0[0], this.driftPos[1] - M.drift0[1]], drift_speed_A_s: this.driftSpeed(),
        ...(this.biasSt?.op ? { V_specimen: this.biasSt.op.Vspec, I_A: this.biasSt.op.I } : {}) });
    }
    M.k++;
    if (M.k >= p.frames) this.stopMovie();
  }

  update(dt) {
    const rec = this.movie?.rec && !this.S.paused;
    if (rec) dt = this.movieBefore() / (this.S.speed || 1);
    this.sputter(dt);
    this.radiolysis(dt);
    this.thermalStep(dt);
    this.zlpStep(dt);
    const S = this.S, m = S.mode;
    if (this.stale.probe && needsProbe(m)) { this.computeProbe(); this.stale.probe = 0; }
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
      else if (this.diffDisp && this._camL !== `${this.camLTrue()}|${this.lam}|${S.profile.ellip}|${S.profile.ellipAng}`) { this.resampleDiff(); this.version++; }
      this._camL = `${this.camLTrue()}|${this.lam}|${S.profile.ellip}|${S.profile.ellipAng}`;
    }
    if (m === '4d') {
      if (this.stale.fd) { this.start4D(); this.stale.fd = 0; }
      const prev = this.fd.done;
      if (this.step4D(S.paused ? 0 : 7 * Math.min(2, Math.max(0.25, S.speed)))) this.version++;
      if (this.stale.vimg) { this.computeVirtual(0); this.stale.vimg = 0; this.version++; }
      else if (this.fd.done !== prev) this.computeVirtual(this.fd.vDone);
      if ((S.vdet === 'orient' || S.vdet === 'phase') && this.fd.oriDone !== this.fd.done) { this.computeOrientation(); this.version++; }
      if (S.vdet === 'mptycho' && this.fd.done === this.fd.N * this.fd.N) {
        if (!this.mpty || this.mpty.fd !== this.fd) this.startMSPtycho();
        if (this.stepMSPtycho(S.paused ? 0 : 11 * Math.min(2, Math.max(0.3, S.speed)))) this.version++;
      }
      if (S.vdet === 'ptycho' && this.fd.done === this.fd.N * this.fd.N) {
        if (!this.pty || this.pty.fd !== this.fd) this.startPtycho();
        if (this.stepPtycho(S.paused ? 0 : 9 * Math.min(2, Math.max(0.3, S.speed)))) this.version++;
      }
    }
    if (m === 'eds' || m === 'eels') {
      if (this.stale.si) { this.computeSI(); this.stale.si = 0; this.version++; }
      if (m === 'eels' && this.stale.eels) { this.buildEELS(); this.stale.eels = 0; this.version++; }
      if (!S.paused) this.accumulate(dt * S.speed);
    }
    if (m === 'ed3d') this.stepED3D(dt);
    if (m === 'tomo') this.stepTomo(dt);
    if (m === 'spa') this.stepSPA();
    if (m === 'ptychotomo') this.stepPT();
    this.stepLiquid(dt);
    this.stepGas(dt);
    this.stepBias(dt);
    if (m === 'oah' && this.oah.stale) { this.oah.compute(); this.version++; }
    if (m === 'oah') this.main = this.oah.disp ? { arr: this.oah.disp.holo, w: this.oah.disp.c, h: this.oah.disp.c } : null;
    if (m === 'ilh') {
      if (this.ilh.stale) { this.ilh.start(); this.version++; }
      if (this.ilh.step(dt)) this.version++;
      this.main = null;
    }
    if ((m === 'ltem' || m === 'lstem') && this.lor.stale) { this.lor.compute(); this.version++; }
    if (m === 'ltem' || m === 'lstem') { const d = this.lor.disp; this.main = d?.I ? { arr: d.I, w: d.n, h: d.n } : null; }
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
    if (rec) this.movieAfter();
  }
}
