// Plain-English explanations of what each mode shows and what each control physically changes.
import * as P from './physics.js';
import { stemDetType, AP_MRAD } from './sim.js';

const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const sgn = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);

function optics(S, sim) {
  const lam = P.wavelength(S.kV), Cs = sim.CsA();
  return {
    lam, Cs, beta: P.betaOf(S.kV), gam: P.gammaOf(S.kV),
    pr: P.pointResolution(Cs, lam), il: P.infoLimit(lam, 32),
    sch: Cs > 0 ? P.scherzerDefocus(Cs, lam) / 10 : null,
    aopt: 1.27 * Math.pow(lam / Math.abs(Cs), 0.25) * 1000,
  };
}

export function modeInfo(S, sim) {
  const o = optics(S, sim), spec = sim.spec;
  const probe = sim.probe?.fwhm;
  switch (S.mode) {
    case 'tem': return {
      title: 'A wave that <em>interferes with itself</em>',
      body: `A broad, parallel electron wave floods the specimen. Atoms hardly absorb electrons; instead they <b>shift the phase</b> of the wave passing through them. The objective lens turns those invisible phase shifts into light and dark by recombining scattered and unscattered waves with a deliberate touch of <b>defocus</b>, just like phase-contrast light microscopy. So the dots are interference fringes, not photographs of atoms: change focus and black can swap for white. Right: the image's Fourier transform, whose <b>Thon rings</b> are the lens's fingerprint.`,
      stats: [
        ['Wavelength', `${f2(o.lam * 100)} pm`, `${Math.round(0.53 / o.lam)}× smaller than a hydrogen atom`],
        ['Point resolution', `${f2(o.pr)} Å`, 'limited by spherical aberration'],
        ['Information limit', `${f2(o.il)} Å`, 'limited by the energy spread'],
      ],
    };
    case 'stem': {
      const t = stemDetType(S.detIn, S.detOut, S.alpha);
      return {
        title: 'A probe smaller than <em>an atom</em>',
        body: `The lenses squeeze the beam into a needle about an ångström wide and <b>raster</b> it across the sample like an old TV. At each point, detectors count what comes out. The ring-shaped <b>HAADF</b> detector catches electrons flung to high angles by close passes to the nucleus, a Rutherford-like process that grows roughly as <b>Z<sup>1.7</sup></b>. Brightness therefore reads almost directly as atomic number: gold blazes, carbon nearly vanishes. Right: the probe itself, and where each detector sits in the diffraction plane.`,
        stats: [
          ['Probe size', probe ? `${f2(probe)} Å` : '—', 'full width at half maximum'],
          ['Detector', `${t}`, `${S.detIn}–${S.detOut} mrad`],
          ['Gold vs carbon', `${Math.round(Math.pow(79 / 6, 1.7))}× brighter`, 'per atom, in HAADF'],
        ],
      };
    }
    case '4d': {
      const f = sim.fd;
      return {
        title: 'Record everything, <em>decide later</em>',
        body: `Instead of summing electrons on a fixed ring, a <b>direct electron detector</b> running at thousands of frames per second records the <b>entire diffraction pattern at every probe position</b>, a four-dimensional dataset: two scan axes × two detector axes. Detectors are designed afterwards, in software. Drag the orange shape on the pattern and the image rebuilds from stored data. <b>DPC</b> and <b>centre-of-mass</b> track how each atom's electric field nudges the beam sideways, and <b>ptychography</b> solves for the specimen's full phase from the overlapping patterns.`,
        stats: [
          ['Scan grid', f ? `${f.N} × ${f.N}` : '—', f ? `${f2(f.step)} Å steps` : ''],
          ['Each pattern', f ? `${f.n4} × ${f.n4} px` : '—', f ? `${f2(f.mradPx)} mrad per pixel` : ''],
          ['Real datasets', '10–100 GB', 'per scan, on modern detectors'],
        ],
      };
    }
    case 'diff': {
      const r = spec.rings[0];
      return {
        title: "The crystal's <em>reciprocal lattice</em>",
        body: `The lower lenses are refocused from the image to the objective's <b>back focal plane</b>, where every electron leaving the sample in the same direction lands on the same point. A crystal only scatters into <b>Bragg directions</b> (2d sin θ = λ), so it prints a lattice of spots; many randomly oriented crystals print rings. On the camera a spot sits at R = λL/d, so its position gives the spacing between atomic planes directly. The faint straight bands are <b>Kikuchi lines</b>: they are fixed to the crystal and swing as you tilt.`,
        stats: [
          ['Camera constant', `${f1(o.lam * S.camL)} Å·mm`, 'λL, used to index patterns'],
          [`{${r.hkl}} spacing`, `${f2(r.d)} Å`, `Bragg angle ${f1((o.lam / (2 * r.d)) * 1000)} mrad`],
          ['Ewald sphere', `${Math.round(1 / o.lam)} Å⁻¹`, 'radius; nearly flat, so many spots light up'],
        ],
      };
    }
    case 'eds': return {
      title: 'Atoms that <em>glow in X-rays</em>',
      body: `When a beam electron knocks out an inner-shell electron, an outer one drops into the hole and the atom emits an <b>X-ray</b> whose energy fingerprints the element (Moseley: E ∝ (Z − 1)²). A silicon-drift detector beside the specimen counts them. Only a tiny fraction of electrons ever produce a detected X-ray, so maps build up slowly and noisily; switch to realistic mode to watch them accumulate. The <b>Cu</b> peaks are a classic trap: they come from the copper grid holding the sample.`,
      stats: [
        ['X-rays counted', sim.acc ? Math.round(sim.acc.total).toLocaleString() : '—', `in ${sim.acc ? f1(sim.acc.t) : 0} s`],
        ['Detector resolution', '128 eV', 'FWHM at Mn Kα (5.9 keV)'],
        ['Probe size', probe ? `${f2(probe)} Å` : '—', 'sets the map resolution'],
      ],
    };
    case 'eels': {
      const imfp = P.imfp(S.kV, spec.zeff);
      return {
        title: 'Weighing <em>lost energy</em>',
        body: `Most electrons pass straight through, but some lose energy inside the sample. They excite <b>plasmons</b> (the collective sloshing of valence electrons, 15–30 eV) or ionise inner shells, which produces element-specific <b>edges</b>. A magnetic prism below the column bends slower electrons more, fanning the beam into a spectrum. Put an energy window on an edge to map one element. The fine structure just above an edge reveals bonding and oxidation state: at the Si/SiO₂ interface the oxide's Si L-edge sits about 6 eV higher.`,
        stats: [
          ['Relative thickness', sim.si ? `t/λ = ${f2(sim.si.tauMean)}` : '—', 'from the zero-loss fraction'],
          ['Mean free path', `${Math.round(imfp)} nm`, 'between inelastic events'],
          ['Energy resolution', `${sim.eelsRes().toFixed(2)} eV`, 'set by the gun’s energy spread'],
        ],
      };
    }
  }
}

export function changeText(key, S, sim) {
  const o = optics(S, sim), spec = sim.spec;
  const probe = sim.probe?.fwhm;
  const stemLike = S.mode !== 'tem' && S.mode !== 'diff';
  const a = (S.mode === '4d' ? S.alpha4d : S.alpha) * 1e-3;
  switch (key) {
    case 'kV': return ['Accelerating voltage', `At <b>${S.kV} kV</b> each electron travels at <b>${f2(o.beta)} c</b> and weighs ${o.gam.toFixed(2)}× its rest mass. Its wavelength is <b>${f2(o.lam * 100)} pm</b>. A shorter wavelength means smaller Bragg angles (watch the diffraction spots pull inward) and deeper penetration. The cost: above ~86 kV a head-on hit can knock a carbon atom clean out of graphene, so fragile materials are imaged at 60–80 kV. ${S.kV > 86 ? '<span class="warn">You are above the knock-on threshold for carbon.</span>' : '<span class="ok">Below the knock-on threshold for carbon.</span>'}`];
    case 'dose': {
      const dx = (S.fov * 10) / 224;
      return ['Electron dose', `<b>${Math.round(S.dose).toLocaleString()} electrons per Å²</b>, about ${Math.round(S.dose * dx * dx).toLocaleString()} per pixel. Images are built from individual electrons, so they carry <b>Poisson shot noise</b>: signal-to-noise grows only as √dose. Twice the clarity costs four times the electrons, and every electron can damage the sample. Cryo-EM of proteins survives only ~30 e⁻/Å² in total. ${S.clarity === 'real' ? '' : '<i>Switch to “physically realistic” to see the noise.</i>'}`];
    }
    case 'df':
      if (stemLike) return ['Probe focus', `Defocus <b>${sgn(S.df)} nm</b> moves the probe’s crossover ${S.df < 0 ? 'below' : 'above'} the specimen (see the beam in 3D). ${Math.abs(S.df) < 2 ? 'Near focus the probe is tightest' : 'Out of focus the probe spreads into a blurred halo'}: FWHM is now <b>${probe ? f2(probe) : '—'} Å</b>. Depth of field is about λ/α² ≈ <b>${f1(o.lam / (a * a) / 10)} nm</b>, so with a wide cone you can focus through the thickness of a sample, slice by slice.`];
      return ['Objective defocus', `Defocus <b>${sgn(S.df)} nm</b>. The lens adds a phase χ(k) = πλΔf k² + ½πC<sub>s</sub>λ³k⁴ to each spatial frequency, and <b>−sin χ</b> decides whether that frequency shows up dark, bright, or not at all (curve at right). ${o.sch !== null ? `Near <b>Scherzer defocus (${f1(o.sch)} nm)</b> a broad band transfers with one sign, so atoms look consistently dark.` : ''} Away from it the contrast oscillates, which is why the Thon rings shrink and multiply and the image changes character.`];
    case 'corrector':
    case 'cs':
      if (S.corrector) return ['Aberration corrector', `<b>Corrector on: C<sub>s</sub> = ${S.csCor} µm.</b> Round magnetic lenses always focus off-axis rays too strongly (Scherzer’s theorem, 1936). Multipole correctors, rings of hexapole or quadrupole-octupole magnets, cancel this, and in the late 1990s that pushed microscopes below 1 Å. Resolution is now set by chromatic effects: the information limit is <b>${f2(o.il)} Å</b>, and the ideal STEM convergence opens up to ~${Math.round(Math.min(60, o.aopt))} mrad.`];
      return ['Spherical aberration', `<b>Uncorrected lens: C<sub>s</sub> = ${S.csUnc} mm.</b> Rays far from the axis focus too strongly, so fine detail is scrambled. The point resolution is about <b>${f2(o.pr)} Å</b>, and STEM must use a small convergence (optimum ≈ ${Math.round(o.aopt)} mrad), which gives a wider probe. Turn on the corrector to see what 20 years of aberration-correction research bought.`];
    case 'objAp': {
      if (S.objAp === 'none') return ['Objective aperture', 'No aperture: every scattered beam reaches the image, including high-angle ones the lens transfers poorly. That gives the most detail and the most confusion.'];
      if (S.objAp === 'df') return ['Dark-field imaging', 'The aperture now admits <b>only one diffracted beam</b> and blocks the direct beam. Only crystals oriented to send electrons in exactly that direction light up; everything else goes dark. It’s the classic way to find which grain or nanoparticle has which orientation. In 3D, only one beam survives the aperture.'];
      const mr = AP_MRAD[S.objAp], d = o.lam / (mr * 1e-3);
      return ['Objective aperture', `A <b>${S.objAp} µm</b> aperture (~${mr} mrad) blocks electrons scattered to spacings finer than <b>${f2(d)} Å</b>. Blocked beams can’t interfere, so their lattice fringes vanish from the image; contrast shifts toward mass-thickness and diffraction contrast. In the 3D view, the stopped beams end at the aperture plate.`];
    }
    case 'alpha': {
      const dl = (0.61 * o.lam) / a, sa = 0.5 * Math.abs(o.Cs) * a * a * a;
      return ['Convergence angle', `A cone of <b>${Math.round(a * 1000)} mrad</b>. Wider cones focus to a smaller diffraction-limited spot (0.61λ/α ≈ ${f2(dl)} Å), but edge rays suffer more spherical aberration (∝ C<sub>s</sub>α³ ≈ ${f2(sa)} Å). The best probe balances the two, and the FWHM is now <b>${probe ? f2(probe) : '—'} Å</b>. ${S.mode === '4d' ? 'In 4D-STEM the angle also sets the disk size: small α gives separate disks for strain mapping, and large α gives overlapping disks whose interference encodes phase (ptychography).' : ''}`];
    }
    case 'det': {
      const t = stemDetType(S.detIn, S.detOut, S.alpha);
      const d = {
        BF: 'Bright field sits inside the illumination cone. By <b>reciprocity</b> it behaves like conventional TEM: coherent phase contrast that flips with focus.',
        ABF: 'Annular bright field is the outer rim of the bright-field disk. It’s sensitive to light atoms, so <b>oxygen</b> columns appear as dark dots next to the heavy ones.',
        ADF: 'Low-angle ADF mixes atomic-number contrast with <b>strain and diffraction contrast</b>. Defects and boundaries stand out.',
        HAADF: 'High-angle ADF collects only electrons scattered close to the nucleus. It’s incoherent, roughly <b>Z<sup>1.7</sup></b> contrast, and heavy columns are unambiguously brighter, with no contrast reversals.',
      }[t];
      return [`${t} detector`, `Collecting <b>${S.detIn}–${S.detOut} mrad</b> with a ${S.alpha} mrad probe. ${d}`];
    }
    case 'thick': {
      const tau = sim.si?.tauMean;
      return ['Specimen thickness', `<b>${S.thick} nm</b> thick. Thicker samples scatter more: electrons scatter several times (dynamical diffraction, plural plasmons), contrast washes out, and the energy spread blurs detail. HRTEM and EELS want samples thinner than one inelastic mean free path (~${Math.round(P.imfp(S.kV, spec.zeff))} nm here)${tau ? `; this is t/λ ≈ ${f2(tau)}` : ''}. A thicker crystal also has to be aligned more precisely.`];
    }
    case 'tilt': {
      const th = (Math.hypot(S.tiltX, S.tiltY) * Math.PI) / 180, sm = S.thick * 10 * Math.tan(th);
      return ['Specimen tilt', `Tilted <b>${f2(S.tiltX)}°, ${f2(S.tiltY)}°</b>. Atomic columns only look like dots when viewed exactly end-on; tilt and each column smears into a streak about <b>${f1(sm)} Å</b> long (t·tan θ). In diffraction the Ewald sphere cuts the lattice differently: spots on one side strengthen (the Laue circle), and the Kikuchi lines, which are locked to the crystal, sweep across the screen. That’s how microscopists steer back to a zone axis. ${sm > 2 ? '<span class="warn">Columns are blurred.</span>' : ''}`];
    }
    case 'fov': return ['Magnification', `Field of view <b>${f1(S.fov)} nm</b> (${f2((S.fov * 10) / 224)} Å per pixel). Magnification comes from the intermediate and projector lens currents, not from moving glass. To resolve a spacing you need at least two pixels across it (Nyquist), so zooming out eventually hides the lattice even though the optics still resolve it.`];
    case 'stage': return ['Stage', `Specimen moved to <b>(${f1(S.cx / 10)}, ${f1(S.cy / 10)}) nm</b>. A piezo stage can position a sample to picometre precision. The specimen extends far beyond the field of view; drag to explore it.`];
    case 'camL': return ['Camera length', `<b>L = ${Math.round(S.camL)} mm.</b> The intermediate lens magnifies the diffraction pattern: a spot sits at R = λL/d from the centre. Longer L spreads spots apart for precise measurement; shorter L captures high-angle reflections and <b>HOLZ</b> rings. The camera constant λL = ${f1(o.lam * S.camL)} Å·mm is what you calibrate to index a pattern.`];
    case 'sa': return ['Selected-area aperture', `Selecting a <b>${f1(S.sa)} nm</b> region of the specimen. Only electrons that pass through this area reach the pattern. ${spec.poly ? 'A larger area includes more nanoparticles, and their random orientations spread spots into rings.' : spec.id === 'sto' ? 'Straddling the boundary gives two superimposed patterns, one per grain.' : 'Including the oxide adds a diffuse amorphous halo.'} A finite area also broadens each spot: size ∝ 1/diameter.`];
    case 'camera': return S.camera === 'screen'
      ? ['Fluorescent screen', 'A phosphor-coated plate glows green where electrons hit (green because that’s where the eye is most sensitive). It’s instant and intuitive, but the light spreads inside the phosphor (blur) and only a fraction of electrons are effectively recorded. Today it’s mostly used to find your way around.']
      : ['Direct electron detector', 'A radiation-hard CMOS sensor that <b>counts individual electrons</b> directly, with no scintillator and no light, at thousands of frames per second. Near-perfect detection efficiency and sharp point response. Direct detectors started the cryo-EM “resolution revolution” and made 4D-STEM, DPC and ptychography practical: they are fast enough to record a full diffraction pattern at every probe position. Watch the screen swing up in 3D.'];
    case 'beamStop': return ['Beam stop', 'The direct beam is ~10⁴× brighter than the diffracted spots and can saturate or damage the camera. A metal pointer blocks it so faint reflections can be recorded.'];
    case 'spec': return ['Specimen', {
      au: 'Gold nanoparticles on amorphous carbon. Gold (Z = 79) is 13× heavier than carbon, so in HAADF the particles blaze and the support vanishes. Each particle is its own crystal with its own orientation, so the diffraction pattern becomes <b>rings</b>. Try dark field in TEM to light up only the particles that share one orientation.',
      si: 'The silicon/silicon-dioxide interface, the heart of every transistor. Crystalline Si viewed along [110] shows <b>dumbbells</b>: pairs of atom columns only 1.36 Å apart, a classic resolution test. The oxide is amorphous: no lattice, no spots, only a diffuse halo.',
      sto: 'Strontium titanate with a <b>Σ5 grain boundary</b>: two crystals rotated 36.9° relative to each other. In HAADF, Sr columns (Z = 38) outshine Ti–O columns; pure oxygen columns appear only in ABF or centre-of-mass imaging. Boundaries like this control conduction in oxide electronics.',
    }[S.spec]];
    case 'clarity':
      return S.clarity === 'real'
        ? ['Physically realistic', 'Poisson shot noise at your chosen dose, grayscale detectors, counts accumulating in real time, log-scale spectra, crystal-field-split Ti L₂,₃ white lines, Kikuchi bands and faster electrons. This is closer to what a microscopist actually sees at the console.']
        : ['Educational clarity', 'Noise-free signals, false colour, labels, slower and brighter electrons. The physics underneath is identical; it’s just drawn to be read.'];
    case 'vdet': return ['Virtual detector', {
      bf: 'A <b>virtual bright-field</b> disk: summing the undiffracted cone. Phase contrast, like TEM.',
      abf: 'A <b>virtual annular bright-field</b> ring at the edge of the disk. It picks up light atoms such as oxygen.',
      adf: 'A <b>virtual ADF</b> ring outside the bright-field disk. Heavier columns scatter more into it.',
      disk: 'A small <b>virtual aperture</b> on one diffracted disk. It’s a dark-field image computed after the experiment. Drag it onto different disks and grains light up differently.',
      dpc: '<b>Differential phase contrast</b>: a disk detector cut into four quadrants. When an atom’s electric field pushes the beam sideways, one quadrant gets more electrons than its opposite (A−C, B−D). Colour shows the push direction. DPC hardware exists as real segmented detectors; with a direct electron detector you synthesise it afterwards.',
      ptycho: '<b>Electron ptychography</b>: overlapping diffraction patterns jointly determine the specimen’s phase, the one thing a detector cannot measure directly. The ePIE algorithm iterates: guess the object, predict each pattern, keep the predicted phase but enforce the measured amplitudes, update the object. It’s running live on the patterns recorded here. Ptychography holds the resolution record for any microscope (~0.2 Å, limited by thermal vibration of the atoms).',
      com: 'The <b>centre of mass</b> of each pattern. The electron beam is deflected by the atoms’ electric fields; colour shows direction, brightness shows strength. It’s a map of the field itself, with arrows in educational mode.',
    }[S.vdet]];
    case 'eelsWin': {
      const w0 = S.eelsWin - S.eelsWidth / 2, w1 = S.eelsWin + S.eelsWidth / 2;
      const hit = P.EDGES.filter((e) => sim.si?.comp[e.key] && e.E < w1 && e.E > w0 - 40).map((e) => e.name);
      if (w1 < 6) return ['Energy window', 'Window on the <b>zero-loss peak</b>: only electrons that lost no energy. Thin regions transmit more of them, so the map is brightest where the sample is thinnest. Energy filtering also sharpens images and diffraction by removing the chromatic blur.'];
      if (w1 < 60) return ['Energy window', `Window at <b>${Math.round(w0)}–${Math.round(w1)} eV</b>, on the <b>plasmon</b> peak. Collective oscillations of valence electrons: the probability of exciting one grows with thickness, so this is essentially a thickness map. Plasmon energy also shifts with electron density, which is how aluminium alloys and hydrides are mapped.`];
      return ['Energy window', `Window at <b>${Math.round(w0)}–${Math.round(w1)} eV</b>${hit.length ? `, on the <b>${hit.join(' and ')}</b> edge` : ', between edges'}. ${S.bgsub ? 'The smooth power-law background extrapolated from before the edge is subtracted, and what remains is the signal from atoms whose inner shells sit in this range.' : 'Background is <b>not</b> subtracted, so the map is dominated by thickness, not chemistry. Real analysis always fits and removes the pre-edge power law.'}`];
    }
    case 'eelsRange': return ['Spectrum range', { low: 'Low loss: zero-loss peak, band gap onset and plasmons. It’s the strongest part of the spectrum, and it tells you thickness and dielectric properties.', core: 'Core loss: ionisation edges of light and transition-metal elements (C, O, Si, Ti, Sr). The signal is 100–10,000× weaker than the plasmons, riding on a steep background.', high: 'High loss: deep edges of heavy elements (Si K, Sr L, Au M). The signal is faint; you need a thin sample and long exposures.' }[S.eelsRange]];
    case 'bgsub': return ['Background subtraction', S.bgsub ? 'Fitting A·E<sup>−r</sup> before the edge and subtracting it: the element map now shows chemistry.' : 'Raw window intensity: mostly a thickness map, because the background under an edge scales with thickness too.'];
    case 'edsSel': {
      if (S.edsSel === 'all') return ['Element maps', 'All elements overlaid in false colour. Each pixel is a separate X-ray spectrum; the colour intensity is the count in each element’s main peak.'];
      const L = P.XRAY.find((l) => l.el === S.edsSel && l.w === 1);
      return ['Element map', `Mapping <b>${S.edsSel}</b> using counts in its ${L?.line} peak at ${L?.E.toFixed(3)} keV. Each pixel is a histogram of X-rays, so sparse pixels look speckled. That’s why EDS maps are often binned or smoothed, and why atomic-resolution EDS needs long, stable acquisitions.`];
    }
    case 'single': return sim.single
      ? ['One electron at a time', 'The beam is now so faint that only one electron is in the column at a time. Each lands as a single dot at a random spot, yet the <b>pattern emerges</b>. Each electron’s wave passed through the whole specimen and interfered with itself; the image is the probability map of where it lands. This is the double-slit experiment, done with a microscope.']
      : ['Normal beam', 'Back to ~10⁸ electrons per second. The pattern is the same, formed instantly.'];
    case 'mode': return null;
  }
  return null;
}

export function dataRows(S, sim) {
  const o = optics(S, sim), a = (S.mode === '4d' ? S.alpha4d : S.alpha) * 1e-3;
  const rows = [
    ['Accelerating voltage', `${S.kV} kV`],
    ['Electron speed', `${o.beta.toFixed(3)} c`],
    ['Relativistic mass', `${o.gam.toFixed(3)} m₀`],
    ['Wavelength', `${(o.lam * 100).toFixed(2)} pm`],
    ['Spherical aberration', S.corrector ? `${S.csCor} µm` : `${S.csUnc} mm`],
    ['Scherzer defocus', o.sch !== null ? `${o.sch.toFixed(1)} nm` : '—'],
    ['Point resolution', `${o.pr.toFixed(2)} Å`],
    ['Information limit', `${o.il.toFixed(2)} Å`],
  ];
  if (S.mode !== 'tem' && S.mode !== 'diff') {
    rows.push(['Probe size (FWHM)', sim.probe ? `${sim.probe.fwhm.toFixed(2)} Å` : '—']);
    rows.push(['Depth of field', `${(o.lam / (a * a) / 10).toFixed(1)} nm`]);
  }
  if (S.mode === 'diff') rows.push(['Camera constant λL', `${(o.lam * S.camL).toFixed(1)} Å·mm`]);
  rows.push(['Dose', `${Math.round(S.dose).toLocaleString()} e⁻/Å²`]);
  rows.push(['Inelastic mean free path', `${Math.round(P.imfp(S.kV, sim.spec.zeff))} nm`]);
  rows.push(['Knock-on damage (C)', S.kV > 86 ? 'above threshold' : 'below threshold']);
  return rows;
}
