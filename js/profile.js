// Instrument profile: the numbers that make the simulator a twin of one particular microscope.
// Everything the optics need that is a property of the instrument (not of today's settings) lives here,
// so it can be calibrated from data, saved with a session, and exchanged as JSON.
import * as P from './physics.js';

export const PROFILE_FORMAT = 'tem-view-profile/1';

// Presets are generic instrument classes, not specific commercial models.
export const PRESETS = {
  generic200: {
    name: 'Generic 200 kV, Schottky FEG, aberration corrector',
    gun: 'Schottky FEG', dE: 0.7, // energy spread, eV FWHM
    Cc: 1.2, CsUnc: 1.2, corrector: true, // mm
    dVV: 1e-6, dII: 0.5e-6, // high-voltage and objective-current instability (rms, relative)
    convTEM: 0.08, // illumination semi-angle in TEM, mrad
    brightness: 1e8, // reduced brightness, A m⁻² sr⁻¹ V⁻¹
    magCal: 1, camLCal: 1, // calibration factors (measured / nominal)
  },
  cryo300: {
    name: '300 kV cryo-TEM, Schottky FEG, no corrector',
    gun: 'Schottky FEG', dE: 0.8, Cc: 2.7, CsUnc: 2.7, corrector: false,
    dVV: 0.5e-6, dII: 0.5e-6, convTEM: 0.03, brightness: 1e8, magCal: 1, camLCal: 1,
  },
  coldfeg300: {
    name: '300 kV cold FEG, probe-corrected STEM',
    gun: 'Cold FEG', dE: 0.35, Cc: 1.5, CsUnc: 1.2, corrector: true,
    dVV: 0.5e-6, dII: 0.3e-6, convTEM: 0.05, brightness: 5e8, magCal: 1, camLCal: 1,
  },
};

export const newProfile = (key = 'generic200') => ({ format: PROFILE_FORMAT, preset: key, calibrated: {}, ...structuredClone(PRESETS[key]) });

// Focal spread Δ (Å): Δ = Cc·√[(σE/E)² + (σV/V)² + (2σI/I)²] with the relativistic factor (1 + eV/mc²)/(1 + eV/2mc²).
export function focalSpread(pr, kV) {
  const E = kV * 1e3, sE = pr.dE / 2.355 / E;
  const rel = (1 + E / P.MC2) / (1 + E / (2 * P.MC2));
  return pr.Cc * 1e7 * rel * Math.sqrt(sE * sE + pr.dVV * pr.dVV + 4 * pr.dII * pr.dII);
}

// Accept a profile from a file: keep known fields, fill the rest from its preset.
export function sanitizeProfile(o) {
  if (!o || typeof o !== 'object') throw new Error('not a profile');
  const base = newProfile(PRESETS[o.preset] ? o.preset : 'generic200');
  for (const k of Object.keys(base)) if (k in o && typeof o[k] === typeof base[k]) base[k] = o[k];
  if (typeof o.name === 'string') base.name = o.name.slice(0, 120);
  if (o.calibrated && typeof o.calibrated === 'object') base.calibrated = JSON.parse(JSON.stringify(o.calibrated));
  for (const k of ['dE', 'Cc', 'CsUnc', 'convTEM']) if (!(base[k] > 0 && base[k] < 100)) throw new Error(`bad value for ${k}`);
  return base;
}
