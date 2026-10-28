// The specimens, in nm, and what each detector records at a probe position. Pure functions: also runs in Node.
//
// The probe is two Gaussians (core and halo, from optics.js), so every signal is the specimen convolved with
// them analytically: point atoms become Gaussians whose peak falls as 1/σ², edges widen with σ, and fine
// texture is damped by exp(−2π²σ²/L²). The result is the fraction of the beam reaching the detector.

const TAU = 2 * Math.PI;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v - 0.5; }
// band-limited film texture at scale L (nm), damped by the probe σ
function texture(x, y, L, s, oct = 4) { let t = 0, a = 1, l = L; for (let i = 0; i < oct; i++) { t += a * Math.exp(-19.74 * (s * s) / (l * l)) * vnoise(x / l + i * 7.1, y / l - i * 3.3); a *= 0.55; l *= 0.5; } return t; }
const erfc = (x) => { const z = Math.abs(x), t = 1 / (1 + 0.5 * z), r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; };
const cover = (sd, s) => 0.5 * erfc(sd / (Math.SQRT2 * Math.max(s, 1e-6))); // blurred inside-ness of a signed distance

// ------------------------------------------------------------------ zinc oxide crystals (1938, bright field on film)
// Smoke crystals: hexagonal needles and small plates on a thin collodion film. Each: centre, half length, half
// width, angle. Thickness ∝ width; transmission exp(−t/λ).
const ZNO = (() => { const r = rng(1938), out = [];
  for (let i = 0; i < 420; i++) { const x = (r() - 0.5) * 40000, y = (r() - 0.5) * 40000, plate = r() < 0.3;
    const w = plate ? 120 + r() * 600 : 25 + r() * 220, l = plate ? w * (0.9 + 0.3 * r()) : w * (4 + 14 * r());
    out.push({ x, y, l, w, a: r() * Math.PI, plate }); }
  // a cluster near the start position, so there is something to focus on
  for (let i = 0; i < 26; i++) { const a = r() * TAU, d = r() * 2500, w = 30 + r() * 160; out.push({ x: d * Math.cos(a), y: d * Math.sin(a), l: w * (3 + 10 * r()), w, a: r() * Math.PI, plate: false }); }
  return out; })();
function znoT(x, y, s) {
  let t = 0;
  for (const c of ZNO) {
    const dx = x - c.x, dy = y - c.y, R = c.l + 4 * s + 50;
    if (dx > R || dx < -R || dy > R || dy < -R) continue;
    const ca = Math.cos(c.a), sa = Math.sin(c.a), u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    // a hexagonal plate, or a needle tapering to a point
    const sd = c.plate ? Math.max(Math.abs(v) * 1.1547, Math.abs(u) * 0.5774 + Math.abs(v) * 0.5774 * 1.1547) - c.w
      : Math.max(Math.abs(v) - c.w * Math.min(1, (c.l - Math.abs(u)) / (1.6 * c.w)), Math.abs(u) - c.l);
    t += cover(sd, s) * (c.plate ? 0.55 * c.w : c.w * 1.4);
  }
  return t;
}
export function zno(x, y, pr) {
  const tc = znoT(x, y, pr.sc), th = pr.w < 0.999 ? znoT(x, y, pr.sh) : tc;
  const film = 1 + 0.06 * texture(x, y, 120, pr.sc, 3);
  const T = (t) => Math.exp(-t / 260) * 0.92 * film;
  return pr.w * T(tc) + (1 - pr.w) * T(th);
}

// ------------------------------------------------------------------ uranium atoms on thin carbon (1970)
// Single uranium atoms (and a few small clusters) from a uranyl stain, on a carbon film about 2 nm thick.
const U = (() => { const r = rng(1970), pts = [];
  for (let i = 0; i < 2600; i++) { const x = (r() - 0.5) * 400, y = (r() - 0.5) * 400; pts.push([x, y]);
    if (r() < 0.12) for (let k = 0; k < 1 + Math.floor(r() * 4); k++) pts.push([x + (r() - 0.5) * 0.9, y + (r() - 0.5) * 0.9]); }
  // a strand of atoms along a molecule near the centre
  for (let i = 0; i < 40; i++) { const t = i / 39, x = -6 + 12 * t, y = 2.2 * Math.sin(t * 4.2) + (r() - 0.5) * 0.25; if (r() < 0.75) pts.push([x, y]); }
  const B = 4, bins = new Map(); for (const p of pts) { const k = `${Math.floor(p[0] / B)},${Math.floor(p[1] / B)}`; (bins.get(k) || bins.set(k, []).get(k)).push(p); }
  return { pts, bins, B }; })();
// an isolated atom, for estimating the single-atom signal to noise
export const U_REF = (() => { for (const [x, y] of U.pts) { let n = 0; for (const [a, b] of U.pts) if (Math.hypot(a - x, b - y) < 1.5) n++; if (n === 1 && Math.abs(x) < 50 && Math.abs(y) < 50) return [x, y]; } return U.pts[0]; })();
function atomSum(x, y, s, w) {
  const R = Math.max(4 * s, 0.6), B = U.B; let t = 0;
  for (let i = Math.floor((x - R) / B); i <= Math.floor((x + R) / B); i++) for (let j = Math.floor((y - R) / B); j <= Math.floor((y + R) / B); j++) {
    const L = U.bins.get(`${i},${j}`); if (!L) continue;
    for (const [px, py] of L) { const r2 = (x - px) ** 2 + (y - py) ** 2; if (r2 < R * R) t += Math.exp(-r2 / (2 * s * s)) / (TAU * s * s); }
  }
  return t * w;
}
// fraction of the beam on each detector. Z^1.7: U 92 → 2190, C 6 → 21; per nm² of carbon film ≈ 20 atoms.
export function uranium(x, y, pr, det) {
  const film = 1 + 0.18 * texture(x, y, 0.5, pr.sc) + 0.25 * texture(x, y, 25, pr.sc, 2); // thickness mottling
  const atoms = atomSum(x, y, pr.sc, pr.w) + (pr.w < 0.999 ? atomSum(x, y, pr.sh, 1 - pr.w) : 0);
  const adf = 2.2e-3 * film + 1.1e-4 * 2190 * atoms * 0.02;          // elastic scattering to the annulus
  const inel = 0.012 * film + 2.4e-4 * 9.6 * atoms * 0.02;             // inelastic (∝ Z^0.5), through the spectrometer
  if (det === 'adf') return adf;
  if (det === 'bf') return 0.92 - 0.8 * adf - 0.4 * inel;             // a weak, film-dominated shadow
  return (adf / inel) * 0.05;                                         // Crewe's ratio: film thickness cancels
}

// ------------------------------------------------------------------ silicon along [112] (2002)
// Dumbbells of two columns 0.78 Å apart on a centred rectangular lattice (a simplified projection), ADF ∝ Z^1.7.
const SI = { a: 0.384, b: 0.627, d: 0.078 };
function siSum(x, y, s) {
  const R = 4 * s + 0.1; let t = 0;
  for (let i = Math.floor((x - R) / SI.a) - 1; i <= Math.ceil((x + R) / SI.a) + 1; i++)
    for (let j = Math.floor((y - R) / SI.b) - 1; j <= Math.ceil((y + R) / SI.b) + 1; j++)
      for (const [ox, oy] of [[0, 0], [SI.a / 2, SI.b / 2]]) for (const sy of [-SI.d / 2, SI.d / 2]) {
        const r2 = (x - (i * SI.a + ox)) ** 2 + (y - (j * SI.b + oy + sy)) ** 2; if (r2 < R * R) t += Math.exp(-r2 / (2 * s * s)) / (TAU * s * s);
      }
  return t;
}
export function si112(x, y, pr, det) {
  const cols = pr.w * siSum(x, y, pr.sc) + (1 - pr.w) * siSum(x, y, pr.sh);
  const adf = 0.004 + 0.0011 * cols;
  return det === 'bf' ? 0.85 - 2.2 * adf : adf;
}

export const SPECIMENS = {
  zno: { name: 'Zinc oxide crystals', short: 'ZnO smoke crystals', signal: zno, start: [0, 0], range: 20000,
    about: 'Needles and plates of zinc oxide smoke, a favourite test object of the 1930s, on a thin collodion film. The electrons that pass straight through expose the film; the crystals stop many of them, so in the print they come out dark on a bright background.' },
  uranium: { name: 'Uranium atoms on carbon', short: 'U atoms on C', signal: uranium, start: [0, 0], range: 200,
    about: 'A carbon film about two nanometres thick carrying uranium atoms from a uranyl stain, the kind of specimen in which Crewe, Wall and Langmore saw single heavy atoms in 1970. Uranium (Z = 92) scatters about a hundred times more strongly to high angles than a carbon atom (Z = 6).' },
  si112: { name: 'Silicon [112]', short: 'Si [112] dumbbells', signal: si112, start: [0, 0], range: 50,
    about: 'Crystalline silicon viewed along [112]: pairs of atomic columns only 0.78 Å apart. Resolving these “dumbbells” was the headline of the first sub-ångström STEM images, in 2002.' },
};
