// Instrument and UI state. One plain object, so a session can be saved as JSON and the simulator can run
// headless (tools/headless.mjs) with exactly the defaults the exhibit uses.
import { newProfile } from './profile.js';

// knob ranges with the probe corrector on (defocus C1 nm, Cs µm, A1/B2/A2 nm, A3 µm): wide enough to find
// a badly misaligned corrector, as on a real instrument
export const CORR_RANGE = { df: 300, cs: 200, A1: 500, B2: 8000, A2: 8000, A3: 80 };

export const defaultState = () => ({
  mode: 'stem', clarity: 'edu', spec: 'sto', thick: 15, tiltX: 0, tiltY: 0, fov: 5, cx: 0, cy: 0,
  kV: 200, dose: 400, df: 0, dfFam: { tem: -4, probe: 0 }, corrector: true, csUnc: 1.2, csCor: 5,
  objAp: 'none', alpha: 22, alpha4d: 12, detIn: 70, detOut: 200, detPreset: 'haadf',
  camL: 1000, sa: 10, beamStop: true, camera: 'screen',
  vdet: 'adf', vdIn: 14, vdOut: 60, vdX: 0, vdY: 0, vdR: 4, fdSel: -1,
  edsSel: 'all', eelsRange: 'core', eelsWin: 462, eelsWidth: 16, bgsub: true, eelsDisp: 0.25, eelsOffset: 262, eelsExp: 0.5, eelsExpLow: 0.00005, eelsCurrent: 100, dualEels: false,
  // EELS source (eels.js ZLP_SOURCES), collection semi-angle β (mrad), detector (ccd | direct), y axis (log | lin |
  // split), background fit on/off and its pre-edge window [eV, eV] (null: automatic), Fourier-ratio deconvolution,
  // probe position as a spectrum-image pixel [i, j] (null: the whole field), line-scan preview
  eelsSource: 'profile', eelsBeta: 20, eelsDet: 'ccd', eelsYScale: 'log', eelsFit: false, eelsPre: null, eelsDeconv: false, eelsPx: null, eelsLine: false,
  speed: 1, paused: false, showLabels: true, showElectrons: true, showGlass: true, autoRotate: false,
  ab: { A1: 0, A1a: 0, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 }, ronchAp: 45,
  cbedKind: 'cbed', alphaCB: 3, alphaLA: 40, strain: 0, holz: true,
  biprism: 100, sbR: 0.33, numCorr: true, holoView: 'holo', nFocal: 10, focalStep: 5, ilhView: 'phase',
  holder: 'room', tempSet: 293, profile: newProfile('generic200'),
  // Lorentz microscopy (lorentz.js): magnetic specimen, film thickness (nm), field of view (µm), Lorentz-lens defocus
  // (µm), illumination divergence (µrad), Foucault aperture, field of the objective lens along the beam (mT), the
  // vortex's chirality and core polarity, and the Lorentz-STEM view and probe semi-angle (µrad)
  magSpec: 'vortex', lorThick: 30, lorFov: 2.5, lorDf: -400, lorDiv: 2, lorView: 'fresnel', lorFouc: '+x', lorApR: 8,
  lorField: 0, lorChir: 1, lorPol: 1, lstemView: 'color', lorAlpha: 300,
  // cross-cutting modifiers by registry id (session.js); the Zernike plate is still objAp: 'zpp' while running
  mods: {},
  // precession (modifier ped, on SAED and CBED): on/off, cone semi-angle φ (mrad), azimuth steps, descan error (% of φ)
  pedOn: false, pedPhi: 20, pedSteps: 32, pedDescan: 0,
  // 3D ED / MicroED (ed3d.js): method (cred | step | pedt), tilt range (°), rotation speed (°/s) and frame rate, step (°)
  // and exposure (s) of stills, dose rate (e⁻/Å²/s), rotation-axis angle in the image plane (°), merging, the layer shown
  edMethod: 'cred', edStart: -40, edEnd: 40, edSpeed: 2, edFps: 4, edStep: 1, edExp: 0.5, edDoseRate: 0.05, edAxis: 20, edMerge: 'friedel', edSlice: 'hk0', edLayer: 0,
  // electron tomography (tomo.js): phantom (the specimen, or gold test beads), volume size (voxels per side),
  // signal (HAADF-STEM or BF-TEM), tilt scheme (linear | saxton), maximum tilt and step (°), dose for the whole
  // series (e⁻/Å²), alignment error (rms pixels) and centre-of-mass alignment, reconstruction (wbp | sirt), its
  // filter and iterations, the view (series | xy | xz | yz) and the slice position (fraction of the box, 0 = centre)
  tomoPhantom: 'specimen', tomoN: 96, tomoSignal: 'haadf', tomoScheme: 'linear', tomoMax: 70, tomoStep: 2, tomoDose: 1e5,
  tomoJitter: 0, tomoAlign: true, tomoRecon: 'wbp', tomoFilter: 'ramp', tomoIter: 20, tomoView: 'yz', tomoDepth: 0,
  // single-particle cryo-EM (spa.js): the particle (apo: apoferritin | bgal: β-galactosidase), particles to average, dose per micrograph (e⁻/Å²), mean underfocus (µm), a Zernike
  // phase plate, the fraction lying in one preferred orientation, the alignment error (°), pixel binning (1: 3.2 Å,
  // 2: 6.4 Å) and the view (mic | ctf | classes | map); the ice is the thickness setting
  // ptychographic tomography preview (ptychotomo.js): tilts, maximum tilt (°), probe semi-angle (mrad), dose for the
  // whole series (e⁻/Å²), MS-ePIE iterations per tilt, fusion (sirt | average) and the view (xz | xy | slices)
  ptTilts: 7, ptMax: 60, ptAlpha: 20, ptDose: 1e5, ptIters: 8, ptFusion: 'sirt', ptView: 'xz',
  spaSample: 'apo', spaN: 1000, spaDose: 40, spaDf: 1.5, spaZpp: false, spaPref: 0, spaAngErr: 2, spaBin: 1, spaView: 'mic',
  // zone axis [u, v, w] of a built-in crystal along the beam (zone.js); null: the specimen as built
  zone: null,
  // the environment's window membranes (environment.js): none | sinx | graphene | carbon, thickness per window (nm;
  // graphene: layers)
  envWin: 'none', envWinT: 20,
  // a cell sealed around the specimen (none | liquid, liquid.js): class, window short and long sides (µm), spacer gap
  // (nm), pressure difference (bar), flow (µL/min), graphene pocket size (nm), dose rate (e⁻/Å²/s), where the particle
  // sits (top: entrance window | middle | bottom: exit window), a gold precursor in the liquid, an energy filter (TEM)
  envCell: 'none', lcClass: 'sinx', lcA: 50, lcB: 200, lcGap: 150, lcDP: 1, lcFlow: 0, lcPocket: 60, lcRate: 1, lcDepth: 'middle', lcPrecursor: false, lcMetal: 'au', lcFilter: false,
  // the gas cell / environmental column (gas.js): windowed | open, the gas, pressure (mbar), the windowed cell's gap
  // (µm), the open column's path (mm); the windows' sides come from lcA, lcB and their thickness from envWinT
  gcGeom: 'windowed', gcGas: 'N2', gcP: 1000, gcGap: 5, gcPath: 2,
  // a biasing chip (bias.js): on, electrode layout (two | four | tip), gap (µm), specimen material (metal | semi |
  // insulator), source mode (V | I), waveform (dc | sweep), voltage or sweep amplitude (V), current (µA), sweep rate
  // (V/s), compliance (µA), contact resistance each (Ω), series resistance (Ω), substrate leakage (Ω), breakdown field
  // (MV/m), whether the stray field in the vacuum above and below the chip is included
  // an in situ movie (insitu.js): duration (s), frames per second, and the timeline of ramps { key, t0, t1, to }
  movOn: false, movDur: 30, movFps: 5, timeline: [],
  // the experiment's design (observables.js): its name, the question it answers, what to measure each frame
  expName: '', expGoal: '', expObs: [],
  // the kinetics' calibration (calibrate.js): 'published' (default), 'none' (the defaults) or 'user' (calibProfile)
  calib: 'published', calibProfile: null,
  bsOn: false, bsLayout: 'two', bsGap: 5, bsMat: 'semi', bsMode: 'V', bsWave: 'dc', bsV: 0, bsI: 0, bsRate: 1, bsLimit: 100, bsRc: 100, bsRs: 50, bsLeak: 1e9, bsEbd: 30, bsStray: true,
  // where the 4D-STEM scan and tomography run in a browser with WebGPU: 'auto' (the GPU, gpu.js) | 'off' (JS)
  gpu: 'auto',
  // acquisition plan overrides by technique (footprint.js): scan size, detector pixels, bit depth, dwell, ...
  plan: {},
  // hidden misalignment added to the knob settings (training scenarios); never shown in the controls
  mis: null,
});

// Keys a saved session may set (UI-only toggles are left alone).
export const SESSION_KEYS = [
  'mode', 'clarity', 'spec', 'thick', 'tiltX', 'tiltY', 'fov', 'cx', 'cy', 'kV', 'dose', 'df', 'dfFam', 'corrector', 'csUnc', 'csCor',
  'objAp', 'alpha', 'alpha4d', 'detIn', 'detOut', 'detPreset', 'camL', 'sa', 'beamStop', 'camera', 'vdet', 'vdIn', 'vdOut', 'vdX', 'vdY', 'vdR',
  'edsSel', 'eelsRange', 'eelsWin', 'eelsWidth', 'bgsub', 'eelsDisp', 'eelsOffset', 'eelsExp', 'eelsExpLow', 'eelsCurrent', 'dualEels',
  'eelsSource', 'eelsBeta', 'eelsDet', 'eelsYScale', 'eelsFit', 'eelsPre', 'eelsDeconv', 'eelsPx', 'eelsLine',
  'pedOn', 'pedPhi', 'pedSteps', 'pedDescan', 'zone',
  'edMethod', 'edStart', 'edEnd', 'edSpeed', 'edFps', 'edStep', 'edExp', 'edDoseRate', 'edAxis', 'edMerge', 'edSlice', 'edLayer',
  'tomoPhantom', 'tomoN', 'tomoSignal', 'tomoScheme', 'tomoMax', 'tomoStep', 'tomoDose', 'tomoJitter', 'tomoAlign', 'tomoRecon', 'tomoFilter', 'tomoIter', 'tomoView', 'tomoDepth', 'envWin', 'envWinT', 'envCell', 'lcClass', 'lcA', 'lcB', 'lcGap', 'lcDP', 'lcFlow', 'lcPocket', 'lcRate', 'lcDepth', 'lcPrecursor', 'lcMetal', 'lcFilter', 'gcGeom', 'gcGas', 'gcP', 'gcGap', 'gcPath', 'movOn', 'movDur', 'movFps', 'timeline', 'expName', 'expGoal', 'expObs', 'calib', 'calibProfile', 'bsOn', 'bsLayout', 'bsGap', 'bsMat', 'bsMode', 'bsWave', 'bsV', 'bsI', 'bsRate', 'bsLimit', 'bsRc', 'bsRs', 'bsLeak', 'bsEbd', 'bsStray', 'ptTilts', 'ptMax', 'ptAlpha', 'ptDose', 'ptIters', 'ptFusion', 'ptView', 'spaSample', 'spaN', 'spaDose', 'spaDf', 'spaZpp', 'spaPref', 'spaAngErr', 'spaBin', 'spaView', 'ab', 'ronchAp', 'cbedKind', 'alphaCB', 'alphaLA', 'strain', 'holz',
  'biprism', 'sbR', 'numCorr', 'holoView', 'nFocal', 'focalStep', 'ilhView', 'holder', 'tempSet', 'profile', 'mis',
  'magSpec', 'lorThick', 'lorFov', 'lorDf', 'lorDiv', 'lorView', 'lorFouc', 'lorApR', 'lorField', 'lorChir', 'lorPol', 'lstemView', 'lorAlpha',
];
