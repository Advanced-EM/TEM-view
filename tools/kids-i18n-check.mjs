// Check Electron Explorer's translations: every English string in the kids code ([English, Spanish] pairs, with
// {placeholders} for templates) and every data-i18n key in the page must be in kids/lang/<lang>.js.
//   node tools/kids-i18n-check.mjs            report missing and unused entries for pt, fr, de
//   node tools/kids-i18n-check.mjs --keys     print the English strings as JSON (a starting point for a new language)
// Pairs are found in the source as ['English', 'Spanish'] literals; those built with ${…} are not translatable here
// and should use msg('… {name} …', { name }) instead.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../kids/', import.meta.url);
const files = ['main.js', 'lines.js', 'specimens.js', 'console.js', 'kiosk.js', 'packs.js', 'sticker.js'].filter((f) => existsSync(new URL(f, root)));
const lit = String.raw`'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\x60(?:\\.|[^\x60\\$])*\x60`;
const re = new RegExp(String.raw`\[\s*(${lit})\s*,\s*(${lit})\s*\]`, 'g');
const SKIP = new Set(['pointerup', '2in 2in', '4in 6in', '58mm 80mm']); // event names and paper sizes, not text
const strings = new Set(), templated = [];
for (const f of files) {
  const src = readFileSync(new URL(f, root), 'utf8');
  for (const m of src.matchAll(re)) {
    const en = Function(`return ${m[1]}`)();
    if (/^[\s\d.,:;×%·—–-]*$/.test(en) || SKIP.has(en)) continue; // nothing to translate
    strings.add(en);
  }
  for (const m of src.matchAll(/\[\s*`[^`]*\$\{[^`]*`\s*,\s*`[^`]*`\s*\]/g)) templated.push(`${f}: ${m[0].slice(0, 70)}…`);
}
// pack texts ({ en, es, pt, … } objects) are checked by the pack loader, not here
const html = readFileSync(new URL('index.html', root), 'utf8');
const keys = new Set([...html.matchAll(/data-i18n(?:-aria|-title)?="([\w-]+)"/g)].map((m) => m[1]));
const extra = readFileSync(new URL('i18n.js', root), 'utf8').match(/export const STATIC_KEYS = \[([^\]]*)\]/);
if (extra) for (const k of extra[1].match(/'[\w-]+'/g) ?? []) keys.add(k.slice(1, -1));

if (process.argv.includes('--keys')) { console.log(JSON.stringify({ static: [...keys].sort(), strings: [...strings].sort() }, null, 1)); process.exit(0); }

let bad = 0;
if (templated.length) { console.log(`templated pairs (use msg() so they can be translated):\n  ${templated.join('\n  ')}`); bad++; }
for (const f of readdirSync(new URL('lang/', root)).filter((x) => x.endsWith('.js'))) {
  const L = (await import(new URL(`lang/${f}`, root))).default;
  const missS = [...keys].filter((k) => L.static?.[k] == null), missT = [...strings].filter((s) => L.strings?.[s] == null);
  const unused = Object.keys(L.strings ?? {}).filter((s) => !strings.has(s));
  const ph = Object.entries(L.strings ?? {}).filter(([en, t]) => strings.has(en) && JSON.stringify((en.match(/\{\w+\}/g) ?? []).sort()) !== JSON.stringify((t.match(/\{\w+\}/g) ?? []).sort()));
  console.log(`${f}: ${keys.size - missS.length}/${keys.size} page keys, ${strings.size - missT.length}/${strings.size} strings`
    + (missS.length ? `\n  missing page keys: ${missS.join(', ')}` : '') + (missT.length ? `\n  missing strings:\n    ${missT.join('\n    ')}` : '')
    + (unused.length ? `\n  unused (stale) strings:\n    ${unused.join('\n    ')}` : '') + (ph.length ? `\n  placeholders differ:\n    ${ph.map(([e]) => e).join('\n    ')}` : ''));
  if (missS.length || missT.length || ph.length) bad++;
}
process.exit(bad ? 1 : 0);
