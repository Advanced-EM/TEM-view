// Biasing (M16): electrodes on a MEMS chip apply a voltage or a current to the specimen, described by its physics
// only (no product names): an electrode layout and gap, contact and series resistance, substrate leakage, the
// source's limits (maximum voltage, compliance current) and the breakdown field. Pure functions: sim.js turns them
// into phase, deflection, heat and events for every technique.
//
// Field: in steady state the current in the specimen film obeys ∇·(σ∇V) = 0, Laplace's equation in the plane of a
// uniform film. It is solved once per layout on a grid in units of the gap g (the solution scales with g and with
// the voltage), electrodes as fixed potentials, the film's edges insulating. Above and below the chip the potential
// spreads into the vacuum: each in-plane Fourier component V_k decays as e^(−2π|k||z|), so the vacuum outside the
// film (|z| > t/2) adds a projected potential V_k e^(−π|k|t)/(π|k|) (the stray field; its k = 0 term is fixed by
// the grounded column and drops out of every relative phase).
//
// Phase (Twitchett et al. 2002): φ = C_E ∫V dz = C_E [t V(x, y) + P_vac(x, y)]; deflection β = λ∇φ/2π.
//
// Circuit: source → series R_s → contact R_c → (specimen R ∥ leakage R_leak) → contact R_c → return. The specimen
// sees the source voltage minus the drops across the contacts and series resistance; a four-terminal layout
// measures it directly with sense contacts at the gap edges, a two-terminal one reads back V_src − I R_s, which
// still includes both contacts. Compliance clamps the current. Failures: dielectric breakdown (the peak field
// exceeds the breakdown field: a conducting filament forms), contact burn-out (contact dissipation above ~5 mW: the
// circuit opens), electromigration (metal lines above ~10¹⁰ A/m²: voids raise the resistance until the line opens).
// Joule heating P = I²R raises the specimen temperature by P·R_th. Under liquid (with the liquid cell) the
// electrode potential drives gold deposition or dissolution (Butler–Volmer).

import { fft2 } from './physics.js';
import * as K from './kinetics.js';

export const LAYOUTS = {
  two: { label: 'Two-terminal, parallel electrodes', sense: false },
  four: { label: 'Four-terminal (sense contacts at the gap)', sense: true },
  tip: { label: 'Tip facing a plane electrode', sense: false },
};
// specimen materials: resistivity at 293 K (Ω·m) and its temperature law
export const MATERIALS = {
  metal: { label: 'Metal film', rho: 2.5e-7, tcr: 0.004, em: true },
  semi: { label: 'Doped semiconductor', rho: 1e-3, Ea: 0.12 },
  insulator: { label: 'Insulator', rho: 1e9, Ea: 0.6 },
};
export const R_TH = 5e4; // K/W: a lamella on a membrane between the electrodes
export const P_BURN = 5e-3; // W per contact
export const J_EM = 1e10; // A/m²
export const MAX_V = 20; // V, the source's range
export const R_FIL = 1e3; // Ω, the filament a breakdown leaves

// ---------------------------------------------------------------- the field solver
const N = 129, H = 4 / (N - 1); // nodes over [−2, 2]² gap units
const cache = new Map();
const PAD = 1.2; // pad half-height (gap units)
function electrode(layout, X, Y) {
  if (X >= 0.5 - 1e-9 && X <= 1.8 && Math.abs(Y) <= PAD) return -0.5;
  if (layout === 'tip') return X <= -0.5 + 1e-9 && X >= -1.8 && Math.abs(Y) <= (-0.5 - X) * Math.tan((20 * Math.PI) / 180) + 0.5 * H ? 0.5 : null;
  return X <= -0.5 + 1e-9 && X >= -1.8 && Math.abs(Y) <= PAD ? 0.5 : null;
}
// the unit solution u (left electrode +½, right −½) on the grid, the conductance shape factor F (I = σ_sheet V F),
// the largest field in the film (units of V/g) and where the electrodes are
export function solve(layout = 'two') {
  if (cache.has(layout)) return cache.get(layout);
  const u = new Float64Array(N * N), fixed = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const X = -2 + i * H, Y = -2 + j * H, e = electrode(layout, X, Y), k = j * N + i;
    if (e !== null) { u[k] = e; fixed[k] = 1; } else u[k] = -0.5 * Math.max(-1, Math.min(1, X / 0.5)); // start from a ramp
  }
  // red-black SOR with insulating (mirror) edges
  const w = 1.94;
  for (let it = 0; it < 6000; it++) {
    let dmax = 0;
    for (let c = 0; c < 2; c++)
      for (let j = 0; j < N; j++) for (let i = (j + c) & 1; i < N; i += 2) {
        const k = j * N + i;
        if (fixed[k]) continue;
        const l = i > 0 ? u[k - 1] : u[k + 1], r = i < N - 1 ? u[k + 1] : u[k - 1], d = j > 0 ? u[k - N] : u[k + N], t = j < N - 1 ? u[k + N] : u[k - N];
        const nv = u[k] + w * ((l + r + d + t) / 4 - u[k]);
        dmax = Math.max(dmax, Math.abs(nv - u[k])); u[k] = nv;
      }
    if (dmax < 1e-10) break;
  }
  // current through the midline x = 0 (between the electrodes), per unit sheet conductance and volt
  const i0 = (N - 1) / 2;
  let F = 0;
  for (let j = 0; j < N; j++) { const k = j * N + i0, wgt = j === 0 || j === N - 1 ? 0.5 : 1; F += (-(u[k + 1] - u[k - 1]) / (2 * H)) * H * wgt; }
  let Emax = 0;
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    if (fixed[k]) continue;
    const gx = (u[k + 1] - u[k - 1]) / (2 * H), gy = (u[k + N] - u[k - N]) / (2 * H);
    Emax = Math.max(Emax, Math.hypot(gx, gy));
  }
  const sol = { layout, N, H, u, fixed, F, Emax, vac: new Map() };
  cache.set(layout, sol);
  return sol;
}
// the vacuum's projected potential p (per volt, in units of g) for a film of thickness τ = t/g: the solution
// mirror-extended (consistent with the insulating edges) to a periodic 256² grid
export function vacuum(sol, tau) {
  const key = tau.toPrecision(3);
  if (sol.vac.has(key)) return sol.vac.get(key);
  const M = 256, L = M * sol.H, re = new Float64Array(M * M), im = new Float64Array(M * M), n = sol.N;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const a = i < n ? i : M - i, b = j < n ? j : M - j; // mirror: node M−i ↔ i (i = 1 … 127)
    re[j * M + i] = sol.u[Math.min(n - 1, b) * n + Math.min(n - 1, a)];
  }
  fft2(re, im, M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const fx = (i < M / 2 ? i : i - M) / L, fy = (j < M / 2 ? j : j - M) / L, k = Math.hypot(fx, fy), q = j * M + i;
    const f = k ? Math.exp(-Math.PI * k * tau) / (Math.PI * k) : 0;
    re[q] *= f; im[q] *= f;
  }
  fft2(re, im, M, true);
  const p = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) p[j * n + i] = re[j * M + i];
  sol.vac.set(key, p);
  return p;
}
// projected vacuum potential of a single in-plane cosine V₀ cos(2πkx) (the analytic form, for checks)
export const vacuumCosine = (V0, k, t) => (V0 * Math.exp(-Math.PI * k * t)) / (Math.PI * k);

// bilinear sample of a grid quantity at (X, Y) gap units; null outside
export function sample(sol, arr, X, Y) {
  const fx = (X + 2) / sol.H, fy = (Y + 2) / sol.H, i = Math.floor(fx), j = Math.floor(fy), n = sol.N;
  if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return 0;
  const a = fx - i, b = fy - j, k = j * n + i;
  return (arr[k] * (1 - a) + arr[k + 1] * a) * (1 - b) + (arr[k + n] * (1 - a) + arr[k + n + 1] * a) * b;
}
export const onElectrode = (sol, X, Y) => electrode(sol.layout, X, Y) !== null;

// ---------------------------------------------------------------- the circuit
export function rho(mat, T) {
  const m = MATERIALS[mat] ?? MATERIALS.semi;
  if (m.tcr) return m.rho * (1 + m.tcr * (T - 293));
  return m.rho * Math.exp((m.Ea / 8.617e-5) * (1 / T - 1 / 293));
}
// the specimen's resistance (Ω): film thickness t (m), shape factor F from the solver, and any damage (factor)
export const specimenR = (S, T, F, factor = 1) => (rho(S.bsMat, T) / ((S.thick * 1e-9) * F)) * factor;
// the operating point: source mode V (S.bsV volts) or I (S.bsI µA), compliance S.bsLimit µA, contacts S.bsRc Ω each,
// series S.bsRs Ω, leakage S.bsLeak Ω; Rspec the specimen; open: the circuit is broken
export function operate(S, Rspec, vSet = S.bsV, open = false) {
  const Rp = (Rspec * S.bsLeak) / (Rspec + S.bsLeak), Rt = S.bsRs + 2 * S.bsRc + Rp, lim = S.bsLimit * 1e-6;
  if (open) return { I: 0, Ispec: 0, Vsrc: S.bsMode === 'I' ? Math.sign(S.bsI || 1) * MAX_V : vSet, Vspec: 0, Vmeas: 0, Rt: Infinity, Rp, limited: 'open' };
  let I, limited = null;
  if (S.bsMode === 'I') {
    I = S.bsI * 1e-6;
    if (Math.abs(I * Rt) > MAX_V) { I = Math.sign(I) * (MAX_V / Rt); limited = 'voltage'; }
  } else {
    I = vSet / Rt;
    if (Math.abs(I) > lim) { I = Math.sign(I) * lim; limited = 'compliance'; }
  }
  const Vspec = I * Rp, Ispec = Vspec / Rspec;
  return { I, Ispec, Vsrc: I * Rt, Vspec, Vmeas: LAYOUTS[S.bsLayout]?.sense ? Vspec : I * Rt - I * S.bsRs, Rt, Rp, limited };
}

// ---------------------------------------------------------------- processes
// one step (dt s): the source (DC or a triangular sweep between ±bsV), the operating point, heating, failures and
// the I–V trace. st: { t, dT, broken, open, em, events, trace }
export function step(st, S, T0, dt) {
  const sol = solve(S.bsLayout);
  st.t += dt;
  const amp = S.bsV, vSet = S.bsWave === 'sweep' && amp ? amp * triangle(st.t * Math.abs(S.bsRate) / (4 * Math.abs(amp))) : amp;
  const T = T0 + st.dT, R0 = specimenR(S, T, sol.F, 1 + st.em), R = st.broken ? Math.min(R0, R_FIL) : R0; // after breakdown: a conducting filament
  const op = operate(S, R, vSet, st.open);
  // Joule heating: the specimen's dissipation relaxes the temperature rise towards P·R_th (τ ≈ 0.3 s)
  const P = op.Ispec * op.Ispec * R;
  st.dT += (P * R_TH - st.dT) * Math.min(1, dt / 0.3);
  const gA = S.bsGap * 1e4, Epk = (Math.abs(op.Vspec) / (S.bsGap * 1e-6)) * sol.Emax; // V/m
  if (!st.broken && !st.open && Epk > S.bsEbd * 1e6) { st.broken = true; st.events.push({ event: 'breakdown', t: st.t, V: op.Vspec, E_MVm: Epk / 1e6, Ebd_MVm: S.bsEbd }); }
  if (!st.open && op.I * op.I * S.bsRc > P_BURN) { st.open = true; st.events.push({ event: 'contact burn-out', t: st.t, I_mA: op.I * 1e3, P_mW: op.I * op.I * S.bsRc * 1e3 }); }
  const j = Math.abs(op.Ispec) / (S.thick * 1e-9 * S.bsGap * 1e-6 * 2 * PAD); // A/m² through the film's cross-section
  if (MATERIALS[S.bsMat]?.em && !st.open && j > J_EM) {
    const before = st.em;
    st.em += 0.05 * ((j / J_EM) ** 2 - 1) * dt;
    if (Math.floor(before / 0.25) < Math.floor(st.em / 0.25)) st.events.push({ event: 'electromigration void', t: st.t, j_Am2: j, dR: st.em });
    if (st.em >= 2) { st.open = true; st.events.push({ event: 'electromigration: the line opened', t: st.t }); }
  }
  st.op = { ...op, P, R, T, Epk, j, vSet, gA };
  st.trace.push([op.Vmeas, op.I]);
  if (st.trace.length > 600) st.trace.shift();
  return st;
}
const triangle = (x) => { const f = x - Math.floor(x); return f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4; };

// electrochemistry under liquid: the working (left) electrode sits at +V/2 against the liquid; overpotential
// η = E − E_eq drives deposition (η < 0, needs gold ions in the liquid) or dissolution (η > 0). Butler–Volmer with
// α = ½ at T, as Å of particle radius per second, capped at ±3 Å/s
export function electrochem(Vspec, T, precursor, Eeq = K.p('bv_Eeq')) {
  const f = 96485 / (8.314 * T), eta = Vspec / 2 - Eeq, a = K.p('bv_alpha');
  let r = K.p('bv_i0') * (Math.exp(-a * f * eta) - Math.exp((1 - a) * f * eta));
  if (r > 0 && !precursor) r = 0; // nothing to deposit
  return { eta, rate: Math.max(-3, Math.min(3, r)) };
}
