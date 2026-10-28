// Physics checks for Scanning 1938–2002: node scanning/test.mjs
import { ERAS, probe } from './optics.js';
import { uranium, si112 } from './specimens.js';

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
const best = (era, ab, alphaRange, demag) => { let b = null;
  for (let a = alphaRange[0]; a <= alphaRange[1]; a += 0.5) for (let C1 = -3000; C1 <= 100; C1 += era === 2002 ? 0.5 : 4) {
    const p = probe({ era, kV: ERAS[era].kV, demag, alpha: a, ab: { ...ab, C1 } }); const s = p.w / p.core; if (!b || s > b.s) b = { s, p, a, C1 }; } return b; };
const z = { A1: 0, A1a: 0, C5: 0 };

// brightness: a thermionic gun cannot fill a nanometre probe; a cold field emitter can
const p38 = probe({ era: 1938, kV: 23, demag: 8000, alpha: 3, ab: { ...z, C1: -560, C3: ERAS[1938].Cs } });
const p70 = probe({ era: 1970, kV: 30, demag: 40, alpha: 17, ab: { ...z, C1: -37, C3: ERAS[1970].Cs } });
ok(p38.I < 0.1, `1938: a few-nm probe carries only ${p38.I.toExponential(1)} pA`);
ok(p70.I > 5 && p70.core < 0.4, `1970: ${p70.core.toFixed(2)} nm probe with ${p70.I.toFixed(1)} pA`);
// the corrector: uncorrected ~2 Å, corrected below the 0.78 Å dumbbell spacing
const unc = best(2002, { ...z, C3: ERAS[2002].Cs, C5: 0 }, [4, 20], 150), cor = best(2002, { ...z, C3: -2e3, C5: ERAS[2002].C5 }, [20, 40], 150);
ok(unc.p.core > 0.15, `2002 uncorrected: best core ${(unc.p.core * 10).toFixed(2)} Å`);
ok(cor.p.core < 0.078 && cor.a >= 28, `2002 corrected: core ${(cor.p.core * 10).toFixed(2)} Å at ${cor.a} mrad`);
// defocus steals current from the core before it blurs it
const tuned = probe({ era: 1970, kV: 30, demag: 40, alpha: 17, ab: { ...z, C1: -37, C3: ERAS[1970].Cs } });
const off = probe({ era: 1970, kV: 30, demag: 40, alpha: 17, ab: { ...z, C1: 3, C3: ERAS[1970].Cs } });
ok(off.w < tuned.w / 2, `defocus 40 nm: core keeps ${(off.w * 100).toFixed(0)} % of the current (tuned ${(tuned.w * 100).toFixed(0)} %)`);
// Z-contrast: a uranium atom stands far above the carbon film in ADF, the ratio signal cancels film mottling
const pr = { sc: tuned.core / 2.355, sh: tuned.halo / 2.355, w: tuned.w };
const film = [], ratio = []; for (let i = 0; i < 200; i++) { film.push(uranium(100 + i * 0.37, 150.3, pr, 'adf')); ratio.push(uranium(100 + i * 0.37, 150.3, pr, 'ratio')); }
const cv = (a) => { const m = a.reduce((x, y) => x + y) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) / m; };
ok(cv(ratio) < cv(film), `ratio signal flattens the film (${cv(ratio).toFixed(3)} vs ADF ${cv(film).toFixed(3)})`);
// sub-ångström: the corrected probe splits the dumbbell, the uncorrected one does not
const dip = (p) => { const q = { sc: p.core / 2.355, sh: p.halo / 2.355, w: p.w }; const pr2 = []; for (let i = 0; i < 41; i++) pr2.push(si112(0, -0.1 + 0.2 * i / 40, q, 'adf')); return 1 - pr2[20] / Math.max(...pr2); };
ok(dip(cor.p) > 0.05 && dip(unc.p) < 0.01, `dumbbell dip: corrected ${(dip(cor.p) * 100).toFixed(1)} %, uncorrected ${(dip(unc.p) * 100).toFixed(1)} %`);
process.exit(fail ? 1 : 0);
