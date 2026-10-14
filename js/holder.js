// Specimen holders and what temperature does to a specimen.
// The specimen never sits exactly at the setpoint: the thermometer is on the holder tip, not the grid, so
// each holder has an offset and a fluctuation (boiling cryogen, heater regulation).

export const HOLDERS = {
  room: { name: 'Room-temperature holder', short: 'Room temperature', min: 293, max: 293, step: 1, jitter: 0.2, base: 0.02, kick: 0, tau: 20 },
  // the grid sits a few kelvin above the dewar's 77 K and can be warmed by the tip heater
  ln2: { name: 'Liquid-nitrogen cryo holder', short: 'Liquid-N₂ cryo', min: 90, max: 300, step: 1, jitter: 0.6, base: 0.05, kick: 2.5, tau: 30, offset: (T) => 6 * Math.max(0, 1 - (T - 90) / 120) },
  // continuous-flow helium: the tip reaches 4.2 K, the grid typically 8–15 K, with boiling-helium vibration
  lhe: { name: 'Liquid-helium cryo holder', short: 'Liquid-He cryo', min: 4.2, max: 100, step: 0.1, log: true, jitter: 1.5, base: 0.15, kick: 4, tau: 60, offset: (T) => 5.5 * Math.max(0, 1 - (T - 4.2) / 60) },
  // MEMS chip heater: fast and low-drift, with a ~1 % calibration error in the temperature reading
  heat: { name: 'MEMS heating holder', short: 'Heating (MEMS)', min: 293, max: 1473, step: 1, jitter: 0.6, base: 0.03, kick: 0, tau: 15, offset: (T) => 0.012 * (T - 293) },
};

// Specimen temperature (K) for a holder and setpoint at simulation time t (s).
export function specimenT(holder, set, t) {
  const H = HOLDERS[holder] ?? HOLDERS.room;
  const T0 = Math.min(H.max, Math.max(H.min, set));
  const fl = H.jitter * (0.6 * Math.sin(0.13 * t) + 0.4 * Math.sin(0.37 * t + 1.1));
  return T0 + (H.offset ? H.offset(T0) : 0) + fl;
}

// Mean-square atomic displacement (Å²), Einstein model: zero-point motion at 0 K, ∝ T when hot.
// Generic θ_E = 200 K and u_rms = 0.08 Å at room temperature.
const THETA = 200, U_RT2 = 0.0064, U02 = U_RT2 / (1 / Math.tanh(THETA / (2 * 293)));
export const u2 = (T) => U02 / Math.tanh(THETA / (2 * Math.max(1, T)));
export const u2Ratio = (T) => u2(T) / U_RT2; // relative to room temperature

// Thermal strain relative to 293 K for a room-temperature expansion coefficient α (1/K). Below ~100 K the
// expansion coefficient falls away (Debye-like), so cooling to 4 K contracts by only ~200·α.
const hT = (T, th = 80) => T - th * (1 - Math.exp(-T / th));
export const thermalStrain = (T, alpha) => alpha * (hT(T) - hT(293));

// Radiolysis: cooling slows the diffusion of radicals and fragments, so the critical dose rises by the
// specimen's cryo-protection factor cp at liquid-nitrogen temperature, and by ~30 % of that again near 10 K.
// Heating speeds the chemistry up instead.
export function radiolysisFactor(T, cp = 3) {
  const s1 = 1 / (1 + Math.exp((T - 170) / 22)), s2 = 1 / (1 + Math.exp((T - 35) / 8));
  let f = 1 + (cp - 1) * s1 + 0.3 * (cp - 1) * s2;
  if (T > 293) f *= Math.exp(-(T - 293) / 180);
  return f;
}

// Vitreous ice: crystallizes irreversibly above ~135–140 K and sublimes in vacuum above ~165 K
// (rate in nm/s, roughly ×10 every 7 K).
export const DEVITRIFY_K = 140;
export const iceSublimation = (T) => (T < 155 ? 0 : Math.min(500, Math.pow(10, (T - 175) / 7)));
