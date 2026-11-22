// The gas cell and environmental TEM (M15): image contrast falls as exp(−nσL) across pressure and path length, in
// both geometries and for light and heavy gases; plus the diffuse background, gas-phase EELS and EDS, the windowed
// cell's burst, and the reactions with the heating chip.
import * as GAS from '../js/gas.js';
import * as ENV from '../js/environment.js';
import * as LIQ from '../js/liquid.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { chipState } from '../js/ops.js';
import { SPECIMENS } from '../js/physics.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const contrast = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / a.length) / m; };

function setup(mode, geo, gas, p, len, spec = 'au') {
  let seed = 7; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; // the same scan drift and noise in every run
  const S = defaultState(); S.mode = mode; S.spec = spec; S.clarity = 'edu';
  const sim = new Sim(S);
  chipState(S, sim, 'envCell', 'gas'); chipState(S, sim, 'gcGeom', geo);
  S.gcGas = gas; S.gcP = p; if (geo === 'open') S.gcPath = len; else S.gcGap = len;
  sim.invalidate('env');
  for (let i = 0; i < 4; i++) sim.update(0.02);
  return { S, sim };
}
const img = (q, mode) => (mode === 'tem' ? q.sim.tem.img : q.sim.stemImg.img);

// ---- contrast ∝ exp(−nσL)
for (const mode of ['tem', 'stem']) {
  const rows = [];
  for (const [geo, gas, p, len] of [['windowed', 'N2', 100, 5], ['windowed', 'N2', 1000, 5], ['windowed', 'N2', 1000, 40], ['windowed', 'Ar', 2000, 20], ['open', 'N2', 2, 2], ['open', 'N2', 20, 2], ['open', 'N2', 20, 8], ['open', 'H2', 20, 5]]) {
    const base = setup(mode, geo, gas, 1e-3, len), q = setup(mode, geo, gas, p, len), g = ENV.gasNow(q.S, q.sim.temp());
    const meas = contrast(img(q, mode)) / contrast(img(base, mode)), pred = g.col.transmitted / ENV.gasNow(base.S, base.sim.temp()).col.transmitted;
    rows.push({ geo, gas, p, len, meas, pred, N: g.col.N, sigma: g.col.tau / g.col.N });
  }
  const worst = Math.max(...rows.map((r) => Math.abs(r.meas / r.pred - 1)));
  ok(worst < 0.01, `${mode.toUpperCase()}: contrast relative to vacuum = exp(−nσL) in ${rows.length} cases (windowed and open, 0.1–2 bar and 2–20 mbar, µm gaps to mm paths, N₂, Ar, H₂): worst deviation ${(100 * worst).toFixed(2)} %`);
  if (mode === 'tem' || process.env.DBG) for (const r of rows) console.log(`     ${r.geo.padEnd(8)} ${r.gas.padEnd(3)} ${String(r.p).padStart(5)} mbar ${String(r.len).padStart(3)} ${r.geo === 'open' ? 'mm' : 'µm'}: nσL ${(-Math.log(r.pred)).toFixed(3)}, contrast ${(100 * r.meas).toFixed(1)} % (predicted ${(100 * r.pred).toFixed(1)} %)`);
}
{
  // n = p/kT: at fixed gas, −ln(transmission) per molecule per Å² is the cross-section, the same at every p and L
  const s = [[1000, 5e4], [100, 5e5], [10, 2e7], [2, 1e8]].map(([p, L]) => { const c = GAS.column({ gas: 'N2', pMbar: p, pathA: L, T: 293, kV: 200 }); return c.tau / c.N; });
  ok(Math.max(...s) / Math.min(...s) - 1 < 1e-12, `the same cross-section at every pressure and path: σ(N₂, 200 kV) = ${s[0].toFixed(4)} Å² per molecule`);
  const sH = GAS.crossSections('H2', 200).tot, sAr = GAS.crossSections('Ar', 200).tot, s300 = GAS.crossSections('N2', 300).tot;
  ok(sH < s[0] && sAr > GAS.crossSections('N2', 200).el && s300 < s[0], `heavier gases scatter more (H₂ ${sH.toFixed(4)}, Ar el. ${GAS.crossSections('Ar', 200).el.toFixed(4)} Å²), faster electrons less (N₂ at 300 kV ${s300.toFixed(4)} Å²)`);
}
// ---- background, spectra
{
  const med = (q) => { const a = Float32Array.from(q.sim.diff.I).sort(); return a[a.length >> 1]; };
  const lo = setup('diff', 'open', 'N2', 0.01, 2), hi = setup('diff', 'open', 'N2', 20, 5);
  ok(med(hi) > med(lo), `SAED: the gas adds a diffuse background (median ${med(lo).toPrecision(3)} → ${med(hi).toPrecision(3)})`);
}
{
  const q = setup('eels', 'windowed', 'O2', 1000, 40, 'au'), S = q.S; // gold: no oxygen of its own
  S.eelsDisp = 0.1; const sp = q.sim.channelSpectrum(520, 0, q.sim.eelsSite()), at = (E) => sp.spec[Math.round((E - sp.E0) / sp.dE)];
  ok(at(530.8) > 1.02 * at(527) && ENV.inelastic(S, S.kV).some((c) => /O₂/.test(c.label)), `EELS: O₂'s O K edge with its sharp π* peak at 530.8 eV (×${(at(530.8) / at(527)).toFixed(2)} above the pre-edge)`);
  const n2 = ENV.inelastic({ ...S, gcGas: 'N2' }, S.kV).find((c) => /N₂/.test(c.label));
  ok(n2?.edges[0].key === 'N', 'N₂ brings the N K edge; CO brings C K and O K');
}
{
  const q = setup('eds', 'windowed', 'Ar', 2000, 50, 'au'), s = q.sim.eds.spec, b = (E) => Math.round(E / 0.01);
  const r = s[b(2.957)] / ((s[b(2.85)] + s[b(3.05)]) / 2);
  ok(r > 1.4, `EDS: argon in the cell shows its Kα line (2.96 keV, ×${r.toFixed(2)} above the continuum)`);
}
// ---- the windowed cell bursts at the predicted pressure (its windows bulge like a liquid cell's)
{
  const geo = (S) => { S.lcA = 200; S.lcB = 800; S.envWinT = 10; };
  const Pb = LIQ.burstPressure({ a: 100e-6, b: 400e-6, t: 10e-9 }) / 1e5;
  const run = (bar) => { const S = defaultState(); S.mode = 'tem'; const sim = new Sim(S); chipState(S, sim, 'envCell', 'gas'); geo(S); S.gcP = bar * 1000; for (let i = 0; i < 3; i++) sim.update(0.05); return sim.gasSt; };
  const below = run(0.97 * Pb), above = run(1.03 * Pb);
  ok(Pb < 2 && !below.burst && !!above.burst && above.events[0].event === 'burst', `10 nm windows, 200 × 800 µm: hold at ${(0.97 * Pb).toFixed(2)} bar, burst at ${(1.03 * Pb).toFixed(2)} bar (predicted ${Pb.toFixed(2)} bar)`);
  const S = defaultState(); S.envCell = 'gas'; S.gcGeom = 'windowed'; S.gcP = 1000; S.lcA = 50; S.lcB = 200; S.envWinT = 30; S.gcGap = 5;
  ok(ENV.gasNow(S).pathA > 5e4, `at 1 bar the windows bulge the gas path from 5 µm to ${(ENV.gasNow(S).pathA / 1e4).toFixed(1)} µm`);
}
// ---- reactions with heat
{
  const S = defaultState(); S.mode = 'eds'; S.spec = 'sto'; const sim = new Sim(S);
  chipState(S, sim, 'holder', 'heat'); S.tempSet = 1000; chipState(S, sim, 'envCell', 'gas'); S.gcGas = 'H2'; S.gcP = 1000;
  for (let i = 0; i < 200; i++) sim.update(0.1);
  const xiH = sim.gasSt.xi, oH = sim.eds.compSym.O;
  S.gcGas = 'O2'; for (let i = 0; i < 200; i++) sim.update(0.1);
  const xiO = sim.gasSt.xi; sim.stale.si = 1; sim.update(0.1);
  ok(xiH > 0.8 && xiO < 0.2 && oH < sim.eds.compSym.O, `SrTiO₃ at 1000 K: reduced in H₂ (ξ = ${xiH.toFixed(2)}, less oxygen in EDS), re-oxidised in O₂ (ξ = ${xiO.toFixed(2)})`);
}
{
  const grow = (T, gas) => { const S = defaultState(); S.mode = 'tem'; S.spec = 'au'; const sim = new Sim(S); chipState(S, sim, 'holder', 'heat'); S.tempSet = T; chipState(S, sim, 'envCell', 'gas'); S.gcGas = gas; for (let i = 0; i < 400; i++) sim.update(0.1); const r = SPECIMENS.au.parts[0].r; sim.resetGas(); return r; };
  const r0 = SPECIMENS.au.parts[0].r, cold = grow(293, 'O2'), hot = grow(1400, 'N2'), hotO = grow(1400, 'O2'); // calibrated: 1.2 eV, a 10 % change in 1 h near 1000 K
  ok(cold === r0 && hot > r0 && hotO > hot, `gold sinters when hot (${r0} → ${hot} Å in 40 s at 1400 K in N₂, ${hotO} Å in O₂), not at room temperature`);
}
// ---- geometry limits
{
  const S = defaultState(); S.holder = 'room'; const sim = new Sim(S);
  chipState(S, sim, 'envCell', 'gas'); chipState(S, sim, 'gcGeom', 'open'); S.gcP = 1000;
  ok(ENV.windowsOf(S) === null && ENV.maxTilt(S) === 80 && ENV.gasNow(S).cell.pMbar === 20, 'an open column has no windows, takes the ordinary holder\'s tilt, and holds at most 20 mbar at the specimen');
  chipState(S, sim, 'gcGeom', 'windowed');
  ok(ENV.windowsOf(S)?.key === 'sinx' && ENV.maxTilt(S) === 20, 'a windowed cell has SiNₓ windows and tilts ±20°');
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
