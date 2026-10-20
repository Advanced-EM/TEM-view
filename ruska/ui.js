// Panel widgets: bakelite knobs with brass skirts, the hand-magnet pad and the vacuum gauge.
// Knobs turn by vertical drag, wheel or arrow keys (Shift = fine); each is an ARIA slider.

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; };

export class Knob {
  constructor(host, o) {
    Object.assign(this, { min: 0, max: 1, value: 0, fmt: (v) => v.toFixed(2), sens: 1, onInput: () => {}, onFocus: () => {} }, o);
    this.root = document.createElement('div'); this.root.className = 'knob'; this.root.dataset.k = o.id;
    this.root.innerHTML = `<span class="kl">${o.label}</span>`;
    const svg = el('svg', { viewBox: '-40 -40 80 80', role: 'slider', tabindex: 0, 'aria-label': o.aria || o.label, 'aria-valuemin': this.min, 'aria-valuemax': this.max });
    this.svg = svg;
    for (let i = 0; i <= 10; i++) { const a = (-135 + i * 27) * Math.PI / 180, r0 = 33, r1 = i % 5 ? 36 : 38.5;
      el('line', { x1: r0 * Math.sin(a), y1: -r0 * Math.cos(a), x2: r1 * Math.sin(a), y2: -r1 * Math.cos(a), stroke: i % 5 ? '#6b6358' : '#c9a04e', 'stroke-width': i % 5 ? 1.2 : 1.8, 'stroke-linecap': 'round' }, svg); }
    const defs = el('defs', {}, svg);
    const g1 = el('radialGradient', { id: `kb-${o.id}`, cx: '35%', cy: '30%', r: '75%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#4a3f33' }, g1); el('stop', { offset: '60%', 'stop-color': '#1b1612' }, g1); el('stop', { offset: '100%', 'stop-color': '#0b0907' }, g1);
    const g2 = el('linearGradient', { id: `ks-${o.id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#f0cf86' }, g2); el('stop', { offset: '55%', 'stop-color': '#a87a2c' }, g2); el('stop', { offset: '100%', 'stop-color': '#5c3f12' }, g2);
    el('circle', { r: 29, fill: `url(#ks-${o.id})` }, svg);
    this.dial = el('g', {}, svg);
    for (let i = 0; i < 24; i++) { const a = (i * 15) * Math.PI / 180; el('circle', { cx: 25.5 * Math.sin(a), cy: 25.5 * Math.cos(a), r: 2.4, fill: '#120f0c' }, this.dial); }
    el('circle', { r: 24, fill: `url(#kb-${o.id})`, stroke: '#000', 'stroke-width': 0.6 }, this.dial);
    el('line', { x1: 0, y1: -8, x2: 0, y2: -21, stroke: '#efe2c7', 'stroke-width': 2.6, 'stroke-linecap': 'round' }, this.dial);
    this.root.appendChild(svg);
    this.out = document.createElement('span'); this.out.className = 'kv'; this.root.appendChild(this.out);
    host.appendChild(this.root);
    this.bind(); this.set(this.value, false);
  }
  get range() { return this.max - this.min; }
  set(v, emit = true) {
    this.value = Math.min(this.max, Math.max(this.min, v));
    const f = (this.value - this.min) / this.range;
    this.dial.setAttribute('transform', `rotate(${-135 + 270 * f})`);
    const txt = this.fmt(this.value); this.out.textContent = txt;
    this.svg.setAttribute('aria-valuenow', this.value.toFixed(5)); this.svg.setAttribute('aria-valuetext', txt);
    if (emit) this.onInput(this.value);
  }
  setFmt() { this.out.textContent = this.fmt(this.value); }
  disable(b) { this.root.classList.toggle('off', b); this.svg.setAttribute('aria-disabled', b); this.svg.tabIndex = b ? -1 : 0; }
  bind() {
    let y0 = null, x0 = 0;
    this.svg.addEventListener('pointerdown', (e) => { y0 = e.clientY; x0 = e.clientX; this.svg.setPointerCapture(e.pointerId); this.svg.focus({ preventScroll: true }); e.preventDefault(); });
    this.svg.addEventListener('pointermove', (e) => { if (y0 === null) return;
      // drag up or right to turn clockwise; hold Shift for fine steps
      const d = (e.clientX - x0) + (y0 - e.clientY); x0 = e.clientX; y0 = e.clientY;
      this.set(this.value + (d / 260) * this.range * this.sens * (e.shiftKey ? 0.1 : 1)); });
    const end = () => { y0 = null; };
    this.svg.addEventListener('pointerup', end); this.svg.addEventListener('pointercancel', end);
    this.svg.addEventListener('wheel', (e) => { e.preventDefault(); this.set(this.value - Math.sign(e.deltaY) * this.range * (e.shiftKey ? 0.002 : 0.012) * this.sens); }, { passive: false });
    this.svg.addEventListener('keydown', (e) => {
      const st = this.range * (e.shiftKey ? 0.002 : 0.01) * this.sens;
      const map = { ArrowUp: st, ArrowRight: st, ArrowDown: -st, ArrowLeft: -st, PageUp: st * 10, PageDown: -st * 10 };
      if (e.key in map) { this.set(this.value + map[e.key]); e.preventDefault(); }
      else if (e.key === 'Home') { this.set(this.min); e.preventDefault(); } else if (e.key === 'End') { this.set(this.max); e.preventDefault(); } });
    this.svg.addEventListener('focus', () => this.onFocus());
    this.root.addEventListener('pointerenter', () => this.onFocus());
  }
}

// A steel hand magnet over the column: a 2D pad (µm of beam shift)
export class Pad {
  constructor(host, o) {
    Object.assign(this, { range: 80, x: 0, y: 0, onInput: () => {}, onFocus: () => {} }, o);
    this.root = document.createElement('div'); this.root.className = 'pad'; this.root.tabIndex = 0; this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Hand magnet: drag or use the arrow keys to push the beam back onto the axis');
    this.dot = document.createElement('b'); this.root.appendChild(this.dot); host.appendChild(this.root);
    const move = (e) => { const r = this.root.getBoundingClientRect(); this.set(((e.clientX - r.left) / r.width * 2 - 1) * this.range, -((e.clientY - r.top) / r.height * 2 - 1) * this.range); };
    let on = false;
    this.root.addEventListener('pointerdown', (e) => { on = true; this.root.setPointerCapture(e.pointerId); move(e); });
    this.root.addEventListener('pointermove', (e) => on && move(e));
    this.root.addEventListener('pointerup', () => (on = false));
    this.root.addEventListener('keydown', (e) => { const st = this.range * (e.shiftKey ? 0.01 : 0.05); const k = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key]; if (k) { this.set(this.x + k[0], this.y + k[1]); e.preventDefault(); } });
    this.root.addEventListener('focus', () => this.onFocus()); this.root.addEventListener('pointerenter', () => this.onFocus());
    this.set(this.x, this.y, false);
  }
  set(x, y, emit = true) {
    const c = (v) => Math.max(-this.range, Math.min(this.range, v)); this.x = c(x); this.y = c(y);
    this.dot.style.left = (50 + (this.x / this.range) * 42) + '%'; this.dot.style.top = (50 - (this.y / this.range) * 42) + '%';
    if (emit) this.onInput(this.x, this.y);
  }
}

// Log-scale vacuum gauge, 10³ … 10⁻⁵ mbar
export class Gauge {
  constructor(host) {
    const svg = el('svg', { viewBox: '-60 -54 120 64', 'aria-hidden': 'true' }); host.appendChild(svg);
    el('path', { d: 'M -50 0 A 50 50 0 0 1 50 0', fill: 'none', stroke: '#3a3226', 'stroke-width': 8 }, svg);
    el('path', { d: `M ${-50 * Math.cos(Math.PI * 0.25)} ${-50 * Math.sin(Math.PI * 0.25)} A 50 50 0 0 1 50 0`, fill: 'none', stroke: '#2f4a28', 'stroke-width': 8 }, svg);
    for (let e = 3; e >= -5; e--) { const f = (3 - e) / 8, a = Math.PI * (1 - f); const x = Math.cos(a), y = -Math.sin(a);
      el('line', { x1: 44 * x, y1: 44 * y, x2: 55 * x, y2: 55 * y, stroke: '#9a9184', 'stroke-width': 1 }, svg);
      if (e % 2 !== 0 || e === 0) { const t = el('text', { x: 36 * x, y: 36 * y + 3, 'text-anchor': 'middle', 'font-size': 7, fill: '#8a8174', 'font-family': 'IBM Plex Mono, monospace' }, svg); t.textContent = e; } }
    this.needle = el('line', { x1: 0, y1: 0, x2: -46, y2: 0, stroke: '#e0b25e', 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
    el('circle', { r: 3.5, fill: '#e0b25e' }, svg);
  }
  set(logP) { const f = Math.min(1, Math.max(0, (3 - logP) / 8)); this.needle.setAttribute('transform', `rotate(${180 * f})`); }
}
