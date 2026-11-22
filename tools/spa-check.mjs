// Single-particle cryo-EM (M9): the pieces, then the acceptance test: the FSC resolution improves with the number
// of particles and gets worse with preferred orientation (along the preferred axis, where views are missing) and
// with too much dose (radiation damage), as expected. ~1 min.
import * as SPA from '../js/spa.js';
import { fft2 } from '../js/kernels.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

// ---- the particle
const G = SPA.octahedralGroup();
ok(G.length === 24 && new Set(G.map((g) => g.join())).size === 24, 'the rotation group of the cube has 24 distinct rotations');
ok(SPA.apoferritinRods().length === 120, 'apoferritin: 24 subunits × 5 helices');
const N = 64, px = 2.4, map = SPA.apoferritin(N, px);
{ let r2 = 0, w = 0; for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = map[x + N * (y + N * z)]; r2 += v * ((x - 32) ** 2 + (y - 32) ** 2 + (z - 32) ** 2); w += v; }
  const rg = Math.sqrt(r2 / w) * px; ok(rg > 45 && rg < 58, `a hollow shell: density at r ≈ ${rg.toFixed(1)} Å (subunits between ~40 and ~62 Å)`); }

// ---- projection-slice theorem: a central slice of the padded 3D transform is the transform of the projection
{
  const P = SPA.projector(map, N), M = P.M, S = SPA.slice(P, SPA.viewFrame([0, 0, 1], 0));
  // centre in the box and back to real space
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) if ((i + j) & 1) { S.re[i + M * j] *= -1; S.im[i + M * j] *= -1; }
  fft2(S.re, S.im, M, true);
  let d = 0, m = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let sum = 0; for (let z = 0; z < N; z++) sum += map[x + N * (y + N * z)];
    const v = S.re[x + N / 2 + M * (y + N / 2)]; d = Math.max(d, Math.abs(v - sum)); m = Math.max(m, sum);
  }
  ok(d / m < 0.05, `central slice = transform of the projection along z (max error ${(100 * d / m).toFixed(1)} % of the peak)`);
}

// ---- image formation
{
  const c = SPA.ctfParams({ kV: 300, Cs: 2.7 }), T0 = SPA.transfer(1 / 50, -15000, c, { envelope: false, dmg: false });
  ok(T0 < 0, `underfocus: protein dark at low frequency (T(1/50 Å) = ${T0.toFixed(2)})`);
  const cz = SPA.ctfParams({ kV: 300, Cs: 2.7, zpp: true }), Tz = SPA.transfer(1 / 50, 0, cz, { envelope: false, dmg: false });
  ok(Math.abs(Tz) > 1.9, `Zernike plate in focus: full contrast at 50 Å (|T| = ${Math.abs(Tz).toFixed(2)}, −sin χ alone gives ${Math.abs(SPA.transfer(1 / 50, 0, c, { envelope: false, dmg: false })).toFixed(2)})`);
  const d = [10, 40, 160].map((D) => SPA.damage(1 / 4, D)), dk = [1 / 20, 1 / 8, 1 / 4].map((k) => SPA.damage(k, 40));
  ok(d[0] > d[1] && d[1] > d[2] && dk[0] > dk[1] && dk[1] > dk[2], `radiation damage removes fine detail first and grows with dose (4 Å: ${d.map((v) => v.toFixed(2)).join(' → ')})`);
}

// ---- FSC
{
  const a = new Float32Array(N ** 3).map(() => Math.random()), b = new Float32Array(N ** 3).map(() => Math.random());
  ok(SPA.fsc(map, map, N, px).curve.every((c) => c.fsc > 0.999), 'FSC of a map with itself is 1');
  const f = SPA.fsc(a, b, N, px).curve.slice(5);
  ok(f.every((c) => Math.abs(c.fsc) < 0.2), 'FSC of independent noise ≈ 0');
}

// ---- the pipeline
const run = (o) => { const st = SPA.runSPA(o), r = SPA.spaResult(st); return r; };
const show = (r) => `${r.fsc.res.toFixed(1)} Å (along z ${r.fscZ.res.toFixed(1)}, across ${r.fscXY.res.toFixed(1)}; map corr ${r.mapCorr.toFixed(3)})`;
const base = run({ count: 1000 });
ok(Math.abs(base.mic.dfEst - base.mic.dfTrue) < 300, `the displayed micrograph's defocus from its Thon rings: ${(-base.mic.dfTrue / 1e4).toFixed(3)} µm, fitted ${(-base.mic.dfEst / 1e4).toFixed(3)} µm`);
ok(base.ctfErr < 300, `defocus fitted from the Thon rings of each micrograph: ±${base.ctfErr.toFixed(0)} Å rms`);
ok(base.mic.recall > 0.8 && base.mic.precision > 0.9, `template picking at 40 e⁻/Å²: ${Math.round(100 * base.mic.recall)} % found, ${Math.round(100 * base.mic.precision)} % real`);
ok(base.mapCorr > 0.8, `the map agrees with the particle: correlation ${base.mapCorr.toFixed(3)}`);
{
  const lo = run({ count: 40, dose: 5 });
  ok(lo.mic.recall < base.mic.recall, `at 5 e⁻/Å² fewer particles are found (${Math.round(100 * lo.mic.recall)} %)`);
}
{
  const junk = run({ count: 600, pickK: 1.5 }); // a low threshold: many false picks
  ok(junk.junkMade > 50 && junk.rejected.junk > 0.6 * junk.junkMade && junk.rejected.good < 0.1 * junk.made, `2D classification rejects false picks: ${junk.rejected.junk} of ${junk.junkMade}, and ${junk.rejected.good} of ${junk.made} particles`);
}

// ---- acceptance: particle count, preferred orientation, dose
const r250 = run({ count: 250 }), r2500 = run({ count: 2500 });
console.log(`   250: ${show(r250)}\n  1000: ${show(base)}\n  2500: ${show(r2500)}`);
ok(r250.fsc.res > base.fsc.res && base.fsc.res > r2500.fsc.res && r250.fsc.mean < base.fsc.mean && base.fsc.mean < r2500.fsc.mean, `FSC improves with particle count: ${r250.fsc.res.toFixed(1)} → ${base.fsc.res.toFixed(1)} → ${r2500.fsc.res.toFixed(1)} Å`);
const pref = run({ count: 1000, pref: 0.9 });
console.log(`  90 % preferred: ${show(pref)}`);
ok(pref.fscZ.band < 0.5 * base.fscZ.band && pref.fscZ.band < 0.5 * pref.fscXY.band && pref.mapCorr < base.mapCorr, `FSC along the preferred axis falls with preferred orientation: mean FSC 20–8 Å along z ${base.fscZ.band.toFixed(3)} → ${pref.fscZ.band.toFixed(3)} (across ${pref.fscXY.band.toFixed(3)}; the map is stretched, correlation ${base.mapCorr.toFixed(3)} → ${pref.mapCorr.toFixed(3)})`);
console.log(`   (the global FSC looks better with preferred orientation, ${pref.fsc.res.toFixed(1)} Å against ${base.fsc.res.toFixed(1)} Å: the top views oversample one plane of Fourier space)`);
const burnt = run({ count: 1000, dose: 300 });
console.log(`  300 e⁻/Å²: ${show(burnt)}`);
ok(burnt.fsc.res > 1.2 * base.fsc.res && burnt.mapCorr < base.mapCorr, `FSC falls with too much dose (damage): ${base.fsc.res.toFixed(1)} Å at 40 e⁻/Å² → ${burnt.fsc.res.toFixed(1)} Å at 300`);

// ---- β-galactosidase: a D2 tetramer, ~175 × 135 × 90 Å, 465 kDa
ok(SPA.d2Group().length === 4, 'D2: four copies');
{
  const m = SPA.sampleMap('bgal', 64, 4), ext = [0, 0, 0];
  for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (m[x + 64 * (y + 64 * z)] > 0.5) { ext[0] = Math.max(ext[0], Math.abs(x - 32) * 4); ext[1] = Math.max(ext[1], Math.abs(y - 32) * 4); ext[2] = Math.max(ext[2], Math.abs(z - 32) * 4); }
  ok(ext[0] > 75 && ext[0] < 95 && ext[1] > 55 && ext[1] < 75 && ext[2] > 38 && ext[2] < 55, `β-galactosidase spans ${ext.map((e) => 2 * e).join(' × ')} Å (175 × 135 × 90)`);
  const bg = run({ sample: 'bgal', px: 4, count: 1000 }), bgp = run({ sample: 'bgal', px: 4, count: 1000, pref: 0.9 }), bg2 = run({ sample: 'bgal', px: 4, count: 2500 });
  console.log(`  β-gal 1000: ${show(bg)}; 2500: ${show(bg2)}; 90 % preferred: ${show(bgp)}`);
  ok(bg.mapCorr > 0.85 && bg.mic.recall > 0.6, `β-galactosidase reconstructs (map correlation ${bg.mapCorr.toFixed(3)}; ${Math.round(100 * bg.mic.recall)} % picked, ${Math.round(100 * bg.mic.precision)} % real)`);
  ok(bg2.fsc.mean > bg.fsc.mean && bgp.fscZ.band < 0.5 * bgp.fscXY.band, `β-galactosidase: FSC improves with particles (mean ${bg.fsc.mean.toFixed(3)} → ${bg2.fsc.mean.toFixed(3)}) and falls along the preferred axis (${bgp.fscZ.band.toFixed(3)} against ${bgp.fscXY.band.toFixed(3)} across)`);
}

// ---- through the simulator (the exhibit's path, inline)
{
  const S = defaultState(); S.mode = 'spa'; S.spaN = 300;
  const sim = new Sim(S);
  sim.update(0.02);
  for (let i = 0; i < 400 && !sim.spa.done; i++) sim.update(0.02);
  ok(sim.spa.out.mic?.picks && sim.spa.out.preview, 'the exhibit previews the first micrograph, its CTF fit and picks');
  sim.startSPA({ instant: true });
  ok(sim.spa.out.fsc?.res > 0 && sim.spa.out.accepted > 250, `Collect runs the pipeline: ${sim.spa.out.accepted} particles, ${sim.spa.out.fsc.res.toFixed(1)} Å`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
