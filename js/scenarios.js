// Training scenarios: alignment tasks with a hidden answer, recorded (with consent) for behavior research.
// Each scenario hides a seeded misalignment in S.mis, so the knob readings are not the true aberrations,
// and defines metrics the participant never sees until the end: how far the true optics are from the target.
import * as P from './physics.js';
import { Recorder } from './telemetry.js';
import { SHARE } from './config.js';

const DEG = Math.PI / 180;
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const vec = (mag, ang, n) => [mag * Math.cos(n * ang * DEG), mag * Math.sin(n * ang * DEG)];
const r1 = (v, d = 1) => +v.toFixed(d);

// largest angle (mrad) inside which the aberration phase stays within ±π/4 (the Ronchigram's flat region)
export function flatAngle(lam, df, Cs, ab, apMrad) {
  const ap = apMrad * 1e-3;
  for (let r = 0.0002; r <= ap; r += 0.00025)
    for (let k = 0; k < 72; k++) if (Math.abs(P.chiAngle(r, (k / 72) * 2 * Math.PI, lam, df, Cs, ab)) > Math.PI / 4) return Math.max(0.5, (r - 0.00025) * 1000);
  return apMrad;
}

export const SCENARIOS = {
  'tem-focus-stig': {
    title: 'TEM: focus and stigmate',
    short: 'Gold at high magnification with hidden astigmatism and defocus. Make the Thon rings round and reach Scherzer focus.',
    brief: 'The objective lens is out of focus and astigmatic, and the knob readings do not tell you by how much. Using the image and its Fourier transform (Thon rings), bring the lens to <b>Scherzer focus</b> with <b>no astigmatism</b>. Use the Defocus slider and the objective stigmator (X, Y) sliders, the panel or the keyboard. When you think it is aligned, press <b>I\'m done</b>.',
    cues: ['Thon rings are round', 'Thon rings reach far out', 'Image looks sharp', 'Fringes or atoms visible', 'Contrast of the carbon film', 'Followed the transfer-function plot', 'Guessed'],
    setup(api, rng) {
      const { S, sim } = api;
      api.setSpec('au');
      Object.assign(S, { corrector: false, csUnc: S.profile.CsUnc, objAp: 'none', fov: 20, cx: -150, cy: 140, df: 0, dose: 400, clarity: 'edu', camera: 'ded', tiltX: 0, tiltY: 0 });
      S.ab = { A1: 0, A1a: 0, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 };
      const lam = P.wavelength(S.kV), dfT = P.scherzerDefocus(S.csUnc * 1e7, lam) / 10;
      // hidden: a defocus offset that keeps the needed knob setting inside ±140 nm, and 15–50 nm of two-fold astigmatism
      let off;
      do off = dfT - 140 + rng() * 280; while (Math.abs(dfT - off) < 40);
      const a1 = 15 + rng() * 35, ang = rng() * 180;
      S.mis = { df: r1(off), C3: 0, A1: vec(a1, ang, 2).map((v) => r1(v, 2)), B2: [0, 0], A2: [0, 0], A3: [0, 0] };
      api.setMode('tem');
      S.dfFam.tem = 0; S.df = 0;
      return { hidden: { mis: S.mis, A1: r1(a1), A1a: r1(ang) }, target: { df_true_nm: r1(dfT), A1_nm: 0, phase_error_max: 1 } };
    },
    // phase error at the point-resolution frequency, in units of π/4 (≤ 1: the Rayleigh quarter-wave criterion)
    metrics(api, sc) {
      const { S, sim } = api, lam = sim.lam, Cs = sim.CsA(), ab = sim.abA(), df = sim.dfA(), dfT = sc.target.df_true_nm * 10;
      const k0 = 1 / P.pointResolution(Cs, lam);
      let err = 0;
      for (let i = 0; i < 72; i++) {
        const ph = (i / 72) * 2 * Math.PI, kx = k0 * Math.cos(ph), ky = k0 * Math.sin(ph);
        err = Math.max(err, Math.abs(P.chiFull(kx, ky, lam, df, Cs, ab) - P.chiFull(kx, ky, lam, dfT, Cs, null)));
      }
      const pe = err / (Math.PI / 4);
      return { score: Math.round(100 * Math.max(0, 1 - pe / 4)), phase_error: r1(pe, 3), df_err_nm: r1(df / 10 - sc.target.df_true_nm, 2), A1_true_nm: r1(ab.A1 / 10, 2), dose: r1(sim.doseAcc || 0), success: pe <= 1 };
    },
    explain: (m, sc) => `Scherzer focus here is ${sc.target.df_true_nm} nm. You ended ${m.df_err_nm > 0 ? '+' : ''}${m.df_err_nm} nm from it, with ${m.A1_true_nm} nm of two-fold astigmatism left. Together they shift the phase of the finest detail the lens can transfer by ${m.phase_error}× a quarter wavelength (≤ 1 counts as aligned). Experts usually set astigmatism first, making the Thon rings round, and then defocus, counting rings or matching the first ring to Scherzer's broad passband.`,
  },
  'corrector-ronch': {
    title: 'Corrector: tune the Ronchigram',
    short: 'A drifted probe corrector: hidden C1, A1, B2, A2, C3 and A3. Grow the flat center of the Ronchigram to 30 mrad.',
    brief: 'The probe corrector has drifted: defocus, spherical aberration and several asymmetric aberrations are present, and the slider readings are not the true values. On the Ronchigram of amorphous carbon, make the flat, featureless center as <b>large and round</b> as you can (target: at least <b>30 mrad</b>). Adjust defocus, Cₛ and the A1, B2, A2, A3 magnitudes and angles with the sliders, or with the control panel (<kbd>V</kbd>): <kbd>Tab</kbd> picks what the multifunction knobs (<kbd>H</kbd>/<kbd>L</kbd>, <kbd>K</kbd>/<kbd>J</kbd>, Shift for big steps) drive: stigmator A1, coma B2, 3-fold A2, 4-fold A3 or Cₛ. Auto-tune is disabled. Press <b>I\'m done</b> when you are satisfied.',
    cues: ['Flat center is large', 'Flat center is round', 'Streaks or rings gone', 'Symmetry of the pattern', 'Used the phase plate panel', 'Used the aberration budget bars', 'Guessed'],
    setup(api, rng) {
      const { S } = api;
      Object.assign(S, { corrector: true, csCor: 0, ronchAp: 45, df: 0, clarity: 'edu' });
      S.ab = { A1: 0, A1a: 0, B2: 0, B2a: 0, A2: 0, A2a: 0, A3: 0, A3a: 0 };
      const sg = () => (rng() < 0.5 ? -1 : 1), h = { df: sg() * (2 + rng() * 38), C3: sg() * (6 + rng() * 54), A1: [8 + rng() * 110, rng() * 180], B2: [120 + rng() * 2400, rng() * 360], A2: [120 + rng() * 2400, rng() * 120], A3: [rng() * 15, rng() * 90] };
      S.mis = { df: r1(h.df, 2), C3: r1(h.C3, 2), A1: vec(h.A1[0], h.A1[1], 2).map((v) => r1(v, 2)), B2: vec(h.B2[0], h.B2[1], 1).map((v) => r1(v, 1)), A2: vec(h.A2[0], h.A2[1], 3).map((v) => r1(v, 1)), A3: vec(h.A3[0], h.A3[1], 4).map((v) => r1(v, 3)) };
      api.setMode('ronch');
      S.dfFam.probe = 0; S.df = 0;
      return { hidden: { mis: S.mis, terms: h }, target: { flat_mrad: 30, aperture_mrad: 45 } };
    },
    metrics(api, sc) {
      const { S, sim } = api, ab = sim.abA(), flat = flatAngle(sim.lam, sim.dfA(), sim.CsA(), ab, S.ronchAp);
      return {
        score: Math.round(Math.min(100, (flat / sc.target.flat_mrad) * 100)), flat_mrad: r1(flat, 2),
        C1_nm: r1(sim.dfA() / 10, 2), C3_um: r1(sim.CsA() / 1e4, 2), A1_nm: r1(ab.A1 / 10, 1), B2_nm: r1(ab.B2 / 10, 0), A2_nm: r1(ab.A2 / 10, 0), A3_um: r1(ab.A3 / 1e4, 2),
        dose: r1(sim.doseAcc || 0), success: flat >= sc.target.flat_mrad,
      };
    },
    explain: (m) => `Your flat region reached ${m.flat_mrad} mrad (target 30). True residuals at the end: C1 ${m.C1_nm} nm, A1 ${m.A1_nm} nm, B2 ${m.B2_nm} nm, A2 ${m.A2_nm} nm, C3 ${m.C3_um} µm, A3 ${m.A3_um} µm. Correctors are tuned order by order: first defocus and two-fold astigmatism (they stretch the whole pattern), then coma and three-fold astigmatism (lopsided and triangular distortions), then C3 and four-fold.`,
    blocked: ['autotune', 'scramble'],
  },
};

// ---------------------------------------------------------------------------------------------- runner
export class Scenarios {
  // api: { S, sim, version, setSpec, setMode, refresh, invalidateAll, download, applyFlat, snapshotState, restoreState, onEvent }
  constructor(api) {
    this.api = api;
    this.recorder = new Recorder({ S: api.S, version: api.version });
    this.active = null; this.lastSession = null; this.replay = null;
    this.el = (id, cls, html = '') => { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; e.className = cls; document.body.appendChild(e); } e.innerHTML = html; e.hidden = false; return e; };
  }
  blocked(id) { return !!this.active && (SCENARIOS[this.active.id].blocked ?? []).includes(id); }

  // ---------------------------------------------------------------- the Training menu (top-right button)
  menu({ replay, last }) {
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">Training mode</p><h2>Align the <em>microscope</em></h2>
      <p>Each task hides a misalignment, as on a real instrument: the knob readings are not the true values. Fix it from what you see, say how good you think it is, then see the truth.</p>
      <div class="scnlist">${Object.entries(SCENARIOS).map(([id, s]) => `<button class="scnpick" data-id="${id}"><b>${s.title}</b><small>${s.short}</small></button>`).join('')}</div>
      <div class="crow"><button class="btn" data-x="replay">Replay a session file…</button><button class="btn" data-x="last" ${this.lastSession ? '' : 'disabled'}>Download last session</button>${this.active ? '<button class="btn" data-x="stop">Stop the current task</button>' : ''}</div></div>`);
    const close = () => { m.hidden = true; };
    m.querySelector('.close').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    m.querySelectorAll('.scnpick').forEach((b) => { b.onclick = () => { if (this.active) this.finish('abandoned'); this.start(b.dataset.id); }; });
    m.querySelector('[data-x="replay"]').onclick = () => { close(); replay(); };
    m.querySelector('[data-x="last"]').onclick = () => { close(); last(); };
    m.querySelector('[data-x="stop"]')?.addEventListener('click', () => { close(); this.finish('gave_up'); });
  }

  // ---------------------------------------------------------------- start: consent first
  start(id) {
    if (this.replay) this.stopReplay();
    const exp = store('tem-exp') ?? 'novice';
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">Training scenario · research</p><h2>${SCENARIOS[id].title}</h2>
      <p>You can record this session to help us understand how people align a microscope: which controls you use, in what order, and when you decide the result is good. It will be used to build better guidance and assistance for real microscopes through the digital twin.</p>
      <ul class="cons"><li><b>Recorded:</b> the settings you change and when, which input you used, your own rating at the end, and the true alignment quality computed by the simulator.</li>
        <li><b>Not recorded:</b> your name, email, location, or any images of you. The session gets a random id.</li>
        ${SHARE.url ? `<li><b>Shared only if you choose:</b> <i>Record and share</i> sends the anonymous session file to the research dataset${SHARE.dataset ? ` <b>${esc(SHARE.dataset)}</b> on Hugging Face` : ''} automatically when the task ends, to study alignment and train models that assist real microscopes; it may be included in published data. <i>Record only</i> keeps it on this computer.</li>` : '<li><b>Stays with you:</b> nothing is sent anywhere. At the end you can download the session file.</li>'}</ul>
      <div class="cgrid"><label>Your experience with electron microscopes<select id="scnExp">
        ${[['novice', 'Never used one'], ['student', 'Student / occasional user'], ['trained', 'Trained user'], ['expert', 'Expert / facility staff']].map(([k, l]) => `<option value="${k}" ${k === exp ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="crow">${SHARE.url ? '<button class="btn primary" id="scnShare">Record and share</button><button class="btn" id="scnRec">Record only</button>' : '<button class="btn primary" id="scnRec">Record and start</button>'}<button class="btn" id="scnNoRec">Start without recording</button></div></div>`);
    const close = () => { m.hidden = true; };
    m.querySelector('.close').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    const go = (rec, share = false) => { const e = m.querySelector('#scnExp').value; store('tem-exp', e); close(); this.begin(id, rec, e, share); };
    m.querySelector('#scnShare')?.addEventListener('click', () => go(true, true));
    m.querySelector('#scnRec').onclick = () => go(true);
    m.querySelector('#scnNoRec').onclick = () => go(false);
  }

  begin(id, record, experience, share = false) {
    const sc = SCENARIOS[id], seed = (Math.random() * 2 ** 31) | 0, rng = P.mulberry32(seed);
    const info = sc.setup(this.api, rng);
    this.api.invalidateAll();
    this.active = { id, seed, ...info, t0: performance.now(), record, share: record && share && !!SHARE.url };
    const metrics = () => sc.metrics(this.api, this.active);
    if (record) this.recorder.start({ experience, scenario: { id, seed, hidden: info.hidden, target: info.target }, metrics });
    this.api.onEvent?.('start', id);
    this.card();
  }
  card() {
    const sc = SCENARIOS[this.active.id];
    const c = this.el('scnCard', 'card scncard', `<div class="scnhead"><b>${sc.title}</b><span id="scnTime">0:00</span>${this.active.record ? `<i class="rec">● ${this.active.share ? 'recording · will share' : 'recording'}</i>` : ''}<span class="sp"></span><button data-x="brief" title="Show or hide the task">?</button></div>
      <p class="scnbrief">${sc.brief}</p>
      <div class="crow"><button class="btn primary" data-x="done">I'm done: it's aligned</button><button class="btn" data-x="give">Give up</button></div>`);
    c.querySelector('[data-x="brief"]').onclick = () => c.classList.toggle('mini');
    c.querySelector('[data-x="done"]').onclick = () => this.judge();
    c.querySelector('[data-x="give"]').onclick = () => this.finish('gave_up');
  }
  tick() {
    this.recorder.tick();
    if (this.active) { const s = Math.floor((performance.now() - this.active.t0) / 1000), t = document.getElementById('scnTime'); if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    this.replayTick();
  }

  // ---------------------------------------------------------------- the participant's own judgment
  judge() {
    const sc = SCENARIOS[this.active.id];
    const m = this.el('scnModal', 'modal', `<div class="card"><p class="eyebrow">Before we show the answer</p><h2>How well aligned is it?</h2>
      <div class="rate">${[1, 2, 3, 4, 5].map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div><p class="muted">1 = still clearly off · 5 = as good as it gets</p>
      <h4>What did you use to decide?</h4><div class="cues">${sc.cues.map((c, i) => `<label><input type="checkbox" value="${i}">${c}</label>`).join('')}</div>
      <label class="note">Anything else? (optional, please no personal information)<input id="scnNote" maxlength="140" type="text"></label>
      <div class="crow"><button class="btn primary" id="scnSubmit" disabled>Show me the answer</button><button class="btn" id="scnBack">Keep adjusting</button></div></div>`);
    let rating = 0;
    m.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { rating = +b.dataset.r; m.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); m.querySelector('#scnSubmit').disabled = false; }));
    m.querySelector('#scnBack').onclick = () => { m.hidden = true; this.recorder.event('judge_cancel'); };
    m.querySelector('#scnSubmit').onclick = () => {
      const cues = [...m.querySelectorAll('.cues input:checked')].map((c) => sc.cues[+c.value]);
      this.recorder.event('judge', { rating, cues, note: m.querySelector('#scnNote').value.slice(0, 140) });
      m.hidden = true;
      this.finish('done', rating);
    };
  }

  // ---------------------------------------------------------------- the reveal
  finish(outcome, rating = null) {
    const a = this.active, sc = SCENARIOS[a.id], mt = sc.metrics(this.api, a), secs = (performance.now() - a.t0) / 1000;
    const sess = a.record ? this.recorder.stop(outcome) : null;
    if (sess) this.lastSession = sess;
    const changes = sess ? sess.events.filter((e) => e.k === 'change' && !['paused'].includes(e.key)) : [];
    const bySrc = {};
    for (const e of changes) bySrc[e.src] = (bySrc[e.src] ?? 0) + 1;
    document.getElementById('scnCard').hidden = true;
    this.active = null;
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">${outcome === 'done' ? 'Result' : 'Gave up'} · ${sc.title}</p>
      <h2>${mt.success ? 'Aligned ✓' : 'Not quite'} <em>${mt.score}/100</em></h2>
      ${rating ? `<p>You rated it <b>${rating}/5</b>${mt.success === rating >= 4 ? ', and the simulator agrees.' : mt.success ? ', but it was actually aligned.' : ', but it was still off.'}</p>` : ''}
      <p>${sc.explain(mt, a)}</p>
      <table class="data">${[['Time', `${Math.floor(secs / 60)} min ${Math.round(secs % 60)} s`], ...(sess ? [['Adjustments', `${changes.length} (${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ') || '—'})`]] : []), ['Dose used', `${mt.dose} e⁻/Å²`]].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="crow">${sess ? '<button class="btn primary" id="scnDl">Download the session file</button><button class="btn" id="scnReplay">Replay</button>' : '<span class="muted">This session was not recorded.</span>'}<button class="btn" id="scnAgain">Try another one</button></div>
      ${sess && a.share ? '<div class="share"><h4>Shared with the research dataset</h4><div class="crow"><span class="muted" id="scnSent">Sending…</span></div></div>' : ''}
      ${sess && SHARE.url && !a.share ? `<div class="share"><h4>Share with the research dataset</h4>
        <p>Send this session (the anonymous file you can download above: settings, timing, your rating and cues, no personal data) to the open research dataset${SHARE.dataset ? ` <b>${esc(SHARE.dataset)}</b> on Hugging Face` : ''}, where it will be used to study alignment and to train models that assist real microscopes. Once sent it may be included in published data. Optional: the exhibit works the same either way.</p>
        <label class="note"><input type="checkbox" id="scnAgree"> I agree to share this session</label>
        <div class="crow"><button class="btn primary" id="scnSend" disabled>Send</button><span class="muted" id="scnSent"></span></div></div>` : ''}</div>`);
    m.querySelector('.close').onclick = () => { m.hidden = true; this.clear(); };
    m.querySelector('#scnAgain').onclick = () => { m.hidden = true; this.begin(a.id, a.record, store('tem-exp') ?? 'novice', a.share); };
    if (sess) {
      m.querySelector('#scnDl').onclick = () => this.downloadSession(sess);
      m.querySelector('#scnReplay').onclick = () => { m.hidden = true; this.startReplay(sess); };
      if (a.share) this.share(sess, null, m.querySelector('#scnSent'));
      const agree = m.querySelector('#scnAgree'), send = m.querySelector('#scnSend');
      if (agree) {
        agree.onchange = () => { send.disabled = !agree.checked; };
        send.onclick = () => this.share(sess, send, m.querySelector('#scnSent'));
      }
    }
    this.api.onEvent?.('end', a.id, mt);
  }
  // send one session to the collector (only after the visitor ticked the box); the receipt id lets them ask for removal
  async share(sess, btn, out) {
    if (btn) btn.disabled = true;
    out.textContent = 'Sending…';
    try {
      const r = await fetch(SHARE.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sess) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `error ${r.status}`);
      if (btn) btn.textContent = 'Sent ✓';
      out.innerHTML = `Sent ✓ Thank you. Session id <code>${esc(j.id ?? sess.session.id)}</code>: quote it to have it removed.`;
      this.recorder.sent = (this.recorder.sent ?? 0) + 1;
    } catch (e) {
      if (btn) btn.disabled = false;
      out.textContent = `Not sent (${e.message}). You can download the file instead.`;
    }
  }

  // the page is closing during a shared task: send what was recorded, marked abandoned
  flushOnExit() {
    const a = this.active;
    if (!a?.share || !this.recorder.active) return;
    const sess = this.recorder.stop('abandoned');
    try { navigator.sendBeacon(SHARE.url, new Blob([JSON.stringify(sess)], { type: 'text/plain' })); } catch { /* best effort */ }
  }

  // back to the normal exhibit: no hidden misalignment
  clear() { this.api.S.mis = null; this.api.invalidateAll(); }
  downloadSession(sess) {
    this.api.download(new Blob([JSON.stringify(sess)], { type: 'application/json' }), `tem-view-session-${sess.scenario?.id ?? 'free'}-${sess.session.id.slice(0, 8)}.json`);
  }

  // ---------------------------------------------------------------- replay: drive the exhibit from a recorded session
  startReplay(sess) {
    if (this.active) return;
    const snaps = sess.events.filter((e) => e.k === 'snap');
    if (!snaps.length) return;
    this.replay = { sess, snaps, saved: this.api.snapshotState(), t: 0, playing: true, speed: 1, last: performance.now(), T: sess.events[sess.events.length - 1].t };
    this.api.S.mis = sess.scenario?.hidden?.mis ?? null;
    const r = this.replay, marks = sess.events.filter((e) => ['acquire', 'judge', 'end', 'mode', 'button', 'blocked'].includes(e.k));
    const bar = this.el('replayBar', 'card replaybar', `<div class="rbhead"><b>Replay</b><span>${esc(sess.scenario?.id ?? 'free session')} · ${esc(sess.session.experience)} · ${r.T.toFixed(0)} s</span><span class="sp"></span>
      <button data-r="play">❚❚</button><select data-r="speed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select><button data-r="close" title="Leave the replay">×</button></div>
      <canvas class="rbchart"></canvas><input type="range" min="0" max="${r.T}" step="0.1" value="0" data-r="scrub"><p class="rblog"></p>`);
    r.bar = bar; r.marks = marks;
    bar.querySelector('[data-r="play"]').onclick = (e) => { r.playing = !r.playing; e.target.textContent = r.playing ? '❚❚' : '▶'; r.last = performance.now(); };
    bar.querySelector('[data-r="speed"]').onchange = (e) => { r.speed = +e.target.value; };
    bar.querySelector('[data-r="scrub"]').oninput = (e) => { r.t = +e.target.value; r.playing = false; bar.querySelector('[data-r="play"]').textContent = '▶'; this.applyAt(r.t); };
    bar.querySelector('[data-r="close"]').onclick = () => this.stopReplay();
    this.applyAt(0);
  }
  loadReplay(text) { this.startReplay(JSON.parse(text)); }
  applyAt(t) {
    const r = this.replay;
    let s = r.snaps[0];
    for (const x of r.snaps) { if (x.t <= t) s = x; else break; }
    if (s !== r.cur) { r.cur = s; this.api.applyFlat(s.state); }
    this.drawReplay(t, s);
  }
  replayTick() {
    const r = this.replay;
    if (!r || !r.playing) return;
    const now = performance.now();
    r.t = Math.min(r.T, r.t + ((now - r.last) / 1000) * r.speed); r.last = now;
    r.bar.querySelector('[data-r="scrub"]').value = r.t;
    this.applyAt(r.t);
    if (r.t >= r.T) { r.playing = false; r.bar.querySelector('[data-r="play"]').textContent = '▶'; }
  }
  drawReplay(t, s) {
    const r = this.replay, cv = r.bar.querySelector('.rbchart'), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const q = cv.getContext('2d'), W = cv.width, H = cv.height, X = (x) => (x / (r.T || 1)) * W, Y = (v) => H - 4 * dpr - (v / 100) * (H - 8 * dpr);
    q.fillStyle = '#06080b'; q.fillRect(0, 0, W, H);
    // the true alignment score over time, with the target line and the decision points
    q.strokeStyle = 'rgba(255,255,255,0.15)'; q.beginPath(); q.moveTo(0, Y(100)); q.lineTo(W, Y(100)); q.stroke();
    q.strokeStyle = '#6fd6ff'; q.lineWidth = 1.5 * dpr; q.beginPath();
    r.snaps.forEach((x, i) => { const v = x.m?.score ?? 0; i ? q.lineTo(X(x.t), Y(v)) : q.moveTo(X(x.t), Y(v)); });
    q.stroke();
    for (const e of r.marks) { q.fillStyle = e.k === 'judge' ? '#ffb45e' : e.k === 'acquire' ? '#9be39b' : e.k === 'blocked' ? '#ff8a8a' : '#8a94a3'; q.fillRect(X(e.t) - dpr, 0, 2 * dpr, H); }
    q.fillStyle = '#fff'; q.fillRect(X(t) - dpr, 0, 2 * dpr, H);
    const recent = r.sess.events.filter((e) => e.k === 'change' && e.t <= t && e.t > t - 3 && e.key !== 'paused').slice(-4).map((e) => `${e.key} ${e.from}→${e.to} (${e.src})`);
    r.bar.querySelector('.rblog').textContent = `${t.toFixed(1)} s · true score ${s.m?.score ?? '—'}${s.m?.phase_error != null ? ` · phase error ${s.m.phase_error}× π/4` : ''}${s.m?.flat_mrad != null ? ` · flat ${s.m.flat_mrad} mrad` : ''}${recent.length ? ' · ' + recent.join(' · ') : ''}`;
  }
  stopReplay() {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    r.bar.hidden = true;
    this.api.restoreState(r.saved);
  }
}
