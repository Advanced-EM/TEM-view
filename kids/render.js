// The picture on the viewing screen, shared by the exhibit and the sticker page (sticker.html), which redraws a
// visitor's snap from a few numbers in its address. A Picture draws the sample into an offscreen buffer (only
// when the view changes), then composites it every frame: focus blur, brightness, colors, grain and the lit disc.
import { rng } from './specimens.js';

export const W = 720;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// the optics in kid units: focus error in knob clicks, brightness 0…1
export const optics = {
  blur: (err, sp, fov) => Math.min(26, Math.abs(err) * 0.22 * Math.pow(sp.fovMax / fov, 0.18)), // px
  sharp: (blur) => Math.exp(-((blur / 2.2) ** 2)),
  gain: (b) => 0.08 + 2.2 * Math.pow(b, 1.3),             // picture brightness
  spot: (b) => 1.5 - b,                                   // lit disc radius / screen radius
  grain: (b, pal) => clamp((0.45 - b) / 0.45, 0, 1) * 0.5 + (pal === 'color' ? 0.02 : 0.07),
};

export const viewOf = (cx, cy, fov, pal) => ({ cx, cy, fov, s: W / fov, x0: cx - fov / 2, x1: cx + fov / 2, y0: cy - fov / 2, y1: cy + fov / 2, mono: pal !== 'color' });

export class Picture {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas'); this.buf.width = this.buf.height = W; this.bctx = this.buf.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.hasFilter = 'filter' in this.ctx;
    this.noise = [0, 1, 2].map((k) => {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), im = g.createImageData(256, 256), r = rng(k + 3);
      for (let i = 0; i < 256 * 256; i++) { const l = r() < 0.5 ? 0 : 255; im.data.set([l, l, l, r() * 255], i * 4); }
      g.putImageData(im, 0, 0); return c;
    });
  }

  // the sample and any cooked spots, into the buffer
  draw(sp, v, burns = []) {
    const b = this.bctx;
    b.setTransform(1, 0, 0, 1, 0, 0); b.fillStyle = sp.bg(v.mono); b.fillRect(0, 0, W, W);
    b.setTransform(v.s, 0, 0, v.s, W / 2 - v.cx * v.s, W / 2 - v.cy * v.s);
    sp.draw(b, v);
    for (const q of burns) {
      if (q.x + q.r < v.x0 || q.x - q.r > v.x1 || q.y + q.r < v.y0 || q.y - q.r > v.y1) continue;
      const g = b.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r), c = v.mono ? '15,15,15' : '95,45,10';
      g.addColorStop(0, `rgba(${c},${0.8 * q.amt})`); g.addColorStop(0.75, `rgba(${c},${0.55 * q.amt})`); g.addColorStop(1, `rgba(${c},0)`);
      b.fillStyle = g; b.beginPath(); b.arc(q.x, q.y, q.r, 0, TAU); b.fill();
      if (q.amt > 0.35) { // bubbles: real organic samples bubble under a strong beam
        const r = rng(q.seed); b.fillStyle = `rgba(255,240,215,${0.55 * q.amt})`; b.strokeStyle = `rgba(${c},${0.8 * q.amt})`; b.lineWidth = q.r * 0.012;
        for (let k = 0; k < 16 * q.amt; k++) { const a = r() * TAU, d = Math.sqrt(r()) * q.r * 0.65, rr = q.r * (0.03 + r() * 0.07); b.beginPath(); b.arc(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, rr, 0, TAU); b.fill(); b.stroke(); }
      }
    }
  }

  // the screen: { beam, blur (px), bright (0…1), pal }
  show({ beam, blur, bright, pal }) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, W, W);
    if (!beam) return;
    const k = optics.gain(bright);
    const tint = pal === 'green' ? ' sepia(1) hue-rotate(55deg) saturate(2.6)' : pal === 'mono' ? ' contrast(1.08)' : '';
    if (this.hasFilter) { ctx.filter = `blur(${blur.toFixed(2)}px) brightness(${k.toFixed(3)})${tint}`; ctx.drawImage(this.buf, 0, 0); ctx.filter = 'none'; }
    else { // no canvas filters: blur by shrinking and stretching, brightness by a veil
      const tmp = this.tmp, sc = 1 / (1 + blur / 2), w = Math.max(8, Math.round(W * sc)); tmp.width = tmp.height = w;
      tmp.getContext('2d').drawImage(this.buf, 0, 0, w, w); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(tmp, 0, 0, W, W);
      if (k < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - k})`; ctx.fillRect(0, 0, W, W); } else { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, k - 1); ctx.drawImage(tmp, 0, 0, W, W); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    }
    // grain: with few electrons, each spot gets a random number of them
    const n = optics.grain(bright, pal);
    if (n > 0.02) { ctx.globalAlpha = n; const t = this.noise[(Math.random() * 3) | 0], ox = -Math.random() * 256, oy = -Math.random() * 256; for (let y = oy; y < W; y += 256) for (let x = ox; x < W; x += 256) ctx.drawImage(t, x, y); ctx.globalAlpha = 1; }
    // the lit disc: a squeezed beam lights only the middle
    const R = (W / 2) * optics.spot(bright), g = ctx.createRadialGradient(W / 2, W / 2, R * 0.8, W / 2, W / 2, R * 1.04);
    g.addColorStop(0, 'rgba(4,6,12,0)'); g.addColorStop(1, 'rgba(4,6,12,.96)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
  }

  // a round sticker of what the screen shows, as a PNG data URL
  sticker(size = 360) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 4, 0, TAU); g.clip(); g.drawImage(this.canvas, 0, 0, size, size);
    g.lineWidth = size / 36; g.strokeStyle = '#fff'; g.stroke();
    return c.toDataURL('image/png');
  }
}

// a snap as a few numbers, for the take-home QR code: sample, view, focus error, brightness, colors, stars, the
// cooked spots in view and the language; no time, place or anything about the visitor
export function encodeSnap(s) {
  const r = (x, d = 4) => +x.toPrecision(d);
  const p = new URLSearchParams({ s: s.sample, x: r(s.cx, 7), y: r(s.cy, 7), f: r(s.fov), e: Math.round(s.err), b: r(s.bright, 2), p: s.pal, st: s.stars, l: s.lang });
  const bn = (s.burns || []).slice(-3).map((q) => [r(q.x, 6), r(q.y, 6), r(q.r, 3), r(q.amt, 2), q.seed].join(',')).join(';');
  if (bn) p.set('bn', bn);
  return p.toString();
}
export function decodeSnap(str) {
  const p = new URLSearchParams(str), n = (k, d = 0) => (Number.isFinite(+p.get(k)) && p.get(k) !== null ? +p.get(k) : d);
  return {
    sample: p.get('s') || 'pollen', cx: n('x'), cy: n('y'), fov: n('f', 1000), err: n('e'), bright: n('b', 0.5),
    pal: ['color', 'mono', 'green'].includes(p.get('p')) ? p.get('p') : 'color', stars: Math.max(1, Math.min(3, n('st', 1))), lang: p.get('l') || 'en',
    burns: (p.get('bn') || '').split(';').filter(Boolean).map((t) => { const [x, y, r, amt, seed] = t.split(',').map(Number); return { x, y, r, amt, seed }; }),
  };
}
