// Electron Explorer: a cartoon electron microscope for K-12. Three lenses (brightness, focus, zoom), a stage, a
// camera, missions with a guide (Zip the electron), a sticker book, and the TEM-view Console.
// The physics kept: focus blur grows with zoom; squeezing the beam (brightness) shrinks the lit spot and cooks soft
// samples; a dim beam gives a grainy picture (few electrons); a new sample needs refocusing.
import { SPECIMENS, rng } from './specimens.js';
import { Console, shortName } from './console.js';
import { HELLO, HELLO_START, T, QUESTS as QT, PARTS, FACTS, VOICES, lookingAt, needsSample, nextMission, sampleName, plain, clipId } from './lines.js';
import { lang, tr, locale, setLang, onLang, applyStatic } from './i18n.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const W = 720;
const KIOSK = new URLSearchParams(location.search).has('kiosk');
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };
// join [English, Spanish] pairs (or plain strings, the same in both) into one pair
const cat = (...ps) => [0, 1].map((k) => ps.filter(Boolean).map((p) => (Array.isArray(p) ? p[k] ?? p[0] : p)).join(' '));

// ------------------------------------------------------------------ state
const S = {
  si: 0, beam: false, focus: 0, f0: 0, bright: 0.5, pal: 'color', sound: true, read: false, voice: store('kids-voice') === 'male' ? 'male' : 'female',
  views: SPECIMENS.map((sp) => ({ ...sp.start })), burns: SPECIMENS.map(() => []), facts: SPECIMENS.map(() => new Set()),
  snaps: [], done: new Set(), hint: false, joy: [0, 0], sharpT: 0, warnT: {}, idle: 0,
};
const spec = () => SPECIMENS[S.si];
const view = () => S.views[S.si];
S.f0 = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 40);

// ------------------------------------------------------------------ sound (built on the first gesture)
const A = { ctx: null };
function audio() {
  if (A.ctx || !S.sound) return A.ctx;
  try {
    const ctx = new AudioContext(); A.ctx = ctx; A.out = ctx.createGain(); A.out.gain.value = 0.35; A.out.connect(ctx.destination);
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
    // a sizzle that plays while a soft sample cooks
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    A.sizzle = ctx.createGain(); A.sizzle.gain.value = 0; src.connect(hp).connect(A.sizzle).connect(A.out); src.start();
  } catch { A.ctx = null; }
  return A.ctx;
}
function tone(f, len = 0.08, type = 'sine', vol = 0.3, when = 0, slide = 0) {
  const ctx = S.sound && audio(); if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + when;
  o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + len);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len); o.connect(g).connect(A.out); o.start(t); o.stop(t + len + 0.02);
}
function noiseBurst(len = 0.12, freq = 2500, vol = 0.5) {
  const ctx = S.sound && audio(); if (!ctx) return;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
  s.buffer = A.noise; f.type = 'bandpass'; f.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  s.connect(f).connect(g).connect(A.out); s.start(t, Math.random() * 0.5); s.stop(t + len + 0.05);
}
let tickT = 0;
const tick = (f) => { const n = performance.now(); if (n - tickT > 45) { tickT = n; tone(f, 0.03, 'triangle', 0.12); } };
const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.12, i * 0.11));
addEventListener('pointerdown', () => { if (!document.hidden && S.sound) { audio(); A.ctx?.resume?.(); } }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) A.ctx?.suspend?.(); else if (S.sound) A.ctx?.resume?.(); });

// ------------------------------------------------------------------ Zip, the guide
const zip = $('zip'), bubble = $('bubble');
let sayT = 0;
// say(msg) shows a line ([English, Spanish] or a plain string); with Read aloud on, Zip speaks it, or the spoken
// parts given (the bubble may show more, such as numbers). Each part plays its recorded clip in the chosen language
// and voice (kids/audio, see tools/narrate-kids.mjs) or, without one, the most natural voice the browser has.
let last = { msg: HELLO, mood: 'happy', parts: [HELLO] };
function say(msg, mood = 'happy', parts = [msg]) {
  last = { msg, mood, parts };
  bubble.innerHTML = tr(msg); zip.setAttribute('class', mood); sayT = performance.now();
  bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
  if (S.read && S.sound) Voice.speak(parts); else Voice.stop();
}
const Voice = {
  clips: {}, el: null, run: 0,
  async load() { try { const r = await fetch('audio/manifest.json', { cache: 'no-cache' }); if (r.ok) this.clips = await r.json(); } catch { /* no clips: browser voice */ } },
  stop() { this.run++; this.el?.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); },
  async speak(parts) {
    this.stop(); const run = this.run;
    for (const p of parts) {
      const text = plain(tr(p), lang); if (!text) continue;
      if (run !== this.run) return;
      const f = this.clips[clipId(lang, S.voice, text)];
      await (f ? this.play(`audio/${f}`) : this.tts(text));
    }
  },
  play(src) { return new Promise((res) => { const a = (this.el ||= new Audio()); a.src = src; a.onended = a.onerror = () => res(); a.play().catch(() => res()); }); },
  // the browser's voices: prefer natural or enhanced ones in the page's language and Zip's voice, pitched up
  pick() {
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang)); if (!vs.length) return null;
    const girl = /aria|jenny|ana|samantha|zira|karen|moira|tessa|ava|allison|susan|serena|paulina|m[oó]nica|sabina|dalia|elvira|helena|laura|lupe|paloma|female/i;
    const boy = /guy|davis|andrew|brian|daniel|alex|tom|aaron|jorge|diego|juan|carlos|alvaro|[aá]lvaro|pablo|raul|ra[uú]l|male/i;
    const score = (v) => (/natural|neural|online|enhanced|premium/i.test(v.name) ? 4 : 0) + ((S.voice === 'male' ? boy : girl).test(v.name) ? 3 : 0)
      + (/US|MX|419/i.test(v.lang) ? 1 : 0) - (/albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|grandpa|grandma|rocko|shelley|eddy|flo|reed|sandy/i.test(v.name) ? 10 : 0);
    return vs.sort((a, b) => score(b) - score(a))[0];
  },
  tts(text) {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    return new Promise((res) => { const u = new SpeechSynthesisUtterance(text); const v = this.pick(); u.lang = locale(); if (v) u.voice = v; u.pitch = 1.6; u.rate = 1.04; u.onend = u.onerror = () => res(); speechSynthesis.speak(u); });
  },
};
Voice.load();
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // some browsers only list voices after a first call
// say something only once in a while
function nag(key, html, mood, every = 12000) { const n = performance.now(); if ((S.warnT[key] ?? -1e9) + every < n) { S.warnT[key] = n; say(html, mood); } }

// ------------------------------------------------------------------ the picture
const canvas = $('screen'), ctx = canvas.getContext('2d');
const buf = document.createElement('canvas'); buf.width = buf.height = W; const bctx = buf.getContext('2d');
const hasFilter = 'filter' in ctx;
const noise = [0, 1, 2].map((k) => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), im = g.createImageData(256, 256), r = rng(k + 3);
  for (let i = 0; i < 256 * 256; i++) { const l = r() < 0.5 ? 0 : 255; im.data.set([l, l, l, r() * 255], i * 4); }
  g.putImageData(im, 0, 0); return c;
});
let dirty = true;

function vobj() {
  const v = view(), s = W / v.fov;
  return { cx: v.cx, cy: v.cy, fov: v.fov, s, x0: v.cx - v.fov / 2, x1: v.cx + v.fov / 2, y0: v.cy - v.fov / 2, y1: v.cy + v.fov / 2, mono: S.pal !== 'color' };
}
// optics in kid units
const blurPx = () => Math.min(26, Math.abs(S.focus - S.f0) * 0.22 * Math.pow(spec().fovMax / view().fov, 0.18));
const sharpness = () => Math.exp(-((blurPx() / 2.2) ** 2));
const gain = () => 0.08 + 2.2 * Math.pow(S.bright, 1.3);          // picture brightness
const spot = () => 1.5 - S.bright;                                 // lit disc radius / screen radius
const grain = () => clamp((0.45 - S.bright) / 0.45, 0, 1) * 0.5 + (S.pal === 'color' ? 0.02 : 0.07);

function drawSpecimen() {
  const sp = spec(), v = vobj();
  bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.fillStyle = sp.bg(v.mono); bctx.fillRect(0, 0, W, W);
  bctx.setTransform(v.s, 0, 0, v.s, W / 2 - v.cx * v.s, W / 2 - v.cy * v.s);
  sp.draw(bctx, v);
  // cooked spots
  for (const b of S.burns[S.si]) {
    if (b.x + b.r < v.x0 || b.x - b.r > v.x1 || b.y + b.r < v.y0 || b.y - b.r > v.y1) continue;
    const g = bctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r), c = v.mono ? '15,15,15' : '95,45,10';
    g.addColorStop(0, `rgba(${c},${0.8 * b.amt})`); g.addColorStop(0.75, `rgba(${c},${0.55 * b.amt})`); g.addColorStop(1, `rgba(${c},0)`);
    bctx.fillStyle = g; bctx.beginPath(); bctx.arc(b.x, b.y, b.r, 0, TAU); bctx.fill();
    if (b.amt > 0.35) { // bubbles: real organic samples bubble under a strong beam
      const r = rng(b.seed); bctx.fillStyle = `rgba(255,240,215,${0.55 * b.amt})`; bctx.strokeStyle = `rgba(${c},${0.8 * b.amt})`; bctx.lineWidth = b.r * 0.012;
      for (let k = 0; k < 16 * b.amt; k++) { const a = r() * TAU, d = Math.sqrt(r()) * b.r * 0.65, rr = b.r * (0.03 + r() * 0.07); bctx.beginPath(); bctx.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, rr, 0, TAU); bctx.fill(); bctx.stroke(); }
    }
  }
  dirty = false;
}

function composite() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, W, W);
  if (!S.beam) return;
  const b = blurPx(), k = gain();
  const tint = S.pal === 'green' ? ' sepia(1) hue-rotate(55deg) saturate(2.6)' : S.pal === 'mono' ? ' contrast(1.08)' : '';
  if (hasFilter) { ctx.filter = `blur(${b.toFixed(2)}px) brightness(${k.toFixed(3)})${tint}`; ctx.drawImage(buf, 0, 0); ctx.filter = 'none'; }
  else { // no canvas filters: blur by shrinking and stretching, brightness by a veil
    const sc = 1 / (1 + b / 2), w = Math.max(8, Math.round(W * sc)); tmp.width = tmp.height = w;
    tmp.getContext('2d').drawImage(buf, 0, 0, w, w); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(tmp, 0, 0, W, W);
    if (k < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - k})`; ctx.fillRect(0, 0, W, W); } else { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, k - 1); ctx.drawImage(tmp, 0, 0, W, W); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  }
  // grain: with few electrons, each spot gets a random number of them
  const n = grain();
  if (n > 0.02) { ctx.globalAlpha = n; const t = noise[(Math.random() * 3) | 0], ox = -Math.random() * 256, oy = -Math.random() * 256; for (let y = oy; y < W; y += 256) for (let x = ox; x < W; x += 256) ctx.drawImage(t, x, y); ctx.globalAlpha = 1; }
  // the lit disc: a squeezed beam lights only the middle
  const R = (W / 2) * spot(), g = ctx.createRadialGradient(W / 2, W / 2, R * 0.8, W / 2, W / 2, R * 1.04);
  g.addColorStop(0, 'rgba(4,6,12,0)'); g.addColorStop(1, 'rgba(4,6,12,.96)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
}
const tmp = document.createElement('canvas');

// ------------------------------------------------------------------ readouts
const fmtLen = (nm) => nm >= 1e6 ? `${+(nm / 1e6).toPrecision(2)} mm` : nm >= 1e3 ? `${+(nm / 1e3).toPrecision(2)} µm` : nm >= 1 ? `${+nm.toPrecision(2)} nm` : `${+nm.toPrecision(2)} nm`;
const UNITS = { 'µm': ['micrometres (a millionth of a metre)', 'micrómetros (una millonésima de metro)'], nm: ['nanometres (a billionth of a metre)', 'nanómetros (una milmillonésima de metro)'], mm: ['millimetres', 'milímetros'] };
// [icon, [one, uno], [many, muchos], [name on the ladder], size in nm]
const THINGS = [
  ['🐜', ['an ant', 'una hormiga'], ['ants', 'hormigas'], ['an ant', 'una hormiga'], 3e6],
  ['💇', ['a hair (its width)', 'un cabello (su grosor)'], ['hairs', 'cabellos'], ['a hair', 'un cabello'], 8e4],
  ['🌼', ['a pollen grain', 'un grano de polen'], ['pollen grains', 'granos de polen'], ['a pollen grain', 'un grano de polen'], 2.5e4],
  ['🩸', ['a red blood cell', 'un glóbulo rojo'], ['red blood cells', 'glóbulos rojos'], ['a red blood cell', 'un glóbulo rojo'], 7.5e3],
  ['🦠', ['a bacterium', 'una bacteria'], ['bacteria', 'bacterias'], ['a bacterium', 'una bacteria'], 2e3],
  ['👾', ['a virus', 'un virus'], ['viruses', 'virus'], ['a virus', 'un virus'], 1.2e2],
  ['🥇', ['a gold nanoparticle', 'una nanopartícula de oro'], ['gold nanoparticles', 'nanopartículas de oro'], ['a gold nanoparticle', 'una nanopartícula de oro'], 10],
  ['🧬', ['a DNA strand (its width)', 'una hebra de ADN (su grosor)'], ['DNA strands', 'hebras de ADN'], ['a DNA strand', 'una hebra de ADN'], 2],
  ['⚛️', ['an atom', 'un átomo'], ['atoms', 'átomos'], ['an atom', 'un átomo'], 0.25],
].map(([icon, one, many, name, size]) => ({ icon, one, many, name, size }));
// rungs evenly spaced; the marker slides between them on a log scale
function ladderPos(nm) {
  const n = THINGS.length, at = (i) => ((i + 0.5) / n) * 100;
  if (nm >= THINGS[0].size) return at(0) - Math.min(1, Math.log10(nm / THINGS[0].size)) * at(0);
  for (let i = 0; i < n - 1; i++) { const a = THINGS[i].size, b = THINGS[i + 1].size; if (nm >= b) return at(i) + (Math.log10(a / nm) / Math.log10(a / b)) * (at(i + 1) - at(i)); }
  return at(n - 1);
}
const fmtMag = (m) => (m >= 1e6 ? big(m) : (Math.round(m / (m >= 1e4 ? 100 : 10)) * (m >= 1e4 ? 100 : 10)).toLocaleString(locale()));
const big = (m) => { const n = (x) => (+x.toPrecision(2)).toLocaleString(locale());
  return m >= 1e9 ? `${n(m / 1e9)} ${tr(['billion', 'mil millones'])}` : m >= 1e6 ? `${n(m / 1e6)} ${tr(['million', 'millones'])}` : Math.round(m).toLocaleString(locale()); };
const thing = (fov) => THINGS.find((t) => t.size <= fov * 1.2) ?? THINGS.at(-1);
function readouts() {
  const v = view(), mm = canvas.getBoundingClientRect().width * 0.2646 || 150, mag = (mm * 1e6) / v.fov;
  $('magNum').textContent = `×${fmtMag(mag)}`;
  $('magWords').textContent = tr(mag >= 1e6 ? ['times bigger on your screen!', '¡veces más grande en tu pantalla!'] : ['times bigger on your screen', 'veces más grande en tu pantalla']);
  const e = Math.pow(10, Math.floor(Math.log10(v.fov / 4))), L = [5, 2, 1].map((m) => m * e).find((l) => l <= v.fov / 3.2) ?? e;
  $('scaleBar').style.width = `${(L / v.fov) * 100}%`; $('scaleTxt').textContent = fmtLen(L);
  $('scaleTxt').title = tr(UNITS[fmtLen(L).split(' ')[1]] ?? '');
  const th = thing(v.fov), n = v.fov / th.size, N = n < 10 ? Math.round(n) : Math.round(n / 5) * 5;
  $('fitTxt').textContent = n < 1.6 ? tr([`The screen is about as wide as ${th.one[0]} ${th.icon}`, `La pantalla mide más o menos lo mismo que ${th.one[1]} ${th.icon}`])
    : tr([`About ${N} ${th.many[0]} ${th.icon} fit across the screen`, `Caben unos ${N} ${th.many[1]} ${th.icon} a lo ancho de la pantalla`]);
  // the ladder
  $('ladMark').style.top = `${ladderPos(v.fov)}%`;
  THINGS.forEach((t, i) => $('ladder').children[i].classList.toggle('seen', t.size <= v.fov * 1.2 && t.size >= v.fov / 60));
  // meters
  const sh = S.beam ? sharpness() : 0;
  $('sharpBar').style.width = `${sh * 100}%`; $('sharpFace').textContent = !S.beam ? '😴' : sh > 0.85 ? '😎' : sh > 0.4 ? '🙂' : sh > 0.12 ? '😐' : '😵‍💫';
  $('liteBar').style.width = `${S.bright * 100}%`;
  $('liteWord').textContent = tr(!S.beam ? ['beam off', 'haz apagado'] : S.bright < 0.22 ? ['too dark', 'muy oscuro'] : S.bright < 0.36 ? ['a bit dark', 'algo oscuro'] : S.bright <= 0.7 ? ['just right', 'perfecto'] : S.bright <= 0.82 ? ['very bright', 'muy brillante'] : ['too bright!', '¡demasiado!']);
  $('screenGlow').setAttribute('opacity', S.beam ? 0.25 + 0.75 * S.bright : 0.12);
}

// ------------------------------------------------------------------ the column cartoon: beam and electrons
const beamPath = $('beam'), eg = $('electrons'), dots = [];
for (let i = 0; i < 46; i++) { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('r', 3.2); c.setAttribute('fill', '#16a34a'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 1.2); eg.appendChild(c); dots.push({ el: c, y: -1, u: 0 }); }
function beamProfile() {
  const ws = 3 + 24 * (1 - S.bright); // half-width at the sample: brighter = squeezed
  return [[88, 2], [150, 22], [184, 22], [307, ws], [350, 18], [400, 2], [452, 16], [482, 16], [580, 52]];
}
function halfAt(P, y) { for (let i = 1; i < P.length; i++) if (y <= P[i][0]) { const [y0, w0] = P[i - 1], [y1, w1] = P[i]; return w0 + ((w1 - w0) * (y - y0)) / (y1 - y0); } return P.at(-1)[1]; }
let spawn = 0;
function column(dt) {
  const P = beamProfile();
  beamPath.setAttribute('d', S.beam ? `M${P.map(([y, w]) => `${120 - w} ${y}`).join(' L')} L${P.slice().reverse().map(([y, w]) => `${120 + w} ${y}`).join(' L')} Z` : '');
  beamPath.setAttribute('opacity', 0.2 + 0.45 * S.bright);
  if (S.beam) spawn += dt * (6 + 26 * S.bright);
  for (const d of dots) {
    if (d.y < 0 && spawn >= 1) { spawn -= 1; d.y = 90; d.u = (Math.random() * 2 - 1) * 0.85; }
    if (d.y >= 0) { d.y += dt * 230; if (d.y > 584) d.y = -1; }
    d.el.style.display = d.y >= 0 ? '' : 'none';
    if (d.y >= 0) { d.el.setAttribute('cx', 120 + d.u * halfAt(P, d.y)); d.el.setAttribute('cy', d.y); }
  }
  spawn = Math.min(spawn, 2);
}
const glow = (id) => { const e = $(id); e.classList.add('hot'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('hot'), 450); };

// ------------------------------------------------------------------ controls (shared by the on-screen console, the real Console and the keyboard)
function turn(axis, n, fine = true) {
  S.idle = 0;
  if (axis === 'focus') { S.focus = clamp(S.focus + n * (fine ? 1 : 5), -200, 200); glow('lensFocus'); tick(520 + (S.focus % 12) * 12); knobs.focus?.spin(n); }
  else if (axis === 'mag') { zoomBy(Math.pow(1.13, n)); glow('lensZoom'); tick(330 + n * 10); knobs.mag?.spin(n); }
  else if (axis === 'intensity') { S.bright = clamp(S.bright + n * 0.025, 0, 1); glow('lensBright'); tick(700 + S.bright * 400); knobs.intensity?.spin(n); }
  else if (axis === 'mfX' || axis === 'mfY') { const v = view(); v[axis === 'mfX' ? 'cx' : 'cy'] += n * v.fov * 0.02; clampView(); }
  dirty = true;
}
function zoomBy(f, at) {
  const v = view(), sp = spec(), nf = clamp(v.fov / f, sp.fovMin, sp.fovMax);
  if (at) { const k = 1 - nf / v.fov; v.cx += (at[0] - v.cx) * k; v.cy += (at[1] - v.cy) * k; }
  v.fov = nf; clampView(); dirty = true;
}
function clampView() { const v = view(), B = spec().bound; v.cx = clamp(v.cx, -B, B); v.cy = clamp(v.cy, -B, B); }
function stage(vx, vy, dt) { const v = view(); v.cx += vx * v.fov * 0.6 * dt; v.cy += vy * v.fov * 0.6 * dt; clampView(); dirty = true; S.idle = 0; }

function setBeam(on) {
  if (S.beam === on) return; S.beam = on; S.idle = 0;
  $('beamBtn').setAttribute('aria-pressed', on); $('sleep').hidden = on;
  if (on) { tone(180, 0.35, 'sawtooth', 0.12, 0, 4); noiseBurst(0.3, 900, 0.2); } else tone(500, 0.3, 'sine', 0.15, 0, 0.3);
}
function setSample(i, quiet = false) {
  i = (i + SPECIMENS.length) % SPECIMENS.length; if (i === S.si && !quiet) return;
  S.si = i; S.idle = 0;
  // a new sample sits at a slightly different height: focus again
  const dir = S.focus > 60 ? -1 : S.focus < -60 ? 1 : Math.random() < 0.5 ? -1 : 1;
  S.f0 = S.focus + dir * (35 + Math.random() * 45);
  document.querySelectorAll('#samples button').forEach((b, k) => b.setAttribute('aria-checked', k === i));
  $('sampleIcon').textContent = spec().icon;
  dirty = true; noiseBurst(0.18, 600, 0.25);
  if (!quiet) say(cat(sampleName(spec()), spec().blurb), 'happy', [sampleName(spec()), spec().blurb]);
  showQuest();
}
function setPal(p) { S.pal = p; document.querySelectorAll('[data-pal]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pal === p)); dirty = true; }
const PALS = ['color', 'mono', 'green'];

function whatsThis() {
  if (!S.beam) { say(T.beamOffWhat, 'worry'); return; }
  const v = vobj(), th = thing(v.fov), l = lookingAt(spec().what(v)), n = Math.max(1, Math.round(v.fov / th.size));
  say(cat(l, [`The screen is ${fmtLen(v.fov)} wide: that's about ${n} × ${th.one[0]}.`, `La pantalla mide ${fmtLen(v.fov)} de ancho: como ${n} × ${th.one[1]}.`]), 'wow', [l]);
}
function focusHelp() {
  if (!S.beam) { say(T.beamFirst, 'worry'); return; }
  const s = sharpness();
  if (s > 0.85) say(T.superSharp, 'happy');
  else { const a = s > 0.4 ? T.almostSharp : T.prettyBlurry; say(cat(a, T.focusHow), 'worry', [a, T.focusHow]); }
}

const consoleApi = {
  turn, stage, say: (m) => say(T[m] ?? m),
  button(k) {
    S.idle = 0;
    if (k === 'pause') setBeam(!S.beam);
    else if (k === 'acquire') snap();
    else if (k === 'modePrev') setSample(S.si - 1);
    else if (k === 'modeNext') setSample(S.si + 1);
    else if (k === 'talk' || k === 'wobbler') hint();
    else if (k === 'optFocus') focusHelp();
    else if (k === 'mfSelect') whatsThis();
    else if (k === 'clarity') setPal(PALS[(PALS.indexOf(S.pal) + 1) % 3]);
    else if (k === 'labels') $('tags').classList.toggle('off');
    else if (k === 'narrate') $('readBtn').click();
    else if (k === 'expand') openBook();
    else if (k === 'calib') openConsole();
  },
};
const con = new Console(consoleApi);

// on-screen knobs: endless, like the Console's encoders; drag around, scroll, tap − / +, or arrow keys
const knobs = {};
class Knob {
  constructor(host, axis, label, sub, color) {
    this.axis = axis; this.angle = 0; this.label = label; this.sub = sub;
    const d = document.createElement('div'); d.className = 'knob'; d.style.setProperty('--kc', color); this.el = d;
    d.innerHTML = `<div class="kdial" role="slider" tabindex="0"><div class="kcap"><i></i></div></div>
      <div class="kpm"><button type="button">−</button><span class="klabel"></span><button type="button">+</button></div><small></small>`;
    host.appendChild(d); this.text();
    this.cap = d.querySelector('.kcap'); const dial = d.querySelector('.kdial');
    const [minus, plus] = d.querySelectorAll('.kpm button');
    const hold = (b, n) => { let t = null; const go = () => { turn(axis, n); t = setTimeout(go, t ? 70 : 380); };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); go(); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { clearTimeout(t); t = null; }); };
    hold(minus, -1); hold(plus, 1);
    let last = null, acc = 0;
    const ang = (e) => { const r = dial.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); };
    dial.addEventListener('pointerdown', (e) => { last = ang(e); dial.setPointerCapture(e.pointerId); e.preventDefault(); dial.focus({ preventScroll: true }); });
    dial.addEventListener('pointermove', (e) => { if (last === null) return; let a = ang(e), da = a - last; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU; last = a; acc += da / (TAU / 24); const n = Math.trunc(acc); if (n) { acc -= n; turn(axis, n); } });
    for (const ev of ['pointerup', 'pointercancel']) dial.addEventListener(ev, () => { last = null; acc = 0; });
    dial.addEventListener('wheel', (e) => { e.preventDefault(); turn(axis, e.deltaY < 0 ? 1 : -1); }, { passive: false });
    dial.addEventListener('keydown', (e) => { const n = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key]; if (n) { e.preventDefault(); turn(axis, n * (e.shiftKey ? 5 : 1)); } });
  }
  spin(n) { this.angle += n * 15; this.cap.style.transform = `rotate(${this.angle}deg)`; }
  text() {
    const l = tr(this.label), s = tr(this.sub), [m, p] = this.el.querySelectorAll('.kpm button');
    this.el.querySelector('.klabel').textContent = l; this.el.querySelector('small').textContent = s;
    this.el.querySelector('.kdial').setAttribute('aria-label', tr([`${l} knob: ${s}. Use the arrow keys or drag around it.`, `Perilla ${l}: ${s}. Usa las flechas o arrastra alrededor.`]));
    m.setAttribute('aria-label', `${l} −`); p.setAttribute('aria-label', `${l} +`);
  }
}
knobs.focus = new Knob($('knobs'), 'focus', ['FOCUS', 'ENFOQUE'], ['make it sharp', 'que se vea nítido'], '#3b82f6');
knobs.mag = new Knob($('knobs'), 'mag', ['ZOOM', 'ZOOM'], ['bigger / smaller', 'más grande / más chico'], '#ff8a1f');
knobs.intensity = new Knob($('knobs'), 'intensity', ['BRIGHT', 'BRILLO'], ['more electrons', 'más electrones'], '#ffd23f');

// joystick: drag the ball; it springs back
{
  const joy = $('joy'), ball = joy.querySelector('b'); let on = false;
  const move = (e) => { const r = joy.getBoundingClientRect(); let x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } S.joy = [x, y]; ball.style.transform = `translate(${x * 34}%, ${y * 34}%)`; };
  joy.addEventListener('pointerdown', (e) => { on = true; joy.setPointerCapture(e.pointerId); move(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => on && move(e));
  const end = () => { on = false; S.joy = [0, 0]; ball.style.transform = ''; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
}

// the screen itself: drag to move, wheel / pinch to zoom, double-click to zoom in there
{
  const pts = new Map(); let pinch = null;
  const world = (e) => { const r = canvas.getBoundingClientRect(), v = view(); return [v.cx + ((e.clientX - r.left) / r.width - 0.5) * v.fov, v.cy + ((e.clientY - r.top) / r.height - 0.5) * v.fov]; };
  canvas.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture(e.pointerId); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const r = canvas.getBoundingClientRect(), v = view();
    if (pts.size === 1) { v.cx -= ((e.clientX - p[0]) / r.width) * v.fov; v.cy -= ((e.clientY - p[1]) / r.height) * v.fov; clampView(); dirty = true; S.idle = 0; }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomBy(d / pinch); pinch = d; glow('lensZoom'); }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.pow(1.0015, -e.deltaY), world(e)); glow('lensZoom'); S.idle = 0; }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { zoomBy(2, world(e)); glow('lensZoom'); });
}

// ------------------------------------------------------------------ missions
const near = (x, y, r) => { const v = view(); return Math.hypot(v.cx - x, v.cy - y) < r; };
const SP = Object.fromEntries(SPECIMENS.map((s, i) => [s.id, i]));
const QUESTS = [
  { id: 'beam', check: () => S.beam, hint: () => QT.beam.hints[0] },
  { id: 'focus', spec: 'pollen', check: () => S.si === SP.pollen && S.beam && sharpness() > 0.85, hold: 0.5,
    hint: () => QT.focus.hints[sharpness() > 0.4 ? 0 : 1] },
  { id: 'spikes', spec: 'pollen',
    target: () => { const g = SPECIMENS[SP.pollen].grains[0]; return [g.x + g.r * 0.9, g.y - g.r * 0.45]; },
    snap: () => { const v = view(); if (v.fov > 14000) return 'zoom'; return SPECIMENS[SP.pollen].grains.some((g) => { const d = Math.hypot(v.cx - g.x, v.cy - g.y); return d > g.r * 0.7 && d < g.r * 1.3; }) ? true : 'aim'; },
  },
  { id: 'virus', spec: 'bugs',
    target: () => { const p = SPECIMENS[SP.bugs].phages.find((q) => q.landed && !q.empty); return [p.hx, p.hy]; },
    snap: () => { const v = view(); if (v.fov > 1600) return 'zoom'; return SPECIMENS[SP.bugs].phages.some((p) => near(p.hx, p.hy, Math.max(220, v.fov * 0.3))) ? true : 'aim'; },
  },
  { id: 'atoms', spec: 'gold',
    target: () => [0, 0],
    snap: () => { const v = view(); if (v.fov > 9) return 'zoom'; return SPECIMENS[SP.gold].parts.some((p) => p.zone && near(p.x, p.y, p.d / 2)) ? true : 'aim'; },
  },
  { id: 'odd', spec: 'graphene',
    target: () => SPECIMENS[SP.graphene].si,
    snap: () => { const v = view(), s = SPECIMENS[SP.graphene].si; if (v.fov > 5) return 'zoom'; return near(s[0], s[1], v.fov * 0.3) ? true : 'aim'; },
  },
].map((q) => ({ ...QT[q.id], ...q }));
let qHold = 0;
const current = () => QUESTS.find((q) => !S.done.has(q.id));
function showQuest() {
  const q = current();
  $('badges').innerHTML = QUESTS.map((x) => `<span class="${S.done.has(x.id) ? 'got' : x === q ? 'now' : ''}" title="${tr(x.title)}">${S.done.has(x.id) ? x.icon : x === q ? '❓' : '•'}</span>`).join('');
  if (!q) { $('qTitle').textContent = tr(['🏆 Electron Explorer!', '🏆 ¡Explorador de Electrones!']); $('qText').innerHTML = tr(['You finished every mission. Explore anything you like, and fill your sticker book!', 'Completaste todas las misiones. ¡Explora lo que quieras y llena tu álbum de stickers!']); $('hintBtn').hidden = true; $('loadBtn').hidden = true; return; }
  $('qTitle').textContent = `${q.icon} ${tr(q.title)}`; $('qText').innerHTML = tr(q.text); $('hintBtn').hidden = false;
  const wrong = q.spec && SP[q.spec] !== S.si;
  $('loadBtn').hidden = !wrong; if (wrong) { const t = SPECIMENS[SP[q.spec]]; $('loadBtn').textContent = `${t.icon} ${tr([`Load ${t.name[0].toLowerCase()}`, `Cargar ${t.name[1].toLowerCase()}`])}`; }
}
function hint() {
  const q = current(); S.idle = 0;
  if (!q) { say(T.noMore); return; }
  if (q.id !== 'beam' && !S.beam) { say(T.beamFirstQuest, 'worry'); return; }
  if (q.spec && SP[q.spec] !== S.si) { say(needsSample(SPECIMENS[SP[q.spec]].name)); return; }
  S.hint = true; setTimeout(() => (S.hint = false), 9000);
  if (q.hint) { say(q.hint()); return; }
  const v = view(), [tx, ty] = q.target(), far = Math.hypot(v.cx - tx, v.cy - ty) > v.fov * 0.3;
  const r = q.snap();
  if (far && r !== true) say(T.followArrow);
  else if (r === 'zoom') say(T.zoomCloser);
  else if (sharpness() < 0.75) say(T.focusIt);
  else say(T.snapNow);
}
function complete(q, img, stars) {
  S.done.add(q.id); fanfare();
  $('wTitle').textContent = `${q.icon} ${tr(q.title)}`; $('wText').innerHTML = tr(q.win);
  $('wImg').hidden = !img; if (img) { $('wImg').src = img; $('wImg').alt = tr([`Your picture for ${q.title[0]}`, `Tu foto para ${q.title[1]}`]); }
  $('wStars').textContent = stars ? '⭐'.repeat(stars) + '☆'.repeat(3 - stars) : '⭐⭐⭐';
  const cf = $('confetti'); cf.innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 0.8).toFixed(2)}s;--c:${['#ff6b9a', '#ffd23f', '#3b82f6', '#22c55e', '#8b5cf6', '#ff8a1f'][i % 6]};--r:${Math.random() * 360}deg"></i>`).join('');
  const nx = current(); $('winDlg').querySelector('.go').textContent = tr(nx ? ['Next mission ▶', 'Siguiente misión ▶'] : ['Keep exploring ▶', 'Sigue explorando ▶']);
  // a mission finished by a snap: the picture still goes into the sticker book first
  $('winDlg').showModal(); if (img) say(cat(T.snapped, q.win), 'wow', [T.snapped, q.win]); else say(q.win, 'wow'); showQuest();
}
$('winDlg').addEventListener('close', () => { const q = current(); if (q) { say(cat(nextMission(q.title), q.text), 'happy', [nextMission(q.title), q.text]); if (q.spec && SP[q.spec] !== S.si) setSample(SP[q.spec], true); showQuest(); } });

function checkQuests(dt) {
  const q = current(); if (!q || !q.check) return;
  if (q.check()) { qHold += dt; if (qHold >= (q.hold ?? 0)) { qHold = 0; complete(q, null, 0); } } else qHold = 0;
}

// ------------------------------------------------------------------ snapshots and the sticker book
function snap() {
  S.idle = 0;
  if (!S.beam) { say(T.snapDark, 'worry'); tone(200, 0.2, 'square', 0.1); return; }
  noiseBurst(0.09, 3200, 0.6); setTimeout(() => noiseBurst(0.07, 2200, 0.4), 90);
  const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  const sh = sharpness(), v = vobj(), sp = spec();
  const cooked = S.burns[S.si].some((b) => b.amt > 0.3 && Math.hypot(b.x - v.cx, b.y - v.cy) < b.r);
  const stars = 1 + (sh > 0.8 ? 1 : 0) + (S.bright >= 0.3 && S.bright <= 0.75 && !cooked ? 1 : 0);
  // a round sticker
  const c = document.createElement('canvas'); c.width = c.height = 360; const g = c.getContext('2d');
  g.beginPath(); g.arc(180, 180, 176, 0, TAU); g.clip(); g.drawImage(canvas, 0, 0, 360, 360);
  g.lineWidth = 10; g.strokeStyle = '#fff'; g.stroke();
  const img = c.toDataURL('image/png');
  const mm = canvas.getBoundingClientRect().width * 0.2646 || 150;
  S.snaps.push({ img, sp: sp.name, icon: sp.icon, what: sp.what(v), fov: v.fov, mag: (mm * 1e6) / v.fov, stars, n: S.snaps.length + 1 });
  $('bookCount').textContent = S.snaps.length; $('bookBtn').classList.remove('bump'); void $('bookBtn').offsetWidth; $('bookBtn').classList.add('bump');
  const q = current();
  if (q?.snap && SP[q.spec] === S.si) {
    const r = q.snap();
    if (r === true && sh < 0.6) { say(cat(T.snapped, T.snapBlurry), 'worry', [T.snapped, T.snapBlurry]); return; }
    if (r === true) { complete(q, img, stars); return; }
    const fb = r === 'zoom' ? T.snapZoom : T.snapAim;
    say(cat(T.snapped, fb), 'happy', [T.snapped, fb]);
    return;
  }
  const tip = stars < 3 ? (sh <= 0.8 ? T.tipFocus : T.tipLight) : '';
  say(cat('⭐'.repeat(stars), T.snapped, tip), 'happy', [T.snapped, tip]);
}
function openBook() {
  const box = $('stickers'); $('bookEmpty').hidden = S.snaps.length > 0;
  box.innerHTML = S.snaps.map((s) => `<figure><a href="${s.img}" download="electron-explorer-${s.n}.png" title="${tr(['Download', 'Descargar'])}"><img src="${s.img}" alt="${s.icon} ${tr(s.what)}"></a>
    <figcaption><b>${s.icon} ${tr(s.sp)}</b><span>${tr(s.what)}</span><span>×${fmtMag(s.mag)} · ${fmtLen(s.fov)} ${tr(['wide', 'de ancho'])}</span><span class="st">${'⭐'.repeat(s.stars)}</span></figcaption></figure>`).join('');
  $('bookDlg').showModal();
}
$('bookBtn').addEventListener('click', openBook);

// ------------------------------------------------------------------ the Console dialog
function openConsole() { con.render($('consoleBody')); $('consoleDlg').showModal(); }
$('consoleBtn').addEventListener('click', openConsole);
con.onChange = () => {
  $('consoleDot').hidden = !con.pad;
  $('cstat').innerHTML = con.pad ? `<b class="live">● ${shortName(con.pad.id)}</b> ${tr(['connected', 'conectada'])}` : tr(['On screen · <button class="link" id="plugBtn2">plug in a real one</button>', 'En pantalla · <button class="link" id="plugBtn2">conecta una de verdad</button>']);
  $('plugBtn2')?.addEventListener('click', openConsole);
  if ($('consoleDlg').open) con.render($('consoleBody'));
};

// ------------------------------------------------------------------ wiring
function samplesAndLadder() {
  $('samples').innerHTML = SPECIMENS.map((s, i) => `<button role="radio" aria-checked="${i === S.si}" data-i="${i}"><span>${s.icon}</span>${tr(s.name)}</button>`).join('');
  $('ladder').innerHTML = THINGS.map((t) => `<div class="rung" style="top:${ladderPos(t.size)}%"><span>${t.icon}</span>${tr(t.name)}<small>${fmtLen(t.size)}</small></div>`).join('') + `<div class="mark" id="ladMark"><span>${tr(['your screen', 'tu pantalla'])}</span></div>`;
}
samplesAndLadder();
$('samples').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSample(+b.dataset.i); });
$('beamBtn').addEventListener('click', () => consoleApi.button('pause'));
$('snapBtn').addEventListener('click', snap);
$('prevBtn').addEventListener('click', () => setSample(S.si - 1));
$('nextBtn').addEventListener('click', () => setSample(S.si + 1));
$('whatBtn').addEventListener('click', whatsThis);
$('hintBtn').addEventListener('click', hint);
$('loadBtn').addEventListener('click', () => { const q = current(); if (q?.spec) setSample(SP[q.spec]); });
document.querySelectorAll('[data-pal]').forEach((b) => b.addEventListener('click', () => setPal(b.dataset.pal)));
$('soundBtn').addEventListener('click', () => { S.sound = !S.sound; $('soundBtn').setAttribute('aria-pressed', S.sound); if (!S.sound) { A.ctx?.suspend?.(); speechSynthesis?.cancel?.(); } else { audio(); A.ctx?.resume?.(); } });
$('readBtn').addEventListener('click', () => { S.read = !S.read; $('readBtn').setAttribute('aria-pressed', S.read); if (S.read) say(last.msg, last.mood, last.parts); else Voice.stop(); });
// Zip's voice: a girl's or a boy's (each language has its own pair of recorded voices)
function voiceLabel() {
  $('voiceIcon').textContent = S.voice === 'male' ? '👦' : '👧';
  $('voiceTxt').textContent = tr(S.voice === 'male' ? ['Boy voice', 'Voz de niño'] : ['Girl voice', 'Voz de niña']);
  $('voiceBtn').setAttribute('aria-label', `${tr(['Zip\'s voice', 'La voz de Zip'])}: ${$('voiceTxt').textContent} (${VOICES[lang][S.voice].name})`);
}
$('voiceBtn').addEventListener('click', () => {
  S.voice = S.voice === 'male' ? 'female' : 'male'; store('kids-voice', S.voice); voiceLabel();
  if (S.sound) Voice.speak([HELLO]); // let them hear the new voice
});
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
onLang(() => {
  Voice.stop(); samplesAndLadder(); voiceLabel(); showQuest(); con.onChange();
  Object.values(knobs).forEach((k) => k.text());
  bubble.innerHTML = tr(last.msg); dirty = true;
});
document.querySelectorAll('#column .part').forEach((p) => {
  const go = () => { say(PARTS[p.dataset.part], 'wow'); p.classList.add('hot'); setTimeout(() => p.classList.remove('hot'), 600); tone(660, 0.08, 'triangle', 0.15); };
  p.addEventListener('click', go); p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
});

// fun facts as you zoom
function facts() {
  const sp = spec(), v = view(), seen = S.facts[S.si];
  if (!S.beam || performance.now() - sayT < 4500) return;
  for (const [f, t] of FACTS[sp.id] ?? []) if (v.fov < f && !seen.has(f)) { seen.add(f); say(t, 'wow'); return; }
}

// ------------------------------------------------------------------ hint arrow / target ring
function pointer() {
  const q = current(), arrow = $('arrow'), ring = $('target');
  if (!S.hint || !q?.target || SP[q.spec] !== S.si || !S.beam) { arrow.hidden = true; ring.hidden = true; return; }
  const v = view(), [tx, ty] = q.target(), dx = (tx - v.cx) / v.fov, dy = (ty - v.cy) / v.fov, d = Math.hypot(dx, dy);
  if (d > 0.38) { arrow.hidden = false; ring.hidden = true; arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`; }
  else { arrow.hidden = true; ring.hidden = false; ring.style.left = `${(0.5 + dx) * 100}%`; ring.style.top = `${(0.5 + dy) * 100}%`; }
}

// ------------------------------------------------------------------ beam damage, nags and the kiosk reset
function damage(dt) {
  const sp = spec(); let rate = 0;
  if (S.beam && sp.soft && S.bright > 0.74) {
    const v = view(); rate = ((S.bright - 0.74) / 0.26) * 0.3;
    const r = (spot() * v.fov) / 2, list = S.burns[S.si];
    let b = list.find((q) => Math.hypot(q.x - v.cx, q.y - v.cy) < r * 0.4 && q.r / r > 0.6 && q.r / r < 1.6);
    if (!b) { b = { x: v.cx, y: v.cy, r, amt: 0, seed: (Math.random() * 1e9) | 0 }; list.push(b); if (list.length > 60) list.shift(); }
    b.amt = Math.min(1, b.amt + rate * dt); dirty = true;
    if (b.amt > 0.65) nag('cooked', T.cooked, 'worry', 15000);
    else if (b.amt > 0.15) nag('toasty', T.toasty, 'worry', 15000);
  }
  if (A.sizzle && A.ctx) A.sizzle.gain.setTargetAtTime(rate * 0.12, A.ctx.currentTime, 0.1);
  if (S.beam && S.bright < 0.2) nag('dark', T.dark, 'worry', 20000);
  if (S.beam && !sp.soft && S.bright > 0.88) nag('bright', T.bright, 'worry', 20000);
}
function kiosk(dt) {
  if (!KIOSK) return;
  S.idle += dt;
  if (S.idle > 180) {
    S.idle = 0; S.done.clear(); S.snaps = []; $('bookCount').textContent = 0; S.views = SPECIMENS.map((sp) => ({ ...sp.start })); S.burns = SPECIMENS.map(() => []); S.facts = SPECIMENS.map(() => new Set());
    S.bright = 0.5; setBeam(false); setPal('color'); setSample(0, true); for (const d of document.querySelectorAll('dialog[open]')) d.close();
    say(cat(HELLO, HELLO_START), 'happy', [HELLO, HELLO_START]);
  }
}
['pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, () => (S.idle = 0), { passive: true }));

// ------------------------------------------------------------------ loop
let t0 = performance.now();
// one tick of the exhibit (exported, with the state, so tests can run it without a visible tab)
export function step(dt) {
  con.poll(dt);
  if (S.joy[0] || S.joy[1]) stage(S.joy[0], S.joy[1], dt);
  damage(dt);
  if (dirty) drawSpecimen();
  composite(); readouts(); column(dt); pointer(); checkQuests(dt); facts(); kiosk(dt);
  if ($('consoleDlg').open) con.live($('cLive'));
}
function frame(t) { step(Math.min(0.1, (t - t0) / 1000)); t0 = t; requestAnimationFrame(frame); }
export { S, SPECIMENS };
applyStatic(); voiceLabel(); con.onChange(); say(HELLO);
setSample(0, true); setPal('color'); showQuest();
requestAnimationFrame(frame);
