// English and German. The page's own HTML is the English text; elements marked data-i18n="key" get the German
// from DE below. In scripts, tr([en, de]) picks the current language. German uses Ruska's 1934 terms where they exist.

const pick = () => {
  try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'de' || q === 'en') return q; } catch {}
  try { const s = localStorage.getItem('ruska-lang'); if (s === 'de' || s === 'en') return s; } catch {}
  return /^de\b/i.test(navigator.language || '') ? 'de' : 'en';
};
export let lang = pick();
const subs = new Set();
export const onLang = (f) => subs.add(f);
export const tr = (o) => (Array.isArray(o) ? o[lang === 'de' ? 1 : 0] ?? o[0] : typeof o === 'function' ? o() : o);
export const num = (x, d = 0) => { const s = Number(x).toFixed(d); return lang === 'de' ? s.replace('.', ',') : s; };
export const fmtInt = (x) => Math.round(x).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');

const EN = new Map(); // English originals, captured from the page the first time
export function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n; if (!EN.has(k)) EN.set(k, el.innerHTML);
    el.innerHTML = lang === 'de' && DE[k] != null ? DE[k] : EN.get(k);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const k = el.dataset.i18nAria; const key = 'aria:' + k; if (!EN.has(key)) EN.set(key, el.getAttribute('aria-label'));
    el.setAttribute('aria-label', lang === 'de' && DE[key] ? DE[key] : EN.get(key));
  });
  document.title = lang === 'de' ? 'Ruska 1933' : 'Ruska 1933';
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang));
}
export function setLang(l) {
  if (l === lang) return; lang = l;
  try { localStorage.setItem('ruska-lang', l); } catch {}
  applyStatic(); subs.forEach((f) => f(l));
}

export const DE = {
  'nav.drive': 'Bedienen', 'nav.how': 'Wie es funktioniert', 'nav.history': 'Geschichte', 'nav.museum': 'Das Museum', 'nav.out': 'Seeing with Electrons ↗',
  'hero.eyebrow': 'Interaktive Ausstellung · Elektronenmikroskopie-Museum Nürnberg',
  'hero.h1': 'Bedienen Sie das <em>erste</em> Elektronen­mikroskop',
  'hero.lede': 'Berlin, November 1933. Ernst Ruska, 26 Jahre alt, stellt eine Säule aus Messing und Magnetspulen fertig, die 12.000-fach vergrößert und feinere Einzelheiten zeigt als jedes Lichtmikroskop. Pumpen Sie die Säule leer, zünden Sie die Entladung, stellen Sie die Spulen scharf und belichten Sie eine Platte, bevor der Strahl Ihr Objekt verbrennt.',
  'tb.cutaway': 'Schnittbild', 'tb.spin': 'Drehteller', 'tb.sound': 'Ton', 'tb.console': 'Konsole',
  'view.inter': 'Zwischenbildschirm <small>85×</small>', 'view.final': 'Endbildschirm',
  'view.hint': 'Schirm ziehen: Objekt verschieben · scrollen: Projektionsspule drehen',
  'm.restart': 'Mission neu beginnen', 'm.hint': 'Wie geht das?',
  'b.title': 'Was das Bild unscharf macht', 'b.small': 'Auflösung nach Ruskas Kantenmaß',
  'b.note': 'Die gestrichelte Linie ist die Grenze des Lichtmikroskops, etwa 200 nm. Ruska maß 1933 an einer Baumwollfaser 50 nm.',
  'p.title': 'Plattenkasten',
  'how.h2': 'Wie es <em>funktioniert</em>',
  'how.intro': 'Jedes Verhalten der simulierten Säule folgt der Elektronenoptik, die Ruska 1934 beschrieb. Das Bild wird in jedem Moment nach diesen Regeln berechnet.',
  'how.1': '<span class="tag">Linse</span><h3>Eine Spule ist eine Linse</h3><p>1926 zeigte Hans Busch, dass das Magnetfeld einer kurzen Spule Elektronen so ablenkt wie eine Glaslinse das Licht. Ihre Brennweite folgt <span class="eq">f ∝ U / (N I)²</span>: mehr Strom, stärkere Linse. Ruska umhüllte die Spule mit Eisen und ließ nur einen schmalen Spalt, den <i>Polschuh</i>, der das Feld auf wenige Millimeter zusammendrängt. Sein Objektiv bildete 75-kV-Elektronen mit etwa 6 mm Brennweite ab.</p>',
  'how.2': '<span class="tag">Welle</span><h3>Wellen, 100.000-mal kürzer als Licht</h3><p>Ruska erfuhr 1931 von de Broglies Materiewellen und fürchtete zunächst eine neue Wellenlängengrenze. Die Rechnung beruhigte ihn: Bei 75 kV ist <span class="eq">λ = h / √(2meU) ≈ 4,3 pm</span>, fünf Größenordnungen kürzer als sichtbares Licht. 1932 sagten Knoll und Ruska eine Grenze von 2,2 Å voraus. Erreicht wurde sie etwa 40 Jahre später.</p>',
  'how.3': '<span class="tag">Schärfe</span><h3>Spannung ändern heißt Schärfe verlieren</h3><p>Weil <span class="eq">f</span> von der Spannung abhängt, verschiebt jedes Wandern der Hochspannung die Schärfe, und ihre Welligkeit verschmiert jeden Punkt zu einem Scheibchen (chromatischer Fehler). Das Entladungsrohr musste nach Ruska „außerordentlich ruhig“ brennen. Achten Sie auf den Balken <i>HV-Welligkeit</i>, wenn Sie die Entladung aufdrehen.</p>',
  'how.4': '<span class="tag">Drehung</span><h3>Das Bild dreht sich, während es wächst</h3><p>Elektronen laufen auf Schraubenbahnen durch eine Magnetlinse, darum dreht sich das Bild um einen Winkel, der mit dem Spulenstrom wächst. Drehen Sie die Projektionsspule auf, und das Objekt dreht sich beim Vergrößern. Ruskas Bediener lebten damit; heutige Mikroskope gleichen es aus.</p>',
  'how.5': '<span class="tag">Lichtbilanz</span><h3>Vergrößerung kostet Licht</h3><p>Das Bild verteilt die Elektronen auf eine M²-mal größere Fläche. Bei 10.000-facher Vergrößerung ist die Strahlungsdichte im Objekt 10<sup>8</sup>-mal größer als im Bild. Um überhaupt etwas zu sehen, muss der Kondensor den Strahl auf wenige Mikrometer zusammendrängen. Das erhitzt das Objekt, und ein organisches verkohlt.</p>',
  'how.6': '<span class="tag">Kontrast</span><h3>Kontrast durch Streuung, nicht durch Absorption</h3><p>Ruska bemerkte, dass schon sehr dünne Objekte Kontrast gaben: nicht weil sie Elektronen verschlucken, sondern weil sie sie aus der Linsenöffnung herausstreuen. Dünne Objekte absorbieren wenig und bleiben kühler. Das machte die biologische Elektronenmikroskopie möglich.</p>',
  'hist.h2': 'Von der Kathodenstrahlröhre <em>zur 12.000-fachen Vergrößerung</em>',
  'hist.intro': 'Ruska studierte Elektrotechnik und arbeitete in der Gruppe von Max Knoll an der Technischen Hochschule Berlin, die Kathodenstrahl-Oszillographen baute, um sehr schnelle Vorgänge auf Hochspannungsleitungen aufzuzeichnen. Das Mikroskop entstand aus dem Problem, deren Elektronenstrahlen zu bündeln.',
  'hist.quote': 'Das Gerät von 1933 lief mit einem Stipendium von 100 Reichsmark im Monat. In seinem Nobelvortrag bezweifelte Ruska, dass die deutsche Forschungsförderung je ein Elektronenmikroskop billiger bekommen habe.',
  'tly.1931': '7. April 1931', 'tly.1933': 'Nov. 1933',
  'tl.1924': 'Louis de Broglie schlägt vor, dass Elektronen Wellen sind.',
  'tl.1926': 'Hans Busch zeigt, dass eine kurze Spule auf Elektronen wirkt wie eine Sammellinse auf Licht.',
  'tl.1929': 'In seiner Studienarbeit nimmt Ruska die ersten elektronenoptischen Bilder auf, von einer 0,3-mm-Anodenblende, und umhüllt die Spule mit Eisen.',
  'tl.1931': 'Zwei Spulen hintereinander: ein Platinnetz, zweistufig abgebildet, 3,6 × 4,8 ≈ 17,4-fach bei 50 kV. Heute gilt diese Röhre als das erste Elektronenmikroskop.',
  'tl.1932': 'Knoll und Ruska sagen eine Auflösungsgrenze von 2,2 Å voraus. Ruska und Bodo von Borries melden die Polschuhlinse zum Patent an.',
  'tl.1933': 'Ruska stellt ein zweistufiges Mikroskop mit Kondensor-, Objektiv- und Projektionsspule fertig: 12.000-fach und 50 nm Auflösung an einer verkohlten Baumwollfaser, jenseits des Lichtmikroskops.',
  'tl.1935': 'Studenten am Gerät von 1933 nehmen einen Stubenfliegenflügel auf (60 kV, 2.200-fach) und die Kieselalge <i>Amphipleura pellucida</i> (53 kV, 3.500-fach, 130 nm).',
  'tl.1939': 'Ruska und von Borries liefern bei Siemens das erste in Serie gebaute Elektronenmikroskop an die Hoechst AG. Prototypen erreichten 1938 die 30.000-fache Vergrößerung.',
  'tl.1986': 'Ruska erhält den Nobelpreis für Physik für seine grundlegenden Arbeiten zur Elektronenoptik und den Bau des ersten Elektronenmikroskops.',
  'mus.h2': 'Im Original <em>in Nürnberg</em>',
  'mus.intro': 'Ein Messingmodell von Ruskas Gerät von 1933 mit der Aufschrift <i>Erstes Elektronen-Übermikroskop von E. Ruska, 1933</i> steht im DemoSpace des Elektronenmikroskopie-Museums Nürnberg. Das Museum hält die Mikroskope der folgenden Jahrzehnte betriebsbereit, darunter eine Siemens-ÜM-100-Laborsäule, die aus Ruskas Prototyp hervorging.',
  'mus.btn1': 'TEMs und SEMs im DemoSpace', 'mus.btn2': 'Ein modernes Mikroskop bedienen',
  'spec.col': 'Säule', 'spec.colv': 'Kathode bis Kassettenboden 1,20 m; Kondensor-, Objektiv- und Projektionsspule mit Polschuhen aus Eisen',
  'spec.src': 'Quelle', 'spec.srcv': 'Gasentladungsrohr mit kalter Aluminium- oder Eisenkathode, wassergekühlt, etwa 1 mA',
  'spec.hv': 'Spannung', 'spec.hvv': 'Bis etwa 75 kV, Zweiweggleichrichtung mit Beruhigungskapazität',
  'spec.mag': 'Vergrößerung', 'spec.magv': 'Etwa 85-fach auf dem Zwischenbildschirm, bis 12.200-fach auf dem Endbildschirm',
  'spec.res': 'Auflösung', 'spec.resv': '50 nm (Kante einer verkohlten Baumwollfaser, 8.000-fach)',
  'spec.rec': 'Aufnahme', 'spec.recv': 'Photographische Platten in einer Kassette im Vakuum; Fenster aus 6–10 mm Bleiglas gegen Röntgenstrahlen',
  'spec.vac': 'Vakuum', 'spec.vacv': 'Vorpumpe und Quecksilber-Diffusionspumpe',
  'foot.1': 'Quellen: E. Ruska, „Über Fortschritte im Bau und in der Leistung des magnetischen Elektronenmikroskops“, <i>Z. Physik</i> 87, 580–602 (1934); E. Ruska, <a href="https://www.nobelprize.org/uploads/2018/06/ruska-lecture.pdf">Nobelvortrag</a>, 8. Dezember 1986. Die Säule ist eine Simulation: Ihre Geometrie und die Röhre von 1931 sind schematisch, und die Physik ist vereinfacht, damit sie live im Browser läuft.',
  'foot.2': 'Teil von <b>Seeing with Electrons</b> · <a href="../">TEM-view</a> · <a href="../kids/">TEM-view Kids</a> · <a href="../scanning/">Scanning 1938–2002</a>',
  'r.next': 'Nächste Mission', 'r.stay': 'Weiter erkunden',
  'c.close': 'Schließen',
  'aria:stage': '3D-Modell des Mikroskops. Ziehen zum Drehen, Teil anklicken zum Lesen.',
  'aria:screen': 'Der Leuchtschirm, gesehen durch das Bleiglasfenster',
};
