// Ruska 1933: the instrument state, its live physics, the control panel, the missions and the plates.
// Every visible string is [English, German]; tr() picks the current language (i18n.js).
import { INSTRUMENTS, optics, blur, ruskaD, mtf, screenBrightness, heating, relV, focusCurrent } from './optics.js';
import { SPECIMENS, cover, onDiatom } from './specimens.js';
import { createScreen } from './screen.js';
import { Knob, Pad, Gauge } from './ui.js';
import { PARTS, CONTROLS } from './texts.js';
import { lang, tr, num, fmtInt, applyStatic, setLang, onLang } from './i18n.js';
import { Console } from './console.js';

const $ = (id) => document.getElementById(id);
const fmtLen = (nm) => nm >= 1e6 ? `${num(nm / 1e6, nm >= 1e7 ? 0 : 1)} mm` : nm >= 1e3 ? `${num(nm / 1e3, nm >= 1e4 ? 0 : 1)} µm` : nm >= 1 ? `${num(nm, nm >= 100 ? 0 : 1)} nm` : `${num(nm * 1000, 0)} pm`;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const sgn = (x, d) => `${x >= 0 ? '+' : '−'}${num(Math.abs(x), d)}`;
const E0 = 0.7;          // plate exposure (brightness × s) for a good density
const PLATES = 8;        // plates per cassette

// ------------------------------------------------------------------ state
const S = {
  inst: 1933, spec: 'mesh', view: 'final',
  pump: false, logP: 3, vent: 0,
  hvSet: 0, kV: 0, q: 0, qSaved: 0.5, c: 0, oc: 0.97, of: 0, p: 0.6, magnet: [0, 0],
  stage: [0, 0], drift: [0, 0], driftDir: Math.random() * 6.283,
  hvDrift: 0, T: 20, burst: 0, burstT: 0, bumpT: 99, bumpA: 0, bumpPh: [0, 0], flick: 0,
  exposing: false, exp: null, plates: [], platesLeft: PLATES, plateNo: 0,
  dmg: {}, dmgDirty: 0, time: 0,
};
let D = {};                  // derived each frame, read by the missions and the panel
let mission = null, stepI = 0, done = new Set(), finished = new Set();
let noteKey = null, coachMsg = null;

// ------------------------------------------------------------------ screen
const canvas = $('screen');
let scr = null;
try { scr = createScreen(canvas); } catch (e) { console.error(e); }
if (!scr) $('ovMsg').textContent = tr(['This browser cannot draw the screen (WebGL 2 is needed).', 'Dieser Browser kann den Schirm nicht zeichnen (WebGL 2 wird benötigt).']);
const dmgBytes = new Uint8Array((scr?.DN || 256) ** 2 * 2);
function damageOf(key) { const N = scr?.DN || 256; return (S.dmg[key] ||= new Float32Array(N * N * 2)); }

// ------------------------------------------------------------------ sound (built on the first user gesture)
const Snd = { on: true, ctx: null };
function audio() {
  if (Snd.ctx || !Snd.on) return Snd.ctx;
  try {
    const ctx = new AudioContext(); Snd.ctx = ctx; const out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination); Snd.out = out;
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; const pg = ctx.createGain(); pg.gain.value = 0;
    noise.connect(lp).connect(pg).connect(out); noise.start(); Snd.pump = pg; Snd.pumpF = lp;
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 100; const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 420;
    const hg = ctx.createGain(); hg.gain.value = 0; hum.connect(hf).connect(hg).connect(out); hum.start(); Snd.hum = hg;
    Snd.noiseBuf = nb;
  } catch { Snd.ctx = null; }
  return Snd.ctx;
}
function crack(len = 0.35, gain = 0.9) {
  const ctx = audio(); if (!ctx) return;
  const src = ctx.createBufferSource(); src.buffer = Snd.noiseBuf; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
  const g = ctx.createGain(); const t = ctx.currentTime; g.gain.setValueAtTime(0, t);
  for (let i = 0; i < 9; i++) g.gain.setValueAtTime(gain * Math.random(), t + (i / 9) * len);
  g.gain.linearRampToValueAtTime(0, t + len + 0.05); src.connect(hp).connect(g).connect(Snd.out); src.start(t, Math.random()); src.stop(t + len + 0.1);
}
function click() { const ctx = audio(); if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 180; const t = ctx.currentTime; g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); o.connect(g).connect(Snd.out); o.start(t); o.stop(t + 0.1); }
addEventListener('pointerdown', () => { audio(); Snd.ctx?.resume?.(); }, { passive: true });

// ------------------------------------------------------------------ the control panel
const panel = $('panel');
const K = {};
let gauge, pad;
function group(title, stateId) {
  const g = document.createElement('div'); g.className = 'grp';
  g.innerHTML = `<header><h3>${tr(title)}<small>${lang === 'de' ? '' : title[1]}</small></h3><span class="state" id="${stateId}"></span></header>`;
  panel.appendChild(g); return g;
}
function info(key) { return () => showNote(key); }
function setPump(on) { S.pump = on; $('pumpBtn')?.setAttribute('aria-pressed', on); click(); }
function vent() { S.pump = false; $('pumpBtn')?.setAttribute('aria-pressed', false); S.vent = 1; click(); }
function buildPanel() {
  panel.innerHTML = '';
  const I = INSTRUMENTS[S.inst], c33 = I.condenser;
  // vacuum
  const gv = group(['Vacuum', 'Vakuum'], 'stVac');
  const r = document.createElement('div'); r.className = 'row2'; gv.appendChild(r);
  const sw = document.createElement('button'); sw.className = 'sw'; sw.id = 'pumpBtn'; sw.innerHTML = `<i></i>${tr(['Pumps', 'Pumpen'])}`; sw.setAttribute('aria-pressed', S.pump);
  sw.onclick = () => setPump(!S.pump); sw.onfocus = sw.onpointerenter = info('pump'); r.appendChild(sw);
  const vb = document.createElement('button'); vb.className = 'btn2'; vb.id = 'ventBtn'; vb.textContent = tr(['Let air in', 'Belüften']);
  vb.onclick = vent; vb.onfocus = vb.onpointerenter = info('vent'); r.appendChild(vb);
  const gw = document.createElement('div'); gw.className = 'gauge'; gv.appendChild(gw); gauge = new Gauge(gw);
  const gp = document.createElement('p'); gp.innerHTML = '<b id="pTxt"></b><span id="pPhase"></span>'; gw.appendChild(gp);
  // source and high voltage
  const gs = group(['Discharge tube', 'Entladungsrohr'], 'stHV');
  const ks = document.createElement('div'); ks.className = 'knobs'; gs.appendChild(ks);
  K.hv = new Knob(ks, { id: 'hv', label: tr(['High voltage', 'Hochspannung']), min: 0, max: I.kVmax, value: S.hvSet, fmt: (v) => `${num(v, 1)} kV`, onInput: (v) => (S.hvSet = v), onFocus: info('hv') });
  K.q = new Knob(ks, { id: 'q', label: tr(['Discharge current', 'Röhrenstrom']), min: 0, max: 1, value: S.q, fmt: (v) => `${num(1.5 * v, 2)} mA`, onInput: (v) => (S.q = v), onFocus: info('q') });
  // coils
  const gc = group(['Coils', 'Spulen'], 'stLens');
  const kc = document.createElement('div'); kc.className = 'knobs'; gc.appendChild(kc);
  K.c = c33 ? new Knob(kc, { id: 'c', label: tr(['Condenser', 'Kondensor']), min: 0, max: 1, value: S.c, fmt: (v) => `${num(v * 100, 0)} %`, onInput: (v) => (S.c = v), onFocus: info('c') }) : null;
  K.oc = new Knob(kc, { id: 'oc', label: tr(c33 ? ['Objective coarse', 'Objektiv grob'] : ['Coil 1 coarse', 'Spule 1 grob']), min: I.oc[0], max: I.oc[1], value: S.oc, fmt: (v) => `${num(v * 100, 1)} %`, onInput: (v) => (S.oc = v), onFocus: info('oc') });
  K.of = new Knob(kc, { id: 'of', label: tr(c33 ? ['Objective fine', 'Objektiv fein'] : ['Coil 1 fine', 'Spule 1 fein']), min: I.of[0], max: I.of[1], value: S.of, fmt: (v) => sgn(v * 1e4, 1), onInput: (v) => (S.of = v), onFocus: info('of') });
  K.p = new Knob(kc, { id: 'p', label: tr(c33 ? ['Projector', 'Projektion'] : ['Coil 2', 'Spule 2']), min: I.p[0], max: I.p[1], value: S.p, fmt: (v) => `${num(v * 100, 0)} %`, onInput: (v) => (S.p = v), onFocus: info('p') });
  // specimen
  const go = group(c33 ? ['Object-change chamber', 'Objektwechselkammer'] : ['Specimen', 'Objekt'], 'stSpec');
  const ch = document.createElement('div'); ch.className = 'chips'; ch.id = 'specChips'; go.appendChild(ch);
  for (const k of I.specimens) { const s = SPECIMENS[k]; const b = document.createElement('button'); b.dataset.spec = k; b.innerHTML = `${tr(s.name)}<small>${s.year}</small>`; b.setAttribute('aria-pressed', S.spec === k);
    b.onclick = () => setSpecimen(k); b.onfocus = b.onpointerenter = () => showNote('spec:' + k); ch.appendChild(b); }
  const fresh = document.createElement('button'); fresh.className = 'link'; fresh.textContent = tr(['Load a fresh piece (lets air in)', 'Frisches Stück einsetzen (belüftet)']); fresh.style.marginTop = '10px';
  fresh.onclick = () => { S.dmg[S.spec] = null; S.stage = [...SPECIMENS[S.spec].start]; S.drift = [0, 0]; vent(); };
  go.appendChild(fresh);
  if (I.magnet) {
    const sb = document.createElement('div'); sb.className = 'stagebox'; go.appendChild(sb);
    pad = new Pad(sb, { range: 240, x: S.magnet[0], y: S.magnet[1], onInput: (x, y) => (S.magnet = [x, y]), onFocus: info('magnet') });
    const p = document.createElement('p'); p.innerHTML = tr(['<b style="color:var(--fg);font-weight:500">Hand magnet.</b> Earth’s field bends the beam off the axis. Push it back with a steel magnet held against the column.', '<b style="color:var(--fg);font-weight:500">Handmagnet.</b> Das Erdfeld biegt den Strahl von der Achse. Holen Sie ihn mit einem Stahlmagneten an der Säule zurück.']); sb.appendChild(p);
  } else pad = null;
  // plate camera
  const gk = group(['Plate camera', 'Aufnahmekammer'], 'stPlate');
  const ex = document.createElement('button'); ex.className = 'expose'; ex.id = 'expose'; ex.setAttribute('aria-pressed', S.exposing);
  ex.innerHTML = `<span>${S.exposing ? tr(['Close the shutter', 'Verschluss schließen']) : tr(['Expose a plate', 'Platte belichten'])}</span><small id="expHint"></small>`; ex.onclick = toggleExposure; ex.onfocus = ex.onpointerenter = info('expose'); gk.appendChild(ex);
  const dn = document.createElement('div'); dn.className = 'density'; dn.innerHTML = `<span id="plLeft"></span><button class="link" id="reload" hidden>${tr(['Reload the cassette (lets air in)', 'Kassette nachladen (belüftet)'])}</button>`; gk.appendChild(dn);
  $('reload').onclick = () => { S.platesLeft = PLATES; vent(); };
}

function setSpecimen(k) {
  if (!INSTRUMENTS[S.inst].specimens.includes(k)) return;
  S.spec = k; S.stage = [...SPECIMENS[k].start]; S.drift = [0, 0]; S.T = Math.min(S.T, 60); click();
  document.querySelectorAll('#specChips button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.spec === k));
  showNote('spec:' + k);
}

// ------------------------------------------------------------------ explanations
function label(key) {
  if (key?.startsWith('spec:')) { const s = SPECIMENS[key.slice(5)]; return { title: tr(s.name), sub: `${tr(s.de)} · ${s.year}`, body: tr(s.info) }; }
  const t = PARTS[key] || CONTROLS[key]; return t ? { title: tr(t.title), sub: tr(t.sub), body: tr(t.body) } : null;
}
function showNote(key) {
  const t = label(key); if (!t) return;
  noteKey = key;
  $('note').innerHTML = `<p class="de">${t.sub || ''}</p><h3>${t.title}</h3><p>${t.body}</p><p class="live" id="noteLive"></p>`;
  liveNote();
}
function liveNote() {
  const e = $('noteLive'); if (!e || !D.op) return;
  const op = D.op, k = noteKey, de = lang === 'de';
  const dz = `${sgn(op.dz, 2)} µm`, rot = num(((op.rot * 180) / Math.PI) % 360, 0);
  const lines = {
    hv: de ? `Jetzt ${num(D.kV, 2)} kV, Welligkeit ±${num(D.delta * 1e4, 1)}×10⁻⁴ · λ = ${num(op.lambda, 2)} pm` : `Now ${num(D.kV, 2)} kV, ripple ±${num(D.delta * 1e4, 1)}×10⁻⁴ · λ = ${num(op.lambda, 2)} pm`,
    q: de ? `Strahl ${num(D.I, 2)} mA · Spannung um ${num(S.hvSet - D.kVnom, 2)} kV heruntergezogen` : `Beam ${num(D.I, 2)} mA · voltage pulled down by ${num(S.hvSet - D.kVnom, 2)} kV`,
    discharge: de ? `Strahl ${num(D.I, 2)} mA bei ${num(D.kV, 1)} kV` : `Beam ${num(D.I, 2)} mA at ${num(D.kV, 1)} kV`,
    c: de ? `Fleck auf dem Objekt: Radius ${fmtLen(op.rs * 1e3)} · Strahlwinkel ${num(op.alphaIll * 1e3, 1)} mrad` : `Spot on the specimen ${fmtLen(op.rs * 1e3)} (radius) · beam angle ${num(op.alphaIll * 1e3, 1)} mrad`,
    condenser: de ? `Fleck ${fmtLen(op.rs * 1e3)} · Objekt ${num(D.T, 0)} °C` : `Spot ${fmtLen(op.rs * 1e3)} · specimen ${num(D.T, 0)} °C`,
    oc: de ? `Objektiv f = ${num(op.fo, 3)} mm · Defokus ${dz}` : `Objective f = ${num(op.fo, 3)} mm · defocus ${dz}`,
    of: de ? `Defokus ${dz} → Unschärfe ${fmtLen(D.b.parts.focus * 5.12)}` : `Defocus ${dz} → blur ${fmtLen(D.b.parts.focus * 5.12)}`,
    objective: `f = ${num(op.fo, 3)} mm · ${num(op.Mo, 1)}× · ${de ? 'Defokus' : 'defocus'} ${dz}`,
    p: de ? `Projektiv f = ${num(op.fp, 2)} mm · ${num(op.Mp, 1)}× · gesamt ${fmtInt(op.M)}× · Bild um ${rot}° gedreht` : `Projector f = ${num(op.fp, 2)} mm · ${num(op.Mp, 1)}× · total ${fmtInt(op.M)}× · image turned ${rot}°`,
    projector: `f = ${num(op.fp, 2)} mm · ${num(op.Mp, 1)}× · ${de ? 'gesamt' : 'total'} ${fmtInt(op.M)}×`,
    pump: D.pTxt, vent: D.pTxt,
    magnet: de ? `Strahl ${num(Math.hypot(...op.beamOff), 0)} µm neben der Achse` : `Beam ${num(Math.hypot(...op.beamOff), 0)} µm off the axis`,
    expose: D.g > 0 ? (de ? `Etwa ${num(E0 / D.g, 1)} s für eine gute Platte bei dieser Helligkeit` : `About ${num(E0 / D.g, 1)} s for a good plate at this brightness`) : tr(['No light on the screen', 'Kein Licht auf dem Schirm']),
    chamber: `${de ? 'Objekt' : 'Specimen'} ${num(D.T, 0)} °C`, coil1: `f = ${num(op.fo, 1)} mm · ${num(op.Mo, 2)}×`, coil2: `f = ${num(op.fp, 1)} mm · ${num(op.Mp, 2)}×`,
  };
  e.textContent = lines[k] || '';
}

// ------------------------------------------------------------------ screen interaction: drag moves the stage, wheel turns the projector
function moveView(dx, dy) { const c = Math.cos(-D.op.rot), s = Math.sin(-D.op.rot); S.stage[0] += c * dx - s * dy; S.stage[1] += s * dx + c * dy; }
{
  let last = null;
  canvas.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grab'); });
  canvas.addEventListener('pointermove', (e) => { if (!last || !D.op) return;
    const r = canvas.getBoundingClientRect(); const k = D.op.field / r.width;
    moveView(-(e.clientX - last[0]) * k, (e.clientY - last[1]) * k); last = [e.clientX, e.clientY]; });
  const up = () => { last = null; canvas.classList.remove('grab'); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); K.p.set(K.p.value - Math.sign(e.deltaY) * K.p.range * 0.015); }, { passive: false });
  canvas.tabIndex = 0;
}
function setView(v) {
  if (v === 'inter' && !INSTRUMENTS[S.inst].Lis) return;
  S.view = v; $('viewsel').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.view === v)); click();
}
$('viewsel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

// ------------------------------------------------------------------ plates
function toggleExposure() {
  if (S.exposing) return closeShutter();
  if (S.platesLeft <= 0) { coach(['The cassette is empty. Reload it: that means letting air into the column.', 'Die Kassette ist leer. Laden Sie nach: Dazu muss die Säule belüftet werden.'], true); return; }
  S.exposing = true; click();
  S.exp = { t: 0, E: 0, acc: new Float32Array(canvas.width * canvas.height), n: 0, s2: 0, path: [], M: 0, kV: 0 };
  $('expose').setAttribute('aria-pressed', 'true'); $('expose').firstChild.textContent = tr(['Close the shutter', 'Verschluss schließen']); $('shutter').hidden = false;
}
function accumulate(dt) {
  const ex = S.exp; if (!ex) return;
  const px = scr.read(), a = ex.acc;
  for (let i = 0, j = 1; i < a.length; i++, j += 4) a[i] += (px[j] / 255) * dt;
  if (S.burst > 0) ex.burst = true;
  ex.t += dt; ex.E += D.g * dt; ex.n++; ex.s2 += D.b.sigma ** 2 * dt; ex.M += D.op.M * dt; ex.kV += D.kV * dt;
  ex.path.push([D.imgPos[0], D.imgPos[1], dt]);
}
function closeShutter() {
  const ex = S.exp; S.exposing = false; S.exp = null; click();
  $('expose').setAttribute('aria-pressed', 'false'); $('expose').firstChild.textContent = tr(['Expose a plate', 'Platte belichten']); $('shutter').hidden = true;
  if (!ex || ex.t < 0.05) return;
  S.platesLeft--; S.plateNo++;
  // smear: how far the image wandered during the exposure (drift, pump bumps, stage moves), in nm rms
  let mx = 0, my = 0; for (const [x, y, w] of ex.path) { mx += x * w; my += y * w; } mx /= ex.t; my /= ex.t;
  let v = 0; for (const [x, y, w] of ex.path) v += ((x - mx) ** 2 + (y - my) ** 2) * w; v /= ex.t;
  const smear = Math.sqrt(v / 2) * 1e3;
  const sigma = Math.sqrt(ex.s2 / ex.t + smear * smear);
  const dens = ex.E / E0;
  const plate = {
    no: S.plateNo, inst: S.inst, spec: S.spec, kV: ex.kV / ex.t, M: ex.M / ex.t, t: ex.t, dens, sigma, smear, d: ruskaD(sigma),
    burst: !!ex.burst, densOk: dens > 0.55 && dens < 2.4, intact: D.destroyed < 0.5, onDiatom: onDiatom(D.beamPos[0], D.beamPos[1]), cover: D.cover, carbon: D.carbon,
  };
  plate.sharp = plate.d * plate.M * 1e-6 < 0.25;  // sharp to the eye on the plate: blur under ¼ mm
  plate.url = printPlate(ex.acc, plate);
  S.plates.unshift(plate); renderPlates();
  if (mission?.onPlate) mission.onPlate(plate);
}
function printPlate(acc, pl) {
  const W = canvas.width, H = canvas.height, c = document.createElement('canvas'); c.width = W; c.height = H + 44;
  const g = c.getContext('2d'); g.fillStyle = '#1a1714'; g.fillRect(0, 0, W, H + 44);
  // print density: the bright half of the field maps to mid-grey at a correct exposure (density 1)
  let mx = 0; for (let i = 0; i < acc.length; i++) if (acc[i] > mx) mx = acc[i];
  let sum = 0, n = 0; for (let i = 0; i < acc.length; i++) if (acc[i] > 0.1 * mx) { sum += acc[i]; n++; }
  const ref = (n ? sum / n : 1) / Math.max(pl.dens, 1e-3);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (H - 1 - y) * W + x, o = (y * W + x) * 4; // readPixels is bottom-up
    const dx = x / W * 2 - 1, dy = y / H * 2 - 1; const inside = dx * dx + dy * dy < 0.985;
    let v = inside ? 1 - Math.exp(-0.75 * acc[i] / ref) : 0;
    v = Math.pow(v, 0.9) * 0.96 + 0.03 * (inside ? Math.random() : 0);
    img.data[o] = 255 * v * 0.98 + 10; img.data[o + 1] = 255 * v * 0.93 + 8; img.data[o + 2] = 255 * v * 0.82 + 6; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#d9cdb6'; g.font = '500 17px "IBM Plex Mono", monospace';
  g.fillText(`Nr. ${pl.no}   ${num(pl.kV, 0)} kV   ${fmtInt(pl.M)}×   ${num(pl.t, 1)} s`, 14, H + 29);
  g.textAlign = 'right'; g.fillText(tr(SPECIMENS[pl.spec].name), W - 14, H + 29);
  return c.toDataURL('image/png');
}
function renderPlates() {
  const de = lang === 'de';
  $('plates').innerHTML = S.plates.map((p) => { const nm = tr(SPECIMENS[p.spec].name);
    const dens = p.dens < 0.55 ? tr(['thin', 'zu dünn']) : p.dens > 2.4 ? tr(['too dense', 'zu dicht']) : tr(['good density', 'gute Dichte']);
    return `<figure><img src="${p.url}" alt="${de ? 'Platte' : 'Plate'} ${p.no}: ${nm}, ${fmtInt(p.M)}×"><figcaption><b>Nr. ${p.no}</b> · ${nm}<br>${num(p.kV, 0)} kV · ${fmtInt(p.M)}× · ${num(p.t, 1)} s<br>${de ? 'löst' : 'resolves'} ${fmtLen(p.d)}${de ? ' auf' : ''} · ${dens}<br><a href="${p.url}" download="ruska-plate-${p.no}.png">${de ? 'Herunterladen' : 'Download'}</a></figcaption></figure>`; }).join('');
  const n = S.plates.length;
  $('platesInfo').textContent = n ? (de ? `${n} ${n > 1 ? 'Platten' : 'Platte'} in dieser Sitzung. Jede zeigt die Auflösung nach Ruskas Kantenmaß.` : `${n} plate${n > 1 ? 's' : ''} this session. Each shows the resolution by Ruska’s edge measure.`)
    : tr(['No plates yet. Expose one from the plate camera.', 'Noch keine Platten. Belichten Sie eine mit der Aufnahmekammer.']);
}

// ------------------------------------------------------------------ missions
const MISSIONS = [
  { id: 'm31', inst: 1931, year: ['7 April 1931', '7. April 1931'], title: ['The first two-stage image', 'Das erste zweistufige Bild'], spec: 'grid',
    intro: ['Max Knoll and Ernst Ruska’s cathode-ray tube with two short coils. Image a platinum grid through both coils at 50 kV, and get it onto a plate before the beam burns the grid.',
      'Max Knolls und Ernst Ruskas Kathodenstrahlrohr mit zwei kurzen Spulen. Bilden Sie ein Platinnetz bei 50 kV durch beide Spulen ab und bannen Sie es auf eine Platte, bevor der Strahl das Netz verbrennt.'],
    steps: [
      { text: ['Switch on the pumps and wait for the vacuum', 'Pumpen einschalten und auf das Vakuum warten'], hint: ['Press <b>Pumps</b>. Below 10⁻³ mbar the tube can hold the high voltage without a flashover.', 'Drücken Sie <b>Pumpen</b>. Unter 10⁻³ mbar hält das Rohr die Hochspannung ohne Überschlag.'], ctl: 'pumpBtn', done: () => D.logP < -3 },
      { text: ['Raise the high voltage to 50 kV', 'Hochspannung auf 50 kV bringen'], hint: ['Turn <b>High voltage</b> to about 50 kV (drag the knob up, or use the arrow keys).', 'Drehen Sie die <b>Hochspannung</b> auf etwa 50 kV (Knopf nach oben ziehen oder Pfeiltasten).'], ctl: 'hv', done: () => Math.abs(D.kV - 50) < 4 },
      { text: ['Open the discharge until the screen glows', 'Entladung aufdrehen, bis der Schirm leuchtet'], hint: ['Turn up the <b>Discharge current</b>. Electrons from the cold cathode light up the screen.', 'Drehen Sie den <b>Röhrenstrom</b> auf. Die Elektronen aus der kalten Kathode bringen den Schirm zum Leuchten.'], ctl: 'q', done: () => D.I > 0.3 && D.g > 0.12 },
      { text: ['Focus coil 1, then coil 2: a sharp grid at about 17×', 'Spule 1, dann Spule 2 scharfstellen: ein scharfes Netz bei etwa 17-fach'], hint: ['<b>Coil 2</b> sets the magnification (aim for 15–20×). Every time you change it, refocus <b>Coil 1</b> until the wires are sharp.', '<b>Spule 2</b> bestimmt die Vergrößerung (15- bis 20-fach). Nach jeder Änderung stellen Sie <b>Spule 1</b> nach, bis die Drähte scharf sind.'], ctl: 'oc', done: () => D.M >= 15 && D.M <= 21 && D.sharp },
      { text: ['Expose a plate before the grid burns', 'Eine Platte belichten, bevor das Netz verbrennt'], hint: ['Press <b>Expose a plate</b>, wait for the bar to fill, press again. Too much current and the grid melts: Ruska found grids were “burnt to cinders”.', 'Drücken Sie <b>Platte belichten</b>, warten Sie, bis der Balken voll ist, und drücken Sie erneut. Zu viel Strom, und das Netz schmilzt: Ruska berichtet, dass solche Netze völlig verbrannten.'], ctl: 'expose', plate: true },
    ],
    pass: (p) => p.M >= 15 && p.sharp && p.densOk && p.intact,
    fail: (p) => !p.intact ? ['The grid melted during the exposure. Lower the discharge current and try another plate.', 'Das Netz ist während der Belichtung geschmolzen. Senken Sie den Röhrenstrom und versuchen Sie eine neue Platte.'] : !p.densOk ? (p.dens < 0.55 ? ['The plate is too thin: leave the shutter open longer.', 'Die Platte ist zu dünn: Lassen Sie den Verschluss länger offen.'] : ['The plate is too dense: close the shutter sooner.', 'Die Platte ist zu dicht: Schließen Sie den Verschluss früher.']) : !p.sharp ? ['The plate is blurred. Refocus coil 1 and try again.', 'Die Platte ist unscharf. Stellen Sie Spule 1 nach und versuchen Sie es noch einmal.'] : ['Use about 17×: two stages, 3.6 × 4.8.', 'Nehmen Sie etwa 17-fach: zwei Stufen, 3,6 × 4,8.'],
    result: (p) => ({ title: ['The first two-stage electron image', 'Das erste zweistufige Elektronenbild'],
      text: [`Your plate shows the platinum grid at ${fmtInt(p.M)}×, magnified twice by two magnetic coils, the step Ruska took on 7 April 1931. The magnification is tiny, but the principle was new: electrons and magnetic fields can form an image in more than one stage, like glass lenses in a light microscope. Two years later he would reach 12,000×.`,
        `Ihre Platte zeigt das Platinnetz ${fmtInt(p.M)}-fach, zweimal vergrößert durch zwei Magnetspulen: der Schritt, den Ruska am 7. April 1931 tat. Die Vergrößerung ist winzig, aber das Prinzip war neu: Elektronen und Magnetfelder können ein Bild in mehr als einer Stufe erzeugen, wie Glaslinsen im Lichtmikroskop. Zwei Jahre später erreichte er die 12.000-fache Vergrößerung.`] }) },
  { id: 'm33', inst: 1933, year: ['November 1933', 'November 1933'], title: ['Beat the light microscope', 'Das Lichtmikroskop schlagen'], spec: 'mesh',
    intro: ['Ruska’s new column with pole-piece coils. Follow his own procedure from 1934: set up on the heat-proof measuring object, then swing in a cotton fibre and take a plate sharper than 200 nm.',
      'Ruskas neue Säule mit Polschuhspulen. Folgen Sie seinem eigenen Verfahren von 1934: Einstellen am wärmeunempfindlichen Meßobjekt, dann eine Baumwollfaser vorklappen und eine Platte aufnehmen, die schärfer ist als 200 nm.'],
    steps: [
      { text: ['Pump the column: fore pump, then mercury diffusion pump', 'Säule abpumpen: Vorpumpe, dann Quecksilber-Diffusionspumpe'], hint: ['Press <b>Pumps</b> and watch the gauge fall below 2×10⁻⁴ mbar.', 'Drücken Sie <b>Pumpen</b> und beobachten Sie, wie das Manometer unter 2×10⁻⁴ mbar fällt.'], ctl: 'pumpBtn', done: () => D.logP < -3.7 },
      { text: ['Set 75 kV and light the discharge on the measuring object', '75 kV einstellen und die Entladung am Meßobjekt zünden'], hint: ['Turn <b>High voltage</b> to 75 kV, then open the <b>Discharge current</b>.', 'Drehen Sie die <b>Hochspannung</b> auf 75 kV, dann den <b>Röhrenstrom</b> auf.'], ctl: 'hv', done: () => Math.abs(D.kV - 75) < 4 && D.I > 0.2 && S.spec === 'mesh' },
      { text: ['Intermediate screen: centre the beam with the hand magnet, then focus the objective', 'Zwischenbildschirm: Strahl mit dem Handmagneten zentrieren, dann das Objektiv scharfstellen'], hint: ['Switch the viewer to the <b>Intermediate screen</b>. Drag the <b>hand magnet</b> until the bright disc sits in the middle, then turn <b>Objective coarse</b> until the mesh is sharp.', 'Schalten Sie auf den <b>Zwischenbildschirm</b>. Ziehen Sie den <b>Handmagneten</b>, bis die helle Scheibe in der Mitte sitzt, dann drehen Sie <b>Objektiv grob</b>, bis das Netz scharf ist (Ruskas „Grobeinstellung“).'], ctl: 'viewsel', done: () => S.view === 'inter' && D.centered && D.dR < 4000 },
      { text: ['Final screen: turn the projector up until the image circle fills the window', 'Endbildschirm: Projektionsspule aufdrehen, bis der Bildkreis das Fenster füllt'], hint: ['Switch to the <b>Final screen</b> and turn <b>Projector</b> to the top. Ruska set the projector “so that the image circle is largest”.', 'Schalten Sie auf den <b>Endbildschirm</b> und drehen Sie die <b>Projektion</b> ganz auf. Ruska stellte den Projektionsspulenstrom so ein, „daß der Bildbegrenzungskreis am größten wird“.'], ctl: 'p', done: () => S.view === 'final' && S.p > 0.92 },
      { text: ['Swing in the cotton fibre and raise the illumination with the condenser', 'Baumwollfaser vorklappen und die Beleuchtung mit dem Kondensor steigern'], hint: ['Choose <b>Cotton fibre</b>, find a fibre (drag the screen), then turn up the <b>Condenser</b> carefully until the image is bright. Keep the beam centred with the magnet.', 'Wählen Sie die <b>Baumwollfaser</b>, suchen Sie eine Faser (Schirm ziehen) und drehen Sie den <b>Kondensor</b> vorsichtig auf, bis das Bild hell ist. Halten Sie den Strahl mit dem Magneten in der Mitte.'], ctl: 'specChips', done: () => S.spec === 'cotton' && D.cover > 0.5 && D.g > 0.06 && D.op.rs < 40 },
      { text: ['Fine-focus at 8,000× or more', 'Bei mindestens 8.000-fach fein scharfstellen'], hint: ['Use <b>Objective fine</b>, the second resistor in parallel with the coil. Watch the blur budget fall below the dashed light-microscope line.', 'Benutzen Sie <b>Objektiv fein</b>, den zweiten, zur Spule parallelen Widerstand. Beobachten Sie, wie die Unschärfe unter die gestrichelte Linie des Lichtmikroskops fällt.'], ctl: 'of', done: () => D.op.M >= 7500 && D.dR < 200 },
      { text: ['Expose a plate sharper than the light microscope', 'Eine Platte belichten, schärfer als das Lichtmikroskop'], hint: ['A hot fibre drifts and smears the plate. Keep the exposure short and steady; a little charring is fine (Ruska used it to thin his fibres).', 'Eine heiße Faser wandert und verwischt die Platte. Belichten Sie kurz und ruhig; etwas Verkohlung schadet nicht (Ruska machte seine Fasern so erst dünn genug).'], ctl: 'expose', plate: true },
    ],
    pass: (p) => p.spec === 'cotton' && p.M >= 5000 && p.d < 200 && p.densOk && p.intact,
    fail: (p) => p.spec !== 'cotton' ? ['Take the plate of the cotton fibre.', 'Nehmen Sie die Platte von der Baumwollfaser auf.'] : !p.intact ? ['The fibre burnt through during the exposure. Lower the current or open the condenser a little.', 'Die Faser ist während der Belichtung durchgebrannt. Senken Sie den Strom oder öffnen Sie den Kondensor etwas.'] : !p.densOk ? (p.dens < 0.55 ? ['Too thin: expose longer, or brighten with the condenser.', 'Zu dünn: länger belichten oder mit dem Kondensor aufhellen.'] : ['Too dense: close the shutter sooner.', 'Zu dicht: Verschluss früher schließen.'])
      : p.d >= 200 ? [`The plate resolves ${fmtLen(p.d)}: not yet better than light. ${p.smear > p.sigma * 0.6 ? 'The image moved during the exposure (drift or a pump bump).' : 'Refocus with the fine control.'}`, `Die Platte löst ${fmtLen(p.d)} auf: noch nicht besser als Licht. ${p.smear > p.sigma * 0.6 ? 'Das Bild hat sich während der Belichtung bewegt (Drift oder ein Pumpenstoß).' : 'Stellen Sie mit der Feinregulierung nach.'}`] : ['Magnify to at least 5,000×.', 'Vergrößern Sie mindestens 5.000-fach.'],
    result: (p) => ({ title: p.d < 60 ? ['As sharp as Ruska', 'So scharf wie Ruska'] : ['You beat the light microscope', 'Sie haben das Lichtmikroskop geschlagen'],
      text: [`Your plate of the cotton fibre resolves ${fmtLen(p.d)} at ${fmtInt(p.M)}× and ${num(p.kV, 0)} kV, measured the way Ruska did: twice the width of the dark-to-light zone at an edge. The best light microscope stops near 200 nm. Ruska’s plate at 8,000× gave 50 nm, the first time electrons showed what light cannot.`,
        `Ihre Platte der Baumwollfaser löst ${fmtLen(p.d)} auf, bei ${fmtInt(p.M)}-facher Vergrößerung und ${num(p.kV, 0)} kV, gemessen wie bei Ruska: doppelte Breite der Übergangszone von dunkel nach hell an einer Kante. Das beste Lichtmikroskop endet bei etwa 200 nm. Ruskas Platte bei 8.000-facher Vergrößerung ergab 50 nm: Zum ersten Mal zeigten Elektronen, was Licht nicht zeigen kann.`] }) },
  { id: 'm37', inst: 1933, year: ['1937', '1937'], title: ['The diatom test', 'Die Kieselalgen-Probe'], spec: 'diatom',
    intro: ['Friedrich Krause, a medical student, used Ruska’s instrument for biology. The rows of pores in the diatom Amphipleura pellucida, about 0.25 µm apart, were the classic test of the best light microscopes.',
      'Der Medizinstudent Friedrich Krause nutzte Ruskas Gerät für die Biologie. Die Porenreihen der Kieselalge Amphipleura pellucida, etwa 0,25 µm voneinander entfernt, waren der klassische Prüfstein der besten Lichtmikroskope.'],
    steps: [
      { text: ['Pump down, set 53 kV and light the discharge', 'Abpumpen, 53 kV einstellen, Entladung zünden'], hint: ['Krause worked at 53 kV. <b>Pumps</b>, <b>High voltage</b>, <b>Discharge current</b>.', 'Krause arbeitete bei 53 kV. <b>Pumpen</b>, <b>Hochspannung</b>, <b>Röhrenstrom</b>.'], ctl: 'pumpBtn', done: () => D.logP < -3.7 && Math.abs(D.kV - 53) < 3 && D.I > 0.2 },
      { text: ['Find a diatom on the intermediate screen', 'Eine Kieselalge auf dem Zwischenbildschirm finden'], hint: ['Switch to the <b>Intermediate screen</b> and drag the specimen until a boat-shaped shell lies over the small hole in the middle. Centre the beam with the magnet.', 'Schalten Sie auf den <b>Zwischenbildschirm</b> und ziehen Sie das Objekt, bis eine bootsförmige Schale über der kleinen Bohrung in der Mitte liegt. Zentrieren Sie den Strahl mit dem Magneten.'], ctl: 'viewsel', done: () => S.view === 'inter' && onDiatom(D.beamPos[0], D.beamPos[1]) && D.centered },
      { text: ['Final screen at 3,000× or more, brightened with the condenser', 'Endbildschirm, mindestens 3.000-fach, mit dem Kondensor aufgehellt'], hint: ['Switch to the <b>Final screen</b>, turn up the <b>Projector</b> and the <b>Condenser</b>, refocus the objective.', 'Schalten Sie auf den <b>Endbildschirm</b>, drehen Sie <b>Projektion</b> und <b>Kondensor</b> auf und stellen Sie das Objektiv nach.'], ctl: 'p', done: () => S.view === 'final' && D.op.M >= 3000 && D.g > 0.06 && onDiatom(D.beamPos[0], D.beamPos[1]) },
      { text: ['Focus until the rows of pores appear', 'Scharfstellen, bis die Porenreihen erscheinen'], hint: ['The rows are 0.26 µm apart. They appear when the blur drops below about 130 nm; use <b>Objective fine</b>.', 'Die Reihen liegen 0,26 µm auseinander. Sie erscheinen, wenn die Unschärfe unter etwa 130 nm fällt; benutzen Sie <b>Objektiv fein</b>.'], ctl: 'of', done: () => mtf(D.b.sigma, 260) > 0.3 && onDiatom(D.beamPos[0], D.beamPos[1]) },
      { text: ['Expose a plate that shows them', 'Eine Platte belichten, die sie zeigt'], hint: ['Steady beam, short exposure, good density.', 'Ruhiger Strahl, kurze Belichtung, gute Dichte.'], ctl: 'expose', plate: true },
    ],
    pass: (p) => p.spec === 'diatom' && p.onDiatom && mtf(p.sigma, 260) > 0.25 && p.densOk && p.intact,
    fail: (p) => !p.onDiatom ? ['The plate missed the diatom.', 'Die Platte hat die Kieselalge verfehlt.'] : !p.densOk ? (p.dens < 0.55 ? ['Too thin: expose longer.', 'Zu dünn: länger belichten.'] : ['Too dense: close the shutter sooner.', 'Zu dicht: Verschluss früher schließen.']) : ['The rows of pores are washed out. Refocus and keep the image steady.', 'Die Porenreihen sind verwaschen. Stellen Sie nach und halten Sie das Bild ruhig.'],
    result: (p) => ({ title: ['The diatom resolved', 'Die Kieselalge aufgelöst'],
      text: [`Your plate resolves ${fmtLen(p.d)} on Amphipleura pellucida, whose pore rows sit at the very limit of the finest oil-immersion objectives. Krause’s plate of 1937, at 53 kV and 3,500×, resolved 130 nm, and the instrument began to work for biology.`,
        `Ihre Platte löst an Amphipleura pellucida ${fmtLen(p.d)} auf; deren Porenreihen liegen genau an der Grenze der feinsten Ölimmersions-Objektive. Krauses Platte von 1937, bei 53 kV und 3.500-facher Vergrößerung, löste 130 nm auf, und das Gerät begann, der Biologie zu dienen.`] }) },
  { id: 'free', inst: 1933, year: ['Free exploration', 'Freies Erkunden'], title: ['Ruska’s instrument, ready', 'Ruskas Gerät, betriebsbereit'], spec: 'wing', ready: true,
    intro: ['The column is pumped and the discharge is burning at 60 kV. Try every specimen, including the house-fly wing of 1935, and push the magnification as far as the specimens survive.',
      'Die Säule ist abgepumpt, die Entladung brennt bei 60 kV. Probieren Sie jedes Objekt, auch den Fliegenflügel von 1935, und treiben Sie die Vergrößerung so weit, wie die Objekte es aushalten.'], steps: [] },
];

function startMission(m, keepPlates = true) {
  mission = m; stepI = 0; done = new Set();
  if (S.exposing) { S.exposing = false; S.exp = null; $('shutter').hidden = true; }
  const I = INSTRUMENTS[m.inst];
  Object.assign(S, { inst: m.inst, spec: m.spec, view: 'final', pump: !!m.ready, logP: m.ready ? -4.3 : 3, vent: 0, hvSet: m.ready ? 60 : 0, kV: m.ready ? 60 : 0, q: m.ready ? 0.5 : 0,
    c: 0, oc: m.inst === 1931 ? 0.93 : 0.95, of: 0, p: m.inst === 1931 ? 0.9 : 0.5, magnet: [0, 0], stage: [...SPECIMENS[m.spec].start], drift: [0, 0], T: 20, hvDrift: 0, burst: 0, platesLeft: PLATES });
  if (m.ready) { const ek = Math.sqrt(relV(75) / relV(60)); S.p = 0.6; S.c = 0.7; S.magnet = [-160 * ek + 3, 105 * ek - 2];
    const f = focusCurrent({ inst: 1933, kV: 60 * (1 - 0.012 * S.q), p: S.p, c: S.c, view: 'final' }); S.oc = f + 0.00015; }
  S.dmg = {};
  if (!keepPlates) { S.plates = []; renderPlates(); }
  buildPanel();
  $('viewsel').hidden = !I.Lis; $('viewsel').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.view === S.view));
  scene?.setInstrument(m.inst);
  renderMission();
  coach(m.steps[0]?.hint || ['Click any part of the column, or any knob, to read what it does.', 'Klicken Sie auf ein Teil der Säule oder einen Knopf, um zu lesen, was es tut.']);
  showNote(m.inst === 1931 ? 'tube31' : 'column');
  try { localStorage.setItem('ruska-mission', m.id); } catch {}
}
function renderMission() {
  const m = mission;
  $('modelNote').textContent = m.inst === 1931 ? tr(['Schematic of the 1931 two-coil tube', 'Schema der Zwei-Spulen-Röhre von 1931']) : tr(['After the brass model in the Nuremberg museum', 'Nach dem Messingmodell im Nürnberger Museum']);
  $('mYear').textContent = tr(m.year); $('mTitle').textContent = tr(m.title); $('mIntro').textContent = tr(m.intro);
  $('steps').innerHTML = m.steps.map((s) => `<li>${tr(s.text)}</li>`).join('');
  $('mission').querySelector('.mfoot').hidden = !m.steps.length;
  document.querySelectorAll('#missions button').forEach((b) => { const mm = MISSIONS.find((x) => x.id === b.dataset.id); b.innerHTML = `<small>${tr(mm.year)}</small><span>${tr(mm.title)}</span>`; b.setAttribute('aria-selected', mm === m); });
  stepsUI();
}
function coach(msg, alert = false) { coachMsg = [msg, alert]; const c = $('coach'); c.innerHTML = tr(msg); c.classList.toggle('alert', alert); }
function stepsUI() { [...$('steps').children].forEach((li, i) => { li.className = done.has(i) ? 'done' : i === stepI ? 'now' : ''; }); }
function advance() {
  const m = mission; if (!m?.steps.length) return;
  while (stepI < m.steps.length && !m.steps[stepI].plate && m.steps[stepI].done()) { done.add(stepI); stepI++; click(); coach(m.steps[stepI]?.hint || ''); }
  stepsUI();
}
for (const m of MISSIONS) {
  m.onPlate = (p) => {
    if (!m.steps.length) return;
    const last = m.steps.length - 1;
    if (stepI < last) { coach(['Good plate, but finish the steps above first: the mission checks them in order.', 'Gute Platte, aber erledigen Sie zuerst die Schritte darüber: Die Mission prüft sie der Reihe nach.']); return; }
    if (m.pass(p)) { done.add(last); stepI = last + 1; stepsUI(); finished.add(m.id); markMissions(); coach(['Mission complete.', 'Mission erfüllt.']); showResult(m, p); }
    else coach(p.burst ? ['A gas burst in the discharge tube interrupted the exposure. Take another plate.', 'Ein Gasausbruch im Entladungsrohr hat die Belichtung gestört. Nehmen Sie eine neue Platte.'] : m.fail(p), true);
  };
}
function markMissions() { document.querySelectorAll('#missions button').forEach((b) => b.classList.toggle('done', finished.has(b.dataset.id))); }
MISSIONS.forEach((m) => { const b = document.createElement('button'); b.role = 'tab'; b.dataset.id = m.id; b.onclick = () => startMission(m); $('missions').appendChild(b); });
$('restart').onclick = () => startMission(mission);
function hint() {
  const st = mission?.steps[stepI]; if (!st) return false;
  coach(st.hint);
  const t = $(st.ctl) || document.querySelector(`.knob[data-k="${st.ctl}"]`);
  if (t) { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); t.animate([{ boxShadow: '0 0 0 0 rgba(224,178,94,0.9)' }, { boxShadow: '0 0 0 14px rgba(224,178,94,0)' }], { duration: 900, iterations: 3 }); }
  return true;
}
$('hintBtn').onclick = hint;

// ------------------------------------------------------------------ result dialog
function showResult(m, p) {
  const r = m.result(p), de = lang === 'de';
  $('rEyebrow').textContent = `${tr(m.year)} · ${de ? 'Platte' : 'plate'} Nr. ${p.no}`; $('rTitle').textContent = tr(r.title); $('rText').textContent = tr(r.text); $('rPlate').src = p.url;
  const marks = [
    { nm: 1e5, label: de ? `Bloßes Auge<br>${num(0.1, 1)} mm` : 'Naked eye<br>0.1 mm' }, { nm: 200, label: de ? 'Lichtmikroskop<br>200 nm' : 'Light microscope<br>200 nm' },
    { nm: 50, label: 'Ruska 1933<br>50 nm' }, { nm: 0.05, label: de ? 'Heute, korrigiert<br>50 pm' : 'Today, corrected<br>50 pm' },
  ];
  if (m.id === 'm37') marks.splice(2, 0, { nm: 130, label: 'Krause 1937<br>130 nm' });
  marks.push({ nm: p.d, label: `${de ? 'Ihre Platte' : 'Your plate'}<br>${fmtLen(p.d)}`, you: true });
  const x = (nm) => ((Math.log10(1e6) - Math.log10(nm)) / (Math.log10(1e6) - Math.log10(0.02))) * 100;
  marks.sort((a, b) => b.nm - a.nm);
  const host = $('rScale'); host.innerHTML = '<div class="axis"></div><div class="ends"><span>1 mm</span><span>20 pm</span></div>';
  $('result').showModal();
  const Wd = host.clientWidth || 480, lw = 108, rows = { up: [], dn: [] };
  for (const k of [...marks].sort((a, b) => (b.you ? 1 : 0) - (a.you ? 1 : 0))) {
    const px = (x(k.nm) / 100) * Wd; let side = 'up', row = 0;
    for (;; row++) { const ok = (sd) => !(rows[sd][row] || []).some((q) => Math.abs(q - px) < lw); if (ok('up')) { side = 'up'; break; } if (!k.you && ok('dn')) { side = 'dn'; break; } }
    (rows[side][row] ||= []).push(px);
    const d = document.createElement('div'); d.className = `mk ${side}${k.you ? ' you' : ''}`; d.style.left = `${x(k.nm).toFixed(1)}%`; d.style.setProperty('--row', row);
    d.innerHTML = `<span>${k.label}</span><i></i>`; host.appendChild(d);
  }
  const nxt = MISSIONS[MISSIONS.indexOf(m) + 1];
  $('rNext').hidden = !nxt; $('rNext').onclick = () => nxt && setTimeout(() => startMission(nxt), 0);
}

// ------------------------------------------------------------------ the blur budget
const BROWS = [['focus', ['Focus', 'Schärfe']], ['chromatic', ['HV ripple', 'HV-Welligkeit']], ['spherical', ['Lens aperture error', 'Öffnungsfehler']], ['diffraction', ['Wavelength', 'Wellenlänge']], ['vibration', ['Vibration', 'Erschütterung']]];
const logX = (nm) => Math.max(0, Math.min(100, ((Math.log10(Math.max(nm, 0.1)) + 1) / 6) * 100)); // 0.1 nm … 100 µm
function budgetRows() {
  $('bRows').innerHTML = BROWS.map(([k, l]) => `<div class="brow" data-b="${k}"><span>${tr(l)}</span><span class="track"><i></i></span><b></b></div>`).join('') + `<div class="brow total" data-b="total"><span>${tr(['Resolution', 'Auflösung'])}</span><span class="track"><i></i></span><b></b></div>`;
  document.querySelectorAll('.brow .track').forEach((t) => t.style.setProperty('--lm', logX(200) + '%'));
}
budgetRows();
function budgetUI() {
  const rows = document.querySelectorAll('.brow'); let mx = 0, mk = '';
  for (const [k] of BROWS) { const v = D.b.parts[k] * 5.12; if (v > mx) { mx = v; mk = k; } }
  rows.forEach((r) => { const k = r.dataset.b; const v = k === 'total' ? D.dR : D.b.parts[k] * 5.12;
    r.querySelector('i').style.width = logX(v) + '%'; r.querySelector('b').textContent = fmtLen(v); r.classList.toggle('top', k === mk); });
  $('dNow').textContent = D.on ? fmtLen(D.dR) : '—';
}

// ------------------------------------------------------------------ the TEM-view Console (console.js): same knobs, mapped to 1933
const nudge = (k, d) => { const kn = K[k]; if (!kn) return; kn.set(kn.value + d); if (noteKey !== k) showNote(k); };
const con = new Console({
  mfModes: () => (INSTRUMENTS[S.inst].magnet ? ['magnet', 'discharge'] : ['discharge']),
  mfLabel: (m) => (m === 'magnet' ? tr(['hand magnet', 'Handmagnet']) : tr(['discharge current · HV fine', 'Röhrenstrom · HV fein'])),
  turn(ax, n, fine) {
    const I = INSTRUMENTS[S.inst], c33 = I.condenser, de = lang === 'de';
    if (ax === 'focus') {
      if (fine) nudge('of', n * (c33 ? 2e-5 : 2e-4)); else nudge('oc', n * (c33 ? 0.0015 : 0.003));
      return `${tr(c33 ? (fine ? ['Objective fine', 'Objektiv fein'] : ['Objective coarse', 'Objektiv grob']) : (fine ? ['Coil 1 fine', 'Spule 1 fein'] : ['Coil 1 coarse', 'Spule 1 grob']))} · ${de ? 'Defokus' : 'defocus'} ${sgn(D.op?.dz ?? 0, 1)} µm`;
    }
    if (ax === 'mag') { nudge('p', n * (c33 ? 0.01 : 0.005)); return `${tr(c33 ? ['Projector', 'Projektion'] : ['Coil 2', 'Spule 2'])} ${num(S.p * 100, 0)} % · ${fmtInt(D.op?.M ?? 0)}×`; }
    if (ax === 'intensity') {
      if (c33) { nudge('c', n * 0.004); return `${tr(['Condenser', 'Kondensor'])} ${num(S.c * 100, 1)} %`; }
      nudge('q', n * 0.01); return `${tr(['Discharge', 'Röhrenstrom'])} ${num(S.q * 1.5, 2)} mA`;
    }
    if (ax === 'context') { nudge('hv', n * 0.5); return `${tr(['High voltage', 'Hochspannung'])} ${num(S.hvSet, 1)} kV`; }
    if (ax === 'magnetX' || ax === 'magnetY') { if (!pad) return ''; const d = n * 2; pad.set(S.magnet[0] + (ax === 'magnetX' ? d : 0), S.magnet[1] + (ax === 'magnetY' ? d : 0)); if (noteKey !== 'magnet') showNote('magnet'); return `${tr(['Hand magnet', 'Handmagnet'])} · ${de ? 'Strahl' : 'beam'} ${num(Math.hypot(...(D.op?.beamOff ?? [0, 0])), 0)} µm ${de ? 'neben der Achse' : 'off axis'}`; }
    if (ax === 'dischargeX') { nudge('q', n * 0.01); return `${tr(['Discharge', 'Röhrenstrom'])} ${num(S.q * 1.5, 2)} mA`; }
    if (ax === 'dischargeY') { nudge('hv', n * 0.1); return `${tr(['High voltage', 'Hochspannung'])} ${num(S.hvSet, 1)} kV`; }
    return '';
  },
  stage(vx, vy, dt) { if (D.op) moveView(vx * D.op.field * 0.5 * dt, vy * D.op.field * 0.5 * dt); },
  button(k) {
    const T = tr;
    if (k === 'modePrev') { if (!INSTRUMENTS[S.inst].Lis) return T(['This tube has only one screen', 'Diese Röhre hat nur einen Schirm']); setView('inter'); return T(['Intermediate screen', 'Zwischenbildschirm']); }
    if (k === 'modeNext') { setView('final'); return T(['Final screen', 'Endbildschirm']); }
    if (k === 'wobbler') { setPump(!S.pump); return S.pump ? T(['Pumps on', 'Pumpen an']) : T(['Pumps off', 'Pumpen aus']); }
    if (k === 'optFocus' || k === 'talk') { hint(); return k === 'optFocus' ? T(['No autofocus in 1933: here is the next step', '1933 gab es keinen Autofokus: hier der nächste Schritt']) : T(['Next step', 'Nächster Schritt']); }
    if (k === 'pause') { if (S.q > 0.005) { S.qSaved = S.q; K.q.set(0); return T(['Discharge off', 'Entladung aus']); } K.q.set(S.qSaved || 0.5); return T(['Discharge on', 'Entladung an']); }
    if (k === 'clarity') { $('cutaway').click(); return T(['Cutaway', 'Schnittbild']); }
    if (k === 'labels') { $('spin').click(); return T(['Turntable', 'Drehteller']); }
    if (k === 'narrate') { $('sound').click(); return Snd.on ? T(['Sound on', 'Ton an']) : T(['Sound off', 'Ton aus']); }
    if (k === 'expand') { const L = INSTRUMENTS[S.inst].specimens; setSpecimen(L[(L.indexOf(S.spec) + 1) % L.length]); return tr(SPECIMENS[S.spec].name); }
    if (k === 'calib') { openConsole(); return ''; }
    if (k === 'acquire') { toggleExposure(); return S.exposing ? T(['Shutter open', 'Verschluss offen']) : T(['Shutter closed', 'Verschluss zu']); }
    return '';
  },
});
let conSig = '';
function openConsole() { conSig = ''; consoleUI(); if (!$('consoleDlg').open) $('consoleDlg').showModal(); }
function consoleUI() {
  const sig = `${con.pad?.id || ''}|${con.kind}|${lang}`;
  if ($('consoleDlg').open && sig !== conSig) { conSig = sig; con.render($('consoleBody')); }
  if ($('consoleDlg').open) con.live($('cLive'));
  $('consoleDot').hidden = !con.pad;
}
$('consoleBtn').onclick = openConsole;

// ------------------------------------------------------------------ the physics loop
const scene = await import('./scene.js').then((m) => m.createScene($('stage'), { onPick: (k) => showNote(k), label })).catch((e) => { console.error(e); return null; });
$('cutaway').onclick = (e) => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); scene?.setCutaway(on); };
$('spin').onclick = (e) => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); scene?.setSpin(on); };
$('sound').onclick = (e) => { const b = e.currentTarget; Snd.on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', Snd.on); if (Snd.out) Snd.out.gain.value = Snd.on ? 0.5 : 0; };

let lastT = performance.now(), uiT = 0;
function tick(now) { update(now); requestAnimationFrame(tick); }
function update(now) {
  const dt = Math.max(0, Math.min(0.1, (now - lastT) / 1000)); lastT = Math.max(lastT, now); S.time += dt;
  const I = INSTRUMENTS[S.inst], sp = SPECIMENS[S.spec];
  con.poll(dt);

  // vacuum: fore pump to ~10⁻¹ mbar, then the mercury diffusion pump; the discharge lets in a little gas
  if (S.vent > 0) { S.logP = Math.min(3, S.logP + 2.2 * dt); if (S.logP >= 3) S.vent = 0; }
  else if (S.pump) { const floor = -4.4 + 0.45 * S.q; S.logP = S.logP > -1 ? S.logP - 0.55 * dt : Math.max(floor, S.logP - 0.33 * dt); if (S.logP < floor) S.logP += 0.2 * dt; }
  else S.logP = Math.min(3, S.logP + 0.03 * dt);
  const ex10 = Math.floor(S.logP), sup = String(ex10).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  const pTxt = `${num(10 ** (S.logP - ex10), 1)}×10${sup} mbar`;
  D.logP = S.logP;

  // high voltage: ramps to the set value, minus the discharge’s pull; flashes over in a bad vacuum
  const kVnom = S.hvSet * (1 - 0.012 * S.q);
  S.kV += Math.sign(kVnom - S.kV) * Math.min(Math.abs(kVnom - S.kV), 18 * dt);
  if (S.kV > 4 && S.logP > -3) {
    S.kV = 0; S.hvSet = 0; K.hv.set(0, false); scene?.flash(); crack(0.5, 1);
    coach(S.logP > 0 ? ['Flashover! The column is full of air. Switch on the pumps and wait for the vacuum before the high voltage.', 'Überschlag! Die Säule ist voller Luft. Schalten Sie die Pumpen ein und warten Sie auf das Vakuum, bevor Sie die Hochspannung einschalten.']
      : ['Flashover! The vacuum is not good enough yet: wait until the gauge is below 10⁻³ mbar.', 'Überschlag! Das Vakuum ist noch nicht gut genug: Warten Sie, bis das Manometer unter 10⁻³ mbar zeigt.'], true);
  }
  S.hvDrift += -S.hvDrift / 30 * dt + 2.5e-4 * Math.sqrt(2 * dt / 30) * gauss();
  // gas bursts in the discharge tube put the beam out for 2–5 s (Ruska 1934)
  if (S.burst > 0) { S.burst -= dt; if (S.burst <= 0) coach(mission?.steps[stepI]?.hint || ''); }
  else if (S.q > 0.05 && S.kV > 10 && Math.random() < dt / 55) { S.burst = 2 + 3 * Math.random(); crack(0.18, 0.4); coach(['A gas burst in the discharge tube: the beam goes out for a few seconds and comes back. It happened to Ruska too.', 'Ein Gasausbruch im Entladungsrohr: Der Strahl erlischt für einige Sekunden und kommt zurück. Das kannte auch Ruska.']); }
  const burstK = S.burst > 0 ? 0.06 : 1;
  const kV = Math.max(0, S.kV * (1 + S.hvDrift) * (S.burst > 0 ? 0.93 : 1));
  const delta = 0.8e-4 + 2.6e-4 * S.q;
  S.flick += dt * (2 + 3 * Math.random());
  const beamOn = S.kV > 3 && S.logP < -3 && S.q > 0.005;
  const mA = beamOn ? 1.5 * S.q * burstK * (1 + 0.05 * gauss()) : 0;

  // mercury pump boiling bumps shake the column now and then
  S.bumpT += dt;
  if (S.pump && S.logP < -1 && Math.random() < dt / 16) { S.bumpT = 0; S.bumpA = 0.07 + 0.08 * Math.random(); S.bumpPh = [Math.random() * 6.28, Math.random() * 6.28]; }
  const bump = S.bumpA * Math.exp(-S.bumpT / 0.35);
  const bumpXY = [bump * Math.sin(2 * Math.PI * 9 * S.bumpT + S.bumpPh[0]), bump * Math.sin(2 * Math.PI * 7 * S.bumpT + S.bumpPh[1])];

  // optics
  const op = optics({ inst: S.inst, kV: Math.max(kV, 1), oc: S.oc, of: S.of, p: S.p, c: S.c, view: S.view, magnet: S.magnet });
  const b = blur(op, delta, I.vib);
  const dR = ruskaD(b.sigma);

  // the specimen: where the beam lands, how hot it gets, how it chars and breaks
  const center = [S.stage[0] + S.drift[0], S.stage[1] + S.drift[1]];
  const beamPos = [center[0] + op.beamOff[0], center[1] + op.beamOff[1]];
  const cov = cover(S.spec, beamPos[0], beamPos[1], op.rs * 0.5);
  const dT = beamOn ? heating(op, mA, sp.absorb * Math.pow(75 / Math.max(kV, 20), 0.3), sp.hk, cov) : 0;
  S.T += (20 + dT - S.T) * Math.min(1, dt / 0.4);
  const dm = damageOf(S.spec), N = scr?.DN || 256, W = sp.W, tx = W / N;
  let destroyed = 0, carbon = 0;
  if (beamOn && S.T > Math.min(sp.charT, sp.breakT) - 80) {
    const R = op.rs * 2.2, i0 = Math.max(0, Math.floor((beamPos[0] - R) / tx + N / 2)), i1 = Math.min(N - 1, Math.ceil((beamPos[0] + R) / tx + N / 2));
    const j0 = Math.max(0, Math.floor((beamPos[1] - R) / tx + N / 2)), j1 = Math.min(N - 1, Math.ceil((beamPos[1] + R) / tx + N / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5 - N / 2) * tx, y = (j + 0.5 - N / 2) * tx, rr = ((x - beamPos[0]) ** 2 + (y - beamPos[1]) ** 2) / (op.rs * op.rs);
      const Tl = 20 + (S.T - 20) / (1 + rr * rr), k = (j * N + i) * 2;
      if (Tl > sp.charT) dm[k] = Math.min(1, dm[k] + ((Tl - sp.charT) / 700) * dt);
      if (Tl > sp.breakT) dm[k + 1] = Math.min(1, dm[k + 1] + ((Tl - sp.breakT) / 550) * dt);
    }
    S.dmgDirty = 1;
  }
  { const i = Math.floor(beamPos[0] / tx + N / 2), j = Math.floor(beamPos[1] / tx + N / 2);
    if (i >= 0 && j >= 0 && i < N && j < N) { carbon = dm[(j * N + i) * 2]; destroyed = dm[(j * N + i) * 2 + 1]; } }
  if (S.dmgDirty && scr && (S.dmgDirty++ % 3 === 1)) { for (let i = 0; i < dmgBytes.length; i++) dmgBytes[i] = dm[i] * 255; scr.setDamage(dmgBytes); if (S.dmgDirty > 4) S.dmgDirty = 0; }
  // thermal drift of a hot specimen
  const v = 0.04e-3 * Math.max(0, S.T - 40); S.driftDir += 0.05 * gauss() * dt;
  S.drift[0] += v * Math.cos(S.driftDir) * dt; S.drift[1] += v * Math.sin(S.driftDir) * dt;

  // brightness on the screen
  const offR = Math.hypot(...op.beamOff) / op.rs;
  const prof = I.condenser ? (offR < 0.82 ? 1 : offR > 1.18 ? 0 : 1 - (offR - 0.82) / 0.36) : Math.exp(-1.3 * offR * offR);
  const contrast = 1 / (1 + 0.6 * (op.alphaIll / I.alpha) ** 2);
  const gain = screenBrightness(op, mA);
  const g = gain * prof * (1 - 0.4 * Math.min(1, cov));
  const imgPos = [center[0] + bumpXY[0], center[1] + bumpXY[1]];
  const on = beamOn ? 1 : 0;
  const isHole = op.inter ? (I.hole / (I.isScreen / 2)) : 0;
  const hole = !op.inter && I.hole ? (I.hole * op.Mp) / (I.screen / 2) : 0;

  Object.assign(D, { op, b, dR, kV, kVnom, delta, I: mA, g: on ? g : 0, M: op.M, pTxt, on: beamOn, T: S.T, cover: cov, destroyed, carbon, beamPos, imgPos,
    centered: offR < 0.3, sharp: dR * op.M * 1e-6 < 0.25 });

  if (scr) {
    scr.draw({ center: imgPos, fov: op.field, rot: op.rot, sigma: b.sigma * 1e-3, spec: sp.id, geo: sp.geo, ill: [op.beamOff[0], op.beamOff[1], op.rs], illShape: I.condenser ? 0 : 1,
      gain: 1.6 * Math.pow(gain, 0.6), contrast, kappa: Math.pow(75 / Math.max(kV, 20), 0.9) * (S.spec === 'grid' ? 1.4 : 1), ne: 60 * gain + 0.2, time: S.time, flick: S.flick, on: on * (S.burst > 0 ? 0.08 : 1),
      hole: hole > 0 ? Math.min(hole, 3) : 0, isHole, dmgW: W });
    if (S.exposing) accumulate(dt);
  }

  // sound
  if (Snd.ctx && Snd.on) { Snd.pump.gain.value = S.pump ? (S.logP > -1 ? 0.16 : 0.07) : S.vent ? 0.25 : 0; Snd.pumpF.frequency.value = S.vent ? 1400 : S.logP > -1 ? 380 : 220; Snd.hum.gain.value = beamOn ? 0.012 + 0.02 * S.q : S.kV > 1 ? 0.006 : 0; }

  // 3D
  scene?.update({ on, beam: Math.min(1, 0.25 + S.q), rs: op.rs, Mo: op.Mo, Mp: op.Mp, screenGlow: !op.inter ? Math.min(1, Math.pow(g, 0.5) * 0.8) : Math.min(1, Math.pow(screenBrightness({ ...op, M: op.Mo * op.Mp }, mA), 0.5)),
    interGlow: Math.min(1, Math.pow(screenBrightness({ ...op, M: op.Mo }, mA), 0.4) * 0.8), hot: Math.max(0, Math.min(1, (S.T - 450) / 900)), glowGas: beamOn ? 0.4 + 0.6 * S.q : 0 });
  scene?.frame(now);

  uiT += dt;
  if (uiT > 0.1) { uiT = 0; readouts(); advance(); }
}

function readouts() {
  const op = D.op, I = INSTRUMENTS[S.inst], de = lang === 'de';
  $('ovView').innerHTML = `${op.inter ? tr(['Intermediate screen', 'Zwischenbild']) : tr(['Final screen', 'Endbild'])}<br>${num(D.kV, 1)} kV · ${num(D.I, 2)} mA`;
  $('ovMag').textContent = `${fmtInt(op.M)}×`;
  const sp = SPECIMENS[S.spec], lim = Math.min(sp.charT, sp.breakT), t = $('ovTemp');
  t.textContent = D.on || S.T > 25 ? `${de ? 'Objekt' : 'Specimen'} ${num(S.T, 0)} °C${S.T > sp.breakT ? (de ? ' · verbrennt' : ' · burning') : S.T > sp.charT ? (de ? ' · verkohlt' : ' · charring') : ''}` : '';
  t.className = `ov tr ${S.T > lim ? 'hot' : S.T > lim - Math.max(60, 0.12 * lim) ? 'warm' : ''}`;
  // scale bar: a round length near a fifth of the window
  const target = op.field / 5; const e = 10 ** Math.floor(Math.log10(target)); const L = [1, 2, 5].map((m) => m * e).reduce((a, x) => (Math.abs(x - target) < Math.abs(a - target) ? x : a));
  $('scaleBar').style.width = `${(L / op.field) * $('window').clientWidth * 0.95}px`; $('scaleTxt').textContent = fmtLen(L * 1e3);
  let msg = '';
  if (S.logP > -3 && !S.pump) msg = S.logP > 2 ? tr(['The column is full of air', 'Die Säule ist voller Luft']) : tr(['The column is leaking up', 'Der Druck in der Säule steigt']);
  else if (S.logP > -3) msg = tr(['Pumping…', 'Wird abgepumpt …']);
  else if (S.kV < 3) msg = tr(['No high voltage', 'Keine Hochspannung']);
  else if (S.q < 0.01) msg = tr(['The discharge is off', 'Die Entladung ist aus']);
  else if (S.burst > 0) msg = tr(['Gas burst: the discharge sputters', 'Gasausbruch: Die Entladung stottert']);
  else if (D.g < 0.004) msg = !op.inter && I.condenser && Math.hypot(...op.beamOff) > op.rs * 0.9 ? tr(['The beam is off the axis: use the hand magnet', 'Der Strahl liegt neben der Achse: Handmagnet benutzen']) : tr(['Too dim to see', 'Zu dunkel zum Sehen']);
  $('ovMsg').textContent = msg;
  // panel states
  $('pTxt').textContent = D.pTxt;
  $('pPhase').textContent = S.vent ? tr(['Air rushing in', 'Luft strömt ein']) : !S.pump ? (S.logP > 2 ? tr(['Atmosphere', 'Atmosphärendruck']) : tr(['Pumps off: leaking up', 'Pumpen aus: Druck steigt'])) : S.logP > -1 ? tr(['Fore pump', 'Vorpumpe']) : S.logP > -3.5 ? tr(['Mercury diffusion pump', 'Quecksilber-Diffusionspumpe']) : tr(['Good vacuum', 'Gutes Vakuum']);
  gauge.set(S.logP);
  $('stVac').textContent = S.logP < -3 ? tr(['ready for HV', 'bereit für HV']) : '';
  $('stHV').textContent = D.on ? `${num(D.kV, 2)} kV · ${num(D.I, 2)} mA` : S.kV > 1 ? `${num(S.kV, 1)} kV, ${de ? 'kein Strahl' : 'no beam'}` : tr(['off', 'aus']);
  $('stLens').textContent = `${fmtInt(op.M)}× · ${de ? 'gedreht' : 'rotated'} ${num(((op.rot * 180) / Math.PI) % 360, 0)}°`;
  $('stSpec').textContent = `x ${num(S.stage[0], 1)}  y ${num(S.stage[1], 1)} µm`;
  $('stPlate').textContent = de ? `${S.platesLeft} von ${PLATES} Platten übrig` : `${S.platesLeft} of ${PLATES} plates left`;
  $('plLeft').textContent = S.exposing ? `${de ? 'Dichte' : 'Density'} ${num(S.exp.E / E0, 2)} (${de ? 'gut' : 'good'}: ${num(0.6, 1)}–${num(2.4, 1)})` : D.g > 0.002 ? (de ? `Gute Platte in etwa ${num(E0 / D.g, 1)} s` : `Good plate in about ${num(E0 / D.g, 1)} s`) : tr(['Too dark for a plate', 'Zu dunkel für eine Platte']);
  $('reload').hidden = S.platesLeft > 0;
  $('expose').disabled = S.platesLeft <= 0 && !S.exposing;
  $('expHint').textContent = S.exposing ? `${num(S.exp.t, 1)} s` : '';
  if (S.exposing) { $('expTime').textContent = `${num(S.exp.t, 1)} s`; $('expBar').style.width = `${Math.min(100, (S.exp.E / E0) * 60)}%`; }
  $('shutter').firstElementChild.textContent = tr(['Plate exposing', 'Platte wird belichtet']);
  budgetUI(); liveNote();
  con.hud($('hud')); consoleUI();
}

// ------------------------------------------------------------------ language
document.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
onLang(() => {
  buildPanel(); renderMission(); budgetRows(); renderPlates();
  if (coachMsg) coach(...coachMsg);
  if (noteKey) showNote(noteKey);
  conSig = '';
});
applyStatic();

// ------------------------------------------------------------------ start
let first = MISSIONS[1];
try { const id = new URLSearchParams(location.search).get('mission') || localStorage.getItem('ruska-mission'); first = MISSIONS.find((m) => m.id === id) || first; } catch {}
startMission(first, false);
renderPlates();
requestAnimationFrame((t) => { lastT = t; tick(t); });
// for the console and for automated checks
window.ruska = { S, get D() { return D; }, K, con, setLang, startMission: (id) => startMission(MISSIONS.find((m) => m.id === id)),
  // advance the simulation by `sec` seconds in 1/30 s steps (for scripted checks while the tab is hidden)
  run(sec) { for (let t = 0; t < sec; t += 1 / 30) update(lastT + 1000 / 30); } };
