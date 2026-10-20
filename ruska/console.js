// The TEM-view Console (or any game controller) on Ruska's instrument. Same USB protocol as the main exhibit
// (hardware/panel/README.md): a HID joystick named "TEM-view Panel/Console", 8 axes, 16 buttons; axes 0–1 are the
// stage joystick, axes 2–7 encoders sent as wrapping 16-bit counters. The knobs keep their roles, mapped to 1933:
//   focus → objective (fine / coarse with the focus push), magnification → projector, intensity → condenser
//   (discharge current on the 1931 tube), context → high voltage, multifunction → hand magnet or discharge,
//   joystick → stage. The same keys as the exhibit's on-screen panel drive it from a keyboard.
import { tr } from './i18n.js';

export const AXES = [
  ['stageX', ['Stage X (joystick)', 'Objekt X (Joystick)']], ['stageY', ['Stage Y (joystick)', 'Objekt Y (Joystick)']],
  ['focus', ['Focus → objective', 'Fokus → Objektiv']], ['mag', ['Magnification → projector', 'Vergrößerung → Projektionsspule']],
  ['intensity', ['Intensity → condenser', 'Intensität → Kondensor']], ['mfX', ['Multifunction X', 'Multifunktion X']],
  ['mfY', ['Multifunction Y', 'Multifunktion Y']], ['context', ['Context → high voltage', 'Kontext → Hochspannung']],
];
export const BUTTONS = [
  ['modePrev', ['MODE ◀: intermediate screen', 'MODE ◀: Zwischenbildschirm']], ['modeNext', ['MODE ▶: final screen', 'MODE ▶: Endbildschirm']],
  ['mfSelect', ['MF: hand magnet / discharge', 'MF: Handmagnet / Entladung']], ['wobbler', ['WOBBLE: pumps on / off', 'WOBBLE: Pumpen an / aus']],
  ['focusFine', ['Focus push: fine / coarse', 'Fokus drücken: fein / grob']], ['optFocus', ['FOCUS: how do I…? (no autofocus in 1933)', 'FOCUS: Wie geht das? (1933 ohne Autofokus)']],
  ['pause', ['BEAM: discharge off / on', 'BEAM: Entladung aus / an']], ['clarity', ['Cutaway', 'Schnittbild']], ['labels', ['Turntable', 'Drehteller']],
  ['narrate', ['Sound', 'Ton']], ['expand', ['Next specimen', 'Nächstes Objekt']], ['calib', ['This dialog', 'Dieser Dialog']],
  ['acquire', ['ACQUIRE: expose a plate', 'ACQUIRE: Platte belichten']], ['talk', ['TALK: show the next step', 'TALK: nächsten Schritt zeigen']],
];
const DEFAULTS = {
  panel: { axes: { stageX: 0, stageY: 1, focus: 2, mag: 3, intensity: 4, mfX: 5, mfY: 6, context: 7 },
    buttons: { modePrev: 0, modeNext: 1, mfSelect: 2, wobbler: 3, focusFine: 4, optFocus: 5, pause: 6, clarity: 7, labels: 8, narrate: 9, expand: 10, calib: 11, acquire: 12, talk: 13 }, invert: {}, counts: 4 },
  standard: { axes: { stageX: 0, stageY: 1, mfX: 2, mfY: 3 },
    buttons: { mfSelect: 0, wobbler: 1, optFocus: 2, clarity: 3, magDown: 4, magUp: 5, focusDown: 6, focusUp: 7, focusFine: 8, pause: 9, acquire: 10, talk: 11, intensityUp: 12, intensityDown: 13, modePrev: 14, modeNext: 15 }, invert: {} },
};
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const shortName = (id) => String(id).replace(/\s*\(.*?Vendor.*?\)\s*/i, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);

// on-screen panel keys of the main exhibit: [axis, detents] or a button
const KEYS = { q: ['focus', -1], w: ['focus', 1], a: ['mag', -1], s: ['mag', 1], z: ['intensity', -1], x: ['intensity', 1], h: ['mfX', -1], l: ['mfX', 1],
  j: ['mfY', -1], k: ['mfY', 1], o: ['context', -1], p: ['context', 1], f: 'focusFine', tab: 'mfSelect', b: 'wobbler', g: 'optFocus', i: 'acquire', ',': 'modePrev', '.': 'modeNext', ' ': 'pause' };

export class Console {
  // api: { turn(axis, detents, fine), stage(vx, vy, dt), button(k), mfModes(), name() }
  constructor(api) {
    this.api = api; this.pad = null; this.kind = null; this.prevAxes = null; this.prevButtons = []; this.acc = {}; this.repeat = {};
    this.fine = true; this.mf = 0; this.msg = ''; this.msgT = -1e9; this.keyStage = [0, 0];
    this.maps = { panel: store('ruska-panel-map-panel') ?? structuredClone(DEFAULTS.panel), standard: store('ruska-panel-map-standard') ?? structuredClone(DEFAULTS.standard) };
    addEventListener('gamepadconnected', (e) => this.say(`${tr(['Connected', 'Verbunden'])}: ${shortName(e.gamepad.id)}`));
    addEventListener('gamepaddisconnected', () => { this.pad = null; this.say(tr(['Console disconnected', 'Konsole getrennt'])); });
    addEventListener('keydown', (e) => this.key(e, true)); addEventListener('keyup', (e) => this.key(e, false));
  }
  map() { return this.maps[this.kind ?? 'panel']; }
  save() { store(`ruska-panel-map-${this.kind}`, this.map()); }
  say(m) { this.msg = m; this.msgT = performance.now(); }
  mfName() { const L = this.api.mfModes(); return L[this.mf % L.length]; }

  key(e, down) {
    const t = e.target; if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (t && (t.closest?.('input, select, textarea, [role="slider"], .pad, dialog') )) return;
    const k = e.key === 'Tab' ? 'tab' : e.key.toLowerCase();
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
    if (arrows[k]) { if (t === document.body || t?.id === 'screen') { const [x, y] = arrows[k]; if (x) this.keyStage[0] = down ? x : 0; if (y) this.keyStage[1] = down ? y : 0; e.preventDefault(); } return; }
    if (!down || !(k in KEYS)) return;
    if ((k === 'tab' || k === ' ') && t !== document.body && t?.id !== 'screen') return;
    const a = KEYS[k]; e.preventDefault(); this.source = 'keyboard';
    if (Array.isArray(a)) this.acc[a[0]] = (this.acc[a[0]] ?? 0) + a[1] * (e.shiftKey ? 5 : 1);
    else this.button(a);
  }

  poll(dt) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads.find((p) => /TEM-view/i.test(p.id)) ?? pads[0] ?? null;
    let sx = this.keyStage[0], sy = this.keyStage[1];
    if (gp) {
      if (!this.pad || this.pad.index !== gp.index) { this.prevAxes = null; this.prevButtons = []; }
      this.pad = gp; this.kind = /TEM-view/i.test(gp.id) || gp.mapping !== 'standard' ? 'panel' : 'standard';
      const M = this.map(), ax = gp.axes, bt = gp.buttons.map((b) => b.value), inv = (k) => (M.invert[k] ? -1 : 1);
      const A = (k) => (M.axes[k] != null && M.axes[k] < ax.length ? ax[M.axes[k]] * inv(k) : 0);
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const pressed = (k) => { const i = M.buttons[k]; return i != null && bt[i] > 0.5 && !(this.prevButtons[i] > 0.5); };
      const held = (k) => { const i = M.buttons[k]; return i != null ? bt[i] ?? 0 : 0; };
      const add = (k, v) => { if (v) { this.acc[k] = (this.acc[k] ?? 0) + v; this.source = this.kind; } };
      if (this.kind === 'panel') {
        const cur = {}; for (const k of ['focus', 'mag', 'intensity', 'mfX', 'mfY', 'context']) cur[k] = A(k);
        if (this.prevAxes) for (const k in cur) { let d = Math.round((cur[k] - this.prevAxes[k]) * 32767); if (d > 32767) d -= 65535; else if (d < -32767) d += 65535; add(k, d / (M.counts || 4)); }
        this.prevAxes = cur;
      } else {
        add('mfX', dz(A('mfX')) * 10 * dt); add('mfY', dz(A('mfY')) * 10 * dt);
        add('focus', (held('focusUp') - held('focusDown')) * 14 * dt);
        for (const [k, key, d] of [['magUp', 'mag', 1], ['magDown', 'mag', -1], ['intensityUp', 'intensity', 1], ['intensityDown', 'intensity', -1]]) {
          if (held(k) > 0.5) { this.repeat[k] = (this.repeat[k] ?? -0.35) + dt; if (pressed(k) || this.repeat[k] > 0.1) { add(key, d); if (this.repeat[k] > 0.1) this.repeat[k] = 0; } } else this.repeat[k] = -0.35;
        }
      }
      const jx = dz(A('stageX')), jy = dz(A('stageY'));
      if (jx || jy) { sx = jx; sy = -jy; this.source = this.kind; }
      for (const [k] of BUTTONS) if (pressed(k)) { this.source = this.kind; this.button(k); }
      this.prevButtons = bt;
    } else this.pad = null;
    if (sx || sy) this.api.stage(sx, sy, dt);
    for (const k in this.acc) { const n = Math.trunc(this.acc[k]); if (n) { this.acc[k] -= n; this.turn(k, n); } }
  }

  turn(axis, n) {
    const ax = axis === 'mfX' || axis === 'mfY' ? `${this.mfName()}${axis.slice(2)}` : axis;
    const m = this.api.turn(ax, n, this.fine); if (m) this.say(m);
  }
  button(k) {
    if (k === 'mfSelect') { this.mf = (this.mf + 1) % this.api.mfModes().length; this.say(`${tr(['Multifunction knobs', 'Multifunktionsknöpfe'])}: ${this.api.mfLabel(this.mfName())}`); return; }
    if (k === 'focusFine') { this.fine = !this.fine; this.say(this.fine ? tr(['Focus: fine (objective fine)', 'Fokus: fein (Objektiv fein)']) : tr(['Focus: coarse (objective coarse)', 'Fokus: grob (Objektiv grob)'])); return; }
    const m = this.api.button(k); if (m) this.say(m);
  }

  // short status line over the screen while the console is in use
  hud(el) {
    const fresh = performance.now() - this.msgT < 2600;
    el.hidden = !fresh && !this.pad;
    if (el.hidden) return;
    const who = this.pad ? shortName(this.pad.id) : tr(['Keyboard', 'Tastatur']);
    el.innerHTML = `<b>${esc(who)}</b>${esc(fresh ? this.msg : `${tr(['focus', 'Fokus'])} ${this.fine ? tr(['fine', 'fein']) : tr(['coarse', 'grob'])} · MF ${this.api.mfLabel(this.mfName())}`)}`;
    el.style.opacity = fresh ? 1 : 0.6;
  }

  render(el) {
    const gp = this.pad, T = tr;
    const keys = `<h3>${T(['Without hardware: the keyboard', 'Ohne Hardware: die Tastatur'])}</h3>
      <ul class="keys"><li><kbd>Q</kbd>/<kbd>W</kbd> ${T(['objective (fine or coarse)', 'Objektiv (fein oder grob)'])}</li><li><kbd>F</kbd> ${T(['fine / coarse', 'fein / grob'])}</li>
      <li><kbd>A</kbd>/<kbd>S</kbd> ${T(['projector', 'Projektionsspule'])}</li><li><kbd>Z</kbd>/<kbd>X</kbd> ${T(['condenser', 'Kondensor'])}</li>
      <li><kbd>O</kbd>/<kbd>P</kbd> ${T(['high voltage', 'Hochspannung'])}</li><li><kbd>H</kbd>/<kbd>L</kbd>, <kbd>J</kbd>/<kbd>K</kbd> ${T(['hand magnet (Tab: discharge)', 'Handmagnet (Tab: Entladung)'])}</li>
      <li>${T(['Arrows', 'Pfeiltasten'])}: ${T(['stage', 'Objekt verschieben'])}</li><li><kbd>,</kbd>/<kbd>.</kbd> ${T(['intermediate / final screen', 'Zwischen- / Endbildschirm'])}</li>
      <li><kbd>B</kbd> ${T(['pumps', 'Pumpen'])} · <kbd>Space</kbd> ${T(['discharge', 'Entladung'])}</li><li><kbd>I</kbd> ${T(['expose a plate', 'Platte belichten'])} · <kbd>G</kbd> ${T(['hint', 'Hinweis'])}</li></ul>
      <p class="muted">${T(['Shift turns a knob five detents at a time.', 'Mit Umschalt dreht ein Knopf fünf Rasten auf einmal.'])}</p>`;
    const link = `<p><a href="../console/" target="_blank" rel="noopener">${T(['The TEM-view Console', 'Die TEM-view Console'])}</a>: ${T(['the physical panel, in development for Kickstarter. Protocol and firmware:', 'das Bedienpult zum Anfassen, in Entwicklung für Kickstarter. Protokoll und Firmware:'])} <a href="https://github.com/Advanced-EM/TEM-view/tree/main/hardware/panel">hardware/panel</a>.</p>`;
    if (!gp) {
      el.innerHTML = `<p class="eyebrow">${T(['TEM-view Console', 'TEM-view Console'])}</p><h2 id="cTitle">${T(['Connect the <em>Console</em>', 'Die <em>Konsole</em> verbinden'])}</h2>
        <p>${T(['Plug in a TEM-view Console, a TEM-view panel or any game controller over USB or Bluetooth, then <b>press one of its buttons</b>: browsers only reveal a controller after it has been used. No drivers are needed.', 'Schließen Sie eine TEM-view Console, ein TEM-view-Pult oder einen beliebigen Gamecontroller über USB oder Bluetooth an und <b>drücken Sie eine Taste</b>: Browser zeigen einen Controller erst, wenn er benutzt wurde. Treiber sind nicht nötig.'])}</p>
        <p class="muted">${T(['Its knobs keep their jobs, translated to 1933: the focus dial drives the objective coil, magnification the projection coil, intensity the condenser, the context knob the high voltage, the multifunction knobs the hand magnet, and the joystick the specimen slide.', 'Die Knöpfe behalten ihre Aufgaben, übersetzt ins Jahr 1933: Der Fokusknopf steuert die Objektivspule, die Vergrößerung die Projektionsspule, die Intensität den Kondensor, der Kontextknopf die Hochspannung, die Multifunktionsknöpfe den Handmagneten und der Joystick den Objektträger.'])}</p>
        ${keys}${link}`;
      return;
    }
    const M = this.map();
    const opt = (n, sel) => `<option value="-1">—</option>${Array.from({ length: n }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`).join('')}`;
    const axes = this.kind === 'panel' ? AXES : AXES.filter(([k]) => ['stageX', 'stageY', 'mfX', 'mfY'].includes(k));
    const btns = this.kind === 'panel' ? BUTTONS : [...BUTTONS.filter(([k]) => !['labels', 'narrate', 'expand', 'calib'].includes(k)),
      ['focusUp', ['Focus + (trigger)', 'Fokus + (Trigger)']], ['focusDown', ['Focus − (trigger)', 'Fokus − (Trigger)']], ['magUp', ['Projector +', 'Projektion +']], ['magDown', ['Projector −', 'Projektion −']], ['intensityUp', ['Condenser +', 'Kondensor +']], ['intensityDown', ['Condenser −', 'Kondensor −']]];
    el.innerHTML = `<p class="eyebrow">${this.kind === 'panel' ? T(['TEM-view panel protocol', 'TEM-view-Pult-Protokoll']) : T(['Standard game controller', 'Standard-Gamecontroller'])}</p>
      <h2 id="cTitle">${esc(shortName(gp.id))}</h2>
      <p class="muted">${T(['Turn a knob or press a button to see its number light up; reassign it below. Settings are saved in this browser, separately from the main exhibit.', 'Drehen Sie einen Knopf oder drücken Sie eine Taste, um ihre Nummer aufleuchten zu sehen; unten lässt sie sich neu zuordnen. Die Einstellungen werden in diesem Browser gespeichert, getrennt von der Hauptausstellung.'])}</p>
      <div class="clive" id="cLive"></div>
      <div class="cgrid2"><table class="cmap">${axes.map(([k, l]) => `<tr><td>${T(l)}</td><td><select data-ax="${k}">${opt(gp.axes.length, M.axes[k])}</select> <label><input type="checkbox" data-inv="${k}" ${M.invert[k] ? 'checked' : ''}> ${T(['invert', 'umkehren'])}</label></td></tr>`).join('')}</table>
      <table class="cmap">${btns.map(([k, l]) => `<tr><td>${T(l)}</td><td><select data-bt="${k}">${opt(gp.buttons.length, M.buttons[k])}</select></td></tr>`).join('')}</table></div>
      ${this.kind === 'panel' ? `<p><label>${T(['Encoder counts per detent', 'Zählimpulse je Raste'])} <input type="number" min="1" max="8" step="1" id="cCounts" value="${M.counts}" style="width:4em"></label></p>` : ''}
      <p><button class="btn2" id="cReset" type="button">${T(['Reset to defaults', 'Zurücksetzen'])}</button></p>${link}`;
    el.querySelectorAll('[data-ax]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.axes[s.dataset.ax]; else M.axes[s.dataset.ax] = v; this.prevAxes = null; this.save(); }));
    el.querySelectorAll('[data-bt]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.buttons[s.dataset.bt]; else M.buttons[s.dataset.bt] = v; this.save(); }));
    el.querySelectorAll('[data-inv]').forEach((c) => c.addEventListener('change', () => { M.invert[c.dataset.inv] = c.checked; this.save(); }));
    el.querySelector('#cCounts')?.addEventListener('change', (e) => { M.counts = Math.max(1, Math.min(8, Math.round(+e.target.value) || 4)); this.save(); });
    el.querySelector('#cReset').addEventListener('click', () => { this.maps[this.kind] = structuredClone(DEFAULTS[this.kind]); this.save(); this.render(el); });
  }
  live(el) {
    const gp = this.pad; if (!gp || !el) return;
    el.innerHTML = gp.axes.map((v, i) => `<span class="ax">${i}<i style="--v:${((v + 1) / 2) * 100}%"></i></span>`).join('') + gp.buttons.map((b, i) => `<span class="bt ${b.value > 0.5 ? 'on' : ''}">${i}</span>`).join('');
  }
}
