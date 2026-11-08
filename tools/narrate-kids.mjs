// Record Zip's lines for Electron Explorer (kids/) with ElevenLabs text-to-speech, in each language and voice as
// set in kids/lines.js (VOICES, MODEL): English (Minnie, Little Dude) and Spanish (Betty, Junior) with Multilingual v2;
// Portuguese, French and German with Flash v2.5 (half the credits per character). Voices without an id are skipped.
// The lines of the sample packs in kids/packs/ are included.
//   ELEVENLABS_API_KEY=sk_... node tools/narrate-kids.mjs [--lang en,es,…|all] [--voice female|male|all] [--sample] [--force] [--list]
// Writes kids/audio/<lang>/<voice>/<key>.mp3 and kids/audio/manifest.json ("lang/voice/key" -> file); the exhibit
// plays a clip when one exists for a line and falls back to the browser's voice otherwise. Only new or changed
// lines are recorded (a hash of voice, model and text is kept in hashes.json).
// --list prints the lines still to record and their character count without calling the API; --sample records
// only Zip's first three lines, to audition a voice cheaply.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { allLines, clipId, VOICES, MODEL, sampleName, needsSample, lookingAt, nextMission } from '../kids/lines.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const pick = (v, all) => (v === 'all' ? all : v.split(','));
const langs = pick(opt('--lang', 'all'), Object.keys(VOICES));
const voices = pick(opt('--voice', 'all'), ['female', 'male']);
const sample = args.includes('--sample'), force = args.includes('--force');

// what Zip says about each installed sample pack
const packs = new URL('../kids/packs/', import.meta.url);
const packMsgs = [];
if (existsSync(new URL('index.json', packs))) for (const e of JSON.parse(readFileSync(new URL('index.json', packs)))) {
  const p = JSON.parse(readFileSync(new URL(e.path ?? `${e.id}/pack.json`, packs)));
  packMsgs.push(sampleName(p), p.blurb, needsSample(p.name), ...[p.what, ...(p.regions ?? []).map((r) => r.what)].filter(Boolean).map(lookingAt));
  if (p.mission) packMsgs.push(nextMission(p.mission.title), p.mission.text, p.mission.win);
}
const linesOf = (lang) => (sample ? allLines(lang).slice(0, 3) : allLines(lang, packMsgs));

const dir = new URL('../kids/audio/', import.meta.url);
const read = (f, d) => (existsSync(new URL(f, dir)) ? JSON.parse(readFileSync(new URL(f, dir))) : d);
const hashes = read('hashes.json', {}), manifest = read('manifest.json', {});
// English and Spanish clips were hashed before models varied: Multilingual v2 adds nothing to the hash
const hashOf = (vid, model, text) => createHash('sha1').update(vid + text + (model === 'eleven_multilingual_v2' ? '' : model)).digest('hex').slice(0, 12);
const todo = (lang, voice) => { const vid = VOICES[lang][voice].id; return linesOf(lang).filter((t) => { const id = clipId(lang, voice, t); return force || hashes[id] !== hashOf(vid, MODEL[lang], t) || !existsSync(new URL(`${id}.mp3`, dir)); }); };

if (args.includes('--list')) {
  let total = 0;
  for (const lang of langs) for (const voice of voices) {
    if (!VOICES[lang]?.[voice]?.id) { console.log(`${lang}/${voice}: no voice chosen yet`); continue; }
    const L = todo(lang, voice), n = L.reduce((a, t) => a + t.length, 0), credits = MODEL[lang] === 'eleven_flash_v2_5' ? n / 2 : n; total += credits;
    for (const t of L) console.log(`${lang}/${voice}  ${t}`);
    console.log(`${lang}/${voice}: ${L.length} lines to record, ${n} characters ≈ ${Math.ceil(credits)} credits`);
  }
  console.log(`total ≈ ${Math.ceil(total)} credits`); process.exit(0);
}
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('Set ELEVENLABS_API_KEY (or use --list)'); process.exit(1); }
const save = () => { writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest, null, 1)); writeFileSync(new URL('hashes.json', dir), JSON.stringify(hashes, null, 1)); };

for (const lang of langs) for (const voice of voices) {
  const vid = VOICES[lang]?.[voice]?.id, model = MODEL[lang];
  if (!vid) { console.log(`- ${lang}/${voice}: no voice chosen yet, skipped`); continue; }
  mkdirSync(new URL(`${lang}/${voice}/`, dir), { recursive: true });
  for (const text of linesOf(lang)) {
    const id = clipId(lang, voice, text), file = `${id}.mp3`, h = hashOf(vid, model, text);
    if (!force && hashes[id] === h && existsSync(new URL(file, dir))) { manifest[id] = file; continue; }
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_96`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      // low stability and some style: a lively, bouncy delivery; Flash takes the language explicitly
      body: JSON.stringify({ text, model_id: model, ...(model === 'eleven_flash_v2_5' ? { language_code: lang } : {}),
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true } }),
    });
    if (!r.ok) { console.error(`! ${id}: ${r.status} ${await r.text()}`); save(); process.exit(1); }
    writeFileSync(new URL(file, dir), Buffer.from(await r.arrayBuffer()));
    manifest[id] = file; hashes[id] = h; save();
    console.log(`+ ${id}`);
  }
}
// forget clips of lines that no longer exist
if (!sample) {
  const live = new Set(); for (const lang of Object.keys(VOICES)) for (const voice of ['female', 'male']) for (const t of allLines(lang, packMsgs)) live.add(clipId(lang, voice, t));
  for (const id of Object.keys(manifest)) if (!live.has(id)) delete manifest[id];
}
save();
console.log(`${Object.keys(manifest).length} clips in kids/audio/manifest.json`);
