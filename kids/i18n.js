// English and Spanish. Visible strings in code are [English, Spanish] pairs; tr() picks the current language.
// The page's own text keeps its English in index.html (data-i18n keys) and its Spanish here.
// Language: ?lang=es or ?lang=en, else the last choice in this browser, else the browser's language.

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };
const urlLang = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
export let lang = ['en', 'es'].includes(urlLang) ? urlLang : store('kids-lang') ?? (typeof navigator !== 'undefined' && /^es/i.test(navigator.language) ? 'es' : 'en');
if (!['en', 'es'].includes(lang)) lang = 'en';
export const LANGS = ['en', 'es'];
export const tr = (p) => (Array.isArray(p) ? (lang === 'es' ? p[1] ?? p[0] : p[0]) : p);
export const locale = () => (lang === 'es' ? 'es-MX' : 'en-US');
const subs = [];
export const onLang = (f) => subs.push(f);
export function setLang(l) {
  if (!LANGS.includes(l) || l === lang) return;
  lang = l; store('kids-lang', l); applyStatic(); subs.forEach((f) => f(l));
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
  teach2: 'En un stand o un museo, añade <code>?kiosk</code> a la dirección: la exhibición vuelve a empezar después de tres minutos sin que nadie la toque. Funciona con mouse, pantalla táctil, teclado, control de videojuegos o la <a href="../console/">Consola TEM-view</a>. Las muestras están dibujadas a escala con formas sencillas; no son imágenes reales grabadas.',
  foot: 'Parte de <b>Seeing with Electrons</b> · <a href="../">TEM-view</a> · <a href="../ruska/">Ruska 1933</a>',
  yourPics: 'Tus fotos', noStickers: 'Todavía no hay stickers. ¡Presiona <b>FOTO</b> para tomar una!', done: '¡Misión cumplida!', close: 'Cerrar',
};
const EN = new Map();
export function applyStatic() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  const swap = (sel, attr, get, set) => document.querySelectorAll(sel).forEach((el) => {
    const k = el.dataset[attr]; if (!EN.has(attr + k)) EN.set(attr + k, get(el));
    set(el, lang === 'es' && ES[k] != null ? ES[k] : EN.get(attr + k));
  });
  swap('[data-i18n]', 'i18n', (e) => e.innerHTML, (e, v) => { e.innerHTML = v; });
  swap('[data-i18n-aria]', 'i18nAria', (e) => e.getAttribute('aria-label'), (e, v) => e.setAttribute('aria-label', v));
  swap('[data-i18n-title]', 'i18nTitle', (e) => e.getAttribute('title'), (e, v) => e.setAttribute('title', v));
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang));
}
