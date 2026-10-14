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

// ---------------------------------------------------------------- shared: zero-padded power spectrum of one window
function paddedPS(img, w, h) {
  const m = 2 ** Math.floor(Math.log2(Math.min(w, h, 1024))), B = Math.min(2048, 2 * m);
  const x0 = Math.floor((w - m) / 2), y0 = Math.floor((h - m) / 2);
  const re = new Float64Array(B * B), im = new Float64Array(B * B), win = new Float64Array(m);
  for (let i = 0; i < m; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / m);
  let mean = 0;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) mean += img[(y0 + y) * w + x0 + x];
  mean /= m * m;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) re[y * B + x] = (img[(y0 + y) * w + x0 + x] - mean) * win[x] * win[y];
  P.fft2(re, im, B);
  const PS = new Float64Array(B * B);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const i = y * B + x, j = ((y + B / 2) % B) * B + ((x + B / 2) % B);
    PS[j] = re[i] * re[i] + im[i] * im[i];
  }
  return { PS, B, m };
}
// sub-pixel peak position by fitting a parabola through the 3 × 3 neighborhood (on log intensity)
function subpix(A, B, x, y) {
  const L = (xx, yy) => Math.log(A[yy * B + xx] + 1e-30);
  const dx = (L(x + 1, y) - L(x - 1, y)) / (2 * (2 * L(x, y) - L(x + 1, y) - L(x - 1, y)) || 1);
  const dy = (L(x, y + 1) - L(x, y - 1)) / (2 * (2 * L(x, y) - L(x, y + 1) - L(x, y - 1)) || 1);
  return [x + Math.max(-0.5, Math.min(0.5, dx)), y + Math.max(-0.5, Math.min(0.5, dy))];
}

// ---------------------------------------------------------------- lattice image → magnification and scan distortion
// Bragg peaks in the image's power spectrum at a known spacing d give the true pixel size. With a square or
// hexagonal lattice, comparing the peaks in different directions also gives the scan's aspect and shear
// (STEM): for n peak directions spread evenly, Σ g·gᵀ = (n/2)/d² · I in the specimen frame, so the
// measured Σ k·kᵀ = magCal²·Qᵀ·Σ g·gᵀ·Q reveals Q = [[1, tanγ], [0, aspect]].
export function fitLattice(img, w, h, { pixA, d, lattice = 'square' }) {
  const { PS, B, m } = paddedPS(img, w, h), c = B / 2, dk = 1 / (B * pixA), r0 = 1 / d / dk;
  if (r0 < 6) throw new Error(`a ${d} Å spacing is only ${r0.toFixed(1)} pixels from the center of the spectrum: use a larger image or higher magnification`);
  if (r0 > 0.9 * c) throw new Error(`a ${d} Å spacing is beyond Nyquist at ${pixA} Å/pixel`);
  // background: rotational average, so peaks are judged against their own radius
  const prof = new Float64Array(c + 2), cnt = new Float64Array(c + 2);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const r = Math.round(Math.hypot(x - c, y - c)); if (r <= c) { prof[r] += PS[y * B + x]; cnt[r]++; } }
  for (let r = 0; r <= c; r++) prof[r] = prof[r] / (cnt[r] || 1) + 1e-30;
  const peaks = [];
  for (let y = 2; y < B - 2; y++) for (let x = 2; x < B - 2; x++) {
    const r = Math.hypot(x - c, y - c);
    if (r < 0.8 * r0 || r > 1.2 * r0) continue;
    const v = PS[y * B + x];
    let isMax = true;
    for (let j = -2; j <= 2 && isMax; j++) for (let i = -2; i <= 2; i++) if ((i || j) && PS[(y + j) * B + x + i] >= v) { isMax = false; break; }
    if (isMax) peaks.push({ x, y, s: v / prof[Math.round(r)] });
  }
  peaks.sort((a, b) => b.s - a.s);
  // keep strong peaks, one per ± pair (directions folded into [0°, 180°))
  const dirs = [];
  for (const p of peaks) {
    if (p.s < 5 || dirs.length >= 8) break;
    const [sx, sy] = subpix(PS, B, p.x, p.y), kx = (sx - c) * dk, ky = (sy - c) * dk;
    let ang = (Math.atan2(ky, kx) * 180) / Math.PI;
    const fold = ang < 0 || ang >= 180;
    if (fold) ang = (ang + 360) % 180;
    if (dirs.some((q) => Math.min(Math.abs(q.ang - ang), 180 - Math.abs(q.ang - ang)) < 12)) continue;
    dirs.push({ ang, kx: fold ? -kx : kx, ky: fold ? -ky : ky, snr: p.s });
  }
  if (dirs.length < 2) throw new Error(`found ${dirs.length} lattice peak${dirs.length === 1 ? '' : 's'} near ${d} Å; need two directions (check the spacing and pixel size)`);
  // In the specimen, every peak of the family has |g| = 1/d, and neighboring directions are 90° (square) or
  // 60° (hexagonal) apart. With G = (magCal²·QᵀQ)⁻¹ these read kᵢᵀ·G·kᵢ = 1/d² and kᵢᵀ·G·kⱼ = cos θᵢⱼ/d²,
  // linear in G's three entries; then N = G⁻¹ = magCal²·[[1, t], [t, t² + a²]].
  const th0 = lattice === 'hex' ? 60 : 90, used = [dirs[0]];
  if (lattice === 'any') used.push(...dirs.slice(1));
  else for (const g of dirs.slice(1)) {
    const da = Math.abs(((g.ang - dirs[0].ang + 540) % 180)), dd = Math.min(da, 180 - da);
    if (used.length < (lattice === 'hex' ? 3 : 2) && used.every((u) => { const x = Math.abs(((g.ang - u.ang + 540) % 180)); const y = Math.min(x, 180 - x); return Math.abs(y - th0) < 15 || Math.abs(y - 2 * th0 % 180) < 15; }) && Math.abs(dd - th0) < 15 + (lattice === 'hex' ? 60 : 0)) used.push(g);
  }
  if (used.length < 2) throw new Error(`found only one ${lattice === 'any' ? '' : `${lattice} `}lattice direction near ${d} Å`);
  const rows = [], rhs = [];
  for (let i = 0; i < used.length; i++) for (let j = i; j < used.length; j++) {
    const a1 = used[i], a2 = used[j];
    if (i !== j && lattice === 'any') continue; // unknown angle: only the length conditions
    const f = [a1.kx * a2.kx, a1.kx * a2.ky + a1.ky * a2.kx, a1.ky * a2.ky];
    let c = 1;
    if (i !== j) { const x = Math.abs(((a2.ang - a1.ang + 540) % 180)), y = Math.min(x, 180 - x); c = Math.cos((Math.round(y / th0) * th0 * Math.PI) / 180); }
    rows.push(f); rhs.push(c / (d * d));
  }
  let magCal, sh = 0, aspect = 1;
  if (rows.length >= 3) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    rows.forEach((f, r) => { for (let i = 0; i < 3; i++) { v[i] += f[i] * rhs[r]; for (let j = 0; j < 3; j++) M[i][j] += f[i] * f[j]; } });
    const [g11, g12, g22] = solve3(M, v), det = g11 * g22 - g12 * g12;
    const n11 = g22 / det, n12 = -g12 / det, n22 = g11 / det;
    magCal = Math.sqrt(n11); sh = n12 / n11; aspect = Math.sqrt(Math.max(1e-6, n22 / n11 - sh * sh));
  } else magCal = (used.reduce((a, g) => a + Math.hypot(g.kx, g.ky), 0) / used.length) * d;
  dirs.used = used.length;
  const meanK = dirs.reduce((a, g) => a + Math.hypot(g.kx, g.ky), 0) / dirs.length;
  return {
    B, m, dk, r0, dirs, magCal, aspect, shear: (Math.atan(sh) * 180) / Math.PI,
    // isotropic estimate (TEM): mean peak radius against 1/d
    magIso: meanK * d, spread: Math.max(...dirs.map((g) => Math.hypot(g.kx, g.ky))) / Math.min(...dirs.map((g) => Math.hypot(g.kx, g.ky))) - 1,
    ps: logDisplay(PS, B, Math.min(c, Math.round(1.6 * r0))),
  };
}
function logDisplay(PS, B, R) { // central crop of the log power spectrum, for display
  const n = 2 * R, out = new Float32Array(n * n), c = B / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = Math.log(PS[(c - R + y) * B + c - R + x] + 1e-30);
  return { arr: out, n };
}

// ---------------------------------------------------------------- ring pattern → camera length and ellipticity
export const STANDARDS = {
  Au: { name: 'Gold (fcc, a = 4.078 Å)', d: [2.355, 2.039, 1.442, 1.230, 1.177, 1.019] },
  Al: { name: 'Aluminum (fcc, a = 4.049 Å)', d: [2.338, 2.025, 1.432, 1.221, 1.169] },
  Si: { name: 'Silicon (diamond, a = 5.431 Å)', d: [3.135, 1.920, 1.638, 1.358, 1.246] },
};
export function fitRings(img, w, h, { pixMM, Lnom, kV, d }) {
  const lam = P.wavelength(kV);
  // center: intensity-weighted centroid of the brightest 1 % of pixels outside the central 3 % (beam stop)
  const sorted = Float32Array.from(img).sort(), thr = sorted[Math.floor(0.99 * sorted.length)];
  let sx = 0, sy = 0, sw = 0;
  const R0 = 0.03 * Math.min(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = img[y * w + x];
    if (v >= thr && Math.hypot(x - w / 2, y - h / 2) > R0) { sx += x * v; sy += y * v; sw += v; }
  }
  let cx = sw ? sx / sw : w / 2, cy = sw ? sy / sw : h / 2;
  const Rmax = Math.min(cx, cy, w - cx, h - cy) - 2;
  const radial = (cxx, cyy) => {
    const prof = new Float64Array(Math.ceil(Rmax) + 1), cnt = new Float64Array(prof.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const r = Math.round(Math.hypot(x - cxx, y - cyy)); if (r <= Rmax) { prof[r] += img[y * w + x]; cnt[r]++; } }
    for (let r = 0; r < prof.length; r++) prof[r] /= cnt[r] || 1;
    return prof;
  };
  const prof = radial(cx, cy);
  // log profile with its smooth fall-off removed (moving average over ±8 px), so rings stand out evenly
  const lp = prof.map((v) => Math.log(Math.max(v, 1e-30))), det = new Float64Array(lp.length);
  for (let r = 0; r < lp.length; r++) { let s = 0, c = 0; for (let q = Math.max(0, r - 8); q <= Math.min(lp.length - 1, r + 8); q++) { s += lp[q]; c++; } det[r] = lp[r] - s / c; }
  // camera length: the scale at which the standard's rings sit on peaks of the radial profile
  const rOf = (L, dd) => (lam * L) / (dd * pixMM);
  const at = (r) => { const i = Math.floor(r); return i >= 0 && i + 1 < det.length ? det[i] * (1 - (r - i)) + det[i + 1] * (r - i) : -1; };
  const local = at;
  let best = { s: -Infinity, L: Lnom };
  for (let f = 0.6; f <= 1.6; f += 0.0025) {
    // sum, not mean: a scale that puts more of the standard's rings on peaks wins (a mean would favor
    // long camera lengths, where only the first ring or two are left on the detector)
    const L = Lnom * f, rs = d.map((dd) => rOf(L, dd)).filter((r) => r > 10 && r < Rmax - 12);
    if (rs.length < 2) continue;
    const s = rs.reduce((a, r) => a + local(r), 0);
    if (s > best.s) best = { s, L };
  }
  // refine each ring radius on the profile, then least squares for L
  const rings = [];
  for (const dd of d) {
    const r = rOf(best.L, dd);
    if (r < 10 || r > Rmax - 12) continue;
    let rb = r, vb = -Infinity;
    for (let q = r - 4; q <= r + 4; q += 0.1) { const v = at(q); if (v > vb) { vb = v; rb = q; } }
    rings.push({ d: dd, r: rb });
  }
  const L = rings.reduce((a, g) => a + g.r * g.d * pixMM, 0) / rings.reduce((a) => a + lam, 0);
  // ellipticity: radius of the strongest ring in 36 sectors, fitted to r(φ) = r₀(1 + (e/2)·cos 2(φ − φ₀))
  const ring = rings.reduce((a, g) => (at(g.r) > at(a.r) ? g : a), rings[0]);
  const ns = 36, rs = [];
  for (let k = 0; k < ns; k++) {
    const phi = (2 * Math.PI * (k + 0.5)) / ns;
    let rb = ring.r, vb = -Infinity;
    for (let q = ring.r * 0.9; q <= ring.r * 1.1; q += 0.1) {
      let v = 0;
      for (let t = -2; t <= 2; t++) { const ph = phi + (t * Math.PI) / ns / 3, x = Math.round(cx + q * Math.cos(ph)), y = Math.round(cy + q * Math.sin(ph)); v += img[y * w + x] || 0; }
      if (v > vb) { vb = v; rb = q; }
    }
    if (vb > 0) rs.push([phi, rb]);
  }
  // least squares r = a0 + ac·cos2φ + as·sin2φ (sectors may be missing where a spotty ring has no intensity)
  let M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (const [phi, r] of rs) { const f = [1, Math.cos(2 * phi), Math.sin(2 * phi)]; for (let i = 0; i < 3; i++) { v[i] += f[i] * r; for (let j = 0; j < 3; j++) M[i][j] += f[i] * f[j]; } }
  const [a0, ac, as] = solve3(M, v);
  const e = (2 * Math.hypot(ac, as)) / a0, ang = (Math.atan2(as, ac) * 90) / Math.PI;
  // an elliptical ring smears the rotational average; its fitted mean radius is the better scale
  const Lc = rs.length >= 12 ? L * (a0 / ring.r) : L;
  return { L: Lc, camLCal: Lc / Lnom, rings, ellip: e, ellipAng: ang, center: [cx, cy], prof: Array.from(prof), score: best.s, sectors: rs };
}

function solve3(M, v) { // Cramer's rule
  const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D = det(M) || 1e-30;
  return [0, 1, 2].map((k) => det(M.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)))) / D);
}

// Synthetic polycrystalline ring pattern of a standard (for trying the camera-length fit without data).
export function synthRings({ W = 512, pixMM, L, kV, d, ellip = 0, ellipAng = 0, counts = 400 }) {
  const lam = P.wavelength(kV), img = new Float32Array(W * W), c = W / 2 + 0.3, ca = (ellipAng * Math.PI) / 180;
  const radii = d.map((dd, i) => [(lam * L) / (dd * pixMM), 1 / (1 + i * 0.6)]);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = x - c, dy = y - c, r = Math.hypot(dx, dy), phi = Math.atan2(dy, dx);
    const re = r / (1 + (ellip / 2) * Math.cos(2 * (phi - ca))); // undo the distortion to find the true radius
    let v = 3e3 / (1 + (r / 12) ** 2) + 2;
    for (const [rr, a] of radii) v += a * 30 * Math.exp(-0.5 * ((re - rr) / 1.6) ** 2);
    img[y * W + x] = P.poisson((v * counts) / 30);
  }
  return img;
}

// ---------------------------------------------------------------- bright-field disk → detector angles (4D-STEM, CBED, Ronchigram)
// A pattern recorded through vacuum (or the central disk of any pattern): its radius in pixels for a known
// convergence semi-angle gives the true mrad per pixel.
export function fitDisk(img, w, h, { alpha, mradPxNom }) {
  const s = Float32Array.from(img).sort(), lo = s[Math.floor(0.05 * s.length)], hi = s[Math.floor(0.995 * s.length)], half = (lo + hi) / 2;
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (img[y * w + x] > half) { n++; sx += x; sy += y; }
  if (n < 12) throw new Error('no bright disk found');
  const r = Math.sqrt(n / Math.PI), mradPx = alpha / r;
  return { r, center: [sx / n, sy / n], mradPx, camLCal: mradPxNom / mradPx, threshold: half };
}

// ---------------------------------------------------------------- EDS: resolution and energy scale from known peaks
// Find peaks, match them to known lines, fit centroid and width; FWHM² = a + b·E gives the resolution at Mn Kα,
// and E_measured = gain·E_true + offset the energy calibration.
export function fitEDS(E, I, allLines) {
  const n = I.length, dE = Math.abs(E[1] - E[0]);
  // only isolated, strong lines: an unresolved neighbor (O Kα next to Ti Lα, Sr Lα next to Sr Lβ) would bias both
  // the centroid and the width
  const lines = allLines.filter((l) => (l.w ?? 1) >= 0.5 && !allLines.some((o) => o !== l && Math.abs(o.E - l.E) < 0.25 && (o.w ?? 1) >= 0.05));
  if (!lines.length) throw new Error('none of the selected lines is isolated enough to fit');
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) { let v = 0, c = 0; for (let j = -2; j <= 2; j++) if (i + j >= 0 && i + j < n) { v += I[i + j]; c++; } sm[i] = v / c; }
  const found = [];
  for (const ln of lines) {
    const i0 = Math.round((ln.E - E[0]) / dE), w = Math.round(0.09 / dE);
    if (i0 - w < 2 || i0 + w > n - 3) continue;
    let k = i0 - w;
    for (let i = i0 - w; i <= i0 + w; i++) if (sm[i] > sm[k]) k = i;
    // background: straight line between the minima on either side within ±0.3 keV
    const span = Math.round(0.3 / dE);
    let l = k, r = k;
    for (let i = k; i > Math.max(0, k - span); i--) if (sm[i] < sm[l]) l = i;
    for (let i = k; i < Math.min(n - 1, k + span); i++) if (sm[i] < sm[r]) r = i;
    const bg = (i) => sm[l] + ((sm[r] - sm[l]) * (i - l)) / Math.max(1, r - l);
    const peak = sm[k] - bg(k);
    if (peak < 6 * Math.sqrt(Math.max(1, bg(k)))) continue; // not significant
    // moments within the half-maximum region give centroid and FWHM (Gaussian: FWHM = 2.355 σ)
    let a = k, b = k;
    while (a > l && sm[a] - bg(a) > peak / 2) a--;
    while (b < r && sm[b] - bg(b) > peak / 2) b++;
    const x1 = E[a] + ((peak / 2 - (sm[a] - bg(a))) / ((sm[a + 1] - bg(a + 1)) - (sm[a] - bg(a)) || 1)) * dE;
    const x2 = E[b - 1] + ((peak / 2 - (sm[b - 1] - bg(b - 1))) / ((sm[b] - bg(b)) - (sm[b - 1] - bg(b - 1)) || 1)) * dE;
    let m0 = 0, m1 = 0;
    for (let i = a; i <= b; i++) { const v = I[i] - bg(i); m0 += v; m1 += v * E[i]; }
    const sCorr = (5 * dE) ** 2 / 12; // the 5-channel smoothing broadens the width slightly
    found.push({ ...ln, Emeas: m1 / m0, fwhm: Math.sqrt(Math.max(0, (x2 - x1) ** 2 - 2.355 ** 2 * sCorr)), counts: m0 });
  }
  if (!found.length) throw new Error('no known peaks found in the spectrum');
  found.skipped = allLines.filter((l) => (l.w ?? 1) >= 0.5 && !lines.includes(l)).map((l) => l.label);
  // energy scale (needs two lines far apart)
  let gain = 1, offset = 0;
  if (found.length >= 2 && Math.max(...found.map((f) => f.E)) - Math.min(...found.map((f) => f.E)) > 1) {
    const mx = found.reduce((a, f) => a + f.E, 0) / found.length, my = found.reduce((a, f) => a + f.Emeas, 0) / found.length;
    let sxy = 0, sxx = 0;
    for (const f of found) { sxy += (f.E - mx) * (f.Emeas - my); sxx += (f.E - mx) ** 2; }
    gain = sxy / sxx; offset = my - gain * mx;
  }
  // resolution: FWHM² = a + b·E, using the Fano slope when only one line is usable
  const pts = found.filter((f) => f.fwhm > 0).map((f) => [f.E, (f.fwhm * 1000) ** 2]);
  let fwhmMn;
  if (pts.length >= 2) {
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let sxy = 0, sxx = 0;
    for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    const b = sxx ? sxy / sxx : 0, a = my - b * mx;
    fwhmMn = Math.sqrt(Math.max(0, a + b * 5.899));
  } else {
    const FANO = 2.355 * 2.355 * 0.115 * 3.8 * 1000; // eV² per keV
    fwhmMn = Math.sqrt(Math.max(0, pts[0][1] + FANO * (5.899 - pts[0][0])));
  }
  return { found, gain, offset, fwhmMn };
}

// ---------------------------------------------------------------- vacuum hologram → fringe spacing and contrast
// Locate the carrier frequency q from the power spectrum, then demodulate: for I = Ī(1 + μ·cos(2π q·r + φ)),
// μ = 2·|Σ w·(I − Ī)·e^(−2πi q·r)| / Σ w·Ī  (w: a smooth window over the hologram).
export function fitHologram(img, w, h, { pixA }) {
  const { PS, B, m } = paddedPS(img, w, h), c = B / 2;
  let k = -1, v = 0;
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const r = Math.hypot(x - c, y - c);
    if (r < 0.04 * B || r > 0.48 * B) continue;
    if (PS[y * B + x] > v) { v = PS[y * B + x]; k = y * B + x; }
  }
  if (k < 0) throw new Error('no sideband found');
  const [px, py] = subpix(PS, B, k % B, (k / B) | 0), qx = (px - c) / B, qy = (py - c) / B; // cycles per pixel
  const x0 = Math.floor((w - m) / 2), y0 = Math.floor((h - m) / 2), wv = (i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / m);
  let mean = 0, sw = 0;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) { const ww = wv(x) * wv(y); mean += ww * img[(y0 + y) * w + x0 + x]; sw += ww; }
  mean /= sw;
  let re = 0, im = 0;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const ww = wv(x) * wv(y), d = img[(y0 + y) * w + x0 + x] - mean, ph = 2 * Math.PI * (qx * x + qy * y);
    re += ww * d * Math.cos(ph); im -= ww * d * Math.sin(ph);
  }
  const q = Math.hypot(qx, qy) / pixA;
  return { spacing: 1 / q, mu: (2 * Math.hypot(re, im)) / (sw * mean), angle: (Math.atan2(qy, qx) * 180) / Math.PI };
}
