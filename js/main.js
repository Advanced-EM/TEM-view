import * as P from './physics.js';
import { Sim, stemDetType } from './sim.js';
import * as R2 from './render2d.js';
import { Scene3D, Y } from './scene3d.js';
import { modeInfo, changeText, dataRows } from './explain.js';
import { renderComponent } from './components.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ state
const S = {
  mode: 'stem', clarity: 'edu', spec: 'sto', thick: 15, tiltX: 0, tiltY: 0, fov: 5, cx: 0, cy: 0,
  kV: 200, dose: 400, df: 0, dfFam: { tem: -4, probe: 0 }, corrector: true, csUnc: 1.2, csCor: 5,
  objAp: 'none', alpha: 22, alpha4d: 12, detIn: 70, detOut: 200, detPreset: 'haadf',
  camL: 1000, sa: 10, beamStop: true, camera: 'screen',
  vdet: 'adf', vdIn: 14, vdOut: 60, vdX: 0, vdY: 0, vdR: 4, fdSel: -1,
  edsSel: 'all', eelsRange: 'core', eelsWin: 462, eelsWidth: 16, bgsub: true,
  speed: 1, paused: false, showLabels: true, showElectrons: true, showGlass: true, autoRotate: false,
  ab: { A1: 0, A1a: 0, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 }, ronchAp: 45,
  cbedKind: 'cbed', alphaCB: 3, alphaLA: 40, strain: 0, holz: true,
  medRange: 60, medRate: 6, medOsc: 0.5,
  tomoRange: 70, tomoStep: 2, tomoAlg: 'wbp', tomoIter: 20, tomoSlice: 0.5, tomoView: 'recon',
};
const fam = (m) => (m === 'tem' || m === 'diff' || m === 'microed' ? 'tem' : 'probe');
S.df = S.dfFam[fam(S.mode)];

const sim = new Sim(S);
const scene = new Scene3D($('#gl'), $('#labels'));
const mainCv = $('#detMain'), secCv = $('#detSec');

// ------------------------------------------------------------------ controls definition
const MODES = [
  ['tem', 'TEM', 'parallel-beam imaging', 'Imaging'], ['stem', 'STEM', 'scanned probe', 'Imaging'], ['4d', '4D-STEM', 'pattern per pixel', 'Imaging'], ['tomo', 'Tomography', '3D from tilts', 'Imaging'],
  ['diff', 'SAED', 'selected-area diffraction', 'Diffraction'], ['cbed', 'CBED', 'convergent beam', 'Diffraction'], ['microed', '3D-ED', 'MicroED rotation', 'Diffraction'],
  ['eds', 'EDS', 'X-ray spectra', 'Spectroscopy'], ['eels', 'EELS', 'energy loss', 'Spectroscopy'],
  ['ronch', 'Ronchigram', 'corrector tuning', 'Alignment'],
];
const KEYS = '1234567890';
const logMap = (min, max) => ({ to: (v) => (Math.log(v / min) / Math.log(max / min)) * 1000, from: (t) => min * Math.pow(max / min, t / 1000) });

const NOT_TOMO = 'tem stem 4d diff eds eels ronch cbed microed';
const NOT_TOMO_R = 'tem stem 4d diff eds eels cbed microed';
const TILTABLE = 'tem stem 4d diff eds eels cbed';
const CONTROLS = [
  { sec: 'The specimen' },
  { chips: 'spec', modes: NOT_TOMO, opts: [['au', 'Gold on carbon'], ['si', 'Si / SiO₂'], ['sto', 'SrTiO₃ boundary']] },
  { slider: 'thick', label: 'Thickness', min: 3, max: 150, step: 1, fmt: (v) => `${v} nm`, ends: ['thin', '', 'thick'], modes: NOT_TOMO_R },
  { slider: 'fov', label: 'Field of view', min: 1.5, max: 30, log: true, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'tem stem 4d eds eels', note: 'Drag the detector image to move the stage; scroll to zoom.' },
  { slider: 'tiltX', inv: 'tilt', label: 'Tilt α', min: -3, max: 3, step: 0.02, fmt: (v) => `${v.toFixed(2)}°`, modes: TILTABLE },
  { slider: 'tiltY', inv: 'tilt', label: 'Tilt β', min: -3, max: 3, step: 0.02, fmt: (v) => `${v.toFixed(2)}°`, ends: ['', 'zone axis', ''], modes: TILTABLE },
  { buttons: [['zone', 'Return to zone axis']], modes: TILTABLE },
  { p: 'Phantom: a porous oxide catalyst support (~45 nm) decorated with Au nanoparticles, voxel = 1 nm.', modes: 'tomo' },

  { sec: 'The electron gun' },
  { slider: 'kV', label: 'Accelerating voltage', min: 60, max: 300, step: 10, fmt: (v) => `${v} kV` },
  { chips: 'kV', small: true, opts: [[80, '80 kV · gentle'], [200, '200 kV'], [300, '300 kV · max']] },
  { slider: 'dose', label: 'Electron dose', min: 5, max: 20000, log: true, fmt: (v) => `${Math.round(v).toLocaleString()} e⁻/Å²`, ends: ['cryo-gentle', '', 'brutal'] },

  { sec: 'The lenses' },
  { chips: 'corrector', opts: [[false, 'Uncorrected'], [true, 'Aberration corrector']] },
  { slider: 'cs', label: 'Spherical aberration Cₛ', dyn: () => S.corrector ? { key: 'csCor', min: -40, max: 40, step: 1, fmt: (v) => `${v} µm` } : { key: 'csUnc', min: 0.5, max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)} mm` } },
  { slider: 'df', label: 'Defocus', dyn: () => (S.corrector ? { min: -30, max: 30, step: 0.2 } : { min: -150, max: 150, step: 1 }), fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} nm`, ends: ['under', 'focus', 'over'], modes: 'tem stem 4d eds eels ronch' },
  { buttons: [['optfocus', 'Optimal focus']], modes: 'tem stem 4d eds eels ronch' },
  { chips: 'objAp', label: 'Objective aperture', modes: 'tem', opts: [['none', 'Open'], ['40', '40 µm'], ['20', '20 µm'], ['10', '10 µm'], ['df', 'Dark field']] },
  { slider: 'alpha', label: 'Convergence semi-angle', dyn: () => ({ key: S.mode === '4d' ? 'alpha4d' : 'alpha' }), min: 3, max: 40, step: 0.5, fmt: (v) => `${v} mrad`, modes: 'stem 4d eds eels', ends: ['parallel-ish', '', 'wide cone'] },

  { sec: 'Aberration corrector', modes: 'ronch' },
  { p: 'Tune on amorphous carbon: make the flat central "sweet spot" of the Ronchigram as large and round as possible. C1 and C3 are the defocus and Cₛ controls above.', modes: 'ronch' },
  { buttons: [['scramble', 'Scramble aberrations'], ['autotune', 'Auto-tune']], modes: 'ronch' },
  { slider: 'ronchAp', label: 'Ronchigram aperture', min: 20, max: 70, step: 1, fmt: (v) => `${v} mrad`, modes: 'ronch' },
  { slider: 'A1', ab: true, label: 'A1 · 2-fold astigmatism', min: 0, max: 100, step: 0.5, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'ronch' },
  { slider: 'A1a', ab: true, label: 'A1 angle', min: 0, max: 180, step: 1, fmt: (v) => `${v}°`, modes: 'ronch' },
  { slider: 'B2', ab: true, label: 'B2 · axial coma', min: 0, max: 1500, step: 5, fmt: (v) => `${v} nm`, modes: 'ronch' },
  { slider: 'B2a', ab: true, label: 'B2 angle', min: 0, max: 360, step: 1, fmt: (v) => `${v}°`, modes: 'ronch' },
  { slider: 'A2', ab: true, label: 'A2 · 3-fold astigmatism', min: 0, max: 1500, step: 5, fmt: (v) => `${v} nm`, modes: 'ronch' },
  { slider: 'A2a', ab: true, label: 'A2 angle', min: 0, max: 120, step: 1, fmt: (v) => `${v}°`, modes: 'ronch' },
  { slider: 'A3', ab: true, label: 'A3 · 4-fold astigmatism', min: 0, max: 20, step: 0.1, fmt: (v) => `${v.toFixed(1)} µm`, modes: 'ronch' },
  { slider: 'A3a', ab: true, label: 'A3 angle', min: 0, max: 90, step: 1, fmt: (v) => `${v}°`, modes: 'ronch' },

  { sec: 'Convergent-beam diffraction', modes: 'cbed' },
  { chips: 'cbedKind', modes: 'cbed', opts: [['cbed', 'CBED (focused probe)'], ['lacbed', 'LACBED (large angle)']] },
  { slider: 'alphaCB', label: 'Convergence semi-angle', min: 0.5, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} mrad`, modes: 'cbed', show: () => S.cbedKind === 'cbed', ends: ['separate disks', '', 'overlapping'] },
  { slider: 'alphaLA', label: 'Convergence semi-angle', min: 15, max: 70, step: 1, fmt: (v) => `${v} mrad`, modes: 'cbed', show: () => S.cbedKind === 'lacbed' },
  { slider: 'strain', label: 'Lattice strain', min: -1, max: 1, step: 0.02, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} %`, modes: 'cbed', ends: ['compressed', '', 'expanded'] },
  { toggles: [['holz', 'HOLZ lines']], modes: 'cbed' },
  { p: 'Drag the pattern to move the probe across the specimen. In LACBED the shadow image shows where each line comes from.', modes: 'cbed' },

  { sec: '3D electron diffraction', modes: 'microed' },
  { slider: 'medRange', label: 'Rotation range', min: 20, max: 80, step: 1, fmt: (v) => `±${v}°`, modes: 'microed', ends: ['', '', 'missing wedge shrinks'] },
  { slider: 'medRate', label: 'Rotation speed', min: 0.5, max: 20, step: 0.5, fmt: (v) => `${v}°/s`, modes: 'microed' },
  { slider: 'medOsc', label: 'Frame oscillation', min: 0.1, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}° / frame`, modes: 'microed' },
  { buttons: [['medStart', 'Restart rotation']], modes: 'microed' },

  { sec: 'Tilt series & reconstruction', modes: 'tomo' },
  { slider: 'tomoRange', label: 'Tilt range', min: 30, max: 90, step: 1, fmt: (v) => `±${v}°`, modes: 'tomo', ends: ['big wedge', '', 'no wedge'] },
  { slider: 'tomoStep', label: 'Tilt increment', min: 1, max: 10, step: 0.5, fmt: (v) => `${v}°`, modes: 'tomo' },
  { chips: 'tomoAlg', label: 'Reconstruction', modes: 'tomo', opts: [['wbp', 'Weighted back-projection'], ['sirt', 'SIRT (iterative)']] },
  { slider: 'tomoIter', label: 'SIRT iterations', min: 5, max: 60, step: 1, fmt: (v) => `${v}`, modes: 'tomo', show: () => S.tomoAlg === 'sirt' },
  { slider: 'tomoSlice', label: 'Slice position', min: 0.1, max: 0.9, step: 0.01, fmt: (v) => `${Math.round(v * 64)} / 64`, modes: 'tomo' },
  { chips: 'tomoView', modes: 'tomo', opts: [['recon', 'Reconstruction'], ['truth', 'Ground truth']] },
  { buttons: [['tomoStart', 'Acquire new tilt series']], modes: 'tomo' },

  { sec: 'Detectors', modes: 'tem stem diff 4d eds eels' },
  { chips: 'camera', label: 'Camera', modes: 'tem diff', opts: [['screen', 'Fluorescent screen'], ['ded', 'Direct electron detector']] },
  { chips: 'detPreset', modes: 'stem', opts: [['bf', 'BF'], ['abf', 'ABF'], ['adf', 'ADF'], ['haadf', 'HAADF']] },
  { slider: 'detIn', inv: 'det', label: 'Inner angle', min: 0, max: 150, step: 1, fmt: (v) => `${v} mrad`, modes: 'stem' },
  { slider: 'detOut', inv: 'det', label: 'Outer angle', min: 5, max: 250, step: 1, fmt: (v) => `${v} mrad`, modes: 'stem' },
  { slider: 'camL', label: 'Camera length', min: 80, max: 2000, log: true, fmt: (v) => `${Math.round(v)} mm`, modes: 'diff cbed', show: () => S.mode !== 'cbed' || S.cbedKind === 'cbed', ends: ['wide angle', '', 'zoomed'] },
  { slider: 'sa', label: 'Selected area', min: 2, max: 12, step: 0.2, fmt: (v) => `${v.toFixed(1)} nm`, modes: 'diff' },
  { toggles: [['beamStop', 'Beam stop']], modes: 'diff' },
  { chips: 'vdet', label: 'Virtual detector', modes: '4d', opts: [['bf', 'BF'], ['abf', 'ABF'], ['adf', 'ADF'], ['disk', 'Disk (DF)'], ['dpc', 'DPC'], ['com', 'Centre of mass'], ['ptycho', 'Ptychography']] },
  { chips: 'edsSel', label: 'Map element', modes: 'eds', dynOpts: () => [['all', 'All']].concat(sim.si ? [...new Set(sim.si.els.map((e) => e.sym))].map((s) => [s, s]) : []) },
  { chips: 'eelsRange', label: 'Spectrum range', modes: 'eels', opts: [['low', 'Low loss'], ['core', 'Core loss'], ['high', 'High loss']] },
  { slider: 'eelsWin', inv: 'eelsWin', label: 'Energy window centre', dyn: () => { const [a, b] = sim.eelsRangeBounds(); return { min: Math.max(0, a), max: b, step: b - a > 500 ? 1 : 0.5 }; }, fmt: (v) => `${v.toFixed(0)} eV`, modes: 'eels' },
  { slider: 'eelsWidth', inv: 'eelsWin', label: 'Window width', min: 2, max: 80, step: 1, fmt: (v) => `${v} eV`, modes: 'eels' },
  { toggles: [['bgsub', 'Subtract background']], modes: 'eels' },

  { sec: 'Time' },
  { slider: 'speed', inv: 'none', label: 'Simulation speed', min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { buttons: [['pause', 'Pause'], ['resetView', 'Reset view']] },
  { sec: 'Show' },
  { toggles: [['showLabels', 'Labels'], ['showElectrons', 'Electrons'], ['showGlass', 'Glass column'], ['autoRotate', 'Slow orbit']], grid: true },
  { sec: 'Experiments' },
  { exp: 'single', title: 'One electron at a time', desc: 'Dim the beam until electrons arrive singly. Watch the pattern emerge from random dots.', icon: 'dots' },
  { exp: 'tour', title: 'Fly down the column', desc: 'Follow an electron from the gun to the detector, one component at a time.', icon: 'path' },
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
function build() {
  for (const c of CONTROLS) {
    let el;
    if (c.sec) {
      el = document.createElement('h3');
      el.className = 'sec';
      el.textContent = c.sec;
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
    } else if (c.p) {
      el = document.createElement('p');
      el.className = 'ctl note';
      el.textContent = c.p;
      bound.push({ c, el });
    } else if (c.table) {
      el = document.createElement('table');
      el.className = 'data';
      el.innerHTML = '<tbody id="dataBody"></tbody>';
      bound.push({ c, el });
    }
    if (c.modes) el.dataset.modes = c.modes;
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
  box.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', JSON.stringify(S[c.chips]) === b.dataset.v));
}

function refreshControls() {
  document.body.dataset.mode = S.mode;
  for (const b of bound) {
    const vis = (!b.el.dataset.modes || b.el.dataset.modes.split(' ').includes(S.mode)) && (!b.c.show || b.c.show());
    b.el.hidden = !vis;
    if (!vis) continue;
    if (b.input) {
      const d = sliderDef(b.c);
      const lm = d.log ? logMap(d.min, d.max) : null;
      b.input.min = d.log ? 0 : d.min; b.input.max = d.log ? 1000 : d.max; b.input.step = d.log ? 1 : d.step;
      const v = b.c.ab ? S.ab[d.key] : S[d.key];
      b.input.value = lm ? lm.to(v) : v;
      const p = ((+b.input.value - +b.input.min) / (+b.input.max - +b.input.min)) * 100;
      b.input.style.setProperty('--p', `${clamp(p, 0, 100)}%`);
      b.val.textContent = (d.fmt || b.c.fmt)(v);
    }
    if (b.box) renderChips(b);
    if (b.c.toggles) b.el.querySelectorAll('.tog').forEach((t) => t.classList.toggle('on', !!S[t.dataset.key]));
  }
  document.querySelectorAll('[data-act="pause"]').forEach((b) => (b.textContent = S.paused ? 'Resume' : 'Pause'));
  document.querySelectorAll('.exp').forEach((e) => e.classList.toggle('on', (e.dataset.exp === 'single' && !!sim.single) || (e.dataset.exp === 'tour' && !!scene.tour)));
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('.clarity button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.clarity));
  const singleOk = !['eds', 'eels', 'microed', 'tomo'].includes(S.mode);
  const se = $('.exp[data-exp="single"]');
  if (se) se.classList.toggle('disabled', !singleOk);
  if ($('#infoTitle')) { renderInfo(); updateDetectorHeader(); }
}

// ------------------------------------------------------------------ state changes
function set(key, v, inv = key) {
  if (S[key] === v) return;
  S[key] = v;
  if (key === 'df') S.dfFam[fam(S.mode)] = v;
  if (key === 'detIn' || key === 'detOut') { if (S.detOut < S.detIn + 5) S.detOut = S.detIn + 5; S.detPreset = null; }
  if (key === 'eelsWin' || key === 'eelsWidth') inv = 'eelsWin';
  if (key === 'alpha4d') resetVdet();
  if (!['speed', 'showLabels', 'showElectrons', 'showGlass', 'autoRotate', 'paused'].includes(key)) sim.invalidate(inv);
  refreshControls();
  explainChange(inv === 'cs' ? 'cs' : ['tiltX', 'tiltY'].includes(key) ? 'tilt' : ['detIn', 'detOut'].includes(key) ? 'det' : ['alpha', 'alpha4d'].includes(key) ? 'alpha' : ['eelsWin', 'eelsWidth'].includes(key) ? 'eelsWin' : key);
}

function chip(key, v) {
  if (key === 'spec') return setSpec(v);
  if (key === 'corrector') {
    S.corrector = v;
    const lim = v ? 30 : 150;
    S.df = clamp(S.df, -lim, lim);
    if (!v && fam(S.mode) === 'tem') S.df = +(P.scherzerDefocus(sim.CsA(), sim.lam) / 10).toFixed(1);
    S.dfFam[fam(S.mode)] = S.df;
    if (!v && S.mode !== 'tem' && S.mode !== 'diff') { S.alpha = Math.min(S.alpha, 10); S.df = S.dfFam.probe = +(P.probeDefocus(sim.CsA(), sim.lam) / 10).toFixed(1); }
    if (v) { S.alpha = 22; S.dfFam.probe = 0; if (fam(S.mode) === 'probe') S.df = 0; }
    sim.invalidate('corrector');
    refreshControls();
    return explainChange('corrector');
  }
  if (key === 'detPreset') {
    const a = S.alpha;
    const p = { bf: [0, Math.round(a * 0.6)], abf: [Math.round(a * 0.5), Math.round(a)], adf: [Math.round(a * 1.1), Math.round(a * 3)], haadf: [Math.round(Math.max(3 * a, 60)), 200] }[v];
    S.detPreset = v; S.detIn = p[0]; S.detOut = p[1];
    sim.invalidate('det'); refreshControls();
    return explainChange('det');
  }
  if (key === 'vdet') { S.vdet = v; resetVdet(); sim.invalidate('vdet'); refreshControls(); return explainChange('vdet'); }
  if (key === 'eelsRange') {
    S.eelsRange = v;
    const [a, b] = sim.eelsRangeBounds();
    const def = { low: [22, 12], core: [S.spec === 'sto' ? 462 : S.spec === 'si' ? 102 : 100, S.spec === 'si' ? 5 : 16], high: [S.spec === 'au' ? 2260 : S.spec === 'si' ? 1860 : 1960, 60] }[v];
    S.eelsWin = clamp(def[0], a, b); S.eelsWidth = def[1];
    sim.invalidate('eelsRange'); refreshControls();
    return explainChange('eelsRange');
  }
  set(key, v, key === 'kV' ? 'kV' : key);
}

function resetVdet() {
  const a = S.alpha4d, mp = sim.fd?.mradPx ?? (P.wavelength(S.kV) * 1000) / (64 * 0.18);
  const edge = 30 * mp;
  if (S.vdet === 'bf') { S.vdIn = 0; S.vdOut = a; }
  if (S.vdet === 'abf') { S.vdIn = a / 2; S.vdOut = a; }
  if (S.vdet === 'adf') { S.vdIn = Math.min(a * 1.15, edge * 0.6); S.vdOut = edge; }
  if (S.vdet === 'disk') {
    const g = sim.spec.grains[0], [m, n] = S.spec === 'sto' ? [1, 0] : [1, 1];
    const gx = m * g.b[0][0] + n * g.b[1][0], gy = m * g.b[0][1] + n * g.b[1][1], gm = Math.hypot(gx, gy) * sim.lam * 1000;
    const r = a + gm * 0.5;
    S.vdX = (gx / Math.hypot(gx, gy)) * r; S.vdY = (gy / Math.hypot(gx, gy)) * r; S.vdR = Math.max(1.5, gm * 0.4);
  }
}

function setSpec(v) {
  S.spec = v;
  const sp = P.SPECIMENS[v];
  S.fov = sp.fov; S.cx = sp.center[0]; S.cy = sp.center[1]; S.tiltX = 0; S.tiltY = 0;
  S.edsSel = 'all';
  S.eelsRange = 'core';
  S.eelsWin = v === 'sto' ? 462 : v === 'si' ? 102 : 100;
  S.eelsWidth = v === 'si' ? 5 : v === 'au' ? 24 : 16;
  resetVdet();
  sim.invalidate('spec');
  refreshControls();
  explainChange('spec');
}

function setMode(m) {
  if (m === S.mode) return;
  S.mode = m;
  S.df = S.dfFam[fam(m)];
  S.fdSel = -1;
  if (['eds', 'eels', 'microed', 'tomo'].includes(m)) { if (sim.single) sim.startSingle(false); }
  sim.invalidate('mode');
  sim.stale.probe = 1;
  refreshControls();
  renderInfo();
  explainChange(null);
  updateDetectorHeader();
  if (sim.single) sim.startSingle(true);
}

function action(id, el) {
  if (id === 'zone') { S.tiltX = 0; S.tiltY = 0; sim.invalidate('tilt'); refreshControls(); explainChange('tilt'); }
  if (id === 'optfocus') {
    const Cs = sim.CsA(), lam = sim.lam;
    let df;
    df = (fam(S.mode) === 'tem' ? P.scherzerDefocus(Cs, lam) : P.probeDefocus(Cs, lam)) / 10;
    set('df', +df.toFixed(1), 'df');
  }
  if (id === 'pause') { S.paused = !S.paused; refreshControls(); }
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
  if (id === 'medStart') { sim.med.reset(); sim.version++; explainChange('microed'); }
  if (id === 'tomoStart') { sim.tomo.start(); sim.version++; }
  if (id === 'resetView') scene.resetView();
  if (id === 'single') {
    if (['eds', 'eels', 'microed', 'tomo'].includes(S.mode)) return;
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
function renderInfo() {
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
    '4d': [({ bf: 'Virtual BF image', abf: 'Virtual ABF image', adf: 'Virtual ADF image', disk: 'Virtual dark-field image', dpc: 'DPC · beam deflection', com: 'Centre-of-mass · electric field', ptycho: 'Ptychography · reconstructed phase' })[S.vdet], 'Direct electron detector · pattern at probe'],
    diff: [S.camera === 'screen' ? 'Fluorescent screen · pattern' : 'Direct electron detector · pattern', 'Ring profile & d-spacings'],
    eds: ['EDS element map', 'X-ray spectrum'],
    eels: ['Energy-filtered map', 'Electron energy-loss spectrum'],
    ronch: ['Ronchigram · direct electron detector', 'Aberration phase & budget'],
    cbed: [S.cbedKind === 'lacbed' ? 'LACBED pattern' : 'CBED pattern', S.cbedKind === 'lacbed' ? 'HOLZ lines & strain sensitivity' : 'Kossel–Möllenstedt thickness fit'],
    microed: ['Diffraction frame · continuous rotation', '3D reciprocal lattice'],
    tomo: ['Tilt series · HAADF projection', 'Reconstruction: slices & volume'],
  }[S.mode];
  $('#detTitle').textContent = names[0];
  $('#secTitle').textContent = names[1];
}

function updateTable() {
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
    b.title = `${sub} (key ${KEYS[i]})`;
    b.innerHTML = `${name}<kbd>${KEYS[i]}</kbd>`;
    b.addEventListener('click', () => setMode(m));
    grp.lastChild.appendChild(b);
  });
  document.querySelectorAll('.clarity button').forEach((b) => b.addEventListener('click', () => { S.clarity = b.dataset.v; sim.invalidate('clarity'); refreshControls(); explainChange('clarity'); }));
  $('#btnLabels').addEventListener('click', () => set('showLabels', !S.showLabels));
  $('#btnFull').addEventListener('click', () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); });
  $('#btnHelp').addEventListener('click', () => ($('#help').hidden = false));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) $('#help').hidden = true; });

  // detector interactions
  let drag = null;
  const rel = (e, cv) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; };
  mainCv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, tx: S.tiltX, ty: S.tiltY }; mainCv.setPointerCapture(e.pointerId); });
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
    if (S.mode === 'diff' || S.mode === 'microed' || S.mode === 'tomo' || S.mode === 'ronch') {
      if (S.mode !== 'diff') return;
      S.tiltX = clamp(+(drag.tx - dx * 0.006).toFixed(2), -3, 3); S.tiltY = clamp(+(drag.ty - dy * 0.006).toFixed(2), -3, 3);
      sim.invalidate('tilt'); refreshControls(); explainChange('tilt');
      return;
    }
    const sc = (S.mode === 'cbed' ? (S.cbedKind === 'lacbed' ? 440 : 60) : S.fov * 10) / w;
    S.cx = drag.cx - dx * sc; S.cy = drag.cy - dy * sc;
    sim.invalidate('stage');
  });
  const end = () => { if (drag && S.mode !== 'diff' && S.mode !== '4d' && (drag.cx !== S.cx || drag.cy !== S.cy)) explainChange('stage'); drag = null; };
  mainCv.addEventListener('pointerup', end);
  mainCv.addEventListener('pointercancel', end);
  mainCv.addEventListener('pointerleave', () => { if (S.mode === '4d' && S.fdSel >= 0) { S.fdSel = -1; sim.version++; } });
  mainCv.addEventListener('wheel', (e) => {
    if (S.mode === 'diff') { e.preventDefault(); set('camL', clamp(S.camL * Math.pow(1.0015, -e.deltaY), 80, 2000), 'camL'); return; }
    if (!['tem', 'stem', '4d', 'eds', 'eels'].includes(S.mode)) return;
    e.preventDefault();
    set('fov', clamp(S.fov * Math.pow(1.0015, e.deltaY), 1.5, 30), 'fov');
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
    if (e.target.tagName === 'INPUT') return;
    const i = KEYS.indexOf(e.key);
    if (e.key.length === 1 && i >= 0 && !e.metaKey && !e.ctrlKey) setMode(MODES[i][0]);
    else if (e.key === ' ') { e.preventDefault(); action('pause'); }
    else if (e.key === 'l' || e.key === 'L') set('showLabels', !S.showLabels);
    else if (e.key === 'e' || e.key === 'E') set('showElectrons', !S.showElectrons);
    else if (e.key === 'r' || e.key === 'R') scene.resetView();
    else if (e.key === 'c' || e.key === 'C') { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refreshControls(); explainChange('clarity'); }
    else if (e.key === 'Escape') { $('#help').hidden = true; if (scene.tour) scene.stopTour(); }
  });
  window.addEventListener('resize', resize);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const wide = w >= 1100;
  document.body.classList.toggle('stacked', !wide);
  let off = { left: 0, right: 0, bottom: 0, top: 0 };
  let cw = w, ch = h;
  if (wide) {
    const L = $('.explain').getBoundingClientRect(), Rr = $('.controls').getBoundingClientRect(), D = $('.detector').getBoundingClientRect();
    off = { left: L.right, right: w - Rr.left, bottom: h - D.top + 10, top: 70 };
  } else {
    const g = $('#gl').getBoundingClientRect();
    cw = g.width; ch = g.height;
    off = { left: 0, right: 0, bottom: 0, top: 0 };
  }
  scene.resize(cw, ch, off);
}

// ------------------------------------------------------------------ loop
let last = performance.now(), lastDraw = 0, lastVer = -1, lastSlow = 0, frames = 0, fpsT = 0, fps = 0;
const camCv = document.createElement('canvas');
camCv.width = camCv.height = 256;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    sim.update(dt);
    const live = (S.clarity === 'real' && ['tem', 'stem', 'diff', 'ronch', 'cbed'].includes(S.mode) && !S.paused) || ['microed', 'tomo'].includes(S.mode);
    if (sim.version !== lastVer || (live && now - lastDraw > 70)) {
      R2.draw(sim, S, mainCv, secCv);
      lastVer = sim.version;
      lastDraw = now;
      scene.screenTex.image = mainCv; scene.screenTex.needsUpdate = true;
      if (((S.mode === 'tem' || S.mode === 'diff') && S.camera === 'ded') || ['ronch', 'cbed', 'microed'].includes(S.mode)) { scene.camTex.image = mainCv; scene.camTex.needsUpdate = true; }
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
    if (['eds', '4d', 'eels', 'stem', 'microed', 'tomo', 'ronch', 'cbed'].includes(S.mode)) renderInfo();
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

build();
wire();
refreshControls();
renderInfo();
updateDetectorHeader();
explainChange('spec');
resize();
requestAnimationFrame(() => { resize(); requestAnimationFrame(frame); });
window.__tem = { S, sim, scene };
