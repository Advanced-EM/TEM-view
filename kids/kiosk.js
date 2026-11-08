// Electron Explorer on a museum floor.
// - Kiosk mode (?kiosk, or switched on in the staff menu): links out, right-click, text selection and page zoom are
//   blocked; after the idle time the exhibit starts over behind an attract screen with a button per language.
// - Staff menu: hold the Zip logo for 3 seconds (or Ctrl+Alt+S), enter the PIN on the keypad.
// - Visitor numbers: anonymous counts per day, kept only on this device (no network, no identifiers): sessions,
//   time spent, missions, snaps, stickers printed, QR codes shown, languages, samples, accessibility use.
// - Take-home: print the snap as a sticker (silently with Chrome's --kiosk-printing), or show a QR code that
//   opens sticker.html, which redraws the picture from a few numbers in its address.
// - Visitor options (the Aa button): high contrast, bigger text, calm motion.
import { tr, trIn, msg, lang, LANGS, LANG_NAMES } from './i18n.js';
import { settings, saveSettings, kioskMode, DEFAULTS } from './settings.js';
import { drawQR } from './qr.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const day = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const STATS = 'kids-stats';
const BINS = [30, 60, 120, 300, 600, Infinity]; // dwell-time bins, seconds
const BIN_NAMES = ['<30 s', '30–60 s', '1–2 min', '2–5 min', '5–10 min', '>10 min'];

const ATTRACT = [['Touch the screen to explore!', '¡Toca la pantalla para explorar!'], ['Zoom into pollen, viruses and real atoms', 'Haz zoom en polen, virus y átomos de verdad']];

export function initKiosk(api) {
  // api: { reset(), greet(), setLang(l), setVoice(v), setRead(b), setVolume(x), setPal(p), setA11y(o), missions: n }
  const active = kioskMode();
  let idle = 0, session = null, attractOn = false;
  document.body.classList.toggle('kiosk', active);

  // ---------------------------------------------------------------- lock-down
  if (active) {
    const stop = (e) => e.preventDefault();
    addEventListener('contextmenu', stop); addEventListener('dragstart', stop); addEventListener('selectstart', (e) => { if (!e.target.closest?.('input, textarea')) e.preventDefault(); });
    addEventListener('gesturestart', stop);
    addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', 'p', 's', 'o', 'l'].includes(e.key.toLowerCase())) e.preventDefault(); });
    addEventListener('click', (e) => { const a = e.target.closest?.('a[href]'); if (a && !a.getAttribute('href').startsWith('#') && !a.closest('#staffDlg')) e.preventDefault(); }, true);
    const vp = document.querySelector('meta[name=viewport]'); if (vp) vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  }

  // ---------------------------------------------------------------- visitor numbers (kiosk only, this device only)
  const loadStats = () => { try { return JSON.parse(localStorage.getItem(STATS) || '{"days":{}}'); } catch { return { days: {} }; } };
  const saveStats = (s) => { try { localStorage.setItem(STATS, JSON.stringify(s)); } catch { /* full or private */ } };
  function startSession() { if (active) session = { start: Date.now(), last: Date.now(), missions: new Set(), snaps: 0, prints: 0, qr: 0, samples: new Set(), langs: new Set([lang]), a11y: false }; }
  function endSession() {
    const s = session; session = null; if (!s) return;
    const dwell = Math.round((s.last - s.start) / 1000); if (dwell < 3 && !s.snaps) return; // a passer-by's bump
    const st = loadStats(), d = (st.days[day(s.start)] ||= { sessions: 0, dwell: 0, bins: BINS.map(() => 0), missions: {}, allMissions: 0, snaps: 0, prints: 0, qr: 0, langs: {}, samples: {}, a11y: 0 });
    d.sessions++; d.dwell += dwell; d.bins[BINS.findIndex((b) => dwell < b)]++;
    s.missions.forEach((m) => (d.missions[m] = (d.missions[m] ?? 0) + 1)); if (s.missions.size >= api.missions) d.allMissions++;
    d.snaps += s.snaps; d.prints += s.prints; d.qr += s.qr; d.a11y += s.a11y ? 1 : 0;
    s.langs.forEach((l) => (d.langs[l] = (d.langs[l] ?? 0) + 1)); s.samples.forEach((x) => (d.samples[x] = (d.samples[x] ?? 0) + 1));
    saveStats(st);
  }
  function track(type, v) {
    if (!session) return;
    if (type === 'mission') session.missions.add(v); else if (type === 'sample') session.samples.add(v); else if (type === 'lang') session.langs.add(v);
    else if (type === 'a11y') session.a11y = true; else if (type in session) session[type]++;
  }
  addEventListener('pagehide', endSession);

  // ---------------------------------------------------------------- idle reset and the attract screen
  const at = document.createElement('div'); at.id = 'attract'; at.className = 'attract'; at.hidden = true;
  at.innerHTML = `<div class="atzip" aria-hidden="true">${document.querySelector('.zipmini')?.outerHTML ?? ''}</div><h1 id="atTitle"></h1><p id="atSub"></p><div class="atlangs" id="atLangs"></div><div class="atdots" aria-hidden="true">${'<i></i>'.repeat(14)}</div>`;
  document.body.appendChild(at);
  let atI = 0, atTimer = null;
  const offered = () => LANGS.filter((l) => settings.langs.includes(l));
  function attractText() {
    const L = offered(), l = L[atI++ % L.length] ?? 'en';
    $('atTitle').textContent = trIn(l, ATTRACT[0]); $('atSub').textContent = trIn(l, ATTRACT[1]); $('atTitle').lang = l;
  }
  function showAttract() {
    attractOn = true; at.hidden = false; atI = 0;
    $('atLangs').innerHTML = offered().length > 1 ? offered().map((l) => `<button data-l="${l}" lang="${l}">${LANG_NAMES[l]}</button>`).join('') : '';
    attractText(); clearInterval(atTimer); atTimer = setInterval(attractText, 2600);
  }
  function hideAttract(l) {
    attractOn = false; at.hidden = true; clearInterval(atTimer);
    if (l) api.setLang(l);
    startSession(); api.greet();
  }
  at.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); hideAttract(e.target.closest('[data-l]')?.dataset.l); });
  function restart() { endSession(); api.reset(); closeAll(); if (active) showAttract(); else startSession(); }
  function activity() { idle = 0; if (session) session.last = Date.now(); }
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, activity, { passive: true, capture: true }));
  addEventListener('gamepadconnected', activity);
  function tick(dt) {
    if (!active || attractOn) return;
    idle += dt;
    if (idle > settings.reset) { idle = 0; restart(); }
  }
  // the TEM-view Console counts as a touch: main.js calls activity() when it turns
  const closeAll = () => document.querySelectorAll('dialog[open]').forEach((d) => d.id !== 'staffDlg' && d.close());

  // ---------------------------------------------------------------- visitor options: contrast, text size, motion
  function applyA11y(o) {
    document.body.classList.toggle('hc', !!o.hc); document.body.classList.toggle('big', !!o.big); document.body.classList.toggle('calm', !!o.calm);
    document.querySelectorAll('[data-a11y]').forEach((b) => b.setAttribute('aria-pressed', !!o[b.dataset.a11y]));
  }
  let a11y = { hc: settings.hc, big: settings.big, calm: settings.calm };
  try { if (!active) a11y = { ...a11y, ...JSON.parse(localStorage.getItem('kids-a11y') || '{}') }; } catch { /* default */ }
  applyA11y(a11y);
  document.querySelectorAll('[data-a11y]').forEach((b) => b.addEventListener('click', () => {
    a11y[b.dataset.a11y] = !a11y[b.dataset.a11y]; applyA11y(a11y); track('a11y');
    if (!active) try { localStorage.setItem('kids-a11y', JSON.stringify(a11y)); } catch { /* private */ }
  }));

  // ---------------------------------------------------------------- take-home: print a sticker or show a QR code
  let lastShot = null, hideT = null;
  const th = $('takeHome');
  function snapped(shot) {
    lastShot = shot; track('snaps');
    const mode = settings.takeHome;
    if (!active || !th || mode === 'off') return; // online, the sticker book's download does the job
    $('thPrint').hidden = !(mode === 'print' || mode === 'both');
    $('thQR').hidden = !(mode === 'qr' || mode === 'both');
    $('thPrint').disabled = !!session && session.prints >= settings.printMax;
    th.hidden = false; clearTimeout(hideT); hideT = setTimeout(() => (th.hidden = true), 25000);
  }
  function printSticker(shot = lastShot) {
    if (!shot) return;
    if (session && session.prints >= settings.printMax) return;
    const sizes = { '2in': ['2in 2in', '1.9in'], '58mm': ['58mm 80mm', '50mm'], '4x6': ['4in 6in', '3.6in'] }, [page, img] = sizes[settings.label] ?? sizes['2in'];
    $('printCss').textContent = `@page { size: ${page}; margin: 0 } #printArea img { width: ${img}; height: ${img} }`;
    $('printArea').innerHTML = `<img src="${shot.img}" alt=""><p>${esc(shot.icon)} ${esc(tr(shot.sp))}</p><small>${esc(tr(['Electron Explorer', 'Explorador de Electrones']))}</small>`;
    track('prints'); if (session) $('thPrint').disabled = session.prints >= settings.printMax;
    setTimeout(() => window.print(), 50);
  }
  function showQR(shot = lastShot) {
    if (!shot) return;
    drawQR($('qrCanvas'), `${settings.stickerUrl}#${shot.code}`, 6);
    $('qrImg').src = shot.img; track('qr'); $('qrDlg').showModal();
  }
  $('thPrint')?.addEventListener('click', () => printSticker());
  $('thQR')?.addEventListener('click', () => showQR());

  // ---------------------------------------------------------------- staff menu: long-press the logo, then the PIN
  const brand = document.querySelector('.brand'); let holdT = null;
  brand?.addEventListener('click', (e) => e.preventDefault());
  brand?.addEventListener('pointerdown', () => { holdT = setTimeout(openPin, 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => brand?.addEventListener(ev, () => clearTimeout(holdT)));
  addEventListener('keydown', (e) => { if (e.ctrlKey && e.altKey && e.code === 'KeyS') { e.preventDefault(); openPin(); } });
  let pin = '';
  function openPin() {
    pin = ''; $('pinDots').textContent = ''; $('pinMsg').textContent = '';
    $('pinPad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('');
    $('pinDlg').showModal();
  }
  $('pinPad')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (k == null) return;
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (k === '✓') { if (pin === String(settings.pin)) { $('pinDlg').close(); openStaff(); } else { $('pinMsg').textContent = tr(['Wrong PIN', 'PIN incorrecto']); pin = ''; } }
    else if (pin.length < 8) pin += k;
    $('pinDots').textContent = '●'.repeat(pin.length);
  });

  const L = (m) => esc(tr(m));
  function statsTable() {
    const st = loadStats(), days = Object.keys(st.days).sort().reverse();
    const sum = (f) => days.reduce((a, k) => a + f(st.days[k]), 0), n = sum((d) => d.sessions);
    const row = (k, d) => `<tr><td>${k}</td><td>${d.sessions}</td><td>${d.sessions ? Math.round(d.dwell / d.sessions) : 0} s</td><td>${Object.values(d.missions).reduce((a, b) => a + b, 0)}</td><td>${d.allMissions}</td><td>${d.snaps}</td><td>${d.prints}</td><td>${d.qr}</td><td>${Object.entries(d.langs).map(([l, c]) => `${l} ${c}`).join(', ')}</td></tr>`;
    return `<p>${L(msg(['{n} visits since {since}; average stay {avg} s.', '{n} visitas desde {since}; estancia media {avg} s.'], { n, since: days.at(-1) ?? '—', avg: n ? Math.round(sum((d) => d.dwell) / n) : 0 }))}</p>
      <div class="tscroll"><table class="stats"><tr><th>${L(['Day', 'Día'])}</th><th>${L(['Visits', 'Visitas'])}</th><th>${L(['Avg stay', 'Estancia media'])}</th><th>${L(['Missions', 'Misiones'])}</th><th>${L(['All done', 'Todas'])}</th><th>${L(['Snaps', 'Fotos'])}</th><th>${L(['Printed', 'Impresas'])}</th><th>QR</th><th>${L(['Languages', 'Idiomas'])}</th></tr>
      ${days.slice(0, 14).map((k) => row(k, st.days[k])).join('')}</table></div>`;
  }
  function exportCsv() {
    const st = loadStats(), head = ['day', 'visits', 'total_seconds', ...BIN_NAMES.map((b) => `stay ${b}`), 'missions_completed', 'all_missions', 'snaps', 'stickers_printed', 'qr_shown', 'accessibility_used', 'languages', 'samples'];
    const rows = Object.keys(st.days).sort().map((k) => { const d = st.days[k]; return [k, d.sessions, d.dwell, ...d.bins, Object.values(d.missions).reduce((a, b) => a + b, 0), d.allMissions, d.snaps, d.prints, d.qr, d.a11y, Object.entries(d.langs).map((e) => e.join(':')).join(' '), Object.entries(d.samples).map((e) => e.join(':')).join(' ')].join(','); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `electron-explorer-visits-${day()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function openStaff() {
    const s = settings, packs = await api.packList();
    const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;
    const chk = (k, label) => `<label class="srow"><input type="checkbox" data-s="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`;
    $('staffBody').innerHTML = `
      <p class="eyebrow">${L(['Staff only', 'Solo personal'])}</p><h2 id="sTitle">${L(['Exhibit settings', 'Ajustes de la exhibición'])}</h2>
      <section><h3>${L(['Kiosk', 'Quiosco'])}</h3>${chk('kiosk', L(['Kiosk mode on this device (or open the page with ?kiosk)', 'Modo quiosco en este equipo (o abre la página con ?kiosk)']))}
        <label class="srow">${L(['Start over after no touch for', 'Volver a empezar tras no tocar durante'])} <select data-s="reset">${[60, 120, 180, 300, 600].map((v) => opt(v, s.reset, `${v / 60} min`)).join('')}</select></label></section>
      <section><h3>${L(['Languages', 'Idiomas'])}</h3><label class="srow">${L(['Visitors start in', 'Los visitantes empiezan en'])} <select data-s="lang">${opt('', s.lang, tr(['the browser\'s language', 'el idioma del navegador']))}${LANGS.map((l) => opt(l, s.lang, LANG_NAMES[l])).join('')}</select></label>
        <div class="srow">${L(['Offered', 'Disponibles'])}: ${LANGS.map((l) => `<label><input type="checkbox" data-lang-on="${l}" ${s.langs.includes(l) ? 'checked' : ''}> ${LANG_NAMES[l]}</label>`).join(' ')}</div></section>
      <section><h3>${L(['Zip\'s voice and sound', 'La voz de Zip y el sonido'])}</h3>
        <label class="srow">${L(['Voice', 'Voz'])} <select data-s="voice">${opt('female', s.voice, tr(['Girl', 'Niña']))}${opt('male', s.voice, tr(['Boy', 'Niño']))}</select></label>
        ${chk('read', L(['Read aloud is on when a visit starts', 'Leer en voz alta está activado al empezar']))}
        <label class="srow">${L(['Volume', 'Volumen'])} <input type="range" min="0" max="1" step="0.05" data-s="volume" value="${s.volume}"></label></section>
      <section><h3>${L(['Picture and access', 'Imagen y accesibilidad'])}</h3>
        <label class="srow">${L(['Colors', 'Colores'])} <select data-s="pal">${opt('color', s.pal, tr(['Cartoon', 'Caricatura']))}${opt('mono', s.pal, tr(['Real (grey)', 'Real (gris)']))}${opt('green', s.pal, tr(['Glowing screen', 'Pantalla brillante']))}</select></label>
        ${chk('hc', L(['High contrast', 'Alto contraste']))}${chk('big', L(['Bigger text', 'Texto más grande']))}${chk('calm', L(['Calm motion', 'Movimiento tranquilo']))}</section>
      <section><h3>${L(['Take-home sticker', 'Sticker para llevar'])}</h3>
        <label class="srow">${L(['After a snap, offer', 'Después de una foto, ofrecer'])} <select data-s="takeHome">${opt('off', s.takeHome, tr(['nothing', 'nada']))}${opt('print', s.takeHome, tr(['a printed sticker', 'un sticker impreso']))}${opt('qr', s.takeHome, tr(['a QR code', 'un código QR']))}${opt('both', s.takeHome, tr(['both', 'ambos']))}</select></label>
        <label class="srow">${L(['Printer paper', 'Papel de la impresora'])} <select data-s="label">${opt('2in', s.label, tr(['2-inch round labels', 'Etiquetas redondas de 2 pulgadas']))}${opt('58mm', s.label, tr(['58 mm receipt roll', 'Rollo de recibos de 58 mm']))}${opt('4x6', s.label, tr(['4 × 6 inch photo paper', 'Papel fotográfico de 4 × 6 pulgadas']))}</select></label>
        <label class="srow">${L(['Stickers per visitor', 'Stickers por visitante'])} <select data-s="printMax">${[1, 2, 3, 5, 10].map((v) => opt(v, s.printMax, String(v))).join('')}</select></label>
        <label class="srow">${L(['QR code opens', 'El código QR abre'])} <input type="url" data-s="stickerUrl" value="${esc(s.stickerUrl)}"></label>
        <p class="muted">${L(['The QR code holds only the picture\'s settings: no name, time, place or photo of the visitor.', 'El código QR contiene solo los ajustes de la imagen: ni nombre, ni hora, ni lugar, ni foto del visitante.'])}</p></section>
      <section><h3>${L(['Sample packs', 'Paquetes de muestras'])}</h3>${packs.length ? packs.map((p) => `<label class="srow"><input type="checkbox" data-pack="${esc(p.id)}" ${p.on ? 'checked' : ''}> ${esc(p.icon ?? '')} ${esc(tr(p.name))}</label>`).join('') : `<p class="muted">${L(['No packs installed.', 'No hay paquetes instalados.'])}</p>`}
        <p class="muted">${L(['Add a pack in kids/packs/ (see the museum guide); changes apply after Save.', 'Añade un paquete en kids/packs/ (ver la guía para museos); los cambios se aplican al guardar.'])}</p></section>
      <section><h3>${L(['Offline', 'Sin conexión'])}</h3><p class="srow"><button type="button" class="chip" id="sOffline">${L(['Save everything for offline use', 'Guardar todo para usar sin conexión'])}</button> <span id="sOffMsg" class="muted"></span></p></section>
      <section><h3>${L(['Visitor numbers (this device only)', 'Visitas (solo este equipo)'])}</h3>${statsTable()}
        <p class="srow"><button type="button" class="chip" id="sCsv">${L(['Export CSV', 'Exportar CSV'])}</button> <button type="button" class="chip" id="sClear">${L(['Clear numbers', 'Borrar números'])}</button></p></section>
      <section><h3>PIN</h3><label class="srow">${L(['New PIN (digits)', 'Nuevo PIN (dígitos)'])} <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8" id="sPin" placeholder="••••"></label></section>
      <p class="srow sbtns"><button type="button" class="cb" id="sRestart">${L(['Start over now', 'Empezar de nuevo ahora'])}</button><button type="button" class="cb snap" id="sSave">${L(['Save', 'Guardar'])}</button><button type="button" class="cb" id="sDefaults">${L(['Factory settings', 'Ajustes de fábrica'])}</button></p>`;
    $('sCsv').onclick = exportCsv;
    $('sClear').onclick = () => { if (confirm(tr(['Clear all visitor numbers on this device?', '¿Borrar todos los números de visitas de este equipo?']))) { saveStats({ days: {} }); openStaff(); } };
    $('sRestart').onclick = () => { $('staffDlg').close(); restart(); };
    $('sDefaults').onclick = () => { if (confirm(tr(['Reset every setting, including the PIN?', '¿Restablecer todos los ajustes, incluido el PIN?']))) { saveSettings({ ...DEFAULTS }); location.reload(); } };
    $('sOffline').onclick = async () => { $('sOffMsg').textContent = '…'; try { const n = await api.precache((done, all) => ($('sOffMsg').textContent = `${done} / ${all}`)); $('sOffMsg').textContent = tr(msg(['{n} files saved.', '{n} archivos guardados.'], { n })); } catch (e) { $('sOffMsg').textContent = String(e.message || e); } };
    $('sSave').onclick = () => {
      const patch = {}, root = $('staffBody');
      root.querySelectorAll('[data-s]').forEach((el) => { const k = el.dataset.s; patch[k] = el.type === 'checkbox' ? el.checked : typeof DEFAULTS[k] === 'number' ? +el.value : el.value; });
      patch.langs = LANGS.filter((l) => root.querySelector(`[data-lang-on="${l}"]`).checked); if (!patch.langs.length) patch.langs = ['en'];
      if (packs.length) patch.packs = packs.filter((p) => root.querySelector(`[data-pack="${p.id}"]`).checked).map((p) => p.id);
      const p = $('sPin').value.replace(/\D/g, ''); if (p.length >= 4) patch.pin = p;
      saveSettings(patch); location.reload();
    };
    $('staffDlg').showModal();
  }

  // ---------------------------------------------------------------- start
  if (active) {
    if (settings.lang && settings.lang !== lang) api.setLang(settings.lang);
    api.setVoice(settings.voice); api.setRead(settings.read); api.setPal(settings.pal);
    showAttract();
  } else startSession();
  api.setVolume(settings.volume);

  return {
    active, track, tick, activity, snapped, printSticker, showQR, restart,
    resetA11y() { a11y = { hc: settings.hc, big: settings.big, calm: settings.calm }; applyA11y(a11y); },
    offered,
  };
}
