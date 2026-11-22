// 3D electron diffraction / MicroED: a nanocrystal is rotated on the goniometer while diffraction patterns are
// recorded, sampling reciprocal space (Kolb et al. 2007; Nannenga & Gonen 2019; Gemmi et al. 2019).
// Pure functions: the exhibit, headless runs, tests and the Python interface share them.
//
// Geometry (lab frame: x, y in the detector plane, the beam along −z, k₀ = −ẑ/λ). A reciprocal-lattice vector g is
// on the Ewald sphere when |k₀ + g| = 1/λ, i.e. g_z = λ|g|²/2. Rotating the crystal by φ about an in-plane axis e,
//   g_z(φ) = a cos φ + b sin φ = r cos(φ − φ_g),   a = g·ẑ, b = g·(ẑ × e), r = √(a² + b²),
// so each reflection crosses the sphere at φ = φ_g ± arccos(λg²/2r) (twice per turn; never if it lies too close
// to the axis: the blind region). Continuous rotation (cRED / MicroED) assigns each crossing to the frame whose
// wedge Δφ = ω/fps contains it, with the Lorentz factor 1/|dg_z/dφ|; stepwise collection (ADT / EDT) records stills
// whose partiality follows the excitation error s = λg²/2 − g_z(φ) through the crystal's relrod; precession-
// assisted stills (PEDT) integrate s over the cone, |s| ≲ φ_p·|g_xy|.
// Dose: every frame adds dose; intensities decay as exp(−D·k(g)), faster at high resolution, with
// k(g) = (0.3 + 0.7·(g/0.5 Å⁻¹)²)/D_c (a simplified form of the resolution-dependent decay seen in MicroED).
import * as P from './physics.js';

const DEG = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- settings and the series plan
export const METHODS = { cred: 'Continuous rotation (cRED / MicroED)', step: 'Stepwise stills (ADT)', pedt: 'Precession-assisted stills (PEDT)' };
export function plan(o) {
  const range = Math.max(0.5, o.end - o.start);
  const wedge = o.method === 'cred' ? o.speed / o.fps : o.step; // degrees per frame
  const exposure = o.method === 'cred' ? 1 / o.fps : o.exposure; // s per frame
  const frames = Math.max(1, Math.round(range / wedge));
  return { range, wedge, exposure, frames, dosePerFrame: o.doseRate * exposure, totalDose: o.doseRate * exposure * frames, time_s: o.method === 'cred' ? range / o.speed : frames * (o.exposure + 0.5) };
}

// ---------------------------------------------------------------- the crystal's reflections
// every reflection with structure factor above a floor out to g_max (Å⁻¹), with its lab-frame vector at φ = 0
// (crystal table cr with its orientation x, y, z: a zone-axis crystal from zone.js, or the built-in one)
export function reflections(cr, gMax, kV, t) {
  const a = cr.a, hm = Math.ceil(gMax * a) + 1, out = [];
  for (let h = -hm; h <= hm; h++) for (let k = -hm; k <= hm; k++) for (let l = -hm; l <= hm; l++) {
    if (!(h || k || l)) continue;
    const g = Math.hypot(h, k, l) / a;
    if (g > gMax) continue;
    const F = P.structF(cr, h, k, l);
    if (F < 0.02) continue;
    const v = P.zoneG(cr, h, k, l);
    // kinematical strength |F|² (the scattering factors carry the fall-off with g and the Debye–Waller damping);
    // the absolute scale comes from the dose in collect()
    out.push({ h, k, l, g, F, v, I: F * F });
  }
  return out;
}

// ---------------------------------------------------------------- merging by symmetry
export const LAUE = { friedel: 'Friedel pairs only (−1)', laue: 'Laue class of the crystal (m3̄m)' };
export function mergeKey(h, k, l, merge) {
  if (merge === 'laue') { const s = [Math.abs(h), Math.abs(k), Math.abs(l)].sort((x, y) => y - x); return s.join(','); } // m3̄m: permutations and signs
  const f = h || k || l; return f > 0 ? `${h},${k},${l}` : `${-h},${-k},${-l}`; // Friedel
}

// ---------------------------------------------------------------- the series
// o: { method, start, end, speed (°/s), fps, step (°), exposure (s), doseRate (e⁻/Å²/s), axis (° in-plane), pedPhi (mrad),
//      t (Å), lam (Å), Dc (e⁻/Å² or Infinity), crystalArea (Å²), mosaic (°) }
// returns per frame the recorded reflections { i (index), n (counts), b (background) } and the plan
export function collect(refl, o) {
  const p = plan(o), lam = o.lam, e = [Math.cos(o.axis * DEG), Math.sin(o.axis * DEG), 0], zh = [0, 0, 1], v = cross(zh, e);
  const ePerFrame = p.dosePerFrame * (o.crystalArea ?? 3e6), sig = Math.hypot(0.6 / o.t, ((o.mosaic ?? 0.05) * DEG) * 0.5); // relrod width (Å⁻¹) per unit g (mosaic part scaled below)
  const frames = Array.from({ length: p.frames }, () => []);
  const decay = (f, g) => (Number.isFinite(o.Dc) ? Math.exp(-((f + 0.5) * p.dosePerFrame) * (0.3 + 0.7 * (g / 0.5) ** 2) / o.Dc) : 1);
  const bg = (g) => 2e-5 * Math.exp(-g / 1.0) * ePerFrame; // diffuse (inelastic, thermal) background under a spot
  refl.forEach((R, i) => {
    const A = dot(R.v, zh), B = dot(R.v, v), r = Math.hypot(A, B), c = (lam * R.g * R.g) / 2, phg = Math.atan2(B, A) / DEG;
    if (o.method === 'cred') {
      if (r < Math.abs(c)) return; // blind region: never on the Ewald sphere
      const d = Math.acos(c / r) / DEG;
      for (const phi of [phg + d, phg - d]) {
        let ph = ((phi - o.start) % 360 + 360) % 360; // first angle at or after the start
        if (ph > p.range) continue;
        const f = Math.min(p.frames - 1, Math.floor(ph / p.wedge));
        const L = 1 / Math.max(1e-3, r * Math.abs(Math.sin((phi - phg) * DEG))) * 0.05; // Lorentz factor (normalized near 1 for g ≈ 0.5 Å⁻¹)
        const dk = decay(f, R.g), n = ePerFrame * R.I * Math.min(4, L) * dk;
        frames[f].push({ i, n, b: bg(R.g), phi: o.start + ph, decay: dk });
      }
    } else {
      const width = Math.hypot(sig, ((o.mosaic ?? 0.05) * DEG) * R.g);
      for (let f = 0; f < p.frames; f++) {
        const phi = o.start + (f + 0.5) * p.wedge, gz = A * Math.cos(phi * DEG) + B * Math.sin(phi * DEG), s = c - gz;
        let part;
        if (o.method === 'pedt') { // the precession cone sweeps s over ±φ_p·|g_xy|
          const gxy = Math.sqrt(Math.max(0, R.g * R.g - gz * gz)), span = (o.pedPhi * 1e-3) * gxy;
          part = Math.abs(s) <= span + width ? 1 : 0; // integrated through (near-kinematical)
        } else part = Math.exp(-0.5 * (s / width) ** 2); // still: a cut through the relrod
        if (part < 0.05) continue;
        const dk = decay(f, R.g), n = ePerFrame * R.I * part * dk;
        frames[f].push({ i, n, b: bg(R.g), phi, decay: dk });
      }
    }
  });
  // Bragg scattering shared among the reflections in condition: a frame's spots carry BRAGG of the electrons through
  // the crystal on average (the kinematical strengths above set only the shares), so counts follow the dose
  let tot = 0, nf = 0;
  for (const fr of frames) { let s = 0; for (const o of fr) s += o.n / (o.decay ?? 1); tot += s; nf++; }
  const k = tot > 0 ? (BRAGG * ePerFrame * nf) / tot : 0;
  for (const fr of frames) for (const o of fr) o.n *= k;
  return { plan: p, frames };
}
export const BRAGG = 0.3;

// ---------------------------------------------------------------- merged statistics
// completeness and I/σ per resolution shell (equal volume), and the dose-limited resolution: the last shell, from
// low resolution out, whose median I/σ is ≥ 2
export function statistics(refl, series, { merge = 'friedel', gMax, gMin = 0.05, shells = 10, upTo = Infinity } = {}) {
  const uniq = new Map(); // all symmetry-unique reflections in range
  for (const R of refl) if (R.g >= gMin && R.g <= gMax) { const k = mergeKey(R.h, R.k, R.l, merge); if (!uniq.has(k)) uniq.set(k, { g: R.g, n: 0, v: 0, obs: 0 }); }
  series.frames.forEach((fr, f) => {
    if (f >= upTo) return;
    for (const o of fr) {
      const R = refl[o.i]; if (R.g < gMin || R.g > gMax) continue;
      const u = uniq.get(mergeKey(R.h, R.k, R.l, merge)); u.n += o.n; u.v += o.n + o.b; u.obs++;
    }
  });
  const edges = Array.from({ length: shells + 1 }, (_, i) => Math.cbrt(gMin ** 3 + ((gMax ** 3 - gMin ** 3) * i) / shells));
  const sh = edges.slice(0, -1).map((g0, i) => ({ dLow: 1 / g0, dHigh: 1 / edges[i + 1], total: 0, observed: 0, isig: 0, m: 0, list: [] }));
  for (const u of uniq.values()) {
    const i = Math.min(shells - 1, edges.findIndex((x, j) => u.g >= x && u.g < edges[j + 1]) >>> 0);
    const s = sh[i] ?? sh[shells - 1];
    s.total++;
    if (u.obs) { const is = u.n / Math.sqrt(Math.max(1e-9, u.v)); s.observed++; s.isig += is; s.m++; s.list.push(is); }
  }
  // the median ⟨I/σ⟩ decides the resolution: reflections destroyed late in the series count, as in data reduction
  for (const s of sh) { s.completeness = s.total ? s.observed / s.total : 0; s.meanIsig = s.m ? s.isig / s.m : 0; s.list.sort((a, b) => a - b); s.medianIsig = s.list.length ? s.list[s.list.length >> 1] : 0; delete s.list; }
  const total = sh.reduce((a, s) => a + s.total, 0), observed = sh.reduce((a, s) => a + s.observed, 0);
  let dLimit = null; for (const s of sh) { if (s.medianIsig >= 2) dLimit = s.dHigh; else break; }
  return { shells: sh, completeness: total ? observed / total : 0, unique: total, observed, dLimit };
}

// ---------------------------------------------------------------- reciprocal-space layers (hk0, h0l, 0kl, n-th layer)
export function layer(refl, series, which, index = 0, upTo = Infinity) {
  const acc = new Map();
  series.frames.forEach((fr, f) => { if (f < upTo) for (const o of fr) acc.set(o.i, (acc.get(o.i) ?? 0) + o.n); });
  const pick = { hk0: (R) => R.l === index && [R.h, R.k], h0l: (R) => R.k === index && [R.h, R.l], '0kl': (R) => R.h === index && [R.k, R.l] }[which];
  const pts = [];
  refl.forEach((R, i) => { const uv = pick(R); if (uv) pts.push({ u: uv[0], v: uv[1], I: acc.get(i) ?? 0, seen: acc.has(i), g: R.g }); });
  return pts;
}

// ---------------------------------------------------------------- a frame as the detector records it
// W × W pixels of `pix` mm at camera length L (mm); spots are Gaussians of the recorded counts, plus background
export function frameImage(refl, series, f, { W = 512, pix = 0.05, L, lam, axis, start, noise = null }) {
  const img = new Float32Array(W * W), fr = series.frames[f] ?? [], p = series.plan;
  const e = [Math.cos(axis * DEG), Math.sin(axis * DEG), 0], phi = start + (f + 0.5) * p.wedge, c = Math.cos(phi * DEG), s = Math.sin(phi * DEG);
  const rot = (g) => { const k = dot(g, e), x = cross(e, g); return [0, 1, 2].map((j) => g[j] * c + x[j] * s + e[j] * k * (1 - c)); }; // Rodrigues
  const kpx = (lam * L) / pix; // pixels per Å⁻¹
  let bsum = 0;
  for (const o of fr) {
    const g = rot(refl[o.i].v), x = W / 2 + g[0] * kpx, y = W / 2 + g[1] * kpx, sg = 1.3;
    bsum += o.b;
    if (x < 3 || y < 3 || x >= W - 3 || y >= W - 3) continue;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
      img[yy * W + xx] += (o.n * Math.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sg * sg))) / (2 * Math.PI * sg * sg);
    }
  }
  // the direct beam (behind a beam stop: a faint halo) and a diffuse background falling off with angle
  const bg0 = fr.length ? bsum / fr.length / 20 : 0.5;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot(x - W / 2, y - W / 2);
    img[y * W + x] += bg0 * (1 + 30 * Math.exp(-r / 6)) * Math.exp(-r / (W / 3));
    if (noise) img[y * W + x] = noise(img[y * W + x]);
  }
  return img;
}

// a structure with no lattice (amorphous, molecular): the frame is the kinematical diffraction of its atoms
// projected at goniometer angle φ (flat-Ewald limit): |FT of the projected potential|², on the detector
export function diffuseFrame(xyz, phi, { W = 256, pix, L, lam, axis }) {
  const { sym, P3 } = xyz, n = 256, e = [Math.cos(axis * DEG), Math.sin(axis * DEG), 0], c = Math.cos(phi * DEG), s = Math.sin(phi * DEG);
  let R = 1; for (let i = 0; i < P3.length; i += 3) R = Math.max(R, Math.hypot(P3[i], P3[i + 1], P3[i + 2]));
  const kmax = ((W / 2) * pix) / L / lam, dx = Math.min(1 / (2 * kmax), (2.2 * R) / n); // resolve the detector edge, cover the structure
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let i = 0; i < sym.length; i++) {
    const g = [P3[3 * i], P3[3 * i + 1], P3[3 * i + 2]], k = dot(g, e), x = cross(e, g), r = [0, 1].map((j) => g[j] * c + x[j] * s + e[j] * k * (1 - c));
    const px = Math.round(r[0] / dx + n / 2), py = Math.round(r[1] / dx + n / 2);
    if (px >= 0 && py >= 0 && px < n && py < n) re[py * n + px] += Math.pow(P.SYMBOLS.indexOf(sym[i]) + 1, 0.75);
  }
  P.fft2(re, im, n);
  const out = new Float32Array(W * W), dk = 1 / (n * dx), kpx = (lam * L) / pix;
  for (let y = 0; y < W; y++) for (let xx = 0; xx < W; xx++) {
    const kx = (xx - W / 2) / kpx, ky = (y - W / 2) / kpx, fx = Math.round(kx / dk), fy = Math.round(ky / dk);
    if (Math.abs(fx) >= n / 2 || Math.abs(fy) >= n / 2) continue;
    const j = ((fy + n) % n) * n + ((fx + n) % n), k2 = kx * kx + ky * ky;
    out[y * W + xx] = (re[j] * re[j] + im[j] * im[j]) * Math.exp(-0.3 * k2) / sym.length; // a mild Debye–Waller damping
  }
  return out;
}

// every spot recorded in frames [0, n) at the rotation of its own frame (the sweep as an image viewer stacks it)
export function stackImage(refl, series, n, { W = 512, pix = 0.05, L, lam, axis, start }) {
  const img = new Float32Array(W * W), p = series.plan, e = [Math.cos(axis * DEG), Math.sin(axis * DEG), 0], kpx = (lam * L) / pix;
  for (let f = 0; f < Math.min(n, p.frames); f++) {
    const phi = start + (f + 0.5) * p.wedge, c = Math.cos(phi * DEG), s = Math.sin(phi * DEG);
    for (const o of series.frames[f]) {
      const g = refl[o.i].v, k = dot(g, e), x = cross(e, g), r = [0, 1].map((j) => g[j] * c + x[j] * s + e[j] * k * (1 - c));
      const px = Math.round(W / 2 + r[0] * kpx), py = Math.round(W / 2 + r[1] * kpx);
      if (px < 1 || py < 1 || px >= W - 1 || py >= W - 1) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) img[(py + dy) * W + px + dx] += o.n * (dx || dy ? 0.12 : 1);
    }
  }
  return img;
}

// ---------------------------------------------------------------- export: SMV (ADSC) frames, as read by DIALS, XDS, PETS
export function smvFrame(img, W, { pix, L, lam, oscStart, oscRange, axis, exposure }) {
  const keys = [
    ['HEADER_BYTES', '512'], ['DIM', '2'], ['BYTE_ORDER', 'little_endian'], ['TYPE', 'unsigned_short'], ['SIZE1', W], ['SIZE2', W],
    ['PIXEL_SIZE', pix], ['WAVELENGTH', lam.toFixed(6)], ['DISTANCE', L.toFixed(2)], ['OSC_START', oscStart.toFixed(4)], ['OSC_RANGE', oscRange.toFixed(4)],
    ['PHI', oscStart.toFixed(4)], ['TIME', exposure.toFixed(4)], ['BEAM_CENTER_X', ((W / 2) * pix).toFixed(4)], ['BEAM_CENTER_Y', ((W / 2) * pix).toFixed(4)],
    ['TWOTHETA', '0'], ['DETECTOR_SN', 'tem-view-simulated'], ['ROTATION_AXIS_DEG', axis.toFixed(2)],
  ];
  let head = '{\n' + keys.map(([k, v]) => `${k}=${v};`).join('\n') + '\n}\f';
  head = head.padEnd(512, ' ');
  const out = new Uint8Array(512 + W * W * 2), dv = new DataView(out.buffer);
  for (let i = 0; i < 512; i++) out[i] = head.charCodeAt(i) & 0xff;
  for (let i = 0; i < W * W; i++) dv.setUint16(512 + 2 * i, Math.max(0, Math.min(65535, Math.round(img[i]))), true);
  return out;
}
export function parseSMV(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, 512)), kv = {};
  for (const m of head.matchAll(/(\w+)=([^;]*);/g)) kv[m[1]] = m[2];
  const W = +kv.SIZE1, dv = new DataView(bytes.buffer, bytes.byteOffset), img = new Uint16Array(W * W);
  for (let i = 0; i < W * W; i++) img[i] = dv.getUint16(512 + 2 * i, true);
  return { head: kv, img };
}
