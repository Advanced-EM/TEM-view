// Copyright © 2026 by Northwestern University. All Rights Reserved.
// Connections (temview-connect/1): the microscope talks to other software and to real instruments through small
// local services (tools/connect: `temview-connect serve --adapter …`). A connector describes itself (simulator or
// instrument, the modes it can do, the controls it reads and writes with its limits). Simulators run the current
// acquisition; instruments are driven: they receive settings (refused outside their limits), report their actual
// state, acquire, and stop on request. Driving needs the pairing token printed in the connector's terminal, and
// Stop (blank the beam, abort) always works.
import { CONNECT } from './config.js';
import { abtemRequest, abtemUnsupported, unzip } from './abtem.js';
import { readNpy } from './npy.js';
import { paint, range, LUT } from './render2d.js';

export const CONNECT_FORMAT = 'temview-connect/1';
const MODE_NAMES = { tem: 'TEM', stem: 'STEM', '4d': '4D-STEM', diff: 'SAED', cbed: 'CBED', eds: 'EDS', eels: 'EELS' };

// the exhibit's state in protocol units
export function toConnect(S) {
  return {
    mode: S.mode, ht_kV: S.kV, beam_blanked: !!S.paused, defocus_nm: S.df, fov_nm: S.fov,
    stage_x_nm: S.cx / 10, stage_y_nm: S.cy / 10, tilt_alpha_deg: S.tiltX, tilt_beta_deg: S.tiltY,
    convergence_mrad: S.mode === '4d' ? S.alpha4d : S.alpha, camera_length_mm: S.camL, objective_aperture: S.objAp,
    holder_temperature_K: S.tempSet, detector_inner_mrad: S.detIn, detector_outer_mrad: S.detOut,
  };
}

// the settings worth sending to an instrument: those it can write, that differ, and that are within its limits
export function plan(desc, inst, exh) {
  const send = {}, skip = [];
  for (const [k, c] of Object.entries(desc.controls)) {
    if (!c.writable || exh[k] === undefined) continue;
    const v = exh[k], cur = inst[k];
    if (c.kind === 'number' ? Math.abs(v - cur) < 1e-6 : v === cur) continue;
    if (c.kind === 'choice' && c.choices && !c.choices.includes(String(v))) { skip.push([k, `${v} is not available (${c.choices.join(', ')})`]); continue; }
    if (c.kind === 'number' && ((c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max))) { skip.push([k, `${v} is outside ${c.min}…${c.max} ${c.unit}`]); continue; }
    if (c.kind === 'number' && c.max_step !== undefined && cur !== undefined && Math.abs(v - cur) > c.max_step) { skip.push([k, `a ${fmt(Math.abs(v - cur))} ${c.unit} jump; the instrument allows ${c.max_step} ${c.unit} per step`]); continue; }
    send[k] = c.kind === 'choice' ? String(v) : v;
  }
  return { send, skip };
}

// ------------------------------------------------------------------ the dialog (browser only)
let ctx = null, found = [], follow = null;
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(2)) + '' : String(v));
const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } } };
const extra = () => { try { return JSON.parse(localStorage.getItem('connectUrls') || '[]'); } catch { return []; } };

async function call(url, path, body) {
  const r = await fetch(url + path, body === undefined ? { signal: AbortSignal.timeout(4000) } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function discover() {
  const urls = [...new Set([...CONNECT.urls, ...extra()])];
  const res = await Promise.all(urls.map(async (url) => { try { const d = await call(url, '/describe'); return d.format === CONNECT_FORMAT ? { url, d } : null; } catch { return null; } }));
  return res.filter(Boolean);
}

export function openConnect(c) {
  ctx = c;
  const m = $('#connect');
  m.hidden = false;
  if (!m.dataset.wired) {
    m.dataset.wired = 1;
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) m.hidden = true; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.hidden = true; });
  }
  render();
}

async function render() {
  const body = $('#connect .cnBody');
  body.innerHTML = `<h2>Connections</h2>
    <p>Other software and real instruments join the microscope through small local services (<code>temview-connect serve</code>).
    <b>Simulators</b> run what you are looking at; <b>instruments</b> are driven: they take these settings within their own limits, report what they actually did, and acquire.</p>
    <p class="cnStatus muted">Looking for connectors on this computer…</p><div class="cnList"></div>
    <details class="cnAdd"><summary>Add an address</summary><div class="crow"><input id="cnUrl" placeholder="http://127.0.0.1:8799"><button class="btn" id="cnAddBtn">Add</button></div></details>`;
  $('#cnAddBtn').onclick = () => { const u = $('#cnUrl').value.trim().replace(/\/$/, ''); if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(u)) { localStorage.setItem('connectUrls', JSON.stringify([...new Set([...extra(), u])])); render(); } else $('#cnUrl').value = 'only this computer (127.0.0.1 or localhost)'; };
  found = await discover();
  $('#connect .cnStatus').textContent = found.length ? `${found.length} connector${found.length > 1 ? 's' : ''} found.` : 'None found. Start one with: temview-connect serve --adapter mock (a test instrument) or --adapter abtem, then reopen this window.';
  $('#connect .cnList').innerHTML = found.map((f, i) => card(f, i)).join('');
  found.forEach((f, i) => wire(f, $(`#cn${i}`)));
}

function card({ url, d }, i) {
  const inst = d.kind === 'instrument', mode = ctx.S.mode, ok = d.modes.includes(mode);
  const links = Object.entries(d.links || {}).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k)}</a>`).join(' · ');
  return `<section class="cnCard ${inst ? 'inst' : 'simu'}" id="cn${i}">
    <header><b>${esc(d.name)}</b> <span class="muted">${inst ? 'instrument' : 'simulator'}${d.version ? ` · ${esc(d.version)}` : ''} · ${esc(url)}</span>
    ${inst ? '<button class="btn cnStop" title="Blank the beam and abort: always allowed">■ Stop</button>' : ''}</header>
    <p class="muted">Modes: ${d.modes.map((m) => MODE_NAMES[m] ?? m).join(', ')}${links ? ` · ${links}` : ''}</p>
    ${inst ? `<div class="crow"><label>Pairing token <input class="cnTok" size="10" value="${esc(store.get('tok:' + url) ?? '')}" placeholder="from its terminal"></label>
      <button class="btn cnRead">Read instrument</button><button class="btn cnSend">Send settings…</button>
      <label class="cnFollow"><input type="checkbox"> Follow the exhibit</label></div>
      <div class="crow"><button class="btn cnAcq" ${ok ? '' : 'disabled'}>Acquire (${MODE_NAMES[mode] ?? mode})</button><label>Exposure <input class="cnExp" size="4" value="1"> s</label></div>`
    : `<div class="crow"><button class="btn cnRun" ${ok ? '' : 'disabled'}>Run this ${MODE_NAMES[mode] ?? mode} acquisition</button>${ok ? '' : `<span class="muted">not available in ${MODE_NAMES[mode] ?? mode}</span>`}</div>`}
    <div class="cnOut"></div></section>`;
}

function wire(f, el) {
  const { url, d } = f, out = el.querySelector('.cnOut'), say = (h) => (out.innerHTML = h);
  const tok = () => { const t = el.querySelector('.cnTok')?.value.trim() ?? ''; store.set('tok:' + url, t); return t; };
  const fail = (e) => say(`<p class="warn">${esc(e.message || e)}</p>`);
  el.querySelector('.cnStop')?.addEventListener('click', async () => { stopFollow(); try { await call(url, '/stop', {}); say('<p class="warn">Stopped: beam blanked, running jobs aborted.</p>'); } catch (e) { fail(e); } });
  el.querySelector('.cnRead')?.addEventListener('click', async () => {
    try { const { state } = await call(url, '/state'); say(table(d, state, toConnect(ctx.S))); } catch (e) { fail(e); }
  });
  el.querySelector('.cnSend')?.addEventListener('click', async () => {
    try {
      const { state } = await call(url, '/state'), p = plan(d, state, toConnect(ctx.S));
      if (!Object.keys(p.send).length) return say(`<p>Nothing to send: the instrument already matches.${skipped(p)}</p>`);
      say(`<p>Will set:</p><ul>${Object.entries(p.send).map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(fmt(state[k]))} → ${esc(fmt(v))} ${esc(d.controls[k].unit)}</li>`).join('')}</ul>${skipped(p)}
        <div class="crow"><button class="btn cnGo">Send to the instrument</button><button class="btn cnNo">Cancel</button></div>`);
      out.querySelector('.cnNo').onclick = () => say('');
      out.querySelector('.cnGo').onclick = async () => { try { const r = await call(url, '/state', { token: tok(), set: p.send }); say(`<p class="ok">Sent.</p>${table(d, r.state, toConnect(ctx.S))}`); } catch (e) { fail(e); } };
    } catch (e) { fail(e); }
  });
  el.querySelector('.cnFollow input')?.addEventListener('change', (e) => {
    if (!e.target.checked) return stopFollow();
    stopFollow();
    follow = { url, el, box: e.target, last: '', busy: false };
    say('<p class="muted">Following: each change you make here is sent to the instrument (within its limits). Uncheck or press Stop to end.</p>');
    follow.timer = setInterval(async () => {
      if (!follow || follow.busy) return;
      const exh = JSON.stringify(toConnect(ctx.S));
      if (exh === follow.last) return;
      follow.busy = true;
      try {
        const { state } = await call(url, '/state'), p = plan(d, state, JSON.parse(exh));
        if (p.skip.length) { stopFollow(); return say(`<p class="warn">Stopped following: ${esc(p.skip.map(([k, w]) => `${k}: ${w}`).join('; '))}.</p>`); }
        if (Object.keys(p.send).length) await call(url, '/state', { token: tok(), set: p.send });
        follow.last = exh;
      } catch (err) { stopFollow(); fail(err); } finally { if (follow) follow.busy = false; }
    }, 400);
  });
  el.querySelector('.cnAcq')?.addEventListener('click', () => job(f, out, { kind: 'acquire', mode: ctx.S.mode, exposure_s: +el.querySelector('.cnExp').value || 1, token: tok() }));
  el.querySelector('.cnRun')?.addEventListener('click', () => {
    const S = ctx.S, j = { kind: 'simulate', mode: S.mode, state: toConnect(S), specimen: S.spec };
    if (d.name === 'abTEM') { const why = abtemUnsupported(S); if (why) return fail(why); j.request = abtemRequest(S, ctx.sim, {}); }
    job(f, out, j);
  });
}

function stopFollow() {
  if (!follow) return;
  clearInterval(follow.timer);
  if (follow.box) follow.box.checked = false;
  follow = null;
}

const skipped = (p) => (p.skip.length ? `<p class="warn">Not sent: ${esc(p.skip.map(([k, w]) => `${k} (${w})`).join('; '))}.</p>` : '');

function table(d, inst, exh) {
  const rows = Object.entries(d.controls).map(([k, c]) => {
    const a = inst[k], b = exh[k], diff = b !== undefined && a !== undefined && (c.kind === 'number' ? Math.abs(a - b) > 1e-6 : String(a) !== String(b));
    return `<tr class="${diff ? 'diff' : ''}"><td>${esc(k)}</td><td>${esc(fmt(a))}</td><td>${b === undefined ? '' : esc(fmt(b))}</td><td>${esc(c.unit)}</td><td>${c.writable ? '' : 'read-only'}</td></tr>`;
  }).join('');
  return `<table class="cnTable"><tr><th>control</th><th>instrument</th><th>exhibit</th><th></th><th></th></tr>${rows}</table>`;
}

async function job({ url, d }, out, j) {
  out.innerHTML = '<p class="muted">Submitting…</p>';
  try {
    const { id } = await call(url, '/jobs', { format: CONNECT_FORMAT, ...j });
    for (;;) {
      await new Promise((r) => setTimeout(r, 400));
      const s = await call(url, `/jobs/${id}`);
      if (s.status === 'error') throw new Error(s.error);
      out.innerHTML = `<p class="muted">${esc(s.status)}: ${esc(s.progress ?? '')}</p>`;
      if (s.status === 'done') {
        const buf = await call(url, `/jobs/${id}/result`), files = unzip(buf);
        const key = ['image', 'pattern', 'virtual_image'].find((k) => files[`${k}.npy`]) ?? Object.keys(files).find((k) => k.endsWith('.npy'))?.slice(0, -4);
        const a = readNpy(files[`${key}.npy`]), [h, w] = a.shape.slice(-2);
        out.innerHTML = `<figure class="cnFig"><canvas width="${w}" height="${h}"></canvas><figcaption>${esc(d.name)} · ${esc(key)} ${w} × ${h} · ${s.seconds ?? '?'} s</figcaption></figure>
          <div class="crow"><button class="btn cnNpz">Download (.npz)</button></div>`;
        const v = key === 'pattern' ? a.data.map((x) => Math.log1p(x * 1e4)) : a.data, [lo, hi] = range(v, 0.005, 0.995);
        paint(out.querySelector('canvas').getContext('2d'), v, w, h, [0, 0, w, h], { lo, hi, lut: LUT.gray });
        out.querySelector('.cnNpz').onclick = () => ctx.download(new Blob([buf], { type: 'application/octet-stream' }), `${d.name.replace(/\W+/g, '-').toLowerCase()}-${j.mode}.npz`);
        return;
      }
    }
  } catch (e) { out.innerHTML = `<p class="warn">${esc(e.message || e)}</p>`; }
}
