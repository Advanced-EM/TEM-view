// Voice commands: push to talk (hold M, the on-screen panel's Talk button, or the Console's talk key), speak, release.
//
// The browser's speech recognition turns speech into text; parseCommand() turns the text into exhibit actions with a
// small grammar ("defocus minus fifty", "switch to STEM", "load graphene", "acquire"). Anything the grammar does not
// understand goes to a connected agent (agent.js) when there is one, so questions get answered out loud.
//
// parseCommand() is pure and runs in Node too, so the grammar is tested without a browser.

const MODES = [
  ['4d', /\b(4\s*-?\s*d|four\s*-?\s*d(imensional)?)(\s*-?\s*stem)?\b/],
  ['ilh', /\b(in\s*-?\s*line|inline|exit\s*wave|focal\s*series)\b/],
  ['oah', /\b(off\s*-?\s*axis|holograph(y|ic)|hologram|biprism)\b/],
  ['ronch', /\b(ronchi\w*|ronch)\b/],
  ['cbed', /\b(cbed|c\s*bed|convergent\s*beam|lacbed)\b/],
  ['diff', /\b(saed|diffraction|selected\s*area)\b/],
  ['eels', /\b(eels|e\s*e\s*l\s*s|energy\s*loss)\b/],
  ['eds', /\b(eds|edx|e\s*d\s*s|x\s*-?\s*rays?|xray)\b/],
  ['stem', /\b(stem|s\s*t\s*e\s*m|scanning)\b/],
  ['tem', /\b(tem|t\s*e\s*m|transmission|imaging\s*mode|bright\s*field\s*image)\b/],
];
const SPECS = [
  ['au', /\b(gold|au|carbon\s*film)\b/],
  ['si', /\b(silicon|si)\b/],
  ['sto', /\b(strontium|titanate|sto|grain\s*boundary|perovskite)\b/],
  ['gr', /\b(graphene)\b/],
  ['mof', /\b(mof|uio|metal\s*-?\s*organic)\b/],
  ['bio', /\b(protein|biological|bio|apoferritin|vitreous|in\s*ice)\b/],
];
const MODE_NAMES = { tem: 'TEM', stem: 'STEM', '4d': '4D-STEM', diff: 'SAED', cbed: 'CBED', eds: 'EDS', eels: 'EELS', ronch: 'Ronchigram', oah: 'off-axis holography', ilh: 'in-line holography' };
const SPEC_NAMES = { au: 'gold on carbon', si: 'silicon', sto: 'the SrTiO₃ grain boundary', gr: 'graphene', mof: 'the UiO-66 MOF', bio: 'proteins in ice' };

// "minus fifty two point five" → "-52.5"; digits pass through
const SMALL = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToNumbers(text) {
  const tok = text.split(/\s+/), out = [];
  for (let i = 0; i < tok.length; i++) {
    let j = i, total = 0, cur = 0, any = false, frac = '';
    while (j < tok.length) {
      const w = tok[j];
      if (w in SMALL) cur += SMALL[w];
      else if (w in TENS) cur += TENS[w];
      else if (w === 'hundred' && any) cur *= 100;
      else if (w === 'thousand' && any) { total += cur * 1000; cur = 0; }
      else if ((w === 'point' || w === 'dot') && any && tok[j + 1] in SMALL) { while (tok[j + 1] in SMALL) { frac += SMALL[tok[j + 1]]; j++; } j++; break; }
      else if (w === 'and' && any && (tok[j + 1] in SMALL || tok[j + 1] in TENS)) { j++; continue; }
      else break;
      any = true; j++;
    }
    if (any) { out.push(String(total + cur) + (frac ? `.${frac}` : '')); i = j - 1; } else out.push(tok[i]);
  }
  return out.join(' ').replace(/\b(minus|negative)\s+(?=\d)/g, '-').replace(/\b(plus|positive)\s+(?=\d)/g, '+');
}

export function normalize(text) {
  return wordsToNumbers(String(text).toLowerCase().replace(/[−–—]/g, '-').replace(/[,!?]/g, ' ').replace(/(\d)\s*,\s*(\d)/g, '$1$2').replace(/\s+/g, ' ').trim());
}

const NUM = String.raw`([-+]?\d+(?:\.\d+)?)`;
const num = (s) => +s;

// text → { ops: [...], said } or { ask: text }. ctx: { mode, df, corrector, paused, fov, dose, holder }
export function parseCommand(raw, ctx = {}) {
  const t = normalize(raw);
  if (!t) return { ops: [] };
  const ops = [];
  const has = (re) => re.test(t);
  let m;

  // help and stop come first: they are short and easy to confuse with other commands
  if (has(/^(help|what can i say|commands|voice commands)\b/)) return { ops: [{ op: 'help' }] };
  if (has(/^(stop|quiet|be quiet|stop talking|shut up|silence)$/)) return { ops: [{ op: 'stopSpeech' }] };

  // explain what is on screen
  if (has(/\b(what am i (looking at|seeing)|what is (this|that)|explain( this| that| it)?|describe( this| it)?|tell me about (this|it))\b/)) return { ops: [{ op: 'narrate' }] };

  // questions go to the agent, even when they mention a setting ("why is graphene imaged at 80 kV?")
  if (has(/^(why|how|when|where|who|which|what|what's|whats|is|are|does|do|did|should|would|will|explain why|tell me (why|how|what))\b/) || /\?\s*$/.test(String(raw))) return { ask: String(raw).trim() };

  // specimen: "load graphene", "switch to gold", "put in the MOF"
  const specHit = SPECS.find(([, re]) => re.test(t));
  if (specHit && has(/\b(load|insert|put in|switch to|change to|use|specimen|sample|show me|go to)\b/)) ops.push({ op: 'spec', v: specHit[0] });

  // mode: "switch to STEM", "go to the Ronchigram", "EELS mode", or just the mode name
  const modeHit = MODES.find(([, re]) => re.test(t));
  if (modeHit && !specHit && (has(/\b(switch|go|change|move|show|open|mode|take me|let's do|use)\b/) || t.split(' ').length <= 3)) ops.push({ op: 'mode', v: modeHit[0] });

  // focus
  if (has(/\b(optimal|best|scherzer|auto)\s*-?\s*focus\b|\bautofocus\b|\bfocus (it|the image|for me)\b/)) ops.push({ op: 'action', v: 'optfocus', said: 'Optimal focus' });
  else if ((m = t.match(new RegExp(String.raw`\b(?:de)?focus(?:\s+(?:to|at|of))?\s+${NUM}\s*(nm|nanometers?|microns?|µm|um)?`))) && /\d/.test(m[1])) {
    ops.push({ op: 'set', k: 'df', v: num(m[1]) * (/micro|µm|um/.test(m[2] ?? '') ? 1000 : 1) });
  } else if ((m = t.match(new RegExp(String.raw`\b(under|over)\s*-?\s*focus(?:\s+(?:by|to))?\s+${NUM}\s*(nm|nanometers?|microns?|µm|um)?`)))) {
    const v = Math.abs(num(m[2])) * (/micro|µm|um/.test(m[3] ?? '') ? 1000 : 1);
    ops.push({ op: 'set', k: 'df', v: m[1] === 'under' ? -v : v });
  } else if (has(/\b(more|further)\s+under\s*-?\s*focus|\bfocus down\b/)) ops.push({ op: 'nudge', k: 'df', d: -1 });
  else if (has(/\b(more|further)\s+over\s*-?\s*focus|\bfocus up\b/)) ops.push({ op: 'nudge', k: 'df', d: 1 });

  // magnification and field of view
  if ((m = t.match(new RegExp(String.raw`\b(?:field of view|field|fov)\s+(?:to\s+|of\s+)?${NUM}\s*(nm|nanometers?)?`)))) ops.push({ op: 'set', k: 'fov', v: Math.abs(num(m[1])) });
  else if (has(/\bzoom in\b|\b(more|increase|higher) magnification\b|\bmagnify\b/)) ops.push({ op: 'zoom', f: 1 / 1.6 });
  else if (has(/\bzoom out\b|\b(less|decrease|lower) magnification\b/)) ops.push({ op: 'zoom', f: 1.6 });

  // dose / intensity
  if ((m = t.match(new RegExp(String.raw`\bdose\s+(?:to\s+|of\s+)?${NUM}`)))) ops.push({ op: 'set', k: 'dose', v: Math.abs(num(m[1])) });
  else if (has(/\b(more|increase|higher|raise) (dose|intensity|current)\b|\bbrighter\b/)) ops.push({ op: 'scale', k: 'dose', f: 2 });
  else if (has(/\b(less|decrease|lower|reduce) (dose|intensity|current)\b|\bdimmer\b|\blow dose\b/)) ops.push({ op: 'scale', k: 'dose', f: 0.5 });

  // accelerating voltage
  if ((m = t.match(/\b(\d{2,3})\s*-?\s*(kv|k v|kilo\s*-?\s*volts?|kilovolts?|kev)\b/))) {
    const kv = [80, 200, 300].reduce((a, b) => (Math.abs(b - +m[1]) < Math.abs(a - +m[1]) ? b : a));
    ops.push({ op: 'chip', k: 'kV', v: kv });
  }

  // aberration corrector
  if (has(/\b(auto\s*-?\s*tune|tune|align) (the )?corrector\b|\bcorrect the aberrations\b/)) ops.push({ op: 'action', v: 'autotune', said: 'Tuning the corrector' });
  else if (has(/\bcorrector (on|in)\b|\b(turn|switch) on (the )?corrector\b|\benable (the )?corrector\b/)) ops.push({ op: 'chip', k: 'corrector', v: true });
  else if (has(/\bcorrector (off|out)\b|\b(turn|switch) off (the )?corrector\b|\bdisable (the )?corrector\b/)) ops.push({ op: 'chip', k: 'corrector', v: false });

  // beam
  if (has(/\b(unblank|resume|unpause|beam on|turn on the beam|restore the beam)\b/)) { if (ctx.paused) ops.push({ op: 'action', v: 'pause', said: 'Beam on' }); }
  else if (has(/\b(blank|stop|pause|turn off|block)( the)? beam\b|^pause$|\bbeam off\b/)) { if (!ctx.paused) ops.push({ op: 'action', v: 'pause', said: 'Beam blanked' }); }

  // holders and temperature
  if ((m = t.match(new RegExp(String.raw`\b(?:cool|freeze|heat|warm|set the temperature|temperature)(?:\s+(?:it|up|down|the sample|the specimen))?(?:\s+(?:to|at))?\s+${NUM}\s*(kelvin|k|degrees? celsius|celsius|°c|c)\b`)))) {
    const v = num(m[1]), K = /c/.test(m[2]) && !/^k/.test(m[2]) ? v + 273.15 : v;
    ops.push({ op: 'temp', v: +K.toFixed(1) });
  } else if (has(/\bliquid helium\b/)) ops.push({ op: 'chip', k: 'holder', v: 'lhe' });
  else if (has(/\bliquid nitrogen\b|\bcryo holder\b/)) ops.push({ op: 'chip', k: 'holder', v: 'ln2' });
  else if (has(/\bheating holder\b/)) ops.push({ op: 'chip', k: 'holder', v: 'heat' });
  else if (has(/\broom temperature\b/)) ops.push({ op: 'chip', k: 'holder', v: 'room' });

  // view
  if (has(/\b(realistic|real mode|physically realistic|shot noise)\b/)) ops.push({ op: 'set', k: 'clarity', v: 'real' });
  else if (has(/\b(educational|clean view|clarity mode)\b/)) ops.push({ op: 'set', k: 'clarity', v: 'edu' });
  if (has(/\bwobbler\b/)) ops.push({ op: 'wobbler' });
  if (has(/\b(training|training mode|start a task)\b/)) ops.push({ op: 'training' });

  // acquisition (last, so "switch to STEM and acquire" sets the mode first)
  if (has(/\b(acquire|capture|snap)\b|\b(take|record|grab|save)\s+(an?\s+|the\s+|this\s+)?(image|picture|photo|exposure|frame|spectrum|pattern|shot|acquisition)\b/)) ops.push({ op: 'acquire' });

  return ops.length ? { ops } : { ask: String(raw).trim() };
}

export const HELP = 'Try: "switch to STEM", "load graphene", "defocus minus fifty", "optimal focus", "zoom in", "300 kV", "corrector on", "cool to 90 kelvin", "acquire", or "what am I looking at?"';

// describe what an op did, for the caption under the microphone
export function describe(op) {
  switch (op.op) {
    case 'mode': return `Mode: ${MODE_NAMES[op.v]}`;
    case 'spec': return `Specimen: ${SPEC_NAMES[op.v]}`;
    case 'set': return op.k === 'df' ? `Defocus ${op.v > 0 ? '+' : ''}${op.v} nm` : op.k === 'fov' ? `Field of view ${op.v} nm` : op.k === 'dose' ? `Dose ${op.v} e⁻/Å²` : op.k === 'clarity' ? (op.v === 'real' ? 'Physically realistic view' : 'Educational view') : `${op.k} ${op.v}`;
    case 'chip': return op.k === 'kV' ? `${op.v} kV` : op.k === 'corrector' ? `Corrector ${op.v ? 'on' : 'off'}` : op.k === 'holder' ? `Holder: ${{ room: 'room temperature', ln2: 'liquid nitrogen', lhe: 'liquid helium', heat: 'heating' }[op.v]}` : `${op.k} ${op.v}`;
    case 'nudge': return op.d < 0 ? 'More underfocus' : 'More overfocus';
    case 'zoom': return op.f < 1 ? 'Zoom in' : 'Zoom out';
    case 'scale': return op.f > 1 ? 'More dose' : 'Less dose';
    case 'temp': return `Temperature ${op.v} K`;
    case 'action': return op.said ?? op.v;
    case 'acquire': return 'Acquired';
    case 'wobbler': return 'Wobbler';
    case 'narrate': return 'Explaining this mode';
    case 'training': return 'Training';
    case 'help': return HELP;
    case 'stopSpeech': return 'Stopped';
    default: return '';
  }
}

// ------------------------------------------------------------------------------------------------ browser side
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

export class Voice {
  // api: { ctx(), run(op), agent: { connected, utterance(text) }, onEvent(kind, data) }
  constructor(api) {
    this.api = api; this.rec = null; this.listening = false; this.text = ''; this.final = '';
    const R = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.Recognition = R || null;
  }
  get supported() { return !!this.Recognition; }

  // the first time: say what happens to the audio, and ask
  consent() {
    if (store('tem-voice-ok') === '1') return Promise.resolve(true);
    return new Promise((resolve) => {
      const m = this.bubble(`<b>Voice commands</b><p>Hold <kbd>M</kbd> (or the Talk key) and speak; release to send. Your browser's speech recognition turns it into text. In Chrome and Edge the audio is sent to Google's or Microsoft's speech service; Safari may process it on the device. Nothing is recorded by this exhibit, and the microphone is only on while you hold the key.</p>
        <div class="vrow"><button class="btn primary" id="vOk">Turn on voice</button><button class="btn" id="vNo">Not now</button></div>`, true);
      m.querySelector('#vOk').onclick = () => { store('tem-voice-ok', '1'); this.hide(); resolve(true); };
      m.querySelector('#vNo').onclick = () => { this.hide(); resolve(false); };
    });
  }

  async start() {
    if (this.listening) return;
    if (!this.supported) { this.bubble('<b>Voice commands</b><p>This browser has no speech recognition. Use Chrome, Edge or Safari, or type a command below.</p>' + this.typeBox()); this.wireType(); return; }
    if (!(await this.consent())) return;
    const rec = new this.Recognition();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    this.text = ''; this.final = ''; this.rec = rec; this.listening = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) this.final += r[0].transcript + ' '; else interim += r[0].transcript; }
      this.text = (this.final + interim).trim();
      this.bubble(`<span class="mic on"></span><i>${esc(this.text) || 'Listening…'}</i>`);
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') this.bubble(`<b>Voice</b><p>${e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the browser\'s site settings to use voice.' : `Speech recognition stopped (${esc(e.error)}).`}</p>`); this.listening = false; };
    rec.onend = () => { const said = (this.final || this.text).trim(); this.listening = false; this.rec = null; if (this.releasing) { this.releasing = false; this.handle(said); } };
    this.bubble('<span class="mic on"></span><i>Listening…</i>');
    this.api.onEvent?.('listening', true);
    try { rec.start(); } catch { this.listening = false; }
  }
  stop() {
    if (!this.rec) return;
    this.releasing = true;
    try { this.rec.stop(); } catch { /* already stopped */ }
    this.api.onEvent?.('listening', false);
  }

  // run a sentence: commands go to the exhibit, everything else to the agent
  handle(text) {
    if (!text) { this.flash('<i>Didn\'t hear anything.</i>'); return; }
    const r = parseCommand(text, this.api.ctx());
    if (r.ops) {
      const lines = r.ops.map((op) => { this.api.run(op); return describe(op); }).filter(Boolean);
      this.api.onEvent?.('voice', { intent: r.ops.map((o) => o.op + (o.v !== undefined ? `:${o.v}` : o.k ? `:${o.k}` : '')).join(','), ok: true });
      this.flash(`<span class="mic"></span><i>“${esc(text)}”</i><b>${esc(lines.join(' · '))}</b>`, r.ops[0].op === 'help' ? 9000 : 3500);
      return;
    }
    this.api.onEvent?.('voice', { intent: 'ask', ok: !!this.api.agent?.connected });
    if (this.api.agent?.connected) { this.api.agent.utterance(text); this.flash(`<span class="mic"></span><i>“${esc(text)}”</i><b>Asked the agent…</b>`, 4000); }
    else this.flash(`<span class="mic"></span><i>“${esc(text)}”</i><p>That isn't a command I know. ${esc(HELP)}</p>`, 9000);
  }

  typeBox() { return '<form class="vtype"><input id="vText" type="text" placeholder="Type a command, e.g. defocus minus 50" autocomplete="off"><button class="btn">Send</button></form>'; }
  wireType() { const f = this.el?.querySelector('form.vtype'); if (f) f.onsubmit = (e) => { e.preventDefault(); const v = f.querySelector('input').value; this.handle(v); }; }

  bubble(html, sticky = false) {
    if (!this.el) { this.el = document.createElement('div'); this.el.id = 'voiceBubble'; this.el.className = 'card voicebubble'; this.el.setAttribute('role', 'status'); document.body.appendChild(this.el); }
    clearTimeout(this.tm); this.el.innerHTML = html; this.el.hidden = false; this.sticky = sticky;
    return this.el;
  }
  flash(html, ms = 3500) { this.bubble(html); this.tm = setTimeout(() => this.hide(), ms); }
  hide() { if (this.el) this.el.hidden = true; }
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
