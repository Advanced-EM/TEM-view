// Scanning 1938–2002: the instrument state, the live probe, the line-by-line scan, the panel, missions and recordings.
import { ERAS, probe, ronchiShift, electrons, lambdaNm } from './optics.js';
import { SPECIMENS, U_REF } from './specimens.js';
import { Knob, Pad, Gauge } from './ui.js';
import { PARTS, CONTROLS } from './texts.js';

const $ = (id) => document.getElementById(id);
const N = 256;                       // pixels per line
const FILM_E0 = 2e5;                 // electrons per film element for a good density (1938)
const fmtLen = (nm) => (nm >= 1000 ? `${(nm / 1000).toFixed(nm >= 10000 ? 0 : 1)} µm` : nm >= 1 ? `${nm.toFixed(nm >= 100 ? 0 : nm >= 10 ? 1 : 2)} nm` : `${(nm * 10).toFixed(2)} Å`);
const fmtI = (pA) => (pA >= 1000 ? `${(pA / 1000).toFixed(1)} nA` : pA >= 1 ? `${pA.toFixed(pA >= 100 ? 0 : 1)} pA` : `${(pA * 1000).toFixed(pA * 1000 >= 10 ? 0 : 1)} fA`);
const fmtT = (s) => (s >= 60 ? `${(s / 60).toFixed(s >= 600 ? 0 : 1)} min` : `${s.toFixed(s >= 10 ? 0 : 1)} s`);
const sup = (n) => String(n).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ state
const S = {
  era: 1938, spec: 'zno',
  pump: true, logP: -5, baking: 0, baked: false,    // log10(mbar)
  hv: 23, fil: 0.8, extract: 0, clean: 1, flashes: 0,
  demag: 1000, alpha: 6, focusC: 0, focusF: 0, stig: [0, 0], c3: 0, corrOn: true,
  fov: 8000, frame: 300, det: 'film', view: 'image',
  stage: [0, 0], drift: [0, 0], driftDir: Math.random() * 6.283,
  mis: { C1: 0, A1: [0, 0], C3: 0 },
  line: 0, lineAcc: 0, time: 0, frameT0: 0, frameDrift0: [0, 0], recording: false, recs: [], recNo: 0,
};
let D = {};
let mission = null, stepI = 0, done = new Set(), finished = new Set(), noteKey = null;

// ------------------------------------------------------------------ the image: a buffer filled line by line
const canvas = $('screen'), ctx = canvas.getContext('2d');
const buf = new Float32Array(N * N), img = ctx.createImageData(N, N), off = Object.assign(document.createElement('canvas'), { width: N, height: N });
let scale = [0, 1];

function aberrations() {
  const E = ERAS[S.era], ax = S.stig[0] + S.mis.A1[0], ay = S.stig[1] + S.mis.A1[1];
  const ab = { C1: S.focusC + S.focusF + S.mis.C1, A1: Math.hypot(ax, ay), A1a: Math.atan2(ay, ax) / 2, C3: E.Cs, C5: 0 };
  if (E.corrector && S.corrOn) { ab.C3 = (S.c3 + S.mis.C3) * 1e3; ab.C5 = E.C5; }
  return ab;
}
function emission() {
  if (S.era === 1938) return S.hv > 12 && S.fil > 0.15 ? S.fil * S.fil : 0;
  if (S.logP > -7 || S.extract < 2) return 0;
  return clamp((S.extract - 2) / 2.5, 0, 1) * S.clean;
}

function renderLine(j, pr, det, Ne) {
  const sp = SPECIMENS[S.spec], y = S.stage[1] + S.drift[1] + (j / N - 0.5) * S.fov;
  for (let i = 0; i < N; i++) {
    const x = S.stage[0] + S.drift[0] + (i / N - 0.5) * S.fov;
    const sig = sp.signal(x, y, pr, det);
    let v;
    if (det === 'film') { const e = Ne * sig; v = 1 - Math.exp(-e / FILM_E0) + 0.025 * gauss(); }
    else { const n = Ne * sig; v = (n > 30 ? n + Math.sqrt(n) * gauss() : poisson(n)) / Math.max(Ne, 1e-9); }
    buf[j * N + i] = v;
  }
}
function poisson(l) { if (l <= 0) return 0; let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= Math.random(); } while (p > L && k < 200); return k - 1; }

function paint() {
  const film = S.det === 'film', [lo, hi] = film ? [0, 0.9] : scale, d = img.data;
  // like a live monitor: the new frame overwrites the last one as the scan line passes
  for (let k = 0; k < N * N; k++) {
    let g = clamp((buf[k] - lo) / (hi - lo || 1), 0, 1); if (film) g = Math.pow(g, 0.8);
    const c = Math.round(g * 255);
    d[k * 4] = film ? Math.round(c * 0.96) : c; d[k * 4 + 1] = c; d[k * 4 + 2] = film ? Math.round(c * 0.88) : c; d[k * 4 + 3] = 255;
  }
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = S.fov / N > (D.p?.core ?? 0);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  // the scan line, as on a live monitor
  if (!film && S.line < N) { ctx.fillStyle = 'rgba(111,214,255,0.35)'; ctx.fillRect(0, (S.line / N) * canvas.height, canvas.width, 2); }
}
// contrast from the lines scanned so far (the first frame after a change), then from each full frame
function frameScale(lines = N) {
  const n = Math.max(1, lines) * N, s = Float32Array.from(buf.subarray(0, n)).sort();
  return [s[Math.floor(0.005 * (n - 1))], s[Math.floor(0.997 * (n - 1))]];
}
function resetScan() { S.line = 0; S.lineAcc = 0; buf.fill(0); scale = [0, 1]; S.scaled = false; }

// the Ronchigram (2002): the film's shadow through the probe optics
const ron = { key: '', data: null };
function hashN(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vn(x, y) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hashN(xi, yi) * (1 - u) + hashN(xi + 1, yi) * u) * (1 - v) + (hashN(xi, yi + 1) * (1 - u) + hashN(xi + 1, yi + 1) * u) * v; }
function paintRonch(ab) {
  const a = S.alpha, M = 160, key = `${a}|${ab.C1.toFixed(2)}|${ab.A1.toFixed(2)}|${ab.A1a.toFixed(3)}|${ab.C3.toFixed(0)}|${ab.C5}`;
  if (key !== ron.key) {
    ron.key = key; const im = ctx.createImageData(M, M), d = im.data, R = 1.35 * a * 1e-3;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const tx = ((i / (M - 1)) * 2 - 1) * R, ty = ((j / (M - 1)) * 2 - 1) * R, r = Math.hypot(tx, ty), k = (j * M + i) * 4;
      let g = 0.02;
      if (r <= a * 1e-3) { const [sx, sy] = ronchiShift(tx, ty, ab); const q = 1 / 0.22; g = 0.35 + 0.5 * (0.6 * vn(sx * q, sy * q) + 0.4 * vn(sx * q * 2.3 + 7, sy * q * 2.3)); g *= 0.92 + 0.08 * Math.cos(r / (a * 1e-3) * 3); }
      const c = Math.round(clamp(g, 0, 1) * 255); d[k] = c * 0.85; d[k + 1] = c * 0.95; d[k + 2] = c; d[k + 3] = 255;
    }
    ron.data = im;
  }
  const o = Object.assign(document.createElement('canvas'), { width: M, height: M }); o.getContext('2d').putImageData(ron.data, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(o, 0, 0, canvas.width, canvas.height);
  // the flat region, dashed
  const W = canvas.width, rr = (D.p.af / (1.35 * a)) * (W / 2);
  ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,180,94,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, W / 2, rr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,180,94,0.95)'; ctx.font = '500 14px IBM Plex Mono, monospace'; ctx.fillText(`flat to ${D.p.af.toFixed(1)} mrad`, 14, W - 16);
}

// ------------------------------------------------------------------ the control panel
const panel = $('panel'), K = {};
let gauge = null, stigPad = null;
function group(title, stateId) { const g = document.createElement('div'); g.className = 'grp'; g.innerHTML = `<header><h3>${title}</h3><span class="state" id="${stateId}"></span></header>`; panel.appendChild(g); return g; }
const info = (k) => () => showNote(k);
function knobs(g) { const k = document.createElement('div'); k.className = 'knobs'; g.appendChild(k); return k; }
function chips(g, id, opts, cur, on, note) {
  const c = document.createElement('div'); c.className = 'chips'; c.id = id; g.appendChild(c);
  for (const [v, l] of opts) { const b = document.createElement('button'); b.dataset.v = v; b.innerHTML = l; b.setAttribute('aria-pressed', String(v) === String(cur)); b.onclick = () => { on(v); c.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); }; if (note) b.onfocus = b.onpointerenter = info(note); c.appendChild(b); }
  return c;
}
const logKnob = (host, id, label, lo, hi, val, fmt, set, note) => new Knob(host, { id, label, min: Math.log10(lo), max: Math.log10(hi), value: Math.log10(val), fmt: (v) => fmt(10 ** v), onInput: (v) => set(10 ** v), onFocus: info(note || id) });

function buildPanel() {
  panel.innerHTML = ''; gauge = null; stigPad = null; for (const k in K) delete K[k]; const E = ERAS[S.era];
  if (mission?.free) {
    const ge = group('Instrument', 'stEra');
    chips(ge, 'eraChips', [[1938, '1938 <small>von Ardenne</small>'], [1970, '1970 <small>Crewe</small>'], [2002, '2002 <small>HB501</small>']], S.era, (y) => { setEra(+y, true); });
  }
  if (S.era === 1938) {
    const gg = group('Gun · thermionic', 'stGun'); const k = knobs(gg);
    K.hv = new Knob(k, { id: 'hv', label: 'High voltage', min: 0, max: E.kVmax, value: S.hv, fmt: (v) => `${v.toFixed(1)} kV`, onInput: (v) => (S.hv = v), onFocus: info('hv') });
    K.fil = new Knob(k, { id: 'fil', label: 'Filament', min: 0, max: 1, value: S.fil, fmt: (v) => `${Math.round(v * 100)} %`, onInput: (v) => (S.fil = v), onFocus: info('filament') });
  } else {
    const gv = group('Vacuum', 'stVac');
    const r = document.createElement('div'); r.className = 'row2'; gv.appendChild(r);
    const sw = document.createElement('button'); sw.className = 'sw'; sw.id = 'pumpBtn'; sw.innerHTML = '<i></i>Ion pumps'; sw.setAttribute('aria-pressed', S.pump); sw.onclick = () => { S.pump = !S.pump; sw.setAttribute('aria-pressed', S.pump); }; sw.onfocus = sw.onpointerenter = info('vacuum'); r.appendChild(sw);
    const bk = document.createElement('button'); bk.className = 'btn2'; bk.id = 'bakeBtn'; bk.textContent = 'Bake out'; bk.onclick = () => { if (S.pump) S.baking = 1; }; bk.onfocus = bk.onpointerenter = info('vacuum'); r.appendChild(bk);
    const gw = document.createElement('div'); gw.className = 'gauge'; gv.appendChild(gw); gauge = new Gauge(gw, 0, -11);
    const gp = document.createElement('p'); gp.innerHTML = '<b id="pTxt"></b><span id="pPhase"></span>'; gw.appendChild(gp);
    const gg = group(`Gun · cold field emission · ${E.kV} kV`, 'stGun'); const k = knobs(gg);
    K.extract = new Knob(k, { id: 'extract', label: 'Extraction', min: 0, max: 5, value: S.extract, fmt: (v) => `${v.toFixed(2)} kV`, onInput: (v) => (S.extract = v), onFocus: info('extract') });
    const fl = document.createElement('button'); fl.className = 'btn2'; fl.id = 'flashBtn'; fl.textContent = '⚡ Flash the tip'; fl.style.marginTop = '8px'; fl.onclick = flash; fl.onfocus = fl.onpointerenter = info('flash'); gg.appendChild(fl);
  }
  const gp = group('Probe', 'stProbe'); const kp = knobs(gp);
  K.demag = logKnob(kp, 'demag', 'Condenser', E.demag[0], E.demag[1], S.demag, (v) => `÷${v >= 100 ? Math.round(v) : v.toFixed(1)}`, (v) => (S.demag = v));
  K.alpha = new Knob(kp, { id: 'alpha', label: 'Aperture α', min: E.alpha[0], max: E.alpha[1], value: S.alpha, fmt: (v) => `${v.toFixed(1)} mrad`, onInput: (v) => (S.alpha = v), onFocus: info('alpha') });
  const fr = { 1938: 4000, 1970: 400, 2002: 120 }[S.era];
  K.focusC = new Knob(kp, { id: 'focusC', label: 'Focus coarse', min: -fr, max: fr, value: S.focusC, fmt: (v) => `${v >= 0 ? '+' : '−'}${fmtLen(Math.abs(v))}`, onInput: (v) => (S.focusC = v), onFocus: info('focus') });
  K.focusF = new Knob(kp, { id: 'focusF', label: 'Focus fine', min: -fr / 20, max: fr / 20, value: S.focusF, fmt: (v) => `${v >= 0 ? '+' : '−'}${fmtLen(Math.abs(v))}`, onInput: (v) => (S.focusF = v), onFocus: info('focus') });
  if (S.era !== 1938) {
    const sb = document.createElement('div'); sb.className = 'stagebox'; gp.appendChild(sb);
    const rS = S.era === 1970 ? 60 : 25;
    stigPad = new Pad(sb, { range: rS, x: S.stig[0], y: S.stig[1], aria: 'Stigmator: drag or use the arrow keys', onInput: (x, y) => (S.stig = [x, y]), onFocus: info('stig') });
    const p = document.createElement('p'); p.innerHTML = '<b style="color:var(--fg);font-weight:500">Stigmator.</b> Cancels two-fold astigmatism: drag until the image is sharp in every direction.'; sb.appendChild(p);
  } else stigPad = null;
  if (E.corrector) {
    const gc = group('Aberration corrector', 'stCorr');
    const r = document.createElement('div'); r.className = 'row2'; gc.appendChild(r);
    const sw = document.createElement('button'); sw.className = 'sw'; sw.id = 'corrBtn'; sw.innerHTML = '<i></i>Corrector'; sw.setAttribute('aria-pressed', S.corrOn); sw.onclick = () => { S.corrOn = !S.corrOn; sw.setAttribute('aria-pressed', S.corrOn); }; sw.onfocus = sw.onpointerenter = info('corrector'); r.appendChild(sw);
    const k = knobs(gc);
    K.c3 = new Knob(k, { id: 'c3', label: 'C3 trim', min: -150, max: 150, value: S.c3, fmt: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} µm`, onInput: (v) => (S.c3 = v), onFocus: info('corrector') });
  }
  const gs = group('Scan', 'stScan'); const ks = knobs(gs);
  K.fov = logKnob(ks, 'fov', 'Field of view', E.fov[0], E.fov[1], S.fov, fmtLen, (v) => (S.fov = v));
  K.frame = logKnob(ks, 'frame', 'Time per frame', E.frame[0], E.frame[1], S.frame, fmtT, (v) => (S.frame = v));
  const dets = { film: 'Film drum', bf: 'Bright field', adf: 'Annular dark field', ratio: 'Ratio (elastic / inelastic)' };
  chips(gs, 'detChips', E.detector.map((d) => [d, dets[d]]), S.det, (d) => { S.det = d; resetScan(); }, 'detector');
  const rec = document.createElement('button'); rec.className = 'expose'; rec.id = 'recBtn'; rec.onclick = () => { S.recording = true; S.line = 0; S.lineAcc = 0; S.frameT0 = S.time; S.frameDrift0 = [...S.drift]; };
  rec.onfocus = rec.onpointerenter = info('record'); gs.appendChild(rec);
  const ro = document.createElement('p'); ro.className = 'readout'; ro.id = 'readout'; gs.appendChild(ro);
}
function flash() {
  if (S.logP > -8.5) { S.clean = 0.4; coach('The vacuum is too poor: the flash cleans the tip, but gas covers it again at once. Bake the column first.', true); }
  else S.clean = 1;
  S.flashes++;
}

// ------------------------------------------------------------------ explanations
function label(key) { const t = PARTS[key] || CONTROLS[key]; return t ? { title: t.title, sub: t.sub, body: t.body } : null; }
function showNote(key) {
  const t = label(key); if (!t) return; noteKey = key;
  $('note').innerHTML = `<p class="de">${t.sub || ''}</p><h3>${t.title}</h3><p>${t.body}</p><p class="live" id="noteLive"></p>`;
}
function coach(msg, alert = false) { const c = $('coach'); c.innerHTML = msg || ''; c.classList.toggle('alert', alert); }

// the focus (coarse knob) that puts the most current into the sharpest core, for the other settings now
function bestFocus() {
  const E = ERAS[S.era], fr = { 1938: 4000, 1970: 400, 2002: 120 }[S.era], kV = S.era === 1938 ? Math.max(S.hv, 1) : E.kV;
  let best = null;
  for (let c = -fr; c <= fr; c += fr / 400) {
    const ab = aberrations(); ab.C1 = c + S.mis.C1;
    const p = probe({ era: S.era, kV, demag: S.demag, alpha: S.alpha, ab, emission: 1 });
    const score = p.w / p.core;
    if (!best || score > best.score) best = { c, score };
  }
  K.focusF?.set(0); K.focusC?.set(best.c);
}

// ------------------------------------------------------------------ missions
const MISSIONS = [
  { id: 'a1', era: 1938, year: '1937–38 · Berlin', title: 'Shrink the probe', spec: 'zno', fov: 20000, frame: 120,
    setup: () => { Object.assign(S, { hv: 0, fil: 0, demag: 300, alpha: 6 }); S.mis.C1 = 1800; },
    intro: 'Manfred von Ardenne’s idea: instead of imaging the whole specimen at once, focus the electrons into a tiny probe and move it across. First you need a probe: light the gun, then shrink the image of the hot filament onto the specimen.',
    steps: [
      { text: 'Heat the filament and set the high voltage to about 23 kV.', hint: 'Turn up the Filament and the High voltage knobs.', ctl: 'hv', done: () => S.hv > 20 && S.fil > 0.6, show: () => { K.hv.set(23); K.fil.set(0.85); } },
      { text: 'Demagnify the source until the probe’s source image is below 50 nm.', hint: 'Turn the Condenser up: more demagnification, smaller probe, much less current.', ctl: 'demag', done: () => D.p && D.p.dg < 50, show: () => K.demag.set(Math.log10(600)) },
      { text: 'Close the aperture to about 3 mrad and focus the probe: watch the crystals’ edges sharpen.', hint: 'With lenses of the 1930s, rays far from the axis are badly focused: close the Aperture to about 3 mrad, then turn Focus coarse and fine until the needles are sharp.', ctl: 'alpha', done: () => D.p && D.p.w > 0.5 && D.p.core < 60, show: () => { K.alpha.set(3); bestFocus(); } },
    ] },
  { id: 'a2', era: 1938, year: '1938 · Berlin', title: 'The first scanned picture', spec: 'zno', fov: 6000, frame: 600, ready: true,
    setup: () => { S.mis.C1 = 400; },
    intro: 'Record a picture of the zinc oxide crystals on the film drum. The trade-off of 1938: a smaller probe carries less current, so the film needs a longer exposure, and during a long exposure the specimen drifts.',
    steps: [
      { text: 'Focus the probe.', hint: 'Focus coarse, then fine, until the needles are sharp. Keep the aperture near 3 mrad.', ctl: 'focusC', done: () => D.p && D.p.w > 0.5, show: () => { if (S.alpha > 4) K.alpha.set(3); bestFocus(); } },
      { record: true, text: 'Record a full frame: well exposed, with the drift during the frame smaller than the probe.', hint: 'Balance probe size (Condenser), exposure (Time per frame) and drift. A probe of 60–100 nm and a few minutes per frame work.', ctl: 'recBtn' },
    ],
    pass: (r) => r.density > 0.3 && r.density < 0.92 && r.smear < 1.5 * r.core && r.core < 150,
    fail: (r) => r.density <= 0.3 ? 'The film is underexposed: more current (less demagnification) or a slower scan.' : r.density >= 0.92 ? 'Overexposed: a faster scan or less current.' : r.smear >= 1.5 * r.core ? `The specimen drifted ${fmtLen(r.smear)} during the frame, more than the probe size: scan faster, with more current.` : 'The probe is too large: demagnify more and focus.',
    result: (r) => ({ title: 'The first scanned transmission image', text: `Your frame took ${fmtT(r.frame)} with a ${fmtLen(r.core)} probe carrying ${fmtI(r.I)}. Von Ardenne recorded his scanned images on film the same way, at magnifications the light microscope could not reach, but the thermionic gun was the limit: a smaller probe meant hours of exposure. The next step needed a brighter source.` }) },
  { id: 'c1', era: 1970, year: 'Late 1960s · Chicago', title: 'Light the field emitter', spec: 'uranium', fov: 100, frame: 4,
    setup: () => { Object.assign(S, { pump: false, baked: false, logP: -6, extract: 0, clean: 0.2, flashes: 0 }); },
    intro: 'Albert Crewe’s solution to the brightness problem: a cold tungsten needle that emits by quantum tunnelling, about ten thousand times brighter than a hot filament. It only works in ultra-high vacuum.',
    steps: [
      { text: 'Switch on the ion pumps and bake out the column until the vacuum is below 10⁻⁹ mbar.', hint: 'Press Ion pumps, then Bake out, and watch the gauge.', ctl: 'bakeBtn', done: () => S.logP < -9, show: () => { S.pump = true; S.baking = 1; buildPanel(); } },
      { text: 'Flash the tip clean.', hint: 'Press Flash the tip.', ctl: 'flashBtn', done: () => S.flashes > 0 && S.clean > 0.9, show: flash },
      { text: 'Raise the extraction voltage until the tip emits strongly.', hint: 'Turn Extraction to about 4 kV.', ctl: 'extract', done: () => emission() > 0.6, show: () => K.extract.set(4.2) },
    ] },
  { id: 'c2', era: 1970, year: '1970 · Chicago', title: 'See single atoms', spec: 'uranium', fov: 60, frame: 4, ready: true,
    setup: () => { S.mis.C1 = 90; S.mis.A1 = [18, -10]; },
    intro: 'Uranium atoms on a carbon film two nanometres thick. Crewe, Wall and Langmore saw atoms like these in 1970. You need a probe of a few ångströms and a detector that favours heavy atoms.',
    steps: [
      { text: 'Use the annular dark-field detector.', hint: 'Choose Annular dark field.', ctl: 'detChips', done: () => S.det === 'adf', show: () => document.querySelector('#detChips [data-v="adf"]')?.click() },
      { text: 'Zoom in to a field of 10 nm or less.', hint: 'Turn Field of view down to about 8 nm.', ctl: 'fov', done: () => S.fov <= 10.5, show: () => K.fov.set(Math.log10(8)) },
      { text: 'Focus and stigmate the probe below 4 Å.', hint: 'Focus coarse, then fine; then drag the stigmator until the atoms are round dots.', ctl: 'focusC', done: () => D.p && D.p.core < 0.4 && D.p.w > 0.6, show: () => { stigPad?.set(-S.mis.A1[0], -S.mis.A1[1]); bestFocus(); } },
      { record: true, text: 'Record a frame in which single atoms stand out clearly from the film.', hint: 'Give each pixel enough electrons: a few seconds per frame.', ctl: 'recBtn' },
    ],
    pass: (r) => r.det === 'adf' && r.core < 0.4 && r.w > 0.6 && r.snr > 5,
    fail: (r) => r.snr <= 5 ? 'The atoms drown in shot noise: slow the scan or take more current.' : 'Tune the probe first (focus and stigmator), with the annular detector.',
    result: (r) => ({ title: 'Single atoms', text: `A ${fmtLen(r.core)} probe and the annular detector make single uranium atoms (Z = 92) stand out about ${Math.round(r.snr)} times above the noise against a carbon film (Z = 6). In 1970, Crewe, Wall and Langmore reported the first images of single atoms this way, with a field-emission gun the Chicago group had developed.` }) },
  { id: 'c3', era: 1970, year: '1970 · Chicago', title: 'Heavy from light', spec: 'uranium', fov: 8, frame: 4, ready: true, tuned: true,
    intro: 'The carbon film is not perfectly even, and its thickness variations look like faint blobs in the dark-field image. Crewe’s group divided the elastic signal by the inelastic one: thickness cancels, the heavy atoms remain.',
    steps: [
      { text: 'Look at the bright-field image: single atoms barely show.', hint: 'Choose Bright field.', ctl: 'detChips', done: () => S.det === 'bf', show: () => document.querySelector('#detChips [data-v="bf"]')?.click() },
      { text: 'Switch to the ratio signal.', hint: 'Choose Ratio.', ctl: 'detChips', done: () => S.det === 'ratio', show: () => document.querySelector('#detChips [data-v="ratio"]')?.click() },
      { record: true, text: 'Record a ratio frame.', hint: 'Press Record.', ctl: 'recBtn' },
    ],
    pass: (r) => r.det === 'ratio' && r.snr > 4, fail: () => 'Use the ratio signal and give it enough electrons per pixel.',
    result: () => ({ title: 'Z-contrast', text: 'Heavy atoms scatter strongly to high angles but lose energy only a little more than light ones, so the ratio of the two signals picks out the heavy atoms and cancels the film’s thickness variations. Z-contrast imaging is still how STEMs tell elements apart at a glance.' }) },
  { id: 'h1', era: 2002, year: '2002 · IBM', title: 'Tune the corrector', spec: 'si112', fov: 3, frame: 2, ready: true,
    setup: () => { S.mis.C1 = 24; S.mis.A1 = [7, 4]; S.mis.C3 = 110; S.alpha = 32; },
    intro: 'The VG HB501, upside down: the beam goes up from the gun through a corrector of quadrupoles and octupoles. The corrector has drifted. Read the Ronchigram, the shadow of an amorphous film seen through the probe optics, and make its smooth centre as wide as the aperture.',
    steps: [
      { text: 'Look at the Ronchigram.', hint: 'Choose Ronchigram under the screen.', ctl: 'viewsel', done: () => S.view === 'ronch', show: () => setView('ronch') },
      { text: 'Focus (C1) and stigmate (A1) until the flat centre is round and wider than 15 mrad.', hint: 'Focus coarse and fine make the centre grow; the stigmator makes it round.', ctl: 'focusC', done: () => D.p && D.p.af > 15, show: () => { stigPad?.set(-S.mis.A1[0], -S.mis.A1[1]); bestFocus(); } },
      { text: 'Trim the spherical aberration (C3) until the flat region exceeds 28 mrad.', hint: 'Turn C3 trim: the flat region grows as C3 approaches zero (slightly negative balances C5).', ctl: 'c3', done: () => D.p && D.p.af > 28, show: () => { K.c3.set(-S.mis.C3 - 2); bestFocus(); } },
    ] },
  { id: 'h2', era: 2002, year: '2002 · IBM', title: 'Below one ångström', spec: 'si112', fov: 3, frame: 2, ready: true, tuned: true,
    intro: 'With the corrector tuned, the aperture can open wide and the probe shrinks below the spacing of silicon’s dumbbells, 0.78 Å. Resolve them.',
    steps: [
      { text: 'Open the aperture to 30 mrad or more.', hint: 'Turn Aperture α up.', ctl: 'alpha', done: () => S.alpha >= 30, show: () => K.alpha.set(33) },
      { text: 'Demagnify enough that the source image is far below an ångström.', hint: 'Turn the Condenser up to ÷100 or more.', ctl: 'demag', done: () => D.p && D.p.dg < 0.045, show: () => K.demag.set(Math.log10(120)) },
      { record: true, text: 'Record an annular dark-field frame of 2 nm or less in which the dumbbells are split.', hint: 'Field of view about 1.5 nm, annular dark field, then Record.', ctl: 'recBtn' },
    ],
    pass: (r) => r.det === 'adf' && r.fov <= 2.05 && r.core < 0.075 && r.w > 0.75,
    fail: (r) => r.fov > 2.05 ? 'Zoom in to 2 nm or less so the pixels are smaller than the dumbbells.' : r.det !== 'adf' ? 'Use the annular dark-field detector.' : 'The probe is still too big: open the aperture, check the Ronchigram and demagnify more.',
    result: (r) => ({ title: 'A sub-ångström probe', text: `Your probe core is ${fmtLen(r.core)}, smaller than the 0.78 Å between the columns of each silicon dumbbell. In 2002, Batson, Dellby and Krivanek reported exactly this on IBM’s corrected VG HB501: the first electron probe smaller than one ångström.` }) },
  { id: 'free', era: 2002, year: 'Free exploration', title: 'All three instruments', spec: 'si112', fov: 5, frame: 2, ready: true, tuned: true, free: true,
    intro: 'Every instrument, ready to use. Switch between them in the panel and compare: the probe size, the current and the time each picture takes.', steps: [] },
];
function setEra(y, keepMission = false) {
  const E = ERAS[y]; S.era = y; S.spec = E.specimens[0]; S.det = E.detector[0];
  if (y === 1938) Object.assign(S, { hv: 23, fil: 0.85, demag: 400, alpha: 3, logP: -5 });
  else Object.assign(S, { pump: true, baked: true, logP: -10.3, extract: 4.2, clean: 1, demag: y === 1970 ? 40 : 120, alpha: y === 1970 ? 17 : 33, det: 'adf' });
  S.mis = { C1: 0, A1: [0, 0], C3: 0 }; S.focusC = { 1938: -560, 1970: -37, 2002: 0 }[y]; S.focusF = 0; S.stig = [0, 0]; S.c3 = y === 2002 ? -2 : 0; S.corrOn = true;
  S.fov = { 1938: 6000, 1970: 8, 2002: 2 }[y]; S.frame = { 1938: 240, 1970: 4, 2002: 2 }[y];
  S.view = 'image'; S.stage = [...SPECIMENS[S.spec].start]; S.drift = [0, 0]; resetScan();
  scene?.setEra(y);
  $('modelNote').textContent = { 1938: 'Schematic of von Ardenne’s 1938 instrument', 1970: 'Schematic of a Chicago field-emission STEM', 2002: 'Schematic of the VG HB501: gun at the bottom' }[y];
  $('viewsel').hidden = !E.corrector; setView(S.view);
  buildPanel();
}
function startMission(m) {
  mission = m; stepI = 0; done = new Set();
  setEra(m.era);
  if (!m.ready && m.era !== 1938) Object.assign(S, { pump: false, baked: false, logP: -6 });
  S.fov = m.fov; S.frame = m.frame; S.spec = m.spec;
  if (!m.tuned) { S.mis = { C1: 0, A1: [0, 0], C3: 0 }; }
  m.setup?.();
  setView(S.view); buildPanel();
  $('mYear').textContent = m.year; $('mTitle').textContent = m.title; $('mIntro').textContent = m.intro;
  $('steps').innerHTML = m.steps.map((s) => `<li>${s.text}</li>`).join('');
  $('mission').querySelector('.mfoot').hidden = !m.steps.length;
  document.querySelectorAll('#missions button').forEach((b) => b.setAttribute('aria-selected', b.dataset.id === m.id));
  stepsUI(); coach(m.steps[0]?.hint || 'Click any part of the column, or any knob, to read what it does.');
  try { localStorage.setItem('scanning-mission', m.id); } catch {}
}
function stepsUI() { [...$('steps').children].forEach((li, i) => { li.className = done.has(i) ? 'done' : i === stepI ? 'now' : ''; }); }
function advance() {
  const m = mission; if (!m?.steps.length) return;
  while (stepI < m.steps.length && !m.steps[stepI].record && m.steps[stepI].done()) { done.add(stepI); stepI++; coach(m.steps[stepI]?.hint || ''); }
  stepsUI();
}
function onRecord(r) {
  const m = mission; if (!m?.steps.length || !m.pass) return;
  const last = m.steps.length - 1;
  if (stepI < last) { coach('Good frame, but finish the steps above first: the mission checks them in order.'); return; }
  if (m.pass(r)) { done.add(last); stepI = last + 1; stepsUI(); finished.add(m.id); markMissions(); coach('Mission complete.'); showResult(m, r); }
  else coach(m.fail(r), true);
}
function markMissions() { document.querySelectorAll('#missions button').forEach((b) => b.classList.toggle('done', finished.has(b.dataset.id))); }
function hint() {
  const st = mission?.steps[stepI]; if (!st) return;
  coach(st.hint); st.show?.();
  const t = $(st.ctl) || document.querySelector(`.knob[data-k="${st.ctl}"]`);
  if (t) { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); t.animate([{ boxShadow: '0 0 0 0 rgba(111,214,255,0.9)' }, { boxShadow: '0 0 0 14px rgba(111,214,255,0)' }], { duration: 900, iterations: 3 }); }
}
$('hintBtn').onclick = hint;
$('restart').onclick = () => startMission(mission);
MISSIONS.forEach((m) => { const b = document.createElement('button'); b.role = 'tab'; b.dataset.id = m.id; b.innerHTML = `<small>${m.year}</small><span>${m.title}</span>`; b.onclick = () => startMission(m); $('missions').appendChild(b); });
function showResult(m, r) {
  const t = m.result(r); $('rEyebrow').textContent = `${m.year} · frame ${r.no}`; $('rTitle').textContent = t.title; $('rText').textContent = t.text; $('rPlate').src = r.url;
  const nxt = MISSIONS[MISSIONS.indexOf(m) + 1]; $('rNext').hidden = !nxt;
  $('result').showModal();
  $('result').onclose = () => { if ($('result').returnValue === 'next' && nxt) startMission(nxt); };
}

// ------------------------------------------------------------------ recordings
function record() {
  const p = D.p, sp = SPECIMENS[S.spec];
  const smear = Math.hypot(S.drift[0] - S.frameDrift0[0], S.drift[1] - S.frameDrift0[1]);
  let density = 0; if (S.det === 'film') { for (let k = 0; k < N * N; k++) density += buf[k]; density /= N * N; }
  const url = canvas.toDataURL('image/png');
  const r = { no: ++S.recNo, era: S.era, spec: S.spec, det: S.det, core: p.core, w: p.w, I: p.I, frame: S.frame, fov: S.fov, smear, density, snr: D.snr, url };
  S.recs.unshift(r); renderRecs(); onRecord(r);
}
function renderRecs() {
  const dn = { film: 'film', bf: 'bright field', adf: 'annular dark field', ratio: 'ratio' };
  $('plates').innerHTML = S.recs.map((r) => `<figure><img src="${r.url}" alt="Frame ${r.no}: ${SPECIMENS[r.spec].name}, ${dn[r.det]}"><figcaption><b>${r.era} · No. ${r.no}</b> · ${SPECIMENS[r.spec].short}<br>${dn[r.det]} · field ${fmtLen(r.fov)} · ${fmtT(r.frame)}<br>probe ${fmtLen(r.core)} · ${fmtI(r.I)}<br><a href="${r.url}" download="scan-${r.era}-${r.no}.png">Download</a></figcaption></figure>`).join('');
  $('platesInfo').textContent = S.recs.length ? `${S.recs.length} frame${S.recs.length > 1 ? 's' : ''} this session.` : 'No recordings yet. Press Record to keep the next full frame.';
}

// ------------------------------------------------------------------ the probe budget
const BROWS = [['dg', 'Source image'], ['diff', 'Diffraction (0.5 λ/α)'], ['chrom', 'Energy spread'], ['halo', 'Defocus and aberrations']];
const logX = (nm) => clamp(((Math.log10(Math.max(nm, 0.01)) + 2) / 6) * 100, 0, 100); // 0.01 nm … 10 µm
$('bRows').innerHTML = BROWS.map(([k, l]) => `<div class="brow" data-b="${k}"><span>${l}</span><span class="track"><i></i></span><b></b></div>`).join('') + '<div class="brow total" data-b="total"><span>Probe core</span><span class="track"><i></i></span><b></b></div>';
function budgetUI() {
  const p = D.p, E = ERAS[S.era], kV = S.era === 1938 ? S.hv : E.kV;
  const parts = { dg: p.dg, diff: (0.51 * p.lam) / (p.af * 1e-3), chrom: 0.3 * E.Cc * (p.af * 1e-3) * (E.dE / (Math.max(kV, 1) * 1e3)), halo: (1 - p.w) * p.halo, total: p.core };
  let mx = 0, mk = ''; for (const [k] of BROWS) if (parts[k] > mx) { mx = parts[k]; mk = k; }
  document.querySelectorAll('.brow').forEach((r) => { const k = r.dataset.b, v = parts[k];
    r.querySelector('i').style.width = logX(v) + '%'; r.querySelector('b').textContent = k === 'halo' ? `${Math.round((1 - p.w) * 100)} % of current` : fmtLen(v); r.classList.toggle('top', k === mk); });
  $('dNow').textContent = D.on ? fmtLen(p.core) : '—';
  $('bNote').textContent = `${fmtI(p.I)} in the probe · λ = ${(p.lam * 1000).toFixed(2)} pm · the core keeps ${Math.round(p.w * 100)} % of the current; the rest spreads into a halo of ${fmtLen(p.halo)}.`;
}

// ------------------------------------------------------------------ the screen: drag to move, wheel to zoom, view switch
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grab'); });
canvas.addEventListener('pointermove', (e) => { if (!drag || S.view !== 'image') return; const k = S.fov / canvas.clientWidth; S.stage[0] -= (e.clientX - drag[0]) * k; S.stage[1] -= (e.clientY - drag[1]) * k; drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; canvas.classList.remove('grab'); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const E = ERAS[S.era]; S.fov = clamp(S.fov * Math.pow(1.0015, e.deltaY), E.fov[0], E.fov[1]); K.fov?.set(Math.log10(S.fov), false); }, { passive: false });
function setView(v) { S.view = v; $('viewsel').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v)); $('viewHint').textContent = v === 'ronch' ? 'The Ronchigram: make the smooth centre as wide as the aperture' : 'Drag the image to move the specimen · scroll it to change the magnification'; }
$('viewsel').querySelectorAll('button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

// ------------------------------------------------------------------ the loop
const scene = await import('./scene.js').then((m) => m.createScene($('stage'), { onPick: (k) => showNote(k), label })).catch((e) => { console.error(e); return null; });
$('cutaway').onclick = (e) => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); scene?.setCutaway(on); };
$('spin').onclick = (e) => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); scene?.setSpin(on); };

let lastT = performance.now(), uiT = 0;
function update(now) {
  const dtR = clamp((now - lastT) / 1000, 0, 0.1); lastT = Math.max(lastT, now);
  const E = ERAS[S.era], speed = S.era === 1938 ? Math.max(1, S.frame / 30) : 1, dt = dtR * speed;
  S.time += dt;
  // vacuum: ion pumps alone reach ~10⁻⁷ mbar; a bake-out (a day, here seconds) reaches 10⁻¹⁰
  if (S.era !== 1938) {
    // once baked, the column stays at ultra-high vacuum while the pumps run; stopping them undoes the bake
    const floor = S.pump ? (S.baking || S.baked ? -10.4 : -7.2) : -4;
    S.logP += (floor - S.logP) * Math.min(1, dtR * (S.baking ? 0.35 : 0.6));
    if (S.baking && S.logP < -10.2) { S.baking = 0; S.baked = true; }
    if (!S.pump) { S.baking = 0; S.baked = false; }
    // the tip: adsorbed gas makes emission decay, faster in a poorer vacuum
    const tau = 600 * Math.pow(10, -(S.logP + 10));
    S.clean = Math.max(0.15, S.clean * Math.exp(-dt / Math.max(tau, 2)));
  }
  const em = emission(), on = em > 0.02;
  const ab = aberrations(), kV = S.era === 1938 ? Math.max(S.hv, 1) : E.kV;
  const p = probe({ era: S.era, kV, demag: S.demag, alpha: S.alpha, ab, emission: Math.max(em, 1e-6) });
  // emission flicker of a field emitter in a poor vacuum
  const flick = S.era !== 1938 && S.logP > -9 ? 1 + 0.4 * gauss() * (S.logP + 9) : 1;
  const I = on ? p.I * Math.max(0.05, flick) : 0;
  // drift: a slow random walk of the specimen
  S.driftDir += 0.3 * gauss() * Math.sqrt(dt); const v = E.drift;
  S.drift[0] += v * Math.cos(S.driftDir) * dt; S.drift[1] += v * Math.sin(S.driftDir) * dt;

  const dwell = S.frame / (N * N), Ne = electrons(I, dwell);
  const pr = { sc: Math.max(p.core, 1e-4) / 2.355, sh: Math.max(p.halo, p.core) / 2.355, w: p.w };
  // estimated single-atom signal to noise (1970 uranium): an atom's peak over the film, in electrons
  let snr = 0;
  if (S.spec === 'uranium') { const sp = SPECIMENS.uranium; const det = S.det === 'bf' ? 'adf' : S.det;
    const bg = sp.signal(U_REF[0] + 1.3, U_REF[1] + 1.1, pr, det), pk = Math.max(sp.signal(U_REF[0], U_REF[1], pr, det), bg);
    snr = S.det === 'bf' ? 0.15 * ((pk - bg) * Ne) / Math.sqrt(Math.max(bg * Ne, 1)) : ((pk - bg) * Ne) / Math.sqrt(Math.max(bg * Ne, 1)); }
  Object.assign(D, { p, I, on, Ne, snr, em });
  D.p = { ...p, I };

  // scan
  if (S.view === 'image' && on) {
    S.lineAcc += (dt * N) / S.frame;
    let n = 0;
    while (S.lineAcc >= 1 && n < 64) { S.lineAcc -= 1; n++;
      renderLine(S.line, pr, S.det, Ne); S.line++;
      if (S.line >= N) { S.line = 0; scale = frameScale(); S.scaled = true; if (S.recording) { S.recording = false; paint(); record(); } S.frameT0 = S.time; S.frameDrift0 = [...S.drift]; }
    }
    if (!S.scaled && S.line > 4) scale = frameScale(S.line);
    paint();
  } else if (S.view === 'ronch') { if (on) paintRonch(ab); else { ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, canvas.width, canvas.height); } }
  else { ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  $('progBar').style.width = `${(S.line / N) * 100}%`;

  scene?.update({ on: on ? 1 : 0, alpha: S.alpha, scan: S.line / N, tip: on ? Math.min(1, em * 1.2) : 0, drum: S.line / N });
  scene?.frame(now);
  uiT += dtR; if (uiT > 0.12) { uiT = 0; readouts(); advance(); }
}
function readouts() {
  const p = D.p, E = ERAS[S.era], dn = { film: 'Film drum', bf: 'Bright field', adf: 'Annular dark field', ratio: 'Ratio' };
  $('ovView').innerHTML = `${S.era} · ${S.view === 'ronch' ? 'Ronchigram' : dn[S.det]}<br>${(S.era === 1938 ? S.hv : E.kV).toFixed(0)} kV · ${D.on ? fmtI(D.I) : 'no beam'}`;
  $('ovProbe').textContent = D.on ? `probe ${fmtLen(p.core)}` : '';
  $('ovFov').textContent = `field ${fmtLen(S.fov)}`;
  const target = S.fov / 5, e = 10 ** Math.floor(Math.log10(target)), L = [1, 2, 5].map((m) => m * e).reduce((a, x) => (Math.abs(x - target) < Math.abs(a - target) ? x : a));
  $('scaleBar').style.width = `${(L / S.fov) * $('window').clientWidth * 0.95}px`; $('scaleTxt').textContent = fmtLen(L);
  let msg = '';
  if (S.era === 1938 && S.hv <= 12) msg = 'No high voltage';
  else if (S.era === 1938 && S.fil <= 0.15) msg = 'The filament is cold';
  else if (S.era !== 1938 && S.logP > -7) msg = 'The vacuum is too poor for field emission';
  else if (S.era !== 1938 && S.extract < 2) msg = 'No extraction voltage: the tip does not emit';
  else if (D.Ne < 3 && S.view === 'image') msg = 'Too few electrons per pixel: more current or a slower scan';
  $('ovMsg').textContent = msg;
  if (gauge) { gauge.set(S.logP); const ex = Math.floor(S.logP); $('pTxt').textContent = `${(10 ** (S.logP - ex)).toFixed(1)}×10${sup(ex)} mbar`; $('pPhase').textContent = S.baking ? 'Baking out' : !S.pump ? 'Pumps off' : S.logP > -9 ? 'Ion pumps' : 'Ultra-high vacuum'; }
  const speed = S.era === 1938 ? Math.max(1, S.frame / 30) : 1;
  $('stGun') && ($('stGun').textContent = D.on ? (S.era === 1938 ? `${S.hv.toFixed(1)} kV` : `emission ${Math.round(D.em * 100)} %`) : 'off');
  $('stProbe').textContent = D.on ? `${fmtLen(p.core)} · ${fmtI(D.I)}` : '';
  if ($('stCorr')) $('stCorr').textContent = S.corrOn ? `flat to ${p.af.toFixed(1)} mrad` : 'off';
  $('stScan').textContent = `${fmtT(S.frame)} per frame${speed > 1 ? ` · shown ${Math.round(speed)}× faster` : ''}`;
  $('recBtn').innerHTML = `<span>${S.recording ? 'Recording the next full frame…' : S.era === 1938 ? 'Expose a film frame' : 'Record a frame'}</span><small>${S.recording ? `${Math.round((S.line / N) * 100)} %` : ''}</small>`;
  $('readout').innerHTML = `<b>${D.Ne >= 1e4 ? D.Ne.toExponential(1) : Math.round(D.Ne)}</b> electrons per pixel · drift ${(ERAS[S.era].drift).toFixed(ERAS[S.era].drift < 0.1 ? 3 : 1)} nm/s`;
  budgetUI();
}
function tick(now) { update(now); requestAnimationFrame(tick); }

// ------------------------------------------------------------------ start
let first = MISSIONS[0];
try { const id = new URLSearchParams(location.search).get('mission') || localStorage.getItem('scanning-mission'); first = MISSIONS.find((m) => m.id === id) || first; } catch {}
startMission(first);
requestAnimationFrame((t) => { lastT = t; tick(t); });
// for automated checks
window.scanning = { S, get D() { return D; }, K, startMission: (id) => startMission(MISSIONS.find((m) => m.id === id)), hint,
  run(sec) { for (let t = 0; t < sec; t += 1 / 30) update(lastT + 1000 / 30); } };
