// TEM direct alignments, as a guided training scenario: the order a microscopist follows on a FEG instrument.
//   1 Gun            Flash & Go when the emission has decayed (cold FEG only: a Schottky source runs hot and stays steady); gun shift (crossover walks with spot size) and gun tilt
//                    (screen current) at crossover
//   2 Illumination   beam centered at crossover; C2 aperture centered (the beam spreads concentrically); condenser
//                    astigmatism (round through both sides of focus)
//   3 Eucentric      alpha wobbler + stage Z until the image only pulses in place
//   4 Pivot points   beam-tilt pivot points X and Y (the two wobbler spots merge); voltage (HT) center with beam tilt
//                    (the image pulses symmetrically about the screen center)
//   5 Objective      objective stigmator on the Thon rings (the exhibit's own TEM image and live FFT)
//
// Each knob carries a hidden offset (S.mis.align); the knob setting that cancels it is the aligned one. Positions
// are in screen units (1 = the screen's radius). The fluorescent screen is drawn over the detector view.

const STEPS = [
  { id: 'gun', title: 'Gun', short: 'Flash & Go (cold FEG only) · gun shift · gun tilt' },
  { id: 'ill', title: 'Illumination', short: 'Crossover · C2 aperture · condenser stigmator' },
  { id: 'z', title: 'Eucentric height', short: 'Alpha wobbler · stage Z' },
  { id: 'pp', title: 'Pivot points & voltage center', short: 'Beam-tilt pivot points · HT wobbler' },
  { id: 'stig', title: 'Objective stigmator', short: 'Thon rings in the live FFT' },
];
// knobs shown in each step: [key, label, kind] — xy knobs are pads, 'z' is the stage height
const KNOBS = {
  gun: [['gunShift', 'Gun shift', 'xy'], ['gunTilt', 'Gun tilt', 'xy']],
  ill: [['beamShift', 'Beam shift', 'xy'], ['c2', 'C2 aperture', 'xy'], ['condStig', 'Condenser stigmator', 'xy']],
  z: [['z', 'Stage Z', 'z']],
  pp: [['ppX', 'Pivot point X', 'xy'], ['ppY', 'Pivot point Y', 'xy'], ['rot', 'Beam tilt (voltage center)', 'xy']],
  stig: [],
};
const TOL = { gunShift: 0.03, gunTilt: 0.12, beamShift: 0.03, c2: 0.03, condStig: 0.035, z: 0.5, ppX: 0.03, ppY: 0.03, rot: 0.03 };
const XY = ['gunShift', 'gunTilt', 'beamShift', 'c2', 'condStig', 'ppX', 'ppY', 'rot'];
// Flash & Go applies only to a cold field-emission source; Schottky (and thermionic) guns have steady emission
export const isColdFEG = (S) => /cold/i.test(S.profile?.gun ?? '');
const hyp = (v) => Math.hypot(v[0], v[1]);
const r3 = (v) => +v.toFixed(3);
// pads are round and span the unit disk: 1 is the rim. The dot's center travels 46 px, so it stays inside the 104 px pad
const PAD_TRAVEL = 46;
const padClamp = (x, y) => { const m = Math.max(1, Math.hypot(x, y)); return [r3(x / m), r3(y / m)]; };
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// effective misalignment = knob + hidden offset (aligned when ≈ 0)
function eff(S, k) {
  const A = S.align, H = S.mis.align;
  return k === 'z' ? A.z + H.z : [A[k][0] + H[k][0], A[k][1] + H[k][1]];
}

export const ALIGN_SCENARIO = {
  title: 'TEM: direct alignments',
  short: 'The full routine on a FEG TEM: gun, illumination and C2, eucentric height, pivot points and voltage center, then the objective stigmator.',
  brief: 'Every alignment is off by a hidden amount, as after a column bake or a gun refresh. Work through the five steps in order, using the cues on the fluorescent screen, then press <b>I\'m done</b>.',
  cues: ['Screen current is maximal', 'Crossover stays put with spot size', 'Beam expands concentrically', 'Beam stays round through focus', 'Image stops moving with the alpha wobbler', 'Wobbler spots merge', 'Image pulses without swinging', 'Thon rings are round', 'Guessed'],
  blocked: ['autotune', 'scramble'],

  setup(api, rng) {
    const { S } = api;
    const sg = () => (rng() < 0.5 ? -1 : 1), v = (lo, hi) => { const a = rng() * Math.PI * 2, r = lo + rng() * (hi - lo); return [r3(r * Math.cos(a)), r3(r * Math.sin(a))]; };
    Object.assign(S, { corrector: false, objAp: 'none', camera: 'screen', clarity: 'edu' });
    api.setSpec('au'); api.setMode('tem');
    S.ab = { A1: 0, A1a: 0, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 };
    const cold = isColdFEG(S);
    S.align = { step: 0, cold, emission: cold ? 0.55 : 1, flashT: -1, spot: 5, bright: 0.45, z: 0, wob: null, sel: 'gunShift', ...Object.fromEntries(XY.map((k) => [k, [0, 0]])) };
    const hidden = { gunShift: v(0.12, 0.25), gunTilt: v(0.5, 1.0), beamShift: v(0.2, 0.4), c2: v(0.15, 0.3), condStig: v(0.12, 0.25), z: r3(sg() * (3 + rng() * 7)),
      ppX: v(0.1, 0.2), ppY: v(0.1, 0.2), rot: v(0.1, 0.2) };
    const A1 = 15 + rng() * 25, A1a = rng() * 180, ph = (A1a * Math.PI) / 90;
    S.mis = { df: 0, C3: 0, A1: [r3(A1 * Math.cos(ph)), r3(A1 * Math.sin(ph))], B2: [0, 0], A2: [0, 0], A3: [0, 0], align: hidden };
    return { hidden: { mis: S.mis, A1: r3(A1), A1a: r3(A1a) }, target: { tolerances: TOL, gun: S.profile?.gun ?? null, emission_min: cold ? 0.9 : null, A1_nm: 2 } };
  },

  metrics(api) {
    const { S, sim } = api, out = {};
    if (!S.align || !S.mis?.align) return {};
    let pass = 0, n = 0;
    for (const k of Object.keys(TOL)) {
      const e = k === 'z' ? Math.abs(eff(S, k)) : hyp(eff(S, k));
      out[`${k}_err`] = r3(e); n++; if (e <= TOL[k]) pass++;
    }
    out.emission = r3(S.align.emission);
    if (S.align.cold) { n++; if (S.align.emission >= 0.9) pass++; }
    const A1 = sim.abA().A1 / 10; out.A1_true_nm = +A1.toFixed(2); n++; if (A1 <= 2) pass++;
    out.cold = !!S.align.cold; out.dose = r3(sim.doseAcc || 0); out.passed = pass; out.score = Math.round((100 * pass) / n); out.success = pass === n;
    return out;
  },

  explain(m) {
    const ok = (b) => (b ? '✓' : '✗');
    return `Gun: ${m.cold ? `emission ${Math.round(m.emission * 100)} % ${ok(m.emission >= 0.9)}, ` : ''}gun shift ${ok(m.gunShift_err <= TOL.gunShift)}, gun tilt ${ok(m.gunTilt_err <= TOL.gunTilt)}.
      Illumination: crossover ${ok(m.beamShift_err <= TOL.beamShift)}, C2 aperture ${ok(m.c2_err <= TOL.c2)}, condenser stigmator ${ok(m.condStig_err <= TOL.condStig)}.
      Eucentric height off by ${m.z_err} µm ${ok(m.z_err <= TOL.z)}. Pivot points X ${ok(m.ppX_err <= TOL.ppX)} and Y ${ok(m.ppY_err <= TOL.ppY)}, voltage center ${ok(m.rot_err <= TOL.rot)}.
      Objective astigmatism ${m.A1_true_nm} nm ${ok(m.A1_true_nm <= 2)}. ${m.passed} of ${Object.keys(TOL).length + (m.cold ? 2 : 1)} checks passed. The order matters: an off-center C2 or a wrong height makes every later alignment drift.`;
  },

  // ---------------------------------------------------------------- the card: steps, controls, readouts
  mount(api, card) {
    const S = api.S;
    const body = document.createElement('div'); body.className = 'algn';
    card.querySelector('.scnbrief').after(body);
    this.ui = { api, body, card };
    this.render();
    // the fluorescent screen, over the detector image
    const host = document.getElementById('detMain').parentElement;
    const cv = document.createElement('canvas'); cv.id = 'alignScreen'; cv.className = 'alignscreen';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(cv); this.ui.cv = cv; this.ui.t0 = performance.now();
    S.align.flashT = -1;
  },
  unmount() {
    this.ui?.cv?.remove(); this.ui?.body?.remove(); this.ui = null;
  },

  render() {
    const { api, body } = this.ui, A = api.S.align, st = STEPS[A.step];
    const knobs = KNOBS[st.id];
    body.innerHTML = `
      <div class="algn-steps">${STEPS.map((s, i) => `<button data-step="${i}" class="${i === A.step ? 'on' : ''}" title="${esc(s.short)}">${i + 1}<span>${esc(s.title)}</span></button>`).join('')}</div>
      <p class="algn-how">${st.id === 'gun' ? HOW_GUN(A.cold, api.S.profile?.gun) : HOW[st.id]}</p>
      <div class="algn-row">${st.id === 'gun' && !A.cold ? CONTROLS.gun.replace(FLASH_BTN, '') : CONTROLS[st.id] ?? ''}</div>
      <div class="algn-knobs">${knobs.map(([k, l, kind]) => kind === 'xy'
        ? `<div class="algn-pad${A.sel === k ? ' sel' : ''}" data-k="${k}"><b>${esc(l)}</b><div class="pad"><i></i></div><small></small></div>`
        : `<div class="algn-z${A.sel === k ? ' sel' : ''}" data-k="${k}"><b>${esc(l)}</b><div class="zrow"><button data-dz="-1">−1</button><button data-dz="-0.1">−0.1</button><span></span><button data-dz="0.1">+0.1</button><button data-dz="1">+1</button></div><small>µm</small></div>`).join('')}</div>
      <p class="algn-read"></p>
      <div class="crow"><button class="btn" data-nav="-1" ${A.step ? '' : 'disabled'}>◀ Previous</button><button class="btn" data-nav="1" ${A.step < STEPS.length - 1 ? '' : 'disabled'}>Next step ▶</button></div>`;
    body.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => this.go(+b.dataset.step)));
    body.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => this.go(A.step + +b.dataset.nav)));
    body.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => this.act(b.dataset.act)));
    const bright = body.querySelector('#alBright');
    if (bright) bright.value = A.bright;
    if (bright) bright.oninput = () => { A.bright = +bright.value; api.noteSource?.('mouse'); };
    body.querySelectorAll('.algn-pad').forEach((p) => this.wirePad(p));
    body.querySelectorAll('.algn-z').forEach((z) => { z.onclick = () => this.select('z'); z.querySelectorAll('[data-dz]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); this.select('z'); A.z = +(A.z + +b.dataset.dz).toFixed(2); })); });
    if (!knobs.some(([k]) => k === A.sel) && knobs.length) A.sel = knobs[0][0];
    this.update();
  },
  go(i) {
    const A = this.ui.api.S.align;
    A.step = Math.max(0, Math.min(STEPS.length - 1, i)); A.wob = null;
    this.render();
  },
  select(k) { this.ui.api.S.align.sel = k; this.ui.body.querySelectorAll('[data-k]').forEach((e) => e.classList.toggle('sel', e.dataset.k === k)); },
  act(a) {
    const A = this.ui.api.S.align;
    if (a === 'flash') { if (!A.cold) return; A.flashT = performance.now(); A.emission = 1; }
    else if (a === 'spot-') A.spot = Math.max(1, A.spot - 1);
    else if (a === 'spot+') A.spot = Math.min(9, A.spot + 1);
    else if (a.startsWith('wob:')) { const w = a.slice(4); A.wob = A.wob === w ? null : w; }
    this.update();
  },
  wirePad(el) {
    const k = el.dataset.k, A = this.ui.api.S.align, pad = el.querySelector('.pad');
    let on = false;
    const set = (e) => {
      const r = pad.getBoundingClientRect();
      A[k] = padClamp((e.clientX - r.left - r.width / 2) / PAD_TRAVEL, -(e.clientY - r.top - r.height / 2) / PAD_TRAVEL);
    };
    el.addEventListener('pointerdown', () => this.select(k));
    pad.addEventListener('pointerdown', (e) => { on = true; pad.setPointerCapture(e.pointerId); this.ui.api.noteSource?.(e.pointerType === 'touch' ? 'touch' : 'mouse'); set(e); });
    pad.addEventListener('pointermove', (e) => { if (on) set(e); });
    pad.addEventListener('pointerup', () => { on = false; });
    pad.addEventListener('wheel', (e) => { e.preventDefault(); this.select(k); A[k] = padClamp(A[k][0], A[k][1] - Math.sign(e.deltaY) * 0.005); }, { passive: false });
  },
  // the panel's multifunction knobs drive the selected control (fine steps)
  mf() {
    if (!this.ui) return null;
    const A = this.ui.api.S.align, k = A.sel;
    if (!k) return null;
    return {
      label: () => (k === 'z' ? `Stage Z ${A.z.toFixed(2)} µm` : `${KNOBS[STEPS[A.step].id].find((x) => x[0] === k)?.[1] ?? k}: ${A[k][0].toFixed(3)}, ${A[k][1].toFixed(3)}`),
      apply: (dx, dy) => { if (k === 'z') A.z = +(A.z + (dx - dy) * 0.05).toFixed(2); else A[k] = padClamp(A[k][0] + dx * 0.004, A[k][1] + dy * 0.004); },
    };
  },

  update() {
    if (!this.ui) return;
    const { api, body } = this.ui, A = api.S.align;
    body.querySelectorAll('.algn-pad').forEach((p) => {
      const v = A[p.dataset.k];
      p.querySelector('i').style.transform = `translate(${v[0] * PAD_TRAVEL}px, ${-v[1] * PAD_TRAVEL}px)`;
      p.querySelector('small').textContent = `${v[0].toFixed(3)}, ${v[1].toFixed(3)}`;
    });
    const zs = body.querySelector('.algn-z span'); if (zs) zs.textContent = A.z.toFixed(2);
    body.querySelectorAll('[data-act^="wob:"]').forEach((b) => b.classList.toggle('on', b.dataset.act === `wob:${A.wob}`));
    const sp = body.querySelector('#alSpot'); if (sp) sp.textContent = A.spot;
    const r = this.read();
    body.querySelector('.algn-read').innerHTML = `${A.cold ? `Emission <b>${Math.round(A.emission * 100)} %</b> · ` : ''}Screen current <b>${r.current.toFixed(0)} pA</b> · spot <b>${A.spot}</b> · ${Math.abs(A.bright) < 0.04 ? '<b>at crossover</b>' : `brightness ${A.bright > 0 ? 'over' : 'under'}focused`}`;
  },

  // what the screen shows right now
  read() {
    const S = this.ui.api.S, A = S.align;
    const gs = eff(S, 'gunShift'), gt = eff(S, 'gunTilt'), bs = eff(S, 'beamShift'), c2 = eff(S, 'c2'), cs = eff(S, 'condStig');
    const g = (A.spot - 5) / 4;
    const cx = bs[0] + gs[0] * g + c2[0] * A.bright, cy = bs[1] + gs[1] * g + c2[1] * A.bright;
    const R0 = 0.035 * (1.6 - A.spot / 10), R = R0 + 0.85 * Math.abs(A.bright);
    const tilt = Math.exp(-(hyp(gt) ** 2) / 0.32), spotI = 9 / (A.spot + 3.5);
    const current = 820 * A.emission * tilt * spotI;
    return { cx, cy, R, R0, cs, current, tilt };
  },

  tick(api, dt) {
    if (!this.ui) return;
    const S = api.S, A = S.align;
    // cold FEG: the emission decays and gets noisier until the next Flash & Go (a Schottky gun stays steady)
    if (A.cold) A.emission = Math.max(0.35, A.emission * Math.exp(-dt / 140));
    this.draw(dt);
    this.frame = (this.frame ?? 0) + 1;
    if (this.frame % 6 === 0) this.update();
    // step 5 shows the exhibit's own TEM image and FFT
    this.ui.cv.hidden = A.step === 4;
  },

  draw() {
    const { api, cv } = this.ui, S = api.S, A = S.align;
    const host = cv.parentElement, src = document.getElementById('detMain');
    const W = src.clientWidth, H = src.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!W || !H) return;
    cv.style.left = `${src.offsetLeft}px`; cv.style.top = `${src.offsetTop}px`; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, u = Math.min(w, h) / 2, X = w / 2, Yc = h / 2;
    const t = (performance.now() - this.ui.t0) / 1000;
    c.fillStyle = '#020403'; c.fillRect(0, 0, w, h);
    const r = this.read();

    // specimen image under the beam: shifts with the alpha wobbler, pulses about the voltage center with the HT wobbler
    let ox = 0, oy = 0, sc = 1, px = 0, py = 0;
    if (A.wob === 'alpha') { ox = eff(S, 'z') * 0.035 * Math.sin(2 * Math.PI * 0.7 * t); }
    if (A.wob === 'ht') { const rc = eff(S, 'rot'); sc = 1 + 0.03 * Math.sin(2 * Math.PI * 1.1 * t); px = rc[0] * 1.6; py = -rc[1] * 1.6; }
    c.save();
    c.translate(X + (px + ox) * u, Yc + py * u); c.scale(sc, sc); c.translate(-X - px * u, -Yc - py * u);
    c.globalAlpha = 0.9; c.drawImage(src, 0, 0, w, h);
    c.restore();

    // the beam: one spot, or two when a pivot-point wobbler shows a misaligned pivot
    const spots = [];
    if (A.wob === 'ppx' || A.wob === 'ppy') { const e = eff(S, A.wob === 'ppx' ? 'ppX' : 'ppY'); spots.push([r.cx + e[0], r.cy + e[1]], [r.cx - e[0], r.cy - e[1]]); }
    else spots.push([r.cx, r.cy]);
    // condenser astigmatism: elliptical when spread, the long axis turning by 90° through focus
    const csM = hyp(r.cs), ang = Math.atan2(r.cs[1], r.cs[0]) / 2 + (A.bright < 0 ? Math.PI / 2 : 0);
    const k = 1 + 2.2 * csM * Math.min(1, Math.abs(A.bright) * 3);
    const a = r.R * k, b = r.R / k;
    const flicker = 1 - (1 - A.emission) * 0.25 * Math.random();
    // a dim beam is still visible: brighter with more current and when focused small, as on a real screen
    const lum = Math.min(1, (0.18 + 0.82 * Math.min(1, r.current / 820) ** 0.6) * (0.3 + 0.7 * (r.R0 / r.R) ** 0.35)) * flicker / spots.length;
    const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
    const m = mask.getContext('2d');
    for (const [sx, sy] of spots) {
      m.save(); m.translate(X + sx * u, Yc - sy * u); m.rotate(-ang); m.scale(a * u, b * u);
      const gr = m.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, `rgba(255,255,255,${Math.min(1, lum * 1.2)})`); gr.addColorStop(0.85, `rgba(255,255,255,${lum})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      m.fillStyle = gr; m.beginPath(); m.arc(0, 0, 1, 0, Math.PI * 2); m.fill(); m.restore();
    }
    // keep the specimen only where the beam falls, then add the screen's green glow
    c.globalCompositeOperation = 'destination-in'; c.drawImage(mask, 0, 0);
    c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#020403'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55;
    c.filter = 'blur(2px)'; c.drawImage(mask, 0, 0); c.filter = 'none';
    c.globalCompositeOperation = 'multiply'; c.globalAlpha = 1; c.fillStyle = '#7dffb0'; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
    // screen furniture: center mark and circle, as on a fluorescent screen
    c.strokeStyle = 'rgba(180,255,210,0.25)'; c.lineWidth = Math.max(1, dpr);
    c.beginPath(); c.arc(X, Yc, u * 0.95, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(X - 10 * dpr, Yc); c.lineTo(X + 10 * dpr, Yc); c.moveTo(X, Yc - 10 * dpr); c.lineTo(X, Yc + 10 * dpr); c.stroke();
    c.fillStyle = 'rgba(180,255,210,0.7)'; c.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
    c.fillText(`fluorescent screen · ${STEPS[A.step].title}${A.wob ? ` · ${{ alpha: 'α wobbler', ht: 'HT wobbler', ppx: 'pivot-point X wobbler', ppy: 'pivot-point Y wobbler' }[A.wob]}` : ''}`, 10 * dpr, 18 * dpr);
    if (A.flashT > 0 && performance.now() - A.flashT < 1200) { c.fillStyle = `rgba(255,255,255,${0.6 * (1 - (performance.now() - A.flashT) / 1200)})`; c.fillRect(0, 0, w, h); }
  },
};

const HOW = {
  gun: 'Bring the beam to crossover (brightness at the middle). Step the <b>spot size</b> up and down: if the crossover walks, correct it with <b>gun shift</b>. Then maximize the <b>screen current</b> with <b>gun tilt</b>.',
  ill: 'At crossover, center the spot with <b>beam shift</b>. Spread the beam with the brightness: if it does not expand concentrically about the center, move the <b>C2 aperture</b>. If it is elliptical when spread, correct the <b>condenser stigmator</b> until it stays round on <b>both sides</b> of focus.',
  z: 'Turn on the <b>α wobbler</b> (the stage rocks ±15°). Adjust <b>stage Z</b> until the image stops shifting sideways and only pulses in place: the specimen is then at the eucentric height.',
  pp: 'With a small spot near crossover, turn on the <b>pivot-point X wobbler</b>: two spots mean the pivot is off; merge them with <b>pivot point X</b>. Repeat for Y. Then turn on the <b>HT wobbler</b> and adjust <b>beam tilt</b> until the image pulses symmetrically about the screen center without swinging: the voltage (coma-free) center.',
  stig: 'Now the objective: switch the right-hand view to the FFT if needed, and use the <b>objective stigmator</b> (sliders in the controls, or the multifunction knobs) until the Thon rings are round. Then press <b>I\'m done</b>.',
};
const HOW_GUN = (cold, gun) => (cold
  ? 'This is a <b>cold FEG</b>: its emission falls over time as gas adsorbs on the tip, so press <b>Flash &amp; Go</b> when it has dropped. '
  : `This is a <b>${esc(gun || 'Schottky FEG')}</b>: it runs hot and its emission stays steady, so there is no Flash &amp; Go (that is only for cold-FEG sources; pick the cold-FEG instrument profile to practice it). `) + HOW.gun;
const FLASH_BTN = '<button class="btn" data-act="flash">⚡ Flash &amp; Go</button>';
const CONTROLS = {
  gun: FLASH_BTN + '<span class="algn-spot">Spot <button data-act="spot-">−</button><b id="alSpot"></b><button data-act="spot+">+</button></span><label class="algn-bright">Brightness <input id="alBright" type="range" min="-1" max="1" step="0.01" value="0.45"></label>',
  ill: '<label class="algn-bright">Brightness <input id="alBright" type="range" min="-1" max="1" step="0.01" value="0.45"></label><span class="algn-spot">Spot <button data-act="spot-">−</button><b id="alSpot"></b><button data-act="spot+">+</button></span>',
  z: '<button class="btn" data-act="wob:alpha">α wobbler</button>',
  pp: '<button class="btn" data-act="wob:ppx">PP X wobbler</button><button class="btn" data-act="wob:ppy">PP Y wobbler</button><button class="btn" data-act="wob:ht">HT wobbler</button><label class="algn-bright">Brightness <input id="alBright" type="range" min="-1" max="1" step="0.01" value="0.45"></label>',
  stig: '',
};
