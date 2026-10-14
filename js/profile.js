// Instrument profile: the numbers that make the simulator a twin of one particular microscope.
// Everything the optics need that is a property of the instrument (not of today's settings) lives here,
// so it can be calibrated from data, saved with a session, and exchanged as JSON.
import * as P from './physics.js';

export const PROFILE_FORMAT = 'tem-view-profile/1';

// Presets are generic instrument classes, not specific commercial models.
// Parameters per modality (all used by the simulation):
//  optics (TEM, holography, in-line): dE, Cc, CsUnc, corrector, dVV, dII, convTEM
//  imaging scale (TEM, STEM, maps): magCal = true / nominal field of view
//  STEM: sourceSize (effective source at the specimen, Å FWHM), scanAspect (y/x pixel size), scanShear (°)
//  diffraction, STEM detectors, 4D-STEM, CBED, Ronchigram: camLCal = true / nominal camera length;
//    ellip / ellipAng: elliptical distortion of the projector lenses (fractional, °)
//  EDS: edsFWHM (eV at Mn Kα)        holography: holoMu0 (fringe contrast as the overlap → 0), holoCoh (nm)
const COMMON = {
  dVV: 1e-6, dII: 0.5e-6, brightness: 1e8, magCal: 1, camLCal: 1, ellip: 0, ellipAng: 0,
  sourceSize: 0.7, scanAspect: 1, scanShear: 0, edsFWHM: 128, holoMu0: 0.8, holoCoh: 25,
};
export const PRESETS = {
  generic200: {
    ...COMMON, name: 'Generic 200 kV, Schottky FEG, aberration corrector',
    gun: 'Schottky FEG', dE: 0.7, Cc: 1.2, CsUnc: 1.2, corrector: true, convTEM: 0.08,
  },
  cryo300: {
    ...COMMON, name: '300 kV cryo-TEM, Schottky FEG, no corrector',
    gun: 'Schottky FEG', dE: 0.8, Cc: 2.7, CsUnc: 2.7, corrector: false, dVV: 0.5e-6, convTEM: 0.03, sourceSize: 1.2, edsFWHM: 136,
  },
  coldfeg300: {
    ...COMMON, name: '300 kV cold FEG, probe-corrected STEM',
    gun: 'Cold FEG', dE: 0.35, Cc: 1.5, CsUnc: 1.2, corrector: true, dVV: 0.5e-6, dII: 0.3e-6, convTEM: 0.05, brightness: 5e8, sourceSize: 0.5, edsFWHM: 125,
  },
};

// Editable fields, with units and sane ranges (used by the profile editor and to validate files)
export const FIELDS = [
  ['dE', 'Energy spread (FWHM)', 'eV', 0.05, 3], ['Cc', 'Chromatic aberration Cc', 'mm', 0.1, 10], ['CsUnc', 'Spherical aberration Cs (uncorrected)', 'mm', 0.01, 10],
  ['convTEM', 'TEM illumination semi-angle', 'mrad', 0.005, 2], ['dVV', 'High-voltage instability (rms)', 'ΔV/V', 0, 1e-4], ['dII', 'Objective current instability (rms)', 'ΔI/I', 0, 1e-4],
  ['magCal', 'Magnification calibration (true / nominal)', '×', 0.5, 2], ['sourceSize', 'STEM effective source size (FWHM)', 'Å', 0.05, 5],
  ['scanAspect', 'STEM scan aspect (y / x pixel size)', '×', 0.7, 1.3], ['scanShear', 'STEM scan shear', '°', -10, 10],
  ['camLCal', 'Camera length calibration (true / nominal)', '×', 0.5, 2], ['ellip', 'Diffraction ellipticity', 'fraction', 0, 0.2], ['ellipAng', 'Ellipticity axis', '°', -180, 180],
  ['edsFWHM', 'EDS resolution at Mn Kα', 'eV', 110, 250], ['holoMu0', 'Holography fringe contrast (overlap → 0)', '', 0.05, 1], ['holoCoh', 'Holography coherence width', 'nm', 1, 500],
];

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
  for (const k of Object.keys(base)) if (k in o && typeof o[k] === typeof base[k] && typeof o[k] !== 'object') base[k] = o[k];
  if (typeof o.name === 'string') base.name = o.name.slice(0, 120);
  if (typeof o.gun === 'string') base.gun = o.gun.slice(0, 60);
  if (o.calibrated && typeof o.calibrated === 'object') base.calibrated = JSON.parse(JSON.stringify(o.calibrated));
  for (const [k, label, , lo, hi] of FIELDS) if (!(base[k] >= lo && base[k] <= hi)) throw new Error(`${label} out of range (${base[k]})`);
  return base;
}
