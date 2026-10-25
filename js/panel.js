// Hardware control panel support (and ordinary game controllers as a stand-in).
//
// Protocol of the TEM-view panel (see hardware/panel/README.md): a USB HID joystick named "TEM-view Panel"
// with 8 axes and 16 buttons. Axes 0–1 are the stage joystick (absolute); axes 2–7 are rotary encoders sent as
// 16-bit wrapping counters, so the browser reads how far each knob turned since the last poll. Any browser
// with the Gamepad API works, without drivers.
//
// A standard game controller (Xbox / PlayStation layout) is mapped onto the same functions: sticks for the
// stage and the multifunction knobs, triggers for focus, bumpers for magnification, d-pad for intensity and mode.

import { CORR_RANGE } from './state.js';

export const AXES = [
  ['stageX', 'Stage X (joystick)'], ['stageY', 'Stage Y (joystick)'], ['focus', 'Focus'], ['mag', 'Magnification / camera length'],
  ['intensity', 'Intensity (dose)'], ['mfX', 'Multifunction X'], ['mfY', 'Multifunction Y'], ['context', 'Context knob'],
];
export { MF };
export const BUTTONS = [
  ['modePrev', 'Previous mode'], ['modeNext', 'Next mode'], ['mfSelect', 'Multifunction: stigmator / corrector terms / shift / tilt'], ['wobbler', 'Focus wobbler'],
  ['focusFine', 'Focus fine / coarse'], ['optFocus', 'Optimal focus'], ['pause', 'Pause beam'], ['clarity', 'Educational / realistic'],
  ['labels', 'Labels'], ['narrate', 'Narration'], ['expand', 'Enlarge results'], ['calib', 'Calibration dialog'], ['acquire', 'Acquire'], ['talk', 'Talk (hold to speak)'],
];
// multifunction modes; the corrector terms only appear with the probe corrector on, in the Ronchigram
const MF = [['stig', 'Stigmator'], ['B2', 'Coma B2', true], ['A2', '3-fold A2', true], ['A3', '4-fold A3', true], ['C3', 'Cₛ (C3)', true],
  ['shift', 'Image shift'], ['tilt', 'Specimen tilt']];
// corrector terms on the multifunction knobs: n-fold symmetry (the vector turns with n·angle), step per detent, unit
const AB_KNOB = { A1: [2, 0.5, 'nm'], B2: [1, 10, 'nm'], A2: [3, 10, 'nm'], A3: [4, 0.1, 'µm'] };

const DEFAULTS = {
  panel: {
    axes: { stageX: 0, stageY: 1, focus: 2, mag: 3, intensity: 4, mfX: 5, mfY: 6, context: 7 },
    buttons: { modePrev: 0, modeNext: 1, mfSelect: 2, wobbler: 3, focusFine: 4, optFocus: 5, pause: 6, clarity: 7, labels: 8, narrate: 9, expand: 10, calib: 11, acquire: 12, talk: 13 },
    invert: {}, sens: { focus: 1, mag: 1, intensity: 1, mf: 1, stage: 1, context: 1 }, counts: 4, // encoder counts per detent
  },
  standard: { // W3C "standard" gamepad layout
    axes: { stageX: 0, stageY: 1, mfX: 2, mfY: 3 },
    buttons: { mfSelect: 0, wobbler: 1, optFocus: 2, clarity: 3, magDown: 4, magUp: 5, focusDown: 6, focusUp: 7, focusFine: 8, pause: 9, acquire: 10, talk: 11, intensityUp: 12, intensityDown: 13, modePrev: 14, modeNext: 15 },
    invert: {}, sens: { focus: 1, mag: 1, intensity: 1, mf: 1, stage: 1, context: 1 },
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };

export class Panel {
  // api: { S, sim, set(key, v, inv), setRaw(key, v, inv), moveStage(dx, dy), cycleMode(d), action(id), toggle(name), refresh(), explain(key) }
  constructor(api) {
    this.api = api;
    this.pad = null; this.kind = null; this.prevAxes = null; this.prevButtons = [];
    this.mf = 'stig'; this.fine = false; this.wob = null; this.acc = {}; this.lastApply = 0; this.msg = ''; this.msgT = 0; this.repeat = {};
    this.maps = { panel: store('tem-panel-map-panel') ?? structuredClone(DEFAULTS.panel), standard: store('tem-panel-map-standard') ?? structuredClone(DEFAULTS.standard) };
    window.addEventListener('gamepadconnected', (e) => this.say(`Connected: ${shortName(e.gamepad.id)}`));
    window.addEventListener('gamepaddisconnected', () => { this.pad = null; this.say('Panel disconnected'); });
  }
  map() { return this.maps[this.kind ?? 'panel']; }
  saveMap() { store(`tem-panel-map-${this.kind}`, this.map()); }
  resetMap() { this.maps[this.kind] = structuredClone(DEFAULTS[this.kind]); this.saveMap(); }
  say(m) { this.msg = m; this.msgT = performance.now(); }

  // called every frame
  poll(dt) {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads.find((p) => /TEM-view/i.test(p.id)) ?? pads[0] ?? null;
    if (!gp) { this.pad = null; this.stageV = this.vstage; this.wobble(dt); this.flush(dt); return; }
    if (!this.pad || this.pad.index !== gp.index) { this.prevAxes = null; this.prevButtons = []; }
    this.pad = gp;
    this.kind = /TEM-view/i.test(gp.id) || gp.mapping !== 'standard' ? 'panel' : 'standard';
    const M = this.map(), ax = gp.axes, bt = gp.buttons.map((b) => b.value), inv = (k) => (M.invert[k] ? -1 : 1);
    const A = (k) => (M.axes[k] != null && M.axes[k] < ax.length ? ax[M.axes[k]] * inv(k) : 0);
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const pressed = (k) => { const i = M.buttons[k]; return i != null && bt[i] > 0.5 && !(this.prevButtons[i] > 0.5); };
    const held = (k) => { const i = M.buttons[k]; return i != null ? bt[i] ?? 0 : 0; };
    const add = (k, v) => { if (v) this.acc[k] = (this.acc[k] ?? 0) + v; };
    if (this.kind === 'panel') {
      // encoders: wrapping 16-bit counters scaled to [-1, 1]; difference in counts since the last poll
      const cur = {};
      for (const k of ['focus', 'mag', 'intensity', 'mfX', 'mfY', 'context']) cur[k] = A(k);
      if (this.prevAxes) for (const k in cur) {
        // counters run from −32767 to 32767 and wrap (period 65535)
        let d = Math.round((cur[k] - this.prevAxes[k]) * 32767);
        if (d > 32767) d -= 65535; else if (d < -32767) d += 65535;
        add(k, d / (M.counts || 4));
      }
      this.prevAxes = cur;
    } else {
      // game controller: analog sticks and triggers act as rates, buttons step (with auto-repeat)
      add('mfX', dz(A('mfX')) * 12 * dt); add('mfY', dz(A('mfY')) * 12 * dt);
      add('focus', (held('focusUp') - held('focusDown')) * 14 * dt);
      for (const [k, key, d] of [['magUp', 'mag', 1], ['magDown', 'mag', -1], ['intensityUp', 'intensity', 1], ['intensityDown', 'intensity', -1]]) {
        if (held(k) > 0.5) { this.repeat[k] = (this.repeat[k] ?? -0.35) + dt; if (pressed(k) || this.repeat[k] > 0.12) { add(key, d); if (this.repeat[k] > 0.12) this.repeat[k] = 0; } } else this.repeat[k] = -0.35;
      }
    }
    // stage joystick: a rate, scaled to the field of view
    const sx = dz(A('stageX')), sy = dz(A('stageY'));
    this.stageV = sx || sy ? [sx, sy] : this.vstage;
    // buttons
    for (const [k] of BUTTONS) if (k !== 'talk' && pressed(k)) this.button(k);
    // talk is held: speech recognition runs from press to release
    const ti = M.buttons.talk;
    if (ti != null) { const now = bt[ti] > 0.5, was = this.prevButtons[ti] > 0.5; if (now !== was) this.api.talk?.(now); }
    this.prevButtons = bt;
    if (Object.keys(this.acc).length || this.stageV) this.api.noteSource?.(this.kind === 'panel' ? 'panel' : 'controller');
    this.wobble(dt);
    this.flush(dt);
  }

  // apply accumulated motion at most ~20× a second (each change recomputes part of the simulation)
  flush() {
    if (this.stageV) this.acc.stage = 1;
    const now = performance.now();
    if (now - this.lastApply > 50 && Object.keys(this.acc).length) { this.lastApply = now; this.apply(); }
  }

  // ---------------------------------------------------------------- input from the on-screen panel (keyboard, mouse)
  turn(axis, detents) { this.api.noteSource?.('onscreen-panel'); this.acc[axis] = (this.acc[axis] ?? 0) + detents; }
  setStage(vx, vy) { if (vx || vy) this.api.noteSource?.('onscreen-panel'); this.vstage = vx || vy ? [vx, vy] : null; }
  button(k) {
    if (this.pad && !this.virtual) this.api.noteSource?.(this.kind === 'panel' ? 'panel' : 'controller');
    if (k === 'talk') return;
    if (k === 'modePrev') this.api.cycleMode(-1);
    else if (k === 'modeNext') this.api.cycleMode(1);
    else if (k === 'mfSelect') { const L = this.mfList(), i = L.findIndex((m) => m[0] === this.mf); this.setMF(L[(i + 1) % L.length][0]); }
    else if (k === 'focusFine') { this.fine = !this.fine; this.say(`Focus ${this.fine ? 'fine' : 'coarse'}`); }
    else if (k === 'wobbler') this.toggleWobbler();
    else if (k === 'optFocus') { this.api.action('optfocus'); this.say('Optimal focus'); }
    else this.api.toggle(k);
  }
  setMF(k) { this.mf = k; this.say(`Multifunction knobs: ${MF.find((m) => m[0] === k)[1]}`); }
  // corrector terms only with the corrector on, in the Ronchigram; fall back to the stigmator elsewhere
  corrOn() { const S = this.api.S; return S.corrector && S.mode === 'ronch'; }
  mfList() { return MF.filter((m) => !m[2] || this.corrOn()); }
  mfNow() { if (!this.mfList().some((m) => m[0] === this.mf)) this.mf = 'stig'; return this.mf; }
  // what each knob is doing right now, for the on-screen panel
  readouts() {
    const { S } = this.api, m = S.mode, f1 = (v) => v.toFixed(1);
    const diffMag = m === 'diff' || (m === 'cbed' && S.cbedKind === 'cbed');
    const ctx = m === 'stem' || m === 'eds' || m === 'eels' ? ['Convergence', `${S.alpha} mrad`] : m === '4d' ? ['Convergence', `${S.alpha4d} mrad`]
      : m === 'diff' ? ['Selected area', `${f1(S.sa)} nm`] : m === 'cbed' ? ['Convergence', `${S.cbedKind === 'cbed' ? S.alphaCB : S.alphaLA} mrad`]
      : m === 'ronch' ? ['Ronchigram aperture', `${S.ronchAp} mrad`] : m === 'oah' ? ['Biprism', `${S.biprism} V`] : m === 'ilh' ? ['Focal step', `${f1(S.focalStep)} nm`]
      : m === 'ltem' ? ['Lorentz defocus', `${S.lorDf} µm`] : m === 'lstem' ? ['Probe semi-angle', `${Math.round(S.lorAlpha)} µrad`]
      : S.holder !== 'room' ? ['Temperature', `${S.tempSet < 20 ? S.tempSet.toFixed(1) : Math.round(S.tempSet)} K`] : ['Fine focus', `${S.df.toFixed(2)} nm`];
    const mf = this.mfNow(), abk = mf === 'stig' ? 'A1' : AB_KNOB[mf] ? mf : null;
    const mfv = abk ? `${abk} ${S.ab[abk].toFixed(abk === 'B2' || abk === 'A2' ? 0 : 1)} ${AB_KNOB[abk][2]}, ${S.ab[abk + 'a']}°` : mf === 'C3' ? `${S.csCor} µm` : this.mf === 'tilt' ? `${S.tiltX.toFixed(2)}°, ${S.tiltY.toFixed(2)}°` : `${(S.cx / 10).toFixed(1)}, ${(S.cy / 10).toFixed(1)} nm`;
    return {
      focus: ['Focus', `${S.df > 0 ? '+' : ''}${S.df.toFixed(1)} nm · ${this.fine ? 'fine' : 'coarse'}`],
      mag: diffMag ? ['Camera length', `${S.camL} mm`] : ['Magnification', `${S.fov.toFixed(1)} nm field`],
      intensity: ['Intensity', `${S.dose < 10 ? S.dose.toFixed(1) : Math.round(S.dose)} e⁻/Å²`],
      mf: [MF.find((x) => x[0] === mf)[1], mfv], context: ctx,
    };
  }

  apply() {
    const { S, sim } = this.api, M = this.map(), acc = this.acc;
    this.acc = {};
    const m = S.mode, sens = M.sens;
    if (acc.focus) {
      // one detent: 0.2 nm (corrected), 1 nm (uncorrected) or 10 nm (cryo-EM range); coarse ×5
      const step = (S.corrector ? 0.2 : S.spec === 'bio' ? 10 : 1) * (this.fine ? 1 : 5) * sens.focus;
      const lim = S.corrector ? [-CORR_RANGE.df, CORR_RANGE.df] : S.spec === 'bio' ? [-4000, 500] : [-150, 150];
      if (this.wob) this.wob.base = clamp(this.wob.base + acc.focus * step, ...lim);
      else this.api.set('df', +clamp(S.df + acc.focus * step, ...lim).toFixed(2), 'df');
      this.say(`Focus ${S.df > 0 ? '+' : ''}${S.df.toFixed(1)} nm`);
    }
    if (acc.mag) {
      // in diffraction the same knob changes the camera length, as on a real console
      if (m === 'diff' || (m === 'cbed' && S.cbedKind === 'cbed')) { this.api.set('camL', Math.round(clamp(S.camL * Math.pow(1.1, acc.mag * sens.mag), 80, 6000)), 'camL'); this.say(`Camera length ${S.camL} mm`); }
      else { this.api.set('fov', +clamp(S.fov * Math.pow(1.1, -acc.mag * sens.mag), 1.5, 120).toFixed(3), 'fov'); this.say(`Field of view ${S.fov.toFixed(1)} nm`); }
    }
    if (acc.intensity) { this.api.set('dose', +clamp(S.dose * Math.pow(1.12, acc.intensity * sens.intensity), 0.5, 20000).toFixed(2), 'dose'); this.say(`Dose ${S.dose < 10 ? S.dose.toFixed(1) : Math.round(S.dose)} e⁻/Å²`); }
    if (acc.mfX || acc.mfY) this.multifunction((acc.mfX ?? 0) * sens.mf, (acc.mfY ?? 0) * sens.mf);
    if (acc.context) this.context(acc.context * sens.context);
    if (acc.stage && this.stageV) {
      const f = sim.fovA() * 0.05 * sens.stage;
      this.api.moveStage(this.stageV[0] * f, this.stageV[1] * f);
    }
  }

  // multifunction X/Y: stigmator (A1 as a vector), image shift, or specimen tilt
  multifunction(dx, dy) {
    const o = this.api.mfOverride?.();
    if (o) { o.apply(dx, dy); this.say(o.label()); return; }
    const { S, sim } = this.api, mf = this.mfNow();
    const k = mf === 'stig' ? 'A1' : AB_KNOB[mf] ? mf : null;
    if (k) {
      // an n-fold term as an (X, Y) vector: magnitude and angle, with the vector turning at n × the angle
      const [n, step, unit] = AB_KNOB[k], a = S.ab, ph = (a[k + 'a'] * n * Math.PI) / 180;
      const max = mf === 'stig' && !this.corrOn() ? 100 : CORR_RANGE[k];
      const x = a[k] * Math.cos(ph) + dx * step, y = a[k] * Math.sin(ph) + dy * step;
      S.ab[k] = +Math.min(max, Math.hypot(x, y)).toFixed(2);
      S.ab[k + 'a'] = +((((Math.atan2(y, x) * 180) / Math.PI / n) + 360) % (360 / n)).toFixed(1); // 0.1°: at µm magnitudes 1° is a large residual
      sim.invalidate('ab'); this.api.refresh(); this.api.explain('ab');
      this.say(`${mf === 'stig' ? 'Stigmator' : MF.find((m) => m[0] === mf)[1]}: ${k} ${S.ab[k].toFixed(k === 'B2' || k === 'A2' ? 0 : 1)} ${unit} at ${S.ab[k + 'a']}°`);
    } else if (mf === 'C3') {
      this.api.set('csCor', +clamp(S.csCor + (dx - dy) * 0.5, -CORR_RANGE.cs, CORR_RANGE.cs).toFixed(1), 'cs');
      this.say(`Cₛ ${S.csCor} µm`);
    } else if (mf === 'shift') {
      const f = sim.fovA() * 0.01;
      this.api.moveStage(dx * f, dy * f);
      this.say('Image shift');
    } else {
      const L = S.mode === 'ltem' || S.mode === 'lstem' ? 30 : 3, st = L > 3 ? 0.25 : 0.02;
      this.api.set('tiltX', +clamp(S.tiltX + dx * st, -L, L).toFixed(2), 'tilt');
      this.api.set('tiltY', +clamp(S.tiltY + dy * st, -L, L).toFixed(2), 'tilt');
      this.say(`Tilt ${S.tiltX.toFixed(2)}°, ${S.tiltY.toFixed(2)}°`);
    }
  }

  // the context knob does whatever matters most in the current mode
  context(d) {
    const { S } = this.api, m = S.mode;
    const step = (key, inc, lo, hi, label, unit, digits = 1, inv = key) => { this.api.set(key, +clamp(S[key] + d * inc, lo, hi).toFixed(digits), inv); this.say(`${label} ${S[key]} ${unit}`); };
    if (m === 'stem' || m === 'eds' || m === 'eels') step('alpha', 0.5, 3, 40, 'Convergence', 'mrad', 1, 'alpha');
    else if (m === '4d') step('alpha4d', 0.5, 3, 40, 'Convergence', 'mrad', 1, 'alpha');
    else if (m === 'diff') step('sa', 0.2, 2, 12, 'Selected area', 'nm');
    else if (m === 'cbed') { if (S.cbedKind === 'cbed') step('alphaCB', 0.1, 0.5, 15, 'Convergence', 'mrad'); else step('alphaLA', 1, 15, 70, 'Convergence', 'mrad', 0); }
    else if (m === 'ronch') step('ronchAp', 1, 20, 70, 'Ronchigram aperture', 'mrad', 0);
    else if (m === 'oah') step('biprism', 2, 20, 250, 'Biprism', 'V', 0);
    else if (m === 'ilh') step('focalStep', 0.5, 0.5, 20, 'Focal step', 'nm');
    else if (m === 'ltem') step('lorDf', 20, -3000, 3000, 'Lorentz defocus', 'µm', 0);
    else if (m === 'lstem') step('lorAlpha', 10, 20, 3000, 'Probe semi-angle', 'µrad', 0);
    else if (S.holder !== 'room') step('tempSet', S.holder === 'heat' ? 10 : 1, -Infinity, Infinity, 'Temperature setpoint', 'K', 1);
    else { this.fine = true; this.acc.focus = (this.acc.focus ?? 0) + d; this.apply(); }
  }

  // focus wobbler: flick the defocus up and down around the set value; contrast flickers least near focus
  toggleWobbler() {
    const { S } = this.api;
    if (this.wob) { this.api.set('df', this.wob.base, 'df'); this.wob = null; this.say('Wobbler off'); return; }
    this.wob = { base: S.df, t: 0, sign: 1 };
    this.say('Wobbler on');
  }
  wobble(dt) {
    if (!this.wob) return;
    const { S } = this.api;
    this.wob.t += dt;
    if (this.wob.t < 0.3) return;
    this.wob.t = 0; this.wob.sign *= -1;
    const amp = S.corrector ? 2 : S.spec === 'bio' ? 100 : 10;
    this.api.setRaw('df', +(this.wob.base + this.wob.sign * amp).toFixed(2), 'df');
  }

  // heads-up display
  hud(el) {
    if (!this.pad || this.virtual) { el.hidden = true; return; } // the on-screen panel shows the same itself
    el.hidden = false;
    const fresh = performance.now() - this.msgT < 2500;
    el.innerHTML = `<b>${esc(shortName(this.pad.id))}</b><span>${this.kind === 'panel' ? 'panel' : 'controller'}</span>
      <div class="mf">${this.mfList().map(([k, l]) => `<i class="${k === this.mf ? 'on' : ''}">${l}</i>`).join('')}</div>
      <small>focus ${this.fine ? 'fine' : 'coarse'}${this.wob ? ' · wobbler' : ''}</small>
      <p class="${fresh ? 'fresh' : ''}">${esc(this.msg)}</p>`;
  }

  // configuration dialog: live inputs, mapping, inversion, sensitivity
  renderConfig(el) {
    const gp = this.pad, M = gp ? this.map() : null;
    const vbtns = `<div class="crow"><button class="btn primary" data-vp="dock">On-screen panel (V)</button><button class="btn" data-vp="window">Pop out panel</button><span class="muted">Drive the microscope with the keyboard and mouse: the same knobs and buttons as the hardware panel.</span></div>`;
    const wireV = () => el.querySelectorAll('[data-vp]').forEach((b) => b.addEventListener('click', () => { el.closest('.modal').hidden = true; this.api.openVirtual(b.dataset.vp); }));
    if (!gp) {
      el.innerHTML = `<p class="eyebrow">Control panel</p><h2>Connect a <em>panel</em>, or use the keyboard</h2>${vbtns}
        <p>Plug in a TEM-view panel or any game controller over USB or Bluetooth, then <b>press one of its buttons</b>: browsers only reveal a controller after it has been used.</p>
        <p class="muted">The panel is a USB joystick ("TEM-view Panel", 8 axes, 16 buttons). Its reference firmware and wiring are in the repository under <code>hardware/panel</code>.</p>
        <p><a href="console/" target="_blank" rel="noopener">The TEM-view Console</a>: the physical panel, in development for Kickstarter.</p>`;
      wireV();
      return;
    }
    const opt = (n, sel) => `<option value="-1">—</option>${Array.from({ length: n }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`).join('')}`;
    const axisRows = (this.kind === 'panel' ? AXES : AXES.filter(([k]) => ['stageX', 'stageY', 'mfX', 'mfY'].includes(k)));
    const btnList = this.kind === 'panel' ? BUTTONS : [...BUTTONS.filter(([k]) => !['labels', 'narrate', 'expand', 'calib'].includes(k)), ['focusUp', 'Focus + (trigger)'], ['focusDown', 'Focus − (trigger)'], ['magUp', 'Magnification +'], ['magDown', 'Magnification −'], ['intensityUp', 'Intensity +'], ['intensityDown', 'Intensity −']];
    el.innerHTML = `<p class="eyebrow">Control panel · ${this.kind === 'panel' ? 'TEM-view panel protocol' : 'standard game controller'}</p>
      <h2>${esc(shortName(gp.id))}</h2>
      <p class="muted">Turn a knob or press a button to see its number light up, then assign it below. Settings are saved in this browser.</p>
      <div class="pgrid">
        <div><h4>Axes</h4><table class="data pin">${axisRows.map(([k, l]) => `<tr><td>${l}</td><td><select data-ax="${k}">${opt(gp.axes.length, M.axes[k])}</select> <label class="inv"><input type="checkbox" data-inv="${k}" ${M.invert[k] ? 'checked' : ''}>invert</label></td></tr>`).join('')}</table></div>
        <div><h4>Buttons</h4><table class="data pin">${btnList.map(([k, l]) => `<tr><td>${l}</td><td><select data-bt="${k}">${opt(gp.buttons.length, M.buttons[k])}</select></td></tr>`).join('')}</table></div>
      </div>
      <h4>Live input</h4><div class="plive" id="pLive"></div>
      <h4>Sensitivity</h4><div class="cgrid">${Object.keys(M.sens).map((k) => `<label>${k}<input type="number" step="0.1" min="0.1" max="10" data-sens="${k}" value="${M.sens[k]}"></label>`).join('')}${this.kind === 'panel' ? `<label>Encoder counts per detent<input type="number" step="1" min="1" max="8" id="pCounts" value="${M.counts}"></label>` : ''}</div>
      <div class="crow"><button class="btn" id="pReset">Reset to defaults</button></div>${vbtns}`;
    wireV();
    el.querySelectorAll('[data-ax]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.axes[s.dataset.ax]; else M.axes[s.dataset.ax] = v; this.prevAxes = null; this.saveMap(); }));
    el.querySelectorAll('[data-bt]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.buttons[s.dataset.bt]; else M.buttons[s.dataset.bt] = v; this.saveMap(); }));
    el.querySelectorAll('[data-inv]').forEach((c) => c.addEventListener('change', () => { M.invert[c.dataset.inv] = c.checked; this.saveMap(); }));
    el.querySelectorAll('[data-sens]').forEach((c) => c.addEventListener('change', () => { M.sens[c.dataset.sens] = clamp(+c.value || 1, 0.1, 10); this.saveMap(); }));
    el.querySelector('#pCounts')?.addEventListener('change', (e) => { M.counts = clamp(Math.round(+e.target.value) || 4, 1, 8); this.saveMap(); });
    el.querySelector('#pReset').addEventListener('click', () => { this.resetMap(); this.renderConfig(el); });
  }
  renderLive(el) {
    const gp = this.pad;
    if (!gp || !el) return;
    el.innerHTML = `<div>${gp.axes.map((v, i) => `<span class="ax"><b>${i}</b><i style="--v:${((v + 1) / 2) * 100}%"></i></span>`).join('')}</div>
      <div>${gp.buttons.map((b, i) => `<span class="bt ${b.value > 0.5 ? 'on' : ''}">${i}</span>`).join('')}</div>`;
  }
}

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const shortName = (id) => String(id).replace(/\s*\(.*?Vendor.*?\)\s*/i, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
