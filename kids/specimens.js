// The four samples, drawn from shapes in world coordinates (nanometres), so they stay crisp at any zoom and reveal
// finer detail as you zoom in: pollen grains (spikes, then their pitted surface), a bacterium under attack by
// phages (then the phage's head, tail sheath and legs), gold nanoparticles on carbon (then lattice fringes, then
// atom columns), and graphene (then its honeycomb, a hole, and one silicon atom in place of a carbon).
// Names, blurbs and what() answers are [English, Spanish] pairs.
// draw(ctx, v) works with ctx already scaled to world units; v = { cx, cy, fov, s (px per nm), x0, x1, y0, y1, mono }.

// what Zip says you are looking at, per sample (each line has a recorded voice clip)
export const WHAT = {
  pollen: { edge: ['the spiky edge of a pollen grain', 'el borde con púas de un grano de polen'], surface: ['the bumpy surface of a pollen grain', 'la superficie llena de bultitos de un grano de polen'],
    grain: ['a pollen grain', 'un grano de polen'], gap: ['empty space between pollen grains', 'el espacio vacío entre los granos de polen'] },
  bugs: { empty: ['an empty phage: it already injected its DNA', 'un fago vacío: ya inyectó su ADN'], landed: ['a phage virus landing on the bacterium', 'un virus fago aterrizando en la bacteria'],
    floating: ['a phage virus, floating', 'un virus fago flotando'], cell: ['a bacterium (a living cell)', 'una bacteria (una célula viva)'],
    between: ['the space between cells', 'el espacio entre las células'], many: ['bacteria with their whip-like tails', 'bacterias con sus colas como látigos'] },
  gold: { atoms: ['rows of gold atoms', 'filas de átomos de oro'], tilted: ['a gold particle tilted so its rows of atoms hide', 'una partícula de oro inclinada, así que sus filas de átomos se esconden'],
    particle: ['a gold nanoparticle', 'una nanopartícula de oro'], film: ['the carbon film (its atoms are jumbled, not in rows)', 'la película de carbono (sus átomos están revueltos, no en filas)'],
    many: ['gold nanoparticles on carbon', 'nanopartículas de oro sobre carbono'] },
  graphene: { dirt: ['a blob of dirt (hydrocarbons from the air)', 'una mancha de suciedad (hidrocarburos del aire)'], hole: ['a hole in the graphene', 'un agujero en el grafeno'],
    si: ['a silicon atom hiding among the carbon!', '¡un átomo de silicio escondido entre el carbono!'], atoms: ['carbon atoms in a honeycomb', 'átomos de carbono en forma de panal'],
    sheet: ['a sheet of graphene, one atom thick', 'una lámina de grafeno, de un solo átomo de grosor'] },
};

export const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const vis = (v, x, y, r) => x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
const px = (v, n) => n / v.s;
const fade = (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ pollen (sunflower-like, ~25 µm)
function makePollen() {
  const R = rng(7), grains = [{ x: 0, y: 0, r: 12500, rot: 0.3, seed: 1 }];
  for (let i = 0; grains.length < 26 && i < 800; i++) {
    const g = { x: (R() - 0.5) * 380000, y: (R() - 0.5) * 380000, r: 9000 + R() * 5000, rot: R() * TAU, seed: i + 2 };
    if (grains.every((h) => Math.hypot(h.x - g.x, h.y - g.y) > h.r + g.r + 7000)) grains.push(g);
  }
  for (const g of grains) {
    g.tips = [];
    const N = 110;
    for (let i = 0; i < N; i++) {
      const z = 1 - (2 * (i + 0.5)) / N; if (z < 0.12) continue;
      const rad = Math.sqrt(1 - z * z), th = i * 2.39996 + g.rot;
      g.tips.push([rad * Math.cos(th) * g.r, rad * Math.sin(th) * g.r, z]);
    }
  }
  const pal = (m) => m
    ? { bg: '#d9d9d9', body0: '#5c5c5c', body1: '#2c2c2c', line: '#1a1a1a', spike: '#3a3a3a', tip: '#202020', pore: '#8a8a8a', pit: 'rgba(255,255,255,.18)' }
    : { bg: '#fff6e0', body0: '#ffe27a', body1: '#f29a1d', line: '#9a4f00', spike: '#f5ad2c', tip: '#ffcf4a', pore: '#fff2bf', pit: 'rgba(255,250,220,.55)' };
  function grain(ctx, v, g, P) {
    const L = 2600, n = 34;
    if (!vis(v, g.x, g.y, g.r + L)) return;
    ctx.save(); ctx.translate(g.x, g.y);
    ctx.lineJoin = 'round'; ctx.lineWidth = px(v, 2.2); ctx.strokeStyle = P.line;
    // spikes on the rim
    ctx.fillStyle = P.spike; ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = g.rot + (k * TAU) / n, c = Math.cos(a), s = Math.sin(a), w = 760 / g.r;
      ctx.moveTo(Math.cos(a - w) * g.r * 0.97, Math.sin(a - w) * g.r * 0.97);
      ctx.lineTo(c * (g.r + L), s * (g.r + L));
      ctx.lineTo(Math.cos(a + w) * g.r * 0.97, Math.sin(a + w) * g.r * 0.97);
    }
    ctx.fill(); ctx.stroke();
    // body
    const gr = ctx.createRadialGradient(-g.r * 0.35, -g.r * 0.4, g.r * 0.1, 0, 0, g.r);
    gr.addColorStop(0, P.body0); gr.addColorStop(1, P.body1);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, g.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip();
    // pitted surface (only once it is big enough to see)
    const sp = 900, a = fade(sp * v.s, 6, 14);
    if (a > 0) {
      ctx.globalAlpha = a; ctx.fillStyle = P.pit;
      const lx0 = Math.max(-g.r, v.x0 - g.x), lx1 = Math.min(g.r, v.x1 - g.x), ly0 = Math.max(-g.r, v.y0 - g.y), ly1 = Math.min(g.r, v.y1 - g.y);
      const h = sp * 0.866;
      ctx.beginPath();
      for (let j = Math.floor(ly0 / h) - 1; j <= Math.ceil(ly1 / h) + 1; j++) {
        const off = (j & 1) * sp * 0.5;
        for (let i = Math.floor((lx0 - off) / sp) - 1; i <= Math.ceil((lx1 - off) / sp) + 1; i++) {
          const x = i * sp + off, y = j * h, rr = 300 * (0.8 + 0.4 * Math.abs(Math.sin(i * 12.9898 + j * 78.233)));
          ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU);
        }
      }
      ctx.fill(); ctx.globalAlpha = 1;
    }
    // germination pores
    for (let k = 0; k < 3; k++) {
      const a2 = g.rot + 0.7 + (k * TAU) / 3, x = Math.cos(a2) * g.r * 0.55, y = Math.sin(a2) * g.r * 0.55;
      ctx.fillStyle = P.pore; ctx.beginPath(); ctx.arc(x, y, g.r * 0.13, 0, TAU); ctx.fill();
      ctx.lineWidth = px(v, 1.5); ctx.stroke();
    }
    // spikes seen face-on
    if (g.r * v.s > 40) {
      for (const [x, y, z] of g.tips) {
        const r = 700 * (0.5 + 0.5 * z);
        ctx.fillStyle = P.tip; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.lineWidth = px(v, 1.2); ctx.stroke();
        if (!v.mono && r * v.s > 5) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, TAU); ctx.fill(); }
      }
    }
    ctx.restore(); ctx.restore();
  }
  return {
    id: 'pollen', whats: Object.values(WHAT.pollen), name: ['Pollen', 'Polen'], icon: '🌼', fovMax: 420000, fovMin: 1500, start: { cx: 0, cy: 0, fov: 180000 }, bound: 200000, soft: true,
    blurb: ['Flowers make pollen to make new seeds. Each grain is smaller than the width of a hair, and covered in spikes that stick to bees.', 'Las flores hacen polen para formar nuevas semillas. Cada grano es más pequeño que el grosor de un cabello y está cubierto de púas que se pegan a las abejas.'],
    grains,
    bg: (m) => pal(m).bg,
    draw(ctx, v) { const P = pal(v.mono); for (const g of grains) grain(ctx, v, g, P); },
    what(v) {
      const W = WHAT.pollen;
      for (const g of grains) { const d = Math.hypot(v.cx - g.x, v.cy - g.y); if (d < g.r * 1.25) return d > g.r * 0.72 ? W.edge : v.fov < 6000 ? W.surface : W.grain; }
      return W.gap;
    },
  };
}

// ------------------------------------------------------------------ bacteria and the viruses that attack them (phage T4)
function makeBugs() {
  const R = rng(42), cells = [{ x: 0, y: 0, L: 2700, w: 950, a: 0.35, seed: 1 }];
  for (let i = 0; cells.length < 40 && i < 900; i++) {
    const c = { x: (R() - 0.5) * 70000, y: (R() - 0.5) * 70000, L: 1800 + R() * 1500, w: 800 + R() * 250, a: R() * TAU, seed: i + 2 };
    if (cells.every((h) => Math.hypot(h.x - c.x, h.y - c.y) > (h.L + c.L) / 2 + 2600)) cells.push(c);
  }
  for (const c of cells) {
    const r = rng(c.seed * 97);
    c.flag = Array.from({ length: 3 + Math.floor(r() * 4) }, () => {
      const pole = r() < 0.7 ? (r() < 0.5 ? -1 : 1) : 0, along = pole ? (pole * c.L) / 2 : (r() - 0.5) * c.L;
      return { along, side: pole ? 0 : r() < 0.5 ? -1 : 1, dir: (pole ? (pole > 0 ? 0 : Math.PI) : (r() < 0.5 ? -1 : 1) * Math.PI / 2) + (r() - 0.5) * 1.2, len: 4500 + r() * 4000, ph: r() * TAU };
    });
    c.pili = Array.from({ length: 22 }, () => [r() * TAU, 0.6 + r() * 0.6]);
    c.ribo = Array.from({ length: 260 }, () => [(r() - 0.5) * (c.L - c.w * 0.4), (r() - 0.5) * c.w * 0.75]);
  }
  // a point on the capsule's outline at parameter t∈[0,1) and its outward normal (cell frame)
  const outline = (c, t) => {
    const s = c.L - c.w, r = c.w / 2, per = 2 * s + TAU * r; let d = t * per;
    if (d < s) return [-s / 2 + d, -r, 0, -1]; d -= s;
    if (d < Math.PI * r) { const a = -Math.PI / 2 + d / r; return [s / 2 + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]; } d -= Math.PI * r;
    if (d < s) return [s / 2 - d, r, 0, 1]; d -= s;
    const a = Math.PI / 2 + d / r; return [-s / 2 + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)];
  };
  const toWorld = (c, x, y) => [c.x + x * Math.cos(c.a) - y * Math.sin(c.a), c.y + x * Math.sin(c.a) + y * Math.cos(c.a)];
  const phages = [];
  // phages landed on the first few cells, a crowd around the first
  cells.slice(0, 8).forEach((c, ci) => {
    const n = ci === 0 ? 14 : 2 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const [lx, ly, nx, ny] = outline(c, (k + R() * 0.6) / n);
      const [x, y] = toWorld(c, lx, ly), wn = [nx * Math.cos(c.a) - ny * Math.sin(c.a), nx * Math.sin(c.a) + ny * Math.cos(c.a)];
      phages.push({ x, y, rot: Math.atan2(wn[0], -wn[1]) + (R() - 0.5) * 0.4, empty: R() < 0.45, landed: true, k: 0.92 + R() * 0.16 });
    }
  });
  for (let i = 0; i < 70; i++) {
    const near = i < 30, x = (R() - 0.5) * (near ? 9000 : 70000), y = (R() - 0.5) * (near ? 9000 : 70000);
    if (cells.some((c) => Math.hypot(c.x - x, c.y - y) < c.L / 2 + 400)) continue;
    phages.push({ x, y, rot: R() * TAU, empty: false, landed: false, k: 0.92 + R() * 0.16 });
  }
  // world position of a phage's head (what a visitor should centre on)
  for (const p of phages) { const h = 175 * p.k; p.hx = p.x + Math.sin(p.rot) * h; p.hy = p.y - Math.cos(p.rot) * h; }

  const pal = (m) => m
    ? { bg: '#dcdcdc', cell0: '#7a7a7a', cell1: '#4a4a4a', mem: '#2a2a2a', nuc: 'rgba(255,255,255,.16)', ribo: 'rgba(0,0,0,.35)', flag: '#3a3a3a', head: '#2e2e2e', headE: '#bdbdbd', headLine: '#151515', tail: '#444', leg: '#2a2a2a', dna: '#333' }
    : { bg: '#eef9ff', cell0: '#ff9cc8', cell1: '#e24d92', mem: '#a3205f', nuc: 'rgba(255,255,255,.35)', ribo: 'rgba(120,10,70,.45)', flag: '#c23f7f', head: '#22b8a6', headE: '#c9f5ee', headLine: '#0d6b60', tail: '#7b5ad6', leg: '#4b2fa3', dna: '#0d6b60' };

  function cell(ctx, v, c, P) {
    if (!vis(v, c.x, c.y, c.L / 2 + 9000)) return;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
    // flagella: long whips
    ctx.strokeStyle = P.flag; ctx.lineWidth = Math.max(px(v, 1.4), 22); ctx.lineCap = 'round';
    for (const f of c.flag) {
      const x0 = f.along, y0 = f.side * c.w * 0.5, dx = Math.cos(f.dir), dy = Math.sin(f.dir);
      ctx.beginPath();
      for (let t = 0; t <= f.len; t += Math.max(60, px(v, 3))) { const w = Math.sin(t / 380 + f.ph) * 230 * Math.min(1, t / 600); ctx.lineTo(x0 + dx * t - dy * w, y0 + dy * t + dx * w); }
      ctx.stroke();
    }
    // short hairs (pili)
    const pa = fade(v.s * 1000, 6, 20);
    if (pa > 0) {
      ctx.globalAlpha = pa; ctx.lineWidth = Math.max(px(v, 1), 7); ctx.beginPath();
      for (const [t, l] of c.pili) { const s = c.L - c.w, r = c.w / 2, xx = Math.cos(t) * (s / 2 + r * 0.9), yy = Math.sin(t) * r * 0.95, n = Math.hypot(xx / (s / 2 + r), yy / r) || 1, nx = xx / (s / 2 + r) / n, ny = yy / r / n; ctx.moveTo(xx, yy); ctx.lineTo(xx + nx * l * 260, yy + ny * l * 260); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // body
    const g = ctx.createLinearGradient(0, -c.w / 2, 0, c.w / 2); g.addColorStop(0, P.cell0); g.addColorStop(1, P.cell1);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-c.L / 2, -c.w / 2, c.L, c.w, c.w / 2); ctx.fill();
    ctx.strokeStyle = P.mem; ctx.lineWidth = Math.max(px(v, 2.2), 18); ctx.stroke();
    // its DNA (the lighter, tangled middle) and the speckle of ribosomes
    ctx.fillStyle = P.nuc; ctx.beginPath(); ctx.ellipse(0, 0, c.L * 0.3, c.w * 0.22, 0, 0, TAU); ctx.fill();
    if (v.s * 20 > 1.2) { ctx.fillStyle = P.ribo; ctx.beginPath(); for (const [x, y] of c.ribo) { ctx.moveTo(x + 13, y); ctx.arc(x, y, 13, 0, TAU); } ctx.fill(); }
    ctx.restore();
  }
  function phage(ctx, v, p, P) {
    if (!vis(v, p.x, p.y, 300)) return;
    const size = 290 * v.s;
    if (size < 3) { ctx.fillStyle = P.head; ctx.beginPath(); ctx.arc(p.hx, p.hy, Math.max(px(v, 1.3), 50), 0, TAU); ctx.fill(); return; }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(p.k, p.k);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const lw = Math.max(px(v, 1.4), 2);
    // tail fibres (legs)
    ctx.strokeStyle = P.leg; ctx.lineWidth = Math.max(px(v, 1.2), 3.2);
    ctx.beginPath();
    for (const [kx, ky, fx] of [[55, -55, 100], [75, -42, 120], [38, -62, 80]]) for (const sg of [-1, 1]) { ctx.moveTo(sg * 12, -8); ctx.lineTo(sg * kx, ky); ctx.lineTo(sg * fx, 0); }
    ctx.stroke();
    // DNA going into the cell from an emptied phage
    if (p.empty && p.landed) { ctx.strokeStyle = P.dna; ctx.lineWidth = Math.max(px(v, 1), 2); ctx.beginPath(); for (let t = 0; t < 260; t += 8) ctx.lineTo(Math.sin(t / 14) * 9, t); ctx.stroke(); }
    // baseplate, tail sheath, collar
    ctx.fillStyle = P.leg; ctx.beginPath(); ctx.roundRect(-17, -12, 34, 10, 3); ctx.fill();
    ctx.fillStyle = P.tail; ctx.strokeStyle = P.headLine; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.rect(-11, -112, 22, 100); ctx.fill(); ctx.stroke();
    if (v.s * 4 > 1.6) { ctx.lineWidth = Math.max(px(v, 0.8), 1); ctx.beginPath(); for (let y = -108; y < -14; y += 4.1) { ctx.moveTo(-11, y); ctx.lineTo(11, y); } ctx.stroke(); }
    ctx.lineWidth = lw; ctx.beginPath(); ctx.rect(-16, -120, 32, 8); ctx.fillStyle = P.leg; ctx.fill(); ctx.stroke();
    // head: an elongated icosahedron, full of DNA or emptied
    const hy = -176;
    ctx.beginPath(); ctx.moveTo(0, hy - 58); ctx.lineTo(43, hy - 30); ctx.lineTo(43, hy + 30); ctx.lineTo(0, hy + 58); ctx.lineTo(-43, hy + 30); ctx.lineTo(-43, hy - 30); ctx.closePath();
    ctx.fillStyle = p.empty ? P.headE : P.head; ctx.fill(); ctx.stroke();
    if (v.s * 10 > 2) {
      ctx.lineWidth = Math.max(px(v, 0.8), 1); ctx.globalAlpha = 0.55; ctx.beginPath();
      ctx.moveTo(-43, hy - 30); ctx.lineTo(0, hy - 8); ctx.lineTo(43, hy - 30); ctx.moveTo(0, hy - 8); ctx.lineTo(0, hy + 58); ctx.stroke(); ctx.globalAlpha = 1;
      if (!v.mono) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.ellipse(-20, hy - 22, 9, 16, 0.4, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
  return {
    id: 'bugs', whats: Object.values(WHAT.bugs), name: ['Bacteria & viruses', 'Bacterias y virus'], icon: '🦠', fovMax: 75000, fovMin: 160, start: { cx: 0, cy: 0, fov: 30000 }, bound: 38000, soft: true,
    blurb: ['A bacterium is a living cell, about 2 micrometres long. Viruses called phages land on it like tiny space landers and inject their DNA.', 'Una bacteria es una célula viva de unos 2 micrómetros de largo. Unos virus llamados fagos aterrizan en ella como pequeñas naves espaciales e inyectan su ADN.'],
    cells, phages,
    bg: (m) => pal(m).bg,
    draw(ctx, v) { const P = pal(v.mono); for (const c of cells) cell(ctx, v, c, P); for (const p of phages) phage(ctx, v, p, P); },
    what(v) {
      const W = WHAT.bugs;
      let best = null, bd = Infinity;
      for (const p of phages) { const d = Math.hypot(v.cx - p.hx, v.cy - p.hy); if (d < bd) { bd = d; best = p; } }
      if (best && bd < Math.max(260, v.fov * 0.15) && v.fov < 4000) return best.empty ? W.empty : best.landed ? W.landed : W.floating;
      for (const c of cells) if (Math.hypot(v.cx - c.x, v.cy - c.y) < c.L / 2) return W.cell;
      return v.fov < 3000 ? W.between : W.many;
    },
  };
}

// ------------------------------------------------------------------ gold nanoparticles on a carbon film
function makeGold() {
  const R = rng(11), parts = [{ x: 0, y: 0, d: 11, th: 0.25, zone: true, seed: 1 }];
  const ln = () => { let u = 0, w = 0; while (!u) u = R(); while (!w) w = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * w); };
  for (let i = 0; parts.length < 650 && i < 6000; i++) {
    const d = Math.max(2, Math.min(28, 7 * Math.exp(0.45 * ln()))), p = { x: (R() - 0.5) * 1400, y: (R() - 0.5) * 1400, d, th: R() * TAU, zone: R() < 0.65, seed: i + 2 };
    if (parts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > (q.d + p.d) / 2 + 3)) parts.push(p);
  }
  for (const p of parts) { const r = rng(p.seed * 13); p.shape = Array.from({ length: 9 }, (_, k) => [((k + r() * 0.3) * TAU) / 9, 1 + (r() - 0.5) * 0.12]); }
  let tex = null;
  const texture = () => {
    if (tex || typeof document === 'undefined') return tex;
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), im = g.createImageData(128, 128), r = rng(5);
    const a = new Float32Array(128 * 128).map(() => r());
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const i = y * 128 + x; a[i] = (a[i] * 2 + a[y * 128 + ((x + 1) & 127)] + a[((y + 1) & 127) * 128 + x]) / 4;
    }
    for (let i = 0; i < a.length; i++) { const val = (a[i] - 0.5) * 3; im.data[i * 4 + 3] = Math.min(255, Math.abs(val) * 255); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = val > 0 ? 255 : 0; }
    g.putImageData(im, 0, 0); tex = c; return tex;
  };
  const pal = (m) => m
    ? { bg: '#cfcfcf', p0: '#5a5a5a', p1: '#2f2f2f', line: '#1a1a1a', lat: '#6e6e6e', atom: '#151515', fr: 'rgba(0,0,0,.35)' }
    : { bg: '#e2ecf7', p0: '#ffe27a', p1: '#d98a00', line: '#8a4f00', lat: '#c47a00', atom: '#ffd84a', fr: 'rgba(120,60,0,.4)' };
  function particle(ctx, v, p, P) {
    const r = p.d / 2;
    if (!vis(v, p.x, p.y, r)) return;
    if (r * v.s < 1.2) { ctx.fillStyle = P.p1; ctx.fillRect(p.x - r, p.y - r, p.d, p.d); return; }
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.beginPath(); p.shape.forEach(([a, k], i) => { const x = Math.cos(a + p.th) * r * k, y = Math.sin(a + p.th) * r * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05); g.addColorStop(0, P.p0); g.addColorStop(1, P.p1);
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = px(v, 1.6); ctx.strokeStyle = P.line; ctx.stroke();
    if (p.zone) {
      const sp = 0.288 * v.s, fr = fade(sp, 2.2, 3.5) * (1 - fade(sp, 5, 8)), at = fade(sp, 5, 8);
      ctx.save(); ctx.clip(); ctx.rotate(p.th);
      if (fr > 0) { // lattice fringes, the first hint of atoms
        ctx.globalAlpha = fr; ctx.strokeStyle = P.fr; ctx.lineWidth = 0.1; ctx.beginPath();
        for (let y = -r; y <= r; y += 0.235) { ctx.moveTo(-r, y); ctx.lineTo(r, y); } ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (at > 0) { // atom columns, fcc gold seen along [110]
        ctx.globalAlpha = at; ctx.fillStyle = P.lat; ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
        const n = Math.ceil(r / 0.144) + 2, rr = 0.088;
        ctx.fillStyle = P.atom; ctx.beginPath();
        for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
          const x = i * 0.408 + j * 0.204, y = j * 0.144; if (x * x + y * y > r * r * 1.1) continue;
          ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU);
        }
        ctx.fill();
        if (!v.mono && rr * v.s > 3) {
          ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath();
          for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = i * 0.408 + j * 0.204, y = j * 0.144; if (x * x + y * y > r * r * 1.1) continue; ctx.moveTo(x - 0.02, y - 0.03); ctx.arc(x - 0.03, y - 0.03, 0.028, 0, TAU); }
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    ctx.restore();
  }
  return {
    id: 'gold', whats: Object.values(WHAT.gold), name: ['Gold atoms', 'Átomos de oro'], icon: '🥇', fovMax: 1500, fovMin: 2.2, start: { cx: 0, cy: 0, fov: 600 }, bound: 700, soft: false,
    blurb: ['Tiny specks of gold, called nanoparticles, sit on a thin film of carbon. Each speck is a ball of a few thousand atoms. Can you zoom in far enough to see them?', 'Pequeñísimas motas de oro, llamadas nanopartículas, descansan sobre una película delgada de carbono. Cada mota es una bolita de unos pocos miles de átomos. ¿Puedes hacer zoom hasta verlos?'],
    parts,
    bg: (m) => pal(m).bg,
    draw(ctx, v) {
      const P = pal(v.mono), t = texture(), a = fade(v.s * 16, 20, 60);
      if (t && a > 0) { // the amorphous carbon film's mottle
        const pat = ctx.createPattern(t, 'repeat'); pat.setTransform?.(new DOMMatrix().scale(16 / 128));
        ctx.globalAlpha = a * 0.22; ctx.fillStyle = pat; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0); ctx.globalAlpha = 1;
      }
      for (const p of parts) particle(ctx, v, p, P);
    },
    what(v) {
      const W = WHAT.gold;
      for (const p of parts) if (Math.hypot(v.cx - p.x, v.cy - p.y) < p.d / 2) return v.fov < 12 && p.zone ? W.atoms : v.fov < 12 ? W.tilted : W.particle;
      return v.fov < 40 ? W.film : W.many;
    },
  };
}

// ------------------------------------------------------------------ graphene: one layer of carbon atoms
function makeGraphene() {
  const a = 0.246, h = (a * Math.sqrt(3)) / 2, cc = a / Math.sqrt(3);
  const holes = [{ x: 42, y: -26, r: 17, s: 1 }, { x: -58, y: 48, r: 9, s: 2 }, { x: 2.1, y: 1.5, r: 0.42, s: 3 }, { x: 70, y: 60, r: 25, s: 4 }, { x: -90, y: -70, r: 14, s: 5 }];
  const rHole = (o, th) => o.r * (1 + 0.16 * Math.sin(3 * th + o.s) + 0.08 * Math.sin(5 * th + 2 * o.s));
  const inHole = (x, y) => holes.some((o) => { const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy); return d < o.r * 1.3 && d < rHole(o, Math.atan2(dy, dx)); });
  const blobs = [{ x: 14, y: 11, r: 5, s: 6 }, { x: -25, y: -9, r: 9, s: 7 }, { x: 30, y: 30, r: 14, s: 8 }, { x: -60, y: -20, r: 20, s: 9 }];
  const rBlob = (o, th) => o.r * (1 + 0.22 * Math.sin(2 * th + o.s) + 0.12 * Math.sin(5 * th + o.s * 3));
  const inBlob = (x, y) => blobs.some((o) => { const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy); return d < o.r * 1.4 && d < rBlob(o, Math.atan2(dy, dx)); });
  // lattice site (i, j, sub) → position
  const site = (i, j, sub) => [i * a + j * (a / 2), j * h + (sub ? cc : 0)];
  const si = site(-5, -4, 1), vac = site(4, 5, 0);
  const isSi = (x, y) => Math.abs(x - si[0]) < 1e-6 && Math.abs(y - si[1]) < 1e-6;
  const isVac = (x, y) => Math.abs(x - vac[0]) < 1e-6 && Math.abs(y - vac[1]) < 1e-6;
  const bi = { x: -30, y: -45, r: 26, s: 10 }; // a patch of two layers
  const pal = (m) => m
    ? { bg: '#e6e6e6', sheet: '#c9c9c9', bi: '#b2b2b2', hole: '#ededed', blob: '#8d8d8d', bond: '#555', atom: '#2a2a2a', si: '#050505' }
    : { bg: '#f4fbff', sheet: '#bdeaf0', bi: '#94d6e0', hole: '#fbfeff', blob: '#a99bd6', bond: '#3c6e7a', atom: '#25414b', si: '#9b4dff' };
  const poly = (ctx, o, f, n = 48) => { ctx.beginPath(); for (let k = 0; k <= n; k++) { const t = (k / n) * TAU, r = f(o, t); ctx.lineTo(o.x + Math.cos(t) * r, o.y + Math.sin(t) * r); } ctx.closePath(); };
  return {
    id: 'graphene', whats: Object.values(WHAT.graphene), name: ['Graphene', 'Grafeno'], icon: '✏️', fovMax: 260, fovMin: 1.1, start: { cx: 0, cy: 0, fov: 120 }, bound: 120, soft: false,
    blurb: ['Graphene is one single layer of carbon atoms, like a sheet peeled off pencil lead. It is the thinnest material there is, and very strong.', 'El grafeno es una sola capa de átomos de carbono, como una hojita despegada de la punta de un lápiz. Es el material más delgado que existe, y es muy fuerte.'],
    si, holes,
    bg: (m) => pal(m).bg,
    draw(ctx, v) {
      const P = pal(v.mono);
      ctx.fillStyle = P.sheet; ctx.fillRect(Math.max(v.x0, -150), Math.max(v.y0, -150), Math.min(v.x1, 150) - Math.max(v.x0, -150), Math.min(v.y1, 150) - Math.max(v.y0, -150));
      ctx.fillStyle = P.bi; poly(ctx, bi, (o, t) => o.r * (1 + 0.15 * Math.sin(3 * t + 1)), 60); ctx.fill();
      ctx.fillStyle = P.hole; for (const o of holes) if (vis(v, o.x, o.y, o.r * 1.3)) { poly(ctx, o, rHole, o.r > 2 ? 64 : 24); ctx.fill(); }
      const sp = cc * v.s, al = fade(sp, 3, 7);
      if (al > 0) { // the honeycomb
        const lat = (x, y) => { const j = y / h; return [x / a - j / 2, j]; };
        const cs = [lat(v.x0, v.y0), lat(v.x1, v.y0), lat(v.x0, v.y1), lat(v.x1, v.y1)];
        const i0 = Math.floor(Math.min(...cs.map((c) => c[0]))) - 2, i1 = Math.ceil(Math.max(...cs.map((c) => c[0]))) + 2;
        const j0 = Math.floor(Math.min(...cs.map((c) => c[1]))) - 2, j1 = Math.ceil(Math.max(...cs.map((c) => c[1]))) + 2;
        const ok = (x, y) => !inHole(x, y) && !isVac(x, y) && Math.abs(x) < 150 && Math.abs(y) < 150;
        ctx.globalAlpha = al; ctx.strokeStyle = P.bond; ctx.lineWidth = 0.045; ctx.lineCap = 'round'; ctx.beginPath();
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const [bx, by] = site(i, j, 1); if (!ok(bx, by)) continue;
          for (const [ax, ay] of [site(i, j, 0), site(i, j + 1, 0), site(i - 1, j + 1, 0)]) if (ok(ax, ay)) { ctx.moveTo(bx, by); ctx.lineTo(ax, ay); }
        }
        ctx.stroke();
        ctx.fillStyle = P.atom; ctx.beginPath();
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const sub of [0, 1]) {
          const [x, y] = site(i, j, sub); if (!ok(x, y) || isSi(x, y)) continue; ctx.moveTo(x + 0.055, y); ctx.arc(x, y, 0.055, 0, TAU);
        }
        ctx.fill();
        // the stranger: one silicon atom in the honeycomb
        ctx.fillStyle = P.si; ctx.beginPath(); ctx.arc(si[0], si[1], 0.1, 0, TAU); ctx.fill();
        if (!v.mono) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(si[0] - 0.03, si[1] - 0.035, 0.03, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      // sticky dirt from the air (hydrocarbons) covers some of it
      ctx.fillStyle = P.blob; ctx.globalAlpha = 0.85; for (const o of blobs) if (vis(v, o.x, o.y, o.r * 1.4)) { poly(ctx, o, rBlob, 64); ctx.fill(); } ctx.globalAlpha = 1;
    },
    what(v) {
      const W = WHAT.graphene;
      if (inBlob(v.cx, v.cy)) return W.dirt;
      if (inHole(v.cx, v.cy)) return W.hole;
      if (Math.hypot(v.cx - si[0], v.cy - si[1]) < Math.max(0.3, v.fov * 0.12) && v.fov < 6) return W.si;
      return v.fov < 6 ? W.atoms : W.sheet;
    },
  };
}

export const SPECIMENS = [makePollen(), makeBugs(), makeGold(), makeGraphene()];
