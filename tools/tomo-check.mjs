// Electron tomography check (M7): tilt schemes, a matched projector, WBP and SIRT, the missing-wedge elongation,
// the projection requirement, dose and alignment, phantoms of every specimen and of any uploaded structure, and
// the exhibit plumbing (sessions, scripts, analysis, footprint, MRC export).   node tools/tomo-check.mjs
import * as T from '../js/tomo.js';
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import * as P from '../js/physics.js';
import { runOpState } from '../js/ops.js';
import { toSession, readSession } from '../js/session.js';
import { settingsToOps } from '../js/scripting.js';
import { analyze } from '../js/analyze.js';
import { footprintFor } from '../js/footprint.js';
import { modeInfo } from '../js/explain.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const pct = (a, b) => `${a >= b ? '+' : ''}${(100 * (a / b - 1)).toFixed(1)} %`;
const small = (vol, ph) => (T.elongation(vol, ph.N, ph.beads[0]).e + T.elongation(vol, ph.N, ph.beads[1]).e) / 2;

// 1. tilt schemes
{
  const L = T.tilts('linear', 70, 2), S = T.tilts('saxton', 70, 2);
  ok(L.length === 71 && L[0] === -70 && L[70] === 70, `linear ±70° in 2° steps: ${L.length} tilts`);
  const d = S.slice(1).map((a, i) => a - S[i]), mid = S.indexOf(0);
  ok(S.every((a, i) => Math.abs(a + S[S.length - 1 - i]) < 1e-9) && Math.abs(d[mid] - 2) < 1e-9 && Math.abs(d.at(-1) - 2 * Math.cos((S.at(-2) * Math.PI) / 180)) < 1e-9 && S.length > L.length,
    `Saxton: symmetric, 2° at 0°, ${d.at(-1).toFixed(2)}° near ${S.at(-1).toFixed(1)}° (Δθ₀ cos θ), ${S.length} tilts`);
  const w = T.intervals(L).reduce((a, b) => a + b, 0) * 180 / Math.PI;
  ok(Math.abs(w - 142) < 1e-6, `angular weights sum to the covered range plus one step (${w.toFixed(1)}°)`);
}

// 2. the back-projector is the exact adjoint of the projector: ⟨A x, y⟩ = ⟨x, Aᵀ y⟩
{
  const N = 24, x = Float32Array.from({ length: N ** 3 }, (_, i) => Math.sin(i * 1.7) ** 2), y = Float32Array.from({ length: N * N }, (_, i) => Math.cos(i * 0.37));
  let worst = 0;
  for (const th of [0, 17, -38, 61, 89]) {
    const Ax = T.project(x, N, th), ATy = T.backproject(y, N, th, new Float32Array(N ** 3));
    let a = 0, b = 0; for (let i = 0; i < Ax.length; i++) a += Ax[i] * y[i]; for (let i = 0; i < x.length; i++) b += x[i] * ATy[i];
    worst = Math.max(worst, Math.abs(a - b) / Math.abs(a));
  }
  ok(worst < 1e-5, `projector and back-projector are adjoint (worst relative mismatch ${worst.toExponential(1)})`);
  // a ball inside the inscribed cylinder stays on the detector at every tilt
  const ball = new Float32Array(N ** 3); let m = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x - 11.5) ** 2 + (y - 11.5) ** 2 + (z - 11.5) ** 2 < 81) { ball[x + N * (y + N * z)] = 1; m++; }
  const sums = [0, 33, 45, 72].map((th) => T.project(ball, N, th).reduce((s, v) => s + v, 0));
  ok(sums.every((v) => Math.abs(v - m) < 1e-2), `projections conserve mass (Σ over the detector = ${m} voxels at 0°, 33°, 45°, 72°)`);
}

// 3. M7 acceptance: the elongation along the beam of a reconstructed (point-like) bead matches the missing-wedge
//    prediction e = √((α + sin α cos α)/(α − sin α cos α)) within 10 %; with the full range it is isotropic
{
  const N = 128, ph = T.beadPhantom(N, { film: false });
  const full = T.wbp(T.series({ ph, angles: T.tilts('linear', 89, 2), noise: false }));
  const iso = ph.beads.slice(1).map((b) => T.elongation(full, N, b).e);
  ok(iso.every((e) => Math.abs(e - 1) < 0.05), `±89°: isotropic reconstruction (z/y extent ${iso.map((e) => e.toFixed(3)).join(', ')})`);
  for (const a of [70, 60, 45]) {
    const ser = T.series({ ph, angles: T.tilts('linear', a, 2), noise: false }), pr = T.predictedElongation(a);
    const er = small(T.wbp(ser), ph), eh = small(T.wbp(ser, { filter: 'hann' }), ph);
    ok(Math.abs(er / pr - 1) < 0.1 && Math.abs(eh / pr - 1) < 0.1, `±${a}°: elongation predicted ${pr.toFixed(3)}; WBP ramp ${er.toFixed(3)} (${pct(er, pr)}), Hann ${eh.toFixed(3)} (${pct(eh, pr)})`);
    if (a === 60) {
      const st = T.sirtInit(ser, { iterations: 15 }); T.sirtStep(st, ser);
      const es = small(st.x, ph);
      ok(Math.abs(es / pr - 1) < 0.1 && st.resid.at(-1) < st.resid[0], `±60°: SIRT (15 iterations) ${es.toFixed(3)} (${pct(es, pr)}); residual ${(100 * st.resid[0]).toFixed(1)} → ${(100 * st.resid.at(-1)).toFixed(1)} %`);
      const big = T.elongation(T.wbp(ser), N, ph.beads[4]).e;
      ok(big < er && big > 1, `a 6 nm bead stretches less (${big.toFixed(2)}) than a point (${er.toFixed(2)}): the formula is the point-spread function's`);
    }
  }
}

// 4. the projection requirement, dose, damage and alignment (96³ beads in a carbon film)
{
  const N = 96, ph = T.beadPhantom(N), angles = T.tilts('linear', 70, 2);
  const rec = (o, align = false) => { let s = T.seriesData(T.series({ ph, angles, ...o })); if (align) s = T.alignCOM(s); return T.correlation(T.wbp(s, { filter: 'hann' }), ph.vol); };
  const haadf = rec({ noise: false }), bf = rec({ signal: 'bf', noise: false });
  // the projection requirement, as tomographers check it: a true projection carries the same total intensity at
  // every tilt (the zeroth Helgason–Ludwig condition); bright-field diffraction contrast does not
  const cv = (signal) => { const t = T.series({ ph, angles, signal, noise: false }).proj.map((p) => p.reduce((a, v) => a + v, 0)), m = t.reduce((a, v) => a + v, 0) / t.length; return Math.sqrt(t.reduce((a, v) => a + (v - m) ** 2, 0) / t.length) / m; };
  const ch = cv('haadf'), cb = cv('bf');
  ok(ch < 0.01 && cb > 0.1 && bf < haadf, `HAADF is a projection, bright field is not: total intensity varies ${(100 * ch).toFixed(2)} % vs ${(100 * cb).toFixed(0)} % over the tilts; correlation with the phantom ${haadf.toFixed(3)} vs ${bf.toFixed(3)}`);
  const lo = rec({ dosePerImage: 1 }), hi = rec({ dosePerImage: 3e4 });
  ok(lo < hi - 0.1, `dose: ${angles.length} e⁻/Å² for the series gives ${lo.toFixed(3)}, ${(3e4 * angles.length).toExponential(0)} gives ${hi.toFixed(3)} (shot noise)`);
  const ser = T.series({ ph, angles, Dc: 100, dosePerImage: 10, noise: false }), tot = (p) => p.reduce((s, v) => s + v, 0);
  const early = tot(ser.proj[35]) / tot(T.project(ph.vol, N, angles[35])), late = tot(ser.proj[70]) / tot(T.project(ph.vol, N, angles[70]));
  ok(Math.abs(ser.massLeft - (0.7 + 0.3 * Math.exp(-710 / 100))) < 1e-6 && Math.abs(early - (0.7 + 0.3 * Math.exp(-3.5))) < 1e-3 && late < early, `mass loss: ${Math.round(100 * early)} % of the mass at 0°, ${Math.round(100 * late)} % at the last tilt (after ${(710 / 100).toFixed(1)} D_c): the projections disagree`);
  const jit = rec({ noise: false, jitter: 2 }), ali = rec({ noise: false, jitter: 2 }, true);
  ok(jit < haadf - 0.1 && ali > haadf - 0.03, `alignment: 2 px rms jitter ${jit.toFixed(3)}, after centre-of-mass alignment ${ali.toFixed(3)} (no jitter ${haadf.toFixed(3)})`);
  const sax = T.correlation(T.wbp(T.seriesData(T.series({ ph, angles: T.tilts('saxton', 70, 2), noise: false }))), ph.vol);
  ok(sax > 0.5, `Saxton series reconstructs with unequal weights (correlation ${sax.toFixed(3)})`);
}

// 5. phantoms of every specimen (from the structure the viewer builds) and of an uploaded structure
const run = (id, o = {}) => {
  const S = defaultState(); Object.assign(S, { mode: 'tomo', spec: id, fov: P.SPECIMENS[id]?.fov ?? 8, cx: P.SPECIMENS[id]?.center?.[0] ?? 0, cy: P.SPECIMENS[id]?.center?.[1] ?? 0, tomoN: 64 }, o);
  const sim = new Sim(S); sim.update(0.05); return { S, sim };
};
{
  const rows = [];
  for (const id of Object.keys(P.SPECIMENS)) { const { sim } = run(id); rows.push([id, !sim.tomo.ph.empty, sim.tomo.ph.vox]); }
  const empty = rows.filter((r) => !r[1]).map((r) => r[0]);
  ok(empty.length <= 1 && rows.length >= 10, `phantoms: ${rows.filter((r) => r[1]).length}/${rows.length} specimens have material in the box${empty.length ? ` (empty here: ${empty.join(', ')})` : ''}; voxels ${rows.map((r) => `${r[0]} ${(r[2] / 10).toFixed(2)} nm`).join(', ')}`);
  const ST = await import('../js/structure.js'), fs = await import('node:fs');
  const rod = ST.fromXYZText(fs.readFileSync(new URL('./structures/si-rod.xyz', import.meta.url), 'utf8'), 'si-rod.xyz');
  P.loadXYZ(ST.toXYZText(rod), 'si-rod.xyz');
  const { sim } = run('xyz', { cx: 0, cy: 0 });
  sim.startTomo({ instant: true });
  const tm = sim.tomo;
  ok(!tm.ph.empty && tm.stats.corr > 0.3, `an uploaded XYZ (Si rod, ${rod.sym.length} atoms): voxelised, ${tm.angles.length} projections, reconstructed (correlation ${tm.stats.corr.toFixed(3)})`);
}

// 6. the exhibit: collect, reconstruct, sessions, scripts, analysis, footprint, explanation, MRC
{
  const { S, sim } = run('au', { tomoPhantom: 'beads', tomoN: 96, tomoDose: 1e7 });
  ok(runOpState(S, sim, { op: 'action', v: 'collect' }) && sim.tomo.rec?.x && sim.tomo.ser.proj.length === 71, `action collect: ${sim.tomo.ser.proj.length} projections recorded and reconstructed at once`);
  const a = analyze(sim, S, 'tomo_stats');
  ok(Math.abs(a.result.elongation_measured / a.result.elongation_predicted - 1) < 0.1, `tomo_stats: ${a.summary}`);
  S.tomoRecon = 'sirt'; S.tomoIter = 6;
  runOpState(S, sim, { op: 'action', v: 'reconstruct' });
  ok(sim.tomo.rec.method === 'sirt' && sim.tomo.rec.iter === 6 && sim.tomo.rec.resid.length === 6, `action reconstruct: SIRT ${sim.tomo.rec.iter} iterations, residual ${(100 * sim.tomo.rec.resid.at(-1)).toFixed(1)} %`);
  // the exhibit records the series over ~8 s, then reconstructs on its own
  const E = run('hesi', { tomoN: 64 }); E.sim.startTomo();
  for (let i = 0; i < 100 && !E.sim.tomo.rec?.x; i++) E.sim.update(0.1);
  ok(E.sim.tomo.ser.proj.length === E.sim.tomo.angles.length && E.sim.tomo.rec?.x && E.sim.tomoPhi() === 0, 'exhibit: Collect records the series as the holder turns, then reconstructs (WBP)');
  const r = readSession(JSON.parse(JSON.stringify(toSession({ ...S, tomoMax: 55, tomoScheme: 'saxton', tomoRecon: 'sirt', tomoN: 128 })))).state;
  ok(r.mode === 'tomo' && r.tomoMax === 55 && r.tomoScheme === 'saxton' && r.tomoRecon === 'sirt' && r.tomoN === 128, 'session: tomography settings saved and restored');
  const ops = settingsToOps({ mode: 'tomo', tomo_max_tilt_deg: 60, tomo_scheme: 'saxton', tomo_method: 'sirt', tomo_volume: 128, tomo_align: false });
  ok(['tomoMax', 'tomoScheme', 'tomoRecon', 'tomoN', 'tomoAlign'].every((k) => ops.some((o) => o.k === k)), 'scripts: tomo_max_tilt_deg, tomo_scheme, tomo_method, tomo_volume, tomo_align …');
  const f = footprintFor({ ...S, tomoRecon: 'wbp' }, sim), g = footprintFor({ ...S, tomoRecon: 'sirt', tomoIter: 20 }, sim);
  ok(f.raw.bytes === 71 * 1024 * 1024 * 2 && f.shape.join() === '71,1024,1024' && g.working.bytes > f.working.bytes && g.time.process_s.browser > 10 * f.time.process_s.browser,
    `footprint: 71 × 1024² × 16-bit = ${(f.raw.bytes / 2 ** 20).toFixed(0)} MB raw; 1024³ volume: WBP ${f.badge.label}, SIRT ${g.badge.label}`);
  const inf = modeInfo(S, sim);
  ok(/missing wedge/.test(inf.body) && inf.stats.length === 4, `explanation: "${inf.title.replace(/<[^>]+>/g, '')}"`);
  const N = 8, m = T.mrc(Float32Array.from({ length: N ** 3 }, (_, i) => i), N, N, N, 2.5), dv = new DataView(m.buffer);
  ok(dv.getInt32(0, true) === 8 && dv.getInt32(12, true) === 2 && String.fromCharCode(...m.slice(208, 212)) === 'MAP ' && dv.getFloat32(40, true) === 20 && new Float32Array(m.buffer, 1024)[511] === 511 && m.length === 1024 + 4 * 512,
    'MRC2014: header (8³, mode 2, cell 20 Å, MAP) and float32 data');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
