// The TEM-view Console (or any game controller, or the keyboard) on the kids' microscope. Same USB protocol as
// the main exhibit (hardware/panel/README.md): a HID joystick named "TEM-view Panel/Console", 8 axes, 16 buttons;
// axes 0–1 are the stage joystick, axes 2–7 encoders sent as wrapping 16-bit counters. Kept to the basics:
//   focus → focus (fine / coarse with the focus push), magnification → zoom, intensity → brightness,
//   joystick and multifunction knobs → move the sample, MODE ◀ ▶ → sample, BEAM → beam on/off, ACQUIRE → snap.

export const AXES = [
  ['stageX', ['Move left / right (joystick)', 'Mover a izquierda / derecha (joystick)']], ['stageY', ['Move up / down (joystick)', 'Mover arriba / abajo (joystick)']],
  ['focus', ['Focus', 'Enfoque']], ['mag', ['Zoom', 'Zoom']], ['intensity', ['Brightness', 'Brillo']], ['mfX', ['Nudge left / right', 'Empujoncito izquierda / derecha']],
  ['mfY', ['Nudge up / down', 'Empujoncito arriba / abajo']], ['context', ['Next / previous sample', 'Muestra siguiente / anterior']],
];
export const BUTTONS = [
  ['modePrev', ['MODE ◀: previous sample', 'MODE ◀: muestra anterior']], ['modeNext', ['MODE ▶: next sample', 'MODE ▶: muestra siguiente']],
  ['mfSelect', ['MF: what am I looking at?', 'MF: ¿qué estoy viendo?']], ['wobbler', ['WOBBLE: give me a hint', 'WOBBLE: dame una pista']],
  ['focusFine', ['Focus push: fine / coarse', 'Presionar enfoque: fino / grueso']], ['optFocus', ['FOCUS: how sharp is it?', 'FOCUS: ¿qué tan nítido está?']],
  ['pause', ['BEAM: on / off', 'BEAM: encender / apagar el haz']], ['clarity', ['Colors: cartoon / real / green screen', 'Colores: caricatura / real / pantalla verde']],
  ['labels', ['Labels on the microscope', 'Etiquetas del microscopio']], ['narrate', ['Read aloud', 'Leer en voz alta']], ['expand', ['Sticker book', 'Álbum de stickers']], ['calib', ['This dialog', 'Este cuadro']],
  ['acquire', ['ACQUIRE: snap a picture', 'ACQUIRE: tomar una foto']], ['talk', ['TALK: give me a hint', 'TALK: dame una pista']],
];
const DEFAULTS = {
  panel: { axes: { stageX: 0, stageY: 1, focus: 2, mag: 3, intensity: 4, mfX: 5, mfY: 6, context: 7 },
    buttons: { modePrev: 0, modeNext: 1, mfSelect: 2, wobbler: 3, focusFine: 4, optFocus: 5, pause: 6, clarity: 7, labels: 8, narrate: 9, expand: 10, calib: 11, acquire: 12, talk: 13 }, invert: {}, counts: 4 },
  standard: { axes: { stageX: 0, stageY: 1, mfX: 2, mfY: 3 },
    buttons: { pause: 0, wobbler: 1, mfSelect: 2, clarity: 3, magDown: 4, magUp: 5, focusDown: 6, focusUp: 7, focusFine: 8, expand: 9, acquire: 10, talk: 11, intensityUp: 12, intensityDown: 13, modePrev: 14, modeNext: 15 }, invert: {} },
};
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
import { tr } from './i18n.js';
export const shortName = (id) => String(id).replace(/\s*\(.*?Vendor.*?\)\s*/i, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);

// the main exhibit's on-screen-panel keys: [axis, detents] or a button
const KEYS = { q: ['focus', -1], w: ['focus', 1], a: ['mag', -1], s: ['mag', 1], z: ['intensity', -1], x: ['intensity', 1],
  f: 'focusFine', b: 'pause', ' ': 'pause', i: 'acquire', g: 'talk', h: 'talk', c: 'clarity', ',': 'modePrev', '.': 'modeNext', '?': 'mfSelect' };

export class Console {
  // api: { turn(axis, detents, fine), stage(vx, vy, dt), button(k) }
  constructor(api) {
    this.api = api; this.pad = null; this.kind = null; this.prevAxes = null; this.prevButtons = []; this.acc = {}; this.repeat = {};
    this.fine = true; this.keyStage = [0, 0]; this.onChange = () => {};
    this.maps = { panel: store('kids-panel-map-panel') ?? structuredClone(DEFAULTS.panel), standard: store('kids-panel-map-standard') ?? structuredClone(DEFAULTS.standard) };
    addEventListener('gamepadconnected', (e) => { this.api.say?.('consoleHi'); this.onChange(); });
    addEventListener('gamepaddisconnected', () => { this.pad = null; this.onChange(); });
    addEventListener('keydown', (e) => this.key(e, true)); addEventListener('keyup', (e) => this.key(e, false));
  }
  map() { return this.maps[this.kind ?? 'panel']; }
  save() { store(`kids-panel-map-${this.kind}`, this.map()); }

  key(e, down) {
    const t = e.target; if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (t?.closest?.('input, select, textarea, dialog, [role="slider"]')) return;
    const k = e.key.toLowerCase();
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[k]) { const [x, y] = arrows[k]; if (x) this.keyStage[0] = down ? x : 0; if (y) this.keyStage[1] = down ? y : 0; e.preventDefault(); return; }
    if (!down || e.repeat && typeof KEYS[k] === 'string' || !(k in KEYS)) return;
    if (k === ' ' && t?.closest?.('button, a')) return;
    const a = KEYS[k]; e.preventDefault();
    if (Array.isArray(a)) this.acc[a[0]] = (this.acc[a[0]] ?? 0) + a[1] * (e.shiftKey ? 5 : 1);
    else this.button(a);
  }

  poll(dt) {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads.find((p) => /TEM-view/i.test(p.id)) ?? pads[0] ?? null;
    let sx = this.keyStage[0], sy = this.keyStage[1];
    if (gp) {
      if (!this.pad || this.pad.index !== gp.index) { this.prevAxes = null; this.prevButtons = []; this.pad = gp; this.onChange(); }
      this.pad = gp; this.kind = /TEM-view/i.test(gp.id) || gp.mapping !== 'standard' ? 'panel' : 'standard';
      const M = this.map(), ax = gp.axes, bt = gp.buttons.map((b) => b.value), inv = (k) => (M.invert[k] ? -1 : 1);
      const A = (k) => (M.axes[k] != null && M.axes[k] < ax.length ? ax[M.axes[k]] * inv(k) : 0);
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const pressed = (k) => { const i = M.buttons[k]; return i != null && bt[i] > 0.5 && !(this.prevButtons[i] > 0.5); };
      const held = (k) => { const i = M.buttons[k]; return i != null ? bt[i] ?? 0 : 0; };
      const add = (k, v) => { if (v) this.acc[k] = (this.acc[k] ?? 0) + v; };
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
      if (jx || jy) { sx = jx; sy = jy; }
      for (const [k] of BUTTONS) if (pressed(k)) this.button(k);
      this.prevButtons = bt;
    } else if (this.pad) { this.pad = null; this.onChange(); }
    if (sx || sy) this.api.stage(sx, sy, dt);
    // the context knob changes the sample every 4 detents, so a bumped knob doesn't throw the visitor out
    if (Math.abs(this.acc.context ?? 0) >= 4) { const n = Math.sign(this.acc.context); this.acc.context = 0; this.button(n > 0 ? 'modeNext' : 'modePrev'); }
    for (const k in this.acc) { if (k === 'context') continue; const n = Math.trunc(this.acc[k]); if (n) { this.acc[k] -= n; this.api.turn(k, n, this.fine); } }
  }

  button(k) {
    if (k === 'focusFine') { this.fine = !this.fine; this.api.say?.(this.fine ? 'fineOn' : 'fineOff'); return; }
    this.api.button(k);
  }

  render(el) {
    const gp = this.pad, T = tr;
    const keys = `<h3>${T(['No Console? Use the keyboard', '¿No tienes Consola? Usa el teclado'])}</h3>
      <ul class="keys"><li><kbd>Q</kbd> <kbd>W</kbd> ${T(['focus', 'enfoque'])}</li><li><kbd>A</kbd> <kbd>S</kbd> ${T(['zoom out / in', 'alejar / acercar'])}</li><li><kbd>Z</kbd> <kbd>X</kbd> ${T(['dimmer / brighter', 'menos / más brillo'])}</li>
      <li>${T(['Arrow keys: move the sample', 'Flechas: mover la muestra'])}</li><li><kbd>B</kbd> ${T(['beam on / off', 'encender / apagar el haz'])}</li><li><kbd>I</kbd> ${T(['snap a picture', 'tomar una foto'])}</li><li><kbd>,</kbd> <kbd>.</kbd> ${T(['change the sample', 'cambiar la muestra'])}</li>
      <li><kbd>G</kbd> ${T(['hint', 'pista'])}</li><li><kbd>C</kbd> ${T(['colors', 'colores'])}</li><li><kbd>F</kbd> ${T(['focus fine / fast', 'enfoque fino / rápido'])}</li></ul>
      <p class="muted">${T(['Hold Shift to turn a knob five clicks at once.', 'Mantén Shift para girar una perilla cinco clics a la vez.'])}</p>`;
    const link = `<p class="muted">${T(['The <a href="../console/" target="_blank" rel="noopener">TEM-view Console</a> is a real control panel with knobs and a joystick, in development. It works here and in the grown-up exhibit with no drivers. Any game controller works too.', 'La <a href="../console/" target="_blank" rel="noopener">Consola TEM-view</a> es un panel de control de verdad, con perillas y un joystick, en desarrollo. Funciona aquí y en la exhibición para grandes sin instalar nada. También sirve cualquier control de videojuegos.'])}</p>`;
    if (!gp) {
      el.innerHTML = `<p class="eyebrow">${T(['TEM-view Console', 'Consola TEM-view'])}</p><h2 id="cTitle">${T(['Plug in a <em>Console</em>', 'Conecta una <em>Consola</em>'])}</h2>
        <p>${T(['Connect a TEM-view Console or any game controller (USB or Bluetooth), then <b>press one of its buttons</b>. Browsers only notice a controller after you use it.', 'Conecta una Consola TEM-view o cualquier control de videojuegos (USB o Bluetooth) y <b>presiona uno de sus botones</b>. Los navegadores solo detectan un control después de usarlo.'])}</p>
        <div class="cmapimg" aria-hidden="true"><span class="k f">${T(['Focus', 'Enfoque'])}</span><span class="k z">Zoom</span><span class="k b">${T(['Bright', 'Brillo'])}</span><span class="j">${T(['Joystick: move', 'Joystick: mover'])}</span><span class="btn r">${T(['Acquire = Snap', 'Acquire = Foto'])}</span></div>
        ${keys}${link}`;
      return;
    }
    const M = this.map();
    const opt = (n, sel) => `<option value="-1">—</option>${Array.from({ length: n }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`).join('')}`;
    const axes = this.kind === 'panel' ? AXES : AXES.filter(([k]) => ['stageX', 'stageY', 'mfX', 'mfY'].includes(k));
    const btns = this.kind === 'panel' ? BUTTONS : [...BUTTONS.filter(([k]) => !['labels', 'narrate', 'calib'].includes(k)),
      ['focusUp', ['Focus + (trigger)', 'Enfoque + (gatillo)']], ['focusDown', ['Focus − (trigger)', 'Enfoque − (gatillo)']], ['magUp', ['Zoom in', 'Acercar']], ['magDown', ['Zoom out', 'Alejar']],
      ['intensityUp', ['Brighter', 'Más brillo']], ['intensityDown', ['Dimmer', 'Menos brillo']]];
    el.innerHTML = `<p class="eyebrow">${this.kind === 'panel' ? T(['TEM-view Console', 'Consola TEM-view']) : T(['Game controller', 'Control de videojuegos'])} · ${T(['connected', 'conectado'])}</p>
      <h2 id="cTitle">${esc(shortName(gp.id))}</h2>
      <p class="muted">${T(['Turn a knob or press a button and watch its number light up. Grown-ups can change what each one does below; it is saved in this browser.', 'Gira una perilla o presiona un botón y mira cómo se ilumina su número. Los adultos pueden cambiar abajo lo que hace cada uno; se guarda en este navegador.'])}</p>
      <div class="clive" id="cLive"></div>
      <details><summary>${T(['Change the buttons (for grown-ups)', 'Cambiar los botones (para adultos)'])}</summary>
      <div class="cgrid2"><table class="cmap">${axes.map(([k, l]) => `<tr><td>${T(l)}</td><td><select data-ax="${k}">${opt(gp.axes.length, M.axes[k])}</select> <label><input type="checkbox" data-inv="${k}" ${M.invert[k] ? 'checked' : ''}> ${T(['flip', 'invertir'])}</label></td></tr>`).join('')}</table>
      <table class="cmap">${btns.map(([k, l]) => `<tr><td>${T(l)}</td><td><select data-bt="${k}">${opt(gp.buttons.length, M.buttons[k])}</select></td></tr>`).join('')}</table></div>
      ${this.kind === 'panel' ? `<p><label>${T(['Encoder counts per click', 'Pulsos del codificador por clic'])} <input type="number" min="1" max="8" step="1" id="cCounts" value="${M.counts}" style="width:4em"></label></p>` : ''}
      <p><button class="chip" id="cReset" type="button">${T(['Reset to defaults', 'Restablecer'])}</button></p></details>${keys}${link}`;
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
