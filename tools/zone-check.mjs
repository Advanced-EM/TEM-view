// Zone-axis check: built-in crystals viewed along any [u v w] (zone.js). Run: node tools/zone-check.mjs
import { defaultState } from '../js/state.js';
import { Sim } from '../js/sim.js';
import * as P from '../js/physics.js';
import * as Z from '../js/zone.js';
import { tiltLimit, specState, lorSet, setState } from '../js/ops.js';
import { toSession, readSession } from '../js/session.js';
import { settingsToOps } from '../js/scripting.js';
import { beamThickness } from '../js/structure.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const make = (id, zone, mode = 'diff', o = {}) => { const S = defaultState(); Object.assign(S, { mode, spec: id, zone, cx: 0, cy: 0, fov: P.SPECIMENS[id].fov }, o); const sim = new Sim(S); sim.update(0.05); return sim; };
const unbar = (s) => { const v = []; for (let i = 0; i < s.length; i++) { if (s[i + 1] === '̅') { v.push(-+s[i]); i++; } else v.push(+s[i]); } return v; };

ok(['sto', 'si', 'au', 'cspb', 'mapb', 'hesi'].every(Z.hasZones) && !Z.hasZones('gr') && !Z.hasZones('bio'), 'zone axes for the cubic crystals (not graphene, not the continuum specimens)');
ok(JSON.stringify(Z.asBuilt('sto')) === '[0,0,1]' && Math.abs(Z.asBuilt('si')[0]) === 1 && Z.asBuilt('si')[2] === 0, `as-built zones: SrTiO₃ ${Z.zoneLabel(Z.asBuilt('sto'))}, Si ${Z.zoneLabel(Z.asBuilt('si'))}`);

// geometry: the spot list of each zone is perpendicular to [u v w], and its d-spacings are a/√(h²+k²+l²)
for (const [id, z] of [['sto', [0, 1, 1]], ['sto', [1, 1, 1]], ['si', [0, 0, 1]], ['si', [1, 1, 2]], ['au', [1, 1, 1]], ['au', [0, 1, 3]], ['cspb', [1, 1, 2]]]) {
  const sim = make(id, z), sp = sim.spec, a = P.CRYST[id].a;
  const rings = sp.rings.map((r) => ({ ...r, h: unbar(r.hkl) }));
  const perp = rings.every((r) => r.h[0] * z[0] + r.h[1] * z[1] + r.h[2] * z[2] === 0);
  const dOK = rings.every((r) => Math.abs(r.d - a / Math.hypot(...r.h)) < 1e-3);
  const L = sim.cbed.lists();
  const zolzPerp = L.zolz.every((q) => q.h * z[0] + q.k * z[1] + q.l * z[2] === 0) && L.zolz.length > 6;
  ok(perp && dOK && zolzPerp && sp.zone === Z.zoneLabel(z), `${id} ${sp.zone}: spots ${rings.slice(0, 3).map((r) => `(${r.hkl}) ${r.d} Å`).join(', ')} ⟂ zone, d = a/√(h²+k²+l²); CBED ZOLZ ${L.zolz.length} reflections ⟂ zone`);
}
// the slab: z along [u v w], thickness = the thickness setting, radius as built
{
  const sim = make('sto', [1, 1, 0], 'tem', { thick: 12 }), sp = sim.spec, P3 = sp.xyz3.P3;
  let zmin = Infinity, zmax = -Infinity, rmax = 0;
  for (let i = 0; i < P3.length; i += 3) { zmin = Math.min(zmin, P3[i + 2]); zmax = Math.max(zmax, P3[i + 2]); rmax = Math.max(rmax, Math.hypot(P3[i], P3[i + 1])); }
  ok(zmax - zmin <= 120 && zmax - zmin > 110 && rmax <= 41, `SrTiO₃ [110] slab: ${((zmax - zmin) / 10).toFixed(1)} nm thick (setting 12 nm), radius ${(rmax / 10).toFixed(1)} nm, ${sp.xyz3.sym.length} atoms`);
  // atoms project onto columns: along [110] SrTiO₃ shows columns at (a√2/2 × a/2) repeats: each projected position is shared
  const cols = new Map(); for (let i = 0; i < P3.length; i += 3) { const k = `${Math.round(P3[i] * 4)},${Math.round(P3[i + 1] * 4)}`; cols.set(k, (cols.get(k) ?? 0) + 1); }
  const mean = sp.xyz3.sym.length / cols.size;
  ok(mean > 10, `atoms stack into columns along the beam: ${cols.size} columns, ${mean.toFixed(0)} atoms each on average`);
}
// SAED: the diffracted signal sits on the rotated crystal's reflections
for (const [id, z] of [['sto', [0, 1, 1]], ['si', [0, 0, 1]], ['au', [1, 1, 1]], ['cspb', [1, 1, 1]]]) {
  const sim = make(id, z, 'diff', { pedOn: true, fov: 5 });
  ok(sim.pedInfo.powerInReflections > 0.55, `${id} ${Z.zoneLabel(z)} SAED: ${(100 * sim.pedInfo.powerInReflections).toFixed(0)} % of the diffracted power on the rotated reflections`);
}
// tilt: ±30° for a zone-axis crystal (the atoms rotate), ±3° as built; the beam path follows t / cos
{
  const S = defaultState(); Object.assign(S, { spec: 'sto' });
  ok(tiltLimit(S) === 3 && tiltLimit({ ...S, zone: [0, 1, 1] }) === 30, 'tilt range: ±3° as built, ±30° along a chosen zone');
  const sim = make('sto', [0, 0, 1], 'tem', { tiltX: 25 });
  const bt = beamThickness(sim.S, sim);
  ok(Math.abs(bt.t_A - 150 / Math.cos((25 * Math.PI) / 180)) < 0.5, `25° off [001]: beam path ${(bt.t_A / 10).toFixed(2)} nm = 15 nm / cos 25°`);
}
// state: sessions, scripts, specimen change
{
  const S = defaultState(); Object.assign(S, { spec: 'si', zone: [1, 1, 2] });
  const r = readSession(JSON.parse(JSON.stringify(toSession(S))));
  ok(JSON.stringify(r.state.zone) === '[1,1,2]' && readSession({ format: 'tem-view-session/2', state: { ...S, zone: [0, 0, 0] } }).state.zone === null, 'session: zone saved; an invalid zone loads as built');
  ok(settingsToOps({ zone_axis: [0, 1, 1] }).some((o) => o.k === 'zone') && settingsToOps({ zone_axis: null }).some((o) => o.k === 'zone' && o.v === null), 'scripts: zone_axis=[u, v, w] or None');
  const T = defaultState(), sim = new Sim(T), set = (k, v, inv) => setState(T, sim, k, v, inv);
  lorSet(T, set, { op: 'set', k: 'zone', v: [1, 1, 1] });
  ok(JSON.stringify(T.zone) === '[1,1,1]' && T.cx === 0 && T.tiltX === 0, 'set zone: centred, untilted');
  specState(T, sim, 'au');
  ok(T.zone === null, 'a new specimen starts as built');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
