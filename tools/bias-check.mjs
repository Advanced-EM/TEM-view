// Biasing (M16): the holographic phase across a biased gap returns the voltage on the specimen (Twitchett et al.
// 2002: Δφ = C_E t ΔV), the stray field adds the vacuum's projected potential, and the circuit (contacts, series
// resistance, leakage, compliance), the failures (breakdown, contact burn-out, electromigration), Joule heating, the
// I–V trace, the beam deflection in every mode and electrochemistry under liquid behave as modelled.
import * as B from '../js/bias.js';
import * as P from '../js/physics.js';
import * as ENV from '../js/environment.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { chipState } from '../js/ops.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const base = (o = {}) => Object.assign(defaultState(), { clarity: 'edu', bsOn: true, bsLayout: 'two', bsGap: 2, bsMat: 'insulator', bsV: 5, bsRc: 0, bsRs: 0, bsStray: false }, o);
const sigma = P.sigmaOf(200);

// ---- the field solver
{
  const s = B.solve('two'), t = B.solve('tip');
  const Ec = B.sample(s, s.u, -0.1, 0) - B.sample(s, s.u, 0.1, 0);
  ok(Math.abs(Ec / 0.2 - 1) < 0.01, `parallel electrodes: a uniform field V/g in the gap (${(Ec / 0.2).toFixed(4)} V/g at the centre)`);
  ok(t.Emax > 1.6 * s.Emax && t.F < s.F, `a tip concentrates the field (peak ${t.Emax.toFixed(2)} V/g against ${s.Emax.toFixed(2)} at the parallel electrodes' corners) and conducts less (shape factor ${t.F.toFixed(2)} vs ${s.F.toFixed(2)})`);
  // the vacuum projector against the analytic result for one Fourier component, V₀ cos(2πkx) e^(−2π|k||z|)
  const sol = { N: 129, H: 4 / 128, u: new Float64Array(129 * 129), vac: new Map(), layout: 'x' }, k = 3 / 8;
  for (let j = 0; j < 129; j++) for (let i = 0; i < 129; i++) sol.u[j * 129 + i] = Math.cos(2 * Math.PI * k * i * sol.H); // even about the film's edges
  const p = B.vacuum(sol, 0.05), got = B.sample(sol, p, -2 + 8 * sol.H, 0), want = B.vacuumCosine(1, k, 0.05) * Math.cos(2 * Math.PI * k * 8 * sol.H);
  ok(Math.abs(got / want - 1) < 1e-6, `the stray field: the vacuum above and below adds V₀ e^(−π|k|t)/(π|k|) per Fourier component (${got.toFixed(5)} vs ${want.toFixed(5)})`);
}

// ---- off-axis holography across the gap: the acceptance test
function holo(o) {
  // 5 nm field of view: the hologram overlap covers it and the fringes are sampled finely enough that the crystal's
  // centre band stays out of the sideband (a 100 nm SrTiO₃ film, an unbiased hologram subtracted, as in practice)
  const S = base({ mode: 'oah', spec: 'sto', thick: 100, fov: 5, bsV: 20, ...o }), sim = new Sim(S);
  sim.update(0.02); sim.update(0.02);
  return { d: sim.oah.disp, sim };
}
function fit(a, b) { // least-squares plane through the (wrapped) phase difference in the overlap: its gradient, rad/Å
  const { c, dx, inOv } = a; let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, szx = 0, szy = 0;
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
    const i = y * c + x; if (!inOv[i]) continue;
    let d = a.ph[i] - b.ph[i]; d = Math.atan2(Math.sin(d), Math.cos(d));
    const X = x * dx, Y = y * dx; n++; sx += X; sy += Y; sxx += X * X; syy += Y * Y; sxy += X * Y; sz += d; szx += d * X; szy += d * Y;
  }
  const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, czx = szx / n - (sz / n) * mx, czy = szy / n - (sz / n) * my, det = cxx * cyy - cxy * cxy;
  return [(czx * cyy - czy * cxy) / det, (czy * cxx - czx * cxy) / det];
}
const gradAt = (o) => { const on = holo(o), off = holo({ ...o, bsOn: false }); return { g: fit(on.d, off.d), pred: on.sim.biasGrad(), op: on.sim.biasSt.op }; };
for (const layout of ['two', 'tip']) {
  // one stage position per cell of the field grid, from electrode to electrode along the gap's axis
  const g = 2e4, H = 4 / 128, xs = Array.from({ length: 32 }, (_, k) => (-0.5 + (k + 0.5) * H) * g);
  let integral = 0, worst = 0, op = null;
  for (const cx of xs) { const r = gradAt({ bsLayout: layout, cx }); integral += -r.g[0] * H * g; worst = Math.max(worst, Math.abs(r.g[0] / r.pred[0] - 1)); op = r.op; }
  const Vh = integral / (sigma * 1000);
  ok(Math.abs(Vh / op.Vspec - 1) < 0.01 && worst < 0.03, `${layout === 'tip' ? 'tip facing a plane' : 'parallel electrodes'}, 2 µm gap, 100 nm film: the holographic phase gradient integrated across the gap, ÷ C_E t, gives ${Vh.toFixed(3)} V for ${op.Vspec.toFixed(3)} V on the specimen (each position within ${(100 * worst).toFixed(1)} % of the field solution)`);
}
{
  // a two-terminal circuit with contacts: the phase sees the specimen's voltage, not the source's
  const o = { bsMat: 'semi', thick: 100, bsV: 2, bsRc: 2000, bsRs: 500, bsLimit: 10000 };
  const r = gradAt(o), V = -r.g[0] / (sigma * 1000) * 2e4;
  ok(Math.abs(V / r.op.Vspec - 1) < 0.02 && r.op.Vspec < 0.6 * 2, `with 2 × 2 kΩ contacts and 500 Ω in series, the hologram shows ${V.toFixed(3)} V across the specimen (${r.op.Vspec.toFixed(3)} V) of the 2 V applied`);
  const two = B.operate(base({ ...o, bsLayout: 'two' }), r.op.R ?? B.specimenR(base(o), 293, B.solve('two').F)), four = B.operate(base({ ...o, bsLayout: 'four' }), B.specimenR(base(o), 293, B.solve('two').F));
  ok(Math.abs(four.Vmeas - four.Vspec) < 1e-12 && two.Vmeas > 1.5 * two.Vspec, `four-terminal sense contacts read the specimen's ${four.Vspec.toFixed(3)} V; a two-terminal readback includes both contacts (${two.Vmeas.toFixed(3)} V)`);
}
{
  // the stray field: the vacuum above and below the chip adds C_E V g p(x) and dominates a thin film's own phase
  const on = gradAt({ bsStray: true, cx: 1000, bsV: 2 }), off = gradAt({ bsStray: false, cx: 1000, bsV: 2 });
  ok(Math.abs(on.g[0] / on.pred[0] - 1) < 0.02 && Math.abs(on.g[0]) > 5 * Math.abs(off.g[0]), `with the stray field the hologram measures ${on.g[0].toExponential(3)} rad/Å (field solution ${on.pred[0].toExponential(3)}), ${(on.g[0] / off.g[0]).toFixed(0)}× the film's own`);
}

// ---- the circuit, compliance and the source modes
{
  const S = base({ bsMat: 'semi', thick: 50, bsGap: 5, bsRc: 100, bsRs: 50, bsLimit: 100 }), R = B.specimenR(S, 293, B.solve('two').F);
  const lo = B.operate({ ...S, bsV: 0.5 }, R), hi = B.operate({ ...S, bsV: 10 }, R);
  ok(!lo.limited && Math.abs(lo.I - 0.5 / (R * 1e9 / (R + 1e9) + 250)) < 1e-12 && hi.limited === 'compliance' && Math.abs(hi.I - 1e-4) < 1e-15, `compliance: ${(lo.I * 1e6).toFixed(1)} µA at 0.5 V; at 10 V the source clamps to ${(hi.I * 1e6).toFixed(0)} µA (specimen ${(R / 1e3).toFixed(1)} kΩ)`);
  const cur = B.operate({ ...S, bsMode: 'I', bsI: 1e4 }, R);
  ok(cur.limited === 'voltage' && Math.abs(Math.abs(cur.Vsrc) - B.MAX_V) < 1e-9, `current mode: 10 mA would need ${((1e-2 * (R + 250)) / 1).toFixed(0)} V; the source stops at its ${B.MAX_V} V limit`);
  const leaky = B.operate({ ...S, bsMat: 'insulator', bsLeak: 1e6, bsV: 1 }, B.specimenR({ ...S, bsMat: 'insulator' }, 293, B.solve('two').F));
  ok(leaky.Ispec < 1e-3 * leaky.I, `a leaky substrate carries the current past an insulating specimen (${(leaky.I * 1e6).toFixed(2)} µA in all, ${(leaky.Ispec * 1e12).toFixed(2)} pA through the specimen)`);
}

// ---- failures
const run = (o, steps = 20, dt = 0.1) => { const S = base(o), sim = new Sim(S); S.mode = 'tem'; for (let i = 0; i < steps; i++) sim.update(dt); return sim; };
{
  const sol = B.solve('tip'), Vbd = (10e6 * 5e-6) / sol.Emax, o = { bsLayout: 'tip', bsGap: 5, bsEbd: 10, bsLimit: 10 };
  const below = run({ ...o, bsV: 0.97 * Vbd }), above = run({ ...o, bsV: 1.03 * Vbd });
  ok(!below.biasSt.broken && above.biasSt.broken && above.biasSt.events[0].event === 'breakdown' && above.biasSt.op.limited === 'compliance', `breakdown: a 5 µm tip gap at 10 MV/m holds ${(0.97 * Vbd).toFixed(2)} V and fails at ${(1.03 * Vbd).toFixed(2)} V (predicted ${Vbd.toFixed(2)} V, where the peak field at the tip reaches 10 MV/m); the filament then draws the compliance current`);
}
{
  const burn = run({ bsMat: 'metal', bsV: 20, bsRc: 100, bsLimit: 10000 }, 3);
  ok(burn.biasSt.open && burn.biasSt.events.some((e) => e.event === 'contact burn-out') && burn.biasSt.op.I === 0, `contact burn-out: 10 mA through 100 Ω contacts dissipates ${(1e-4 * 100 * 1e3).toFixed(0)} mW each (limit ${B.P_BURN * 1e3} mW); the circuit opens`);
  const em = run({ bsMat: 'metal', thick: 5, bsGap: 2, bsV: 20, bsRc: 10, bsLimit: 10000 }, 200);
  const evs = em.biasSt.events.map((e) => e.event);
  ok(evs.includes('electromigration void') && em.biasSt.em > 0, `electromigration: a 5 nm metal line at ${(em.biasSt.events.find((e) => e.j_Am2).j_Am2 / 1e10).toFixed(1)}·10¹⁰ A/m² grows voids (resistance +${(100 * em.biasSt.em).toFixed(0)} %)${evs.includes('electromigration: the line opened') ? ' until it opens' : ''}`);
}
{
  // Joule heating: the temperature rises by P·R_th
  const sim = run({ bsMat: 'semi', thick: 50, bsGap: 5, bsV: 20, bsLimit: 2000 }, 60), B0 = sim.biasSt;
  ok(Math.abs(B0.dT / (B0.op.P * B.R_TH) - 1) < 0.05 && B0.dT > 5 && sim.temp() > 293 + 0.9 * B0.dT, `Joule heating: ${(B0.op.P * 1e3).toFixed(2)} mW in the specimen raises it ${B0.dT.toFixed(1)} K (P·R_th = ${(B0.op.P * B.R_TH).toFixed(1)} K)`);
}
{
  // the I–V trace of a swept ohmic specimen: slope 1/R_total
  const S = base({ bsMat: 'semi', thick: 50, bsGap: 5, bsWave: 'sweep', bsV: 0.5, bsRate: 1, bsRc: 100, bsRs: 50, bsLimit: 10000 }), sim = new Sim(S);
  S.mode = 'tem'; for (let i = 0; i < 40; i++) sim.update(0.05);
  const tr = sim.biasSt.trace, n = tr.length, mx = tr.reduce((a, p) => a + p[0], 0) / n, my = tr.reduce((a, p) => a + p[1], 0) / n;
  const slope = tr.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / tr.reduce((a, p) => a + (p[0] - mx) ** 2, 0), span = Math.max(...tr.map((p) => p[0])) - Math.min(...tr.map((p) => p[0]));
  const R2 = sim.biasSt.op.R + 200; // the two-terminal readback sees specimen + contacts
  ok(span > 0.8 && Math.abs(slope * R2 - 1) < 0.02, `I–V sweep (±0.5 V at 1 V/s, small enough that Joule heating leaves it ohmic): ${n} points over ${span.toFixed(1)} V, slope 1/${(1 / slope / 1e3).toFixed(2)} kΩ = 1/(R + 2R_c) (${(R2 / 1e3).toFixed(2)} kΩ)`);
}

// ---- the beam deflection in the other modes
{
  const o = { bsStray: true, bsGap: 2, bsV: 20, thick: 20, cx: 3000 };
  const S = base({ ...o, mode: 'diff' }), sim = new Sim(S); sim.update(0.02);
  const beta = sim.biasBeta(), off = new Sim(base({ ...o, mode: 'diff', bsOn: false })); off.update(0.02);
  const com = (d) => { const W = d.W; let s = 0, sx = 0; for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const v = d.arr[y * W + x]; s += v; sx += v * x; } return sx / s; };
  const shiftPx = com(sim.diffDisp) - com(off.diffDisp), want = beta[0] / sim.lam / sim.diffDisp.kPerPx;
  ok(Math.abs(shiftPx / want - 1) < 0.05, `SAED: the pattern moves by β/λ (${shiftPx.toFixed(2)} px for β = ${(beta[0] * 1e6).toFixed(1)} µrad; predicted ${want.toFixed(2)} px)`);
  const t = new Sim(base({ ...o, mode: '4d' })); for (let i = 0; i < 400 && t.fd?.done < t.fd?.N * t.fd?.N || i < 2; i++) t.update(0.05);
  const t0 = new Sim(base({ ...o, mode: '4d', bsOn: false })); for (let i = 0; i < 400 && t0.fd?.done < t0.fd?.N * t0.fd?.N || i < 2; i++) t0.update(0.05);
  let d = 0; for (let i = 0; i < t.fd.comX.length; i++) d += t.fd.comX[i] - t0.fd.comX[i]; d /= t.fd.comX.length;
  ok(Math.abs(d / (beta[0] * 1e3) - 1) < 0.05, `4D-STEM centre of mass: shifted by ${(d * 1e3).toFixed(2)} µrad (β = ${(beta[0] * 1e6).toFixed(2)} µrad)`);
  const L = new Sim(base({ ...o, mode: 'lstem', cx: 0 })), L0 = new Sim(base({ ...o, mode: 'lstem', cx: 0, bsOn: false })); L.update(0.02); L0.update(0.02);
  const dpcMean = (q) => q.lor.disp.sx.reduce((a, v) => a + v, 0) / q.lor.disp.sx.length;
  ok(Math.abs(dpcMean(L) - dpcMean(L0)) > 1e-3, `Lorentz STEM (DPC) sees the bias field: mean x signal ${dpcMean(L0).toFixed(4)} → ${dpcMean(L).toFixed(4)}`);
}

// ---- electrochemistry under liquid, the tilt limit
{
  const grow = (V, pre) => { const S = base({ mode: 'tem', spec: 'au', bsMat: 'semi', bsV: V, bsLimit: 10000, bsRc: 0, bsRs: 0 }), sim = new Sim(S); chipState(S, sim, 'envCell', 'liquid'); S.lcPrecursor = pre; S.lcRate = 0.01; for (let i = 0; i < 40; i++) sim.update(0.1); const r = P.SPECIMENS.au.parts[0].r; sim.resetLiquid(); return r; };
  const r0 = P.SPECIMENS.au.parts[0].r, dep = grow(-0.4, true), none = grow(-0.4, false), dis = grow(0.8, false);
  ok(dep > r0 && none === r0 && dis < r0, `electrochemistry under liquid: the electrode at −0.2 V deposits gold (${r0} → ${dep} Å, only with gold ions in the liquid), at +0.4 V dissolves it (${dis} Å)`);
  const S = base(); S.holder = 'room';
  ok(ENV.maxTilt(S) === ENV.BIAS_TILT, `a biasing holder tilts ±${ENV.BIAS_TILT}°`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
