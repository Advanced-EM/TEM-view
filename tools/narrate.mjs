// Generate narration clips with ElevenLabs text-to-speech.
//   ELEVENLABS_API_KEY=... node tools/narrate.mjs [--voice <voice_id>] [--force] [id ...]
// Writes audio/narration/<slug>.mp3 and manifest.json (id -> file). Only changed scripts are
// regenerated: a hash of each script is kept in the manifest's sidecar, hashes.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NARRATION, slug } from '../js/narration.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const voice = opt('--voice', process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'); // "George", warm British narrator
const force = args.includes('--force'); if (force) args.splice(args.indexOf('--force'), 1);
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('Set ELEVENLABS_API_KEY'); process.exit(1); }

const dir = new URL('../audio/narration/', import.meta.url);
mkdirSync(dir, { recursive: true });
const read = (f, d) => (existsSync(new URL(f, dir)) ? JSON.parse(readFileSync(new URL(f, dir))) : d);
const manifest = read('manifest.json', {}), hashes = read('hashes.json', {});

const ids = args.length ? args : Object.keys(NARRATION);
for (const id of ids) {
  const text = NARRATION[id];
  if (!text) { console.warn(`unknown id: ${id}`); continue; }
  const h = createHash('sha1').update(voice + text).digest('hex').slice(0, 12);
  const file = `${slug(id)}.mp3`;
  if (!force && hashes[id] === h && existsSync(new URL(file, dir))) { console.log(`= ${id}`); continue; }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_96`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15 } }),
  });
  if (!r.ok) { console.error(`! ${id}: ${r.status} ${await r.text()}`); process.exit(1); }
  writeFileSync(new URL(file, dir), Buffer.from(await r.arrayBuffer()));
  manifest[id] = file; hashes[id] = h;
  writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest, null, 1));
  writeFileSync(new URL('hashes.json', dir), JSON.stringify(hashes, null, 1));
  console.log(`+ ${id} -> ${file}`);
}
