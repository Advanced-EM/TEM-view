// Probe-forming optics of three scanning transmission microscopes. Pure functions: also runs in Node.
//
// One model serves all three eras. The gun's brightness B fixes how much current fits into a probe of a given
// geometric size: I = B · (π d_g² / 4) · (π α²). The wave part of the probe is the diffraction disc of the
// aperture α, but only out to the angle α_flat where the aberration phase χ stays within π/4: inside it the
// waves add up in a sharp core (≈ 0.61 λ/α_flat); the rest of the current is thrown into a halo whose size is
// the geometric aberration disc. So defocus, astigmatism and spherical aberration first steal current from the
// core (contrast falls) and only then blur it, as in a real Ronchigram-tuned STEM.
// Units: nm, mrad, pA, kV, s unless a name says otherwise.

const TAU = 2 * Math.PI;
export const relV = (kV) => { const V = kV * 1e3; return V * (1 + 0.9785e-6 * V); };
export const lambdaNm = (kV) => 1.2264 / Math.sqrt(relV(kV)); // λ = h / √(2 m e U*), nm
const E_CHARGE = 1.602e-19;

// The three instruments. Numbers are representative of each class of instrument and era, not measurements of
// the individual machines (see the page's notes): thermionic tungsten ~10⁴ A/cm²sr, cold field emission ~10⁸–10⁹.
export const ERAS = {
  1938: {
    year: 1938, name: 'von Ardenne’s scanning microscope', place: 'Berlin-Lichterfelde',
    kV: 23, kVmax: 30, gun: 'thermionic', B: 1e4, src: 20e3, dE: 2.0, // B in A/cm²sr; virtual source (nm); energy spread (eV)
    Cs: 15e6, Cc: 15e6, C5: 0, // nm (15 mm)
    alpha: [2, 12], demag: [200, 8000], fov: [400, 40000], // mrad, ×, nm
    vacuum: 'hv', detector: ['film'], corrector: false, inverted: false,
    frame: [60, 3600], // seconds per frame (one turn of the film drum)
    drift: 0.6, // nm/s: an unstable, warm column
    specimens: ['zno'],
  },
  1970: {
    year: 1970, name: 'Crewe’s field-emission STEM', place: 'University of Chicago',
    kV: 30, kVmax: 40, gun: 'cfeg', B: 3e8, src: 4, dE: 0.3,
    Cs: 0.4e6, Cc: 0.6e6, C5: 0,
    alpha: [4, 24], demag: [1, 60], fov: [3, 400],
    vacuum: 'uhv', detector: ['bf', 'adf', 'ratio'], corrector: false, inverted: false,
    frame: [1, 60], drift: 0.02,
    specimens: ['uranium'],
  },
  2002: {
    year: 2002, name: 'IBM’s aberration-corrected VG HB501', place: 'IBM T. J. Watson Research Center',
    kV: 120, kVmax: 120, gun: 'cfeg', B: 1e9, src: 4, dE: 0.35,
    Cs: 1.3e6, Cc: 1.3e6, C5: 3e6, // the corrector cancels Cs; residual C5 (a few mm) then sets the limit
    alpha: [8, 40], demag: [1, 150], fov: [1, 100],
    vacuum: 'uhv', detector: ['adf', 'bf'], corrector: true, inverted: true,
    frame: [1, 30], drift: 0.005,
    specimens: ['si112'],
  },
};

// χ(θ, φ) in radians: defocus C1, two-fold astigmatism A1 (magnitude, angle), C3, C5. Lengths in nm, θ in rad.
export function chi(th, ph, lam, ab) {
  const t2 = th * th;
  const v = 0.5 * t2 * (ab.C1 + ab.A1 * Math.cos(2 * (ph - ab.A1a))) + 0.25 * t2 * t2 * ab.C3 + (t2 * t2 * t2 / 6) * ab.C5;
  return (TAU / lam) * v;
}
// the largest angle (mrad) inside which |χ| ≤ π/4 in every direction, up to the aperture
export function flatAngle(lam, ab, alphaMrad) {
  const a = alphaMrad * 1e-3, n = 40;
  for (let i = 1; i <= n; i++) {
    const th = (i / n) * a;
    for (let k = 0; k < 24; k++) if (Math.abs(chi(th, (k / 24) * TAU, lam, ab)) > Math.PI / 4) return Math.max(0.3, ((i - 1) / n) * alphaMrad);
  }
  return alphaMrad;
}
// geometric aberration disc (diameter, nm) of rays at angle α: where the halo of mistuned rays lands
export function haloSize(ab, alphaMrad) {
  const a = alphaMrad * 1e-3;
  return 2 * Math.hypot(Math.abs(ab.C1) * a + ab.A1 * a, Math.abs(ab.C3) * a ** 3, Math.abs(ab.C5) * a ** 5);
}

// The probe for settings s: { era, kV, demag (×), alpha (mrad), ab: {C1, A1, A1a, C3, C5} (nm, rad), emission (0–1) }
export function probe(s) {
  const E = ERAS[s.era], kV = Math.max(s.kV, 1), lam = lambdaNm(kV);
  const ab = s.ab;
  const dg = E.src / s.demag;                                  // geometric image of the source, nm
  const a = s.alpha * 1e-3;
  const B = E.B * 1e4 * (kV / E.kV) * (s.emission ?? 1);       // A/m²sr, brightness ∝ voltage
  const I = B * (Math.PI / 4) * (dg * 1e-9) ** 2 * Math.PI * a * a * 1e12; // pA through the aperture
  const af = flatAngle(lam, ab, s.alpha);
  // FWHM of the core: the Airy disc (0.51 λ/α), the source image and the chromatic spread; the energy
  // distribution is peaked, so its effect on the core is a fraction of the full chromatic disc
  const core = Math.hypot(0.51 * lam / (af * 1e-3), dg, 0.3 * E.Cc * (af * 1e-3) * (E.dE / (kV * 1e3)));
  const w = Math.min(1, (af / s.alpha) ** 2);                  // fraction of the current in the core
  const halo = Math.max(core, haloSize(ab, s.alpha));
  return { lam, dg, I, af, core, halo, w, d50: w > 0.5 ? core : Math.hypot(core, halo) * 0.7 };
}

// Ronchigram: the shadow of an amorphous film seen through the probe-forming optics. A ray at angle θ meets the
// specimen at the position ∇χ λ/2π; where that is nearly constant (the flat region) the film is magnified
// infinitely and looks smooth. Returns the displacement (nm) for a direction (θx, θy) in rad.
export function ronchiShift(tx, ty, ab) {
  const t2 = tx * tx + ty * ty, ph = Math.atan2(ty, tx), th = Math.sqrt(t2);
  const c2 = Math.cos(2 * (ph - ab.A1a)), s2 = Math.sin(2 * (ph - ab.A1a));
  // ∂χ/∂θ · λ/2π along r, and the tangential part from A1
  const radial = th * (ab.C1 + ab.A1 * c2) + t2 * th * ab.C3 + t2 * t2 * th * ab.C5;
  const tang = -th * ab.A1 * s2;
  const cp = Math.cos(ph), sp = Math.sin(ph);
  return [radial * cp - tang * sp, radial * sp + tang * cp];
}

// electrons per pixel for a dwell time (s) and probe current (pA)
export const electrons = (pA, dwell) => (pA * 1e-12 * dwell) / E_CHARGE;
