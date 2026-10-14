// Calibrate the twin from measured data.
//  • fitCTF: Thon rings in the power spectrum of an image of a thin amorphous film → defocus and
//    two-fold astigmatism (given voltage, Cs and pixel size), in the spirit of CTFFIND/Gctf.
//  • fitZLP: full width at half maximum of the EELS zero-loss peak → the gun's energy spread.
import * as P from './physics.js';
import { readNpy } from './npy.js';

// ---------------------------------------------------------------- file readers
export async function readImageFile(file) {
  const name = file.name.toLowerCase(), buf = await file.arrayBuffer();
  if (name.endsWith('.npy')) {
    const { data, shape } = readNpy(buf);
    if (shape.length < 2) throw new Error('expected a 2D array');
    const h = shape[shape.length - 2], w = shape[shape.length - 1];
    return { data: data.subarray(0, w * h), w, h, kind: 'npy' };
  }
  if (name.endsWith('.mrc') || name.endsWith('.mrcs') || name.endsWith('.map')) return readMrc(buf);
  const bmp = await createImageBitmap(new Blob([buf]));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0);
  const px = x.getImageData(0, 0, c.width, c.height).data, data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
  return { data, w: c.width, h: c.height, kind: 'image', note: '8-bit image: fine for Thon rings, but raw data (.mrc, .npy) is better' };
}

// MRC/CCP4 (cryo-EM's standard format): first section of the stack; modes 0, 1, 2, 6, 12.
export function readMrc(buf) {
  const dv = new DataView(buf), nx = dv.getInt32(0, true), ny = dv.getInt32(4, true), mode = dv.getInt32(12, true);
  const ext = dv.getInt32(92, true), off = 1024 + ext, n = nx * ny;
  const T = { 0: Int8Array, 1: Int16Array, 2: Float32Array, 6: Uint16Array }[mode];
  if (!(nx > 0 && ny > 0) || (!T && mode !== 12)) throw new Error(`unsupported MRC (mode ${mode})`);
  let data;
  if (mode === 12) { // float16
    data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = f16(dv.getUint16(off + 2 * i, true));
  } else data = Float32Array.from(new T(buf.slice(off, off + n * T.BYTES_PER_ELEMENT)));
  const xlen = dv.getFloat32(40, true), mx = dv.getInt32(28, true);
  return { data, w: nx, h: ny, kind: 'mrc', pixA: xlen > 0 && mx > 0 ? xlen / mx : null };
}
function f16(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
}

// Two columns (energy, counts) or one column of counts, separated by commas, tabs or spaces.
export function parseSpectrum(text, dispersion = 0.05) {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[#%a-df-z]/i.test(l)).map((l) => l.split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v)));
  const two = rows.filter((r) => r.length >= 2).length > rows.length / 2;
  const E = [], I = [];
  rows.forEach((r, i) => { if (two && r.length >= 2) { E.push(r[0]); I.push(r[1]); } else if (!two && r.length) { E.push(i * dispersion); I.push(r[0]); } });
  if (E.length < 16) throw new Error('need at least 16 spectrum channels');
  return { E: Float64Array.from(E), I: Float64Array.from(I) };
}

// ---------------------------------------------------------------- Thon-ring (CTF) fit
// Average power spectrum of overlapping windowed tiles (Welch), centered, B×B.
export function powerSpectrum(img, w, h, B) {
  const step = B / 2, xs = [], ys = [];
  for (let y = 0; y + B <= h; y += step) ys.push(y);
  for (let x = 0; x + B <= w; x += step) xs.push(x);
  const pos = [];
  for (const y of ys) for (const x of xs) pos.push([x, y]);
  const pick = pos.length > 64 ? pos.filter((_, i) => i % Math.ceil(pos.length / 64) === 0) : pos;
  const PS = new Float64Array(B * B), re = new Float64Array(B * B), im = new Float64Array(B * B);
  const win = new Float64Array(B);
  for (let i = 0; i < B; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / B);
  for (const [x0, y0] of pick) {
    let mean = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) mean += img[(y0 + y) * w + x0 + x];
    mean /= B * B;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { re[y * B + x] = (img[(y0 + y) * w + x0 + x] - mean) * win[x] * win[y]; im[y * B + x] = 0; }
    P.fft2(re, im, B);
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      const i = y * B + x, j = ((y + B / 2) % B) * B + ((x + B / 2) % B);
      PS[j] += re[i] * re[i] + im[i] * im[i];
    }
  }
  return { PS, tiles: pick.length };
}

export function fitCTF(img, w, h, { pixA, kV, CsA }) {
  const B = Math.min(512, 2 ** Math.floor(Math.log2(Math.min(w, h))));
  if (B < 64) throw new Error('image too small (needs at least 64×64 pixels)');
  const lam = P.wavelength(kV), { PS, tiles } = powerSpectrum(img, w, h, B), c = B / 2, dk = 1 / (B * pixA);
  const L = new Float64Array(B * B);
  for (let i = 0; i < B * B; i++) L[i] = Math.log(PS[i] + 1e-30);
  // smooth radial background (moving average of the rotational average), subtracted to leave the rings
  const R = c, prof = new Float64Array(R + 1), cnt = new Float64Array(R + 1);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const r = Math.round(Math.hypot(x - c, y - c)); if (r <= R) { prof[r] += L[y * B + x]; cnt[r]++; } }
  for (let r = 0; r <= R; r++) prof[r] /= cnt[r] || 1;
  const hw = Math.max(3, Math.round(B / 28)), bg = new Float64Array(R + 1);
  for (let r = 0; r <= R; r++) { let s = 0, n = 0; for (let q = Math.max(1, r - hw); q <= Math.min(R, r + hw); q++) { s += prof[q]; n++; } bg[r] = s / n; }
  const bgAt = (r) => { const r0 = Math.min(R - 1, Math.floor(r)), f = r - r0; return bg[r0] * (1 - f) + bg[r0 + 1] * f; };
  const rmin = Math.max(4, Math.round(B / 40)), rmax = Math.round(0.85 * c);
  // pixels in the fitting annulus (subsampled so a fit stays well under a second)
  const kx = [], ky = [], D = [], stride = B > 256 ? 2 : 1;
  for (let y = 0; y < B; y += stride) for (let x = 0; x < B; x += stride) {
    const r = Math.hypot(x - c, y - c);
    if (r < rmin || r > rmax) continue;
    kx.push((x - c) * dk); ky.push((y - c) * dk); D.push(L[y * B + x] - bgAt(r));
  }
  const Dn = normalize(Float64Array.from(D)), n = Dn.length;
  const ab = (a1x, a1y) => ({ A1: Math.hypot(a1x, a1y), A1a: (Math.atan2(a1y, a1x) * 90) / Math.PI, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 });
  const score2D = (df, a1x, a1y) => {
    const a = ab(a1x, a1y);
    let s = 0, m2 = 0, sm = 0;
    for (let i = 0; i < n; i++) { const m = -Math.cos(2 * P.chiFull(kx[i], ky[i], lam, df, CsA, a)); s += Dn[i] * m; m2 += m * m; sm += m; }
    return s / Math.sqrt(Math.max(1e-12, m2 - (sm * sm) / n) * n);
  };
  // 1) defocus only, on the rotational average: geometric grid over 2 nm – 8 µm, both signs
  const rProf = [];
  for (let r = rmin; r <= rmax; r++) rProf.push([r * dk, prof[r] - bg[r]]);
  const pr = normalize(Float64Array.from(rProf.map((p) => p[1])));
  const score1D = (df) => { let s = 0, m2 = 0, sm = 0; rProf.forEach(([k], i) => { const m = -Math.cos(2 * P.chi(k * k, lam, df, CsA)); s += pr[i] * m; m2 += m * m; sm += m; }); return s / Math.sqrt(Math.max(1e-12, m2 - (sm * sm) / pr.length) * pr.length); };
  const cand = [];
  for (let i = 0; i <= 500; i++) { const a = 20 * Math.pow(80000 / 20, i / 500); for (const df of [-a, a]) cand.push([score1D(df), df]); }
  cand.sort((p, q) => q[0] - p[0]);
  const starts = [];
  for (const [, df] of cand) { if (starts.length >= 3) break; if (starts.every((s) => Math.abs(s - df) > 0.15 * Math.abs(s) + 30)) starts.push(df); }
  // 2) refine defocus and astigmatism together (pattern search on df, A1·cos2φ, A1·sin2φ)
  let best = null;
  for (const df0 of starts) {
    let p = [df0, 0, 0], f = score2D(...p), st = [0.04 * Math.abs(df0) + 20, 0.04 * Math.abs(df0) + 20, 0.04 * Math.abs(df0) + 20];
    for (let it = 0; it < 160 && st[0] > 0.5; it++) {
      let moved = false;
      for (let d = 0; d < 3; d++) for (const sg of [1, -1]) {
        const q = [...p]; q[d] += sg * st[d];
        const g = score2D(...q);
        if (g > f) { f = g; p = q; moved = true; }
      }
      if (!moved) st = st.map((v) => v / 2);
    }
    if (!best || f > best.score) best = { score: f, df: p[0], a1x: p[1], a1y: p[2] };
  }
  const a = ab(best.a1x, best.a1y);
  // fit resolution: highest frequency up to which the rings still match (shell correlation > 0.25)
  const shells = 24, sc = new Float64Array(shells), sd = new Float64Array(shells), sm2 = new Float64Array(shells), sdm = new Float64Array(shells), sn = new Float64Array(shells);
  for (let i = 0; i < n; i++) {
    const k = Math.hypot(kx[i], ky[i]), b = Math.min(shells - 1, Math.floor(((k / dk - rmin) / (rmax - rmin)) * shells));
    const m = -Math.cos(2 * P.chiFull(kx[i], ky[i], lam, best.df, CsA, a));
    sc[b] += Dn[i] * m; sd[b] += Dn[i] * Dn[i]; sm2[b] += m * m; sdm[b] += Dn[i]; sn[b]++;
  }
  let fitK = rmin * dk;
  for (let b = 0; b < shells; b++) {
    const corr = sc[b] / Math.sqrt(Math.max(1e-12, sd[b] * sm2[b]));
    if (corr < 0.25 && b > 2) break;
    fitK = (rmin + ((b + 1) / shells) * (rmax - rmin)) * dk;
  }
  // display: measured (background-subtracted) and fitted spectra, and the rotational averages
  const meas = new Float32Array(B * B), model = new Float32Array(B * B);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const r = Math.hypot(x - c, y - c), i = y * B + x;
    meas[i] = r < 2 ? 0 : L[i] - bgAt(Math.min(R - 1, r));
    model[i] = r < rmin ? 0 : -Math.cos(2 * P.chiFull((x - c) * dk, (y - c) * dk, lam, best.df, CsA, a));
  }
  return {
    B, tiles, dk, rmin, rmax, df: best.df, A1: a.A1, A1a: ((a.A1a % 180) + 180) % 180, score: best.score, fitRes: 1 / fitK,
    nyquist: 2 * pixA, meas, model, profile: rProf.map(([k], i) => [k, pr[i]]),
    modelProfile: rProf.map(([k]) => [k, -Math.cos(2 * P.chi(k * k, lam, best.df, CsA))]),
  };
}

function normalize(a) {
  let m = 0, s = 0;
  for (const v of a) m += v;
  m /= a.length;
  for (let i = 0; i < a.length; i++) { a[i] -= m; s += a[i] * a[i]; }
  s = Math.sqrt(s / a.length) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= s;
  return a;
}

// ---------------------------------------------------------------- energy spread from the zero-loss peak
export function fitZLP(E, I) {
  let k = 0;
  for (let i = 1; i < I.length; i++) if (I[i] > I[k]) k = i;
  const sorted = Float64Array.from(I).sort(), base = sorted[Math.floor(0.05 * sorted.length)];
  const half = base + (I[k] - base) / 2;
  let l = k, r = k;
  while (l > 0 && I[l] > half) l--;
  while (r < I.length - 1 && I[r] > half) r++;
  if (l === 0 || r === I.length - 1) throw new Error('the peak runs off the end of the spectrum');
  const xl = E[l] + ((half - I[l]) / (I[l + 1] - I[l])) * (E[l + 1] - E[l]);
  const xr = E[r - 1] + ((half - I[r - 1]) / (I[r] - I[r - 1])) * (E[r] - E[r - 1]);
  return { fwhm: Math.abs(xr - xl), center: E[k], channel: Math.abs(E[1] - E[0]), lo: xl, hi: xr };
}
