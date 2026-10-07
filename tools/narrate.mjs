// Generate narration clips with ElevenLabs text-to-speech.
//   ELEVENLABS_API_KEY=... node tools/narrate.mjs [--voice female|male|all] [--level general|physics|all] [--force] [id ...]
// Writes audio/narration/<voice>/<level>/<slug>.mp3 and manifest.json ("voice/level/id" -> file).
// Only changed scripts are regenerated: a hash of voice + script is kept in hashes.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NARRATION, VOICES, slug } from '../js/narration.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const pick = (v, all) => (v === 'all' ? all : v.split(','));
const voices = pick(opt('--voice', 'all'), Object.keys(VOICES));
const levels = pick(opt('--level', 'all'), Object.keys(NARRATION));
const force = args.includes('--force'); if (force) args.splice(args.indexOf('--force'), 1);
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('Set ELEVENLABS_API_KEY'); process.exit(1); }

const dir = new URL('../audio/narration/', import.meta.url);
const read = (f, d) => (existsSync(new URL(f, dir)) ? JSON.parse(readFileSync(new URL(f, dir))) : d);
const manifest = read('manifest.json', {}), hashes = read('hashes.json', {});
const save = () => {
  writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest, null, 1));
  writeFileSync(new URL('hashes.json', dir), JSON.stringify(hashes, null, 1));
};

for (const voice of voices) for (const level of levels) {
  const vid = VOICES[voice]?.id, scripts = NARRATION[level];
  if (!vid || !scripts) { console.error(`unknown voice/level: ${voice}/${level}`); process.exit(1); }
  mkdirSync(new URL(`${voice}/${level}/`, dir), { recursive: true });
  for (const id of args.length ? args : Object.keys(scripts)) {
    const text = scripts[id];
    if (!text) { console.warn(`unknown id: ${id}`); continue; }
    const k = `${voice}/${level}/${id}`, file = `${voice}/${level}/${slug(id)}.mp3`;
    const h = createHash('sha1').update(vid + text).digest('hex').slice(0, 12);
    if (!force && hashes[k] === h && existsSync(new URL(file, dir))) { console.log(`= ${k}`); continue; }
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_96`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15 } }),
    });
    if (!r.ok) { console.error(`! ${k}: ${r.status} ${await r.text()}`); save(); process.exit(1); }
    writeFileSync(new URL(file, dir), Buffer.from(await r.arrayBuffer()));
    manifest[k] = file; hashes[k] = h;
    save();
    console.log(`+ ${k}`);
  }
}
