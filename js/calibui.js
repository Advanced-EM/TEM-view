// The "Calibrate from data" dialog: fit the twin's optics to a measured image or spectrum.
import * as P from './physics.js';
import { readImageFile, parseSpectrum, fitCTF, fitZLP } from './calibrate.js';
import { paint, LUT, range } from './render2d.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const SPECTROMETER = 0.15; // eV: spectrometer and detector broadening removed from the measured width

let ctx = null; // { S, sim, onApply }
let img = null, spec = null, ctfRes = null, zlpRes = null, tab = 'ctf';

export function openCalibration(c) {
  ctx = c;
  const m = $('#calib');
  m.hidden = false;
  if (!m.dataset.wired) {
    m.dataset.wired = 1;
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) m.hidden = true; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.hidden = true; });
  }
  render();
}

function render() {
  const { S } = ctx, body = $('#calib .calibBody');
  const csMm = S.corrector ? S.csCor / 1000 : S.csUnc;
  body.innerHTML = `
    <p class="eyebrow">Digital twin · calibration</p>
    <h2>Fit the twin to <em>your data</em></h2>
    <div class="ctabs"><button data-t="ctf" class="${tab === 'ctf' ? 'on' : ''}">Thon rings → defocus, astigmatism</button><button data-t="zlp" class="${tab === 'zlp' ? 'on' : ''}">Zero-loss peak → energy spread</button></div>
    ${tab === 'ctf' ? `
      <p>Use an image of a thin <b>amorphous</b> film (carbon, ice) at a few hundred nm to a few µm underfocus. The fit finds defocus and two-fold astigmatism from the Thon rings in its power spectrum, as CTFFIND and Gctf do. It runs in your browser; the file never leaves it.</p>
      <div class="crow"><label class="file">Image (.mrc, .npy, .png, .jpg, .tif)<input type="file" id="cImg" accept=".mrc,.mrcs,.map,.npy,.png,.jpg,.jpeg,.tif,.tiff"></label>
        <button class="btn" id="cSim">Use a simulated image</button></div>
      <div class="cgrid">
        <label>Pixel size (Å)<input id="cPix" type="number" step="0.001" min="0.01" value="${img?.pixA ?? ''}"></label>
        <label>Voltage (kV)<input id="cKV" type="number" step="10" min="60" max="400" value="${img?.kV ?? S.kV}"></label>
        <label>Cₛ (mm)<input id="cCs" type="number" step="0.001" value="${img?.csMm ?? csMm}"></label>
      </div>
      <p class="muted" id="cInfo">${img ? esc(`${img.name}: ${img.w} × ${img.h} px${img.note ? ` · ${img.note}` : ''}`) : 'No image loaded.'}</p>
      <button class="btn primary" id="cFit" ${img ? '' : 'disabled'}>Fit</button>
      <div id="cOut"></div>`
    : `
      <p>Record a spectrum of the <b>zero-loss peak</b> through vacuum, with a short exposure and fine dispersion. Its full width at half maximum is the gun's energy spread plus the spectrometer's own broadening (~${SPECTROMETER} eV, removed here). The energy spread sets the focal spread and so the information limit.</p>
      <div class="crow"><label class="file">Spectrum (.csv, .txt, .msa: energy, counts)<input type="file" id="cSpec" accept=".csv,.txt,.tsv,.msa,.emsa,.dat"></label>
        <button class="btn" id="cSynth">Use a simulated peak</button></div>
      <div class="cgrid"><label>Dispersion for one-column files (eV/channel)<input id="cDisp" type="number" step="0.001" value="0.05"></label></div>
      <p class="muted">${spec ? esc(`${spec.name}: ${spec.E.length} channels`) : 'No spectrum loaded.'}</p>
      <button class="btn primary" id="cFitZ" ${spec ? '' : 'disabled'}>Fit</button>
      <div id="cOut"></div>`}`;
  body.querySelectorAll('.ctabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
  if (tab === 'ctf') {
    $('#cImg').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { const r = await readImageFile(f); img = { ...r, name: f.name, pixA: r.pixA ?? null, source: f.name }; ctfRes = null; render(); }
      catch (err) { $('#cInfo').textContent = `Could not read ${f.name}: ${err.message}`; }
    });
    $('#cSim').addEventListener('click', simulatedImage);
    $('#cFit').addEventListener('click', runCTF);
    if (ctfRes) showCTF();
  } else {
    $('#cSpec').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { spec = { ...parseSpectrum(await f.text(), +$('#cDisp').value || 0.05), name: f.name }; zlpRes = null; render(); }
      catch (err) { $('#cOut').textContent = `Could not read ${f.name}: ${err.message}`; }
    });
    $('#cSynth').addEventListener('click', simulatedPeak);
    $('#cFitZ').addEventListener('click', runZLP);
    if (zlpRes) showZLP();
  }
}

// A TEM image from the twin itself at its current settings, with shot noise: lets anyone try the fit.
function simulatedImage() {
  const { S, sim } = ctx, keepMain = sim.main, keepDf = S.df;
  S.df = S.dfFam.tem; // TEM-family defocus, whatever mode the exhibit is in
  sim.computeTEM();
  S.df = keepDf;
  const t = sim.tem, N0 = Math.max(5, S.dose * t.dx * t.dx * 0.9);
  let m = 0;
  for (const v of t.img) m += v;
  m /= t.img.length;
  const data = t.img.map((v) => P.poisson((v / m) * N0));
  sim.main = keepMain;
  img = { data, w: t.c, h: t.c, pixA: +t.dx.toFixed(4), kV: S.kV, name: 'simulated image (twin, current settings)', source: 'simulated', note: `true defocus ${S.dfFam.tem} nm, A1 ${S.ab.A1} nm at ${S.ab.A1a}°` };
  ctfRes = null;
  render();
}

function runCTF() {
  const pixA = +$('#cPix').value, kV = +$('#cKV').value, cs = +$('#cCs').value;
  const out = $('#cOut');
  if (!(pixA > 0)) { out.textContent = 'Enter the pixel size in Å (at the specimen).'; return; }
  if (!(kV >= 60)) { out.textContent = 'Enter the accelerating voltage.'; return; }
  out.textContent = 'Fitting…';
  img.pixA = pixA; img.kV = kV; img.csMm = cs;
  setTimeout(() => {
    try { ctfRes = { ...fitCTF(img.data, img.w, img.h, { pixA, kV, CsA: cs * 1e7 }), pixA, kV, CsA: cs * 1e7 }; showCTF(); }
    catch (err) { out.textContent = `Fit failed: ${err.message}`; }
  }, 20);
}

function showCTF() {
  const r = ctfRes, out = $('#cOut');
  const good = r.score > 0.2;
  out.innerHTML = `
    <div class="cres"><canvas id="cPS" title="left: measured · right: fitted"></canvas><canvas id="cProf"></canvas></div>
    <table class="data">
      <tr><td>Defocus</td><td><b>${(r.df / 10).toFixed(1)} nm</b> ${r.df < 0 ? '(underfocus)' : '(overfocus)'}</td></tr>
      <tr><td>Two-fold astigmatism A1</td><td>${(r.A1 / 10).toFixed(1)} nm at ${r.A1a.toFixed(0)}°</td></tr>
      <tr><td>Fit score (correlation)</td><td>${r.score.toFixed(2)}${good ? '' : ' · weak: check pixel size, voltage, or use a thinner amorphous area'}</td></tr>
      <tr><td>Rings fitted to</td><td>${r.fitRes.toFixed(1)} Å (Nyquist ${r.nyquist.toFixed(1)} Å)</td></tr>
      <tr><td>Power spectrum</td><td>${r.B}² px, ${r.tiles} tile${r.tiles > 1 ? 's' : ''}</td></tr>
    </table>
    <div class="crow"><button class="btn primary" id="cApply" ${good ? '' : 'disabled'}>Apply to the twin</button><span class="muted">Sets the twin's defocus and astigmatism${ctx.S.corrector ? '' : ' and Cₛ'}, and records the fit in the instrument profile.</span></div>`;
  const cv = $('#cPS'), q = fitCanvas(cv), B = r.B, half = new Float32Array(B * B);
  const [lo, hi] = range(r.meas, 0.02, 0.98);
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const i = y * B + x;
    half[i] = x < B / 2 ? (r.meas[i] - lo) / (hi - lo || 1) : 0.5 + 0.45 * r.model[i];
  }
  paint(q.ctx, half, B, B, [0, 0, q.W, q.H], { lo: 0, hi: 1, lut: LUT.ice });
  q.ctx.strokeStyle = 'rgba(255,255,255,0.5)'; q.ctx.beginPath(); q.ctx.moveTo(q.W / 2, 0); q.ctx.lineTo(q.W / 2, q.H); q.ctx.stroke();
  label(q, 'measured', 6, 14); label(q, 'fitted', q.W / 2 + 6, 14);
  const pc = fitCanvas($('#cProf'));
  plot(pc, [{ pts: r.profile, color: '#e9edf2' }, { pts: r.modelProfile, color: '#ffb45e' }], 'rotational average (white) and fit (orange), vs spatial frequency (1/Å)');
  $('#cApply').addEventListener('click', () => {
    ctx.onApply({ type: 'ctf', df: r.df, A1: r.A1, A1a: r.A1a, fitRes: r.fitRes, kV: r.kV, CsA: r.CsA, pixA: r.pixA, source: img.source });
    $('#cApply').textContent = 'Applied ✓'; $('#cApply').disabled = true;
  });
}

function simulatedPeak() {
  const { S } = ctx, fw = Math.hypot(S.profile.dE, SPECTROMETER), s = fw / 2.355, E = [], I = [];
  for (let i = 0; i < 300; i++) { const e = -1.5 + i * 0.01; E.push(e); I.push(P.poisson(4 + 2e4 * Math.exp(-0.5 * (e / s) ** 2) * (1 + 0.05 * Math.max(0, -e)))); }
  spec = { E: Float64Array.from(E), I: Float64Array.from(I), name: `simulated zero-loss peak (twin: ΔE ${S.profile.dE} eV)`, source: 'simulated' };
  zlpRes = null;
  render();
}

function runZLP() {
  try { const f = fitZLP(spec.E, spec.I); zlpRes = { ...f, dE: Math.sqrt(Math.max(0.01, f.fwhm * f.fwhm - SPECTROMETER * SPECTROMETER)) }; showZLP(); }
  catch (err) { $('#cOut').textContent = `Fit failed: ${err.message}`; }
}

function showZLP() {
  const r = zlpRes, out = $('#cOut');
  out.innerHTML = `
    <div class="cres"><canvas id="cZ" class="wide"></canvas></div>
    <table class="data">
      <tr><td>Zero-loss FWHM</td><td><b>${r.fwhm.toFixed(3)} eV</b> (channel ${r.channel.toFixed(3)} eV${r.fwhm < 4 * r.channel ? ': undersampled, use finer dispersion' : ''})</td></tr>
      <tr><td>Gun energy spread ΔE</td><td>${r.dE.toFixed(3)} eV (after removing ${SPECTROMETER} eV spectrometer broadening)</td></tr>
    </table>
    <div class="crow"><button class="btn primary" id="cApply">Apply to the twin</button><span class="muted">Updates the profile's energy spread, and with it the focal spread and information limit.</span></div>`;
  const q = fitCanvas($('#cZ'));
  const pts = Array.from(spec.E, (e, i) => [e, spec.I[i]]);
  plot(q, [{ pts, color: '#e9edf2' }], `zero-loss peak · FWHM ${r.fwhm.toFixed(3)} eV`, [r.lo, r.hi]);
  $('#cApply').addEventListener('click', () => {
    ctx.onApply({ type: 'zlp', fwhm: r.fwhm, dE: r.dE, source: spec.source ?? spec.name });
    $('#cApply').textContent = 'Applied ✓'; $('#cApply').disabled = true;
  });
}

// ---------------------------------------------------------------- small canvas helpers
function fitCanvas(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
  return { ctx: cv.getContext('2d'), W: cv.width, H: cv.height, dpr };
}
function label(q, t, x, y) {
  q.ctx.font = `${10 * q.dpr}px "IBM Plex Mono", monospace`; q.ctx.fillStyle = '#e9edf2'; q.ctx.fillText(t, x * q.dpr, y * q.dpr);
}
function plot(q, series, title, marks) {
  const { ctx: c, W, H, dpr } = q, pad = 18 * dpr;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of series) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const X = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad), Yp = (y) => H - pad - ((y - y0) / (y1 - y0 || 1)) * (H - 2.2 * pad);
  c.fillStyle = '#06080b'; c.fillRect(0, 0, W, H);
  if (marks) { c.fillStyle = 'rgba(255,180,94,0.18)'; c.fillRect(X(marks[0]), pad, X(marks[1]) - X(marks[0]), H - 2 * pad); }
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
