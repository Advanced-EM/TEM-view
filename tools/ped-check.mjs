// Precession check (M4): with precession off SAED and CBED are bit-identical to the code before M4
// (tools/ped-reference.json); with it on, increasing φ damps the thickness (Pendellösung) oscillation of the
// spot intensities and extends the visible reflections (regression test), a descan error smears the spots,
// HOLZ / fringe contrast in CBED is averaged out, and the settings travel through sessions and scripts.
// Run: node tools/ped-check.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import * as P from '../js/physics.js';
import { toSession, readSession } from '../js/session.js';
import { settingsToOps } from '../js/scripting.js';
import { modifiersFor } from '../js/registry.js';

const REF = JSON.parse(readFileSync(new URL('./ped-reference.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const h = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const make = (id, mode, cx, o = {}) => { const S = defaultState(); S.mode = mode; const sp = P.SPECIMENS[id]; S.spec = id; S.fov = sp.fov; [S.cx, S.cy] = sp.center; if (cx != null) S.cx = cx; Object.assign(S, o); const sim = new Sim(S); sim.update(0.05); return sim; };

// ---------------------------------------------------------------- precession off: unchanged
for (const [key, id, mode, cx] of [['sto-diff', 'sto', 'diff'], ['si-diff', 'si', 'diff', -100], ['au-diff', 'au', 'diff'], ['si-cbed', 'si', 'cbed', -100], ['sto-cbed', 'sto', 'cbed']]) {
  const sim = make(id, mode, cx);
  ok(h(mode === 'diff' ? sim.diff.I : sim.cbed.disp.arr) === REF[key], `${key}: precession off is bit-identical to the pre-M4 pattern`);
}
ok(modifiersFor('diff').some((m) => m.id === 'ped') && modifiersFor('cbed').some((m) => m.id === 'ped') && !modifiersFor('tem').some((m) => m.id === 'ped'), 'precession attaches to diffraction techniques only');

// ---------------------------------------------------------------- spot intensities in the Si crystal
// integrated intensity of each zero-order reflection of grain 0 (relative to the direct beam), over its footprint
function spots(sim) {
  const d = sim.diff, n = d.n, dk = d.dk, L = sim.cbed.lists(), r = sim.spec.grainRot[0], c = Math.cos(r), s = Math.sin(r), rp = 3;
  const I0 = d.I[(n / 2) * n + n / 2];
  return L.zolz.map((z) => {
    const gx = z.gx * c - z.gy * s, gy = z.gx * s + z.gy * c, px = Math.round(gx / dk + n / 2), py = Math.round(gy / dk + n / 2);
    if (px < rp || py < rp || px >= n - rp || py >= n - rp || z.g > 1.6) return null;
    let v = 0; for (let y = -rp; y <= rp; y++) for (let x = -rp; x <= rp; x++) v += d.I[(py + y) * n + px + x];
    return { hkl: `${z.h}${z.k}${z.l}`, g: z.g, xi: z.xi, I: v / I0 };
  }).filter(Boolean);
}
{
  const ts = [], series = { 0: [], 30: [] };
  for (let t = 5; t <= 60; t += 2.5) ts.push(t);
  let target = null;
  for (const phi of [0, 30]) for (const t of ts) {
    const sim = make('si', 'diff', -100, { pedOn: true, pedPhi: phi, pedSteps: 32, thick: t });
    const sp = spots(sim);
    target ??= sp.reduce((a, b) => (b.xi < a.xi ? b : a)); // the strongest low-order reflection
    series[phi].push(sp.find((x) => x.hkl === target.hkl).I);
  }
  const osc = (a) => { // oscillation about the smoothed trend: rms of the second difference, relative to the mean
    let s = 0; for (let i = 1; i < a.length - 1; i++) s += (a[i - 1] - 2 * a[i] + a[i + 1]) ** 2;
    return Math.sqrt(s / (a.length - 2)) / (a.reduce((x, y) => x + y) / a.length);
  };
  const extrema = (a) => { let n = 0; for (let i = 1; i < a.length - 1; i++) if ((a[i] - a[i - 1]) * (a[i + 1] - a[i]) < 0) n++; return n; };
  const o0 = osc(series[0]), o30 = osc(series[30]);
  ok(o30 < 0.5 * o0, `Si ${target.hkl} (ξ = ${(target.xi / 10).toFixed(1)} nm) over t = 5–60 nm: oscillation ${o0.toFixed(3)} at φ = 0 → ${o30.toFixed(3)} at φ = 30 mrad`);
  ok(extrema(series[0]) >= 2 && extrema(series[30]) <= extrema(series[0]), `Pendellösung extrema: ${extrema(series[0])} at φ = 0, ${extrema(series[30])} at φ = 30 mrad`);
  // two-beam check at φ = 0: the first intensity maximum near t ≈ ξ/2 (s_eff ≈ 1/ξ when the Ewald error is small)
  const i0 = series[0], imax = i0.indexOf(Math.max(...i0.slice(0, Math.min(i0.length, Math.ceil((target.xi / 10) / 2.5) + 2))));
  ok(Math.abs(ts[imax] - target.xi / 10 / 2) < 0.35 * target.xi / 10 + 2.5, `first two-beam maximum at t = ${ts[imax]} nm, ξ/2 = ${(target.xi / 20).toFixed(1)} nm`);
}
{
  const count = (phi) => { const sp = spots(make('si', 'diff', -100, { pedOn: true, pedPhi: phi, thick: 30 })), mx = Math.max(...sp.map((x) => x.I)); return { n: sp.filter((x) => x.I > 1e-3 * mx).length, gmax: Math.max(...sp.filter((x) => x.I > 1e-3 * mx).map((x) => x.g)) }; };
  const c0 = count(0), c30 = count(30);
  ok(c30.n > c0.n && c30.gmax >= c0.gmax, `visible reflections (> 10⁻³ of the strongest): ${c0.n} at φ = 0, ${c30.n} at φ = 30 mrad; reaching ${c0.gmax.toFixed(2)} → ${c30.gmax.toFixed(2)} Å⁻¹`);
}
{
  // descan error: the spot spreads into a ring of radius δφ/λ
  const spread = (descan) => {
    const sim = make('si', 'diff', -100, { pedOn: true, pedPhi: 30, pedDescan: descan, thick: 30 }), d = sim.diff, n = d.n, sp = spots(sim).sort((a, b) => b.I - a.I)[0];
    const L = sim.cbed.lists(), z = L.zolz.find((q) => `${q.h}${q.k}${q.l}` === sp.hkl), r = sim.spec.grainRot[0];
    const px = (z.gx * Math.cos(r) - z.gy * Math.sin(r)) / d.dk + n / 2, py = (z.gx * Math.sin(r) + z.gy * Math.cos(r)) / d.dk + n / 2, R = 8;
    let m0 = 0, m2 = 0;
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const v = d.I[(Math.round(py) + y) * n + Math.round(px) + x]; m0 += v; m2 += v * (x * x + y * y); }
    return Math.sqrt(m2 / m0) * d.dk;
  };
  const s0 = spread(0), s5 = spread(5), expect = (0.05 * 0.03) / P.wavelength(200);
  ok(s5 > s0 * 1.3 && s5 - s0 > 0.3 * expect, `descan error 5 % of φ: spot radius ${s0.toFixed(4)} → ${s5.toFixed(4)} Å⁻¹ (ring δφ/λ = ${expect.toFixed(4)} Å⁻¹)`);
}

// ---------------------------------------------------------------- CBED: HOLZ lines and fringes are averaged out
{
  const contrast = (on) => {
    const sim = make('si', 'cbed', -100, { pedOn: on, pedPhi: 20 }), d = sim.cbed.disp, W = d.W;
    const v = []; for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const tx = ((i + 0.5) / W * 2 - 1) * d.span, ty = ((j + 0.5) / W * 2 - 1) * d.span; if (Math.hypot(tx, ty) < 0.8 * d.a) v.push(d.arr[j * W + i]); }
    const m = v.reduce((a, b) => a + b) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / m;
  };
  const c0 = contrast(false), c1 = contrast(true);
  ok(c1 < 0.7 * c0, `CBED central disk contrast (HOLZ lines, fringes): ${c0.toFixed(3)} → ${c1.toFixed(3)} precessed at 20 mrad`);
}

// ---------------------------------------------------------------- sessions and scripts
{
  const S = defaultState(); Object.assign(S, { mode: 'diff', pedOn: true, pedPhi: 25, pedSteps: 64, pedDescan: 1.5 });
  const f = JSON.parse(JSON.stringify(toSession(S))), r = readSession(f);
  ok(f.mods.ped?.phi_mrad === 25 && r.state.pedOn && r.state.pedPhi === 25 && r.state.pedSteps === 64 && r.state.pedDescan === 1.5, 'session v2: mods.ped round trip');
  const ops = settingsToOps({ precession_mrad: 30, precession_steps: 48, descan_error_pct: 2 });
  ok(ops.some((o) => o.k === 'pedOn' && o.v === true) && ops.some((o) => o.k === 'pedPhi' && o.v === 30) && settingsToOps({ precession_mrad: 0 }).some((o) => o.k === 'pedOn' && o.v === false), 'scripts: precession_mrad switches it on (0 switches it off)');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
