// Electron Explorer kiosk totals ("electron-explorer-kiosk/1"): a museum kiosk whose staff turned on sharing sends
// its anonymous daily totals (kids/visits.js: counts per day, never single visits) for the days that changed. The
// Worker keeps the latest totals per kiosk and day in D1 (kiosk_days), with the kiosk's coarse location (the
// museum's, from Cloudflare), and the daily cron commits a snapshot of the whole table to the usage dataset as
// kiosk/kiosk_days.jsonl. No IP address is stored; the kiosk id is a random id the kiosk made for itself.

export const KIOSK_FORMAT = 'electron-explorer-kiosk/1';
export const KIOSK_MAX_BYTES = 64_000;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
const NUMS = ['sessions', 'dwell', 'engaged', 'beam', 'allMissions', 'snaps', 'prints', 'qr', 'hints', 'whats', 'parts', 'cooked', 'read', 'a11y'];
const ARRAYS = { bins: 6, hours: 24 };
const TALLIES = ['missions', 'reached', 'langs', 'samples', 'a11yOpts', 'inputs'];

export class Invalid extends Error {}
const fail = (m) => { throw new Invalid(m); };
const int = (v, name, max = 10_000_000) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : fail(`${name}: not a count`));
const word = (v, n) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .,:'()/&-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, n) : '');

function tally(d, name) {
  if (d == null) return {};
  if (typeof d !== 'object' || Array.isArray(d) || Object.keys(d).length > 60) fail(`${name}: expected a small object`);
  const out = {};
  for (const [k, v] of Object.entries(d)) { if (!KEY_RE.test(k)) fail(`${name}: bad key`); out[k] = int(v, `${name}.${k}`); }
  return out;
}
// one day's totals, keeping only the known fields
function cleanDay(d, day) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail(`${day}: expected totals`);
  const out = {};
  for (const k of NUMS) if (d[k] != null) out[k] = int(d[k], `${day}.${k}`);
  for (const [k, n] of Object.entries(ARRAYS)) if (d[k] != null) {
    if (!Array.isArray(d[k]) || d[k].length !== n) fail(`${day}.${k}: expected ${n} counts`);
    out[k] = d[k].map((v, i) => int(v, `${day}.${k}.${i}`));
  }
  for (const k of TALLIES) if (d[k] != null) out[k] = tally(d[k], `${day}.${k}`);
  if (!out.sessions) fail(`${day}: no visits`);
  return out;
}

// a sanitized copy of what the kiosk sent, or throws Invalid
export function cleanKiosk(b, now = new Date()) {
  if (!b || typeof b !== 'object' || b.format !== KIOSK_FORMAT) fail(`not an ${KIOSK_FORMAT} report`);
  if (!ID_RE.test(b.kiosk ?? '')) fail('bad kiosk id');
  if (!b.days || typeof b.days !== 'object' || Array.isArray(b.days)) fail('no days');
  const entries = Object.entries(b.days);
  if (!entries.length || entries.length > 62) fail('expected 1 to 62 days');
  const lo = new Date(now - 400 * 86_400_000).toISOString().slice(0, 10), hi = new Date(+now + 2 * 86_400_000).toISOString().slice(0, 10);
  const days = {};
  for (const [day, d] of entries) {
    if (!DAY_RE.test(day) || day < lo || day > hi) fail(`bad day ${day.slice(0, 12)}`);
    days[day] = cleanDay(d, day);
  }
  return { format: KIOSK_FORMAT, kiosk: b.kiosk, site: word(b.site, 60), version: word(b.version, 20), days };
}

// D1: the latest totals per kiosk and day (a kiosk resends a day each time it changes)
export async function storeKiosk(db, rec, where, updated = new Date().toISOString()) {
  const stmt = db.prepare(`INSERT INTO kiosk_days (kiosk, day, site, version, place, totals, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(kiosk, day) DO UPDATE SET site = excluded.site, version = excluded.version, place = excluded.place, totals = excluded.totals, updated = excluded.updated`);
  await db.batch(Object.entries(rec.days).map(([day, t]) => stmt.bind(rec.kiosk, day, rec.site, rec.version, JSON.stringify(where), JSON.stringify(t), updated)));
}

// the whole table as JSON Lines, one kiosk-day per line, for the daily snapshot
export async function kioskLines(db) {
  const { results } = await db.prepare('SELECT kiosk, day, site, version, place, totals, updated FROM kiosk_days ORDER BY kiosk, day').all();
  return results.map((r) => JSON.stringify({ format: 'electron-explorer-kiosk-day/1', kiosk: r.kiosk, site: r.site, day: r.day, version: r.version, updated: r.updated,
    place: JSON.parse(r.place || '{}'), totals: JSON.parse(r.totals) })).join('\n');
}
