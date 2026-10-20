// Electron optics of Knoll and Ruska's 1931 two-coil tube and Ruska's 1933 microscope.
// Magnetic lenses follow Busch: 1/f ∝ ∫B² dz / U*, so f = f0 (U*/U*ref) / x² for a coil current x (relative).
// Units: mm along the column, µm in the specimen plane, kV, mA. Pure functions: also runs in Node.

export const relV = (kV) => { const V = kV * 1e3; return V * (1 + 0.9785e-6 * V); };
export const lambdaPm = (kV) => 1226.4 / Math.sqrt(Math.max(relV(kV), 1)); // λ = h / √(2 m e U*)

const focal = (f0, kV, kVref, x) => (f0 * relV(kV)) / relV(kVref) / (x * x);
const conj = (f, d) => 1 / (1 / f - 1 / d); // thin lens: the distance conjugate to d

// Geometry and lens data. 1933 numbers follow Ruska, Z. Physik 87, 580 (1934): objective f ≈ 6 mm at 75 kV,
// intermediate image ≈ 85×, two stages to ≈ 12,000×, a 10 × 11 cm final screen; 1931: 3.6 × 4.8 ≈ 17.4× at 50 kV.
export const INSTRUMENTS = {
  1931: {
    year: 1931, name: 'Knoll and Ruska two-coil tube', kVref: 50, kVmax: 60,
    fo0: 50, u: 63.9, fp0: 60, fpMin: 30, L2: 348, D: 302.4, Lis: null,
    alpha: 3e-3, Cs: 60, Cc: 50, vib: 0.5,
    screen: 60, isScreen: null, hole: null,
    rotO: 25, rotP: 30, condenser: false, rBeam: 2500, magnet: false, phosphor: 0.5,
    oc: [0.85, 1.15], of: [-0.01, 0.01], p: [0.86, 1.12],
    specimens: ['grid'],
  },
  1933: {
    year: 1933, name: 'Ruska’s two-stage microscope', kVref: 75, kVmax: 80,
    fo0: 6.0, u: 6.0706, fp0: 2.1, fpMin: 2.1, L2: 300, D: 523.1, Lis: 516,
    alpha: 0.01, Cs: 8, Cc: 6, vib: 3,
    screen: 90, isScreen: 40, hole: 0.5,
    rotO: 70, rotP: 110, condenser: true, rBeam: 300, rMin: 2.5, magnet: true, phosphor: 1,
    oc: [0.75, 1.2], of: [-0.004, 0.004], p: [0.22, 1],
    specimens: ['mesh', 'cotton', 'foil', 'wing', 'diatom'],
  },
};

// Everything the image needs from the knobs. s: { inst, kV, oc, of, p, c, q, view: 'final'|'inter', magnet:[x,y] }
export function optics(s) {
  const I = INSTRUMENTS[s.inst];
  const kV = Math.max(s.kV, 1);
  const Vr = relV(kV), Vref = relV(I.kVref);
  const o = s.oc + s.of;
  const fo = focal(I.fo0, kV, I.kVref, o);
  // the projector saturates: its focal length cannot drop below the pole-piece minimum (Ruska 1934, §B.2)
  const fp = Math.max(I.fpMin * Math.sqrt(Vr / Vref), focal(I.fp0, kV, I.kVref, s.p));
  const up = conj(fp, I.L2);                       // projector object plane, measured up from the projector
  const Mp = I.L2 / up;
  const vFinal = I.D - up;                         // where the objective must put the intermediate image
  const inter = s.view === 'inter' && I.Lis;
  const v = inter ? I.Lis : vFinal;
  const uf = fo < v ? conj(fo, v) : Infinity;      // the specimen distance the objective is focused on
  const dz = Number.isFinite(uf) ? (uf - I.u) * 1e3 : 1e6; // defocus in µm (+ = focused below the specimen)
  const Mo = v / I.u;
  const M = inter ? Mo : Mo * Mp;
  // magnetic image rotation ∝ NI / √U* (NI ∝ x √U*ref here); each real stage also inverts the image
  const k = Math.sqrt(Vref / Vr);
  const rot = (I.rotO * o * k + (inter ? 0 : I.rotP * s.p * k)) * Math.PI / 180 + (inter ? Math.PI : 0);
  // illumination: the condenser images the cathode crater onto the specimen at its crossover current
  let rs = I.rBeam, cx = 0.82 * Math.sqrt(Vr / relV(75));
  if (I.condenser) rs = I.rMin + I.rBeam * Math.min(1, Math.abs(1 - s.c / cx));
  const alphaIll = I.condenser ? 0.012 * Math.pow(I.rMin / rs, 0.7) : 0;
  const alpha = Math.hypot(I.alpha, alphaIll);
  // Earth's field bends the beam off axis (∝ 1/√U*); the hand magnet pushes it back (1933)
  const ek = Math.sqrt(relV(75) / Vr);
  const beamOff = I.magnet ? [160 * ek + (s.magnet?.[0] || 0), -105 * ek + (s.magnet?.[1] || 0)] : [0, 0];
  const field = (inter ? I.isScreen : I.screen) * 1e3 / M; // µm across the viewing window
  return { I, kV, Vr, o, fo, fp, up, Mp, Mo, M, v, vFinal, dz, rot, rs, cx, alpha, alphaIll, beamOff, field, inter: !!inter, lambda: lambdaPm(kV) };
}

// The blur budget, as Gaussian σ in nm. δ: HV ripple rms (relative), vib: vibration rms (nm).
export function blur(op, delta, vib) {
  const a = op.alpha, I = op.I;
  const parts = {
    focus: (a * Math.abs(op.dz) * 1e3) / 2,
    chromatic: (I.Cc * 1e6 * a * delta) / 2,
    spherical: 0.125 * I.Cs * 1e6 * a ** 3,
    diffraction: (0.26 * op.lambda * 1e-3) / a,
    vibration: vib,
  };
  const sigma = Math.sqrt(Object.values(parts).reduce((t, x) => t + x * x, 0));
  return { parts, sigma };
}

// Ruska's measure (1934, eq. 2): d = 2 z / β, z the dark-to-bright zone of an edge on the plate.
// For a Gaussian blur the 10–90 % zone is 2.56 σ in the specimen, so d = 5.1 σ.
export const ruskaD = (sigmaNm) => 5.12 * sigmaNm;

// Contrast of a weak periodic detail of period P (nm) under blur σ (nm)
export const mtf = (sigmaNm, periodNm) => Math.exp(-2 * Math.PI ** 2 * (sigmaNm / periodNm) ** 2);

// Relative brightness at the screen center: current density on the specimen spread over M².
// The phosphor's light grows with the beam voltage.
export const BRIGHT = 8e9;
export function screenBrightness(op, mA, center = 1) {
  const j = (mA * center) / (Math.PI * op.rs * op.rs);
  return (BRIGHT * op.I.phosphor * j * (op.kV / 75)) / (op.M * op.M);
}

// Steady-state specimen temperature rise (K): absorbed beam power, a little hotter when focused to a small spot.
export function heating(op, mA, absorb, hk, cover) {
  const focus = 1 + 0.3 * Math.log(Math.max(1, op.I.rBeam / op.rs));
  return hk * mA * op.kV * absorb * focus * cover;
}

// The objective current that focuses the specimen for the other settings (bisection on the defocus)
export function focusCurrent(s) {
  let lo = 0.3, hi = 2;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; const dz = optics({ ...s, oc: m, of: 0 }).dz; if (dz > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
