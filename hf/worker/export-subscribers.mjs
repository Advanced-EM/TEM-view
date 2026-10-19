// Exports the news mailing list (SUBSCRIBERS KV) as CSV: email, name, institution, role, subscribed, source.
//   node export-subscribers.mjs > subscribers.csv          (the live list; needs `npx wrangler login`)
//   node export-subscribers.mjs --local                    (the list kept by `wrangler dev`)
// The CSV holds personal data: keep it private and out of the repository.
import { execFileSync } from 'node:child_process';

const where = process.argv.includes('--local') ? '--local' : '--remote';
const wr = (...a) => execFileSync('npx', ['wrangler', 'kv', ...a, '--binding', 'SUBSCRIBERS', where], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const keys = JSON.parse(wr('key', 'list', '--prefix', 'email:')).map((k) => k.name);
const cols = ['email', 'name', 'institution', 'role', 'subscribed', 'source'];
const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
console.log(cols.join(','));
for (const k of keys) {
  let r; try { r = JSON.parse(wr('key', 'get', k)); } catch { r = { email: k.slice(6) }; }
  console.log(cols.map((c) => cell(r[c])).join(','));
}
console.error(`${keys.length} subscriber(s)`);
