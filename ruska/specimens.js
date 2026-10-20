// The specimens, in µm. geo[] is passed to the screen shader as vec4s; cover() is the same geometry on the CPU,
// used for heating (how much of the beam lands on material). Damage maps cover W × W µm around the origin.
// name, de (the German term in English, Ruska's own wording in German) and info are [en, de].
// absorb: fraction of the beam power deposited at 75 kV; hk: heating per watt-like unit (conduction);
// charT / breakT: °C where charring and destruction start.

export const SPECIMENS = {
  grid: {
    id: 0, name: ['Platinum grid', 'Platinnetz'], de: ['Platinnetz', 'Platinum grid'], year: 1931, W: 9000, start: [40, -60],
    absorb: 1, hk: 50, charT: 1e9, breakT: 1150, cover: 0.42, kappa: 1,
    geo: [[340, 70, 0, 0]],
    info: ['A fine platinum mesh, the test object of 7 April 1931. Its wires stop the electrons completely, so the image is a shadow. At the beam current needed for 17.4×, Ruska wrote, such grids were burnt to cinders.', 'Ein feines Platinnetz, das Testobjekt vom 7. April 1931. Seine Drähte halten die Elektronen vollständig auf, das Bild ist also ein Schattenbild. Bei dem Strahlstrom, den die 17,4-fache Vergrößerung verlangte, verbrannten solche Netze, wie Ruska schrieb, völlig.'],
  },
  mesh: {
    id: 1, name: ['Measuring object', 'Meßobjekt'], de: ['Blind- und Meßobjekt', 'Ruska 1934: „Blind- und Meßobjekt“'], year: 1933, W: 600, start: [4, -3],
    absorb: 1, hk: 2.2, charT: 1e9, breakT: 1e9, cover: 0.45, kappa: 1,
    geo: [[25, 6, 0, 0]],
    info: ['A heat-proof metal mesh in the object-change chamber. Ruska lit the discharge and set the coils on it with a strong beam, then swung in the real specimen, so the two had to sit at exactly the same height.', 'Ein wärmeunempfindliches Metallnetz in der Objektwechselkammer. Ruska zündete die Entladung und stellte die Spulen mit kräftigem Strahl daran ein, dann klappte er das eigentliche Objekt vor. Beide mussten deshalb genau in derselben Ebene liegen.'],
  },
  cotton: {
    id: 2, name: ['Cotton fibre', 'Baumwollfaser'], de: ['Baumwollgespinst', 'Ruska 1934: „Baumwollgespinst, verkohlt“'], year: 1933, W: 420, start: [6, 3],
    absorb: 0.3, hk: 6, charT: 230, breakT: 520, kappa: 1,
    geo: [[0, 0, 0.35, 5], [-40, 46, -0.62, 5], [70, -52, 1.3, 5], [-92, -70, 0.12, 5], [30, 110, 2.6, 5]],
    info: ['Ruska’s best test objects were cotton fibres, about 5 µm thick, carbonized by the beam itself in the vacuum until they were extremely thin. He watched the charring on the intermediate screen at 85× and held it back with the discharge current and the condenser.', 'Ruskas beste Testobjekte waren Baumwollfasern, etwa 5 µ dick, die der Strahl selbst im Vakuum verkohlte, bis sie äußerst dünn waren. Er verfolgte die Verkohlung auf dem Zwischenbild bei 85-facher Vergrößerung und regelte die Bestrahlung mit Röhrenstrom und Kondensorspule.'],
  },
  foil: {
    id: 3, name: ['Aluminium foil', 'Aluminiumfolie'], de: ['Aluminiumfolie, 0,8 µ', 'Ruska 1934: „0,8 µ Al-Folie“'], year: 1933, W: 220, start: [-2, 2],
    absorb: 0.25, hk: 2.6, charT: 260, breakT: 330, kappa: 1,
    geo: [[4, -3, 1.2, 0], [-12, 9, 2.5, 0], [20, 14, 0.8, 0], [-25, -18, 3.5, 0], [35, -25, 1.6, 0], [-6, 30, 1.1, 0]],
    info: ['Rolled aluminium 0.8 µm thick, imaged at 7,800×. Heating by the beam opens small holes and cracks in it, and their sharp edges are the best test of the lenses: an edge that is sharp across the whole field means no aperture error and no astigmatism.', 'Gewalztes Aluminium von 0,8 µ Dicke, aufgenommen bei 7.800-facher Vergrößerung. Die Erwärmung durch den Strahl reißt kleine Löcher und Risse hinein, und deren scharfe Kanten sind der beste Prüfstein der Linsen: Eine Kante, die über das ganze Bildfeld scharf ist, zeigt weder Öffnungsfehler noch Astigmatismus.'],
  },
  wing: {
    id: 4, name: ['House-fly wing', 'Fliegenflügel'], de: ['Flügel der Stubenfliege', 'Driest und Müller, 1935'], year: 1935, W: 640, start: [-20, 30],
    absorb: 0.2, hk: 6, charT: 180, breakT: 360, kappa: 1,
    geo: [[-120, 0.04, 18, 0], [60, -0.03, 22, 0], [190, 0.28, 14, 0]],
    info: ['The first electron micrograph of an insect, taken in 1935 by Driest and Müller on Ruska’s 1933 instrument at 60 kV and 2,200×. The wing membrane is covered with tiny hairs, the microtrichia, a few micrometres long.', 'Die erste elektronenmikroskopische Aufnahme eines Insekts, 1935 von Driest und Müller an Ruskas Gerät von 1933 aufgenommen, bei 60 kV und 2.200-facher Vergrößerung. Die Flügelhaut ist mit winzigen Härchen besetzt, den Mikrotrichien, wenige Mikrometer lang.'],
  },
  diatom: {
    id: 5, name: ['Diatom', 'Kieselalge'], de: ['Amphipleura pellucida', 'Amphipleura pellucida, Krause 1937'], year: 1937, W: 320, start: [-38, -44],
    absorb: 0.35, hk: 4.5, charT: 300, breakT: 700, kappa: 1,
    geo: [[0, 0, 0.2, 110], [92, 58, 1.9, 96], [-74, 82, -0.7, 122]],
    info: ['A silica shell whose rows of pores, about 0.25 µm apart, were the classic test of the finest oil-immersion light microscopes. Friedrich Krause resolved 130 nm on it in 1937 on Ruska’s instrument at 53 kV and 3,500×.', 'Eine Kieselschale, deren Porenreihen, etwa 0,25 µm voneinander entfernt, der klassische Prüfstein der besten Ölimmersions-Lichtmikroskope waren. Friedrich Krause löste 1937 an Ruskas Gerät bei 53 kV und 3.500-facher Vergrößerung 130 nm auf.'],
  },
};
export const BY_ID = Object.values(SPECIMENS);

const lanceolate = (g, x, y) => {
  const c = Math.cos(g[2]), s = Math.sin(g[2]), dx = x - g[0], dy = y - g[1];
  const a = dx * c + dy * s, n = -dx * s + dy * c, A = g[3] / 2;
  const u = a / A; if (Math.abs(u) >= 1) return false;
  return Math.abs(n) < g[3] * 0.0375 * Math.pow(1 - u * u, 0.75);
};

// fraction of the beam hitting material at (x, y), and whether a feature of interest is there
export function cover(key, x, y, r = 0) {
  const S = SPECIMENS[key];
  switch (key) {
    case 'grid': case 'mesh': return S.cover;
    case 'cotton': {
      for (let i = 0; i < S.geo.length; i++) {
        const g = S.geo[i], c = Math.cos(g[2]), s = Math.sin(g[2]), dx = x - g[0], dy = y - g[1];
        const a = dx * c + dy * s; let n = -dx * s + dy * c;
        n -= 6 * Math.sin(a / 45 + i * 1.7);
        if (Math.abs(n) < g[3] * 0.5 + r) return Math.min(1, (g[3] * 0.5 + r - Math.abs(n)) / (g[3] * 0.5) + 0.2);
      }
      return 0.02;
    }
    case 'foil': return 1;
    case 'wing': return Math.abs(y) < 250 + 8 * Math.sin(x / 37) ? 1 : 0;
    case 'diatom': return S.geo.some((g) => lanceolate(g, x, y)) ? 1 : 0.02;
  }
  return 0;
}

// Is a diatom under the screen center, and how far from its edge (for the 1937 mission)
export const onDiatom = (x, y) => SPECIMENS.diatom.geo.some((g) => lanceolate(g, x, y));
