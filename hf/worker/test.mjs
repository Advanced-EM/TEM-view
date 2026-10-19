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
r = await sub({ email: ' Ada@Example.org ' });
ok(r.status === 200 && (await r.json()).ok && JSON.parse(kv.get('email:ada@example.org')).email === 'ada@example.org', 'subscribe stores the lowercased address');
ok((await (await sub({ email: 'ada@example.org' })).json()).already === true, 'second subscribe is acknowledged, not duplicated');
ok((await sub({ email: 'not-an-email' })).status === 422, 'bad address rejected');
r = await sub({ email: 'bot@example.org', website: 'http://spam' });
ok(r.status === 200 && !kv.has('email:bot@example.org'), 'honeypot: bots get ok but nothing is stored');
ok((await sub({ email: 'x@example.org' }, kvEnv, 'https://evil.example')).status === 403, 'subscribe from a foreign origin refused');
ok((await sub({ email: 'x@example.org' }, env)).status === 503, 'no KV binding: 503');
