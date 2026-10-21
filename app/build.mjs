// Builds www/ for the TEM-view Lite apps (iOS and Android, wrapped by Capacitor) from the website's files.
// The lite edition has TEM, STEM and the Ronchigram, voice, and the training tasks (js/config.js EDITION).
// Everything the page loads is bundled, so the app works offline and loads no code from the network:
// three.js and the fonts come from npm; narration for the other modes is left out.
//   npm run build        then   npx cap sync   (or npm run ios / npm run android)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = dirname(fileURLToPath(import.meta.url)), root = resolve(app, '..'), www = join(app, 'www'), nm = join(app, 'node_modules');
const LITE_MODES = ['tem', 'stem', 'ronch'];
const ALL_MODES = ['tem', 'stem', '4d', 'diff', 'cbed', 'eds', 'eels', 'ronch', 'oah', 'ilh'];

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const d of ['css', 'js', 'icons']) cpSync(join(root, d), join(www, d), { recursive: true });
cpSync(join(root, 'privacy.html'), join(www, 'privacy.html'));

// narration: everything except the modes the lite edition leaves out
const skip = new Set(ALL_MODES.filter((m) => !LITE_MODES.includes(m)).map((m) => `mode-${m}.mp3`));
cpSync(join(root, 'audio'), join(www, 'audio'), { recursive: true, filter: (src) => !skip.has(src.split('/').pop()) });

// three.js 0.160.0 and the add-on folders the exhibit imports
mkdirSync(join(www, 'vendor/three/build'), { recursive: true });
cpSync(join(nm, 'three/build/three.module.js'), join(www, 'vendor/three/build/three.module.js'));
for (const d of ['controls', 'environments', 'postprocessing', 'shaders']) cpSync(join(nm, 'three/examples/jsm', d), join(www, 'vendor/three/examples/jsm', d), { recursive: true });

// fonts (latin subset), replacing Google Fonts
const fonts = [['Instrument Serif', 'instrument-serif', [[400, 'normal'], [400, 'italic']]], ['IBM Plex Sans', 'ibm-plex-sans', [[400, 'normal'], [500, 'normal'], [600, 'normal']]], ['IBM Plex Mono', 'ibm-plex-mono', [[400, 'normal'], [500, 'normal']]]];
mkdirSync(join(www, 'vendor/fonts'), { recursive: true });
let css = '';
for (const [family, pkg, faces] of fonts) for (const [w, style] of faces) {
  const f = `${pkg}-latin-${w}-${style}.woff2`;
  cpSync(join(nm, '@fontsource', pkg, 'files', f), join(www, 'vendor/fonts', f));
  css += `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${w}; font-display: swap; src: url('${f}') format('woff2'); }\n`;
}
writeFileSync(join(www, 'vendor/fonts/fonts.css'), css);

// the page: lite edition, local three.js and fonts, no web-app manifest or service worker
let html = readFileSync(join(root, 'index.html'), 'utf8');
const rep = (a, b) => { if (!html.includes(a)) throw new Error(`index.html changed: cannot find ${a}`); html = html.replace(a, b); };
rep('"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"', '"three": "./vendor/three/build/three.module.js"');
rep('"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"', '"three/addons/": "./vendor/three/examples/jsm/"');
html = html.replace(/<link rel="preconnect"[^>]*>\n?/g, '').replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="vendor/fonts/fonts.css">');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
rep('<meta name="theme-color"', '<script>window.TEMVIEW_EDITION = \'lite\';</script>\n<meta name="theme-color"');
if (/https:\/\/(cdn\.jsdelivr|fonts\.googleapis|unpkg|cdnjs)/.test(html)) throw new Error('index.html still loads from a CDN');
writeFileSync(join(www, 'index.html'), html);

const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(join(d, e.name)) : readFileSync(join(d, e.name)).length), 0);
console.log(`www/ built for the lite edition: ${(size(www) / 1e6).toFixed(1)} MB`);
if (!existsSync(join(www, 'js/main.js'))) throw new Error('missing js/main.js');
