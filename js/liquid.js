// The liquid cell (M14): a specimen in a liquid layer sealed between two electron-transparent windows: SiNₓ
// membranes on chips (static or with flow), or graphene sheets that trap pockets of liquid (de Jonge & Ross 2011;
// Ross 2015). Described by physical parameters only, never by product names. Pure functions: environment.js turns
// them into layers for every technique, sim.js steps the processes.
//
// Mechanics (Vlassak & Nix 1992): a pre-stressed membrane of half-widths a (short) and b (long), thickness t, under
// a pressure difference ΔP bows out by w at its centre:
//   ΔP = C₁(b/a)·σ₀·t·w/a² + C₂(b/a)·E′·t·w³/a⁴
//   square (b/a = 1): C₁ = 3.393, C₂ = (0.800 + 0.062ν)⁻³, E′ = E/(1 − ν)
//   long slit (b/a ≥ 4): C₁ = 2, C₂ = 4/3, E′ = E/(1 − ν²) (plane strain)
//   in between: C₁, C₂ and E′ interpolated linearly in b/a (a simplification of finite-element tables)
// It bursts when the membrane stress σ ≈ σ₀ + E′w²/(1.5a²) (the plane-strain membrane strain (2/3)(w/a)²) exceeds
// its fracture strength σ_f.
//
// Resolution: in TEM the electrons that lose energy in the liquid are blurred by chromatic aberration,
// d_c = C_c·α·⟨ΔE⟩/E₀, plus a smaller elastic term from the liquid below the particle; in STEM the probe broadens in
// the liquid above the particle, d ≈ 1.5 nm·(t_above / 1 µm)^1.5 at 200 kV (de Jonge's calibration). Hence the
// top–bottom effect: STEM images particles on the entrance (top) window sharpest, TEM those on the exit window.
//
// Radiolysis (Schneider et al. 2014): the steady-state H₂ concentration grows as √(dose rate); above the dose rate
// where it exceeds its solubility (~0.8 mM), bubbles nucleate and grow. Flow refreshes the liquid and raises that
// threshold; graphene scavenges radicals and raises it more. Hydrated electrons reduce gold ions (with a precursor
// in the liquid), so gold particles grow.

export const CELLS = {
  sinx: { label: 'SiNₓ static liquid cell', windows: 'sinx', flow: false },
  sinxFlow: { label: 'SiNₓ flow liquid cell', windows: 'sinx', flow: true },
  graphene: { label: 'Graphene liquid cell (pockets)', windows: 'graphene', flow: false, pockets: true },
};
// window material: residual stress σ₀, Young's modulus E, Poisson ν, fracture strength σ_f (Pa)
export const SINX = { sigma0: 0.3e9, E: 250e9, nu: 0.25, sigmaF: 3e9 };

export function constants(bOverA, nu) {
  const r = Math.max(0, Math.min(1, (bOverA - 1) / 3));
  return { C1: 3.393 + (2 - 3.393) * r, C2: (0.8 + 0.062 * nu) ** -3 + (4 / 3 - (0.8 + 0.062 * nu) ** -3) * r, Ef: 1 / (1 - nu) + (1 / (1 - nu * nu) - 1 / (1 - nu)) * r };
}
// centre deflection w (m) of one window: a, b half-widths (m), t thickness (m), dP (Pa); Newton on the cubic
export function deflection({ a, b, t, dP, sigma0 = SINX.sigma0, E = SINX.E, nu = SINX.nu }) {
  if (!(dP > 0)) return 0;
  const k = constants(b / a, nu), lin = (k.C1 * sigma0 * t) / (a * a), cub = (k.C2 * E * k.Ef * t) / a ** 4;
  let w = Math.min(dP / lin, Math.cbrt(dP / cub));
  for (let i = 0; i < 60; i++) { const f = lin * w + cub * w ** 3 - dP, d = lin + 3 * cub * w * w; const nw = w - f / d; if (Math.abs(nw - w) < 1e-15) { w = nw; break; } w = Math.max(0, nw); }
  return w;
}
export const pressureFor = ({ a, b, t, w, sigma0 = SINX.sigma0, E = SINX.E, nu = SINX.nu }) => { const k = constants(b / a, nu); return (k.C1 * sigma0 * t * w) / (a * a) + (k.C2 * E * k.Ef * t * w ** 3) / a ** 4; };
export function stress({ a, b, w, sigma0 = SINX.sigma0, E = SINX.E, nu = SINX.nu }) { const k = constants(b / a, nu); return sigma0 + (E * k.Ef * w * w) / (1.5 * a * a); }
// the pressure difference at which the window bursts (Pa)
export function burstPressure(o) {
  const k = constants(o.b / o.a, o.nu ?? SINX.nu), E = o.E ?? SINX.E, s0 = o.sigma0 ?? SINX.sigma0, sf = o.sigmaF ?? SINX.sigmaF;
  if (sf <= s0) return 0;
  const wb = o.a * Math.sqrt((1.5 * (sf - s0)) / (E * k.Ef));
  return pressureFor({ ...o, w: wb });
}

// the cell from the state: geometry in SI units and what follows from it (bulge, burst, liquid thickness here)
export function cellOf(S) {
  if (S.envCell !== 'liquid') return null;
  const C = CELLS[S.lcClass] ?? CELLS.sinx, out = { cls: S.lcClass, C, gap: S.lcGap * 1e-9, flow: C.flow ? S.lcFlow : 0 };
  if (C.pockets) {
    // graphene: liquid only in pockets (a hash grid of pocket size D), each D/4 high, no bulge
    const D = S.lcPocket * 10, i = Math.floor(S.cx / D), j = Math.floor(S.cy / D), h = ((Math.imul(i * 73856093 ^ j * 19349663, 2654435761) >>> 0) % 1000) / 1000;
    const inPocket = h < 0.55, dx = S.cx / D - i - 0.5, dy = S.cy / D - j - 0.5, r = Math.hypot(dx, dy), shape = Math.max(0, 1 - (r / 0.45) ** 2);
    return Object.assign(out, { pockets: true, thicknessA: inPocket ? (D / 4) * shape : 0, inPocket: inPocket && shape > 0, w: 0, burstP: Infinity, burst: false });
  }
  const t = (S.envWinT ?? 20) * 1e-9, a = (S.lcA / 2) * 1e-6, b = (S.lcB / 2) * 1e-6, dP = S.lcDP * 1e5;
  const w = deflection({ a, b, t, dP }), sig = stress({ a, b, w }), burstP = burstPressure({ a, b, t });
  // where the stage is on the window (µm from its centre); outside: the silicon frame
  const x = S.cx / 1e4, y = S.cy / 1e4, onWin = Math.abs(x) < S.lcA / 2 && Math.abs(y) < S.lcB / 2;
  const shape = onWin ? (1 - (x / (S.lcA / 2)) ** 2) * (1 - (y / (S.lcB / 2)) ** 8) : 0;
  const thick = out.gap + 2 * w * shape; // both windows bow outwards
  return Object.assign(out, { a, b, t, dP, w, stress: sig, burstP, burst: dP >= burstP, onWin, shape, thicknessA: onWin ? thick * 1e10 : 0 });
}

// ---------------------------------------------------------------- resolution in the liquid
// particle depth: 0 on the entrance (top) window, 1 on the exit (bottom) window
const DEPTH = { top: 0.02, middle: 0.5, bottom: 0.98 };
export const depthOf = (S) => DEPTH[S.lcDepth] ?? 0.5;
// STEM: probe broadening in the liquid above the particle (nm)
export function stemBlur(tAboveA, kV) { return 1.5 * (tAboveA / 1e4) ** 1.5 * (200 / kV); }
// TEM: chromatic blur of the electrons that lost energy anywhere in the liquid (nm), and the share that did; plus
// an elastic term from the liquid below the particle (smaller than STEM's broadening)
export function temBlur(tTotA, tBelowA, kV, { Cc = 1.4e7, alpha = 0.01, meanLoss = 37, lambdaA = 1500 } = {}) {
  const E0 = kV * 1e3, dc = (Cc * alpha * meanLoss) / E0 / 10; // Å → nm
  return { chromatic: dc, inelasticShare: 1 - Math.exp(-tTotA / lambdaA), elastic: 0.3 * stemBlur(tBelowA, kV) };
}

// ---------------------------------------------------------------- radiolysis
// dose rate in water (Gy/s) for a current density j (e⁻/Å²/s): j·10¹⁶ cm⁻² · S/ρ (≈ 2.8 MeV cm²/g at 200 kV,
// ∝ 1/β²) · 1.602·10⁻¹⁹ J/eV · 10³ g/kg
export function doseRateGy(j, kV) {
  const b2 = (kv) => { const g = 1 + kv / 511; return 1 - 1 / (g * g); };
  return j * 1e16 * 2.8e6 * (b2(200) / b2(kV)) * 1.602e-19 * 1e3;
}
// the dose rate above which H₂ exceeds its solubility; flow and graphene raise it
export function bubbleThresholdGy(S) {
  const C = CELLS[S.lcClass] ?? CELLS.sinx;
  return 3e7 * (1 + (C.flow ? S.lcFlow / 0.5 : 0)) * (C.pockets ? 10 : 1);
}
// steady-state H₂ relative to its solubility (> 1: bubbles)
export function h2Ratio(S, kV) { return Math.sqrt(doseRateGy(S.lcRate, kV) / bubbleThresholdGy(S)); }

// one step of the processes (dt s): bubbles nucleate and grow when H₂ is supersaturated, gold grows from hydrated
// electrons (with a precursor), particles move by hindered Brownian motion. st: { t, bubbles: [{x, y, r}], grow,
// bx, by }; rng seeded by the caller; fov (Å) and the stage (cx, cy, Å) place the new bubbles in view
export function step(st, S, kV, dt, rng, fovA, tLiqA) {
  st.t += dt;
  const ratio = h2Ratio(S, kV), excess = ratio - 1;
  if (excess > 0 && tLiqA > 0) {
    if (rng() < Math.min(1, 0.6 * excess * dt) && st.bubbles.length < 12) st.bubbles.push({ x: S.cx + (rng() - 0.5) * fovA * 0.8, y: S.cy + (rng() - 0.5) * fovA * 0.8, r: 5 });
    for (const b of st.bubbles) b.r = Math.min(tLiqA * 0.5 + fovA * 0.15, b.r + 40 * Math.sqrt(excess) * dt);
  } else for (const b of st.bubbles) b.r = Math.max(0, b.r - 15 * dt); // undersaturated: they dissolve
  st.bubbles = st.bubbles.filter((b) => b.r > 0);
  if (S.lcPrecursor && tLiqA > 0) st.grow = Math.min(15, st.grow + 0.4 * Math.sqrt(doseRateGy(S.lcRate, kV) / 3e7) * dt); // Å of radius
  // hindered Brownian motion: free diffusion is far too fast to image; particles stuck near a window barely move
  const D = (depthOf(S) < 0.1 || depthOf(S) > 0.9 ? 0.5 : 6) * (tLiqA > 0 ? 1 : 0); // Å²/s
  const s = Math.sqrt(2 * D * dt), g = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  st.bx += s * g(); st.by += s * g();
  return st;
}
// the liquid thickness (Å) at (x, y) with bubbles: each removes a chord of its sphere
export function withBubbles(tA, bubbles, x, y) {
  let t = tA;
  for (const b of bubbles) { const d2 = (x - b.x) ** 2 + (y - b.y) ** 2; if (d2 < b.r * b.r) t -= 2 * Math.sqrt(b.r * b.r - d2); }
  return Math.max(0, t);
}
