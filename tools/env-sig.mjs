// per mode × holder: a checksum of the collected arrays (export.collectData), deterministic settings
const root = process.argv[2];
const { defaultState } = await import(`${root}/js/state.js`);
const { Sim } = await import(`${root}/js/sim.js`);
const { collectData } = await import(`${root}/js/export.js`);
const modes = ['tem', 'stem', 'diff', 'cbed', '4d', 'eds', 'eels', 'ronch', 'oah', 'ilh', 'ltem', 'lstem', 'ed3d', 'tomo'];
const out = {};
Math.random = (() => { let s = 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
for (const holder of ['room', 'ln2', 'lhe', 'heat']) for (const mode of modes) {
  let s = 1; Math.random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const S = defaultState(); S.mode = mode; S.holder = holder; S.tempSet = { room: 293, ln2: 90, lhe: 4.2, heat: 293 }[holder]; S.clarity = 'edu';
  const sim = new Sim(S);
  for (let i = 0; i < (mode === '4d' ? 400 : mode === 'ilh' ? 60 : 6); i++) sim.update(0.05);
  const d = collectData(sim, S);
  let h = 0, n = 0;
  for (const [k, a] of Object.entries(d.arrays)) { const v = a.data; if (!v?.length) continue; for (let i = 0; i < v.length; i += Math.max(1, (v.length / 4000) | 0)) { h += (Number.isFinite(v[i]) ? v[i] : 0) * ((i % 97) + 1); n++; } }
  out[`${holder}/${mode}`] = [Object.keys(d.arrays).sort().join(','), +h.toPrecision(10), n];
}
console.log(JSON.stringify(out));
