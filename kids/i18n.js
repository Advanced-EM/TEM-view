// Five languages: English, Spanish, Brazilian Portuguese, French and German.
// A message is a plain string (the same in every language), an [English, Spanish] pair, a template
// msg('… {name} …', { name }) whose values are messages too, or join(a, b, …). Portuguese, French and German
// come from kids/lang/<lang>.js, keyed by the English text (strings) and by the page's data-i18n keys (static);
// tools/kids-i18n-check.mjs lists anything missing. A string not yet translated falls back to English.
// Language: ?lang=…, else the kiosk's or this browser's last choice, else the browser's language.
import PT from './lang/pt.js';
import FR from './lang/fr.js';
import DE from './lang/de.js';

export const LANGS = ['en', 'es', 'pt', 'fr', 'de'];
export const LANG_NAMES = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch' };
const LOCALES = { en: 'en-US', es: 'es-MX', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE' };
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };
const ok = (l) => LANGS.includes(l);
const urlLang = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
const navLang = typeof navigator !== 'undefined' ? (navigator.language || '').slice(0, 2).toLowerCase() : 'en';
export let lang = ok(urlLang) ? urlLang : ok(store('kids-lang')) ? store('kids-lang') : ok(navLang) ? navLang : 'en';
export const locale = (l = lang) => LOCALES[l];

const DICT = { pt: PT, fr: FR, de: DE };
export const msg = (t, v) => ({ t, v });
export const join = (...ms) => ({ join: ms.filter(Boolean) });
export function trIn(l, m) {
  if (m == null) return '';
  if (typeof m === 'string' || typeof m === 'number') return String(m);
  if (Array.isArray(m)) return l === 'en' ? m[0] : l === 'es' ? m[1] ?? m[0] : DICT[l]?.strings?.[m[0]] ?? m[0];
  if (m.join) return m.join.map((x) => trIn(l, x)).filter(Boolean).join(' ');
  if (m.t) return trIn(l, m.t).replace(/\{(\w+)\}/g, (_, k) => trIn(l, m.v?.[k]));
  if (typeof m === 'object' && (m.en != null)) return m[l] ?? m.en; // pack texts: { en, es, pt, fr, de }
  return String(m);
}
export const tr = (m) => trIn(lang, m);

const subs = [];
export const onLang = (f) => subs.push(f);
export function setLang(l, remember = true) {
  if (!ok(l) || l === lang) return;
  lang = l; if (remember) store('kids-lang', l); applyStatic(); subs.forEach((f) => f(l));
}

const ES = {
  brand: 'Explorador de <b>Electrones</b>', book: 'Álbum de stickers', console: 'Consola', read: 'Leer en voz alta', readT: 'Zip lee todo en voz alta', voiceT: 'La voz de Zip', sound: 'Sonido', grown: 'Versión para grandes ↗',
  labA: 'El microscopio', scopeA: 'El microscopio por dentro', inside: 'Dentro del microscopio',
  colA: 'Un corte del microscopio electrónico. Haz clic en una parte para saber qué hace.',
  gunA: 'Cañón de electrones', condA: 'Lente del brillo', holderA: 'Portamuestras', objA: 'Lente del enfoque', projA: 'Lente del zoom', screenA: 'Pantalla brillante y cámara', vacA: 'Bomba de vacío',
  tGun: 'Cañón', tBright: 'Brillo', tAir: 'Sin aire', tSample: 'Muestra', tFocus: 'Enfoque', tZoom: 'Zoom', tScreen: 'Pantalla',
  tap: 'Toca una parte para saber qué hace.', pickA: 'Elige una muestra',
  screenCanvasA: 'La pantalla del microscopio. Arrastra para mover la muestra; usa la rueda o pellizca para hacer zoom.',
  sleep: 'El haz está apagado.<br>¡Presiona <em>HAZ</em> para despertarlo!', zoomL: 'Zoom',
  palA: 'Colores de la imagen', palC: '🎨 Colores de caricatura', palM: '⚫ Real (gris)', palG: '🟢 Pantalla brillante',
  conA: 'Consola TEM-view, en pantalla', joyA: 'Joystick: arrastra para mover la muestra, o usa las flechas', move: 'MOVER', beam: 'HAZ', snapA: 'Tomar una foto', snap: 'FOTO',
  prevA: 'Muestra anterior', nextA: 'Muestra siguiente', what: '¿Qué es esto?',
  missions: 'Misiones', hint: '💡 Muéstrame cómo', sharpo: 'Nitidómetro', blurry: '😵‍💫 borroso', sharp: 'nítido 😎', brightness: 'Brillo', darkL: '🌑 oscuro', tooBright: 'demasiado 🔥',
  howSmall: '¿Qué tan pequeño es?', how: '¿Cómo funciona?',
  h1t: 'Electrones en vez de luz', h1p: 'Un microscopio normal usa luz. Las ondas de luz son demasiado grandes para mostrar átomos. Los electrones se comportan como ondas unas 100,000 veces más cortas, así que pueden mostrar cosas mucho más pequeñas.',
  h2t: 'Los imanes son las lentes', h2p: 'El vidrio no puede desviar electrones, pero los imanes sí. El microscopio tiene bobinas de alambre que forman lentes magnéticas: una para el brillo, una para el enfoque y una para el zoom.',
  h3t: 'Más delgada que una burbuja', h3p: 'Los electrones tienen que atravesar la muestra, así que debe ser súper delgada. Las partes gruesas detienen más electrones y se ven oscuras. Las imágenes reales son grises: los científicos les añaden colores para verlas mejor.',
  h4t: '¡No la cocines!', h4p: 'Un haz muy brillante puede dañar muestras blandas como el polen y las bacterias. Los científicos usan el menor haz posible. Pruébalo: sube el BRILLO al máximo y observa.',
  teach: 'Para maestros y familias',
  teach1: 'Explorador de Electrones es el compañero para escuelas (K-12) de <a href="../">Seeing with Electrons</a>, un simulador de microscopio electrónico basado en la física. Tiene tres controles (enfoque, zoom y brillo), un joystick y una cámara, y añade misiones y un álbum de stickers. Los microscopistas reales siguen los mismos pasos: encender el haz, encontrar la muestra, enfocar y tomar una foto sin dañarla.',
  g1: '<b>Grados K-2:</b> activen <em>Leer en voz alta</em>; jueguen juntos las tres primeras misiones; comparen los colores de los stickers con el gris "real".',
  g2: '<b>Grados 3-5:</b> usen la escalera <em>¿Qué tan pequeño es?</em> para ordenar un cabello, una célula, un virus y un átomo. Se relaciona con <i>5-PS1-1</i> (la materia está hecha de partículas demasiado pequeñas para verse).',
  g3: '<b>Grados 6-8:</b> células y virus (<i>MS-LS1-1</i>); el grafeno como una estructura hecha de átomos (<i>MS-PS1-1</i>); el concepto transversal <i>Escala, proporción y cantidad</i>.',
  g4: '<b>Grados 9-12:</b> por qué enfocar es más difícil con mucho zoom, por qué el brillo causa daño y por qué la imagen "real" es gris. Después, pasen al <a href="../">simulador completo</a>.',
  teach3: '<b>Para imprimir:</b> una <a href="educators/worksheet.html">hoja de trabajo</a> en cinco idiomas y una <a href="educators/guide.html">guía para la excursión con la alineación a los NGSS</a>.',
  teach2: 'Para museos y centros de ciencia, la <a href="museums.html">guía para museos</a> explica el modo quiosco (<code>?kiosk</code>), el uso sin conexión, el menú del personal, la impresión de stickers, las visitas, la accesibilidad y los paquetes de muestras. Funciona con mouse, pantalla táctil, teclado, control de videojuegos o la <a href="../console/">Consola TEM-view</a>. Las muestras están dibujadas a escala con formas sencillas; no son imágenes reales grabadas.',
  foot: 'Parte de <b>Seeing with Electrons</b> · <a href="../">TEM-view</a> · <a href="../ruska/">Ruska 1933</a> · <a href="../scanning/">Scanning 1938–2002</a> · <span aria-current="page">TEM-view Kids</span> · <a href="../privacy.html">Privacidad</a><br>Copyright © 2026 by Northwestern University. All Rights Reserved.',
  yourPics: 'Tus fotos', noStickers: 'Todavía no hay stickers. ¡Presiona <b>FOTO</b> para tomar una!', done: '¡Misión cumplida!', close: 'Cerrar',
};
Object.assign(ES, {
  a11y: 'Más fácil de ver', a11yT: 'Alto contraste, texto más grande, movimiento tranquilo', hc: 'Alto contraste', big: 'Texto más grande', calm: 'Movimiento tranquilo',
  thPrint: 'Imprimir mi sticker', thQR: 'Llévatelo a casa', qrEyebrow: 'Llévate tu foto a casa', qrTitle: 'Escanéame con la cámara de un teléfono', qrA: 'Código QR',
  qrNote: 'Abre tu sticker en el teléfono. El código solo contiene los ajustes de la imagen, nada sobre ti.', pinTitle: 'PIN del personal',
  stEyebrow: 'Explorador de Electrones', stTitle: 'Mi sticker del microscopio electrónico', stSave: '⬇️ Guardar la imagen', stShare: '📤 Compartir', stPlay: '🔬 Jugar a Explorador de Electrones',
  stNote: 'Esta imagen se volvió a dibujar en tu teléfono a partir de unos números de la dirección. No se guardó nada sobre ti.',
});
// keys used only by sticker.html (tools/kids-i18n-check.mjs reads this list)
export const STATIC_KEYS = ['stEyebrow', 'stTitle', 'stSave', 'stShare', 'stPlay', 'stNote'];
const STATIC = { es: ES, pt: PT.static, fr: FR.static, de: DE.static };
const EN = new Map();
export function applyStatic() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  const swap = (sel, attr, get, set) => document.querySelectorAll(sel).forEach((el) => {
    const k = el.dataset[attr]; if (!EN.has(attr + k)) EN.set(attr + k, get(el));
    set(el, STATIC[lang]?.[k] ?? EN.get(attr + k));
  });
  swap('[data-i18n]', 'i18n', (e) => e.innerHTML, (e, v) => { e.innerHTML = v; });
  swap('[data-i18n-aria]', 'i18nAria', (e) => e.getAttribute('aria-label'), (e, v) => e.setAttribute('aria-label', v));
  swap('[data-i18n-title]', 'i18nTitle', (e) => e.getAttribute('title'), (e, v) => e.setAttribute('title', v));
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang));
}
