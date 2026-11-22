// The liquid cell (M14): the bulge follows the load–deflection relation, the cell bursts at the predicted pressure,
// resolution falls with liquid thickness, STEM resolves a particle on the entrance window better than on the exit
// window and TEM the reverse, and bubbles appear only above the dose-rate threshold.
import * as LIQ from '../js/liquid.js';
import * as ENV from '../js/environment.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import { chipState } from '../js/ops.js';
import { SPECIMENS } from '../js/physics.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

// ---- mechanics
{
  const cases = [];
  for (const [A, B] of [[50, 50], [50, 200], [100, 400], [30, 90]]) for (const t of [20, 50]) for (const bar of [0.5, 1, 2]) {
    const o = { a: A * 0.5e-6, b: B * 0.5e-6, t: t * 1e-9, dP: bar * 1e5 }, w = LIQ.deflection(o);
    cases.push(Math.abs(LIQ.pressureFor({ ...o, w }) / o.dP - 1));
  }
  ok(Math.max(...cases) < 1e-9, `the centre deflection satisfies ΔP = C₁σ₀tw/a² + C₂E′tw³/a⁴ for ${cases.length} windows (square to slit, 20–50 nm, 0.5–2 bar)`);
  const w = LIQ.deflection({ a: 25e-6, b: 100e-6, t: 50e-9, dP: 1e5 });
  ok(Math.abs(w * 1e6 - 1) < 0.15, `worked check: 50 nm SiNₓ, 50 × 200 µm, 1 bar → w = ${(w * 1e6).toFixed(2)} µm (≈ 1 µm, as reported)`);
  const tiny = LIQ.deflection({ a: 25e-6, b: 100e-6, t: 50e-9, dP: 10 }), k = LIQ.constants(4, 0.25);
  ok(Math.abs(tiny / ((10 * (25e-6) ** 2) / (k.C1 * 0.3e9 * 50e-9)) - 1) < 1e-3, 'at a small pressure the bulge is linear: w = ΔP a²/(C₁σ₀t), set by the residual stress');
  ok(LIQ.deflection({ a: 25e-6, b: 25e-6, t: 50e-9, dP: 1e5 }) < w, 'a square window bulges less than a long slit of the same width');
  const S = defaultState(); S.envCell = 'liquid'; S.lcClass = 'sinx'; S.envWinT = 50; S.lcGap = 150; S.lcDP = 1;
  S.cx = 0; S.cy = 0; const mid = LIQ.cellOf(S);
  S.cx = 0.9 * 25 * 1e4; const edge = LIQ.cellOf(S);
  ok(Math.abs(mid.thicknessA / 1e4 - (0.15 + 2 * w * 1e6)) < 0.01 && edge.thicknessA < mid.thicknessA * 0.3, `the liquid is thickest at the window centre (${(mid.thicknessA / 1e4).toFixed(2)} µm = gap + 2w) and thinner near its edge (${(edge.thicknessA / 1e4).toFixed(2)} µm)`);
}
// ---- burst
{
  const mk = (bar) => { const S = defaultState(); S.mode = 'tem'; const sim = new Sim(S); chipState(S, sim, 'envCell', 'liquid'); S.envWinT = 30; S.lcDP = bar; sim.invalidate('env'); return { S, sim }; };
  const Pb = LIQ.burstPressure({ a: 25e-6, b: 100e-6, t: 30e-9 }) / 1e5;
  const below = mk(0.98 * Pb), above = mk(1.02 * Pb);
  for (let i = 0; i < 5; i++) { below.sim.update(0.1); above.sim.update(0.1); }
  ok(!below.sim.liq.burst && !below.S.paused, `30 nm windows hold at ${(0.98 * Pb).toFixed(2)} bar`);
  ok(!!above.sim.liq.burst && above.S.paused && above.sim.liq.events[0]?.event === 'burst', `and burst at ${(1.02 * Pb).toFixed(2)} bar (predicted ${Pb.toFixed(2)} bar, where the membrane stress reaches 3 GPa): the beam is blanked and the event logged`);
  above.sim.resetLiquid(); above.S.lcDP = 1; above.S.paused = false; above.sim.update(0.1);
  ok(!above.sim.liq?.burst, 'a new cell (at 1 bar) works again');
}
// ---- resolution
const sharp = (img, c) => { let g = 0, m = 0, v = 0; for (let i = 0; i < img.length; i++) m += img[i]; m /= img.length; for (let i = 0; i < img.length; i++) v += (img[i] - m) ** 2; for (let y = 0; y < c - 1; y++) for (let x = 0; x < c - 1; x++) { const i = y * c + x; g += (img[i + 1] - img[i]) ** 2 + (img[i + c] - img[i]) ** 2; } return g / (v || 1); };
function image(mode, set) {
  const S = defaultState(); S.mode = mode; S.spec = 'au'; S.clarity = 'edu'; S.lcRate = 0.01;
  const sim = new Sim(S); chipState(S, sim, 'envCell', 'liquid'); set(S); sim.invalidate('env');
  for (let i = 0; i < 4; i++) sim.update(0.02);
  const o = mode === 'tem' ? sim.tem : sim.stemImg;
  return sharp(o.img, o.c);
}
{
  const g = [100, 500, 2000], tem = g.map((gap) => image('tem', (S) => { S.lcGap = gap; S.lcDP = 0.01; })), stem = g.map((gap) => image('stem', (S) => { S.lcGap = gap; S.lcDP = 0.01; S.lcDepth = 'bottom'; }));
  ok(tem[0] > tem[1] && tem[1] > tem[2], `TEM sharpness falls with liquid thickness: ${tem.map((v) => v.toFixed(3)).join(' → ')} for ${g.join(', ')} nm`);
  ok(stem[0] > stem[1] && stem[1] > stem[2], `STEM sharpness (particle on the exit window) falls with liquid thickness: ${stem.map((v) => v.toFixed(3)).join(' → ')}`);
}
{
  const set = (d) => (S) => { S.lcGap = 1000; S.lcDP = 0.01; S.lcDepth = d; };
  const filt = (d) => (S) => { set(d)(S); S.lcFilter = true; }; // energy-filtered TEM: the chromatic blur (the same at any depth) removed
  const st = image('stem', set('top')), sb = image('stem', set('bottom')), tt = image('tem', filt('top')), tb = image('tem', filt('bottom'));
  ok(st > sb, `STEM in 1 µm of water: the particle on the entrance window is sharper (${st.toFixed(3)}) than on the exit window (${sb.toFixed(3)})`);
  ok(tb > 1.2 * tt, `TEM (energy-filtered): the reverse, the exit window is sharper (${tb.toFixed(3)}) than the entrance window (${tt.toFixed(3)}): the top–bottom effect`);
  const gr = image('tem', (S) => { S.lcClass = 'graphene'; S.lcPocket = 60; S.cx = 30; S.cy = 30; });
  ok(gr > image('tem', set('middle')), `a graphene pocket (nm of liquid) images far sharper than a SiNₓ cell (${gr.toFixed(3)})`);
}
// ---- radiolysis (the network in kinetics.js): bubbles where H₂ exceeds its solubility
{
  const S0 = defaultState(); S0.envCell = 'liquid'; S0.lcClass = 'sinxFlow'; S0.lcFlow = 2;
  const thrJ = LIQ.bubbleThresholdGy(S0) / LIQ.doseRateGy(1, S0.kV);
  const run = (j, cls = 'sinxFlow', secs = 30) => { const S = defaultState(); S.mode = 'tem'; const sim = new Sim(S); chipState(S, sim, 'envCell', 'liquid'); S.lcClass = cls; S.lcFlow = 2; S.lcRate = j; for (let i = 0; i < secs * 10; i++) sim.update(0.1); return sim.liq; };
  const lo = run(0.5 * thrJ), hi = run(4 * thrJ);
  ok(lo.bubbles.length === 0 && hi.bubbles.length > 0, `flow cell: no bubbles at ${(0.5 * thrJ).toFixed(0)} e⁻/Å²/s after 30 s, ${hi.bubbles.length} at ${(4 * thrJ).toFixed(0)} e⁻/Å²/s (H₂ in the beam reaches its solubility at ${thrJ.toFixed(0)} e⁻/Å²/s ≈ ${(LIQ.bubbleThresholdGy(S0) / 1e6).toFixed(0)} MGy/s)`);
  // a static cell's liquid fills with H₂ from the beam: below the beam's threshold, bubbles come after a delay
  const j = 0.3 * thrJ, Ss = { ...defaultState(), envCell: 'liquid', lcClass: 'sinx', lcRate: j }, fill = LIQ.reservoirRate(Ss, 200, 0, Ss.lcGap * 10), tPred = LIQ.h2Sat(Ss) / fill;
  const st = run(j, 'sinx', Math.ceil(1.5 * tPred)), fl = run(j, 'sinxFlow', Math.ceil(1.5 * tPred));
  ok(st.bubbles.length > 0 && st.res > 0.5 * LIQ.h2Sat(Ss) && fl.bubbles.length === 0, `static cell at ${j.toFixed(0)} e⁻/Å²/s (below the beam's threshold): its liquid fills with H₂ (${(1e6 * st.res).toFixed(0)} µM after ${Math.ceil(1.5 * tPred)} s; saturation predicted at ~${tPred.toFixed(0)} s) and bubbles form; a flow cell flushes it (${(1e6 * fl.res).toFixed(1)} µM, no bubbles)`);
  const Sg = { ...S0, lcClass: 'graphene' }, thrG = LIQ.bubbleThresholdGy(Sg) / LIQ.doseRateGy(1, 200);
  ok(thrG < 0.1 * thrJ, `a graphene pocket is closed: its products stay in it, so H₂ saturates above ${thrG.toPrecision(2)} e⁻/Å²/s`);
  const r = LIQ.radiolysisNow({ ...S0, lcRate: 10 }, 200);
  ok(r.ss.H2O2 > r.ss.H2 && -Math.log10(r.ss.Hp) < 6, `at 10 e⁻/Å²/s the beam makes ${(1e6 * r.ss.H2).toFixed(0)} µM H₂ and ${(1e6 * r.ss.H2O2).toFixed(0)} µM H₂O₂ and acidifies the water to pH ${(-Math.log10(r.ss.Hp)).toFixed(1)} (Schneider et al. 2014)`);
}
// ---- spectra, growth, motion
{
  const S = defaultState(); S.envCell = 'liquid'; S.lcGap = 500; S.envWinT = 50;
  const inel = ENV.inelastic(S, 200);
  ok(inel.some((c) => c.edges.some((e) => e.key === 'O')) && inel.some((c) => c.edges.some((e) => e.key === 'N')), `EELS: water (O K, ${inel[0].tau.toFixed(2)} t/λ) and the SiNₓ windows (Si L, N K)`);
}
{
  const S = defaultState(); S.mode = 'tem'; S.spec = 'au'; const sim = new Sim(S); chipState(S, sim, 'envCell', 'liquid'); S.lcPrecursor = true; S.lcRate = 20;
  const r0 = SPECIMENS.au.parts[0].r;
  for (let i = 0; i < 60; i++) sim.update(0.1);
  const r1 = SPECIMENS.au.parts[0].r, moved = Math.hypot(sim.liq.bx, sim.liq.by);
  ok(r1 > r0, `with a gold precursor the particles grow (${r0.toFixed(1)} → ${r1.toFixed(1)} Å in 6 s at 20 e⁻/Å²/s)`);
  ok(moved > 0, `and move by hindered Brownian motion (${moved.toFixed(1)} Å)`);
  sim.resetLiquid();
  ok(SPECIMENS.au.parts[0].r === r0, 'a new cell restores the original particles');
}
{
  const S = defaultState(); S.holder = 'ln2'; const sim = new Sim(S);
  chipState(S, sim, 'envCell', 'liquid');
  ok(S.holder === 'room' && ENV.maxTilt(S) === 20, 'a liquid cell takes no cryo holder, and tilts to ±20°');
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
