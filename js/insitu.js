// In situ time series (M17): a timeline of environment changes and the movie that records them. Pure functions:
// sim.js records the frames (drift, processes, the timeline applied at each frame's time), footprint.js sizes the
// full-scale acquisition, export.js writes the frames with their per-frame metadata.
//
// Timeline: a list of ramps { key, t0, t1, to } (s, s, value): from whatever the quantity is at t0 (the value before
// the movie, or the end of the previous ramp) linearly to `to` at t1, then held. Quantities: the heater setpoint
// (K), the gas pressure (mbar), the bias voltage (V) and the liquid cell's dose rate (e⁻/Å²/s).
//
// Thermal drift: a temperature ramp expands the holder and the chip, so the specimen drifts while the temperature
// changes, ~DRIFT_PER_KS Å/s for each K/s of ramp rate (MEMS heaters are low-drift; furnace holders far worse).

export const QUANTITIES = {
  tempSet: { label: 'Temperature setpoint', unit: 'K', min: 4.2, max: 1473, def: 773 },
  gcP: { label: 'Gas pressure', unit: 'mbar', min: 0.01, max: 2000, def: 100 },
  bsV: { label: 'Bias voltage', unit: 'V', min: -20, max: 20, def: 2 },
  lcRate: { label: 'Dose rate (liquid)', unit: 'e⁻/Å²/s', min: 0.01, max: 1000, def: 10 },
  gcGas: { label: 'Gas (switch)', unit: '', choices: ['H2', 'O2', 'N2', 'CO', 'H2O', 'Ar'], def: 'O2' }, // a step at t0
};
export const FPS = [1, 2, 5, 10, 25, 50, 100];
// the designed experiments (tools/insitu/EXPERIMENTS.md), as starting points for your own
export const PRESETS = [
  ['E1-static', 'E1 Radiolysis: bubbles in a static cell'], ['E1-flow', 'E1 Radiolysis: bubbles in a flow cell'], ['E2', 'E2 Gold growth against dose rate'],
  ['E3-O2', 'E3 Sintering in oxygen'], ['E3-N2', 'E3 Sintering in nitrogen'], ['E4', 'E4 How much gas can the image take?'], ['E5', 'E5 Redox cycling of SrTiO₃'],
  ['E6', 'E6 Helium bubbles in silicon on annealing'], ['E7', 'E7 The field across a biased gap'], ['E8', 'E8 Electrochemistry: deposit, then strip'],
];
export const MAX_FRAMES = 240; // kept in the browser; longer movies keep every k-th frame (the estimator sizes all)
export const DRIFT_PER_KS = 0.05; // Å/s of drift per K/s of temperature ramp

// the value of `key` at time t (s) from the movie's start; base: its value before the movie
export function valueAt(timeline, key, t, base) {
  let v = base;
  for (const s of (timeline ?? []).filter((x) => x.key === key).sort((a, b) => a.t0 - b.t0)) {
    if (t < s.t0) break;
    if (QUANTITIES[key]?.choices) { v = s.to; continue; } // a switch: a step at t0
    const v0 = v;
    v = t >= s.t1 || s.t1 <= s.t0 ? s.to : v0 + ((s.to - v0) * (t - s.t0)) / (s.t1 - s.t0);
  }
  return v;
}
// all timeline quantities at t
export const envAt = (timeline, t, base) => Object.fromEntries(Object.keys(QUANTITIES).map((k) => [k, valueAt(timeline, k, t, base[k])]));
// the rate of change of `key` at t (per s), from a small central difference
export const rateAt = (timeline, key, t, base, h = 1e-3) => QUANTITIES[key]?.choices ? 0 : (valueAt(timeline, key, t + h, base) - valueAt(timeline, key, Math.max(0, t - h), base)) / (t > h ? 2 * h : h);

// the plan of a movie: frames, the decimation for the browser, the frame interval
export function moviePlan(duration_s, fps) {
  const frames = Math.max(1, Math.round(duration_s * fps)), every = Math.max(1, Math.ceil(frames / MAX_FRAMES));
  return { duration_s, fps, frames, every, kept: Math.ceil(frames / every), dt: 1 / fps };
}
// a timeline as text, for notes and metadata
export function describe(timeline) {
  if (!timeline?.length) return 'no environment changes';
  return timeline.map((s) => (QUANTITIES[s.key]?.choices ? `${QUANTITIES[s.key].label} to ${s.to} at ${s.t0} s` : `${QUANTITIES[s.key]?.label ?? s.key} → ${s.to} ${QUANTITIES[s.key]?.unit ?? ''} over ${s.t0}–${s.t1} s`)).join('; ');
}
