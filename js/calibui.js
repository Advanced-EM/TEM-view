// The "Calibrate from data" dialog: fit the twin to measured data, one tab per modality, plus an editor
// for the instrument profile. Every tab can also generate simulated data from a "mystery" instrument with
// hidden miscalibrations, so the fits can be tried (and checked) without a microscope.
import * as P from './physics.js';
import { Sim } from './sim.js';
import { biprism } from './holography.js';
import { FIELDS, sanitizeProfile } from './profile.js';
import { readImageFile, parseSpectrum, fitCTF, fitZLP, fitLattice, fitRings, fitDisk, fitEDS, fitHologram, STANDARDS, synthRings } from './calibrate.js';
import { paint, LUT, range } from './render2d.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const SPECTROMETER = 0.15; // eV: spectrometer and detector broadening removed from a measured zero-loss width
const rnd = (a, b) => a + Math.random() * (b - a);

export const TABS = [
  ['profile', 'Instrument profile'],
  ['ctf', 'TEM · Thon rings'],
  ['lattice', 'TEM/STEM · lattice scale'],
  ['rings', 'Diffraction · camera length'],
  ['disk', '4D-STEM/CBED · detector angles'],
  ['eds', 'EDS · resolution'],
  ['zlp', 'EELS · energy spread'],
  ['holo', 'Holography · fringe contrast'],
];
export const TAB_FOR_MODE = { tem: 'ctf', ilh: 'ctf', stem: 'lattice', diff: 'rings', '4d': 'disk', cbed: 'disk', ronch: 'disk', eds: 'eds', eels: 'zlp', oah: 'holo' };

let ctx = null; // { S, sim, onApply }
let tab = 'ctf';
const data = {}, res = {}; // loaded data and fit results, per tab

export function openCalibration(c, which) {
  ctx = c;
  tab = which ?? TAB_FOR_MODE[c.S.mode] ?? 'ctf';
  const m = $('#calib');
  m.hidden = false;
  if (!m.dataset.wired) {
    m.dataset.wired = 1;
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) m.hidden = true; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.hidden = true; });
  }
  render();
}

// a separate simulator with a copy of the state, so generating data never disturbs the exhibit
function scratchSim(over = {}, prof = {}) {
  const S = structuredClone(ctx.S);
  Object.assign(S, over);
  Object.assign(S.profile, prof);
  return new Sim(S);
}
const noisy = (a, N) => { let m = 0; for (const v of a) m += v; m /= a.length; return a.map((v) => P.poisson((v / m) * N)); };

// ---------------------------------------------------------------- shell
function render() {
  const body = $('#calib .calibBody');
  body.innerHTML = `
    <p class="eyebrow">Digital twin · calibration</p>
    <h2>Fit the twin to <em>your instrument</em></h2>
    <div class="ctabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="cTab"></div>`;
  body.querySelectorAll('.ctabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
  ({ profile: tabProfile, ctf: tabCTF, lattice: tabLattice, rings: tabRings, disk: tabDisk, eds: tabEDS, zlp: tabZLP, holo: tabHolo })[tab]($('#cTab'));
}
const fileRow = (label, accept, simLabel) => `<div class="crow"><label class="file">${label}<input type="file" id="cFile" accept="${accept}"></label><button class="btn" id="cSim">${simLabel}</button></div>`;
const num = (id, label, value, step = 'any') => `<label>${label}<input id="${id}" type="number" step="${step}" value="${value ?? ''}"></label>`;
const val = (id) => +$(`#${id}`).value;
const info = (d) => `<p class="muted" id="cInfo">${d ? esc(`${d.name}${d.w ? `: ${d.w} × ${d.h} px` : d.E ? `: ${d.E.length} channels` : ''}${d.note ? ` · ${d.note}` : ''}`) : 'No data loaded.'}</p>`;
function wireFile(kind, onSim) {
  $('#cFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (kind === 'image') { const r = await readImageFile(f); data[tab] = { ...r, name: f.name, source: f.name }; }
      else data[tab] = { ...parseSpectrum(await f.text(), val('cDisp') || 0.01), name: f.name, source: f.name };
      delete res[tab]; render();
    } catch (err) { $('#cInfo').textContent = `Could not read ${f.name}: ${err.message}`; }
  });
  $('#cSim').addEventListener('click', () => { onSim(); delete res[tab]; render(); });
}
function applyRow(text, payload) {
  return { html: `<div class="crow"><button class="btn primary" id="cApply">Apply to the twin</button><span class="muted">${text}</span></div>`, wire: () => $('#cApply').addEventListener('click', () => { ctx.onApply(payload()); $('#cApply').textContent = 'Applied ✓'; $('#cApply').disabled = true; }) };
}
const table = (rows) => `<table class="data">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
const truth = (d) => (d?.truth ? `<p class="muted">Hidden values used to simulate these data: ${esc(d.truth)}</p>` : '');

// ---------------------------------------------------------------- instrument profile
function tabProfile(el) {
  const pr = ctx.S.profile;
  el.innerHTML = `
    <p>Enter what you know about your microscope. Every mode uses these values: the optics (TEM, holography, in-line), magnification and scan (TEM, STEM, maps), camera length and distortion (diffraction, STEM detectors, 4D-STEM, CBED, Ronchigram), the EDS detector and the gun's energy spread (EELS). The other tabs measure them from data.</p>
    <div class="cgrid">
      <label>Name<input id="pName" type="text" value="${esc(pr.name)}"></label>
      <label>Gun<input id="pGun" type="text" value="${esc(pr.gun)}"></label>
      ${FIELDS.map(([k, l, u]) => num(`p_${k}`, `${l}${u ? ` (${u})` : ''}`, pr[k])).join('')}
    </div>
    <p class="muted" id="cInfo"></p>
    <div class="crow"><button class="btn primary" id="cApply">Apply to the twin</button><span class="muted">Values outside a sensible range are refused.</span></div>`;
  $('#cApply').addEventListener('click', () => {
    try {
      const o = { ...structuredClone(pr), name: $('#pName').value, gun: $('#pGun').value };
      for (const [k] of FIELDS) o[k] = val(`p_${k}`);
      ctx.onApply({ type: 'profile', profile: sanitizeProfile(o) });
      $('#cApply').textContent = 'Applied ✓';
    } catch (err) { $('#cInfo').textContent = err.message; }
  });
}

// ---------------------------------------------------------------- TEM: Thon rings
function tabCTF(el) {
  const S = ctx.S, d = data.ctf, csMm = S.corrector ? S.csCor / 1000 : S.csUnc;
  el.innerHTML = `
    <p>An image of a thin <b>amorphous</b> film (carbon, ice) a few hundred nm to a few µm out of focus. The fit finds defocus and two-fold astigmatism from the Thon rings in its power spectrum, as CTFFIND and Gctf do. Files stay in your browser.</p>
    ${fileRow('Image (.mrc, .npy, .png, .jpg, .tif)', '.mrc,.mrcs,.map,.npy,.png,.jpg,.jpeg,.tif,.tiff', 'Use a simulated image')}
    <div class="cgrid">${num('cPix', 'Pixel size (Å)', d?.pixA)}${num('cKV', 'Voltage (kV)', d?.kV ?? S.kV)}${num('cCs', 'Cₛ (mm)', d?.csMm ?? csMm)}</div>
    ${info(d)}${truth(d)}<button class="btn primary" id="cFit" ${d ? '' : 'disabled'}>Fit</button><div id="cOut"></div>`;
  wireFile('image', () => {
    // a mystery state: thin amorphous carbon at a hidden defocus and astigmatism, with the twin's Cs and voltage
    // defocus kept where 1.34 Å pixels still resolve the rings near Nyquist (larger defocus aliases them)
    const df = -Math.round(rnd(200, 600)), A1 = +rnd(2, 15).toFixed(1), A1a = Math.round(rnd(0, 180));
    const sim = scratchSim({ mode: 'tem', spec: 'au', fov: 30, cx: -180, cy: 160, df, objAp: 'none', cryo: false, ab: { A1, A1a, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 } });
    sim.computeTEM();
    const t = sim.tem;
    data.ctf = { data: noisy(t.img, 400), w: t.c, h: t.c, pixA: +t.dx.toFixed(4), kV: S.kV, name: 'simulated image of amorphous carbon', source: 'simulated', truth: `defocus ${df} nm, A1 ${A1} nm at ${A1a}°` };
  });
  $('#cFit').addEventListener('click', () => run(() => {
    d.pixA = val('cPix'); d.kV = val('cKV'); d.csMm = val('cCs');
    if (!(d.pixA > 0) || !(d.kV >= 60)) throw new Error('enter the pixel size (Å at the specimen) and the voltage');
    res.ctf = { ...fitCTF(d.data, d.w, d.h, { pixA: d.pixA, kV: d.kV, CsA: d.csMm * 1e7 }), pixA: d.pixA, kV: d.kV, CsA: d.csMm * 1e7 };
  }, showCTF));
  if (res.ctf) showCTF();
}
function showCTF() {
  const r = res.ctf, good = r.score > 0.2;
  const ap = applyRow(`Sets the twin's defocus and astigmatism${ctx.S.corrector ? '' : ' and Cₛ'}, and records the fit in the profile.`, () => ({ type: 'ctf', df: r.df, A1: r.A1, A1a: r.A1a, fitRes: r.fitRes, kV: r.kV, CsA: r.CsA, pixA: r.pixA, source: data.ctf.source }));
  $('#cOut').innerHTML = `<div class="cres"><canvas id="cA" title="left: measured · right: fitted"></canvas><canvas id="cB"></canvas></div>
    ${table([['Defocus', `<b>${(r.df / 10).toFixed(1)} nm</b> ${r.df < 0 ? '(underfocus)' : '(overfocus)'}`], ['Two-fold astigmatism A1', `${(r.A1 / 10).toFixed(1)} nm at ${r.A1a.toFixed(0)}°`], ['Fit score', `${r.score.toFixed(2)}${good ? '' : ' · weak: check pixel size and voltage, or use a thinner amorphous area'}`], ['Rings fitted to', `${r.fitRes.toFixed(1)} Å (Nyquist ${r.nyquist.toFixed(1)} Å)`]])}
    ${good ? ap.html : ''}`;
  const q = fitCanvas($('#cA')), B = r.B, half = new Float32Array(B * B), [lo, hi] = range(r.meas, 0.02, 0.98);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const i = y * B + x; half[i] = x < B / 2 ? (r.meas[i] - lo) / (hi - lo || 1) : 0.5 + 0.45 * r.model[i]; }
  paint(q.ctx, half, B, B, [0, 0, q.W, q.H], { lo: 0, hi: 1, lut: LUT.ice });
  label(q, 'measured', 6, 14); label(q, 'fitted', q.W / q.dpr / 2 + 6, 14);
  plot(fitCanvas($('#cB')), [{ pts: r.profile, color: '#e9edf2' }, { pts: r.modelProfile, color: '#ffb45e' }], 'rotational average (white), fit (orange) · 1/Å');
  if (good) ap.wire();
}

// ---------------------------------------------------------------- TEM/STEM: lattice scale and scan distortion
function tabLattice(el) {
  const S = ctx.S, d = data.lattice;
  el.innerHTML = `
    <p>An atomic-resolution image of a <b>single crystal</b> with a known spacing. The Bragg peaks in its power spectrum give the true pixel size, so the <b>magnification calibration</b>. For STEM, comparing the peaks in different directions also measures the scan's <b>aspect ratio and shear</b>. Square lattices need two directions 90° apart, hexagonal ones 60°.</p>
    ${fileRow('Image (.mrc, .npy, .png, .jpg, .tif)', '.mrc,.mrcs,.map,.npy,.png,.jpg,.jpeg,.tif,.tiff', 'Use a simulated mystery instrument')}
    <div class="cgrid">${num('cPix', 'Nominal pixel size (Å)', d?.pixA)}${num('cD', 'Known spacing d (Å)', d?.dSp ?? 2.761)}
      <label>Lattice<select id="cLat"><option value="square">square (90°)</option><option value="hex">hexagonal (60°)</option><option value="any">any (3+ directions)</option></select></label>
      <label>Image type<select id="cKind"><option value="stem">STEM (scale + scan)</option><option value="tem">TEM (scale only)</option></select></label></div>
    <p class="muted">Examples: SrTiO₃ [001] {110} 2.761 Å (square); graphene {10̄10} 2.13 Å (hexagonal).</p>
    ${info(d)}${truth(d)}<button class="btn primary" id="cFit" ${d ? '' : 'disabled'}>Fit</button><div id="cOut"></div>`;
  if (d?.lattice) $('#cLat').value = d.lattice;
  $('#cKind').value = d?.kind ?? (S.mode === 'tem' ? 'tem' : 'stem');
  wireFile('image', () => {
    const kind = $('#cKind').value, mys = { magCal: +rnd(0.96, 1.04).toFixed(4), scanAspect: kind === 'stem' ? +rnd(0.97, 1.03).toFixed(4) : 1, scanShear: kind === 'stem' ? +rnd(-2.5, 2.5).toFixed(2) : 0 };
    const sim = scratchSim({ mode: kind, spec: 'sto', fov: 8, cx: -70, cy: 0, tiltX: 0, tiltY: 0, cryo: false, corrector: true, csCor: 5, alpha: 22, objAp: 'none', ab: { A1: 0, A1a: 0, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 }, df: kind === 'tem' ? -4 : 0 }, mys);
    let img;
    if (kind === 'tem') { sim.computeTEM(); img = sim.tem; } else { sim.computeSTEM(); img = sim.stemImg; }
    data.lattice = { data: noisy(img.img, 300), w: img.c, h: img.c, pixA: +(80 / img.c).toFixed(4), dSp: 2.761, lattice: 'square', kind, name: `simulated ${kind.toUpperCase()} image of SrTiO₃ [001], one grain`, source: 'simulated', truth: `magnification ${mys.magCal}${kind === 'stem' ? `, scan aspect ${mys.scanAspect}, shear ${mys.scanShear}°` : ''}` };
  });
  $('#cFit').addEventListener('click', () => run(() => {
    d.pixA = val('cPix'); d.dSp = val('cD'); d.lattice = $('#cLat').value; d.kind = $('#cKind').value;
    if (!(d.pixA > 0 && d.dSp > 0)) throw new Error('enter the nominal pixel size and the known spacing');
    res.lattice = { ...fitLattice(d.data, d.w, d.h, { pixA: d.pixA, d: d.dSp, lattice: d.lattice }), kind: d.kind };
  }, showLattice));
  if (res.lattice) showLattice();
}
function showLattice() {
  const r = res.lattice, stem = r.kind === 'stem';
  const ap = applyRow(stem ? 'Sets the magnification calibration and the STEM scan aspect and shear.' : 'Sets the magnification calibration.', () => ({ type: 'lattice', magCal: stem ? r.magCal : r.magIso, scanAspect: stem ? r.aspect : null, scanShear: stem ? r.shear : null, d: data.lattice.dSp, source: data.lattice.source }));
  $('#cOut').innerHTML = `<div class="cres"><canvas id="cA"></canvas><div>${table([
    ['Magnification calibration', `<b>${(stem ? r.magCal : r.magIso).toFixed(4)}</b> (true pixel ${(data.lattice.pixA * (stem ? r.magCal : r.magIso)).toFixed(4)} Å)`],
    ...(stem ? [['Scan aspect (y / x)', r.aspect.toFixed(4)], ['Scan shear', `${r.shear.toFixed(2)}°`]] : [['Anisotropy of the peaks', `${(r.spread * 100).toFixed(1)} %`]]),
    ['Peaks used', `${r.dirs.used} of ${r.dirs.length} directions`]])}</div></div>${ap.html}`;
  const q = fitCanvas($('#cA')), ps = r.ps, [lo, hi] = range(ps.arr, 0.3, 0.999);
  paint(q.ctx, ps.arr, ps.n, ps.n, [0, 0, q.W, q.H], { lo, hi, lut: LUT.ice });
  const sc = q.W / ps.n, c = q.W / 2;
  q.ctx.strokeStyle = '#ffb45e'; q.ctx.lineWidth = 1.5 * q.dpr;
  for (const g of r.dirs) for (const sg of [1, -1]) { q.ctx.beginPath(); q.ctx.arc(c + (sg * g.kx / r.dk) * sc, c + (sg * g.ky / r.dk) * sc, 6 * q.dpr, 0, 7); q.ctx.stroke(); }
  q.ctx.setLineDash([3 * q.dpr, 3 * q.dpr]); q.ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  q.ctx.beginPath(); q.ctx.arc(c, c, r.r0 * sc, 0, 7); q.ctx.stroke(); q.ctx.setLineDash([]);
  label(q, 'power spectrum · expected radius dashed', 6, 14);
  ap.wire();
}

// ---------------------------------------------------------------- diffraction: camera length and ellipticity
function tabRings(el) {
  const S = ctx.S, d = data.rings;
  el.innerHTML = `
    <p>A ring pattern of a <b>polycrystalline standard</b> (evaporated gold or aluminum). Matching its rings to the known spacings gives the true <b>camera length</b>, which also sets the STEM detector angles and the 4D-STEM angular scale; the shape of the strongest ring gives the <b>elliptical distortion</b> of the projector lenses.</p>
    ${fileRow('Pattern (.mrc, .npy, .png, .tif)', '.mrc,.mrcs,.npy,.png,.jpg,.jpeg,.tif,.tiff', 'Use a simulated mystery instrument')}
    <div class="cgrid">${num('cPixMM', 'Detector pixel size (mm)', d?.pixMM ?? 0.1)}${num('cL', 'Nominal camera length (mm)', d?.Lnom ?? S.camL)}${num('cKV', 'Voltage (kV)', d?.kV ?? S.kV)}
      <label>Standard<select id="cStd">${Object.entries(STANDARDS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label></div>
    ${info(d)}${truth(d)}<button class="btn primary" id="cFit" ${d ? '' : 'disabled'}>Fit</button><div id="cOut"></div>`;
  if (d?.std) $('#cStd').value = d.std;
  wireFile('image', () => {
    const mys = { camLCal: +rnd(0.95, 1.05).toFixed(4), ellip: +rnd(0.005, 0.04).toFixed(4), ellipAng: Math.round(rnd(-90, 90)) };
    const W = 512, pixMM = 0.1, L = S.camL;
    data.rings = { data: synthRings({ W, pixMM, L: L * mys.camLCal, kV: S.kV, d: STANDARDS.Au.d, ellip: mys.ellip, ellipAng: mys.ellipAng }), w: W, h: W, pixMM, Lnom: L, kV: S.kV, std: 'Au', name: 'simulated ring pattern of an evaporated gold standard', source: 'simulated', truth: `camera length ×${mys.camLCal}, ellipticity ${mys.ellip} at ${mys.ellipAng}°` };
  });
  $('#cFit').addEventListener('click', () => run(() => {
    d.pixMM = val('cPixMM'); d.Lnom = val('cL'); d.kV = val('cKV'); d.std = $('#cStd').value;
    res.rings = fitRings(d.data, d.w, d.h, { pixMM: d.pixMM, Lnom: d.Lnom, kV: d.kV, d: STANDARDS[d.std].d });
  }, showRings));
  if (res.rings) showRings();
}
function showRings() {
  const r = res.rings, d = data.rings;
  const ap = applyRow('Sets the camera-length calibration (diffraction, STEM detectors, 4D-STEM, CBED) and the projector ellipticity.', () => ({ type: 'rings', camLCal: r.camLCal, ellip: r.ellip, ellipAng: r.ellipAng, source: d.source }));
  $('#cOut').innerHTML = `<div class="cres"><canvas id="cA"></canvas><canvas id="cB"></canvas></div>
    ${table([['True camera length', `<b>${r.L.toFixed(1)} mm</b> (×${r.camLCal.toFixed(4)} of nominal)`], ['Camera constant λL', `${(P.wavelength(d.kV) * r.L).toFixed(2)} Å·mm`], ['Ellipticity', `${(r.ellip * 100).toFixed(2)} % at ${r.ellipAng.toFixed(0)}°`], ['Rings matched', r.rings.map((g) => `${g.d} Å`).join(', ')]])}${ap.html}`;
  const q = fitCanvas($('#cA')), [lo, hi] = range(d.data, 0.02, 0.995, (v) => Math.log(1 + v));
  paint(q.ctx, d.data, d.w, d.h, [0, 0, q.W, q.H], { lo, hi, log: true, lut: LUT.ice });
  const sc = q.W / d.w;
  q.ctx.strokeStyle = 'rgba(255,180,94,0.8)'; q.ctx.lineWidth = 1 * q.dpr;
  for (const g of r.rings) { q.ctx.beginPath(); q.ctx.arc(r.center[0] * sc, r.center[1] * sc, g.r * sc, 0, 7); q.ctx.stroke(); }
  plot(fitCanvas($('#cB')), [{ pts: r.prof.map((v, i) => [i, Math.log(Math.max(v, 1e-9))]), color: '#e9edf2' }], 'radial profile (log) · matched rings in orange on the left');
  ap.wire();
}

// ---------------------------------------------------------------- 4D-STEM / CBED / Ronchigram: angular calibration
function tabDisk(el) {
  const S = ctx.S, d = data.disk, nom = ctx.sim.fd?.mradPx ?? (P.wavelength(S.kV) * 1000) / (64 * 0.18);
  el.innerHTML = `
    <p>A pattern recorded <b>through vacuum</b> (or the central disk of any pattern) with a known convergence semi-angle. The disk's radius in pixels gives the true <b>milliradians per pixel</b> of the camera, the angular scale of 4D-STEM, CBED and the Ronchigram, and with it the camera-length calibration.</p>
    ${fileRow('Pattern (.mrc, .npy, .png, .tif)', '.mrc,.mrcs,.npy,.png,.jpg,.jpeg,.tif,.tiff', 'Use a simulated mystery instrument')}
    <div class="cgrid">${num('cAlpha', 'Convergence semi-angle α (mrad)', d?.alpha ?? S.alpha4d)}${num('cNom', 'Nominal mrad per pixel', (d?.nom ?? nom).toFixed(4))}</div>
    ${info(d)}${truth(d)}<button class="btn primary" id="cFit" ${d ? '' : 'disabled'}>Fit</button><div id="cOut"></div>`;
  wireFile('image', () => {
    // a camera with realistic sampling (the disk ~40 px across its radius), nominal scale α/40 mrad per pixel
    const cl = +rnd(0.94, 1.06).toFixed(4), n = 160, a = S.alpha4d, nomS = +(a / 40).toFixed(4), r = a / (nomS / cl), img = new Float32Array(n * n), cx = 80 + rnd(-4, 4), cy = 80 + rnd(-4, 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) img[y * n + x] = P.poisson(4 + 300 * Math.min(1, Math.max(0, r - Math.hypot(x - cx, y - cy) + 0.5)));
    data.disk = { data: img, w: n, h: n, alpha: a, nom: nomS, name: 'simulated vacuum pattern (bright-field disk)', source: 'simulated', truth: `camera length ×${cl}` };
  });
  $('#cFit').addEventListener('click', () => run(() => {
    d.alpha = val('cAlpha'); d.nom = val('cNom');
    res.disk = fitDisk(d.data, d.w, d.h, { alpha: d.alpha, mradPxNom: d.nom });
  }, showDisk));
  if (res.disk) showDisk();
}
function showDisk() {
  const r = res.disk, d = data.disk;
  const ap = applyRow('Sets the camera-length calibration, the angular scale of 4D-STEM, CBED, the Ronchigram and the STEM detectors.', () => ({ type: 'disk', camLCal: r.camLCal, mradPx: r.mradPx, source: d.source }));
  $('#cOut').innerHTML = `<div class="cres"><canvas id="cA"></canvas><div>${table([['Disk radius', `${r.r.toFixed(2)} px`], ['True angular scale', `<b>${r.mradPx.toFixed(4)} mrad/px</b>`], ['Camera-length calibration', `×${r.camLCal.toFixed(4)}`]])}</div></div>${ap.html}`;
  const q = fitCanvas($('#cA')), [lo, hi] = range(d.data, 0.01, 0.999);
  paint(q.ctx, d.data, d.w, d.h, [0, 0, q.W, q.H], { lo, hi, lut: LUT.ice });
  const sc = q.W / d.w;
  q.ctx.strokeStyle = '#ffb45e'; q.ctx.lineWidth = 1.5 * q.dpr; q.ctx.beginPath(); q.ctx.arc(r.center[0] * sc, r.center[1] * sc, r.r * sc, 0, 7); q.ctx.stroke();
  ap.wire();
}

// ---------------------------------------------------------------- EDS: resolution and energy scale
function tabEDS(el) {
  const S = ctx.S, d = data.eds, els = d?.els ?? [...new Set(ctx.sim.spec.elements.map((e) => P.EL[e].sym)), 'Cu'].join(', ');
  el.innerHTML = `
    <p>A spectrum with known, well-separated peaks (a Mn or Cu standard, or your specimen). Peak widths give the detector's <b>resolution at Mn Kα</b> (FWHM² grows linearly with energy, the Fano law), and peak positions the <b>energy calibration</b>. Overlapping lines are skipped.</p>
    ${fileRow('Spectrum (.csv, .txt, .msa: keV, counts)', '.csv,.txt,.tsv,.msa,.emsa,.dat', 'Use a simulated mystery instrument')}
    <div class="cgrid"><label>Elements present<input id="cEls" type="text" value="${esc(els)}"></label>${num('cDisp', 'Dispersion for one-column files (keV/channel)', 0.01)}</div>
    ${info(d)}${truth(d)}<button class="btn primary" id="cFit" ${d ? '' : 'disabled'}>Fit</button><div id="cOut"></div>`;
  wireFile('spectrum', () => {
    const fw = Math.round(rnd(118, 165));
    const sim = scratchSim({ mode: 'eds' }, { edsFWHM: fw });
    sim.computeSI();
    const e = sim.eds;
    data.eds = { E: Float64Array.from({ length: e.nb }, (_, i) => (i + 0.5) * e.dE), I: Float64Array.from(noisy(e.spec, 300)), name: `simulated EDS spectrum of ${sim.spec.name}`, source: 'simulated', truth: `resolution ${fw} eV at Mn Kα`, els: $('#cEls').value };
  });
  $('#cFit').addEventListener('click', () => run(() => {
    const syms = $('#cEls').value.split(/[\s,;]+/).filter(Boolean);
    d.els = syms.join(', ');
    const lines = P.XRAY.filter((l) => syms.includes(l.el)).map((l) => ({ E: l.E, w: l.w, label: `${l.el} ${l.line}` }));
    res.eds = fitEDS(d.E, d.I, lines);
  }, showEDS));
  if (res.eds) showEDS();
}
function showEDS() {
  const r = res.eds, d = data.eds;
  const ap = applyRow('Sets the EDS detector resolution used for every simulated spectrum and map.', () => ({ type: 'eds', fwhmMn: r.fwhmMn, gain: r.gain, offset: r.offset, source: d.source }));
  $('#cOut').innerHTML = `<div class="cres"><canvas id="cA" class="wide"></canvas></div>
    ${table([['Resolution at Mn Kα', `<b>${r.fwhmMn.toFixed(1)} eV</b>`], ['Energy gain / offset', `${r.gain.toFixed(4)} / ${(r.offset * 1000).toFixed(1)} eV`],
      ...r.found.map((f) => [f.label, `${f.Emeas.toFixed(3)} keV (expected ${f.E.toFixed(3)}), FWHM ${(f.fwhm * 1000).toFixed(0)} eV`]),
      ...(r.found.skipped?.length ? [['Skipped (overlapping)', r.found.skipped.join(', ')]] : [])])}${ap.html}`;
  plot(fitCanvas($('#cA')), [{ pts: Array.from(d.E, (e, i) => [e, Math.log10(1 + d.I[i])]), color: '#e9edf2' }], 'spectrum (log counts) vs keV', null, r.found.map((f) => f.Emeas));
  ap.wire();
}

// ---------------------------------------------------------------- EELS: energy spread
function tabZLP(el) {
  const S = ctx.S, d = data.zlp;
  el.innerHTML = `
    <p>The <b>zero-loss peak</b> recorded through vacuum with a short exposure and fine dispersion. Its width is the gun's energy spread plus ~${SPECTROMETER} eV of spectrometer broadening, which is removed here. The energy spread sets the EELS resolution and, through chromatic aberration, the TEM information limit.</p>
    ${fileRow('Spectrum (.csv, .txt, .msa: eV, counts)', '.csv,.txt,.tsv,.msa,.emsa,.dat', 'Use a simulated mystery instrument')}
    <div class="cgrid">${num('cDisp', 'Dispersion for one-column files (eV/channel)', 0.01)}</div>
    ${info(d)}${truth(d)}<button class="btn primary" id="cFit" ${d ? '' : 'disabled'}>Fit</button><div id="cOut"></div>`;
  wireFile('spectrum', () => {
    const dE = +rnd(0.3, 1.0).toFixed(3), fw = Math.hypot(dE, SPECTROMETER), s = fw / 2.355, E = [], I = [];
    for (let i = 0; i < 300; i++) { const e = -1.5 + i * 0.01; E.push(e); I.push(P.poisson(4 + 2e4 * Math.exp(-0.5 * (e / s) ** 2) * (1 + 0.05 * Math.max(0, -e)))); }
    data.zlp = { E: Float64Array.from(E), I: Float64Array.from(I), name: 'simulated zero-loss peak', source: 'simulated', truth: `energy spread ${dE} eV` };
  });
  $('#cFit').addEventListener('click', () => run(() => { const f = fitZLP(d.E, d.I); res.zlp = { ...f, dE: Math.sqrt(Math.max(0.01, f.fwhm * f.fwhm - SPECTROMETER * SPECTROMETER)) }; }, showZLP));
  if (res.zlp) showZLP();
}
function showZLP() {
  const r = res.zlp, d = data.zlp;
  const ap = applyRow('Updates the energy spread, and with it the focal spread, the information limit and the EELS resolution.', () => ({ type: 'zlp', fwhm: r.fwhm, dE: r.dE, source: d.source }));
  $('#cOut').innerHTML = `<div class="cres"><canvas id="cA" class="wide"></canvas></div>
    ${table([['Zero-loss FWHM', `<b>${r.fwhm.toFixed(3)} eV</b> (channel ${r.channel.toFixed(3)} eV${r.fwhm < 4 * r.channel ? ': undersampled' : ''})`], ['Gun energy spread ΔE', `${r.dE.toFixed(3)} eV`]])}${ap.html}`;
  plot(fitCanvas($('#cA')), [{ pts: Array.from(d.E, (e, i) => [e, d.I[i]]), color: '#e9edf2' }], `zero-loss peak · FWHM ${r.fwhm.toFixed(3)} eV`, [r.lo, r.hi]);
  ap.wire();
}

// ---------------------------------------------------------------- holography: fringe contrast
function tabHolo(el) {
  const S = ctx.S, d = data.holo;
  el.innerHTML = `
    <p>A <b>vacuum hologram</b> (no specimen) at a known biprism voltage. Its fringe spacing and contrast μ measure the biprism geometry and the coherence of the illumination; with the coherence width from the profile, μ gives the instrument's <b>fringe contrast</b> at small overlap (μ₀), which sets the phase precision of every hologram.</p>
    ${fileRow('Hologram (.mrc, .npy, .png, .tif)', '.mrc,.mrcs,.npy,.png,.jpg,.jpeg,.tif,.tiff', 'Use a simulated mystery instrument')}
    <div class="cgrid">${num('cPix', 'Pixel size (Å)', d?.pixA)}${num('cU', 'Biprism voltage (V)', d?.U ?? S.biprism)}</div>
    ${info(d)}${truth(d)}<button class="btn primary" id="cFit" ${d ? '' : 'disabled'}>Fit</button><div id="cOut"></div>`;
  wireFile('image', () => {
    const mu0 = +rnd(0.5, 0.9).toFixed(3), U = S.biprism, bp = biprism(U, { ...S.profile, holoMu0: mu0 }), pix = +(bp.s / 4.3).toFixed(4), n = 256, th = rnd(0, Math.PI), img = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) img[y * n + x] = P.poisson(200 * (1 + bp.mu * Math.cos((2 * Math.PI * (x * Math.cos(th) + y * Math.sin(th)) * pix) / bp.s + 0.4)));
    data.holo = { data: img, w: n, h: n, pixA: pix, U, name: 'simulated vacuum hologram', source: 'simulated', truth: `μ₀ = ${mu0}` };
  });
  $('#cFit').addEventListener('click', () => run(() => {
    d.pixA = val('cPix'); d.U = val('cU');
    if (!(d.pixA > 0)) throw new Error('enter the pixel size');
    const f = fitHologram(d.data, d.w, d.h, { pixA: d.pixA }), bp = biprism(d.U, { ...ctx.S.profile, holoMu0: 1 });
    res.holo = { ...f, mu0: f.mu / bp.mu, W: bp.W };
  }, showHolo));
  if (res.holo) showHolo();
}
function showHolo() {
  const r = res.holo, d = data.holo;
  const ap = applyRow('Sets the fringe contrast μ₀ used for every simulated hologram.', () => ({ type: 'holo', mu0: Math.min(1, r.mu0), mu: r.mu, U: d.U, source: d.source }));
  $('#cOut').innerHTML = `<div class="cres"><canvas id="cA"></canvas><div>${table([['Fringe spacing', `${r.spacing.toFixed(3)} Å`], ['Fringe contrast μ', `<b>${(r.mu * 100).toFixed(1)} %</b> at ${d.U} V (overlap ${r.W.toFixed(1)} nm)`], ['Implied μ₀', `${Math.min(1, r.mu0).toFixed(3)}`]])}</div></div>${ap.html}`;
  const q = fitCanvas($('#cA')), [lo, hi] = range(d.data, 0.01, 0.99);
  paint(q.ctx, d.data, d.w, d.h, [0, 0, q.W, q.H], { lo, hi, lut: LUT.ice });
  ap.wire();
}

// ---------------------------------------------------------------- helpers
function run(fit, show) {
  $('#cOut').textContent = 'Fitting…';
  setTimeout(() => { try { fit(); show(); } catch (err) { $('#cOut').textContent = `Fit failed: ${err.message}`; } }, 20);
}
function fitCanvas(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
  return { ctx: cv.getContext('2d'), W: cv.width, H: cv.height, dpr };
}
function label(q, t, x, y) {
  q.ctx.font = `${10 * q.dpr}px "IBM Plex Mono", monospace`; q.ctx.fillStyle = '#e9edf2'; q.ctx.fillText(t, x * q.dpr, y * q.dpr);
}
function plot(q, series, title, band, ticks) {
  const { ctx: c, W, H, dpr } = q, pad = 18 * dpr;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of series) for (const [x, y] of s.pts) { if (!Number.isFinite(y)) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const X = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad), Yp = (y) => H - pad - ((y - y0) / (y1 - y0 || 1)) * (H - 2.2 * pad);
  c.fillStyle = '#06080b'; c.fillRect(0, 0, W, H);
  if (band) { c.fillStyle = 'rgba(255,180,94,0.18)'; c.fillRect(X(band[0]), pad, X(band[1]) - X(band[0]), H - 2 * pad); }
  if (ticks) { c.strokeStyle = 'rgba(255,180,94,0.7)'; for (const t of ticks) { c.beginPath(); c.moveTo(X(t), pad); c.lineTo(X(t), H - pad); c.stroke(); } }
  for (const s of series) {
    c.strokeStyle = s.color; c.lineWidth = 1.3 * dpr; c.beginPath();
    s.pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Yp(y)) : c.moveTo(X(x), Yp(y))));
    c.stroke();
  }
  c.font = `${9 * dpr}px "IBM Plex Mono", monospace`; c.fillStyle = '#8a94a3';
  c.fillText(title, pad, 12 * dpr);
  c.fillText(x0.toFixed(2), pad, H - 4 * dpr);
  c.textAlign = 'right'; c.fillText(x1.toFixed(2), W - pad, H - 4 * dpr); c.textAlign = 'left';
}
