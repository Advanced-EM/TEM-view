// Cache-busting: stamp a version onto every module, the stylesheet and the entry script in index.html and in
// kids/index.html (Electron Explorer), and the shared modules in ruska/ and scanning/, so browsers fetch fresh code after each deploy. Run before committing a release:
//   node tools/stamp.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const mods = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).sort();
let html = readFileSync(new URL('index.html', root), 'utf8');
// three.js is in vendor/ (tools/vendor-offline.mjs), so the exhibits run offline
const map = { three: './vendor/three@0.160.0/build/three.module.js', 'three/addons/': './vendor/three@0.160.0/examples/jsm/' };
for (const f of mods) map[`./js/${f}`] = `./js/${f}?v=${v}`;
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${JSON.stringify({ imports: map }, null, 1)}\n</script>`);
html = html.replace(/href="css\/style\.css(\?v=\w+)?"/, `href="css/style.css?v=${v}"`);
html = html.replace(/src="js\/main\.js(\?v=\w+)?"/, `src="js/main.js?v=${v}"`);
writeFileSync(new URL('index.html', root), html);

// Electron Explorer and its sticker page: an import map versions their modules (they import each other by relative
// path), including the language files in kids/lang/
const kmods = [...readdirSync(new URL('kids/', root)).filter((f) => f.endsWith('.js')), ...readdirSync(new URL('kids/lang/', root)).filter((f) => f.endsWith('.js')).map((f) => `lang/${f}`)].sort();
const kmap = `<script type="importmap">\n${JSON.stringify({ imports: Object.fromEntries(kmods.map((f) => [`./${f}`, `./${f}?v=${v}`])) }, null, 1)}\n</script>`;
for (const [page, entry] of [['index.html', 'main.js'], ['sticker.html', 'sticker.js']]) {
  let kids = readFileSync(new URL(`kids/${page}`, root), 'utf8');
  const re = new RegExp(`<script type="module" src="${entry.replace('.', '\\.')}`);
  kids = /<script type="importmap">[\s\S]*?<\/script>/.test(kids) ? kids.replace(/<script type="importmap">[\s\S]*?<\/script>/, kmap)
    : kids.replace(re, `${kmap}\n<script type="module" src="${entry}`);
  kids = kids.replace(/href="kids\.css(\?v=\w+)?"/, `href="kids.css?v=${v}"`);
  kids = kids.replace(new RegExp(`src="${entry.replace('.', '\\.')}(\\?v=\\w+)?"`), `src="${entry}?v=${v}"`);
  writeFileSync(new URL(`kids/${page}`, root), kids);
}
// Ruska 1933 and Scanning 1938–2002: their own modules, the entry script, the stylesheet, and ../js/usage.js with the
// config it reads
for (const page of ['ruska', 'scanning']) {
  const dir = new URL(`${page}/`, root), f = new URL('index.html', dir);
  const own = readdirSync(dir).filter((n) => n.endsWith('.js')).sort();
  const pmap = { three: `.${map.three}`, 'three/addons/': `.${map['three/addons/']}`, ...Object.fromEntries(own.map((n) => [`./${n}`, `./${n}?v=${v}`])),
    '../js/usage.js': `../js/usage.js?v=${v}`, '../js/config.js': `../js/config.js?v=${v}` };
  let h = readFileSync(f, 'utf8').replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${JSON.stringify({ imports: pmap }, null, 1)}\n</script>`);
  h = h.replace(/href="(\w+)\.css(\?v=\w+)?"/, `href="$1.css?v=${v}"`).replace(/src="main\.js(\?v=\w+)?"/, `src="main.js?v=${v}"`);
  writeFileSync(f, h);
}
console.log(`stamped v=${v} on ${mods.length} modules, ${kmods.length} kids modules and the history exhibits`);
