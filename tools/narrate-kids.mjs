// Record Zip's lines for Electron Explorer (kids/) with ElevenLabs text-to-speech, in each language and voice:
// English (Minnie, Little Dude) and Spanish (Betty, Junior), as set in kids/lines.js (VOICES).
//   ELEVENLABS_API_KEY=sk_... node tools/narrate-kids.mjs [--lang en|es|all] [--voice female|male|all] [--sample] [--force] [--list]
// Writes kids/audio/<lang>/<voice>/<key>.mp3 and kids/audio/manifest.json ("lang/voice/key" -> file); the exhibit
// plays a clip when one exists for a line and falls back to the browser's voice otherwise. Only new or changed
// lines are recorded (a hash of voice + text is kept in hashes.json).
// --list prints the lines and their character counts without calling the API; --sample records only Zip's first
// three lines, to audition the voices cheaply before recording everything.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { allLines, clipId, VOICES } from '../kids/lines.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const pick = (v, all) => (v === 'all' ? all : v.split(','));
const langs = pick(opt('--lang', 'all'), Object.keys(VOICES));
const voices = pick(opt('--voice', 'all'), ['female', 'male']);
const sample = args.includes('--sample'), force = args.includes('--force');
const linesOf = (lang) => (sample ? allLines(lang).slice(0, 3) : allLines(lang));

if (args.includes('--list')) {
  let total = 0;
  for (const lang of langs) { const L = linesOf(lang), n = L.reduce((a, t) => a + t.length, 0); total += n * voices.length;
    for (const t of L) console.log(`${lang}  ${t}`); console.log(`${lang}: ${L.length} lines, ${n} characters per voice`); }
  console.log(`total to record: ${total} characters`); process.exit(0);
}
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('Set ELEVENLABS_API_KEY (or use --list)'); process.exit(1); }

const dir = new URL('../kids/audio/', import.meta.url);
const read = (f, d) => (existsSync(new URL(f, dir)) ? JSON.parse(readFileSync(new URL(f, dir))) : d);
const hashes = read('hashes.json', {}), manifest = read('manifest.json', {});
const save = () => { writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest, null, 1)); writeFileSync(new URL('hashes.json', dir), JSON.stringify(hashes, null, 1)); };

for (const lang of langs) for (const voice of voices) {
  const vid = VOICES[lang]?.[voice]?.id;
  if (!vid) { console.error(`unknown voice ${lang}/${voice}`); process.exit(1); }
  mkdirSync(new URL(`${lang}/${voice}/`, dir), { recursive: true });
  for (const text of linesOf(lang)) {
    const id = clipId(lang, voice, text), file = `${id}.mp3`, h = createHash('sha1').update(vid + text).digest('hex').slice(0, 12);
    if (!force && hashes[id] === h && existsSync(new URL(file, dir))) { manifest[id] = file; continue; }
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_96`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      // low stability and some style: a lively, bouncy delivery
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true } }),
    });
    if (!r.ok) { console.error(`! ${id}: ${r.status} ${await r.text()}`); save(); process.exit(1); }
    writeFileSync(new URL(file, dir), Buffer.from(await r.arrayBuffer()));
    manifest[id] = file; hashes[id] = h; save();
    console.log(`+ ${id}`);
  }
}
// forget clips of lines that no longer exist
if (!sample) {
  const live = new Set(); for (const lang of Object.keys(VOICES)) for (const voice of ['female', 'male']) for (const t of allLines(lang)) live.add(clipId(lang, voice, t));
  for (const id of Object.keys(manifest)) if (!live.has(id)) delete manifest[id];
}
save();
console.log(`${Object.keys(manifest).length} clips in kids/audio/manifest.json`);
