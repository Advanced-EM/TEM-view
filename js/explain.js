// Plain-English explanations of what each mode shows and what each control physically changes.
import * as P from './physics.js';
import { stemDetType, AP_MRAD } from './sim.js';
import { tomoStats } from './techniques.js';

const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const sgn = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);

function optics(S, sim) {
  const lam = P.wavelength(S.kV), Cs = sim.CsA();
  return {
    lam, Cs, beta: P.betaOf(S.kV), gam: P.gammaOf(S.kV),
    pr: P.pointResolution(Cs, lam), il: P.infoLimit(lam, 32),
    sch: Cs !== 0 ? P.scherzerDefocus(Cs, lam) / 10 : null,
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
    case 'ronch': {
      const R = sim.ronch;
      return {
        title: 'Tuning the <em>corrector</em>',
        body: `With the probe parked on thin amorphous carbon and a <b>large aperture</b>, the camera records a <b>Ronchigram</b>: a shadow image of the specimen whose local magnification is set by the lens’s aberrations. Where the aberration phase is flat, the shadow is infinitely magnified into a smooth, featureless <b>“sweet spot”</b>; outside it, streaks and rings reveal each aberration’s symmetry: 2-fold stretch (A1), comet-like coma (B2), triangles (A2), squares (A3). A corrector’s job is to make that sweet spot as large and round as possible. The <b>π/4 criterion</b> (phase error below π/4) sets the usable probe aperture, and the aperture sets resolution. Scramble the aberrations and try it by hand, or let the corrector software do it. Residual aberrations carry into every STEM and TEM image.`,
        stats: [
          ['Flat-phase angle', R.flat ? `${(R.flat * 1000).toFixed(1)} mrad` : '—', 'π/4 criterion'],
          ['Best probe', R.flat ? `${((0.61 * o.lam) / R.flat).toFixed(2)} Å` : '—', 'diffraction limit at that angle'],
          ['Ronchigram aperture', `${S.ronchAp} mrad`, 'deliberately oversized'],
        ],
      };
    }
    case 'cbed': {
      const cb = sim.cbed, f = cb.fit?.best, lac = S.cbedKind === 'lacbed';
      return {
        title: lac ? 'Lines that map <em>defects and strain</em>' : 'Diffraction with a <em>cone</em> of electrons',
        body: lac
          ? `<b>Large-angle CBED</b> (Tanaka): the probe is defocused above the specimen so the cone can be huge (tens of mrad) without the disks overlapping; a selected-area aperture passes one disk. Every point in that disk is a different incident direction, so it’s crossed by <b>Bragg lines</b> (where a ZOLZ reflection is excited) and very fine <b>HOLZ lines</b>. HOLZ lines come from reflections far out in reciprocal space, so their positions shift measurably with a <b>0.1% lattice change</b> or a small voltage change. They are a classic tool for local strain and voltage calibration. The faint shadow image shows where on the specimen each part of the pattern comes from; lines bend or break at defects and boundaries.`
          : `Instead of a parallel beam, a <b>cone</b> of electrons (semi-angle α) is focused to a nm-sized spot, so every Bragg spot becomes a <b>disk</b>. Inside each disk, the incident direction varies from point to point, so you see the rocking curve directly: dynamical <b>Kossel–Möllenstedt fringes</b> whose spacing measures the specimen <b>thickness</b> and the <b>extinction distance</b>. The disks’ symmetry gives the crystal’s <b>point and space group</b>. The fine dark lines in the central disk are <b>HOLZ lines</b> from higher-order Laue zones, sensitive to lattice parameter. When α exceeds half the Bragg angle the disks overlap (a Kossel pattern).`,
        stats: lac
          ? [['Convergence α', `${S.alphaLA} mrad`, 'large-angle'], ['Lattice strain', `${S.strain >= 0 ? '+' : ''}${S.strain.toFixed(2)} %`, 'moves HOLZ lines'], ['Wavelength', `${f2(o.lam * 100)} pm`, 'HOLZ lines also calibrate kV']]
          : [['Convergence α', `${S.alphaCB} mrad`, 'disk radius'], ['Fitted thickness', f ? `${(f.t / 10).toFixed(1)} nm` : '—', `true ${S.thick} nm`], ['Extinction distance', f ? `${(f.xi / 10).toFixed(0)} nm` : '—', 'from the same fit']],
      };
    }
    case 'microed': {
      const M = sim.med, allowed = M.refl.filter((r) => r.allowed).length;
      return {
        title: 'Crystal structures from <em>nanocrystals</em>',
        body: `<b>3D electron diffraction</b> (MicroED / continuous-rotation ED): a single nanocrystal, far too small for X-rays, is rotated continuously in a nearly parallel, very low-dose beam while a fast <b>direct electron detector</b> records diffraction frames, like a movie. Each frame catches the reflections crossing the Ewald sphere during that slice of rotation. Put back into the crystal’s frame, the frames fill a <b>3D reciprocal lattice</b> (right), from which the unit cell and <b>systematic absences</b> (lattice centring, glide planes) are read, then intensities are used to solve the structure. The goniometer can’t rotate a full 180°, leaving a <b>missing wedge</b> of unmeasured reflections. Dynamical scattering in thick crystals perturbs intensities, which is why MicroED works best on crystals thinner than ~200 nm.`,
        stats: [
          ['Completeness', `${Math.round((100 * M.obs.size) / Math.max(1, allowed))} %`, `±${S.medRange}° rotation`],
          ['Frames', `${M.frames}`, `${S.medOsc}° each`],
          ['Lattice', M.result ? M.result.lattice.split(' ')[0] : '…', M.result ? `a = ${M.result.a.toFixed(3)} Å` : 'after the sweep'],
        ],
      };
    }
    case 'tomo': {
      const st = tomoStats(S, sim.tomo);
      return {
        title: 'Seeing in <em>three dimensions</em>',
        body: `An electron image is a <b>projection</b>: everything along the beam is summed. <b>Tomography</b> tilts the specimen step by step and records a projection at each angle; HAADF-STEM is ideal because its intensity is (nearly) a linear projection of mass and Z. Mathematically each projection is a slice of the object’s 3D Fourier transform (the <b>central-slice theorem</b>), so combining them fills 3D Fourier space. It’s reconstructed by <b>weighted back-projection</b> (smearing each filtered projection back through the volume) or iterative <b>SIRT</b>. The holder can’t tilt to ±90°, so a <b>missing wedge</b> of information elongates features along the beam, clearly visible in the YZ slice. Compare it with the ground truth.`,
        stats: [
          ['Projections', `${st.nP}`, `±${S.tomoRange}° every ${S.tomoStep}°`],
          ['Crowther resolution', `${st.crowther.toFixed(1)} nm`, 'd = πD/N for a 46 nm object'],
          ['Elongation (beam axis)', `${st.elong.toFixed(2)}×`, 'from the missing wedge'],
        ],
      };
    }
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
      if (stemLike) return ['Probe focus', `Defocus <b>${sgn(S.df)} nm</b> moves the probe’s crossover ${S.df < 0 ? 'below' : 'above'} the specimen (see the beam in 3D). ${o.Cs !== 0 && Math.abs(S.df - P.probeDefocus(o.Cs, o.lam) / 10) < 0.6 ? `This is the optimum for C<sub>s</sub> = ${S.corrector ? S.csCor + ' µm' : S.csUnc + ' mm'}: a little ${S.df < 0 ? 'underfocus' : 'overfocus'} cancels the ${o.Cs > 0 ? 'positive' : 'negative'} spherical aberration at the aperture edge, so the probe is tightest` : Math.abs(S.df) < 2 ? 'Near focus the probe is tightest' : 'Out of focus the probe spreads into a blurred halo'}: FWHM is now <b>${probe ? f2(probe) : '—'} Å</b>. Depth of field is about λ/α² ≈ <b>${f1(o.lam / (a * a) / 10)} nm</b>, so with a wide cone you can focus through the thickness of a sample, slice by slice.`];
      return ['Objective defocus', `Defocus <b>${sgn(S.df)} nm</b>. The lens adds a phase χ(k) = πλΔf k² + ½πC<sub>s</sub>λ³k⁴ to each spatial frequency, and <b>−sin χ</b> decides whether that frequency shows up dark, bright, or not at all (curve at right). ${o.sch === null ? 'With C<sub>s</sub> = 0 there is no single optimum: a perfect lens shows a weak phase object only through defocus.' : o.Cs > 0 ? `Near <b>Scherzer defocus (${f1(o.sch)} nm, underfocus)</b> a broad band transfers with one sign, so atoms look consistently dark.` : `With <b>negative C<sub>s</sub></b> the optimum flips to <b>overfocus (${sgn(o.sch)} nm)</b>: negative-C<sub>s</sub> imaging (NCSI). The transfer reverses sign, so atoms appear <b>bright</b>, and weak oxygen columns gain contrast.`} Away from it the contrast oscillates, which is why the Thon rings shrink and multiply and the image changes character.`];
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
    case 'ab': {
      const R = sim.ronch;
      return ['Residual aberrations', `A1 ${S.ab.A1} nm, B2 ${S.ab.B2} nm, A2 ${S.ab.A2} nm, A3 ${S.ab.A3} µm. Each aberration adds a phase that grows as a power of angle (θ², θ³, θ⁴), so higher orders only matter at large angles, which is why correctors null them in order: first C1 and A1, then B2 and A2, then C3 and A3. ${R.flat ? `The phase is flat (< π/4) out to <b>${(R.flat * 1000).toFixed(1)} mrad</b>, allowing a probe of about <b>${((0.61 * o.lam) / R.flat).toFixed(2)} Å</b>.` : ''} These residuals also blur the STEM and TEM images.`];
    }
    case 'scramble': return ['Aberrations scrambled', 'The corrector has drifted: astigmatism, coma, 3-fold and 4-fold terms are all present, and the sweet spot has shrunk and distorted. Look at the <b>shape</b> of the Ronchigram: two-fold stretching means A1, a one-sided comet means B2, a triangle means A2. Null them one at a time with the sliders, watching the flat-phase circle grow. Or press Auto-tune.'];
    case 'autotuned': return ['Corrector tuned', `The corrector software measured the aberrations from Ronchigrams and cancelled them order by order. The flat-phase region now reaches <b>${sim.ronch.flat ? (sim.ronch.flat * 1000).toFixed(1) : '—'} mrad</b>. Real systems iterate the same loop: measure (Ronchigram or Zemlin tableau fitting), correct, re-measure. The residuals left are set by measurement noise and instabilities.`];
    case 'ronchAp': return ['Ronchigram aperture', `A deliberately oversized <b>${S.ronchAp} mrad</b> aperture shows where the aberration-free region ends. For imaging you would then choose a probe aperture about the size of the flat-phase circle.`];
    case 'cbedKind': return S.cbedKind === 'lacbed'
      ? ['LACBED', 'Large-angle CBED: a defocused probe and a selected-area aperture give one huge disk full of Bragg and HOLZ lines, with a shadow image of the specimen. Drag the pattern to move the boundary through the field and watch the lines break.']
      : ['CBED', 'A focused nanoprobe. Keep α below half the Bragg angle to separate the disks; tilt slightly off the zone axis so one reflection is strongly excited, then read the thickness from its fringes.'];
    case 'alphaCB': return ['Convergence angle', `Disk radius is α = <b>${S.alphaCB} mrad</b>. Larger α shows more of the rocking curve (more fringes, more HOLZ lines) until the disks overlap. For SrTiO₃ that happens above ~3.2 mrad at 200 kV, for Au above ~5 mrad.`];
    case 'alphaLA': return ['LACBED angle', `A <b>${S.alphaLA} mrad</b> cone. The wider it is, the more lines and the larger the area of specimen seen in the shadow image.`];
    case 'strain': return ['Lattice strain', `Lattice parameter changed by <b>${S.strain >= 0 ? '+' : ''}${S.strain.toFixed(2)} %</b>. HOLZ lines come from reflections with large g, where the Bragg condition is extremely sensitive to d-spacing, so they shift visibly for 0.1 % strain. That’s how CBED measures local strain in transistors. The same shift results from a change in accelerating voltage, which is why HOLZ lines also calibrate kV.`];
    case 'holz': return ['HOLZ lines', S.holz ? 'Showing higher-order Laue zone lines: fine deficiency lines where a reflection in the next reciprocal-lattice layer is exactly excited.' : 'HOLZ lines hidden: only zero-order (ZOLZ) dynamical contrast remains.'];
    case 'medRange': return ['Rotation range', `Rotating over <b>±${S.medRange}°</b>. Anything the rotation never brings through the Ewald sphere stays unmeasured: the missing wedge. Wider ranges raise completeness, but holders, grid bars and crystal shadowing limit it in practice (typically ±60–70°).`];
    case 'medRate': return ['Rotation speed', `<b>${S.medRate}°/s</b>. Real MicroED rotates slowly (~0.2–1°/s) at a dose rate of ~0.01 e⁻/Å²/s so a whole dataset uses only a few e⁻/Å², low enough for proteins.`];
    case 'medOsc': return ['Frame oscillation', `Each frame integrates <b>${S.medOsc}°</b> of rotation. Fine slicing samples each reflection’s rocking curve (partiality) more accurately; coarse slicing is faster but merges neighbouring reflections.`];
    case 'microed': return ['New rotation', 'Starting a fresh continuous-rotation dataset from the most negative angle.'];
    case 'tomoRange': return ['Tilt range', `<b>±${S.tomoRange}°</b>. The unmeasured wedge of Fourier space stretches features along the beam by about <b>${tomoStats(S, sim.tomo).elong.toFixed(2)}×</b>. Needle-shaped specimens on on-axis holders can reach ±90° and remove it.`];
    case 'tomoStep': return ['Tilt increment', `Every <b>${S.tomoStep}°</b> gives ${tomoStats(S, sim.tomo).nP} projections. By the Crowther criterion the resolution is ~πD/N ≈ <b>${tomoStats(S, sim.tomo).crowther.toFixed(1)} nm</b>: finer steps help, but every projection adds dose.`];
    case 'tomoAlg': return ['Reconstruction', S.tomoAlg === 'sirt' ? '<b>SIRT</b>: start from nothing, simulate projections of the current guess, compare with the data, and back-project the difference; repeat. It suppresses streaks and handles noise and the missing wedge better, at the cost of iterations.' : '<b>Weighted back-projection</b>: each projection is ramp-filtered (to undo the 1/|k| over-weighting of low frequencies) and smeared back through the volume. It’s fast and linear, but it shows streaks from sparse angles.'];
    case 'tomoIter': return ['SIRT iterations', `<b>${S.tomoIter}</b> iterations. Too few leaves the volume blurry; too many starts fitting the noise.`];
    case 'tomoView': return ['Compare', S.tomoView === 'truth' ? 'Showing the <b>ground-truth</b> object. Compare its YZ slice with the reconstruction to see the missing-wedge elongation.' : 'Showing the <b>reconstruction</b> from the tilt series.'];
    case 'tomoSlice': return null;
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
  rows.push(['Residual A1 / B2 / A2', `${S.ab.A1} / ${S.ab.B2} / ${S.ab.A2} nm`]);
  rows.push(['Residual A3', `${S.ab.A3} µm`]);
  rows.push(['Dose', `${Math.round(S.dose).toLocaleString()} e⁻/Å²`]);
  rows.push(['Inelastic mean free path', `${Math.round(P.imfp(S.kV, sim.spec.zeff))} nm`]);
  rows.push(['Knock-on damage (C)', S.kV > 86 ? 'above threshold' : 'below threshold']);
  return rows;
}
