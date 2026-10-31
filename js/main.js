import * as P from './physics.js';
import { Sim, stemDetType, EELS_FULL_WELL } from './sim.js';
import * as R2 from './render2d.js';
import { Scene3D, Y } from './scene3d.js';
import { modeInfo, changeText, dataRows } from './explain.js';
import { renderComponent } from './components.js';
import * as N from './narration.js';
import { defaultState, SESSION_KEYS, CORR_RANGE } from './state.js';
import { PRESETS, newProfile, sanitizeProfile } from './profile.js';
import { HOLDERS } from './holder.js';
import { Panel } from './panel.js';
import { VirtualPanel } from './vpanel.js';
import { Acquisitions } from './acquire.js';
import { Scenarios } from './scenarios.js';
import { Voice, parseCommand, describe, EXAMPLES } from './voice.js';
import { analyze } from './analyze.js';
import { AgentBridge } from './agent.js';
import { AGENT, SUPPORT } from './config.js';
import { toNpz as npzBytes } from './export.js';
import { collectData, toNpz } from './export.js';
import { openCalibration } from './calibui.js';
import { ScriptCore, b64 } from './scripting.js';
import { PythonIDE } from './ide.js';
import { specState, modeState, setState, chipState, resetVdet as resetVdetState, optimalDefocus, dfLimits as dfLimitsOf, lorSet, tiltLimit, libGoto } from './ops.js';
import * as ML from './megalibrary.js';
import { MAGSPECS } from './lorentz.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ state
const S = defaultState();
const fam = (m) => (['tem', 'diff', 'oah', 'ilh', 'ltem'].includes(m) ? 'tem' : 'probe');
const stigXY = () => [S.ab.A1 * Math.cos((S.ab.A1a * Math.PI) / 90), S.ab.A1 * Math.sin((S.ab.A1a * Math.PI) / 90)];
const fmtS = (t) => (t < 1e-3 ? `${+(t * 1e6).toPrecision(3)} µs` : t < 1 ? `${+(t * 1e3).toPrecision(3)} ms` : `${+t.toPrecision(3)} s`);
const fmtT = (K) => `${K < 20 ? K.toFixed(1) : Math.round(K)} K (${Math.round(K - 273.15)} °C)`;
S.df = S.dfFam[fam(S.mode)];

const sim = new Sim(S);
const scene = new Scene3D($('#gl'), $('#labels'));
const mainCv = $('#detMain'), secCv = $('#detSec');

// ------------------------------------------------------------------ controls definition
const MODES = [
  ['tem', 'TEM', 'parallel-beam imaging', 'Imaging'], ['stem', 'STEM', 'scanned probe', 'Imaging'], ['4d', '4D-STEM', 'pattern per pixel', 'Imaging'],
  ['diff', 'SAED', 'selected-area diffraction', 'Diffraction'], ['cbed', 'CBED', 'convergent beam', 'Diffraction'],
  ['eds', 'EDS', 'X-ray spectra', 'Spectroscopy'], ['eels', 'EELS', 'energy loss', 'Spectroscopy'],
  ['ronch', 'Ronchigram', 'corrector tuning', 'Alignment'],
  ['oah', 'Off-axis', 'biprism holography', 'Holography'], ['ilh', 'In-line', 'focal-series exit wave', 'Holography'],
  ['ltem', 'Lorentz TEM', 'magnetic domains', 'Magnetism'], ['lstem', 'Lorentz STEM', 'DPC induction maps', 'Magnetism'],
];
// keyboard shortcuts (Ronchigram keeps 8; the holography modes were added later as 9 and 0)
const KEYS = { tem: '1', stem: '2', '4d': '3', diff: '4', cbed: '5', eds: '6', eels: '7', ronch: '8', oah: '9', ilh: '0', ltem: '-', lstem: '=' };
const logMap = (min, max) => ({ to: (v) => (Math.log(v / min) / Math.log(max / min)) * 1000, from: (t) => min * Math.pow(max / min, t / 1000) });

const NOT_RONCH = 'tem stem 4d diff eds eels cbed oah ilh';
const TILTABLE = 'tem stem 4d diff eds eels cbed oah ilh ltem lstem';
// the atomic-scale specimens and the objective lens: not in the Lorentz modes (objective off, magnetic specimens)
const NOT_LOR = 'tem stem 4d diff cbed eds eels ronch oah ilh';
const LOR = 'ltem lstem';
const CONTROLS = [
  { sec: 'The specimen' },
  { chips: 'spec', modes: NOT_LOR, opts: [['au', 'Gold on carbon'], ['si', 'Si / SiO₂'], ['sto', 'SrTiO₃ boundary'], ['gr', 'Graphene'], ['mof', 'UiO-66 (MOF)'], ['bio', 'Proteins in ice'], ['lib', 'NP megalibrary']] },
  { modes: NOT_LOR, pFn: () => { const ij = ML.nearest(S.cx / 1e4, S.cy / 1e4); return `Stage at (${(S.cx / 1e4).toFixed(3)}, ${(S.cy / 1e4).toFixed(3)}) µm: ${ij ? `particle (${ij[0]}, ${ij[1]}) of 1000 × 1000, pen block (${Math.floor(ij[0] / 100)}, ${Math.floor(ij[1] / 100)})` : 'outside the library'}. Thickness is the Si₃N₄ membrane. Script a screen with goto(i, j) in Python.`; }, show: () => S.spec === 'lib' },
  { buttons: [['loadXYZ', 'Load an XYZ file…']], modes: NOT_LOR },
  { modes: NOT_LOR, pFn: () => `${sim.spec.name.replace(/[<>&]/g, '')}. Tilt the stage to turn it; the thickness setting is the carbon support underneath.`, show: () => S.spec === 'xyz' },
  { buttons: [['libPrev', '← Particle'], ['libNext', 'Particle →'], ['libRow', 'Next row'], ['libRand', 'Random particle']], modes: NOT_LOR, show: () => S.spec === 'lib' },
  { chips: 'holder', label: 'Specimen holder', opts: Object.entries(HOLDERS).map(([k, v]) => [k, v.short]) },
  { slider: 'tempSet', label: 'Temperature setpoint', dyn: () => { const H = HOLDERS[S.holder]; return { min: H.min, max: H.max, step: H.step, log: H.log }; }, fmt: (v) => fmtT(v), show: () => S.holder !== 'room' },
  { pFn: () => `Specimen at ${fmtT(sim.temp())}${S.holder === 'room' ? '' : ` (setpoint ${fmtT(S.tempSet)}; the grid runs ${S.holder === 'heat' ? 'about 1 % hotter than the reading' : 'warmer than the holder tip'} and fluctuates by ±${HOLDERS[S.holder].jitter} K)`}. Drift ${sim.driftSpeed().toFixed(2)} Å/s.` },
  { buttons: [['newGrid', 'Load a fresh grid']], modes: NOT_LOR, show: () => S.spec === 'bio' },
  { modes: NOT_LOR, p: 'Thickness here is the ice layer. Proteins scatter only slightly more than the ice around them, so they are weak phase objects: use 1–3 µm underfocus in TEM, or the Zernike phase plate near focus.', show: () => S.spec === 'bio' },
  { modes: NOT_LOR, pFn: () => (sim.ice().t <= 0 ? 'The vitreous ice has sublimed in the vacuum and the proteins have dried out. Cool the grid below ~140 K and load a fresh grid.' : sim.devitrified ? 'The ice has crystallized (it went above ~140 K): crystallites now diffract and add patchy contrast. Only a fresh grid brings vitreous ice back.' : ''), show: () => S.spec === 'bio' && (sim.ice().t <= 0 || sim.devitrified) },
  { slider: 'thick', label: 'Thickness', min: 3, max: 150, step: 1, fmt: (v) => `${v} nm`, ends: ['thin', '', 'thick'], modes: NOT_RONCH, show: () => S.spec !== 'gr' },
  { p: 'Graphene is one atom (0.335 nm) thick, so there is no thickness to set. Above ~86 kV the beam knocks carbon atoms out: watch in TEM or STEM at 200–300 kV, then compare 60–80 kV.', modes: NOT_RONCH, show: () => S.spec === 'gr' },
  { buttons: [['restore', 'Restore pristine graphene']], modes: 'tem stem', show: () => S.spec === 'gr' },
  { modes: NOT_LOR, p: 'UiO-66 is destroyed by radiolysis after ~10 e⁻/Å² at 300 kV, and sooner at lower voltage. The dose per image accumulates while the beam is on: watch the high-order diffraction spots fade first.', show: () => S.spec === 'mof' },
  { buttons: [['fresh', 'Move to a fresh area']], modes: NOT_LOR, show: () => S.spec === 'mof' },
  { chips: 'magSpec', modes: LOR, opts: Object.entries(MAGSPECS).map(([k, v]) => [k, v.short]) },
  { modes: LOR, pFn: () => MAGSPECS[S.magSpec].about },
  { slider: 'lorThick', label: 'Film thickness', min: 10, max: 150, step: 1, fmt: (v) => `${v} nm`, modes: LOR, ends: ['thin', '', 'thick'] },
  { slider: 'lorFov', label: 'Field of view', min: 0.3, max: 10, log: true, fmt: (v) => `${v < 1 ? Math.round(v * 1000) + ' nm' : v.toFixed(2) + ' µm'}`, modes: LOR, note: 'Scroll on the image to zoom.' },
  { buttons: [['lorReset', 'Saturate and relax']], modes: LOR, show: () => S.magSpec !== 'fege' },
  { slider: 'fov', label: 'Field of view', min: 1.5, max: 120, log: true, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'tem stem 4d eds eels oah ilh', note: 'Drag the detector image to move the stage; scroll to zoom.' },
  { slider: 'tiltX', inv: 'tilt', label: 'Tilt α', dyn: () => ({ min: -tiltLimit(S), max: tiltLimit(S), step: tiltLimit(S) > 3 ? 0.5 : 0.02 }), fmt: (v) => `${v.toFixed(2)}°`, modes: TILTABLE },
  { slider: 'tiltY', inv: 'tilt', label: 'Tilt β', dyn: () => ({ min: -tiltLimit(S), max: tiltLimit(S), step: tiltLimit(S) > 3 ? 0.5 : 0.02 }), fmt: (v) => `${v.toFixed(2)}°`, ends: ['', 'zone axis', ''], modes: TILTABLE },
  { buttons: [['zone', 'Return to zone axis']], modes: TILTABLE },

  { sec: 'The electron gun' },
  { slider: 'kV', label: 'Accelerating voltage', min: 60, max: 300, step: 10, fmt: (v) => `${v} kV` },
  { chips: 'kV', small: true, opts: [[80, '80 kV · gentle'], [200, '200 kV'], [300, '300 kV · max']] },
  { slider: 'dose', label: 'Electron dose', min: 0.5, max: 20000, log: true, fmt: (v) => `${Math.round(v).toLocaleString()} e⁻/Å²`, ends: ['cryo-gentle', '', 'brutal'] },

  { sec: 'The lenses' },
  { chips: 'corrector', modes: NOT_LOR, opts: [[false, 'Uncorrected'], [true, 'Aberration corrector']] },
  { slider: 'cs', label: 'Spherical aberration Cₛ', modes: NOT_LOR, dyn: () => S.corrector ? { key: 'csCor', min: -CORR_RANGE.cs, max: CORR_RANGE.cs, step: 0.5, fmt: (v) => `${v} µm` } : { key: 'csUnc', min: 0.5, max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)} mm` } },
  { slider: 'df', label: 'Defocus', dyn: () => (S.corrector ? { min: -CORR_RANGE.df, max: CORR_RANGE.df, step: 0.1 } : S.spec === 'bio' ? { min: -4000, max: 500, step: 10 } : { min: -150, max: 150, step: 1 }), fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} nm`, ends: ['under', 'focus', 'over'], modes: 'tem stem 4d eds eels ronch oah ilh' },
  { buttons: [['optfocus', 'Optimal focus']], modes: 'tem stem 4d eds eels ronch oah ilh' },
  { chips: 'objAp', label: 'Objective aperture', modes: 'tem', opts: [['none', 'Open'], ['40', '40 µm'], ['20', '20 µm'], ['10', '10 µm'], ['df', 'Dark field'], ['zpp', 'Zernike phase plate']] },
  { slider: 'stigX', stig: 0, label: 'Objective stigmator X', min: -60, max: 60, step: 0.5, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'tem stem 4d eds eels oah ilh' },
  { slider: 'stigY', stig: 1, label: 'Objective stigmator Y', min: -60, max: 60, step: 0.5, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'tem stem 4d eds eels oah ilh' },
  { slider: 'alpha', label: 'Convergence semi-angle', dyn: () => ({ key: S.mode === '4d' ? 'alpha4d' : 'alpha' }), min: 3, max: 40, step: 0.5, fmt: (v) => `${v} mrad`, modes: 'stem 4d eds eels', ends: ['parallel-ish', '', 'wide cone'] },

  { sec: 'Off-axis holography', modes: 'oah' },
  { chips: 'holoView', label: 'Show', modes: 'oah', opts: [['holo', 'Hologram'], ['phase', 'Phase'], ['amp', 'Amplitude'], ['contour', 'Phase contours']] },
  { slider: 'biprism', label: 'Biprism voltage', min: 20, max: 250, step: 1, fmt: (v) => `${v} V`, modes: 'oah', ends: ['coarse fringes', '', 'fine, low contrast'] },
  { slider: 'sbR', label: 'Sideband aperture', min: 0.12, max: 0.5, step: 0.01, fmt: (v) => `${Math.round(v * 100)} % of carrier`, modes: 'oah', ends: ['smooth', '', 'sharp, noisy'] },
  { toggles: [['numCorr', 'Remove aberrations numerically']], modes: 'oah' },
  { p: 'The reference wave passes through vacuum beside the specimen. A positive wire voltage pulls the two waves together; where they overlap they interfere.', modes: 'oah' },

  { sec: 'In-line holography', modes: 'ilh' },
  { chips: 'ilhView', label: 'Show', modes: 'ilh', opts: [['phase', 'Exit-wave phase'], ['amp', 'Amplitude'], ['series', 'Focal series']] },
  { slider: 'nFocal', label: 'Images in the series', min: 3, max: 16, step: 1, fmt: (v) => `${v}`, modes: 'ilh' },
  { slider: 'focalStep', label: 'Focal step', min: 0.5, max: 20, step: 0.5, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'ilh', ends: ['fine', '', 'wide range'] },
  { buttons: [['refocus', 'Record a new series']], modes: 'ilh' },
  { p: 'The series is centered on the defocus set above. The dose is split between the images.', modes: 'ilh' },

  { sec: 'Lorentz microscopy', modes: LOR },
  { p: 'The objective lens is off, so its field does not magnetize the specimen; a weak Lorentz lens forms the image. Exciting the objective lens applies a field along the beam.', modes: LOR },
  { slider: 'lorField', label: 'Objective-lens field', min: 0, max: 600, step: 5, fmt: (v) => `${v} mT`, modes: LOR, ends: ['off (field-free)', '', 'strong'] },
  { chips: 'lorView', label: 'Show', modes: 'ltem', opts: [['fresnel', 'Fresnel'], ['foucault', 'Foucault'], ['tie', 'Induction (TIE)'], ['phase', 'Phase']] },
  { slider: 'lorDf', label: 'Lorentz-lens defocus', min: -3000, max: 3000, step: 10, fmt: (v) => `${v > 0 ? '+' : ''}${v} µm`, modes: 'ltem', ends: ['under', 'focus', 'over'], show: () => S.lorView !== 'foucault' && S.lorView !== 'phase' },
  { slider: 'lorDiv', label: 'Illumination divergence', min: 0.5, max: 30, log: true, fmt: (v) => `${v.toFixed(1)} µrad`, modes: 'ltem', ends: ['coherent', '', 'incoherent'] },
  { chips: 'lorFouc', label: 'Aperture passes the beams deflected', modes: 'ltem', show: () => S.lorView === 'foucault', opts: [['+x', 'right'], ['-x', 'left'], ['+y', 'up'], ['-y', 'down']] },
  { slider: 'lorApR', label: 'Foucault aperture', min: 2, max: 40, step: 0.5, fmt: (v) => `${v} µrad`, modes: 'ltem', show: () => S.lorView === 'foucault' },
  { chips: 'lstemView', label: 'Show', modes: 'lstem', opts: [['color', 'Induction map'], ['x', 'Right − left'], ['y', 'Top − bottom'], ['sum', 'Sum (BF)']] },
  { slider: 'lorAlpha', label: 'Lorentz probe semi-angle', min: 20, max: 3000, log: true, fmt: (v) => `${Math.round(v)} µrad`, modes: 'lstem', ends: ['wide probe, strong signal', '', 'fine probe, weak signal'] },

  { sec: 'Aberration corrector', modes: 'ronch' },
  { p: 'Tune on amorphous carbon: make the flat central "sweet spot" of the Ronchigram as large and round as possible. C1 and C3 are the defocus and Cₛ controls above.', modes: 'ronch' },
  { buttons: [['scramble', 'Scramble aberrations'], ['autotune', 'Auto-tune']], modes: 'ronch' },
  { slider: 'ronchAp', label: 'Ronchigram aperture', min: 20, max: 70, step: 1, fmt: (v) => `${v} mrad`, modes: 'ronch' },
  { slider: 'A1', ab: true, label: 'A1 · 2-fold astigmatism', min: 0, max: CORR_RANGE.A1, step: 0.5, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'ronch' },
  { slider: 'A1a', ab: true, label: 'A1 angle', min: 0, max: 180, step: 0.1, fmt: (v) => `${+v.toFixed(1)}°`, modes: 'ronch' },
  { slider: 'B2', ab: true, label: 'B2 · axial coma', min: 0, max: CORR_RANGE.B2, step: 2, fmt: (v) => `${v} nm`, modes: 'ronch' },
  { slider: 'B2a', ab: true, label: 'B2 angle', min: 0, max: 360, step: 0.1, fmt: (v) => `${+v.toFixed(1)}°`, modes: 'ronch' },
  { slider: 'A2', ab: true, label: 'A2 · 3-fold astigmatism', min: 0, max: CORR_RANGE.A2, step: 2, fmt: (v) => `${v} nm`, modes: 'ronch' },
  { slider: 'A2a', ab: true, label: 'A2 angle', min: 0, max: 120, step: 0.1, fmt: (v) => `${+v.toFixed(1)}°`, modes: 'ronch' },
  { slider: 'A3', ab: true, label: 'A3 · 4-fold astigmatism', min: 0, max: CORR_RANGE.A3, step: 0.1, fmt: (v) => `${v.toFixed(1)} µm`, modes: 'ronch' },
  { slider: 'A3a', ab: true, label: 'A3 angle', min: 0, max: 90, step: 0.1, fmt: (v) => `${+v.toFixed(1)}°`, modes: 'ronch' },

  { sec: 'Convergent-beam diffraction', modes: 'cbed' },
  { chips: 'cbedKind', modes: 'cbed', opts: [['cbed', 'CBED (focused probe)'], ['lacbed', 'LACBED (large angle)']] },
  { slider: 'alphaCB', label: 'Convergence semi-angle', min: 0.5, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} mrad`, modes: 'cbed', show: () => S.cbedKind === 'cbed', ends: ['separate disks', '', 'overlapping'] },
  { slider: 'alphaLA', label: 'Convergence semi-angle', min: 15, max: 70, step: 1, fmt: (v) => `${v} mrad`, modes: 'cbed', show: () => S.cbedKind === 'lacbed' },
  { slider: 'strain', label: 'Lattice strain', min: -1, max: 1, step: 0.02, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} %`, modes: 'cbed', ends: ['compressed', '', 'expanded'] },
  { toggles: [['holz', 'HOLZ lines']], modes: 'cbed' },
  { p: 'Drag the pattern to move the probe across the specimen. In LACBED the shadow image shows where each line comes from.', modes: 'cbed' },

  { sec: 'Detectors', modes: 'tem stem diff 4d eds eels' },
  { chips: 'camera', label: 'Camera', modes: 'tem diff', opts: [['screen', 'Fluorescent screen'], ['ded', 'Direct electron detector']] },
  { chips: 'detPreset', modes: 'stem', opts: [['bf', 'BF'], ['abf', 'ABF'], ['adf', 'ADF'], ['haadf', 'HAADF']] },
  { slider: 'detIn', inv: 'det', label: 'Inner angle', min: 0, max: 150, step: 1, fmt: (v) => `${v} mrad`, modes: 'stem' },
  { slider: 'detOut', inv: 'det', label: 'Outer angle', min: 5, max: 250, step: 1, fmt: (v) => `${v} mrad`, modes: 'stem' },
  { slider: 'camL', label: 'Camera length', min: 80, max: 6000, log: true, fmt: (v) => `${Math.round(v)} mm`, modes: 'diff cbed', show: () => S.mode !== 'cbed' || S.cbedKind === 'cbed', ends: ['wide angle', '', 'zoomed'] },
  { slider: 'sa', label: 'Selected area', min: 2, max: 12, step: 0.2, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'diff' },
  { toggles: [['beamStop', 'Beam stop']], modes: 'diff' },
  { chips: 'vdet', label: 'Virtual detector', modes: '4d', opts: [['bf', 'BF'], ['abf', 'ABF'], ['adf', 'ADF'], ['disk', 'Disk (DF)'], ['dpc', 'DPC'], ['com', 'Center of mass'], ['ptycho', 'Ptychography'], ['mptycho', 'Multislice ptycho']] },
  { chips: 'edsSel', label: 'Map element', modes: 'eds', dynOpts: () => [['all', 'All']].concat(sim.si ? [...new Set(sim.si.els.map((e) => e.sym))].map((s) => [s, s]) : []) },
  { chips: 'eelsRange', label: 'Spectrum range (preset)', modes: 'eels', opts: [['zlp', 'Zero loss'], ['low', 'Low loss'], ['core', 'Core loss'], ['high', 'High loss']] },
  { chips: 'eelsDisp', label: 'Dispersion (eV per channel)', small: true, modes: 'eels', opts: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1].map((v) => [v, `${v}`]) },
  { slider: 'eelsOffset', label: 'Energy offset (drift tube)', min: -50, max: 3000, step: 0.5, fmt: (v) => `${v} eV`, modes: 'eels', ends: ['zero loss', '', 'high loss'] },
  { pFn: () => { const [a, b] = sim.eelsRangeBounds(), z = sim.eels?.zlp; return `2048 channels: ${a.toFixed(1)} to ${b.toFixed(1)} eV. Energy resolution ${sim.eelsRes().toFixed(2)} eV (gun ${S.profile.dE} eV + spectrometer), sampled by ${(sim.eelsRes() / S.eelsDisp).toFixed(1)} channels${sim.eelsRes() / S.eelsDisp < 3 ? ' (too coarse: the zero loss and edge fine structure are blurred by the channels)' : ''}.${z ? ` Zero loss measured: ${z.fwhm.toFixed(2)} eV wide at ${z.center >= 0 ? '+' : ''}${z.center.toFixed(2)} eV.` : ' The zero-loss peak is outside this range.'}`; }, modes: 'eels' },
  { buttons: [['alignZLP', 'Align zero loss']], modes: 'eels' },
  { slider: 'eelsCurrent', label: 'Probe current', min: 5, max: 2000, log: true, fmt: (v) => `${Math.round(v)} pA`, modes: 'eels' },
  { slider: 'eelsExp', label: 'Exposure per readout', dyn: () => ({ label: S.dualEels ? 'Core-loss exposure' : 'Exposure per readout' }), min: 1e-4, max: 10, log: true, fmt: fmtS, modes: 'eels', ends: ['short', '', 'long'] },
  { toggles: [['dualEels', 'Dual EELS: low loss + core loss together']], modes: 'eels' },
  { slider: 'eelsExpLow', label: 'Low-loss exposure', min: 1e-5, max: 0.1, log: true, fmt: fmtS, modes: 'eels', show: () => S.dualEels },
  { pFn: () => {
    const e = sim.eels; if (!e) return '';
    const fw = Math.round(EELS_FULL_WELL).toLocaleString(), sat = (r, what) => (r.sat ? `${what}: <b>${r.sat} channels saturated</b> (peak ${Math.round(r.peak).toLocaleString()} e⁻ per channel per readout, full well ${fw})` : `${what}: peak ${Math.round(r.peak).toLocaleString()} e⁻ per channel per readout (full well ${fw})`);
    return [sat(e.ro, S.dualEels ? 'Core loss' : 'Spectrum'), e.low ? sat(e.low.ro, 'Low loss') : '', e.low?.tau != null ? `Thickness from the low loss: t/λ = ${e.low.tau.toFixed(2)}${e.low.ro.sat ? ' (wrong: the zero loss is saturated)' : ''}` : ''].filter(Boolean).join('. ').replace(/<\/?b>/g, '') + '.';
  }, modes: 'eels' },
  { slider: 'eelsWin', inv: 'eelsWin', label: 'Energy window center', dyn: () => { const [a, b] = sim.eelsRangeBounds(); return { min: Math.max(0, a), max: b, step: b - a > 500 ? 1 : b - a > 50 ? 0.5 : 0.05 }; }, fmt: (v) => `${v < 20 ? v.toFixed(2) : v.toFixed(0)} eV`, modes: 'eels' },
  { slider: 'eelsWidth', inv: 'eelsWin', label: 'Window width', min: 0.5, max: 80, step: 0.5, fmt: (v) => `${v} eV`, modes: 'eels' },
  { toggles: [['bgsub', 'Subtract background']], modes: 'eels' },

  { sec: 'Time' },
  { slider: 'speed', inv: 'none', label: 'Simulation speed', min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { buttons: [['pause', 'Pause'], ['resetView', 'Reset view']] },
  { sec: 'Show' },
  { toggles: [['showLabels', 'Labels'], ['showElectrons', 'Electrons'], ['showGlass', 'Glass column'], ['autoRotate', 'Slow orbit']], grid: true },
  { sec: 'Experiments' },
  { exp: 'single', title: 'One electron at a time', desc: 'Dim the beam until electrons arrive singly. Watch the pattern emerge from random dots.', icon: 'dots' },
  { exp: 'tour', title: 'Fly down the column', desc: 'Follow an electron from the gun to the detector, one component at a time.', icon: 'path' },
  { sec: 'Training scenarios' },
  { p: 'Alignment tasks with a hidden answer, as on a real microscope: the knob readings are not the true aberrations. With your consent the session is recorded (no personal data, nothing sent anywhere) to study how people align and judge an instrument.' },
  { buttons: [['scn:tem-direct-align', 'TEM: direct alignments'], ['scn:tem-focus-stig', 'TEM: focus and stigmate'], ['scn:corrector-ronch', 'Corrector: tune the Ronchigram']] },
  { buttons: [['replayFile', 'Replay a session file…'], ['lastSession', 'Download last session']] },
  { sec: 'Voice and agent' },
  { p: 'Turn on AI mode with the brain button at the top of the controls (or <kbd>/</kbd>) and type a command, or hold <kbd>M</kbd> and say it: "switch to STEM", "defocus minus fifty", "load graphene", "acquire", "fit the CTF", "index the rings". Close misses are confirmed before they run. Connect an AI agent (temview-mcp, for example with emskills) to answer questions and run the microscope with you.' },
  { buttons: [['voiceHelp', 'What can I say?'], ['agent', 'Connect agent']] },
  { sec: 'Python scripting' },
  { p: 'Script the microscope in Python: set the optics, acquire NumPy data, run analyses, and test automation against a hidden misalignment (challenges). The IDE runs Python in this browser; the same scripts run on a desktop with <code>tools/temview-py</code>, headless or driving this exhibit. Shortcut <kbd>P</kbd>.' },
  { buttons: [['ide', 'Open the Python IDE']] },
  { sec: 'Digital twin' },
  { p: 'The instrument profile holds what belongs to one particular microscope (energy spread, Cc, Cs, illumination). Calibrate it from your own data, save the whole session, and export what the detectors record.' },
  { chips: 'profile', label: 'Instrument profile', get: () => S.profile.preset, dynOpts: () => Object.entries(PRESETS).map(([k, v]) => [k, v.name.split(',')[0]]) },
  { twin: true },
  { buttons: [['calib', 'Calibrate from data…']] },
  { buttons: [['saveSession', 'Save session'], ['loadSession', 'Load session']] },
  { buttons: [['exportData', 'Export data (.npz)'], ['exportProfile', 'Export profile']] },
  { sec: 'Instrument readout' },
  { table: true },
];

const ICONS = {
  dots: '<svg viewBox="0 0 32 32"><g fill="currentColor"><circle cx="8" cy="10" r="1.6"/><circle cx="15" cy="7" r="1.2"/><circle cx="22" cy="12" r="1.8"/><circle cx="11" cy="18" r="1.3"/><circle cx="19" cy="21" r="1.6"/><circle cx="25" cy="24" r="1.1"/><circle cx="7" cy="25" r="1"/><circle cx="16" cy="14" r="2.3" opacity=".9"/></g></svg>',
  path: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 3v5M10 10h12M16 8c-5 5 5 9 0 14M9 22h14M16 22v7"/><circle cx="16" cy="29" r="1.6" fill="currentColor"/></svg>',
};

// ------------------------------------------------------------------ build controls
const panel = $('#controlsBody');
const bound = [];
// on narrow screens, control sections fold; these start folded
const folded = new Set(['Time', 'Show', 'Instrument readout']);
function build() {
  let secName = null;
  for (const c of CONTROLS) {
    let el;
    if (c.sec) {
      el = document.createElement('h3');
      el.className = 'sec';
      el.textContent = c.sec;
      secName = c.sec;
      const name = c.sec;
      el.addEventListener('click', () => {
        if (!document.body.classList.contains('stacked')) return;
        folded.has(name) ? folded.delete(name) : folded.add(name);
        refreshControls();
      });
      bound.push({ c, el });
    } else if (c.slider) {
      el = document.createElement('div');
      el.className = 'ctl slider';
      el.innerHTML = `<div class="row"><label>${c.label}</label><span class="val"></span></div><input type="range"><div class="ends">${(c.ends || ['', '', '']).map((e) => `<span>${e}</span>`).join('')}</div>${c.note ? `<p class="note">${c.note}</p>` : ''}`;
      if (!c.ends) el.querySelector('.ends').remove();
      const input = el.querySelector('input');
      input.addEventListener('input', () => {
        const d = sliderDef(c);
        const v = d.log ? logMap(d.min, d.max).from(+input.value) : +input.value;
        if (c.ab) { S.ab[c.slider] = +v; sim.invalidate('ab'); refreshControls(); explainChange('ab'); return; }
        if (c.stig !== undefined) { // the stigmator pair sets the two-fold astigmatism A1 as an (X, Y) vector
          const xy = stigXY(); xy[c.stig] = +v;
          S.ab.A1 = +Math.hypot(xy[0], xy[1]).toFixed(2); S.ab.A1a = Math.round(((Math.atan2(xy[1], xy[0]) * 90) / Math.PI + 180) % 180);
          sim.invalidate('ab'); refreshControls(); explainChange('ab'); return;
        }
        set(d.key, d.log ? v : +v.toFixed(4), c.inv ?? (c.slider === 'cs' ? 'cs' : c.slider === 'alpha' ? 'alpha' : d.key));
      });
      bound.push({ c, el, input, val: el.querySelector('.val') });
    } else if (c.chips) {
      el = document.createElement('div');
      el.className = 'ctl';
      el.innerHTML = `${c.label ? `<div class="row"><label>${c.label}</label></div>` : ''}<div class="chips${c.small ? ' small' : ''}"></div>`;
      const box = el.querySelector('.chips');
      bound.push({ c, el, box });
      renderChips({ c, box });
    } else if (c.buttons) {
      el = document.createElement('div');
      el.className = 'ctl buttons';
      for (const [id, text] of c.buttons) {
        const b = document.createElement('button');
        b.className = 'btn'; b.dataset.act = id; b.textContent = text;
        b.addEventListener('click', () => action(id, b));
        el.appendChild(b);
      }
      bound.push({ c, el });
    } else if (c.toggles) {
      el = document.createElement('div');
      el.className = 'ctl toggles' + (c.grid ? ' grid' : '');
      for (const [key, text] of c.toggles) {
        const b = document.createElement('button');
        b.className = 'tog'; b.dataset.key = key;
        b.innerHTML = `<i></i>${text}`;
        b.addEventListener('click', () => set(key, !S[key], key));
        el.appendChild(b);
      }
      bound.push({ c, el });
    } else if (c.exp) {
      el = document.createElement('button');
      el.className = 'exp';
      el.dataset.exp = c.exp;
      el.innerHTML = `<span class="ico">${ICONS[c.icon]}</span><span><b>${c.title}</b><small>${c.desc}</small></span>`;
      el.addEventListener('click', () => action(c.exp, el));
      bound.push({ c, el });
    } else if (c.p || c.pFn) {
      el = document.createElement('p');
      el.className = 'ctl note';
      el.innerHTML = c.p ?? '';
      bound.push({ c, el });
    } else if (c.twin) {
      el = document.createElement('table');
      el.className = 'data twin';
      el.innerHTML = '<tbody id="twinBody"></tbody>';
      bound.push({ c, el });
    } else if (c.table) {
      el = document.createElement('table');
      el.className = 'data';
      el.innerHTML = '<tbody id="dataBody"></tbody>';
      bound.push({ c, el });
    }
    if (c.modes) el.dataset.modes = c.modes;
    bound[bound.length - 1].sec = secName;
    panel.appendChild(el);
  }
  // section visibility is inherited: elements after a moded section header share its modes
  let secModes = null;
  for (const b of bound) if (b.c.sec) secModes = b.c.modes || null; else if (secModes && !b.c.modes) b.el.dataset.modes = secModes;
  document.querySelectorAll('h3.sec[data-modes]').forEach(() => {});
  for (const b of bound) if (b.c.sec && b.c.modes) b.el.dataset.modes = b.c.modes;
}
function sliderDef(c) {
  const d = { key: c.slider, min: c.min, max: c.max, step: c.step ?? 0.01, log: c.log, fmt: c.fmt };
  if (c.dyn) Object.assign(d, c.dyn());
  return d;
}
function chipOpts(c) { return c.dynOpts ? c.dynOpts() : c.opts; }
function renderChips({ c, box }) {
  const opts = chipOpts(c);
  const sig = JSON.stringify(opts);
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.innerHTML = '';
    for (const [v, text] of opts) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = text;
      b.dataset.v = JSON.stringify(v);
      b.addEventListener('click', () => chip(c.chips, v));
      box.appendChild(b);
    }
  }
  const cur = c.get ? c.get() : S[c.chips];
  box.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', JSON.stringify(cur) === b.dataset.v));
}

function refreshControls() {
  document.body.dataset.mode = S.mode;
  for (const b of bound) {
    const stacked = document.body.classList.contains('stacked');
    if (b.c.sec) b.el.classList.toggle('closed', stacked && folded.has(b.c.sec));
    const vis = (!b.el.dataset.modes || b.el.dataset.modes.split(' ').includes(S.mode)) && (!b.c.show || b.c.show()) && !(stacked && !b.c.sec && folded.has(b.sec));
    b.el.hidden = !vis;
    if (!vis) continue;
    if (b.input) {
      const d = sliderDef(b.c);
      const lm = d.log ? logMap(d.min, d.max) : null;
      b.input.min = d.log ? 0 : d.min; b.input.max = d.log ? 1000 : d.max; b.input.step = d.log ? 1 : d.step;
      const v = b.c.ab ? S.ab[d.key] : b.c.stig !== undefined ? stigXY()[b.c.stig] : S[d.key];
      b.input.value = lm ? lm.to(v) : v;
      const p = ((+b.input.value - +b.input.min) / (+b.input.max - +b.input.min)) * 100;
      b.input.style.setProperty('--p', `${clamp(p, 0, 100)}%`);
      b.val.textContent = (d.fmt || b.c.fmt)(v);
      if (d.label) b.el.querySelector('label').textContent = d.label;
    }
    if (b.box) renderChips(b);
    if (b.c.pFn) b.el.textContent = b.c.pFn();
    if (b.c.toggles) b.el.querySelectorAll('.tog').forEach((t) => t.classList.toggle('on', !!S[t.dataset.key]));
  }
  document.querySelectorAll('[data-act="pause"]').forEach((b) => (b.textContent = S.paused ? 'Resume' : 'Pause'));
  document.querySelectorAll('.exp').forEach((e) => e.classList.toggle('on', (e.dataset.exp === 'single' && !!sim.single) || (e.dataset.exp === 'tour' && !!scene.tour)));
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('.clarity button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.clarity));
  const singleOk = !['eds', 'eels', 'ilh', 'ltem', 'lstem'].includes(S.mode);
  const se = $('.exp[data-exp="single"]');
  if (se) se.classList.toggle('disabled', !singleOk);
  if ($('#infoTitle')) { renderInfo(); updateDetectorHeader(); }
}

// ------------------------------------------------------------------ state changes
function set(key, v, inv = key) {
  inv = setState(S, sim, key, v, inv);
  if (inv === null) return;
  refreshControls();
  explainChange(inv === 'cs' ? 'cs' : ['tiltX', 'tiltY'].includes(key) ? 'tilt' : ['detIn', 'detOut'].includes(key) ? 'det' : ['alpha', 'alpha4d'].includes(key) ? 'alpha' : ['eelsWin', 'eelsWidth'].includes(key) ? 'eelsWin' : key);
}

function chip(key, v) {
  if (key === 'spec') return setSpec(v);
  if (key === 'profile') return setProfile(newProfile(v), 'profile');
  const why = chipState(S, sim, key, v);
  if (why) { refreshControls(); return explainChange(why); }
  set(key, v, key === 'kV' ? 'kV' : key);
}

const resetVdet = () => resetVdetState(S, sim);

function setSpec(v) {
  specState(S, sim, v);
  refreshControls();
  explainChange('spec');
}

function setMode(m) {
  if (m === S.mode) return;
  if (scn?.recorder.active) scn.recorder.event('mode', { from: S.mode, to: m });
  modeState(S, sim, m);
  infoOpen = false;
  refreshControls();
  renderInfo();
  explainChange(null);
  updateDetectorHeader();
  if (autoNarrate) N.speak('mode-' + m);
  else if (N.playing()?.startsWith('mode-')) N.stop();
}

function action(id, el) {
  if (id.startsWith('scn:')) return scn.start(id.slice(4));
  if (id === 'voiceHelp') { setAI(true); return voice.handle('help'); }
  if (id === 'ide') return ide.toggle();
  if (id === 'agent') return agent.connected || agent.status === 'connecting' ? agent.disconnect() : agent.connect();
  if (id === 'replayFile') return $('#fileReplay').click();
  if (id === 'lastSession') { if (scn.lastSession) scn.downloadSession(scn.lastSession); else { $('#change').hidden = false; $('#change').innerHTML = '<small>No recorded session yet</small><p>Run a training scenario with recording on, then download it here.</p>'; } return; }
  if (scn.blocked(id)) { scn.recorder.event('blocked', { id }); $('#change').hidden = false; $('#change').innerHTML = '<small>Not in this task</small><p>Automatic tuning is disabled in this scenario: the point is to see how people do it by hand.</p>'; return; }
  if (scn.recorder.active) scn.recorder.event('button', { id });
  if (id === 'zone') { S.tiltX = 0; S.tiltY = 0; sim.invalidate('tilt'); refreshControls(); explainChange('tilt'); }
  if (id === 'optfocus') set('df', optimalDefocus(S, sim), 'df');
  if (id === 'pause') { S.paused = !S.paused; refreshControls(); }
  if (id === 'alignZLP') { sim.alignZLP(); explainChange('alignZLP'); }
  if (id === 'refocus') { sim.invalidate('series'); explainChange('series'); }
  if (id === 'newGrid') { sim.newGrid(); sim.invalidate('spec'); refreshControls(); explainChange('newGrid'); }
  if (id === 'calib') openCalibration({ S, sim, onApply: applyCalibration });
  if (id === 'saveSession') saveSession();
  if (id === 'loadSession') $('#fileSession').click();
  if (id === 'exportData') exportData();
  if (id === 'exportProfile') download(new Blob([JSON.stringify(S.profile, null, 1)], { type: 'application/json' }), `instrument-profile-${S.profile.preset}.json`);
  if (id === 'restore') { sim.restoreSpecimen(); explainChange('restore'); }
  if (id === 'lorReset') {
    // saturate and relax: the vortex (or the Landau pattern) comes back with a random sense, and a random core
    S.lorChir = Math.random() < 0.5 ? -1 : 1; S.lorPol = Math.random() < 0.5 ? -1 : 1;
    sim.invalidate('magnet'); explainChange('lorReset');
  }
  if (id === 'loadXYZ') {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.xyz,chemical/x-xyz,text/plain' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      const esc = (t) => String(t).replace(/[<>&]/g, '');
      try { P.loadXYZ(await f.text(), f.name); setSpec('xyz'); }
      catch (err) { $('#change').hidden = false; $('#change').innerHTML = `<small>Could not load ${esc(f.name)}</small><p>${esc(err.message)}</p>`; }
    });
    inp.click();
  }
  if (id.startsWith('lib')) {
    const [i, j] = ML.nearest(S.cx / 1e4, S.cy / 1e4) ?? [0, 0], n = ML.LIB.n;
    const to = { libPrev: [Math.max(0, i - 1), j], libNext: [Math.min(n - 1, i + 1), j], libRow: [i, Math.min(n - 1, j + 1)], libRand: [Math.floor(Math.random() * n), Math.floor(Math.random() * n)] }[id];
    if (to) { libGoto(S, sim, ...to, true); refreshControls(); explainChange('stage'); }
  }
  if (id === 'fresh') { S.cx += 6 * (Math.random() - 0.5); sim.freshArea(); sim.invalidate('stage'); explainChange('fresh'); }
  if (id === 'scramble') {
    const r = () => Math.random();
    S.ab = { A1: 15 + 45 * r(), A1a: Math.round(180 * r()), B2: 150 + 500 * r(), B2a: Math.round(360 * r()), A2: 100 + 500 * r(), A2a: Math.round(120 * r()), A3: 2 + 6 * r(), A3a: Math.round(90 * r()) };
    for (const k of ['A1', 'B2', 'A2']) S.ab[k] = Math.round(S.ab[k]);
    S.ab.A3 = +S.ab.A3.toFixed(1);
    if (S.corrector) { S.csCor = Math.round(-25 + 50 * r()); }
    S.df = S.dfFam.probe = +(-40 + 80 * r()).toFixed(1);
    sim.invalidate('ab'); refreshControls(); explainChange('scramble');
  }
  if (id === 'autotune') autoTune();
  if (id === 'resetView') scene.resetView();
  if (id === 'single') {
    if (['eds', 'eels', 'ilh', 'ltem', 'lstem'].includes(S.mode)) return;
    sim.startSingle(!sim.single);
    refreshControls();
    explainChange('single');
  }
  if (id === 'tour') {
    if (scene.tour) { scene.stopTour(); return; }
    scene.startTour(tourStops(), (s, i, n) => {
      const cap = $('#tourCap');
      if (!s) { cap.hidden = true; refreshControls(); return; }
      cap.hidden = false;
      cap.innerHTML = `<small>${i + 1} / ${n}</small><b>${s.title}</b><p>${s.text}</p>`;
      cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in');
      refreshControls();
    });
    refreshControls();
  }
}

// Corrector software: measure, then null aberrations order by order (as real correctors do).
let tuning = null;
function autoTune() {
  if (tuning) return;
  if (!S.corrector) chip('corrector', true);
  const steps = [
    ['Measuring aberrations from Ronchigram…', {}],
    ['1st order: defocus C1 and 2-fold astigmatism A1', { df: 0, A1: 0 }],
    ['2nd order: axial coma B2 and 3-fold astigmatism A2', { B2: 0, A2: 0 }],
    ['3rd order: spherical aberration C3 and 4-fold A3', { csCor: 1, A3: 0 }],
    ['Fine-tuning residuals', { df: 0, A1: 0, B2: 0, A2: 0, A3: 0, csCor: 1 }],
  ];
  let i = 0;
  const log = [];
  const next = () => {
    if (i >= steps.length) { tuning = null; explainChange('autotuned'); return; }
    const [msg, target] = steps[i++];
    log.push(msg);
    $('#change').hidden = false;
    $('#change').innerHTML = `<small>Corrector software</small><p>${log.map((l, k) => `${k === log.length - 1 ? '▸' : '✓'} ${l}`).join('<br>')}</p>`;
    const from = { df: S.df, csCor: S.csCor, ...S.ab }, t0 = performance.now();
    const anim = () => {
      const f = Math.min(1, (performance.now() - t0) / 900), e = 1 - Math.pow(1 - f, 3);
      for (const [k, v] of Object.entries(target)) {
        const res = (Math.random() - 0.5) * (k === 'df' ? 0.4 : k === 'csCor' ? 0.6 : k === 'A3' ? 0.1 : 2);
        const goal = v + (f === 1 ? res * 0.3 : 0);
        const val = from[k] + (goal - from[k]) * e;
        if (k === 'df') { S.df = S.dfFam.probe = +val.toFixed(1); }
        else if (k === 'csCor') S.csCor = Math.round(val);
        else S.ab[k] = k === 'A3' ? +Math.max(0, val).toFixed(1) : Math.max(0, Math.round(val));
      }
      sim.invalidate('ab'); refreshControls();
      if (f < 1) requestAnimationFrame(anim); else setTimeout(next, 350);
    };
    tuning = requestAnimationFrame(anim);
  };
  next();
}

function tourStops() {
  const b = P.betaOf(S.kV);
  const st = [
    { y: 5.3, pos: [2.4, 5.9, 3.8], title: 'The electron gun', text: `A needle of tungsten, sharpened to a ~100 nm tip and heated, sheds electrons that are then accelerated through ${S.kV},000 volts. They leave at ${b.toFixed(2)} × the speed of light.` },
    { y: 3.35, pos: [3.2, 3.9, 4.8], title: 'Condenser lenses', text: 'There’s no glass here: these are copper coils in iron shrouds. Their magnetic field bends each electron via the Lorentz force. Lens strength is set by current, so the beam is focused and zoomed without moving parts. Watch it cross over between them.' },
    { y: 2.15, pos: [2.8, 2.6, 4.2], title: 'Apertures & scan coils', text: 'A platinum disk with a tiny hole trims the beam. In STEM mode, pairs of scan coils tilt the beam back and forth so it pivots about the specimen and rasters across it.' },
    { y: 0.78, pos: [1.7, 1.25, 2.9], title: 'Objective lens & specimen', text: 'This is the heart of the microscope. The sample sits in a ~5 mm gap inside a field of about 2 tesla. The aberrations of this one lens set the resolution of the whole instrument.' },
    { y: -0.2, pos: [2.2, 0.1, 3.2], title: 'Back focal plane', text: 'Every electron leaving the sample in the same direction meets at one point here, so a diffraction pattern forms naturally inside every TEM. Apertures placed here choose which beams form the image.' },
    { y: -1.9, pos: [3.1, -1.3, 4.9], title: 'Intermediate & projector lenses', text: 'By choosing which plane to focus on, these lenses magnify either the image or the diffraction pattern, up to about a million times.' },
    { y: -3.5, pos: [3.4, -2.3, 5.6], title: 'Detectors', text: 'A phosphor screen or direct-electron camera for images and patterns. Ring-shaped detectors for STEM. A pixel camera that records a whole diffraction pattern per probe position for 4D-STEM.' },
  ];
  if (S.mode === 'eels') st.push({ y: -4.7, pos: [4.4, -3.4, 5.6], title: 'The spectrometer', text: 'A magnetic prism bends electrons that lost energy more strongly, fanning the beam into a spectrum. It resolves differences of a fraction of an electron-volt out of 200,000.' });
  st.push({ y: 0.75, pos: scene.home.pos.toArray(), title: 'Gun → lenses → specimen → lenses → detector', text: 'Every image in this exhibit is produced by this chain. Change any part of it in the controls and the physics recomputes.', dur: 6 });
  return st;
}

// ------------------------------------------------------------------ text panels
let infoOpen = false;
function renderInfo() {
  const stacked = document.body.classList.contains('stacked');
  $('.explain').classList.toggle('folded', stacked && !infoOpen);
  $('#infoMore').hidden = !stacked;
  $('#infoMore').textContent = infoOpen ? 'Show less' : 'Read more';
  const inf = modeInfo(S, sim);
  $('#infoTitle').innerHTML = inf.title;
  $('#infoBody').innerHTML = inf.body;
  $('#infoStats').innerHTML = inf.stats.map(([k, v, s]) => `<div><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join('');
}
let changeTimer = 0;
function explainChange(key) {
  const box = $('#change');
  const t = key ? changeText(key, S, sim) : null;
  if (!t) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<small>What just changed · ${t[0]}</small><p>${t[1]}</p>`;
  box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  clearTimeout(changeTimer);
  box.dataset.key = key;
  changeTimer = setTimeout(() => { if (box.dataset.key === key) refreshChange(); }, 400);
}
function refreshChange() {
  const box = $('#change'), key = box.dataset.key;
  if (box.hidden || !key) return;
  const t = changeText(key, S, sim);
  if (t) box.querySelector('p').innerHTML = t[1];
}

function updateDetectorHeader() {
  const names = {
    tem: [S.camera === 'screen' ? 'Fluorescent screen · image' : 'Direct electron detector · image', 'Diffractogram & contrast transfer'],
    stem: [`${stemDetType(S.detIn, S.detOut, S.alpha)} detector · scanned image`, 'Probe & detector geometry'],
    '4d': [({ bf: 'Virtual BF image', abf: 'Virtual ABF image', adf: 'Virtual ADF image', disk: 'Virtual dark-field image', dpc: 'DPC · beam deflection', com: 'Center-of-mass · electric field', ptycho: 'Ptychography · reconstructed phase', mptycho: 'Multislice ptychography · slice phases' })[S.vdet], 'Direct electron detector · pattern at probe'],
    diff: [S.camera === 'screen' ? 'Fluorescent screen · pattern' : 'Direct electron detector · pattern', 'Ring profile & d-spacings'],
    eds: ['EDS element map', 'X-ray spectrum'],
    eels: ['Energy-filtered map', 'Electron energy-loss spectrum'],
    ronch: ['Ronchigram · direct electron detector', 'Aberration phase & budget'],
    oah: [`Off-axis hologram · ${({ holo: 'raw hologram', phase: 'reconstructed phase', amp: 'reconstructed amplitude', contour: 'phase contours' })[S.holoView]}`, 'Sideband selection & phase profile'],
    ilh: [`In-line holography · ${({ phase: 'exit-wave phase', amp: 'exit-wave amplitude', series: 'focal series' })[S.ilhView]}`, 'Focal series & convergence'],
    cbed: [S.cbedKind === 'lacbed' ? 'LACBED pattern' : 'CBED pattern', S.cbedKind === 'lacbed' ? 'HOLZ lines & strain sensitivity' : 'Kossel–Möllenstedt thickness fit'],
    ltem: [`Lorentz TEM · ${({ fresnel: 'Fresnel image', foucault: 'Foucault image', tie: 'induction map (TIE)', phase: 'phase' })[S.lorView]}`, 'Back focal plane & magnetic state'],
    lstem: [`Lorentz STEM · ${({ color: 'DPC induction map', x: 'DPC x', y: 'DPC y', sum: 'bright field' })[S.lstemView]}`, 'Segmented detector & probe'],
  }[S.mode];
  $('#detTitle').textContent = names[0];
  $('#secTitle').textContent = names[1];
}

// ------------------------------------------------------------------ hardware control panel (panel.js)
const hwPanel = new Panel({
  S, sim,
  set, explain: (k) => explainChange(k), refresh: () => refreshControls(), action: (id) => action(id),
  // quiet change for the wobbler: no explanation, no control rebuild
  setRaw: (k, v, inv) => { S[k] = v; if (k === 'df') S.dfFam[fam(S.mode)] = v; sim.invalidate(inv); },
  moveStage: (dx, dy) => { S.cx += dx; S.cy += dy; sim.invalidate('stage'); },
  noteSource: (s) => scn.recorder.noteSource(s),
  openVirtual: (where) => (where === 'window' ? vPanel.openWindow() : vPanel.openDock()),
  talk: (down) => (down ? voice.start() : voice.stop()),
  mfOverride: () => scn?.mfOverride() ?? null,
  cycleMode: (d) => { const i = MODES.findIndex((m) => m[0] === S.mode); setMode(MODES[(i + d + MODES.length) % MODES.length][0]); },
  toggle: (k) => {
    if (k === 'pause') action('pause');
    else if (k === 'clarity') { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refreshControls(); explainChange('clarity'); }
    else if (k === 'labels') set('showLabels', !S.showLabels);
    else if (k === 'narrate') setAutoNarrate(!autoNarrate);
    else if (k === 'expand') setExpanded(!document.body.classList.contains('detBig'));
    else if (k === 'calib') action('calib');
    else if (k === 'acquire') acquireNow();
  },
});

const vPanel = new VirtualPanel(hwPanel);

// ------------------------------------------------------------------ acquisitions (acquire.js)
const acq = new Acquisitions({
  S, sim, mainCv, secCv, download: (b, n) => download(b, n),
  onChange: (a) => {
    const c = $('#acqCount');
    c.hidden = !acq.list.length; c.textContent = acq.list.length;
    if (!a) return;
    const d = $('.detector');
    d.classList.remove('shot'); void d.offsetWidth; d.classList.add('shot');
    hwPanel.say(`Acquired #${a.id}`);
    $('#change').hidden = false;
    $('#change').innerHTML = `<small>Acquired #${a.id}</small><p>${a.mode.toUpperCase()} on ${sim.spec.short}: ${a.summary}. Open the acquisitions (the stacked-frames button next to Acquire) to download the picture or the data.${sim.spec.beamSensitive ? ` This exposure added ${S.dose < 10 ? S.dose.toFixed(1) : Math.round(S.dose)} e⁻/Å² to the specimen's dose.` : ''}</p>`;
  },
});
function acquireNow() { redraw = true; R2.draw(sim, S, mainCv, secCv); acq.acquire(); if (scn.recorder.active) scn.recorder.event('acquire'); }

// ------------------------------------------------------------------ training scenarios and telemetry (scenarios.js, telemetry.js)
// ------------------------------------------------------------------ voice commands and the agent bridge
let setAI = () => {}; // AI mode (command bar) on/off, wired up with the controls
// one executor for both: the same operations a visitor can speak, an agent can send
const dfLimits = () => dfLimitsOf(S);
function runOp(op) {
  switch (op.op) {
    case 'mode': if (KEYS[op.v]) setMode(op.v); break;
    case 'spec': if (P.SPECIMENS[op.v]) setSpec(op.v); break;
    case 'set':
      if (op.k === 'df') { set('df', +clamp(op.v, ...dfLimits()).toFixed(1), 'df'); op.v = S.df; }
      else if (op.k === 'fov') { set('fov', +clamp(op.v, 1.5, 120).toFixed(2), 'fov'); op.v = S.fov; }
      else if (op.k === 'dose') { set('dose', +clamp(op.v, 0.5, 20000).toFixed(2), 'dose'); op.v = S.dose; }
      else if (op.k === 'clarity' && ['edu', 'real'].includes(op.v)) { S.clarity = op.v; sim.invalidate('clarity'); refreshControls(); explainChange('clarity'); }
      else if (op.k === 'camL') { set('camL', Math.round(clamp(op.v, 80, 6000)), 'camL'); op.v = S.camL; }
      else if (op.k === 'alpha') { const k = S.mode === '4d' ? 'alpha4d' : 'alpha'; set(k, +clamp(op.v, 3, 40).toFixed(1), 'alpha'); op.v = S[k]; }
      else if (op.k === 'tiltX' || op.k === 'tiltY') { set(op.k, +clamp(op.v, -tiltLimit(S), tiltLimit(S)).toFixed(2), 'tilt'); op.v = S[op.k]; }
      else if (lorSet(S, set, op)) refreshControls();
      else if (op.k === 'showLabels') set('showLabels', !!op.v);
      break;
    case 'chip':
      if (op.k === 'kV' && [80, 200, 300].includes(op.v)) chip('kV', op.v);
      else if (op.k === 'corrector') chip('corrector', !!op.v);
      else if (op.k === 'magSpec' && MAGSPECS[op.v]) chip('magSpec', op.v);
      else if (op.k === 'holder' && HOLDERS[op.v]) chip('holder', op.v);
      else if (op.k === 'detPreset' && ['bf', 'abf', 'adf', 'haadf'].includes(op.v)) chip('detPreset', op.v);
      else if (op.k === 'eelsRange' && ['zlp', 'low', 'core', 'high'].includes(op.v)) { if (S.mode !== 'eels') setMode('eels'); chip('eelsRange', op.v); }
      break;
    case 'nudge': { const st = S.corrector ? 2 : S.spec === 'bio' ? 100 : 10; set('df', +clamp(S.df + op.d * st, ...dfLimits()).toFixed(1), 'df'); break; }
    case 'zoom': set('fov', +clamp(S.fov * op.f, 1.5, 120).toFixed(2), 'fov'); break;
    case 'scale': set(op.k, +clamp(S[op.k] * op.f, 0.5, 20000).toFixed(2), op.k); break;
    case 'temp': {
      // pick a holder that reaches the temperature, then set it
      let h = S.holder;
      if (op.v < HOLDERS[h].min || op.v > HOLDERS[h].max) h = op.v <= 60 ? 'lhe' : op.v < 250 ? 'ln2' : op.v > 320 ? 'heat' : 'room';
      if (h !== S.holder) chip('holder', h);
      set('tempSet', +clamp(op.v, HOLDERS[h].min, HOLDERS[h].max).toFixed(1), 'tempSet'); op.v = S.tempSet;
      break;
    }
    case 'action': if (['optfocus', 'autotune', 'pause', 'zone'].includes(op.v)) action(op.v); break;
    case 'astig': {
      S.ab.A1 = +clamp(op.v, 0, S.corrector ? CORR_RANGE.A1 : 100).toFixed(2); op.v = S.ab.A1;
      if (op.a != null) S.ab.A1a = +(((op.a % 180) + 180) % 180).toFixed(1);
      sim.invalidate('ab'); refreshControls(); explainChange('ab');
      break;
    }
    case 'cycle': hwPanel.api.cycleMode(op.d > 0 ? 1 : -1); break;
    case 'export': exportData(); break;
    case 'analyze':
      // the detectors may not have computed this mode yet (a mode just changed): advance the simulation first
      try { for (let i = 0; i < 3; i++) sim.update(0.05); op.result = analyze(sim, S, op.v ?? undefined); op.v = op.result.analysis; } catch (e) { op.error = e.message; }
      break;
    case 'beam': if (S.paused === !!op.v) action('pause'); break;
    case 'acquire': acquireNow(); break;
    case 'wobbler': hwPanel.toggleWobbler(); break;
    case 'narrate': N.speak('mode-' + S.mode); break;
    case 'training': $('#btnTrain')?.click(); break;
    case 'stopSpeech': N.stop(); break;
    default: break;
  }
}
const stateSummary = () => ({
  mode: S.mode, specimen: S.spec, specimen_name: sim.spec.name, kV: S.kV, defocus_nm: S.df, fov_nm: S.fov, dose: S.dose,
  corrector: S.corrector, Cs_um: +(sim.CsA() / 1e4).toFixed(2), aberrations: { ...S.ab }, holder: S.holder, temperature_K: +sim.temp().toFixed(1),
  clarity: S.clarity, beam: S.paused ? 'blanked' : 'on', wavelength_pm: +(sim.lam * 100).toFixed(4),
  scherzer_defocus_nm: +(P.scherzerDefocus(sim.CsA(), sim.lam) / 10).toFixed(1), training_task: scn?.active?.id ?? null,
});
const voice = new Voice({
  ctx: () => ({ mode: S.mode, paused: S.paused, corrector: S.corrector }),
  run: (op) => { if (scn?.recorder.active) scn.recorder.noteSource('voice'); runOp(op); },
  agent: { get connected() { return agent.connected; }, utterance: (t) => agent.utterance(t) },
  onEvent: (kind, data) => {
    if (kind === 'voice' && scn?.recorder.active) scn.recorder.event('voice', data);
    $('#btnMic')?.classList.toggle('on', kind === 'listening' && data === true);
  },
});
const agent = new AgentBridge({
  urls: AGENT.urls ?? [AGENT.url],
  state: stateSummary,
  busy: () => (scn?.active ? 'A training task is running in the exhibit; the agent cannot change settings until it ends.' : scn?.replay ? 'A session replay is playing.' : null),
  run: (ops) => ops.filter((op) => op.op !== 'export').map((op) => { runOp(op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); }),
  analyze: (name) => { for (let i = 0; i < 3; i++) sim.update(0.05); return analyze(sim, S, name ?? undefined); },
  // desktop Python (tools/temview-py, connect("live")): the same calls as the IDE; bytes travel as base64
  script: (call, args) => { const enc = (v) => (v instanceof Uint8Array ? { $bytes: b64(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v); return enc(scriptCore.call(call, args)); },
  command: (text) => {
    const r = parseCommand(text, { paused: S.paused, mode: S.mode });
    if (!r.ops) return { understood: false, text };
    return { understood: true, done: r.ops.filter((op) => op.op !== 'export').map((op) => { runOp(op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); }) };
  },
  acquire: (withData) => {
    acquireNow();
    const a = acq.list[0];
    if (!a) throw new Error('nothing to acquire in this mode');
    let npz;
    if (withData) { const b = npzBytes(a.data); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); npz = btoa(s); }
    return { id: a.id, mode: a.mode, spec: a.spec, summary: a.summary, png: a.png, png2: a.png2, npz };
  },
  say: (text) => { voice.flash(`<span class="mic agent"></span><b>Agent</b><p>${text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</p>`, Math.max(5000, text.length * 70)); N.sayText(text); },
  onStatus: (status, msg) => {
    const b = document.querySelector('[data-act="agent"]');
    if (b) b.textContent = status === 'on' ? 'Agent connected · Disconnect' : status === 'connecting' ? 'Connecting…' : 'Connect agent';
    b?.classList.toggle('on', status === 'on');
    if (msg) voice.flash(`<b>Agent</b><p>${msg}</p>`, 7000);
    else if (status === 'on') voice.flash('<span class="mic agent"></span><b>Agent connected</b><p>Ask a question with the microphone (hold M); the agent can also run the microscope.</p>', 5000);
  },
});

const scn = new Scenarios({
  S, sim, version: document.querySelector('script[src*="main.js"]')?.getAttribute('src')?.split('v=')[1] ?? 'dev',
  setSpec: (v) => setSpec(v), setMode: (m) => setMode(m), download: (b, n) => download(b, n),
  invalidateAll: () => { sim.invalidate('all'); refreshControls(); renderInfo(); },
  // replay: set the recorded settings
  applyFlat: (st) => {
    if (st.mode && st.mode !== S.mode) setMode(st.mode);
    for (const [k, v] of Object.entries(st)) { if (k === 'mode') continue; if (k.startsWith('ab.')) S.ab[k.slice(3)] = v; else if (k in S && k !== 'paused') S[k] = v; }
    sim.invalidate('all'); refreshControls();
  },
  snapshotState: () => structuredClone(Object.fromEntries(SESSION_KEYS.map((k) => [k, S[k]]))),
  restoreState: (st) => { const m = st.mode; Object.assign(S, structuredClone(st)); S.mode = ''; setMode(m); sim.invalidate('all'); refreshControls(); },
});
window.addEventListener('pagehide', () => scn.flushOnExit());

// ------------------------------------------------------------------ Python scripting (js/scripting.js, js/ide.js)
const scriptCore = new ScriptCore({
  name: 'exhibit', S, sim,
  run: (op) => { runOp(op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); },
  busy: () => (scn?.active ? 'A training task is running in the exhibit; scripts cannot change settings until it ends.' : scn?.replay ? 'A session replay is playing.' : null),
  refresh: () => { refreshControls(); renderInfo(); updateDetectorHeader(); },
  get scenarioApi() { return scn.api; },
});
const ide = new PythonIDE({ core: scriptCore, onRun: () => { refreshControls(); renderInfo(); updateDetectorHeader(); } });
$('#btnScript')?.addEventListener('click', () => ide.toggle());
// which input caused each change
window.addEventListener('pointerdown', (e) => scn.recorder.noteSource(e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse'), true);
window.addEventListener('wheel', () => scn.recorder.noteSource('mouse'), true);
window.addEventListener('keydown', () => scn.recorder.noteSource('keyboard'), true);

// ------------------------------------------------------------------ results panel: enlarge or pop out
function setExpanded(on) {
  document.body.classList.toggle('detBig', on);
  $('#btnExpand').setAttribute('aria-pressed', on);
  redraw = true;
}
let pop = null;
function openPopout() {
  if (pop && !pop.closed) { pop.focus(); return; }
  pop = window.open('', 'tem-results', 'popup,width=1320,height=760');
  if (!pop) { setExpanded(true); return; } // pop-ups blocked: enlarge in place instead
  pop.document.title = 'Seeing with Electrons · results';
  pop.document.body.innerHTML = `<style>
    html, body { margin: 0; height: 100%; background: #05070a; color: #e9edf2; font: 500 11px "IBM Plex Mono", ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
    body { display: flex; flex-direction: column; padding: 12px; box-sizing: border-box; gap: 8px; }
    header { display: flex; gap: 16px; } header span:last-child { color: #8a94a3; margin-left: auto; }
    main { flex: 1; display: flex; gap: 12px; min-height: 0; }
    canvas { border-radius: 8px; background: #06080b; height: 100%; }
    #m { aspect-ratio: 1; max-width: 58%; } #s { flex: 1; min-width: 0; }
    @media (max-aspect-ratio: 4/3) { main { flex-direction: column; } #m { height: auto; width: 100%; max-width: none; } #s { height: 40%; flex: none; } }
  </style><header><span id="t1"></span><span id="t2"></span></header><main><canvas id="m"></canvas><canvas id="s"></canvas></main>`;
  // same guard as in render2d: narrow panels must never pass a negative arc radius
  const proto = pop.CanvasRenderingContext2D.prototype, arc = proto.arc;
  proto.arc = function (x, y, r, ...rest) { return arc.call(this, x, y, Math.max(0, r), ...rest); };
  pop.addEventListener('resize', () => (redraw = true));
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.close(); });
  redraw = true;
}
function drawPopout() {
  if (!pop) return;
  if (pop.closed) { pop = null; return; }
  const d = pop.document, m = d.getElementById('m'), sc = d.getElementById('s');
  if (!m) return;
  d.getElementById('t1').textContent = $('#detTitle').textContent;
  d.getElementById('t2').textContent = $('#secTitle').textContent;
  R2.draw(sim, S, m, sc);
}

// ------------------------------------------------------------------ digital twin: profile, calibration, sessions, export
function setProfile(pr, why) {
  S.profile = pr;
  S.csUnc = pr.CsUnc;
  if (why === 'profile') S.corrector = pr.corrector;
  sim.invalidate('profile');
  refreshControls();
  explainChange(why);
}
function applyCalibration(r) {
  const pr = structuredClone(S.profile), when = new Date().toISOString();
  if (r.type === 'ctf') {
    // defocus and astigmatism are the state of the instrument today; they set the twin's current optics
    pr.calibrated.ctf = { df: r.df, A1: r.A1, A1a: r.A1a, fitRes: r.fitRes, kV: r.kV, CsA: r.CsA, pixA: r.pixA, source: r.source, when };
    if (!S.corrector) pr.CsUnc = r.CsA / 1e7;
    if (r.kV !== S.kV) S.kV = r.kV;
    if (S.corrector) S.csCor = Math.round(r.CsA / 1e4);
    S.dfFam.tem = +(r.df / 10).toFixed(1);
    if (fam(S.mode) === 'tem') S.df = S.dfFam.tem;
    S.ab.A1 = +(r.A1 / 10).toFixed(1); S.ab.A1a = Math.round(r.A1a);
  } else if (r.type === 'zlp') {
    pr.dE = +r.dE.toFixed(3);
    pr.calibrated.zlp = { fwhm: r.fwhm, dE: r.dE, source: r.source, when };
  } else if (r.type === 'lattice') {
    pr.magCal = +r.magCal.toFixed(5);
    if (r.scanAspect != null) { pr.scanAspect = +r.scanAspect.toFixed(5); pr.scanShear = +r.scanShear.toFixed(3); }
    pr.calibrated.lattice = { magCal: r.magCal, scanAspect: r.scanAspect, scanShear: r.scanShear, d: r.d, source: r.source, when };
  } else if (r.type === 'rings') {
    Object.assign(pr, { camLCal: +r.camLCal.toFixed(5), ellip: +r.ellip.toFixed(5), ellipAng: +r.ellipAng.toFixed(1) });
    pr.calibrated.rings = { camLCal: r.camLCal, ellip: r.ellip, ellipAng: r.ellipAng, source: r.source, when };
  } else if (r.type === 'disk') {
    pr.camLCal = +r.camLCal.toFixed(5);
    pr.calibrated.disk = { camLCal: r.camLCal, mradPx: r.mradPx, source: r.source, when };
  } else if (r.type === 'eds') {
    pr.edsFWHM = +r.fwhmMn.toFixed(1);
    pr.calibrated.eds = { fwhmMn: r.fwhmMn, gain: r.gain, offset: r.offset, source: r.source, when };
  } else if (r.type === 'holo') {
    pr.holoMu0 = +r.mu0.toFixed(4);
    pr.calibrated.holo = { mu0: r.mu0, mu: r.mu, U: r.U, source: r.source, when };
  } else if (r.type === 'profile') {
    Object.assign(pr, r.profile, { calibrated: pr.calibrated });
  }
  setProfile(pr, 'calibrated');
  sim.invalidate('ab');
  refreshControls();
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
function saveSession() {
  const state = Object.fromEntries(SESSION_KEYS.map((k) => [k, S[k]]));
  const ses = { format: 'tem-view-session/1', saved: new Date().toISOString(), note: 'Seeing with Electrons (TEM-view) session', state };
  download(new Blob([JSON.stringify(ses, null, 1)], { type: 'application/json' }), `tem-view-session-${stamp()}.json`);
  explainChange('session');
}
// a saved session, or an instrument profile on its own
function loadSessionFile(text) {
  const o = JSON.parse(text);
  if (o.format?.startsWith('tem-view-profile')) { setProfile(sanitizeProfile(o), 'calibrated'); return; }
  if (!o.format?.startsWith('tem-view-session') || !o.state) throw new Error('not a TEM-view session or profile');
  const st = o.state, d = defaultState(), mode = typeof st.mode === 'string' && KEYS[st.mode] ? st.mode : S.mode;
  if (st.cryo === true && !st.holder) { st.holder = 'ln2'; st.tempSet = 90; } // sessions saved before the temperature setting
  for (const k of SESSION_KEYS) {
    if (!(k in st) || k === 'mode') continue;
    if (k === 'holder' && !HOLDERS[st.holder]) continue;
    if (k === 'profile') S.profile = sanitizeProfile(st.profile);
    else if (k === 'spec') { if (P.SPECIMENS[st.spec]) S.spec = st.spec; }
    else if (k === 'ab' || k === 'dfFam') { if (st[k] && typeof st[k] === 'object') S[k] = { ...d[k], ...Object.fromEntries(Object.entries(st[k]).filter(([, v]) => typeof v === 'number')) }; }
    else if (typeof st[k] === typeof d[k]) S[k] = st[k];
  }
  sim.freshArea();
  resetVdet();
  sim.invalidate('spec');
  S.mode = '';
  setMode(mode);
  refreshControls();
  explainChange('loaded');
}
function exportData() {
  const data = collectData(sim, S);
  if (!Object.keys(data.arrays).length) return;
  download(new Blob([toNpz(data)], { type: 'application/zip' }), `tem-view-${S.mode}-${S.spec}-${stamp()}.npz`);
  explainChange('exported');
}

function updateTwin() {
  const tb = $('#twinBody');
  if (!tb || tb.closest('[hidden]')) return;
  // what the current mode depends on; ✓ marks a value measured from data
  const pr = S.profile, cal = pr.calibrated || {}, m = S.mode, ok = (k) => (cal[k] ? ' ✓' : ''), rows = [];
  if (['tem', 'ilh', 'oah', 'diff'].includes(m)) rows.push(['Gun', `${pr.gun}, ΔE ${pr.dE.toFixed(2)} eV${ok('zlp')}`], ['Focal spread / info limit', `${sim.focalSpread().toFixed(0)} Å / ${sim.infoLimit().toFixed(2)} Å`]);
  if (['tem', 'ilh', 'oah'].includes(m)) rows.push(['Cc / Cs (uncorrected)', `${pr.Cc} / ${pr.CsUnc} mm`]);
  if (['tem', 'ilh', 'oah', 'stem', '4d', 'eds', 'eels'].includes(m)) rows.push(['Magnification calibration', `×${pr.magCal.toFixed(4)}${ok('lattice')}`]);
  if (['stem', 'eds', 'eels'].includes(m)) rows.push(['Scan aspect / shear', `${pr.scanAspect.toFixed(4)} / ${pr.scanShear.toFixed(2)}°${ok('lattice')}`], ['Source size', `${pr.sourceSize} Å`]);
  if (['diff', 'stem', '4d', 'cbed', 'ronch'].includes(m)) rows.push(['Camera-length calibration', `×${pr.camLCal.toFixed(4)}${ok('rings') || ok('disk')}`]);
  if (m === 'diff') rows.push(['Projector ellipticity', `${(pr.ellip * 100).toFixed(2)} % at ${pr.ellipAng}°${ok('rings')}`]);
  if (m === 'eds') rows.push(['EDS resolution (Mn Kα)', `${pr.edsFWHM.toFixed(0)} eV${ok('eds')}`]);
  if (m === 'eels') rows.push(['Energy spread / resolution', `${pr.dE.toFixed(2)} / ${sim.eelsRes().toFixed(2)} eV${ok('zlp')}`]);
  if (m === 'oah') rows.push(['Fringe contrast μ₀ / coherence', `${pr.holoMu0.toFixed(2)} / ${pr.holoCoh} nm${ok('holo')}`]);
  if (cal.ctf && ['tem', 'ilh'].includes(m)) rows.push(['Last Thon-ring fit', `${(cal.ctf.df / 10).toFixed(0)} nm, A1 ${(cal.ctf.A1 / 10).toFixed(1)} nm (${cal.ctf.fitRes.toFixed(1)} Å)`]);
  rows.push(['Measured from data', `${Object.keys(cal).length ? Object.keys(cal).map((k) => ({ ctf: 'Thon rings', zlp: 'zero loss', lattice: 'lattice', rings: 'rings', disk: 'disk', eds: 'EDS', holo: 'hologram' })[k]).join(', ') : 'nothing yet'}`]);
  tb.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}
function updateTable() {
  updateTwin();
  const rows = dataRows(S, sim);
  $('#dataBody').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

// ------------------------------------------------------------------ static UI wiring
function wire() {
  const nav = $('.modes');
  let grp = null;
  MODES.forEach(([m, name, sub, g], i) => {
    if (!grp || grp.dataset.g !== g) {
      grp = document.createElement('div');
      grp.className = 'grp'; grp.dataset.g = g;
      grp.innerHTML = `<small>${g}</small><div></div>`;
      nav.appendChild(grp);
    }
    const b = document.createElement('button');
    b.dataset.mode = m;
    b.title = `${sub} (key ${KEYS[m]})`;
    b.innerHTML = `${name}<kbd>${KEYS[m]}</kbd>`;
    b.addEventListener('click', () => setMode(m));
    grp.lastChild.appendChild(b);
  });
  document.querySelectorAll('.clarity button').forEach((b) => b.addEventListener('click', () => { S.clarity = b.dataset.v; sim.invalidate('clarity'); refreshControls(); explainChange('clarity'); }));
  $('#btnLabels').addEventListener('click', () => set('showLabels', !S.showLabels));
  $('#btnFull').addEventListener('click', () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); });
  $('#btnHelp').addEventListener('click', () => ($('#help').hidden = false));
  // the explanation panel grows up from the bottom: stop it below the hero, so the support buttons stay visible
  { const hero = $('.hero'), fit = () => document.documentElement.style.setProperty('--heroB', `${Math.round(hero.getBoundingClientRect().bottom)}px`);
    new ResizeObserver(fit).observe(hero); addEventListener('resize', fit); fit(); }
  // support and news (top left)
  if (SUPPORT.coffee) { $('#btnCoffee').href = SUPPORT.coffee; $('#btnCoffee').hidden = false; }
  $('#btnNews').addEventListener('click', () => {
    $('#newsBody').innerHTML = `<p>New modes, training tasks, guides and the TEM-view Console: get an email when they ship.</p>
      ${SUPPORT.subscribe ? `<form id="newsForm" class="newsform" novalidate>
        <label>Name<input name="name" autocomplete="name" required maxlength="100"></label>
        <label>Email<input type="email" name="email" placeholder="you@example.org" autocomplete="email" required></label>
        <label><span>Institution <small>(optional)</small></span><input name="institution" autocomplete="organization" maxlength="160"></label>
        <fieldset><legend>I am a</legend>${['student', 'staff', 'faculty', 'hobbyist'].map((r) => `<label class="role"><input type="radio" name="role" value="${r}" required>${r[0].toUpperCase() + r.slice(1)}</label>`).join('')}</fieldset>
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        <button class="btn primary" type="submit">Subscribe</button>
      </form>
      <p class="muted" id="newsMsg">Only used for TEM-view news, a few emails a year. Reply to any of them to unsubscribe.</p>`
      : SUPPORT.newsletter ? `<p><a class="btn primary" href="${SUPPORT.newsletter}" target="_blank" rel="noopener">Subscribe by email</a></p>` : ''}
      <p class="muted">Or follow the release notes on <a href="${SUPPORT.repo}/releases" target="_blank" rel="noopener">GitHub</a>.</p>`;
    $('#newsModal').hidden = false;
    const f = $('#newsForm');
    if (!f) return;
    f.name.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#newsMsg'), btn = f.querySelector('button[type=submit]'), email = f.email.value.trim(), name = f.name.value.trim(), role = f.role.value;
      const bad = (text, el) => { msg.textContent = text; msg.className = 'err'; el?.focus(); };
      if (!name) return bad('Please enter your name.', f.name);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('Please enter a valid email address.', f.email);
      if (!role) return bad('Please choose student, staff, faculty or hobbyist.', f.querySelector('[name=role]'));
      btn.disabled = true; btn.textContent = 'Subscribing…';
      try {
        const r = await fetch(SUPPORT.subscribe, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ email, name, institution: f.institution.value.trim(), role, website: f.website.value, source: 'exhibit' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || `error ${r.status}`);
        $('#newsBody').innerHTML = `<p class="thanks"><b>Thanks for subscribing${j.already ? '' : `, ${name.split(' ')[0].replace(/[<>&"]/g, '')}`}!</b></p><p>${j.already ? 'This address is already on the list' : 'TEM-view news will go to'} <b>${email.replace(/[<>&"]/g, '')}</b>.</p>`;
      } catch (err) {
        msg.textContent = `Could not subscribe: ${err.message}. Please try again later.`; msg.className = 'err';
        btn.disabled = false; btn.textContent = 'Subscribe';
      }
    });
  });
  $('#newsModal .close').addEventListener('click', () => ($('#newsModal').hidden = true));
  $('#newsModal').addEventListener('click', (e) => { if (e.target.id === 'newsModal') $('#newsModal').hidden = true; });
  const openTraining = () => scn.menu({ replay: () => action('replayFile'), last: () => action('lastSession') });
  $('#btnTrain').addEventListener('click', openTraining);
  const bar = $('#cmdBar'), inp = $('#cmdInput'), hist = []; let hi = 0;
  setAI = (on) => {
    bar.hidden = !on;
    $('#btnAI').classList.toggle('on', on); $('#btnAI').setAttribute('aria-pressed', String(on));
    if (on) inp.focus(); else { inp.blur(); voice.escape(); }
  };
  $('#btnAI').addEventListener('click', () => setAI(bar.hidden));
  $('#cmdList').innerHTML = EXAMPLES.map((e) => `<option value="${e}"></option>`).join('');
  bar.addEventListener('submit', (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; hist.push(v); hi = hist.length; inp.value = ''; if (scn?.recorder.active) scn.recorder.noteSource('keyboard'); voice.handle(v, true); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); hi = Math.max(0, hi - 1); inp.value = hist[hi]; }
    else if (e.key === 'ArrowDown' && hist.length) { e.preventDefault(); hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] ?? ''; }
    else if (e.key === 'Escape') setAI(false);
  });
  const mic = $('#btnMic');
  mic.addEventListener('pointerdown', (e) => { e.preventDefault(); mic.setPointerCapture(e.pointerId); voice.start(); });
  for (const ev of ['pointerup', 'pointercancel']) mic.addEventListener(ev, () => voice.stop());
  document.querySelectorAll('[data-fold]').forEach((b) => b.addEventListener('click', () => fold(b.dataset.fold)));
  for (const k of ['L', 'R']) if (store(`tem-fold${k}`) === '1') document.body.classList.add(`fold${k}`);
  $('#fileSession').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { loadSessionFile(await f.text()); }
    catch (err) { $('#change').hidden = false; $('#change').innerHTML = `<small>Could not load ${f.name.replace(/[<>&]/g, '')}</small><p>${String(err.message).replace(/[<>&]/g, '')}</p>`; }
  });
  $('#infoMore').addEventListener('click', () => { infoOpen = !infoOpen; renderInfo(); });
  $('#btnAcquire').addEventListener('click', acquireNow);
  $('#fileReplay').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { scn.loadReplay(await f.text()); } catch (err) { $('#change').hidden = false; $('#change').innerHTML = `<small>Could not replay ${f.name.replace(/[<>&]/g, '')}</small><p>${String(err.message).replace(/[<>&]/g, '')}</p>`; } });
  $('#btnGallery').addEventListener('click', () => { $('#gallery').hidden = false; acq.render($('#gallery .gBody')); });
  $('#gallery').addEventListener('click', (e) => { if (e.target.id === 'gallery' || e.target.closest('.close')) $('#gallery').hidden = true; });
  $('#btnPanel').addEventListener('click', () => { $('#panelCfg').hidden = false; hwPanel.renderConfig($('#panelCfg .pBody')); });
  $('#panelCfg').addEventListener('click', (e) => { if (e.target.id === 'panelCfg' || e.target.closest('.close')) $('#panelCfg').hidden = true; });
  $('#btnExpand').addEventListener('click', () => setExpanded(!document.body.classList.contains('detBig')));
  $('#btnPopout').addEventListener('click', openPopout);
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) $('#help').hidden = true; });

  // detector interactions
  let drag = null;
  const rel = (e, cv) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; };
  mainCv.addEventListener('pointerdown', (e) => { if (S.mode === 'ltem' || S.mode === 'lstem') return; drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, tx: S.tiltX, ty: S.tiltY }; mainCv.setPointerCapture(e.pointerId); });
  mainCv.addEventListener('pointermove', (e) => {
    const [x, y, w, h] = rel(e, mainCv);
    if (S.mode === '4d' && sim.fd) {
      const N = sim.fd.N, i = clamp(Math.floor((x / w) * N), 0, N - 1), j = clamp(Math.floor((y / h) * N), 0, N - 1);
      const k = j * N + i;
      if (k < sim.fd.done && k !== S.fdSel) { S.fdSel = k; sim.version++; }
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (S.mode === 'diff' || S.mode === 'ronch') {
      if (S.mode !== 'diff') return;
      S.tiltX = clamp(+(drag.tx - dx * 0.006).toFixed(2), -3, 3); S.tiltY = clamp(+(drag.ty - dy * 0.006).toFixed(2), -3, 3);
      sim.invalidate('tilt'); refreshControls(); explainChange('tilt');
      return;
    }
    const sc = (S.mode === 'cbed' ? (S.cbedKind === 'lacbed' ? 440 : 60) : sim.fovA()) / w;
    S.cx = drag.cx - dx * sc; S.cy = drag.cy - dy * sc;
    sim.invalidate('stage');
  });
  const end = () => { if (drag && S.mode !== 'diff' && S.mode !== '4d' && (drag.cx !== S.cx || drag.cy !== S.cy)) explainChange('stage'); drag = null; };
  mainCv.addEventListener('pointerup', end);
  mainCv.addEventListener('pointercancel', end);
  mainCv.addEventListener('pointerleave', () => { if (S.mode === '4d' && S.fdSel >= 0) { S.fdSel = -1; sim.version++; } });
  mainCv.addEventListener('wheel', (e) => {
    if (S.mode === 'diff') { e.preventDefault(); set('camL', clamp(S.camL * Math.pow(1.0015, -e.deltaY), 80, 2000), 'camL'); return; }
    if (S.mode === 'ltem' || S.mode === 'lstem') { e.preventDefault(); set('lorFov', +clamp(S.lorFov * Math.pow(1.0015, e.deltaY), 0.3, 10).toFixed(3), 'lorFov'); return; }
    if (!['tem', 'stem', '4d', 'eds', 'eels'].includes(S.mode)) return;
    e.preventDefault();
    set('fov', clamp(S.fov * Math.pow(1.0015, e.deltaY), 1.5, 120), 'fov');
  }, { passive: false });

  let sdrag = null;
  secCv.addEventListener('pointerdown', (e) => {
    const [x, y] = rel(e, secCv);
    if (S.mode === 'eds') {
      const L = R2.layout.eds;
      if (!L) return;
      const E = ((x - L.x0) / L.w) * L.Emax;
      let best = null, bd = 0.25;
      const present = new Set(sim.si.els.map((q) => q.sym));
      for (const l of P.XRAY) if (present.has(l.el) && Math.abs(l.E - E) < bd) { bd = Math.abs(l.E - E); best = l.el; }
      set('edsSel', best ?? 'all', 'edsSel');
      return;
    }
    if (S.mode === 'eels') { sdrag = { mode: 'eels' }; secCv.setPointerCapture(e.pointerId); moveSec(x, y); return; }
    if (S.mode === '4d' && R2.layout.cbed) {
      const L = R2.layout.cbed;
      if (x > L.sz) return;
      const mp = L.sz / (L.n4 * L.mradPx);
      const tx = (x - L.sz / 2) / mp, ty = (y - L.sz / 2) / mp, r = Math.hypot(tx, ty);
      sdrag = { mode: '4d', which: S.vdet === 'disk' ? 'disk' : Math.abs(r - S.vdIn) < Math.abs(r - S.vdOut) ? 'in' : 'out' };
      secCv.setPointerCapture(e.pointerId);
      moveSec(x, y);
    }
  });
  function moveSec(x, y) {
    if (sdrag.mode === 'eels') {
      const L = R2.layout.eels;
      const E = L.E0 + ((x - L.x0) / L.w) * (L.E1 - L.E0);
      set('eelsWin', +clamp(E, Math.max(0, L.E0), L.E1).toFixed(1), 'eelsWin');
      return;
    }
    const L = R2.layout.cbed, mp = L.sz / (L.n4 * L.mradPx);
    const tx = (x - L.sz / 2) / mp, ty = (y - L.sz / 2) / mp, r = Math.hypot(tx, ty);
    if (S.vdet === 'com') return;
    if (sdrag.which === 'disk') { S.vdX = tx; S.vdY = ty; }
    else if (sdrag.which === 'in') S.vdIn = clamp(r, 0, S.vdOut - 1);
    else S.vdOut = clamp(r, S.vdIn + 1, 32 * L.mradPx);
    sim.invalidate('vdet');
  }
  secCv.addEventListener('pointermove', (e) => { if (sdrag) { const [x, y] = rel(e, secCv); moveSec(x, y); } });
  secCv.addEventListener('pointerup', () => { if (sdrag?.mode === '4d') explainChange('vdet'); sdrag = null; });

  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const km = Object.keys(KEYS).find((k) => KEYS[k] === e.key);
    if (km && !e.metaKey && !e.ctrlKey) setMode(km);
    else if (e.key === ' ') { e.preventDefault(); action('pause'); }
    else if (e.key === 'l' || e.key === 'L') set('showLabels', !S.showLabels);
    else if (e.key === 'e' || e.key === 'E') set('showElectrons', !S.showElectrons);
    else if (e.key === 'r' || e.key === 'R') scene.resetView();
    else if (e.key === 'c' || e.key === 'C') { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refreshControls(); explainChange('clarity'); }
    else if (e.key === 'v' || e.key === 'V') vPanel.openDock();
    else if (e.key === 'i' || e.key === 'I') acquireNow();
    else if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey) openTraining();
    else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) ide.toggle();
    else if ((e.key === 'm' || e.key === 'M') && !e.repeat && !e.metaKey && !e.ctrlKey) voice.start();
    else if (e.key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setAI(true); }
    else if (e.key === '[') fold('L');
    else if (e.key === ']') fold('R');
    else if (e.key === 'x' || e.key === 'X') setExpanded(!document.body.classList.contains('detBig'));
    else if (e.key === 'Escape') { setExpanded(false); $('#help').hidden = true; if (scene.tour) scene.stopTour(); setAI(false); $('#newsModal').hidden = true; if (agent.connected || agent.status === 'connecting') { agent.disconnect(); voice.flash('<b>Agent disconnected</b><p>Press Connect agent (Controls → Voice and agent) to reconnect.</p>', 3500); } }
  });
  window.addEventListener('keyup', (e) => { if ((e.key === 'm' || e.key === 'M') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) voice.stop(); });
  window.addEventListener('resize', resize);
}

let lastBottom = 0;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };
// collapse the explanation (L) or controls (R) panel to a tab at the edge, giving the view more room
function fold(side, on = !document.body.classList.contains(`fold${side}`)) {
  document.body.classList.toggle(`fold${side}`, on);
  store(`tem-fold${side}`, on ? '1' : '0');
  resize();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const wide = w >= 1100;
  if (document.body.classList.contains('stacked') === wide) {
    document.body.classList.toggle('stacked', !wide);
    if (bound.length) refreshControls();
  }
  let off = { left: 0, right: 0, bottom: 0, top: 0 };
  let cw = w, ch = h;
  if (wide) {
    const L = $('.explain').getBoundingClientRect(), Rr = $('.controls').getBoundingClientRect(), D = $('.detector').getBoundingClientRect();
    // while the results panel is enlarged it covers the column; keep the column framed as before
    const bc = document.body.classList;
    off = { left: bc.contains('foldL') ? 0 : L.right, right: bc.contains('foldR') ? 0 : w - Rr.left, bottom: document.body.classList.contains('detBig') ? lastBottom : h - D.top + 10, top: 70 };
    lastBottom = off.bottom;
  } else {
    const g = $('#gl').getBoundingClientRect();
    cw = g.width; ch = g.height;
    off = { left: 0, right: 0, bottom: 0, top: 0 };
  }
  scene.resize(cw, ch, off);
}

// ------------------------------------------------------------------ loop
let redraw = false;
let last = performance.now(), lastDraw = 0, lastVer = -1, lastSlow = 0, frames = 0, fpsT = 0, fps = 0;
const camCv = document.createElement('canvas');
camCv.width = camCv.height = 256;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    hwPanel.poll(dt);
    scn.tick();
    sim.update(dt);
    const live = S.clarity === 'real' && ['tem', 'stem', 'diff', 'ronch', 'cbed'].includes(S.mode) && !S.paused;
    if (sim.version !== lastVer || (live && now - lastDraw > 70) || redraw) {
      redraw = false;
      drawPopout(); // first, so the main canvases leave R2.layout set for their own interactions
      R2.draw(sim, S, mainCv, secCv);
      lastVer = sim.version;
      lastDraw = now;
      if ((S.mode === 'tem' || S.mode === 'diff') && S.camera === 'screen') { scene.screenTex.image = mainCv; scene.screenTex.needsUpdate = true; }
      if (((S.mode === 'tem' || S.mode === 'diff') && S.camera === 'ded') || ['ronch', 'cbed', 'oah', 'ilh', 'ltem', 'lstem'].includes(S.mode)) { scene.camTex.image = mainCv; scene.camTex.needsUpdate = true; }
      if (S.mode === '4d' && R2.layout.cbed) {
        const L = R2.layout.cbed;
        camCv.getContext('2d').drawImage(secCv, 0, 0, L.sz, L.sz, 0, 0, 256, 256);
        scene.camTex.image = camCv; scene.camTex.needsUpdate = true;
      }
      if (S.mode === 'eels') { scene.specTex.image = secCv; scene.specTex.needsUpdate = true; }
    }
    scene.update(dt, S, sim);
  } catch (err) {
    console.error(err);
  }
  frames++;
  if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
  if (now - lastSlow > 300) {
    lastSlow = now;
    updateTable();
    hwPanel.hud($('#panelHud'));
    vPanel.update();
    if (!$('#panelCfg').hidden) { if (hwPanel.pad && !$('#pLive')) hwPanel.renderConfig($('#panelCfg .pBody')); hwPanel.renderLive($('#pLive')); }
    // live readouts (temperature, drift, ice) change by themselves
    const stk = document.body.classList.contains('stacked');
    for (const b of bound) if (b.c.pFn && (!b.el.dataset.modes || b.el.dataset.modes.split(' ').includes(S.mode)) && !(stk && folded.has(b.sec))) {
      const vis = !b.c.show || b.c.show();
      b.el.hidden = !vis;
      if (vis) b.el.textContent = b.c.pFn();
    }
    if (['eds', '4d', 'eels', 'stem', 'ronch', 'cbed', 'oah', 'ilh', 'ltem', 'lstem'].includes(S.mode)) renderInfo();
    $('#status').textContent = `· ${fps} fps`;
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ component cards
let openComp = null;
function showComponent(name, el) {
  const card = $('#comp');
  document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active'));
  if (openComp === name && !card.hidden) { closeComponent(); return; }
  openComp = name;
  el.classList.add('active');
  card.querySelector('.compBody').innerHTML = renderComponent(name, S, sim);
  card.hidden = false;
  card.scrollTop = 0;
  if (autoNarrate) N.speak(name);
  if (!document.body.classList.contains('stacked')) {
    const r = el.getBoundingClientRect(), W = 360, H = Math.min(card.offsetHeight, window.innerHeight - 40);
    const right = r.right + 14 + W < window.innerWidth - 360;
    const x = right ? r.right + 14 : Math.max(16, r.left - W - 14);
    const y = Math.max(16, Math.min(window.innerHeight - H - 16, r.top - 40));
    card.style.left = `${x}px`; card.style.top = `${y}px`;
  }
}
function closeComponent() {
  $('#comp').hidden = true;
  if (openComp && N.playing() === openComp) N.stop();
  openComp = null;
  document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active'));
}
scene.onLabel = showComponent;
$('#comp .close').addEventListener('click', closeComponent);
document.addEventListener('pointerdown', (e) => { if (openComp && !e.target.closest('#comp') && !e.target.closest('.lbl')) closeComponent(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeComponent(); });
// keep "Right now" values current while a card is open
setInterval(() => {
  if (!openComp) return;
  const body = $('#comp .compBody'), st = body.parentElement.scrollTop;
  body.innerHTML = renderComponent(openComp, S, sim);
  body.parentElement.scrollTop = st;
}, 700);

// ------------------------------------------------------------------ narration
let autoNarrate = false;
try { autoNarrate = localStorage.getItem('tem-narrate') === '1'; } catch {}
function setAutoNarrate(on) {
  autoNarrate = on;
  $('#btnNarrate').setAttribute('aria-pressed', on);
  try { localStorage.setItem('tem-narrate', on ? '1' : '0'); } catch {}
  if (on) N.speak(openComp || 'mode-' + S.mode); else N.stop();
}
$('#btnNarrate').addEventListener('click', () => setAutoNarrate(!autoNarrate));
$('#btnNarrate').setAttribute('aria-pressed', autoNarrate);
$('#infoSpeak').addEventListener('click', () => N.toggle('mode-' + S.mode));
$('#compSpeak').addEventListener('click', () => openComp && N.toggle(openComp));
window.addEventListener('keydown', (e) => { if ((e.key === 'n' || e.key === 'N') && !e.target.closest('input, textarea')) setAutoNarrate(!autoNarrate); });
function renderNarr() {
  const st = N.getSettings();
  const chips = (sel, opts, cur, k) => {
    $(sel).innerHTML = opts.map(([v, l]) => `<button class="chip${v === cur ? ' on' : ''}" data-v="${v}">${l}</button>`).join('');
    $(sel).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { N.setSettings({ [k]: b.dataset.v }); renderNarr(); }));
  };
  chips('#narrLevel', N.LEVELS, st.level, 'level');
  chips('#narrVoice', Object.entries(N.VOICES).map(([v, o]) => [v, o.label]), st.voice, 'voice');
}
renderNarr();
N.onNarration((id) => {
  $('#infoSpeak').classList.toggle('on', id === 'mode-' + S.mode);
  $('#compSpeak').classList.toggle('on', !!id && id === openComp);
});

build();
wire();
refreshControls();
renderInfo();
updateDetectorHeader();
explainChange('spec');
resize();
requestAnimationFrame(() => { resize(); requestAnimationFrame(frame); });
window.__tem = { S, sim, scene, panel: hwPanel, vpanel: vPanel, scn, voice, agent, runOp };
// deep link from the printed guides: ?train=<scenario id> opens that training task's intro
{ const id = new URLSearchParams(location.search).get('train'); if (id && /^[a-z0-9-]+$/.test(id)) setTimeout(() => { try { scn.start(id); } catch { /* unknown id */ } }, 600); }
// ?script=<example> opens the Python IDE with that example (tools/temview-py/examples/<example>.py); ?script alone opens it
{ const q = new URLSearchParams(location.search); if (q.has('script')) { const ex = q.get('script'); setTimeout(() => { ide.toggle(true); if (ex && /^[a-z0-9_]+$/.test(ex)) ide.loadExample(`${ex}.py`); }, 800); } }
