// Instrument and UI state. One plain object, so a session can be saved as JSON and the simulator can run
// headless (tools/headless.mjs) with exactly the defaults the exhibit uses.
import { newProfile } from './profile.js';

export const defaultState = () => ({
  mode: 'stem', clarity: 'edu', spec: 'sto', thick: 15, tiltX: 0, tiltY: 0, fov: 5, cx: 0, cy: 0,
  kV: 200, dose: 400, df: 0, dfFam: { tem: -4, probe: 0 }, corrector: true, csUnc: 1.2, csCor: 5,
  objAp: 'none', alpha: 22, alpha4d: 12, detIn: 70, detOut: 200, detPreset: 'haadf',
  camL: 1000, sa: 10, beamStop: true, camera: 'screen',
  vdet: 'adf', vdIn: 14, vdOut: 60, vdX: 0, vdY: 0, vdR: 4, fdSel: -1,
  edsSel: 'all', eelsRange: 'core', eelsWin: 462, eelsWidth: 16, bgsub: true, eelsDisp: 0.25, eelsOffset: 262, eelsExp: 0.5, eelsExpLow: 0.00005, eelsCurrent: 100, dualEels: false,
  speed: 1, paused: false, showLabels: true, showElectrons: true, showGlass: true, autoRotate: false,
  ab: { A1: 0, A1a: 0, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 }, ronchAp: 45,
  cbedKind: 'cbed', alphaCB: 3, alphaLA: 40, strain: 0, holz: true,
  biprism: 100, sbR: 0.33, numCorr: true, holoView: 'holo', nFocal: 10, focalStep: 5, ilhView: 'phase',
  holder: 'room', tempSet: 293, profile: newProfile('generic200'),
});

// Keys a saved session may set (UI-only toggles are left alone).
export const SESSION_KEYS = [
  'mode', 'clarity', 'spec', 'thick', 'tiltX', 'tiltY', 'fov', 'cx', 'cy', 'kV', 'dose', 'df', 'dfFam', 'corrector', 'csUnc', 'csCor',
  'objAp', 'alpha', 'alpha4d', 'detIn', 'detOut', 'detPreset', 'camL', 'sa', 'beamStop', 'camera', 'vdet', 'vdIn', 'vdOut', 'vdX', 'vdY', 'vdR',
  'edsSel', 'eelsRange', 'eelsWin', 'eelsWidth', 'bgsub', 'eelsDisp', 'eelsOffset', 'eelsExp', 'eelsExpLow', 'eelsCurrent', 'dualEels', 'ab', 'ronchAp', 'cbedKind', 'alphaCB', 'alphaLA', 'strain', 'holz',
  'biprism', 'sbR', 'numCorr', 'holoView', 'nFocal', 'focalStep', 'ilhView', 'holder', 'tempSet', 'profile',
];
