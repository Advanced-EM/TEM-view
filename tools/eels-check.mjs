// EELS engine check (M2b): the spectrum against tabulated edge energies, white-line ratios and analytic
// expectations, the Fourier-ratio deconvolution against a known single-scattering edge, the background fit
// against a synthetic power law, β trends, the in situ hook, detectors and the MSA export.
// Run: node tools/eels-check.mjs
import * as E from '../js/eels.js';
import * as P from '../js/physics.js';
import { zlpStats, lowTau, Sim } from '../js/sim.js';
import { defaultState } from '../js/state.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const edge = (key, name) => P.EDGES.find((e) => e.key === key && (!name || e.name === name));
const model = (o = {}) => ({ tau: 0.3, plasmons: [{ Ep: 22, G: 12, frac: 1 }], edges: [], kV: 200, beta: 20, zlp: E.zlpParams('schottky', 0.7), realistic: true, bg: { amp: 0.012, s: 3.1 }, ...o });
const centres = (r) => Float64Array.from({ length: r.nb }, (_, i) => r.E0 + (i + 0.5) * r.dE);
// background-subtracted edge from a simulated spectrum (power law fitted 50–5 eV below the onset)
function netEdge(m, Eo, span = 80, dE = 0.05) {
  const r = E.buildSpectrum(m, { E0: Eo - 60, nb: Math.round((60 + span) / dE), dE });
  const Ec = centres(r), I = Float64Array.from(r.spec, (v) => v * 1e9), f = E.fitPowerLaw(Ec, I, Eo - 50, Eo - 5);
  return { Ec, net: Float64Array.from(I, (v, i) => v - f.predict(Ec[i])), r };
}

// ---------------------------------------------------------------- zero loss, normalization, thickness
for (const src of ['schottky', 'cfeg', 'mono']) {
  const z = E.zlpParams(src, 0.7), dE = src === 'mono' ? 0.002 : 0.01;
  const r = E.buildSpectrum(model({ zlp: z, tau: 0.05 }), { E0: -2, nb: 2048, dE });
  const s = zlpStats(r.spec, r.E0, r.dE);
  ok(Math.abs(s.fwhm - z.fwhm) / z.fwhm < 0.04, `${src}: zero-loss FWHM ${s.fwhm.toFixed(3)} eV = source ${z.src} ⊕ spectrometer ${E.SPECTROMETER_FWHM} = ${z.fwhm.toFixed(3)} eV`);
}
{
  const r = E.buildSpectrum(model({ tau: 0.6 }), { E0: -10, nb: 2048, dE: 0.5 });
  let area = 0; for (const v of r.spec) area += v * r.dE;
  ok(Math.abs(area - 1) < 0.01, `spectrum area ${area.toFixed(4)} ≈ 1 (one electron in, one out)`);
  const t = lowTau(r.spec, r.E0, r.dE);
  ok(Math.abs(t - 0.6) < 0.02, `t/λ from the low loss, ln(I_t / I_0) = ${t.toFixed(3)} for τ = 0.6`);
  // plural plasmons: the k-th plasmon area follows the Poisson law τ^k/k!
  const near = (Ep) => { let s = 0; for (let b = 0; b < r.nb; b++) { const e = r.E0 + (b + 0.5) * r.dE; if (Math.abs(e - Ep) < 4) s += r.spec[b]; } return s; };
  const ratio = near(44) / near(22);
  ok(ratio > 0.15 && ratio < 0.45, `second plasmon / first ≈ τ/2 (plural scattering): ${ratio.toFixed(2)}`);
}

// ---------------------------------------------------------------- edge onsets and spin–orbit splitting
// EELS Atlas (Ahn & Krivanek 1983) edge energies; half-rise of the net edge within ±2.5 eV
const atlas = [['C', 284, 'C K'], ['Cg', 284, 'C K (sp²)'], ['N', 401, 'N K'], ['O', 532, 'O K'], ['Ti', 456, 'Ti L₃,₂'], ['Fe', 708, 'Fe L₃,₂'], ['Co', 779, 'Co L₃,₂'], ['Ni', 855, 'Ni L₃,₂'], ['Cs', 726, 'Cs M₅,₄'], ['SiOx', 106, 'Si L₂,₃ (oxide)'], ['Si', 99.8, 'Si L₂,₃']];
for (const [key, Eref, name] of atlas) {
  const ed = edge(key, name), m = model({ tau: 0.05, plasmons: [{ Ep: 22, G: 12, frac: 1 }], edges: [{ edge: ed, w: 0.05 }], zlp: E.zlpParams('cfeg', 0.35) });
  const { Ec, net } = netEdge(m, ed.E);
  let mx = 0; for (let i = 0; i < Ec.length; i++) if (Ec[i] > ed.E - 5 && Ec[i] < ed.E + 15) mx = Math.max(mx, net[i]);
  const i50 = Ec.findIndex((e, i) => e > ed.E - 5 && net[i] > 0.5 * mx);
  ok(Math.abs(Ec[i50] - Eref) <= 2.5 + (key.startsWith('Si') ? 1 : 0), `${name}: onset (half rise) ${Ec[i50].toFixed(1)} eV, atlas ${Eref} eV`);
}
for (const [key, dRef] of [['Ti', 5.6], ['Fe', 13], ['Co', 15], ['Ni', 17], ['Cs', 14]]) {
  const ed = edge(key), m = model({ tau: 0.05, edges: [{ edge: ed, w: 0.05 }], zlp: E.zlpParams('cfeg', 0.35), realistic: false });
  const { Ec, net } = netEdge(m, ed.E);
  const peak = (a, b) => { let bi = -1; for (let i = 0; i < Ec.length; i++) if (Ec[i] >= a && Ec[i] <= b && (bi < 0 || net[i] > net[bi])) bi = i; return Ec[bi]; };
  const L3 = peak(ed.E, ed.E + ed.so / 2), L2 = peak(ed.E + ed.so * 0.6, ed.E + ed.so * 1.5);
  ok(Math.abs(L2 - L3 - dRef) < 1, `${ed.name}: spin–orbit splitting ${(L2 - L3).toFixed(1)} eV (tabulated ≈ ${dRef} eV)`);
}

// ---------------------------------------------------------------- white-line ratios (Pearson-type: continuum removed)
// approximate literature ranges: Ti⁴⁺ ≈ 0.8–1.1 (the anomalous ratio of early 3d metals), Fe³⁺ ≈ 4.5–6, metallic Ni ≈ 2.5–3.5
for (const [key, lo, hi, real] of [['Ti', 0.7, 1.15, true], ['Fe', 4.3, 6.2, true], ['Ni', 2.4, 3.6, false]]) {
  const ed = edge(key), m = model({ tau: 0.02, plasmons: [{ Ep: 22, G: 12, frac: 1 }], edges: [{ edge: ed, w: 0.02 }], zlp: E.zlpParams('cfeg', 0.35), realistic: real });
  const { Ec, net } = netEdge(m, ed.E, 90);
  // the 2:1 continuum, scaled to the net signal 25–40 eV above L₂
  const so = ed.so, sw = 0.6, stepf = (d) => 0.5 * (1 + Math.tanh(d / sw));
  let a = 0, b = 0;
  for (let i = 0; i < Ec.length; i++) if (Ec[i] > ed.E + so + 25 && Ec[i] < ed.E + so + 40) { a += net[i]; b += 1; }
  const cont = (e) => (a / b) * ((2 * stepf(e - ed.E) + stepf(e - ed.E - so)) / 3) * Math.pow((ed.E + so + 32) / e, 3);
  let A3 = 0, A2 = 0;
  for (let i = 0; i < Ec.length; i++) {
    const e = Ec[i], v = net[i] - cont(e);
    if (e >= ed.E - 1 && e < ed.E + so - 0.5) A3 += v; else if (e >= ed.E + so - 0.5 && e < ed.E + so + 7) A2 += v; // split just below the L₂ onset
  }
  const R = A3 / A2;
  ok(R > lo && R < hi, `${ed.name}: white-line ratio L₃/L₂ = ${R.toFixed(2)} (expected ${lo}–${hi})`);
}

// ---------------------------------------------------------------- Fourier-ratio deconvolution
{
  const ok_ = edge('O'), dE = 0.25, plas = [{ Ep: 24, G: 10, frac: 1 }], z = E.zlpParams('cfeg', 0.35);
  const thick = model({ tau: 0.9, plasmons: plas, edges: [{ edge: ok_, w: 0.9 * 0.5 }], zlp: z, bg: { amp: 0, s: 3 } });
  const low = E.buildSpectrum(thick, { E0: -5, nb: 2048, dE }).spec;
  const core = E.buildSpectrum(thick, { E0: 480, nb: 1024, dE }), net = core.edgeCurves.O; // the plural-scattered edge alone
  // truth: the same edge, single scattering only (τ → 0 apart from the edge), with the same zero loss
  const single = E.buildSpectrum(model({ tau: 1e-6, plasmons: plas, edges: [{ edge: ok_, w: 0.9 * 0.5 }], zlp: z, bg: { amp: 0, s: 3 } }), { E0: 480, nb: 1024, dE }).edgeCurves.O;
  const ssd = E.fourierRatio(net, low, { dE, E0low: -5, fwhm: z.fwhm });
  let sT = 0, sR = 0, e2 = 0, n2 = 0, plT = 0, plR = 0, plN = 0;
  for (let i = 0; i < 1024; i++) {
    const e = 480 + (i + 0.5) * dE;
    if (e > 525 && e < 600) { sT += single[i]; sR += ssd[i]; e2 += (ssd[i] - single[i]) ** 2; n2 += single[i] ** 2; }
    if (e > 530 && e < 537) { plT += single[i]; plR += ssd[i]; plN += net[i]; } // the near-edge peak
  }
  let aN = 0; for (let i = 0; i < 1024; i++) { const e = 480 + (i + 0.5) * dE; if (e > 525 && e < 600) aN += net[i]; }
  plN = (plN / aN) * sT; plR = (plR / sR) * sT; // shapes compared at equal area (the plural edge is also attenuated by e^(−τ))
  ok(Math.abs(sR / sT - 1) < 0.05, `Fourier ratio: net edge area ${(sR / sT).toFixed(3)} × the single-scattering area`);
  ok(Math.sqrt(e2 / n2) < 0.12, `Fourier ratio: shape within ${(100 * Math.sqrt(e2 / n2)).toFixed(1)} % rms of the true single scattering`);
  ok(plN / plT < 0.9 && Math.abs(plR / plT - 1) < 0.05, `near-edge peak share: ${(plN / plT).toFixed(2)}× the single-scattering value before (plural scattering moves it up by the plasmon energy), ${(plR / plT).toFixed(2)}× after`);
}

// ---------------------------------------------------------------- background fit
{
  const Ec = Float64Array.from({ length: 800 }, (_, i) => 250 + i * 0.25), r = 3.2, A = 1e4 * Math.pow(300, r);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pois = (l) => Math.max(0, l + Math.sqrt(l) * Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd()));
  const I = Float64Array.from(Ec, (e) => pois(A * Math.pow(e, -r)));
  const f = E.fitPowerLaw(Ec, I, 260, 330);
  ok(Math.abs(f.r - r) < 0.03, `power-law fit on Poisson data: r = ${f.r.toFixed(4)} (true ${r})`);
  const st = E.edgeStats(Ec, I, [260, 330], [340, 380]);
  ok(Math.abs(st.SB) < 0.02 && Math.abs(st.SN) < 3, `no edge: S/B = ${st.SB.toFixed(4)}, S/N = ${st.SN.toFixed(2)} (noise only)`);
  const I2 = Float64Array.from(I, (v, i) => v + (Ec[i] > 340 ? 0.3 * A * Math.pow(Ec[i], -r) : 0));
  const st2 = E.edgeStats(Ec, I2, [260, 330], [345, 380]);
  ok(Math.abs(st2.SB - 0.3) < 0.03 && st2.SN > 50 && st2.h >= 1, `edge of 30 % jump: S/B = ${st2.SB.toFixed(3)}, S/N = ${st2.SN.toFixed(0)}, h = ${st2.h.toFixed(2)}`);
}

// ---------------------------------------------------------------- collection angle β and beam energy
{
  const rs = [5, 20, 100].map((beta) => {
    const r = E.buildSpectrum(model({ beta }), { E0: 200, nb: 2048, dE: 0.25 });
    return E.fitPowerLaw(centres(r), Float64Array.from(r.spec, (v) => v * 1e9), 220, 500).r;
  });
  ok(rs[0] > rs[1] && rs[1] > rs[2], `background slope falls as β grows: r = ${rs.map((v) => v.toFixed(2)).join(' > ')} at β = 5, 20, 100 mrad`);
  const f = [5, 20, 100].map((b) => E.crossFactor(532, 200, b));
  ok(f[0] < f[1] && f[1] < f[2] && Math.abs(f[1] - 1) < 1e-12, `O K cross-section × ${f.map((v) => v.toFixed(2)).join(', ')} at β = 5, 20, 100 mrad (1 at the reference)`);
  const t = [5, 20, 100].map((b) => E.tauBetaFactor(200, 14, b));
  ok(t[0] < 1 && t[2] > 1, `t/λ grows with β: × ${t.map((v) => v.toFixed(3)).join(', ')}`);
  ok(E.thetaE(532, 200) * 1e3 > 1.4 && E.thetaE(532, 200) * 1e3 < 1.7, `θ_E for O K at 200 kV = ${(E.thetaE(532, 200) * 1e3).toFixed(2)} mrad (E / 2γT)`);
}

// ---------------------------------------------------------------- in situ hook: extra inelastic layers
{
  const base = model({ tau: 0.3, edges: [] });
  const water = { label: 'water layer', tau: 0.5, plasmons: [{ Ep: 21, G: 12, frac: 1 }], edges: [{ key: 'O', frac: 1 }] };
  const m2 = E.addInelasticComponents(base, [water]);
  const low = E.buildSpectrum(m2, { E0: -10, nb: 2048, dE: 0.5 });
  ok(Math.abs(lowTau(low.spec, low.E0, low.dE) - 0.8) < 0.03, `addInelasticComponents: t/λ 0.3 + 0.5 water → ${lowTau(low.spec, low.E0, low.dE).toFixed(3)}`);
  const core = E.buildSpectrum(m2, { E0: 480, nb: 1024, dE: 0.25 });
  ok(core.edgeCurves.O && Math.max(...core.edgeCurves.O) > 0 && m2.components.includes('water layer'), 'the water layer brings its O K edge');
  const S = defaultState(); S.mode = 'eels'; S.spec = 'au';
  const sim = new Sim(S); sim.update(0.05);
  const t0 = sim.eelsModel(sim.eelsSite()).tau;
  sim.addInelasticComponents([{ label: 'SiNx windows', tau: 0.25, plasmons: [{ Ep: 23, G: 12, frac: 1 }], edges: [{ key: 'Si', name: 'Si L₂,₃', frac: 0.43 }, { key: 'N', frac: 0.57 }] }]);
  ok(Math.abs(sim.eelsModel(sim.eelsSite()).tau - t0 - 0.25) < 1e-9 && sim.stale.eels, 'Sim.addInelasticComponents adds the window layer to the spectrum model');
}

// ---------------------------------------------------------------- specimen fine structure
{
  const pv = (key) => { // π* peak over the 287–288 eV valley before the σ* rise
    const m = model({ tau: 0.02, edges: [{ edge: edge(key), w: 0.02 }], zlp: E.zlpParams('mono', 0.08) });
    const { Ec, net } = netEdge(m, 284, 30, 0.02);
    let pk = 0, va = Infinity; for (let i = 0; i < Ec.length; i++) { if (Ec[i] > 284 && Ec[i] < 286.5) pk = Math.max(pk, net[i]); if (Ec[i] > 287 && Ec[i] < 288.5) va = Math.min(va, net[i]); }
    return pk / va;
  };
  const rg = pv('Cg'), ra = pv('C');
  ok(rg > 2 && rg > 2 * ra, `C K π* peak / valley: graphitic ${rg.toFixed(2)}, amorphous ${ra.toFixed(2)}`);
  const mof = P.SPECIMENS.mof.elnes.C, pi = (q) => mof({ q })[0][2];
  ok(pi(0.8) < 0.55 * pi(0), `UiO-66 aromatic π* fades with dose: ${pi(0).toFixed(2)} → ${pi(0.8).toFixed(2)}`);
  // Ti³⁺ at the SrTiO₃ boundary: the L₃ edge starts ~1 eV lower than in the Ti⁴⁺ bulk
  const onset = (key) => { const ed = edge(key), m = model({ tau: 0.02, edges: [{ edge: ed, w: 0.02 }], zlp: E.zlpParams('mono', 0.08) }); const { Ec, net } = netEdge(m, 456, 30, 0.02); let mx = 0; for (let i = 0; i < Ec.length; i++) if (Ec[i] < 461) mx = Math.max(mx, net[i]); return Ec[net.findIndex((v, i) => Ec[i] > 450 && v > 0.5 * mx)]; };
  const d = onset('Ti') - onset('Ti3');
  ok(d > 0.6 && d < 2, `Ti L₃ onset ${d.toFixed(2)} eV lower for Ti³⁺ (boundary) than Ti⁴⁺`);
  const sto = P.SPECIMENS.sto, nT3 = Array.from(sto.atoms.e).filter((e) => e === P.EI.Ti3).length;
  ok(nT3 > 0 && Array.from(sto.atoms.e).every((e, i) => e !== P.EI.Ti3 || Math.abs(sto.atoms.x[i]) < 4), `${nT3} Ti³⁺ columns, all within 4 Å of the boundary`);
  const S = defaultState(); S.mode = 'eels'; S.spec = 'sto'; S.eelsPx = null;
  const sim = new Sim(S); sim.update(0.05); sim.update(0.05);
  const n = sim.si.n, mid = sim.si.els.find((e) => e.key === 'Ti3');
  let best = 0, bi = 0; for (let i = 0; i < n * n; i++) if (mid.map[i] > best) { best = mid.map[i]; bi = i; }
  const gb = sim.eelsSite([bi % n, (bi / n) | 0]), bulk = sim.eelsSite([4, n >> 1]);
  ok((gb.comp.Ti3 ?? 0) > 0.05 && (bulk.comp.Ti3 ?? 0) < 0.01, `probe on the boundary: Ti³⁺ fraction ${(gb.comp.Ti3 ?? 0).toFixed(3)}; in the grain ${(bulk.comp.Ti3 ?? 0).toFixed(3)}`);
}

// ---------------------------------------------------------------- detectors
{
  const r = E.buildSpectrum(model({ tau: 0.05, zlp: E.zlpParams('mono', 0.08) }), { E0: -2, nb: 2048, dE: 0.025 });
  const f = (k) => zlpStats(E.applyPSF(r.spec, E.detector(k)), r.E0, r.dE).fwhm;
  ok(f('ccd') > f('direct') * 1.05, `zero loss at 0.025 eV/ch: scintillator CCD ${f('ccd').toFixed(3)} eV, direct ${f('direct').toFixed(3)} eV`);
  let a0 = 0, a1 = 0; const p = E.applyPSF(r.spec, E.detector('ccd')); for (let i = 200; i < 1800; i++) { a0 += r.spec[i]; a1 += p[i]; }
  ok(Math.abs(a1 / a0 - 1) < 0.01, 'the point spread keeps the counts');
  const g = E.gainPattern(2048, E.detector('ccd')), m = g.reduce((a, b) => a + b) / 2048, sd = Math.sqrt(g.reduce((a, b) => a + (b - m) ** 2, 0) / 2048);
  ok(sd > 0.008 && sd < 0.03 && E.gainPattern(2048, E.detector('direct')).every((v) => v === 1), `fixed-pattern gain: ${(100 * sd).toFixed(2)} % rms (CCD), none (direct)`);
}

// ---------------------------------------------------------------- MSA
{
  const y = Float32Array.from({ length: 2048 }, (_, i) => 1000 * Math.exp(-i / 500) + 3);
  const txt = E.toMSA(y, { offset: 250.125, dispersion: 0.25, kV: 200, alpha_mrad: 22, beta_mrad: 30, exposure_s: 0.5 });
  const back = E.parseMSA(txt);
  let maxe = 0; for (let i = 0; i < y.length; i++) maxe = Math.max(maxe, Math.abs(back.y[i] - y[i]) / y[i]);
  ok(back.y.length === 2048 && maxe < 1e-6 && back.head.SIGNALTYPE === 'ELS' && +back.head.XPERCHAN === 0.25 && +back.head.OFFSET === 250.125 && +back.head.COLLANGLE === 30, `MSA round trip: 2048 points within ${maxe.toExponential(1)}, ELS, 0.25 eV/ch from 250.125 eV, β 30 mrad`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
