// Offline test of the Worker: validation, CORS, dry run, and the Hub commit it would make (fetch is mocked).
import worker from './src/index.js';
import { readFileSync } from 'node:fs';

const sample = readFileSync(new URL('../../tools/analysis/sample/tem-focus-stig-example.json', import.meta.url), 'utf8');
const env = { DATASET_REPO: 'rmsreis/tem-view-alignment', HF_TOKEN: 'test-token', ALLOWED_ORIGINS: 'http://localhost:8765' };
const post = (body, origin = 'http://localhost:8765', e = env) => worker.fetch(new Request('https://x.workers.dev/submit', { method: 'POST', body, headers: { origin, 'content-type': 'text/plain' } }), e);
let calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); };
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

let r = await post(sample);
ok(r.status === 200 && (await r.json()).ok, 'valid session accepted');
ok(r.headers.get('access-control-allow-origin') === 'http://localhost:8765', 'CORS header for the exhibit');
const c = calls[0], lines = c.init.body.split('\n').map((l) => JSON.parse(l));
ok(c.url === 'https://huggingface.co/api/datasets/rmsreis/tem-view-alignment/commit/main', 'commits to the dataset');
ok(c.init.headers.authorization === 'Bearer test-token', 'uses the secret token');
ok(lines[1].value.path === 'raw/tem-focus-stig/2a3f8e58-b31e-450f-b9c8-4aafa63367f7.json', 'raw/<scenario>/<id>.json');
const stored = JSON.parse(Buffer.from(lines[1].value.content, 'base64').toString());
ok(stored.session.started === '2026-10-15T22:00:00Z' && stored.session.screen[0] === 1400, 'time to the hour, coarse screen');
const bad = JSON.parse(sample); bad.session.consent = false;
ok((await post(JSON.stringify(bad))).status === 422, 'no consent rejected');
ok((await post('nope')).status === 422, 'garbage rejected');
ok((await post(sample, 'https://evil.example')).status === 403, 'foreign origin refused');
calls = [];
r = await post(sample, 'http://localhost:8765', { ...env, HF_TOKEN: '' });
ok((await r.json()).dry_run === true && calls.length === 0, 'dry run without a token stores nothing');
globalThis.fetch = async () => new Response('nope', { status: 403 });
ok((await post(sample)).status === 502, 'hub failure reported');
r = await worker.fetch(new Request('https://x.workers.dev/'), env);
ok((await r.json()).dry_run === false, 'status page');

// mailing list
const kv = new Map(), kvEnv = { ...env, SUBSCRIBERS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) } };
const sub = (body, e = kvEnv, origin = 'http://localhost:8765') => worker.fetch(new Request('https://x.workers.dev/subscribe', { method: 'POST', body: JSON.stringify(body), headers: { origin } }), e);
const who = { name: 'Ada Lovelace', institution: 'Northwestern University', role: 'Faculty' };
r = await sub({ email: ' Ada@Example.org ', ...who });
const rec = JSON.parse(kv.get('email:ada@example.org') ?? '{}');
ok(r.status === 200 && rec.email === 'ada@example.org' && rec.name === 'Ada Lovelace' && rec.institution === 'Northwestern University' && rec.role === 'faculty', 'subscribe stores address, name, institution and role');
ok((await sub({ email: 'b@example.org', name: 'B', role: 'hobbyist' })).status === 200, 'institution is optional');
ok((await sub({ email: 'c@example.org', role: 'student' })).status === 422, 'name is required');
ok((await sub({ email: 'd@example.org', name: 'D', role: 'astronaut' })).status === 422, 'role must be one of the four');
ok((await (await sub({ email: 'ada@example.org', ...who })).json()).already === true, 'second subscribe is acknowledged, not duplicated');
ok((await sub({ email: 'not-an-email', ...who })).status === 422, 'bad address rejected');
r = await sub({ email: 'bot@example.org', ...who, website: 'http://spam' });
ok(r.status === 200 && !kv.has('email:bot@example.org'), 'honeypot: bots get ok but nothing is stored');
ok((await sub({ email: 'x@example.org' }, kvEnv, 'https://evil.example')).status === 403, 'subscribe from a foreign origin refused');
ok((await sub({ email: 'x@example.org' }, env)).status === 503, 'no KV binding: 503');

// usage metrics (D1 mocked: the three statements usage.js runs)
import { exportUsage } from './src/index.js';
const rows = new Map(), kdays = new Map();
const kioskAll = async () => ({ results: [...kdays.values()].sort((x, y) => (x.kiosk + x.day < y.kiosk + y.day ? -1 : 1)) });
const db = {
  prepare: (sql) => ({
    bind: (...a) => ({
      run: async () => {
        if (sql.includes('INTO kiosk_days')) { const [kiosk, day, site, version, place, totals, updated] = a; kdays.set(`${kiosk}|${day}`, { kiosk, day, site, version, place, totals, updated }); return; }
        if (sql.startsWith('INSERT')) { const [id, day, seq, record] = a, old = rows.get(id); if (!old || seq >= old.seq) rows.set(id, { id, day, seq, record }); }
        if (sql.startsWith('DELETE')) for (const [id, r] of rows) if (r.day < a[0]) rows.delete(id);
      },
      all: async () => ({ results: [...rows.values()].filter((r) => r.day === a[0]).sort((x, y) => (x.id < y.id ? -1 : 1)) }),
    }),
    all: kioskAll,
  }),
  batch: async (stmts) => { for (const st of stmts) await st.run(); },
};
const uEnv = { ...env, USAGE_DB: db, USAGE_REPO: 'rmsreis/tem-view-usage', USAGE_SALT: 'salt' };
const visit = (o = {}) => ({ format: 'tem-view-usage/1', id: 'visit-0001', page: 'tem-view', version: '202611031200', seq: 1, started: new Date().toISOString(),
  duration_s: 61, active_s: 55, lang: 'de-DE', device: 'desktop', screen: [1500, 900], referrer: 'www.google.com', inputs: ['mouse', 'keyboard'],
  time: { mode: { tem: 40, stem: 15 }, specimen: { sto: 55 } }, counts: { acquire: 2 }, ...o });
const report = (body, e = uEnv, cf = { country: 'DE', region: 'Bavaria', city: 'Nuremberg', latitude: '49.45421', longitude: '11.07752', timezone: 'Europe/Berlin', continent: 'EU' }) => {
  const q = new Request('https://x.workers.dev/usage', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { origin: 'http://localhost:8765', 'cf-connecting-ip': '203.0.113.7' } });
  Object.defineProperty(q, 'cf', { value: cf });
  return worker.fetch(q, e);
};
r = await report(visit());
let row = JSON.parse(rows.get('visit-0001')?.record ?? '{}');
ok(r.status === 204 && row.city === 'Nuremberg' && row.country === 'DE' && row.lat === 49.5 && row.lon === 11.1, 'usage stored with city and coordinates to 0.1°');
ok(!JSON.stringify(row).includes('203.0.113.7') && /^[0-9a-f]{16}$/.test(row.visitor), 'no IP stored, only the salted daily visitor key');
ok(row.started.endsWith(':00.000Z') && row.time.mode.tem === 40 && row.counts.acquire === 2, 'start to the minute, time and counts kept');
await report(visit({ seq: 3, duration_s: 200 })); await report(visit({ seq: 2, duration_s: 120 }));
ok(JSON.parse(rows.get('visit-0001').record).duration_s === 200, 'a later report replaces the visit, an older one does not');
ok((await report(visit({ page: 'kids' }))).status === 422, 'unknown page (Kids is not counted) rejected');
ok((await report(visit({ time: { mode: { 'bad key!': 1 } } }))).status === 422, 'bad keys rejected');
ok((await report('x'.repeat(20_000))).status === 413, 'oversized record rejected');
ok((await report(visit({ seq: 9 }), { ...uEnv, USAGE_SALT: '' })).status === 204 && JSON.parse(rows.get('visit-0001').record).visitor === null, 'no salt: no visitor key');
ok((await report(visit(), env)).status === 204, 'no database: accepted, nothing stored');
calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); };
const today = new Date().toISOString().slice(0, 10);
await exportUsage(uEnv, new Date(Date.parse(today) + 86_400_000 + 3_600_000));
const exp = calls[0], el = exp?.init.body.split('\n').map((l) => JSON.parse(l));
ok(exp?.url === 'https://huggingface.co/api/datasets/rmsreis/tem-view-usage/commit/main' && el[1].value.path === `usage/${today.slice(0, 4)}/${today}.jsonl`, 'daily export commits usage/<year>/<day>.jsonl to the usage dataset');
ok(JSON.parse(Buffer.from(el[1].value.content, 'base64').toString().trim()).city === 'Nuremberg', 'export holds the visits');
await exportUsage(uEnv, new Date(Date.now() + 100 * 86_400_000));
ok(rows.size === 0, 'rows older than 90 days are dropped');

// Electron Explorer kiosk totals
const kiosk = (body, origin = 'http://localhost:8000', e = uEnv) => worker.fetch(Object.assign(new Request('https://x.workers.dev/kiosk', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { origin, 'cf-connecting-ip': '203.0.113.9' } }), { cf: { country: 'US', region: 'Illinois', city: 'Chicago', latitude: '41.88', longitude: '-87.63', timezone: 'America/Chicago' } }), e);
const kday = new Date().toISOString().slice(0, 10);
const totals = { sessions: 12, dwell: 1800, engaged: 9, bins: [2, 2, 3, 3, 1, 1], hours: Array.from({ length: 24 }, (_, h) => (h === 10 ? 12 : 0)), missions: { beam: 11, 'pack:diatom': 2 }, langs: { en: 9, es: 3 }, inputs: { touch: 12 }, junk: 5 };
const rep = (o = {}) => ({ format: 'electron-explorer-kiosk/1', kiosk: 'kiosk-a1b2c3d4', site: 'Science Center <b>Lobby</b>', version: '202611141559', days: { [kday]: totals }, ...o });
r = await kiosk(rep());
let kd = kdays.get(`kiosk-a1b2c3d4|${kday}`), kt = JSON.parse(kd?.totals ?? '{}'), kp = JSON.parse(kd?.place ?? '{}');
ok(r.status === 200 && kt.sessions === 12 && kt.missions['pack:diatom'] === 2 && kt.hours[10] === 12, 'kiosk totals stored per kiosk and day');
ok(r.headers.get('access-control-allow-origin') === 'http://localhost:8000', 'a kiosk on a local copy may send');
ok(kt.junk === undefined && kd.site === 'Science Center bLobby/b', 'unknown fields dropped, site name cleaned');
ok(kp.city === 'Chicago' && kp.lat === undefined, 'the town, no coordinates');
r = await kiosk(rep({ days: { [kday]: { ...totals, sessions: 15 } } }));
ok(kdays.size === 1 && JSON.parse(kdays.get(`kiosk-a1b2c3d4|${kday}`).totals).sessions === 15, 'a resent day replaces the old totals');
ok((await kiosk(rep({ kiosk: 'x' }))).status === 422, 'bad kiosk id rejected');
ok((await kiosk(rep({ days: { '1999-01-01': totals } }))).status === 422, 'day out of range rejected');
ok((await kiosk(rep({ days: { [kday]: { ...totals, bins: [1, 2] } } }))).status === 422, 'malformed totals rejected');
ok((await kiosk(rep(), 'https://evil.example')).status === 403, 'foreign origin refused for kiosks too');
ok((await post(sample, 'http://localhost:8000')).status === 403, 'local origins only for /kiosk');
calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); };
await exportUsage(uEnv, new Date(Date.now() + 86_400_000));
const snap = calls.map((c) => c.init.body.split('\n').map((l) => JSON.parse(l))).find((l) => l[1].value.path === 'kiosk/kiosk_days.jsonl');
const line = snap && JSON.parse(Buffer.from(snap[1].value.content, 'base64').toString().trim().split('\n')[0]);
ok(line?.kiosk === 'kiosk-a1b2c3d4' && line.totals.sessions === 15 && line.place.city === 'Chicago', 'daily snapshot committed to kiosk/kiosk_days.jsonl');
