// Copyright © 2026 by Northwestern University. All Rights Reserved.
// Bridge to abTEM (Madsen & Susi, doi:10.12688/openreseurope.13015.2): send the microscope's current state to
// a reference multislice simulation and get the result back in TEM-view's own data format.
//
// abtemRequest() turns the state into a "temview-abtem/1" request: plain JSON in abTEM's conventions (polar
// aberration coefficients in Å and radians, focal spread as a 1/e width, detector angles in mrad), with a
// recipe that rebuilds the specimen in 3D (tools/abtem-bridge/temview_abtem/structures.py). The request runs
// on the visitor's own computer through the local bridge (`temview-abtem serve`, http://127.0.0.1:8797), or is
// downloaded and run elsewhere (`temview-abtem run request.json`), e.g. on a GPU machine.
import * as P from './physics.js';
import { AP_MRAD } from './sim.js';
import { readNpy } from './npy.js';
import { paint, range, LUT } from './render2d.js';
import { ABTEM } from './config.js';

export const ABTEM_FORMAT = 'temview-abtem/1';
export const ABTEM_MODES = { tem: 'TEM image', stem: 'STEM (annular detector)', '4d': '4D-STEM datacube', diff: 'selected-area diffraction', cbed: 'CBED pattern' };
export const ABTEM_SPECS = ['au', 'si', 'sto', 'gr'];
const DEG = Math.PI / 180;

// why this state cannot be sent, or null
export function abtemUnsupported(S) {
  if (S.mis) return 'Not during a training task: the result would reveal the hidden misalignment.';
  if (!ABTEM_MODES[S.mode]) return `abTEM runs ${Object.values(ABTEM_MODES).join(', ')}. Switch to one of those modes.`;
  if (!ABTEM_SPECS.includes(S.spec)) return 'The bridge rebuilds gold on carbon, Si/SiO₂, the SrTiO₃ boundary and graphene in 3D. The MOF and the proteins need structure files and are not supported yet.';
  return null;
}

// the request: everything abTEM needs, in its conventions
export function abtemRequest(S, sim, { preset = 'quick', algorithm = 'multislice', seed = 0 } = {}) {
  const why = abtemUnsupported(S);
  if (why) throw new Error(why);
  const sp = sim.spec, ab = sim.abA(), m = S.mode, probe = !['tem', 'diff'].includes(m);
  const optics = {
    // TEM-view's defocus enters χ exactly as abTEM's C10 (negative = underfocus); B2 is C21/3 (Krivanek)
    C10: sim.dfA(), C30: sim.CsA(),
    C12: ab.A1, phi12: ab.A1a * DEG, C21: 3 * ab.B2, phi21: ab.B2a * DEG, C23: ab.A2, phi23: ab.A2a * DEG, C34: ab.A3, phi34: ab.A3a * DEG,
    focal_spread_A: Math.SQRT2 * sim.focalSpread(), // TEM-view: standard deviation; abTEM: 1/e width
  };
  if (m === 'tem') {
    optics.angular_spread_mrad = S.profile.convTEM;
    const ap = AP_MRAD[S.objAp];
    if (Number.isFinite(ap) && S.objAp !== 'df') optics.objective_aperture_mrad = ap;
  }
  if (probe) optics.semiangle_mrad = sim.alpha() * 1000;
  const fovA = m === 'diff' ? S.sa * 10 : m === 'cbed' ? 30 : sim.fovA();
  const recipe = {};
  if (S.spec === 'au') recipe.particles = sp.parts.map((p) => ({ x: p.x, y: p.y, r: p.r, rot: p.rot }));
  if (S.spec === 'si') {
    const ys = []; for (let y = -300; y <= 300; y += 0.5) ys.push(y);
    Object.assign(recipe, { boundary_y_A: ys, boundary_x_A: ys.map((y) => +sp.bnd(y).toFixed(3)), origin_A: [0.3, 0.2] });
  }
  if (S.spec === 'sto') recipe.half_angle_rad = sp.grainRot[0];
  if (S.spec === 'gr') {
    // graphene: TEM-view's own atom list (vacancies, the hole, the Si dopant and the twisted second layer)
    const A = sp.atoms, half = fovA / 2 + 12, atoms = [];
    for (let i = 0; i < A.count; i++) {
      if (Math.abs(A.x[i] - S.cx) > half || Math.abs(A.y[i] - S.cy) > half) continue;
      atoms.push([+A.x[i].toFixed(3), +A.y[i].toFixed(3), A.g[i] * 3.35, P.EL[A.e[i]].Z]);
    }
    recipe.atoms = atoms;
  }
  const detector = {};
  if (m === 'stem') Object.assign(detector, { inner_mrad: S.detIn, outer_mrad: S.detOut });
  if (m === '4d') detector.max_angle_mrad = Math.max(2.5 * S.alpha4d, 40);
  if (m === 'diff') detector.max_angle_mrad = 60;
  if (m === 'cbed') Object.assign(detector, { max_angle_mrad: Math.max(3 * (S.cbedKind === 'cbed' ? S.alphaCB : S.alphaLA), 30), position_A: [S.cx, S.cy] });
  return {
    format: ABTEM_FORMAT,
    created: new Date().toISOString(),
    source: { app: 'TEM-view', module: import.meta.url.split('/').pop() },
    mode: m,
    preset,
    run: { algorithm: probe && m !== 'cbed' ? algorithm : 'multislice', seed },
    beam: { energy_eV: S.kV * 1e3 },
    optics,
    specimen: {
      id: S.spec, name: sp.name, zone: sp.zone ?? null,
      thickness_A: S.spec === 'gr' ? 3.35 : S.thick * 10,
      fov_A: +fovA.toFixed(3), center_A: [S.cx, S.cy],
      // small specimen tilts become beam tilts (mrad)
      tilt_mrad: [S.tiltX * DEG * 1000, S.tiltY * DEG * 1000],
      temperature_K: +sim.temp().toFixed(1), u2_ratio: sim.thermal().u2r,
      recipe,
    },
    detector,
  };
}

// ------------------------------------------------------------------ the dialog (browser only)
let ctx = null, job = null;
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

async function findBridge() {
  for (const url of ABTEM.urls) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return { url, ...(await r.json()) };
    } catch { /* not running */ }
  }
  return null;
}

export function openAbTEM(c) {
  ctx = c;
  const m = $('#abtem');
  m.hidden = false;
  if (!m.dataset.wired) {
    m.dataset.wired = 1;
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) m.hidden = true; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.hidden = true; });
  }
  render();
}

async function render() {
  const { S } = ctx, body = $('#abtem .abBody'), why = abtemUnsupported(S);
  body.innerHTML = `
    <h2>Simulate with <em>abTEM</em></h2>
    <p>Send the microscope's current state to <b>abTEM</b>, an open-source multislice code by Jacob Madsen and Toma Susi, and get back the
    same acquisition computed with a full dynamical 3D simulation (frozen phonons at the specimen's temperature). The result comes back as a
    TEM-view .npz, so it opens in every tool that reads TEM-view data.</p>
    ${why ? `<p class="warn">${esc(why)}</p>` : `
    <div class="abRow"><span>Mode</span><b>${ABTEM_MODES[S.mode]}</b><span>Specimen</span><b>${esc(ctx.sim.spec.name)}</b></div>
    <div class="abPreset">${['quick', 'standard', 'full'].map((p) => `<button data-p="${p}" class="${p === (S._abPreset ?? 'quick') ? 'on' : ''}">${p}</button>`).join('')}</div>
    <p class="muted abHint">quick: 2 phonon configurations and a 32 × 32 scan, minutes on a laptop; standard: 8 and 64 × 64; full: 16 and Nyquist sampling (use a GPU).</p>
    ${['stem', '4d'].includes(S.mode) ? '<label class="abAlg"><input type="checkbox" id="abPrism"> PRISM (much faster for scans; interpolation 2)</label>' : ''}
    <div class="crow"><button class="btn" id="abRun" disabled>Run on this computer</button><button class="btn" id="abSave">Download request (.json)</button></div>
    <p class="abStatus muted">Looking for the bridge on this computer…</p>
    <div class="abResult"></div>`}
    <p class="muted abCite">abTEM: J. Madsen and T. Susi, Open Research Europe 1, 24 (2021). The bridge runs abTEM as a separate program on your computer.</p>`;
  if (why) return;
  body.querySelectorAll('.abPreset button').forEach((b) => (b.onclick = () => { S._abPreset = b.dataset.p; render(); }));
  const req = () => abtemRequest(S, ctx.sim, { preset: S._abPreset ?? 'quick', algorithm: $('#abPrism')?.checked ? 'prism' : 'multislice' });
  $('#abSave').onclick = () => ctx.download(new Blob([JSON.stringify(req(), null, 1)], { type: 'application/json' }), `temview-abtem-${S.mode}-${S.spec}.json`);
  const br = await findBridge();
  const st = $('#abtem .abStatus');
  if (!st) return;
  if (!br) {
    st.innerHTML = 'No bridge found. To run abTEM on this computer: <code>pip install temview-abtem</code>, then <code>temview-abtem serve</code>, and reopen this window. Or download the request and run <code>temview-abtem run request.json</code> anywhere (a GPU machine, a cluster).';
    return;
  }
  st.textContent = `Bridge ready: abTEM ${br.abtem} at ${br.url}${br.queued ? ` (${br.queued} queued)` : ''}.`;
  const run = $('#abRun');
  run.disabled = false;
  run.onclick = () => submit(br.url, req());
}

async function submit(url, request) {
  const st = $('#abtem .abStatus'), run = $('#abRun');
  run.disabled = true;
  // the TEM-view result for comparison: the data now on the detector (not the canvas, which is cropped to its frame)
  const mn = ctx.sim.main;
  const before = mn ? { arr: Float32Array.from(mn.arr), w: mn.w, h: mn.h } : null;
  try {
    const r = await fetch(`${url}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    job = j.id;
    const t0 = performance.now();
    for (;;) {
      await new Promise((s) => setTimeout(s, 1000));
      if (job !== j.id) return; // a newer run replaced this one
      const s = await (await fetch(`${url}/jobs/${j.id}`)).json();
      if (st) st.textContent = `${s.status}: ${s.progress ?? ''} · ${Math.round((performance.now() - t0) / 1000)} s`;
      if (s.status === 'error') throw new Error(s.error);
      if (s.status === 'done') break;
    }
    const buf = await (await fetch(`${url}/jobs/${j.id}/result`)).arrayBuffer();
    show(buf, before, request);
  } catch (e) {
    if (st) st.innerHTML = `<span class="warn">${esc(e.message)}</span>`;
  } finally {
    if (run) run.disabled = false;
  }
}

// stored-entry zip (the bridge writes uncompressed .npz)
function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), out = {};
  let p = 0;
  while (p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true), size = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(u8.slice(p + 30, p + 30 + nlen)), start = p + 30 + nlen + xlen;
    if (method !== 0) throw new Error('compressed .npz entries are not supported');
    out[name] = buf.slice(start, start + size);
    p = start + size;
  }
  return out;
}

function show(buf, before, request) {
  const files = unzip(buf), meta = JSON.parse(new TextDecoder().decode(files['metadata.json']));
  const key = ['image', 'pattern', 'virtual_image'].find((k) => files[`${k}.npy`]);
  const a = readNpy(files[`${key}.npy`]), [h, w] = a.shape.slice(-2);
  const res = $('#abtem .abResult');
  res.innerHTML = `<div class="abPair"><figure>${before ? `<canvas class="tv" width="${before.w}" height="${before.h}"></canvas>` : '<div class="tv"></div>'}<figcaption>TEM-view (live)</figcaption></figure>
    <figure><canvas width="${w}" height="${h}"></canvas><figcaption>abTEM ${esc(meta.abtem.version)} · ${meta.abtem.frozen_phonons} phonon configs · ${meta.abtem.seconds} s</figcaption></figure></div>
    <div class="crow"><button class="btn" id="abNpz">Download result (.npz)</button></div>`;
  const log = key === 'pattern', scale = (d) => (log ? d.map((x) => Math.log1p(x * 1e4)) : d);
  const draw = (cv, data, cw, ch) => { const v = scale(data), [lo, hi] = range(v, 0.005, 0.995); paint(cv.getContext('2d'), v, cw, ch, [0, 0, cw, ch], { lo, hi, lut: LUT.gray }); };
  draw(res.querySelector('canvas:not(.tv)'), a.data, w, h);
  if (before) draw(res.querySelector('canvas.tv'), before.arr, before.w, before.h);
  $('#abNpz').onclick = () => ctx.download(new Blob([buf], { type: 'application/octet-stream' }), `abtem-${request.mode}-${request.specimen.id}.npz`);
  const st = $('#abtem .abStatus');
  if (st) st.textContent = `Done: ${meta.abtem.atoms.toLocaleString()} atoms, sampling ${meta.abtem.sampling_A.toFixed(3)} Å, ${meta.abtem.algorithm}.`;
}
