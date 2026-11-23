// Electron tomography (M7): a voxel phantom of the specimen, a tilt series of projections, and its reconstruction.
//
// Geometry: a single tilt axis along x (the holder axis). Rotating the specimen by θ about x and projecting along
// the beam (z) gives a projection p_θ(x, v) with v = y cos θ − z sin θ: each x-slice of the volume is an independent
// 2D problem (its sinogram), which is how single-axis tomography is reconstructed. The projector splats each voxel
// linearly into two detector bins and the back-projector is its exact adjoint, so SIRT converges.
//
// Signal: HAADF-STEM is close to a mass–thickness projection (Σ Z^1.7 along the ray), which satisfies the projection
// requirement (Midgley & Weyland 2003). Bright-field TEM breaks it: each crystalline grain diffracts strongly (and
// looks dark) only near its Bragg orientations, so its contrast spikes from tilt to tilt (a teaching model).
//
// Missing wedge: tilts up to ±α fill a sector |φ| ≤ α of each slice's Fourier plane; the point-spread function is
// elongated along the beam by e = √((α + sin α cos α) / (α − sin α cos α)) (Radermacher 1988).
// Pure functions (no DOM), for sim.js, the compute worker and tests.
import { fft2 } from './kernels.js';

const DEG = Math.PI / 180;
const ZP = (Z) => Math.pow(Z, 1.7); // HAADF weight per atom

// Σ Z^1.7 per Å³ of the amorphous and continuum materials (number density × Z^1.7 per formula unit)
export const MAT_DENSITY = {
  C: 0.1 * ZP(6), // amorphous carbon, ~2 g/cm³
  SiO2: 0.022 * (ZP(14) + 2 * ZP(8)),
  SiN: 0.0145 * (3 * ZP(14) + 4 * ZP(7)),
  ice: 0.0334 * (ZP(8) + 2), // vitreous ice, H₂O per Å³
  protein: 0.06 * ZP(6.6), // heavy atoms of protein, ~1.35 g/cm³
  lipid: 0.045 * ZP(6),
  head: 0.06 * ZP(7.5),
  ferrihydrite: 0.022 * (ZP(26) + 1.6 * ZP(8)),
};

export const predictedElongation = (alphaDeg) => { const a = alphaDeg * DEG, sc = Math.sin(a) * Math.cos(a); return Math.sqrt((a + sc) / (a - sc)); };

// --------------------------------------------------------------- tilt schemes
// linear: equal steps; Saxton: steps shrink as cos θ, so the high tilts (where the path is longest and the
// information per degree highest) are sampled more finely (Saxton, Baumeister & Hahn 1984)
export function tilts(scheme, maxDeg, stepDeg) {
  const out = [];
  if (scheme === 'saxton') {
    const half = [0];
    let t = 0;
    for (let k = 0; k < 2000; k++) { t += stepDeg * Math.cos(t * DEG); if (t > maxDeg + 1e-9) break; half.push(t); }
    for (let i = half.length - 1; i > 0; i--) out.push(-half[i]);
    out.push(...half);
  } else {
    const n = Math.floor(maxDeg / stepDeg + 1e-9);
    for (let i = -n; i <= n; i++) out.push(i * stepDeg);
  }
  return out;
}
// the angular interval each projection stands for (weights for WBP with unequal steps)
export function intervals(ang) {
  return ang.map((a, i) => {
    const lo = i ? (a - ang[i - 1]) / 2 : i + 1 < ang.length ? (ang[i + 1] - a) / 2 : 1;
    const hi = i + 1 < ang.length ? (ang[i + 1] - a) / 2 : lo;
    return (lo + hi) * DEG;
  });
}

// --------------------------------------------------------------- phantoms
// from a structure (structure.js buildStructure): atoms (splatted, Z^1.7), amorphous boxes and shells. The region
// is cut out as a cube (like a needle or a particle on a thin support), so nothing outside it enters the projections.
// Returns { N, vox, side, vol, crys } with vol[x + N (y + N z)] in Σ Z^1.7 per voxel and crys its crystalline part.
export function phantomFromStructure(st, N, { Zof } = {}) {
  const half = st.region?.half_A ?? Math.max(st.box[0], st.box[1]) / 2;
  const zExt = st.box[2] / 2;
  const side = 2 * Math.max(half, Math.min(zExt, 3 * half)), vox = side / N, c = N / 2;
  const vol = new Float32Array(N * N * N), crys = new Float32Array(N * N * N);
  const splat = (arr, x, y, z, w) => {
    const fx = x / vox + c - 0.5, fy = y / vox + c - 0.5, fz = z / vox + c - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), dx = fx - i, dy = fy - j, dz = fz - k;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let e = 0; e < 2; e++) {
      const ii = i + a, jj = j + b, kk = k + e;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= N || jj >= N || kk >= N) continue;
      arr[ii + N * (jj + N * kk)] += w * (a ? dx : 1 - dx) * (b ? dy : 1 - dy) * (e ? dz : 1 - dz);
    }
  };
  // atoms
  const zw = st.species.map((s) => ZP(Zof ? Zof(s.sym) : zOf(s.sym)));
  for (let i = 0; i < st.count; i++) { const w = zw[st.el[i]]; splat(crys, st.pos[3 * i], st.pos[3 * i + 1], st.pos[3 * i + 2], w); }
  // amorphous boxes: density × the voxel volume, filled on the grid
  const v3 = vox ** 3;
  for (const V of st.voxels ?? []) {
    const rho = MAT_DENSITY[V.mat] ?? 0; if (!rho) continue;
    for (let b = 0; b < V.n; b++) {
      const [bx, by, bz, sx, sy, sz] = V.boxes.subarray(6 * b, 6 * b + 6);
      fillBox(vol, N, vox, c, bx - sx / 2, bx + sx / 2, by - sy / 2, by + sy / 2, bz - sz / 2, bz + sz / 2, rho * v3);
    }
  }
  // shells (vesicles, protein shells, a ferrihydrite core); empty bubbles are holes already cut in the atoms
  for (const s of st.shells ?? []) {
    const rho = /core/.test(s.label) ? MAT_DENSITY.ferrihydrite : /vesicle/.test(s.label) ? MAT_DENSITY.head : /shell/.test(s.label) ? MAT_DENSITY.protein : 0;
    if (!rho) continue;
    const r0 = s.r0 ?? 0, R = s.R, lo = (q) => Math.max(0, Math.floor((q - R) / vox + c)), hi = (q) => Math.min(N - 1, Math.ceil((q + R) / vox + c));
    for (let k = lo(s.z ?? 0); k <= hi(s.z ?? 0); k++) for (let j = lo(s.y); j <= hi(s.y); j++) for (let i = lo(s.x); i <= hi(s.x); i++) {
      const r = Math.hypot((i + 0.5 - c) * vox - s.x, (j + 0.5 - c) * vox - s.y, (k + 0.5 - c) * vox - (s.z ?? 0));
      if (r <= R && r >= r0) vol[i + N * (j + N * k)] += rho * v3;
    }
  }
  for (let i = 0; i < vol.length; i++) vol[i] += crys[i];
  return { N, vox, side, vol, crys };
}
function fillBox(vol, N, vox, c, x0, x1, y0, y1, z0, z1, w) {
  // fractional overlap of each voxel with the box, separable per axis
  const ov = (a0, a1) => { const out = []; const i0 = Math.max(0, Math.floor(a0 / vox + c)), i1 = Math.min(N - 1, Math.floor(a1 / vox + c)); for (let i = i0; i <= i1; i++) { const lo = Math.max(a0, (i - c) * vox), hi = Math.min(a1, (i + 1 - c) * vox); if (hi > lo) out.push([i, (hi - lo) / vox]); } return out; };
  const X = ov(x0, x1), Y = ov(y0, y1), Z = ov(z0, z1);
  for (const [k, fz] of Z) for (const [j, fy] of Y) for (const [i, fx] of X) vol[i + N * (j + N * k)] += w * fx * fy * fz;
}
const SYM = ['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi'];
const zOf = (sym) => { const z = SYM.indexOf(sym) + 1; return z > 0 ? z : 6; };

// a test phantom: gold beads of several sizes in a thin carbon film (the beads also serve as fiducials), with the
// bead list kept for the elongation measurement. Units: voxels.
export function beadPhantom(N, { side = 400, film = true } = {}) {
  const vox = side / N, c = N / 2, vol = new Float32Array(N * N * N), crys = new Float32Array(N * N * N);
  // the two smallest stay at 1.6 and 2.2 voxels whatever the volume size: points the reconstruction can resolve
  const s = N / 128, beads = [[-0.22, -0.2, 0.0, 1.6], [0.2, -0.22, -0.08, 2.2], [-0.2, 0.22, 0.1, Math.max(2.8, 3.5 * s)], [0.22, 0.2, 0.0, Math.max(3.5, 6 * s)], [0, 0, 0, Math.max(5, 10 * s)]]
    .map(([x, y, z, r]) => ({ x: x * N, y: y * N, z: z * N, r }));
  const rhoAu = 0.059 * ZP(79) * vox ** 3; // gold, atoms per Å³ × Z^1.7
  for (const b of beads) {
    const R = b.r + 1.5;
    for (let k = Math.floor(c + b.z - R); k <= c + b.z + R; k++) for (let j = Math.floor(c + b.y - R); j <= c + b.y + R; j++) for (let i = Math.floor(c + b.x - R); i <= c + b.x + R; i++) {
      // partial-volume sphere (8 sub-samples per voxel) so small beads are not blocky
      let f = 0;
      for (let s = 0; s < 8; s++) { const dx = i + 0.25 + 0.5 * (s & 1) - c - b.x, dy = j + 0.25 + 0.5 * ((s >> 1) & 1) - c - b.y, dz = k + 0.25 + 0.5 * (s >> 2) - c - b.z; if (dx * dx + dy * dy + dz * dz <= b.r * b.r) f += 0.125; }
      if (f) { crys[i + N * (j + N * k)] += f * rhoAu; }
    }
  }
  if (film) fillBox(vol, N, 1, c, -N * 0.45, N * 0.45, -N * 0.45, N * 0.45, -N * 0.04, N * 0.04, MAT_DENSITY.C * vox ** 3);
  for (let i = 0; i < vol.length; i++) vol[i] += crys[i];
  return { N, vox, side, vol, crys, beads };
}

// --------------------------------------------------------------- projector and back-projector
// proj[x + N v] for one tilt θ; vol[x + N (y + N z)]. Linear splat into the two nearest detector bins.
export function project(vol, N, thetaDeg, out = new Float32Array(N * N)) {
  out.fill(0);
  const cs = Math.cos(thetaDeg * DEG), sn = Math.sin(thetaDeg * DEG), c = N / 2 - 0.5;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
    const v = (y - c) * cs - (z - c) * sn + c, v0 = Math.floor(v), f = v - v0;
    if (v0 < -1 || v0 >= N) continue;
    const base = N * (y + N * z), a = v0 >= 0 ? v0 * N : -1, b = v0 + 1 < N ? (v0 + 1) * N : -1;
    if (a >= 0) { const w = 1 - f; for (let x = 0; x < N; x++) out[a + x] += w * vol[base + x]; }
    if (b >= 0) for (let x = 0; x < N; x++) out[b + x] += f * vol[base + x];
  }
  return out;
}
// adjoint: spreads proj back over the volume (vol += w · Aᵀ proj)
export function backproject(proj, N, thetaDeg, vol, w = 1) {
  const cs = Math.cos(thetaDeg * DEG), sn = Math.sin(thetaDeg * DEG), c = N / 2 - 0.5;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
    const v = (y - c) * cs - (z - c) * sn + c, v0 = Math.floor(v), f = v - v0;
    if (v0 < -1 || v0 >= N) continue;
    const base = N * (y + N * z), a = v0 >= 0 ? v0 * N : -1, b = v0 + 1 < N ? (v0 + 1) * N : -1;
    const wa = w * (1 - f), wb = w * f;
    if (a >= 0) for (let x = 0; x < N; x++) vol[base + x] += wa * proj[a + x];
    if (b >= 0) for (let x = 0; x < N; x++) vol[base + x] += wb * proj[b + x];
  }
  return vol;
}

// --------------------------------------------------------------- the tilt series
// series({ ph, angles, signal, dosePerImage, Dc, jitter, seed, noise }) → { angles, proj: [Float32Array], shifts }
//   signal 'haadf' | 'bf'; dosePerImage e⁻/Å²; Dc critical dose: mass is lost as floor + (1 − floor)·exp(−D/Dc)
//   (beam-sensitive material loses a fraction of its mass, then stabilises; Infinity: robust specimens);
//   jitter: rms shift (voxels) of each projection, the alignment error before alignment
// Counts: each atom scatters σ = η·Z^1.7 into the HAADF detector (η ≈ 1.2·10⁻⁵ Å², so a gold atom ≈ 0.02 Å²),
// so a pixel receives D·η·Σ Z^1.7 electrons, Poisson-distributed.
export const HAADF_ETA = 1.2e-5;
export function series(o) { const st = seriesInit(o); while (seriesNext(st)); return st; }
// the same, one projection at a time (the exhibit records them as the holder turns)
// winBg: the window membranes' Σ Z^1.7 per pixel at 0° (environment.js): flat films, so it grows as 1/cos θ
export function seriesInit({ ph, angles, signal = 'haadf', dosePerImage = 1e4, Dc = Infinity, floor = 0.7, jitter = 0, seed = 7, eta = HAADF_ETA, noise = true, winBg = 0 }) {
  const rnd = rng(seed), st = { ph, N: ph.N, angles, signal, dosePerImage, Dc, floor, jitter, noise, rnd, winBg, countsPer: dosePerImage * eta, proj: [], shifts: [], dose: [], totalDose: 0, massLeft: 1, tmp: new Float32Array(ph.N * ph.N) };
  if (signal === 'bf') {
    // diffraction contrast differs from grain to grain: the crystalline material is split into GRAINS classes by
    // blocks of ~1/12 of the box (a grain or a particle), each with its own Bragg phase
    const N = ph.N, B = Math.max(2, Math.round(N / 12)), parts = Array.from({ length: GRAINS }, () => new Float32Array(N * N * N));
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = x + N * (y + N * z), v = ph.crys[i]; if (v) parts[hash3((x / B) | 0, (y / B) | 0, (z / B) | 0) % GRAINS][i] = v; }
    // each grain diffracts strongly (dark in bright field) only near its Bragg orientations: ~1.5° wide, every 5–12°
    st.grains = parts.map((vol) => { const period = 5 + 7 * rnd(), off = rnd() * period; return { vol, bragg: Array.from({ length: Math.ceil(200 / period) }, (_, k) => -100 + off + k * period) }; });
  }
  return st;
}
export function seriesNext(st) {
  const t = st.proj.length; if (t >= st.angles.length) return false;
  const { ph, N, angles, Dc, floor, rnd } = st, th = angles[t];
  const mass = Number.isFinite(Dc) ? floor + (1 - floor) * Math.exp(-st.totalDose / Dc) : 1;
  const p = new Float32Array(N * N);
  project(ph.vol, N, th, st.tmp);
  if (st.signal === 'bf') {
    // bright field: amorphous mass–thickness plus crystalline material whose diffraction contrast flickers as
    // Bragg conditions come and go with the tilt (not a projection of anything)
    p.set(st.tmp);
    const pc = new Float32Array(N * N);
    for (const g of st.grains) {
      // the crystalline signal: 0.4 of its mass–thickness value off Bragg, up to ~3× at a Bragg orientation
      let f = 0.4; for (const b of g.bragg) f += 2.5 * Math.exp(-(((th - b) / 1.5) ** 2));
      const flick = f - 1;
      project(g.vol, N, th, pc);
      for (let i = 0; i < p.length; i++) p[i] += flick * pc[i];
    }
  } else p.set(st.tmp);
  if (mass !== 1) for (let i = 0; i < p.length; i++) p[i] *= mass; // mass lost to the dose received so far
  if (st.winBg) { const b = st.winBg / Math.max(0.17, Math.cos((th * Math.PI) / 180)); for (let i = 0; i < p.length; i++) p[i] += b; } // the windows, thicker in projection at high tilt
  // a random whole-pixel shift (alignment error)
  const sx = st.jitter ? Math.round(gauss(rnd) * st.jitter) : 0, sv = st.jitter ? Math.round(gauss(rnd) * st.jitter) : 0;
  st.shifts.push([sx, sv]);
  const q = sx || sv ? shift2(p, N, sx, sv) : p;
  if (st.noise && st.countsPer > 0 && Number.isFinite(st.countsPer)) for (let i = 0; i < q.length; i++) q[i] = poisson(Math.max(0, q[i]) * st.countsPer, rnd) / st.countsPer;
  st.proj.push(q);
  st.dose.push(st.totalDose);
  st.totalDose += st.dosePerImage;
  st.massLeft = Number.isFinite(Dc) ? floor + (1 - floor) * Math.exp(-st.totalDose / Dc) : 1;
  return st.proj.length < angles.length;
}
// the series as plain data (angles, projections), for a worker or a reconstruction
export const seriesData = (st) => ({ N: st.N, angles: st.angles.slice(0, st.proj.length), proj: st.proj });
const GRAINS = 6;
const hash3 = (i, j, k) => { let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };
function shift2(p, N, sx, sv) { const q = new Float32Array(N * N); for (let v = 0; v < N; v++) { const vv = v - sv; if (vv < 0 || vv >= N) continue; for (let x = 0; x < N; x++) { const xx = x - sx; if (xx >= 0 && xx < N) q[x + N * v] = p[xx + N * vv]; } } return q; }

// alignment by centre of mass: in single-axis tomography the centre of mass of every projection must lie at
// v = y_c cos θ − z_c sin θ (and the same x), so shifting each projection to put it there removes the jitter
export function alignCOM(ser) {
  const N = ser.N, com = ser.proj.map((p) => { let s = 0, sx = 0, sv = 0; for (let v = 0; v < N; v++) for (let x = 0; x < N; x++) { const w = Math.max(0, p[x + N * v]); s += w; sx += w * x; sv += w * v; } return s ? [sx / s, sv / s] : [N / 2, N / 2]; });
  // fit (y_c, z_c) to v(θ) by least squares, x by the mean
  let a = 0, b = 0, d = 0, e1 = 0, e2 = 0, mx = 0;
  ser.angles.forEach((th, i) => { const cs = Math.cos(th * DEG), sn = -Math.sin(th * DEG), v = com[i][1] - (N / 2 - 0.5); a += cs * cs; b += cs * sn; d += sn * sn; e1 += cs * v; e2 += sn * v; mx += com[i][0]; });
  mx /= ser.angles.length;
  const det = a * d - b * b, yc = det ? (e1 * d - e2 * b) / det : 0, zc = det ? (a * e2 - b * e1) / det : 0;
  const proj = ser.proj.map((p, i) => {
    const th = ser.angles[i], want = yc * Math.cos(th * DEG) - zc * Math.sin(th * DEG) + (N / 2 - 0.5);
    return shift2(p, N, Math.round(mx - com[i][0]), Math.round(want - com[i][1]));
  });
  return { ...ser, proj, aligned: true };
}

// --------------------------------------------------------------- reconstruction
// weighted back-projection: each projection row filtered by the ramp |k| (Ram-Lak, optionally apodised by a Hann
// window), back-projected with the weight of its angular interval
export function wbp(ser, { filter = 'ramp', positivity = false } = {}) {
  const N = ser.N, vol = new Float32Array(N * N * N), w = intervals(ser.angles);
  filterSeries(ser, filter).forEach((fp, t) => backproject(fp, N, ser.angles[t], vol, w[t]));
  // f = ∫₀^π (h * p_θ) dθ with the kernel above in units of 1/sample²: the sum over Δθ is that integral
  if (positivity) for (let i = 0; i < vol.length; i++) if (vol[i] < 0) vol[i] = 0;
  return vol;
}
// the filtered projections of WBP (shared with the GPU back-projector, gpu.js)
export function filterSeries(ser, filter = 'ramp') {
  const N = ser.N, M = nextPow2(2 * N);
  // the Ram-Lak kernel in real space (h₀ = 1/4, h_n = −1/(π n)² for odd n), transformed: a ramp whose DC term is
  // right, so flat regions keep their level (sampling |k| directly would cup them); Hann apodises it
  const H = new Float64Array(M), hi = new Float64Array(M);
  for (let n = 0; n < M; n++) { const d = Math.min(n, M - n); H[n] = d === 0 ? 0.25 : d % 2 ? -1 / (Math.PI * d) ** 2 : 0; }
  fft1(H, hi, M, false);
  for (let k = 0; k < M; k++) { const f = Math.min(k, M - k) / M; H[k] *= filter === 'hann' ? 0.5 + 0.5 * Math.cos(2 * Math.PI * f) : 1; }
  const re = new Float64Array(M), im = new Float64Array(M);
  return ser.proj.map((p) => {
    const fp = new Float32Array(N * N);
    // filter along v for each x (columns of p)
    for (let x = 0; x < N; x++) {
      re.fill(0); im.fill(0);
      for (let v = 0; v < N; v++) re[v] = p[x + N * v];
      fft1(re, im, M, false);
      for (let k = 0; k < M; k++) { re[k] *= H[k]; im[k] *= H[k]; }
      fft1(re, im, M, true);
      for (let v = 0; v < N; v++) fp[x + N * v] = re[v];
    }
    return fp;
  });
}

// SIRT: x ← x + λ C Aᵀ R (p − A x), with R and C the inverse row and column sums of A (Gilbert 1972); one call of
// sirtStep does whole iterations within a time budget, so it can run in a worker or a frame at a time
export function sirtInit(ser, { iterations = 30, relax = 1, positivity = true } = {}) {
  const N = ser.N, ones = new Float32Array(N * N * N).fill(1);
  const rowInv = ser.angles.map((th) => { const r = project(ones, N, th); for (let i = 0; i < r.length; i++) r[i] = r[i] > 1e-6 ? 1 / r[i] : 0; return r; });
  const colInv = new Float32Array(N * N * N);
  const onesP = new Float32Array(N * N).fill(1);
  ser.angles.forEach((th) => backproject(onesP, N, th, colInv));
  for (let i = 0; i < colInv.length; i++) colInv[i] = colInv[i] > 1e-6 ? relax / colInv[i] : 0;
  return { N, x: new Float32Array(N * N * N), rowInv, colInv, iter: 0, iterations, positivity, resid: [], buf: new Float32Array(N * N), upd: new Float32Array(N * N * N) };
}
export function sirtStep(st, ser, budgetMs = Infinity, now = () => Date.now()) {
  const t0 = now(), N = st.N;
  while (st.iter < st.iterations) {
    st.upd.fill(0);
    let r2 = 0, p2 = 0;
    ser.angles.forEach((th, t) => {
      const ax = project(st.x, N, th, st.buf), p = ser.proj[t], ri = st.rowInv[t];
      for (let i = 0; i < ax.length; i++) { const d = p[i] - ax[i]; r2 += d * d; p2 += p[i] * p[i]; ax[i] = d * ri[i]; }
      backproject(ax, N, th, st.upd);
    });
    for (let i = 0; i < st.x.length; i++) { let v = st.x[i] + st.colInv[i] * st.upd[i]; if (st.positivity && v < 0) v = 0; st.x[i] = v; }
    st.resid.push(Math.sqrt(r2 / (p2 || 1)));
    st.iter++;
    if (now() - t0 > budgetMs) break;
  }
  return st.iter < st.iterations;
}

// --------------------------------------------------------------- views and measurements
// the volume seen from any direction: rays along the view axis after turning it by yaw (about y) then pitch (about
// x), degrees; the brightest voxel on each ray (mip) or their sum (a projection). Trilinear samples, out × out
// pixels, one sample per voxel along the ray; everything outside the cube is empty. At yaw = pitch = 0 the view
// is along z (the beam), x across and y down, as in the XY slice.
export function render3D(vol, N, yawDeg = 0, pitchDeg = 0, { mode = 'mip', out = N } = {}) {
  const a = (yawDeg * Math.PI) / 180, b = (pitchDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // screen axes u (right), v (down) and the ray direction w, in volume coordinates: R = Ry(yaw) · Rx(pitch)
  const u = [ca, 0, -sa], v = [sa * sb, cb, ca * sb], w = [sa * cb, -sb, ca * cb];
  const img = new Float32Array(out * out), c = (N - 1) / 2, half = (Math.sqrt(3) * N) / 2, sc = N / out;
  const at = (x, y, z) => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    if (i < 0 || j < 0 || k < 0 || i >= N - 1 || j >= N - 1 || k >= N - 1) return 0;
    const fx = x - i, fy = y - j, fz = z - k, o = i + N * (j + N * k), NN = N * N;
    const c00 = vol[o] * (1 - fx) + vol[o + 1] * fx, c10 = vol[o + N] * (1 - fx) + vol[o + N + 1] * fx;
    const c01 = vol[o + NN] * (1 - fx) + vol[o + NN + 1] * fx, c11 = vol[o + NN + N] * (1 - fx) + vol[o + NN + N + 1] * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  };
  const steps = Math.ceil(2 * half);
  for (let py = 0; py < out; py++) for (let px = 0; px < out; px++) {
    const su = (px + 0.5) * sc - N / 2, sv = (py + 0.5) * sc - N / 2;
    const ox = c + su * u[0] + sv * v[0], oy = c + su * u[1] + sv * v[1], oz = c + su * u[2] + sv * v[2];
    let acc = mode === 'mip' ? -Infinity : 0, any = false;
    for (let t = 0; t < steps; t++) {
      const d = t - half, x = ox + d * w[0], y = oy + d * w[1], z = oz + d * w[2];
      if (x < 0 || y < 0 || z < 0 || x > N - 1 || y > N - 1 || z > N - 1) continue;
      const val = at(x, y, z); any = true;
      if (mode === 'mip') { if (val > acc) acc = val; } else acc += val;
    }
    img[px + out * py] = any ? acc : 0;
  }
  return img;
}
// the view direction's frame (screen right u, down v, ray w) for the same yaw and pitch, to draw the box and axes
export function viewFrame3D(yawDeg = 0, pitchDeg = 0) {
  const a = (yawDeg * Math.PI) / 180, b = (pitchDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  return { u: [ca, 0, -sa], v: [sa * sb, cb, ca * sb], w: [sa * cb, -sb, ca * cb] };
}

// orthoslices through (ix, iy, iz): XY (top view), XZ and YZ (along the beam: where the missing wedge stretches)
export function orthoslices(vol, N, ix = N >> 1, iy = N >> 1, iz = N >> 1) {
  const xy = new Float32Array(N * N), xz = new Float32Array(N * N), yz = new Float32Array(N * N);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    xy[b + N * a] = vol[b + N * (a + N * iz)]; // row a = y, column b = x
    xz[b + N * a] = vol[b + N * (iy + N * a)]; // row a = z
    yz[b + N * a] = vol[ix + N * (b + N * a)]; // row a = z, column b = y
  }
  return { xy, xz, yz };
}
// |F| of a YZ slice (log scale), centred: the measured sector and the empty wedge. The slice is zero-padded to a
// power of two (M × M) and windowed (Hann) so its edges do not streak the transform. Returns { arr, M }.
export function fourierSlice(slice, N) {
  const M = nextPow2(N), re = new Float64Array(M * M), im = new Float64Array(M * M), o = (M - N) >> 1;
  let mean = 0; for (let i = 0; i < N * N; i++) mean += slice[i] / (N * N);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) { const w = Math.sin((Math.PI * (a + 0.5)) / N) ** 2 * Math.sin((Math.PI * (b + 0.5)) / N) ** 2; re[b + o + M * (a + o)] = (slice[b + N * a] - mean) * w; }
  fft2(re, im, M);
  const arr = new Float32Array(M * M);
  for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) { const s = re[b + M * a] ** 2 + im[b + M * a] ** 2; arr[((b + M / 2) % M) + M * ((a + M / 2) % M)] = Math.log10(1e-12 + s); }
  return { arr, M };
}
// elongation of a reconstructed bead: the extent along z over the extent along y, at half maximum, from the
// central profiles through the bead's peak (the PSF elongation for a bead near the resolution limit)
export function elongation(vol, N, bead) {
  const c = N / 2, ix = Math.round(c + bead.x - 0.5), iy = Math.round(c + bead.y - 0.5), iz = Math.round(c + bead.z - 0.5);
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N ? 0 : vol[i + N * (j + N * k)]);
  // the profiles go through the bead's centre; its level is the maximum within half its radius (a small bead's
  // peak, a large bead's plateau without the edge ripple), the background the median on a ring around it
  let pk = -Infinity; const R = Math.max(1, Math.round(bead.r / 2));
  for (let k = iz - R; k <= iz + R; k++) for (let j = iy - R; j <= iy + R; j++) for (let i = ix - R; i <= ix + R; i++) pk = Math.max(pk, at(i, j, k));
  const pi = ix, pj = iy, pkz = iz;
  const ring = []; const Rb = Math.ceil(bead.r * 2.5) + 6;
  for (let a = 0; a < 64; a++) { const t = (a / 64) * 2 * Math.PI; ring.push(at(pi + Math.round(Rb * Math.cos(t)), pj + Math.round(Rb * Math.sin(t)), pkz)); }
  ring.sort((p, q) => p - q); const bg = ring[ring.length >> 1], half = bg + (pk - bg) / 2;
  const width = (f) => { let lo = 0, hi = 0; for (let s = 1; s < N; s++) { const v = f(-s); if (v < half) { const v0 = f(-s + 1); lo = s - 1 + (v0 - half) / (v0 - v || 1); break; } } for (let s = 1; s < N; s++) { const v = f(s); if (v < half) { const v0 = f(s - 1); hi = s - 1 + (v0 - half) / (v0 - v || 1); break; } } return lo + hi; };
  const wy = width((s) => at(pi, pj + s, pkz)), wz = width((s) => at(pi, pj, pkz + s)), wx = width((s) => at(pi + s, pj, pkz));
  return { wx, wy, wz, e: wz / (wy || 1), peak: pk, bg };
}
// correlation of a reconstruction with the phantom (inside the central sphere), as a quality figure
export function correlation(a, b) {
  let sa = 0, sb = 0, n = a.length; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n; let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return ab / Math.sqrt(aa * bb || 1);
}

// --------------------------------------------------------------- MRC (MRC2014: IMOD, Chimera, napari, tomopy read it)
// data: Float32Array nx·ny·nz with x fastest; voxel: Å per pixel (x, y, z); stack: true for a tilt series (ispg 0)
export function mrc(data, nx, ny, nz, voxel, { stack = false, label = 'TEM-view' } = {}) {
  const buf = new ArrayBuffer(1024 + 4 * nx * ny * nz), dv = new DataView(buf);
  const i32 = (o, v) => dv.setInt32(o, v, true), f32 = (o, v) => dv.setFloat32(o, v, true);
  let mn = Infinity, mx = -Infinity, sum = 0; for (const v of data) { mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
  const mean = sum / data.length; let ss = 0; for (const v of data) ss += (v - mean) ** 2;
  [nx, ny, nz].forEach((v, k) => i32(4 * k, v));
  i32(12, 2); // mode 2: float32
  [nx, ny, nz].forEach((v, k) => i32(28 + 4 * k, v)); // mx, my, mz
  const vz = Array.isArray(voxel) ? voxel : [voxel, voxel, voxel];
  [nx * vz[0], ny * vz[1], nz * vz[2]].forEach((v, k) => f32(40 + 4 * k, v)); // cell (Å)
  [90, 90, 90].forEach((v, k) => f32(52 + 4 * k, v));
  [1, 2, 3].forEach((v, k) => i32(64 + 4 * k, v));
  f32(76, mn); f32(80, mx); f32(84, mean); i32(88, stack ? 0 : 1);
  i32(108, 20140); // nversion
  [77, 65, 80, 32].forEach((c, k) => dv.setUint8(208 + k, c)); // 'MAP '
  dv.setUint8(212, 0x44); dv.setUint8(213, 0x44); // little-endian machine stamp
  f32(216, Math.sqrt(ss / data.length)); i32(220, 1);
  const lab = new TextEncoder().encode(label.slice(0, 80)); new Uint8Array(buf, 224, lab.length).set(lab);
  new Float32Array(buf, 1024).set(data);
  return new Uint8Array(buf);
}

// --------------------------------------------------------------- helpers
function nextPow2(n) { let m = 1; while (m < n) m <<= 1; return m; }
function fft1(re, im, n, inv) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
function poisson(lam, r) { if (lam < 30) { let L = Math.exp(-lam), k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; } return Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss(r))); }
