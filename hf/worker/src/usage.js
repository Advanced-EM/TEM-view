// Usage metrics ("tem-view-usage/1"): one record per page visit, sent by js/usage.js while the page is open and
// replaced each time (the last one holds the whole visit). The Worker adds the coarse location Cloudflare derives
// from the connection (country, region, city, coordinates to 0.1°, time zone) and stores the record in D1; a daily
// cron commits the previous day as JSON Lines to the private usage dataset. The IP address itself is never stored:
// `visitor` is an HMAC of the IP with a secret salt and the date, so one person's visits can be counted within a day
// but not followed across days or turned back into an address. Without the USAGE_SALT secret it is left empty.

export const USAGE_FORMAT = 'tem-view-usage/1';
export const USAGE_MAX_BYTES = 16_000;
const PAGES = new Set(['tem-view', 'ruska', 'scanning']);
const DEVICES = new Set(['phone', 'tablet', 'desktop']);
const INPUTS = new Set(['mouse', 'touch', 'pen', 'keyboard', 'gamepad', 'panel', 'voice', 'agent']);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const KEY_RE = /^[A-Za-z0-9_.-]{1,32}$/;

export class Invalid extends Error {}
const fail = (m) => { throw new Invalid(m); };
const int = (v, name, max) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : fail(`${name}: not a count`));
const word = (v, n = 40) => (typeof v === 'string' ? v.replace(/[^\w .:/-]/g, '').slice(0, n) : '');

// { key: number } with at most 60 short keys; seconds or counts
function tally(d, name, max = 86_400) {
  if (d == null) return {};
  if (typeof d !== 'object' || Array.isArray(d) || Object.keys(d).length > 60) fail(`${name}: expected a small object`);
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (!KEY_RE.test(k)) fail(`${name}: bad key`);
    out[k] = int(v, `${name}.${k}`, max);
  }
  return out;
}

// a sanitized copy of what the browser sent, or throws Invalid
export function cleanUsage(u) {
  if (!u || typeof u !== 'object' || u.format !== USAGE_FORMAT) fail('not a tem-view-usage/1 record');
  if (!ID_RE.test(u.id ?? '')) fail('bad id');
  if (!PAGES.has(u.page)) fail('unknown page');
  const started = new Date(u.started);
  if (Number.isNaN(+started) || Math.abs(Date.now() - started) > 2 * 86_400_000) fail('bad start time');
  started.setUTCSeconds(0, 0); // to the minute
  return {
    format: USAGE_FORMAT, id: u.id, page: u.page, version: word(u.version, 20), seq: int(u.seq, 'seq', 1e6),
    started: started.toISOString(), duration_s: int(u.duration_s, 'duration_s', 86_400), active_s: int(u.active_s, 'active_s', 86_400),
    lang: word(u.lang, 12), device: DEVICES.has(u.device) ? u.device : 'desktop',
    screen: Array.isArray(u.screen) ? u.screen.slice(0, 2).map((v, i) => int(v, `screen.${i}`, 10_000)) : [],
    referrer: word(u.referrer, 80), kiosk: !!u.kiosk,
    inputs: Array.isArray(u.inputs) ? [...new Set(u.inputs.filter((s) => INPUTS.has(s)))] : [],
    time: Object.fromEntries(Object.entries(u.time ?? {}).slice(0, 4).filter(([k]) => KEY_RE.test(k)).map(([k, v]) => [k, tally(v, `time.${k}`)])),
    counts: tally(u.counts, 'counts', 100_000),
  };
}

// the location Cloudflare attaches to the request (request.cf); coordinates rounded to about 10 km
export function place(cf = {}) {
  const r1 = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : Math.round(+v * 10) / 10);
  return { country: cf.country ?? null, region: cf.region ?? null, city: cf.city ?? null, lat: r1(cf.latitude), lon: r1(cf.longitude), timezone: cf.timezone ?? null, continent: cf.continent ?? null };
}

export async function visitorKey(ip, salt, day) {
  if (!salt || !ip) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${day}:${ip}`));
  return [...new Uint8Array(mac).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// D1: one row per visit, replaced by each newer report of it (seq only grows)
export async function storeUsage(db, rec) {
  await db.prepare(`INSERT INTO usage (id, day, seq, record) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, record = excluded.record WHERE excluded.seq >= usage.seq`)
    .bind(rec.id, rec.started.slice(0, 10), rec.seq, JSON.stringify(rec)).run();
}

// the previous day's visits as JSON Lines, for the daily commit; rows older than KEEP_DAYS are dropped
export const KEEP_DAYS = 90;
export async function dayLines(db, day) {
  const { results } = await db.prepare('SELECT record FROM usage WHERE day = ?1 ORDER BY id').bind(day).all();
  return results.map((r) => r.record).join('\n');
}
export async function prune(db, now = new Date()) {
  const cut = new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  await db.prepare('DELETE FROM usage WHERE day < ?1').bind(cut).run();
}
