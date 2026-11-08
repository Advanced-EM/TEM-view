// Copy what the exhibits load from the internet into the repository, so a museum kiosk works with no network:
//   node tools/vendor-offline.mjs
// - three.js r160 (build/three.module.js and the add-ons the exhibits import, with the files those import) into
//   vendor/three@0.160.0/, the same layout as the npm package;
// - the Google Fonts (Instrument Serif, IBM Plex Sans and Mono, Fredoka, Nunito; Latin and Latin Extended) into
//   fonts/, with fonts/fonts.css replacing the Google stylesheet links.
// The files are saved as they are; licenses: three.js MIT (vendor/three@0.160.0/LICENSE), the fonts SIL OFL 1.1
// (fonts/README.md). Pyodide and CodeMirror (the Python IDE) stay online-only.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const ADDONS = ['controls/OrbitControls.js', 'environments/RoomEnvironment.js', 'geometries/RoundedBoxGeometry.js', 'postprocessing/EffectComposer.js',
  'postprocessing/OutputPass.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js'];
const FAMILIES = 'family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Fredoka:wght@500;600;700&family=Nunito:wght@500;700;800';
// Google serves woff2 with unicode-range subsets to a modern browser
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const save = (rel, data) => { const p = fileURLToPath(new URL(rel, root)); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
async function get(url, text = true) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return text ? r.text() : Buffer.from(await r.arrayBuffer());
}

// three.js: the build, then each add-on and the relative imports it pulls in
save('vendor/three@0.160.0/build/three.module.js', await get(`${THREE}build/three.module.js`));
save('vendor/three@0.160.0/LICENSE', await get(`${THREE}LICENSE`));
const todo = ADDONS.map((a) => `examples/jsm/${a}`), seen = new Set();
while (todo.length) {
  const rel = todo.pop(); if (seen.has(rel)) continue; seen.add(rel);
  const src = await get(THREE + rel);
  save(`vendor/three@0.160.0/${rel}`, src);
  for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) todo.push(new URL(m[1], `https://x/${rel}`).pathname.slice(1));
}
console.log(`three.js: build + ${seen.size} add-on files`);

// fonts: keep the latin and latin-ext faces, point them at local files
const css = await get(`https://fonts.googleapis.com/css2?${FAMILIES}&display=swap`);
const keep = css.split('/*').filter((b) => /^\s*(latin|latin-ext) \*\//.test(b));
let out = '/* Google Fonts, copied for offline use by tools/vendor-offline.mjs (SIL Open Font License 1.1, see README.md) */\n', n = 0;
for (const block of keep) {
  let b = `/*${block}`;
  for (const m of [...b.matchAll(/url\((https:[^)]+)\)/g)]) {
    const name = m[1].split('/').slice(-2).join('-'); // unique per family and subset
    if (!existsSync(fileURLToPath(new URL(`fonts/${name}`, root)))) save(`fonts/${name}`, await get(m[1], false));
    b = b.replace(m[1], name); n++;
  }
  out += b;
}
save('fonts/fonts.css', out);
const fams = ['Instrument Serif', 'IBM Plex Sans', 'IBM Plex Mono', 'Fredoka', 'Nunito'].map((f) => `- [${f}](https://fonts.google.com/specimen/${f.replace(/ /g, '+')})`);
save('fonts/README.md', ['# Fonts', '', 'Copied from Google Fonts by `tools/vendor-offline.mjs` so the exhibits work offline. Each family is licensed under the',
  '[SIL Open Font License 1.1](https://openfontlicense.org) by its authors:', '', ...fams, ''].join('\n'));
console.log(`fonts: ${keep.length} faces, ${n} files`);
