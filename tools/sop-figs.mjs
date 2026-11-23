// Figures for the in situ, single-particle cryo-EM and 3D ED procedures (docs/guides/sop-05, -06, -07), computed by
// TEM-view itself: images as PNG (grey or magma), curves as SVG. Rerun after the physics changes:
//   node tools/sop-figs.mjs            all three
//   node tools/sop-figs.mjs spa        only one (insitu | spa | ed3d)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { specState, chipState } from '../js/ops.js';
import * as SPA from '../js/spa.js';
import * as ED from '../js/ed3d.js';
import * as Z from '../js/zone.js';
import * as P from '../js/physics.js';
import * as TOMO from '../js/tomo.js';
import * as LIQ from '../js/liquid.js';
import * as C from '../js/insitu-cal.js';
import * as K from '../js/kinetics.js';
import { PUBLISHED } from '../js/calibration-published.js';

const OUT = new URL('../docs/guides/fig/', import.meta.url);
const only = process.argv[2] ?? '';

// ---------------------------------------------------------------- PNG and SVG writers
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
// stops of the exhibit's magma map
const MAGMA = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 253, 191]];
const lut = (v, map) => { if (map === 'grey') { const g = Math.round(255 * v); return [g, g, g]; } const x = v * (MAGMA.length - 1), i = Math.min(MAGMA.length - 2, Math.floor(x)), f = x - i; return MAGMA[i].map((a, j) => Math.round(a + f * (MAGMA[i + 1][j] - a))); };
function range(arr, plo = 0.01, phi = 0.995) { const s = Float32Array.from(arr).filter(Number.isFinite).sort(); return [s[Math.floor(plo * (s.length - 1))], s[Math.floor(phi * (s.length - 1))]]; }
// arr[x + w y] → an RGB PNG scaled by an integer factor
function png(name, arr, w, h, { map = 'grey', lo, hi, scale = 1, invert = false, marks = [] } = {}) {
  if (lo === undefined || hi === undefined) [lo, hi] = range(arr);
  const W = w * scale, H = h * scale, raw = Buffer.alloc((3 * W + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (3 * W + 1)] = 0;
    for (let x = 0; x < W; x++) {
      let v = (arr[Math.floor(x / scale) + w * Math.floor(y / scale)] - lo) / (hi - lo || 1); v = Math.max(0, Math.min(1, v)); if (invert) v = 1 - v;
      const [r, g, b] = lut(v, map), o = y * (3 * W + 1) + 1 + 3 * x; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  for (const m of marks) { // small rings: [x, y, r, [r,g,b]] in source pixels
    const [mx, my, mr, col] = m;
    for (let a = 0; a < 360; a += 2) { const x = Math.round((mx + mr * Math.cos((a * Math.PI) / 180)) * scale), y = Math.round((my + mr * Math.sin((a * Math.PI) / 180)) * scale); if (x >= 0 && y >= 0 && x < W && y < H) { const o = y * (3 * W + 1) + 1 + 3 * x; raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; } }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(new URL(name, OUT), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log(`fig/${name}  ${W}×${H}`);
}
// a line plot: series [{ pts: [[x, y]], color, label, dash, dots }], axes labels, optional reference lines
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function svgPlot(name, series, { xlab, ylab, xlim, ylim, hlines = [], vlines = [], w = 520, h = 300, logy = false } = {}) {
  const L = 56, R = 14, T = 14, B = 42, all = series.flatMap((s) => s.pts);
  const [x0, x1] = xlim ?? [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const fy = (y) => (logy ? Math.log10(y) : y);
  const [y0, y1] = ylim ?? [Math.min(...all.map((p) => fy(p[1]))), Math.max(...all.map((p) => fy(p[1])))];
  const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (w - L - R), Y = (y) => h - B - ((fy(y) - y0) / (y1 - y0 || 1)) * (h - T - B);
  const ticks = (a, b, n = 5) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / n))), m = [1, 2, 5, 10].find((k) => (b - a) / (k * st) <= n) * st; const out = []; for (let v = Math.ceil(a / m) * m; v <= b + 1e-9; v += m) out.push(+v.toPrecision(6)); return out; };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="11"><rect width="${w}" height="${h}" fill="#fff"/>`;
  for (const t of ticks(x0, x1)) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${h - B}" stroke="#e6e9ee"/><text x="${X(t)}" y="${h - B + 15}" text-anchor="middle" fill="#55606e">${t}</text>`;
  for (const t of ticks(y0, y1)) { const yy = h - B - ((t - y0) / (y1 - y0 || 1)) * (h - T - B); s += `<line x1="${L}" x2="${w - R}" y1="${yy}" y2="${yy}" stroke="#e6e9ee"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" fill="#55606e">${logy ? `10^${t}` : t}</text>`; }
  s += `<line x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}" stroke="#55606e"/><line x1="${L}" x2="${L}" y1="${T}" y2="${h - B}" stroke="#55606e"/>`;
  for (const v of hlines) s += `<line x1="${L}" x2="${w - R}" y1="${Y(v.y)}" y2="${Y(v.y)}" stroke="${v.color ?? '#999'}" stroke-dasharray="4 4"/><text x="${w - R - 4}" y="${Y(v.y) - 4}" text-anchor="end" fill="${v.color ?? '#777'}">${esc(v.label ?? '')}</text>`;
  for (const v of vlines) s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${T}" y2="${h - B}" stroke="${v.color ?? '#999'}" stroke-dasharray="4 4"/><text x="${X(v.x) + 4}" y="${T + 12}" fill="${v.color ?? '#777'}">${esc(v.label ?? '')}</text>`;
  series.forEach((sr, i) => {
    const pts = sr.pts.filter((p) => Number.isFinite(p[1]) && (!logy || p[1] > 0));
    if (sr.dots) for (const p of pts) s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.6" fill="${sr.color}"/>`;
    else s += `<polyline fill="none" stroke="${sr.color}" stroke-width="2" ${sr.dash ? 'stroke-dasharray="6 4"' : ''} points="${pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`;
    s += `<rect x="${L + 10}" y="${T + 6 + i * 16}" width="12" height="3" fill="${sr.color}"/><text x="${L + 28}" y="${T + 11 + i * 16}" fill="#222">${esc(sr.label)}</text>`;
  });
  s += `<text x="${(L + w - R) / 2}" y="${h - 8}" text-anchor="middle" fill="#222">${esc(xlab)}</text><text transform="translate(14 ${(T + h - B) / 2}) rotate(-90)" text-anchor="middle" fill="#222">${esc(ylab)}</text></svg>`;
  writeFileSync(new URL(name, OUT), s);
  console.log(`fig/${name}`);
}
const BLUE = '#1f6fb2', ORANGE = '#d9822b', GREEN = '#2e8b57', GREY = '#888';

// ---------------------------------------------------------------- SOP-05: in situ
if (!only || only === 'insitu') {
  K.applyProfile(PUBLISHED);
  // the window: liquid thickness across a 50 × 200 µm SiNₓ window at 1 bar
  { const S = { ...defaultState(), envCell: 'liquid', lcClass: 'sinx', lcA: 50, lcB: 200, lcGap: 200, lcDP: 1 }, c = LIQ.cellOf(S), n = 120, arr = new Float32Array(n * n * 4);
    for (let j = 0; j < 4 * n; j++) for (let i = 0; i < n; i++) { const u = ((i + 0.5) / n) * 2 - 1, v = ((j + 0.5) / (4 * n)) * 2 - 1; arr[i + n * j] = c.gap + 2 * c.w * (1 - u * u) * (1 - v ** 8); }
    png('sop5_window.png', arr, n, 4 * n, { map: 'magma', lo: 0, hi: c.gap + 2 * c.w });
    console.log(`  window bulge ${(c.w * 1e6).toFixed(2)} µm, burst ${(c.burstP / 1e5).toFixed(1)} bar`); }
  // nucleation: reduced metal against the threshold, below and above the threshold dose rate (silver, 1 mM)
  { const base = { ...defaultState(), mode: 'tem', envCell: 'liquid', lcGap: 800, lcPrecursor: true, lcMetal: 'ag', kV: 200 }, times = Array.from({ length: 121 }, (_, i) => i * 0.5);
    const run = (rate) => C.simulateSeries({ ...base, lcRate: rate }, times).map((r) => [r.t, r.supersat]);
    const thr = LIQ.nucleationThreshold({ ...base, lcRate: 3.37 });
    svgPlot('sop5_nucleation.svg', [{ pts: run(3.37), color: ORANGE, label: '3.37 e⁻/Å²/s' }, { pts: run(1), color: BLUE, label: '1 e⁻/Å²/s' }, { pts: run(0.4), color: GREY, label: `0.4 e⁻/Å²/s (below ${thr.toFixed(2)})` }],
      { xlab: 'time (s)', ylab: 'reduced silver / amount to nucleate', ylim: [0, 1.6], hlines: [{ y: 1, label: 'first nucleus', color: '#b33' }] }); }
  // coarsening of gold on a heating chip: a ramp to 1250 K in O₂ and N₂
  { const mk = (gas) => { const S = { ...defaultState(), spec: 'au', holder: 'heat', envCell: 'gas', gcGeom: 'windowed', gcGas: gas, gcP: 500, tempSet: 300, timeline: [{ key: 'tempSet', t0: 10, t1: 110, to: 1250 }] }; return C.simulateSeries(S, Array.from({ length: 151 }, (_, i) => i * 2)).map((r) => [r.T_K, r.sinter_A]); };
    svgPlot('sop5_coarsening.svg', [{ pts: mk('O2'), color: ORANGE, label: 'O₂, 500 mbar' }, { pts: mk('N2'), color: BLUE, label: 'N₂, 500 mbar' }], { xlab: 'temperature (K)', ylab: 'radius gained (Å)', xlim: [800, 1260] }); }
  // calibrating to your own data: a series made with known parameters, fitted back
  { const S = { ...defaultState(), spec: 'au', holder: 'heat', envCell: 'gas', gcGeom: 'windowed', gcGas: 'N2', gcP: 100, tempSet: 1000, timeline: [{ key: 'tempSet', t0: 0, t1: 7200, to: 1300 }] };
    for (const [k, v] of Object.entries({ sinter_A: 2500, sinter_Ea: 1.35 })) K.P[k].v = v;
    const times = Array.from({ length: 31 }, (_, i) => i * 240), truth = C.simulateSeries(S, times); K.applyProfile(PUBLISHED);
    let seed = 3; const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.1; };
    const rows = truth.map((r) => ({ t: r.t, T_K: r.T_K, radius_A: r.radius_A + noise(), radius_A_sd: 0.03 }));
    const before = C.simulateSeries(S, times), d = C.userDataset(S, { rows, title: 'your series' }), { profile } = C.fit([d], { name: 'mine' });
    const prev = K.CAL.profile; K.applyProfile(profile); const after = C.simulateSeries(S, times); K.applyProfile(prev);
    svgPlot('sop5_calfit.svg', [{ pts: rows.map((r) => [r.T_K, r.radius_A]), color: '#222', label: 'your measurements', dots: true }, { pts: before.map((r) => [r.T_K, r.radius_A]), color: GREY, label: 'published profile', dash: true }, { pts: after.map((r) => [r.T_K, r.radius_A]), color: ORANGE, label: `fitted: Eₐ ${profile.params.sinter_Ea.v} eV, χ²ᵣ ${profile.fit.reduced_chi2}` }],
      { xlab: 'temperature (K)', ylab: 'particle radius (Å)' }); }
}

// ---------------------------------------------------------------- SOP-06: single-particle cryo-EM
if (!only || only === 'spa') {
  // the particle as a specimen in TEM: phase contrast at 1.5 µm underfocus
  { const S = defaultState(); S.mode = 'tem'; let sim = new Sim(S); specState(S, sim, 'apo'); sim = new Sim(S); S.fov = 25; sim.update(0.1); sim.update(0.1); const t = sim.tem;
    if (t?.img) png('sop6_particle_tem.png', t.img, t.c, t.c, { scale: Math.max(1, Math.round(360 / t.c)) }); else console.log('  (no TEM image)'); }
  const st = SPA.runSPA({ sample: 'apo', count: 2000, dose: 40, df: 1.5, seed: 11 }), o = SPA.spaResult(st);
  const m = o.mic, M = m.M, sc = M / 256;
  png('sop6_micrograph.png', m.img, M, M, { marks: (m.picks ?? []).slice(0, 60).map((p) => [p.x, p.y, 14, p.hit ? [80, 200, 255] : [255, 140, 40]]) });
  if (m.ps) { // as the exhibit's CTF view: centred, log, radial background removed; measured (left) beside the fitted |T|² (right)
    const n = o.N, h = n / 2, fitm = m.fit, at = (x, y) => Math.log(m.ps[((x + h) % n) + n * ((y + h) % n)] + 1e-30);
    const lg = new Float64Array(h + 1), cnt = new Float64Array(h + 1);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = Math.round(Math.hypot(x - h, y - h)); if (r <= h) { lg[r] += at(x, y); cnt[r]++; } }
    const bg = Array.from(lg, (v, r) => (cnt[r] ? v / cnt[r] : 0) - (fitm?.profile[r] ?? 0)), img = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < h; x++) img[x + n * y] = at(x, y) - bg[Math.min(h, Math.round(Math.hypot(x - h, y - h)))];
    const [plo, phi] = range(img.filter((_, i) => i % n < h), 0.05, 0.98);
    for (let y = 0; y < n; y++) for (let x = h; x < n; x++) { const r = Math.round(Math.hypot(x - h, y - h)); img[x + n * y] = fitm && r < h && r > 1 ? plo + (phi - plo) * (fitm.model[r] / 4) : plo; }
    const U = 320, up = new Float32Array(U * U); // bilinear upsampling, so the rings are not drawn as blocks
    for (let Y = 0; Y < U; Y++) for (let X = 0; X < U; X++) { const fx = Math.min(n - 1.001, Math.max(0, ((X + 0.5) * n) / U - 0.5)), fy = Math.min(n - 1.001, Math.max(0, ((Y + 0.5) * n) / U - 0.5)), i = Math.floor(fx), j = Math.floor(fy), dx = fx - i, dy = fy - j;
      up[X + U * Y] = (img[i + n * j] * (1 - dx) + img[i + 1 + n * j] * dx) * (1 - dy) + (img[i + n * (j + 1)] * (1 - dx) + img[i + 1 + n * (j + 1)] * dx) * dy; }
    for (let Y = 0; Y < U; Y++) up[U / 2 + U * Y] = phi; // the divide between measured and fitted
    png('sop6_ctf.png', up, U, U, { lo: plo, hi: phi });
    console.log(`  CTF: defocus fitted ${m.dfEst?.toFixed?.(0)} Å, true ${m.dfTrue?.toFixed?.(0)} Å, score ${fitm?.score?.toFixed(2)}`); }
  if (o.gallery) { // 4 × 4 class averages in one tile
    const N = o.N, k = Math.min(16, o.gallery.length), cols = 4, rows = Math.ceil(k / cols), tile = new Float32Array(cols * N * rows * N);
    o.gallery.slice(0, k).forEach((g, i) => { const [lo, hi] = range(g.img); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) tile[(i % cols) * N + x + cols * N * (Math.floor(i / cols) * N + y)] = (g.img[x + N * y] - lo) / (hi - lo || 1); });
    png('sop6_classes.png', tile, cols * N, rows * N, { lo: 0, hi: 1, scale: 2, invert: true }); }
  if (o.mapAvg) { const N = o.N, r = TOMO.render3D(o.mapAvg, N, 25, 20, { mode: 'sum' }); png('sop6_map.png', r, N, N, { map: 'magma', scale: 5 }); }
  if (o.fsc) svgPlot('sop6_fsc.svg', [{ pts: o.fsc.curve.map((c) => [c.k, c.fsc]), color: BLUE, label: `global: ${o.fsc.res.toFixed(1)} Å` }, { pts: o.fscZ.curve.map((c) => [c.k, c.fsc]), color: ORANGE, label: `along z: ${o.fscZ.res.toFixed(1)} Å`, dash: true }, { pts: o.fscXY.curve.map((c) => [c.k, c.fsc]), color: GREEN, label: `across: ${o.fscXY.res.toFixed(1)} Å`, dash: true }],
    { xlab: 'spatial frequency (1/Å)', ylab: 'FSC', ylim: [-0.1, 1.05], hlines: [{ y: 0.143, label: '0.143', color: '#b33' }] });
  console.log(`  SPA: ${o.accepted} kept of ${o.made}, ${o.fsc?.res.toFixed(2)} Å; picks precision ${m.precision?.toFixed(2)}, recall ${m.recall?.toFixed(2)}`);
  // preferred orientation: the same data with 80 % top views
  const p2 = SPA.spaResult(SPA.runSPA({ sample: 'apo', count: 2000, dose: 40, df: 1.5, pref: 0.8, seed: 11 }));
  if (p2.fsc) svgPlot('sop6_pref.svg', [{ pts: p2.fsc.curve.map((c) => [c.k, c.fsc]), color: BLUE, label: `global: ${p2.fsc.res.toFixed(1)} Å` }, { pts: p2.fscZ.curve.map((c) => [c.k, c.fsc]), color: ORANGE, label: `along the beam: ${p2.fscZ.res.toFixed(1)} Å` }, { pts: p2.fscXY.curve.map((c) => [c.k, c.fsc]), color: GREEN, label: `across: ${p2.fscXY.res.toFixed(1)} Å` }],
    { xlab: 'spatial frequency (1/Å)', ylab: 'FSC', ylim: [-0.1, 1.05], hlines: [{ y: 0.143, label: '0.143', color: '#b33' }] });
}

// ---------------------------------------------------------------- SOP-07: 3D ED
if (!only || only === 'ed3d') {
  const S = defaultState(); Object.assign(S, { mode: 'ed3d', spec: 'sto', zone: [1, 2, 5], cx: 0, cy: 0, edStart: -45, edEnd: 45, camL: 600 });
  let sim = new Sim(S); sim.update(0.05); sim.startED3D(); sim.stepED3D(1e6); const e = sim.ed;
  const f = Math.floor(e.series.plan.frames / 2), img = sim.edFrame(256);
  if (img) { const lg = img.arr.map((v, i) => Math.log10(v + (img.stack ? 0.15 * img.stack[i] : 0) + 3)); /* this frame over the stack of all frames, as in the exhibit */ png('sop7_frame.png', lg, img.W, img.W, { map: 'magma', scale: 2, lo: range(lg, 0.2, 0.9995)[0], hi: range(lg, 0.2, 0.9995)[1] }); }
  // reciprocal space turned (yaw 30°, pitch 20°): recorded reflections filled, missing ones hollow, as in the exhibit
  { const fr = TOMO.viewFrame3D(30, 20), acc = new Map(); e.series.frames.forEach((q) => { for (const o of q) acc.set(o.i, (acc.get(o.i) ?? 0) + o.n); });
    let gm = 0, Im = 0; for (const R of e.refl) gm = Math.max(gm, Math.hypot(...R.v)); for (const v of acc.values()) Im = Math.max(Im, v);
    const W = 420, c = W / 2, s = (W / 2 - 12) / gm, pts = e.refl.map((R, i) => ({ x: c + s * (R.v[0] * fr.u[0] + R.v[1] * fr.u[1] + R.v[2] * fr.u[2]), y: c + s * (R.v[0] * fr.v[0] + R.v[1] * fr.v[1] + R.v[2] * fr.v[2]), z: R.v[0] * fr.w[0] + R.v[1] * fr.w[1] + R.v[2] * fr.w[2], I: acc.get(i), seen: acc.has(i) })).sort((a, b) => b.z - a.z);
    const ax = [Math.cos((S.edAxis * Math.PI) / 180), Math.sin((S.edAxis * Math.PI) / 180), 0], pu = ax[0] * fr.u[0] + ax[1] * fr.u[1], pv = ax[0] * fr.v[0] + ax[1] * fr.v[1];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="#06080b"/>`;
    for (const p of pts) { const op = (0.45 + 0.55 * (0.5 - (0.5 * p.z) / gm)).toFixed(2); svg += p.seen ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(1.3 + 3.2 * Math.sqrt(p.I / Im)).toFixed(1)}" fill="#6fd6ff" fill-opacity="${op}"/>` : `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.3" fill="none" stroke="#fff" stroke-opacity="${(0.35 * op).toFixed(2)}"/>`; }
    svg += `<line x1="${c - c * pu}" y1="${c - c * pv}" x2="${c + c * pu}" y2="${c + c * pv}" stroke="#ffb454" stroke-dasharray="5 5"/></svg>`;
    writeFileSync(new URL('sop7_recip3d.svg', OUT), svg); console.log('fig/sop7_recip3d.svg'); }
  svgPlot('sop7_shells.svg', [{ pts: e.stats.shells.map((sh) => [1 / sh.dHigh, 100 * sh.completeness]), color: BLUE, label: `completeness, ±${S.edEnd}° (${(100 * e.stats.completeness).toFixed(0)} % overall)` }],
    { xlab: 'resolution shell, 1/d (1/Å)', ylab: 'completeness (%)', ylim: [0, 100] });
  // the dose budget: the resolution where median I/σ ≥ 2 against the dose rate (critical dose of the MOF)
  // the dose budget: the resolution reached (median I/σ ≥ 2) against the dose rate, for a beam-sensitive crystal
  // (critical dose 25 e⁻/Å²) and a robust one; ±40° cRED at 1°/s, as in tools/ed3d-check.mjs
  { const lam = P.wavelength(200), base = { method: 'cred', speed: 1, fps: 10, step: 1, exposure: 0.5, axis: 23, pedPhi: 20, t: 1500, lam, mosaic: 0.05, start: -40, end: 40 };
    const refl = ED.reflections(Z.zoneCryst('mapb', [1, 2, 5]), 1.1, 200, 1500), rates = [-5, -4.5, -4, -3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5];
    const k = (rate, Dc) => { const d = ED.statistics(refl, ED.collect(refl, { ...base, doseRate: 10 ** rate, Dc }), { merge: 'friedel', gMax: 1.1 }).dLimit; return d ? 1 / d : 0; };
    svgPlot('sop7_dose.svg', [{ pts: rates.map((r) => [r, k(r, 25)]), color: ORANGE, label: 'beam-sensitive (D_c 25 e⁻/Å²)' }, { pts: rates.map((r) => [r, k(r, Infinity)]), color: BLUE, label: 'robust crystal', dash: true }],
      { xlab: 'log₁₀ dose rate (e⁻/Å²/s), 80 s series', ylab: 'resolution reached, 1/d (1/Å)', ylim: [0, 1.15] }); }
  console.log(`  ED: ${e.name}, ${e.series.plan.frames} frames, ${(100 * e.stats.completeness).toFixed(1)} % complete, d ${e.stats.dLimit?.toFixed(2)} Å`);
}
