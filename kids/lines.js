// Everything Zip says, in one place and in [English, Spanish], so each line can be recorded as a voice clip
// (tools/narrate-kids.mjs) in each language and voice, and played instead of the browser's speech synthesis.
// A clip is found by language, voice and spoken text: clipId(lang, voice, text). No DOM here: the narration tool
// imports this file in Node.
import { SPECIMENS } from './specimens.js';

// ElevenLabs voices for Zip: a girl's and a boy's, in each language
export const VOICES = {
  en: { female: { id: 'eppqEXVumQ3CfdndcIBd', name: 'Minnie' }, male: { id: 'fBD19tfE58bkETeiwUoC', name: 'Little Dude' } },
  es: { female: { id: 'iV6xDQ4wcM3ZcXDx30GB', name: 'Betty' }, male: { id: '4g0zcFn3Yhp86jjySzFf', name: 'Junior' } },
};

export const HELLO = ['<b>Hi, I\'m Zip!</b> I\'m an electron. Let\'s explore things way too small to see.', '<b>¡Hola, soy Zip!</b> Soy un electrón. Exploremos cosas demasiado pequeñas para verlas.'];
export const HELLO_START = ['Press <b>BEAM</b> to start!', '¡Presiona <b>HAZ</b> para empezar!'];

export const T = {
  beamOffWhat: ['The screen is dark because the beam is off. Press <b>BEAM</b>!', 'La pantalla está oscura porque el haz está apagado. ¡Presiona <b>HAZ</b>!'],
  beamFirst: ['Turn on the <b>BEAM</b> first.', 'Primero enciende el <b>HAZ</b>.'],
  superSharp: ['Super sharp! 😎 Nice focusing.', '¡Súper nítido! 😎 Muy bien enfocado.'],
  almostSharp: ['Almost sharp.', 'Casi nítido.'],
  prettyBlurry: ['Pretty blurry.', 'Bastante borroso.'],
  focusHow: ['Turn the blue <b>FOCUS</b> knob slowly. If it gets worse, turn it the other way. Real scientists do the same!', 'Gira despacio la perilla azul de <b>ENFOQUE</b>. Si empeora, gírala hacia el otro lado. ¡Los científicos de verdad hacen lo mismo!'],
  noMore: ['No more missions! Try the <b>Glowing screen</b> colors, or find the biggest and the smallest thing.', '¡No hay más misiones! Prueba los colores de <b>Pantalla brillante</b>, o busca la cosa más grande y la más pequeña.'],
  beamFirstQuest: ['First turn on the <b>BEAM</b>! No electrons, no picture.', '¡Primero enciende el <b>HAZ</b>! Sin electrones no hay imagen.'],
  followArrow: ['Follow the <b>orange arrow</b>: move with the joystick or drag the picture.', 'Sigue la <b>flecha naranja</b>: muévete con el joystick o arrastra la imagen.'],
  zoomCloser: ['You are in the right spot. Now <b>ZOOM</b> in, closer and closer!', 'Estás en el lugar correcto. ¡Ahora haz <b>ZOOM</b>, más y más cerca!'],
  focusIt: ['Turn <b>FOCUS</b> to make it sharp.', 'Gira el <b>ENFOQUE</b> para que se vea nítido.'],
  snapNow: ['Looks great. Press <b>SNAP</b>! 📸', 'Se ve genial. ¡Presiona <b>FOTO</b>! 📸'],
  snapDark: ['The screen is dark! Turn on the <b>BEAM</b> first. No electrons, no picture.', '¡La pantalla está oscura! Primero enciende el <b>HAZ</b>. Sin electrones no hay foto.'],
  snapBlurry: ['So close! But the picture is <b>blurry</b>. Turn <b>FOCUS</b> until it\'s sharp, then SNAP again.', '¡Casi! Pero la foto salió <b>borrosa</b>. Gira el <b>ENFOQUE</b> hasta que se vea nítida y toma otra FOTO.'],
  snapZoom: ['Nice picture! For this mission, <b>ZOOM</b> in more.', '¡Bonita foto! Para esta misión, haz más <b>ZOOM</b>.'],
  snapAim: ['Nice picture! But the thing we need isn\'t in the middle. Press <b>💡 Show me how</b> for an arrow.', '¡Bonita foto! Pero lo que buscamos no está en el centro. Presiona <b>💡 Muéstrame cómo</b> para ver una flecha.'],
  snapped: ['Snap! It went into your <b>sticker book</b>.', '¡Clic! La foto fue a tu <b>álbum de stickers</b>.'],
  tipFocus: ['Tip: focus first for a sharper picture.', 'Consejo: enfoca primero para que la foto salga más nítida.'],
  tipLight: ['Tip: not too bright, not too dark.', 'Consejo: ni muy brillante ni muy oscuro.'],
  cooked: ['<b>Oh no, you cooked it!</b> 🔥 Too much beam burns soft samples. Turn <b>BRIGHT</b> down and move to a fresh spot.', '<b>¡Oh no, la cocinaste!</b> 🔥 Demasiado haz quema las muestras blandas. Baja el <b>BRILLO</b> y muévete a otro lugar.'],
  toasty: ['It\'s getting <b>toasty</b>! The beam is too strong for this soft sample. Turn <b>BRIGHT</b> down!', '¡Se está <b>tostando</b>! El haz es demasiado fuerte para esta muestra blanda. ¡Baja el <b>BRILLO</b>!'],
  dark: ['It\'s dark and speckly: only a few electrons are arriving. Turn up <b>BRIGHT</b>! 💡', 'Está oscuro y lleno de puntitos: llegan muy pocos electrones. ¡Sube el <b>BRILLO</b>! 💡'],
  bright: ['Whoa, too bright! The picture is washed out. Turn <b>BRIGHT</b> down a little. 😎', '¡Uy, demasiado brillo! La imagen se ve deslavada. Baja un poco el <b>BRILLO</b>. 😎'],
  fineOn: ['Focus knob: fine steps (small turns).', 'Perilla de enfoque: pasos finos (giros pequeños).'],
  fineOff: ['Focus knob: big steps (fast).', 'Perilla de enfoque: pasos grandes (rápido).'],
  consoleHi: ['A Console is plugged in! Turn a knob.', '¡Hay una Consola conectada! Gira una perilla.'],
};
export const lookingAt = (w) => [`You're looking at <b>${w[0]}</b>.`, `Estás viendo <b>${w[1]}</b>.`];
export const needsSample = (n) => [`This mission needs the <b>${n[0]}</b> sample. Press its button above the screen.`, `Esta misión necesita la muestra de <b>${n[1]}</b>. Presiona su botón arriba de la pantalla.`];
export const nextMission = (t) => [`<b>Next mission: ${t[0]}.</b>`, `<b>Siguiente misión: ${t[1]}.</b>`];
export const sampleName = (sp) => [`<b>${sp.icon} ${sp.name[0]}.</b>`, `<b>${sp.icon} ${sp.name[1]}.</b>`];

export const QUESTS = {
  beam: { icon: '⚡', title: ['Wake up the microscope', 'Despierta al microscopio'],
    text: ['Press the green <b>BEAM</b> button to send electrons down the microscope.', 'Presiona el botón verde <b>HAZ</b> para mandar electrones por el microscopio.'],
    win: ['Electrons are flying! Look at the green beam inside the microscope.', '¡Los electrones están volando! Mira el haz verde dentro del microscopio.'],
    hints: [['The green <b>BEAM</b> button is on the Console under the screen. Or press the B key.', 'El botón verde <b>HAZ</b> está en la Consola, debajo de la pantalla. O presiona la tecla B.']] },
  focus: { icon: '🎯', title: ['Make it sharp', 'Que se vea nítido'],
    text: ['The pollen looks blurry. Turn the blue <b>FOCUS</b> knob until the Sharp-o-meter is full.', 'El polen se ve borroso. Gira la perilla azul de <b>ENFOQUE</b> hasta que el Nitidómetro se llene.'],
    win: ['Focusing is the first thing every scientist does at the microscope.', 'Enfocar es lo primero que hace cualquier científico en el microscopio.'],
    hints: [['Almost! Turn <b>FOCUS</b> just a little, slowly.', '¡Casi! Gira el <b>ENFOQUE</b> solo un poquito, despacio.'], ['Turn the blue <b>FOCUS</b> knob. If the picture gets blurrier, turn it the other way.', 'Gira la perilla azul de <b>ENFOQUE</b>. Si la imagen se pone más borrosa, gírala hacia el otro lado.']] },
  spikes: { icon: '🌼', title: ['Spiky close-up', 'Púas de cerca'],
    text: ['Zoom in on the <b>spikes</b> at the edge of a pollen grain, so they fill the screen. Focus, then press <b>SNAP</b>.', 'Haz zoom en las <b>púas</b> del borde de un grano de polen hasta que llenen la pantalla. Enfoca y presiona <b>FOTO</b>.'],
    win: ['The spikes help pollen stick to bees, so the bees carry it to other flowers.', 'Las púas ayudan a que el polen se pegue a las abejas, y así las abejas lo llevan a otras flores.'] },
  virus: { icon: '👾', title: ['Catch a virus!', '¡Atrapa un virus!'],
    text: ['Viruses called <b>phages</b> are attacking a bacterium. Zoom in until one phage is big in the middle of the screen. Then <b>SNAP</b> it!', 'Unos virus llamados <b>fagos</b> están atacando a una bacteria. Haz zoom hasta que un fago se vea grande en el centro de la pantalla. ¡Y tómale una <b>FOTO</b>!'],
    win: ['A phage is a virus that only attacks bacteria. It lands on its legs and injects its DNA through its tail, like a syringe.', 'Un fago es un virus que solo ataca bacterias. Aterriza sobre sus patas e inyecta su ADN por la cola, como una jeringa.'] },
  atoms: { icon: '⚛️', title: ['See real atoms', 'Mira átomos de verdad'],
    text: ['Zoom way, way in on a <b>gold</b> speck until you see <b>dots in rows</b>: those are atoms! Then <b>SNAP</b>.', 'Haz muchísimo zoom en una mota de <b>oro</b> hasta ver <b>puntos en filas</b>: ¡son átomos! Luego toma una <b>FOTO</b>.'],
    win: ['Each dot is a column of gold atoms, stacked one behind the other. You zoomed in more than 10 million times!', 'Cada punto es una columna de átomos de oro, uno detrás de otro. ¡Hiciste zoom más de 10 millones de veces!'] },
  odd: { icon: '🕵️', title: ['Find the odd atom', 'Encuentra el átomo diferente'],
    text: ['Graphene is a honeycomb of carbon atoms. One atom near the middle is <b>different</b>. Find it, zoom in, and <b>SNAP</b> it!', 'El grafeno es un panal de átomos de carbono. Un átomo cerca del centro es <b>diferente</b>. ¡Encuéntralo, haz zoom y tómale una <b>FOTO</b>!'],
    win: ['It is a silicon atom! Silicon atoms are bigger and heavier than carbon, so they stop more electrons and look different.', '¡Es un átomo de silicio! Los átomos de silicio son más grandes y pesados que los de carbono, así que detienen más electrones y se ven diferentes.'] },
};

export const PARTS = {
  gun: ['<b>Electron gun.</b> It shoots out electrons, tiny bits of electricity much smaller than atoms. Like a flashlight, but with electrons instead of light. That\'s me! ⚡', '<b>Cañón de electrones.</b> Dispara electrones, pedacitos de electricidad mucho más pequeños que los átomos. Como una linterna, pero con electrones en vez de luz. ¡Ese soy yo! ⚡'],
  condenser: ['<b>Brightness lens (yellow).</b> It squeezes the beam onto a small spot, like a magnifying glass in the sun. More squeeze means brighter, but too much can cook soft samples! 🔥', '<b>Lente del brillo (amarilla).</b> Aprieta el haz en un puntito, como una lupa bajo el sol. Más apretado es más brillante, ¡pero demasiado puede cocinar las muestras blandas! 🔥'],
  sample: ['<b>The sample.</b> It must be super thin, thinner than a soap bubble, so electrons can shoot right through it. Thick parts stop more electrons and look dark.', '<b>La muestra.</b> Tiene que ser súper delgada, más delgada que una burbuja de jabón, para que los electrones la atraviesen. Las partes gruesas detienen más electrones y se ven oscuras.'],
  objective: ['<b>Focus lens (blue).</b> It makes the picture sharp. It isn\'t glass: it\'s a <b>magnet</b>! Magnets bend the path of electrons.', '<b>Lente del enfoque (azul).</b> Hace que la imagen se vea nítida. No es de vidrio: ¡es un <b>imán</b>! Los imanes desvían el camino de los electrones.'],
  projector: ['<b>Zoom lens (orange).</b> It spreads the picture out bigger and bigger, up to millions of times.', '<b>Lente del zoom (naranja).</b> Agranda la imagen más y más, hasta millones de veces.'],
  screen: ['<b>Screen and camera.</b> You can\'t see electrons with your eyes! The screen glows where they hit it, and a camera takes the picture.', '<b>Pantalla y cámara.</b> ¡No puedes ver los electrones con tus ojos! La pantalla brilla donde la tocan, y una cámara toma la foto.'],
  vacuum: ['<b>Vacuum pump.</b> All the air is pumped out of the microscope. Electrons would bump into air molecules and get lost.', '<b>Bomba de vacío.</b> Se saca todo el aire del microscopio. Los electrones chocarían con las moléculas del aire y se perderían.'],
};

// fun facts as you zoom past a field of view (nm)
export const FACTS = {
  pollen: [[60000, ['Each grain is covered in spikes. They help pollen stick to bees! 🐝', 'Cada grano está cubierto de púas. ¡Ayudan a que el polen se pegue a las abejas! 🐝']],
    [7000, ['See the tiny pits? Every kind of flower has its own pollen pattern, like a fingerprint.', '¿Ves los hoyitos? Cada tipo de flor tiene su propio dibujo de polen, como una huella digital.']]],
  bugs: [[9000, ['Those long whips are <b>flagella</b>. Bacteria spin them like propellers to swim!', 'Esos látigos largos son <b>flagelos</b>. ¡Las bacterias los giran como hélices para nadar!']],
    [1500, ['Those little landers are viruses called <b>phages</b>. They attack bacteria, not people.', 'Esas navecitas son virus llamados <b>fagos</b>. Atacan a las bacterias, no a las personas.']],
    [500, ['See the striped tail? The phage squeezes it like a syringe to push its DNA into the cell.', '¿Ves la cola con rayas? El fago la aprieta como una jeringa para meter su ADN en la célula.']]],
  gold: [[150, ['Each gold speck is about 10 nanometres wide. 8,000 of them would fit across one hair!', 'Cada mota de oro mide unos 10 nanómetros. ¡Cabrían 8,000 a lo ancho de un cabello!']],
    [26, ['<b>Stripes!</b> Those are rows of atoms, lined up like people in a crowd.', '<b>¡Rayas!</b> Son filas de átomos, formados como personas en una multitud.']],
    [9, ['<b>Those dots are atoms!</b> Columns of gold atoms, seen end-on. 🤩', '<b>¡Esos puntos son átomos!</b> Columnas de átomos de oro, vistas desde la punta. 🤩']]],
  graphene: [[60, ['The light spots are <b>holes</b> in the sheet. The purple blobs are dirt from the air.', 'Las partes claras son <b>agujeros</b> en la lámina. Las manchas moradas son suciedad del aire.']],
    [12, ['A honeycomb! Each corner is one carbon atom, holding hands with three neighbours.', '¡Un panal! Cada esquina es un átomo de carbono, tomado de la mano con tres vecinos.']]],
};

// ------------------------------------------------------------------ spoken text and clip ids
// the words as spoken: no tags, no emoji, symbols a voice would trip on spelled out
export function plain(html, lang = 'en') {
  return String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{2B50}\u{2606}]/gu, '').replace(/×/g, lang === 'es' ? ' por ' : ' times ')
    .replace(/\s+/g, ' ').replace(/\s+([.,!?:])/g, '$1').trim();
}
export function clipKey(text) {
  let h = 0x811c9dc5; for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  const slug = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
  return `${slug}-${h.toString(16).padStart(8, '0')}`;
}
export const clipId = (lang, voice, text) => `${lang}/${voice}/${clipKey(text)}`;

// every line Zip can say in a language, as spoken text (what the narration tool records)
export function allLines(lang) {
  const k = lang === 'es' ? 1 : 0, L = [HELLO, HELLO_START, ...Object.values(T), ...Object.values(PARTS)];
  for (const sp of SPECIMENS) L.push(sampleName(sp), sp.blurb, needsSample(sp.name), ...sp.whats.map(lookingAt));
  for (const q of Object.values(QUESTS)) L.push(nextMission(q.title), q.text, q.win, ...(q.hints ?? []));
  for (const list of Object.values(FACTS)) for (const [, t] of list) L.push(t);
  return [...new Set(L.map((p) => plain(p[k], lang)).filter(Boolean))];
}
