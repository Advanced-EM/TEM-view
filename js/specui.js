// The specimen section: a card per specimen (with a small rendered picture), the 3D structure viewer, a
// details strip (formula, size, thickness along the beam, t/λ, footprint), and the preview workflow for
// uploaded XYZ / CIF files: check, orient, tile, crop and export before anything is loaded into the column.
import * as P from './physics.js';
import { SpecViewer } from './specview.js';
import * as ST from './structure.js';
import { footprintFor, fmtBytes } from './footprint.js';
import { family } from './registry.js';

export const SPEC_CARDS = [
  { id: 'au', name: 'Gold on carbon', tag: 'particles on a-C' },
  { id: 'si', name: 'Si / SiO₂', tag: 'crystal + oxide' },
  { id: 'sto', name: 'SrTiO₃ boundary', tag: 'Σ5 bicrystal' },
  { id: 'gr', name: 'Graphene', tag: '2D crystal' },
  { id: 'mof', name: 'UiO-66 (MOF)', tag: 'porous crystal', sensitive: true },
  { id: 'bio', name: 'Proteins in ice', tag: 'continuum · cryo', sensitive: true },
  { id: 'lib', name: 'NP megalibrary', tag: '10⁶ alloy particles' },
  { id: 'hesi', name: 'He bubbles in Si', tag: 'crystal + voids' },
  { id: 'cspb', name: 'CsPbBr₃ nanocubes', tag: 'nanocrystals', sensitive: true },
  { id: 'mapb', name: 'MAPbBr₃ nanocubes', tag: 'hybrid nanocrystals', sensitive: true },
];
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };

export function createSpecimenUI(api) {
  // api: { S, sim, setSpec(id), setMode(m), explain(html, title), isLor() }
  const { S } = api;
  const viewer = new SpecViewer();
  const thumbs = new Map();
  let gridEl = null, cardEl = null, infoEl = null, prev = null, detOn = false, lastKey = '';
  const opts = { bonds: store('sv-bonds') === '1', overlays: store('sv-ov') !== '0', sync: store('sv-sync') !== '0' };
  viewer.setOptions(opts);

  // ---------------------------------------------------------------- the specimen cards
  function grid(el) {
    gridEl = el;
    el.className = 'ctl specgrid';
    el.innerHTML = SPEC_CARDS.map((c) => `<button class="scard" data-id="${c.id}" aria-label="${esc(c.name)}"><span class="sthumb" data-id="${c.id}">${fallbackThumb(c.id)}</span><b>${esc(c.name)}</b><small>${esc(c.tag)}${c.sensitive ? ' · <i>beam-sensitive</i>' : ''}</small></button>`).join('')
      + `<button class="scard upload" data-id="__upload" aria-label="Load a structure file"><span class="sthumb"><svg viewBox="0 0 48 34" aria-hidden="true"><path d="M24 25V9m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 26h28" stroke="currentColor" stroke-width="2"/></svg></span><b>Your structure</b><small>.xyz or .cif · drop here</small></button>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.scard');
      if (!b) return;
      if (b.dataset.id === '__upload') return pickFile();
      api.setSpec(b.dataset.id);
    });
    dropTarget(el);
    refreshGrid();
  }
  function refreshGrid() {
    if (!gridEl) return;
    for (const b of gridEl.querySelectorAll('.scard')) b.classList.toggle('on', b.dataset.id === S.spec || (b.dataset.id === '__upload' && S.spec === 'xyz'));
    for (const t of gridEl.querySelectorAll('.sthumb[data-id]')) if (thumbs.has(t.dataset.id) && !t.dataset.done) { t.innerHTML = `<img alt="" src="${thumbs.get(t.dataset.id)}">`; t.dataset.done = 1; }
  }
  // until a rendered picture exists: the specimen's elements as coloured dots
  function fallbackThumb(id) {
    const sp = P.SPECIMENS[id], els = [...new Set((sp?.elements ?? []).map((e) => P.EL[e]?.sym))].filter(Boolean);
    const dots = [];
    for (let i = 0; i < 18; i++) { const s = els[i % Math.max(1, els.length)] ?? 'C'; dots.push(`<circle cx="${6 + (i % 6) * 7.2 + ((i / 6) | 0) % 2 * 3.6}" cy="${7 + ((i / 6) | 0) * 9}" r="2.8" fill="${ST.elementColor(s)}"/>`); }
    return `<svg viewBox="0 0 48 34" aria-hidden="true">${dots.join('')}</svg>`;
  }
  // rendered pictures, one per idle moment, only while the viewer has its renderer
  function makeThumbs() {
    if (!viewer.R) return;
    const todo = SPEC_CARDS.find((c) => !thumbs.has(c.id) && c.id !== 'lib');
    if (!todo) return;
    const idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 120));
    idle(() => {
      if (!viewer.R) return;
      try {
        const sp = P.SPECIMENS[todo.id], s = { ...S, spec: todo.id, mode: 'tem', cx: sp.center[0], cy: sp.center[1], fov: Math.min(sp.fov, 8), thick: 8, tiltX: 0, tiltY: 0 };
        const stand = { spec: sp, fovA: () => s.fov * 10, thermal: () => ({ T: 293 }), ice: () => ({ t: 80, cryst: false }), temp: () => 293 };
        const st = ST.buildStructure(s, stand, { half: Math.min(45, s.fov * 6), cap: 12000 });
        thumbs.set(todo.id, viewer.thumbnail(st) ?? '');
      } catch { thumbs.set(todo.id, ''); }
      refreshGrid();
      makeThumbs();
    });
  }

  // ---------------------------------------------------------------- the viewer card
  function card(el) {
    cardEl = el;
    el.className = 'ctl svcard';
    const open = store('sv-open') !== '0';
    el.innerHTML = `<div class="svhead"><button class="svfold" aria-expanded="${open}" title="Show or hide the 3D structure">${open ? '▾' : '▸'} Specimen structure</button><span class="sp"></span>
      <span class="svbtns"><button data-v="beam" title="Look down the beam (−z)">Beam</button><button data-v="side" title="Side view: the thickness">Side</button><button data-v="iso" title="Isometric">Iso</button><button data-x="big" title="Show it in the results panel">⤢</button></span></div>
      <div class="svhost" ${open ? '' : 'hidden'}></div>
      <div class="svtools" ${open ? '' : 'hidden'}><label><input type="checkbox" data-o="overlays" ${opts.overlays ? 'checked' : ''}> Beam &amp; field</label><label><input type="checkbox" data-o="sync" ${opts.sync ? 'checked' : ''}> Sync tilt</label><label><input type="checkbox" data-o="bonds" ${opts.bonds ? 'checked' : ''}> Bonds</label></div>
      <div class="svprev" hidden></div>`;
    el.querySelector('.svfold').addEventListener('click', () => { const o = el.querySelector('.svhost').hidden; setOpen(o); });
    el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.v)));
    el.querySelector('[data-x="big"]').addEventListener('click', () => api.showInResults?.(true));
    el.querySelectorAll('[data-o]').forEach((c) => c.addEventListener('change', () => { opts[c.dataset.o] = c.checked; store(`sv-${{ overlays: 'ov', sync: 'sync', bonds: 'bonds' }[c.dataset.o]}`, c.checked ? '1' : '0'); viewer.setOptions(opts); update(true); }));
    dropTarget(el);
    placeViewer();
  }
  function setOpen(o) {
    store('sv-open', o ? '1' : '0');
    cardEl.querySelector('.svhost').hidden = !o; cardEl.querySelector('.svtools').hidden = !o;
    const f = cardEl.querySelector('.svfold'); f.textContent = `${o ? '▾' : '▸'} Specimen structure`; f.setAttribute('aria-expanded', o);
    placeViewer();
  }
  // the canvas lives in the results panel when that view is on, else in the card if it is open
  function placeViewer() {
    const det = document.querySelector('#detStruct'), host = cardEl?.querySelector('.svhost');
    if (detOn && det) viewer.attach(det);
    else if (host && !host.hidden) viewer.attach(host);
    else viewer.attach(null);
    if (viewer.R) { update(true); makeThumbs(); }
  }
  function showInResults(on) { detOn = on; placeViewer(); }

  // ---------------------------------------------------------------- what the viewer shows
  function structureKey() {
    const sp = api.sim.spec, ice = api.sim.ice?.() ?? { t: 0 };
    return [api.isLor() ? `lor:${S.magSpec}:${S.lorChir}:${S.lorPol}:${Math.round(S.lorField)}:${S.lorThick}:${S.lorFov}` : S.spec, sp.ver ?? 0, sp.damageVer ?? 0, Math.round(S.cx / 2), Math.round(S.cy / 2), S.fov.toFixed(2), S.thick, Math.round(ice.t), Math.round((api.sim.temp?.() ?? 293) / 25)].join('|');
  }
  function overlay() {
    const m = S.mode, fam = family(m), fovA = api.isLor() ? S.lorFov * 1e4 : api.sim.fovA();
    const ov = { mode: m, family: fam, tiltX: S.tiltX, tiltY: S.tiltY, zone: api.sim.spec?.zone ?? '' };
    if (m === '4d' && api.sim.fd) { const sl = api.sim.fd.slices; ov.scan_A = api.sim.fd.scan; ov.slices = Array.isArray(sl) || ArrayBuffer.isView(sl) ? sl.length : +sl || 0; } // a count: fd.slices holds the slice arrays
    else if (m === 'cbed' || m === 'ronch') ov.probe = [0, 0];
    else if (m === 'diff') ov.fov_A = Math.min(fovA, S.sa * 10);
    else ov.fov_A = fovA;
    if (m === 'eels' || m === 'eds') ov.probe = [0, 0];
    return ov;
  }
  let structure = null;
  function update(force = false) {
    refreshGrid();
    if (prev) { renderInfo(); return; } // an uploaded structure is being previewed
    const key = structureKey();
    if (force || key !== lastKey || !structure) {
      lastKey = key;
      try { structure = ST.buildStructure(S, api.sim); } catch (e) { console.warn('structure:', e); structure = null; }
      if (structure) viewer.setStructure(structure, key + (force ? `|${Date.now()}` : ''));
    }
    viewer.setOverlay(overlay());
    viewer.wake();
    renderInfo();
  }
  function info(el) { infoEl = el; el.className = 'ctl specinfo'; renderInfo(); }
  function renderInfo() {
    if (!infoEl) return;
    const st = prev ? prev.view : structure;
    if (!st) { infoEl.innerHTML = ''; return; }
    const nm = (a) => (a / 10 >= 100 ? (a / 1e4).toFixed(2) + ' µm' : (a / 10).toFixed(1) + ' nm');
    const legend = st.species.filter((s) => s.count).map((s) => `<span class="sp-el"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');
    const mats = [...st.voxels.map((v) => v.name), ...new Set(st.shells.map((s) => s.label))].filter(Boolean);
    let rows;
    if (prev) {
      const c = prev.check;
      rows = [
        ['Preview', `${esc(prev.st.name)} · <b class="warn">not loaded yet</b>`],
        ['Formula', `${esc(st.formula) || '—'} · ${c.atoms.toLocaleString('en')} atoms`],
        ['Size', `${c.size_A.map(nm).join(' × ')} (x × y × z)`],
        ['Along the beam', `${nm(c.thickness_A)}${c.min_distance_A ? ` · nearest neighbours ${c.min_distance_A.toFixed(2)} Å` : ''}`],
        ...c.issues.map((i) => [i.level === 'warn' ? 'Check' : 'Note', `${i.level === 'warn' ? '<b class="warn">' : ''}${esc(i.text)}${i.level === 'warn' ? '</b>' : ''}`]),
      ];
    } else {
      const bt = ST.beamThickness(S, api.sim);
      let fp = null; try { fp = footprintFor(S, api.sim); } catch { /* no plan */ }
      rows = [
        ['Formula', `${esc(st.formula) || (st.kind === 'magnetic' ? 'magnetic film' : st.kind === 'continuum' ? 'continuum model (no atom list)' : '—')}${st.total ? ` · ${st.total.toLocaleString('en')} atoms in view${st.truncated ? ` (${st.count.toLocaleString('en')} drawn)` : ''}` : ''}`],
        ['Size', `${st.box.map(nm).join(' × ')}`],
        ['Along the beam', `t = ${nm(bt.t_A)}${bt.tau != null ? ` · t/λ ≈ ${bt.tau.toFixed(2)}` : ''}${(S.tiltX || S.tiltY) && bt.t_A !== bt.slab_A ? ` (tilted; ${nm(bt.slab_A)} flat)` : ''}`],
      ];
      if (mats.length) rows.push(['Also', esc(mats.join(', '))]);
      if (fp) rows.push(['This acquisition', `${fmtBytes(fp.raw.bytes)} · analysis <b class="tier tier-${fp.badge.tier}">${fp.badge.label}</b>`]);
      for (const n of st.notes) rows.push(['Note', esc(n)]);
    }
    infoEl.innerHTML = `<div class="sp-legend">${legend}</div><table class="data specinfo-t"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
  }

  // ---------------------------------------------------------------- uploaded structures: preview first
  function pickFile() {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.xyz,.cif,chemical/x-xyz,chemical/x-cif,text/plain' });
    inp.addEventListener('change', () => inp.files[0] && openFile(inp.files[0]));
    inp.click();
  }
  function dropTarget(el) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });
  }
  async function openFile(f) {
    try {
      const text = await f.text();
      const st = /\.cif$/i.test(f.name) || /_cell_length_a/.test(text) ? ST.fromCIFText(text, f.name) : ST.fromXYZText(text, f.name);
      if (st.cellParams) { // a CIF is one unit cell: tile it to a few nanometres so it can be imaged
        const { a, b, c } = st.cellParams, n = (L, t) => Math.max(1, Math.min(40, Math.round(t / L)));
        startPreview(ST.supercell(st, n(a, 40), n(b, 40), n(c, 30)), `${f.name}: one unit cell (${st.sym.length} atoms) tiled to about 4 × 4 × 3 nm`);
      } else startPreview(ST.center(st));
    } catch (err) { api.explain(`<small>Could not read ${esc(f.name)}</small><p>${esc(err.message)}</p>`); }
  }
  function startPreview(st, note) {
    prev = { st, note };
    refreshPreview();
    if (cardEl && cardEl.querySelector('.svhost').hidden) setOpen(true);
    viewer.setView('iso');
  }
  function refreshPreview() {
    prev.view = ST.structureView(prev.st);
    prev.check = ST.checkStructure(prev.st);
    viewer.setStructure(prev.view, `prev|${Date.now()}`);
    viewer.setOverlay({ mode: S.mode, family: family(S.mode), tiltX: 0, tiltY: 0, zone: prev.zone ?? '' });
    viewer.wake();
    const p = cardEl?.querySelector('.svprev');
    if (p) {
      p.hidden = false;
      const lat = !!prev.st.cell;
      p.innerHTML = `${prev.note ? `<p class="note">${esc(prev.note)}</p>` : ''}
        <div class="svrow"><button data-p="center">Centre</button><button data-p="principal" title="Largest spread along x, smallest along the beam">Align principal axes</button></div>
        <div class="svrow"><label>Zone [u v w]</label><input data-z="0" value="0" size="2"><input data-z="1" value="0" size="2"><input data-z="2" value="1" size="2"><button data-p="zone" ${lat ? '' : 'disabled title="needs the lattice (CIF, or extended XYZ)"'}>Align to zone</button></div>
        <div class="svrow"><label>Supercell</label><input data-n="0" value="1" size="2">×<input data-n="1" value="1" size="2">×<input data-n="2" value="1" size="2"><button data-p="tile">Tile</button></div>
        <div class="svrow"><label>Crop radius</label><input data-c value="${(Math.max(...prev.check.size_A.slice(0, 2)) / 20).toFixed(1)}" size="4"> nm<button data-p="crop">Crop</button></div>
        <div class="svrow"><button data-p="export">Export oriented .xyz</button><span class="sp"></span><button data-p="cancel">Cancel</button><button class="primary" data-p="load">Load into column</button></div>`;
      p.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => prepAction(b.dataset.p)));
    }
    renderInfo();
  }
  function prepAction(k) {
    const p = cardEl.querySelector('.svprev'), v = (sel) => +p.querySelector(sel).value;
    try {
      if (k === 'center') ST.center(prev.st);
      if (k === 'principal') ST.alignPrincipal(prev.st);
      if (k === 'zone') { const uvw = [0, 1, 2].map((i) => Math.round(v(`[data-z="${i}"]`))); ST.alignZone(prev.st, uvw); prev.zone = `[${uvw.join('')}]`; }
      if (k === 'tile') prev.st = ST.supercell(prev.st, ...[0, 1, 2].map((i) => Math.max(1, Math.min(50, Math.round(v(`[data-n="${i}"]`))))));
      if (k === 'crop') prev.st = ST.cropLateral(prev.st, v('[data-c]') * 10);
      if (k === 'export') { api.download(new Blob([ST.toXYZText(prev.st)], { type: 'chemical/x-xyz' }), prev.st.name.replace(/\.(xyz|cif)$/i, '') + '-oriented.xyz'); return; }
      if (k === 'cancel') { endPreview(); return; }
      if (k === 'load') { loadPreview(); return; }
      refreshPreview();
    } catch (err) { api.explain(`<small>${esc(k)}</small><p>${esc(err.message)}</p>`); }
  }
  function loadPreview() {
    const st = prev.st, heavy = st.sym.length > 300000;
    P.loadXYZ(ST.toXYZText(st), st.name.replace(/\.cif$/i, '.xyz'));
    endPreview(false);
    if (api.isLor() || (heavy && ['4d', 'ilh'].includes(S.mode))) api.setMode('tem'); // a big structure opens in a light mode
    api.setSpec('xyz');
    api.usage?.('xyz');
  }
  function endPreview(refresh = true) {
    prev = null;
    const p = cardEl?.querySelector('.svprev'); if (p) { p.hidden = true; p.innerHTML = ''; }
    if (refresh) update(true);
  }

  return {
    grid, card, info, update, showInResults, pickFile, openFile,
    pause: (on) => viewer.pause(on),
    viewer, get previewing() { return !!prev; },
  };
}
