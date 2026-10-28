// Cache-busting: stamp a version onto every module, the stylesheet and the entry script in index.html and in
// kids/index.html (Electron Explorer), so browsers fetch fresh code after each deploy. Run before committing a release:
//   node tools/stamp.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const mods = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).sort();
let html = readFileSync(new URL('index.html', root), 'utf8');
const map = { three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/' };
for (const f of mods) map[`./js/${f}`] = `./js/${f}?v=${v}`;
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${JSON.stringify({ imports: map }, null, 1)}\n</script>`);
html = html.replace(/href="css\/style\.css(\?v=\w+)?"/, `href="css/style.css?v=${v}"`);
html = html.replace(/src="js\/main\.js(\?v=\w+)?"/, `src="js/main.js?v=${v}"`);
writeFileSync(new URL('index.html', root), html);

// Electron Explorer: an import map versions its modules (they import each other by relative path)
const kmods = readdirSync(new URL('kids/', root)).filter((f) => f.endsWith('.js')).sort();
let kids = readFileSync(new URL('kids/index.html', root), 'utf8');
const kmap = `<script type="importmap">\n${JSON.stringify({ imports: Object.fromEntries(kmods.map((f) => [`./${f}`, `./${f}?v=${v}`])) }, null, 1)}\n</script>`;
kids = /<script type="importmap">[\s\S]*?<\/script>/.test(kids) ? kids.replace(/<script type="importmap">[\s\S]*?<\/script>/, kmap)
  : kids.replace(/<script type="module" src="main\.js/, `${kmap}\n<script type="module" src="main.js`);
kids = kids.replace(/href="kids\.css(\?v=\w+)?"/, `href="kids.css?v=${v}"`);
kids = kids.replace(/src="main\.js(\?v=\w+)?"/, `src="main.js?v=${v}"`);
writeFileSync(new URL('kids/index.html', root), kids);
console.log(`stamped v=${v} on ${mods.length} modules and ${kmods.length} kids modules`);
