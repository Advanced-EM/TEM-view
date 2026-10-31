// Plain-English explanations of what each mode shows and what each control physically changes.
import * as ML from './megalibrary.js';
import * as P from './physics.js';
import { MAGSPECS, fegeState, deflection } from './lorentz.js';
import { stemDetType, AP_MRAD } from './sim.js';
import { biprism } from './holography.js';

const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const sgn = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);

function optics(S, sim) {
  const lam = P.wavelength(S.kV), Cs = sim.CsA();
  return {
    lam, Cs, beta: P.betaOf(S.kV), gam: P.gammaOf(S.kV),
    pr: P.pointResolution(Cs, lam), il: sim.infoLimit(),
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
        body: `Instead of summing electrons on a fixed ring, a <b>direct electron detector</b> running at thousands of frames per second records the <b>entire diffraction pattern at every probe position</b>, a four-dimensional dataset: two scan axes × two detector axes. Detectors are designed afterwards, in software. Drag the orange shape on the pattern and the image rebuilds from stored data. <b>DPC</b> and <b>center-of-mass</b> track how each atom's electric field nudges the beam sideways, and <b>ptychography</b> solves for the specimen's full phase from the overlapping patterns.`,
        stats: [
          ['Scan grid', f ? `${f.N} × ${f.N}` : '—', f ? `${f2(f.step)} Å steps` : ''],
          ['Each pattern', f ? `${f.n4} × ${f.n4} px` : '—', f ? `${f2(f.mradPx)} mrad per pixel` : ''],
          ['Real datasets', '10–100 GB', 'per scan, on modern detectors'],
        ],
      };
    }
    case 'diff': {
      const r = spec.rings[0] ?? { hkl: 'hkl', d: NaN };
      return {
        title: "The crystal's <em>reciprocal lattice</em>",
        body: `The lower lenses are refocused from the image to the objective's <b>back focal plane</b>, where every electron leaving the sample in the same direction lands on the same point. A crystal only scatters into <b>Bragg directions</b> (2d sin θ = λ), so it prints a lattice of spots; many randomly oriented crystals print rings. On the camera a spot sits at R = λL/d, so its position gives the spacing between atomic planes directly. The faint straight bands are <b>Kikuchi lines</b>: they are fixed to the crystal and swing as you tilt.`,
        stats: [
          ['Camera constant', `${f1(o.lam * S.camL)} Å·mm`, 'λL, used to index patterns'],
          Number.isFinite(r.d) ? [`{${r.hkl}} spacing`, `${f2(r.d)} Å`, `Bragg angle ${f1((o.lam / (2 * r.d)) * 1000)} mrad`] : ['Plane spacing', 'd = λL / R', 'measure R on the pattern'],
          ['Ewald sphere', `${Math.round(1 / o.lam)} Å⁻¹`, 'radius; nearly flat, so many spots light up'],
        ],
      };
    }
    case 'eds': return {
      title: 'Atoms that <em>glow in X-rays</em>',
      body: `When a beam electron knocks out an inner-shell electron, an outer one drops into the hole and the atom emits an <b>X-ray</b> whose energy fingerprints the element (Moseley: E ∝ (Z − 1)²). A silicon-drift detector beside the specimen counts them. Only a tiny fraction of electrons ever produce a detected X-ray, so maps build up slowly and noisily; switch to realistic mode to watch them accumulate. The <b>Cu</b> peaks are a classic trap: they come from the copper grid holding the sample.`,
      stats: [
        ['X-rays counted', sim.acc ? Math.round(sim.acc.total).toLocaleString() : '—', `in ${sim.acc ? f1(sim.acc.t) : 0} s`],
        ['Detector resolution', `${Math.round(S.profile.edsFWHM)} eV`, 'FWHM at Mn Kα (5.9 keV), from the profile'],
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
    case 'oah': {
      const d = sim.oah.disp, bp = biprism(S.biprism, S.profile);
      return {
        title: 'Recording the <em>phase</em> itself',
        body: `Every camera records only intensity, |ψ|², so the electron wave's <b>phase</b> is lost. Off-axis holography gets it back with a <b>Möllenstedt biprism</b>: a wire thinner than a micron, held at a positive voltage below the specimen. Part of the beam passes through the specimen (the object wave), part through the vacuum beside it (the reference wave), and the wire bends the two toward each other so they overlap and <b>interfere</b>. The fringes shift sideways wherever the specimen delays the wave, so the hologram stores the phase as fringe displacements. In the Fourier transform the hologram splits into a center band and two <b>sidebands</b>: one of them is the complete image wave. Cut it out, center it, transform back, and you have amplitude and phase. Because the result is a complex wave, the lens aberrations can then be <b>removed numerically</b>. Holography maps electric and magnetic fields, mean inner potentials and dopant profiles. In 1989 Tonomura recorded a biprism pattern one electron at a time: try the single-electron experiment here.`,
        stats: [
          ['Fringe spacing', d ? `${f2(d.s)} Å` : '—', `biprism at ${S.biprism} V`],
          ['Fringe contrast', `${Math.round(bp.mu * 100)} %`, `over a ${f1(bp.W)} nm overlap`],
          ['Phase precision', d ? `2π/${Math.round((2 * Math.PI) / d.sig)}` : '—', `at ${Math.round(S.dose)} e⁻/Å²`],
        ],
      };
    }
    case 'ilh': {
      const st = sim.ilh.st;
      return {
        title: 'Phase from a <em>focal series</em>',
        body: `In-line holography needs no biprism: the reference wave is the unscattered beam itself, traveling along the same axis. A single image hides the phase (at perfect focus a thin specimen is almost invisible), but <b>defocus</b> converts phase into intensity, by a different amount at each focus and each spatial frequency. Recording a <b>focal series</b> and fitting all the images at once recovers the complete <b>exit wave</b>, the wave as it leaves the specimen before the lens degrades it. The reconstruction here is iterative (Gerchberg–Saxton style): guess the wave, propagate it to each focus, keep the computed phase but impose the measured amplitude, propagate back, average, repeat. The result is free of lens aberrations, and resolution reaches the <b>information limit</b> rather than the point resolution. Close to focus, fine detail is transferred; the large defocus values recover the slowly varying phase, so widen the focal step to bring back large features such as the gold particles or the oxide layer.`,
        stats: [
          ['Series', `${S.nFocal} images`, `${f1(S.focalStep)} nm steps, ${f1(S.focalStep * (S.nFocal - 1))} nm range`],
          ['Iterations', st ? `${st.it} / ${st.maxIt}` : '—', st && st.err.length ? `fit error ${st.err[st.err.length - 1].toExponential(1)}` : 'waiting for the series'],
          ['Information limit', `${f2(o.il)} Å`, `point resolution ${f2(o.pr)} Å`],
        ],
      };
    }
    case 'ltem': {
      const d = sim.lor.disp, sp = MAGSPECS[S.magSpec];
      return {
        title: 'Seeing <em>magnetic</em> domains',
        body: `A magnetized film deflects the electrons that cross it: the <b>Lorentz force</b> pushes each one sideways by a few <b>microradians</b>, in a direction set by the magnetization. Equivalently, the induction shifts the electron wave's <b>phase</b> (the Aharonov–Bohm effect). The objective lens is switched off, because its 2 T field would magnetize the specimen completely; a weak <b>Lorentz lens</b> images it instead, at micrometre fields of view. In focus, a magnetic film is a pure phase object and shows nothing. <b>Fresnel</b> imaging defocuses by hundreds of micrometres: where neighbouring domains deflect electrons toward each other, a wall appears <b>bright</b>; where they deflect away, it is <b>dark</b>. Reverse the defocus and every contrast flips. <b>Foucault</b> imaging stays in focus and blocks part of the back focal plane with a small displaced aperture, so only domains deflecting toward it stay bright. The <b>transport-of-intensity equation</b> turns an over- and an underfocused image into the phase, and the phase into a colour map of the induction direction.`,
        stats: [
          ['Lorentz deflection', d ? `${(d.betaS * 1e6).toFixed(1)} µrad` : '—', `${sp.short}, ${S.lorThick} nm thick`],
          ['Magnetic state', d?.info?.state ?? '—', S.magSpec === 'fege' ? `${Math.round(sim.temp())} K, ${S.lorField} mT along the beam` : 'objective lens off'],
          ['Defocus', `${S.lorDf} µm`, `divergence ${S.lorDiv} µrad`],
        ],
      };
    }
    case 'lstem': {
      const d = sim.lor.disp;
      return {
        title: 'Mapping the <em>induction</em> with a probe',
        body: `In Lorentz STEM a fine probe is scanned across the film. At each position the magnetic induction deflects the whole transmitted beam, so the bright-field disc on the detector moves sideways. A detector split into <b>four segments</b> measures that shift: the difference between opposite segments is the deflection along that direction. This is <b>differential phase contrast</b> (DPC), and the two differences together are a map of the in-plane induction, shown here as colour (hue = direction, brightness = strength). The probe's <b>convergence angle</b> is a trade-off. A larger angle gives a finer probe and sharper maps, but the deflection becomes a smaller fraction of the disc, so the signal shrinks against shot noise. A smaller angle gives a strong signal and a coarse probe, and once the deflection approaches the disc radius the segments saturate. Electrostatic phase gradients at film edges deflect the beam too, which is a classic DPC artifact.`,
        stats: [
          ['Max deflection β', d ? `${(d.betaS * 1e6).toFixed(1)} µrad` : '—', `${MAGSPECS[S.magSpec].short}`],
          ['Probe size', d ? (d.fwhm > 1e4 ? `${(d.fwhm / 1e4).toFixed(2)} µm` : `${(d.fwhm / 10).toFixed(1)} nm`) : '—', `α = ${Math.round(S.lorAlpha)} µrad`],
          ['β / α', d ? `${(d.sat * 100).toFixed(0)} %` : '—', 'linear while small, saturates near 100 %'],
        ],
      };
    }
    case 'eels': {
      const imfp = P.imfp(S.kV, spec.zeff);
      return {
        title: 'Weighing <em>lost energy</em>',
        body: `Most electrons pass straight through, but some lose energy inside the sample. They excite <b>plasmons</b> (the collective sloshing of valence electrons, 15–30 eV) or ionize inner shells, which produces element-specific <b>edges</b>. A magnetic prism below the column bends slower electrons more, fanning the beam into a spectrum. Put an energy window on an edge to map one element. The fine structure just above an edge reveals bonding and oxidation state: at the Si/SiO₂ interface the oxide's Si L-edge sits about 6 eV higher.`,
        stats: [
          ['Relative thickness', sim.si ? `t/λ = ${f2(sim.si.tauMean)}` : '—', 'from the zero-loss fraction'],
          ['Mean free path', `${Math.round(imfp)} nm`, 'between inelastic events'],
          ['Energy resolution', `${sim.eelsRes().toFixed(2)} eV`, 'set by the gun’s energy spread'],
        ],
      };
    }
  }
}

// what the holder and its temperature are doing to this specimen
function holderText(S, sim) {
  const spec = sim.spec, T = sim.temp(), th = sim.thermal(), fT = (K) => `${K < 20 ? K.toFixed(1) : Math.round(K)} K`;
  const u = (0.08 * Math.sqrt(th.u2r)).toFixed(3), strain = spec.alpha ? ` Thermal expansion strains the lattice by <b>${(th.eps * 100).toFixed(3)} %</b> relative to room temperature${spec.alpha < 0 ? ' (this material shrinks when heated)' : ''}, which moves CBED HOLZ lines.` : '';
  const dmg = spec.beamSensitive ? ` Radiolysis: the critical dose is <b>${sim.critDose().toFixed(1)} e⁻/Å²</b> at ${S.kV} kV here${T < 60 ? ', a little higher than with liquid nitrogen (liquid helium adds ~20–50 % for most organic matter, not the factor of several that cooling to 90 K gives)' : T < 170 ? ', several times the room-temperature value: fragments stay trapped instead of diffusing away' : T > 293 ? ', lower than at room temperature: heat speeds the chemistry up' : ''}.` : '';
  const heal = spec.twoD && T > 750 ? ' Hot graphene heals: vacancies fill with carbon from adatoms, and hydrocarbon contamination has desorbed (above ~450 K).' : spec.twoD && T > 450 ? ' The hydrocarbon contamination has desorbed from the hot graphene.' : '';
  const ice = spec.bio ? (T > 165 ? ' <span class="warn">Above ~165 K the ice sublimes in the vacuum, and the proteins will dry out.</span>' : T > 140 ? ' <span class="warn">Above ~140 K vitreous ice crystallizes, irreversibly.</span>' : ' The ice stays vitreous.') : '';
  const decomp = spec.thermalLimit && T > spec.thermalLimit ? ` <span class="warn">Above ~${spec.thermalLimit} K ${spec.bio ? 'the protein denatures' : 'the framework decomposes'} even without the beam.</span>` : '';
  const H = { room: ['Room temperature', 'The holder is at the room temperature of the column.'],
    ln2: ['Liquid-nitrogen cryo holder', 'A copper braid connects the tip to a liquid-nitrogen dewar (77 K); the grid sits a few kelvin warmer, and a heater can hold it anywhere up to room temperature.'],
    lhe: ['Liquid-helium cryo holder', 'Helium flows through the tip (4.2 K), but the grid lags behind: typically 8–15 K, with ±1–2 K fluctuations from boiling helium and more vibration and drift than a nitrogen holder.'],
    heat: ['MEMS heating holder', 'The specimen sits on a thin membrane with an embedded heater; it reaches 1200 °C in milliseconds with little drift, but its temperature reading is only good to about 1 %.'] }[S.holder];
  return [H[0], `${H[1]} Specimen now <b>${fT(T)}</b> (${Math.round(T - 273.15)} °C). Atoms vibrate with u_rms ≈ <b>${u} Å</b>${T < 30 ? ', almost only zero-point motion' : ''}: this broadens each atom, weakens high-order diffraction (Debye–Waller factor) and ${th.u2r > 1 ? 'strengthens' : 'weakens'} thermal-diffuse scattering into the HAADF detector.${strain}${dmg}${heal}${ice}${decomp} Drift: ${sim.driftSpeed().toFixed(2)} Å/s.`];
}

const fmtS = (t) => (t < 1e-3 ? `${+(t * 1e6).toPrecision(3)} µs` : t < 1 ? `${+(t * 1e3).toPrecision(3)} ms` : `${+t.toPrecision(3)} s`);
let lastKey = '';
const k0 = () => lastKey;
const EELS_LOW = -5;

export function changeText(key, S, sim) {
  lastKey = key;
  const o = optics(S, sim), spec = sim.spec;
  const probe = sim.probe?.fwhm;
  const stemLike = !['tem', 'diff', 'oah', 'ilh', 'ltem'].includes(S.mode);
  const a = (S.mode === '4d' ? S.alpha4d : S.alpha) * 1e-3;
  switch (key) {
    case 'kV': return ['Accelerating voltage', `At <b>${S.kV} kV</b> each electron travels at <b>${f2(o.beta)} c</b> and weighs ${o.gam.toFixed(2)}× its rest mass. Its wavelength is <b>${f2(o.lam * 100)} pm</b>. A shorter wavelength means smaller Bragg angles (watch the diffraction spots pull inward) and deeper penetration. The cost: above ~86 kV a head-on hit can knock a carbon atom clean out of graphene, so fragile materials are imaged at 60–80 kV. ${S.kV > 86 ? `<span class="warn">You are above the knock-on threshold for carbon.${spec.twoD ? ' Watch the graphene: in TEM or STEM, atoms are being sputtered and holes grow.' : ''}${spec.beamSensitive ? ` For ${spec.short} the danger is radiolysis, not knock-on: the critical dose is now ${sim.critDose().toFixed(1)} e⁻/Å², and it drops at lower voltage because slower electrons ionize more strongly.` : ''}</span>` : `<span class="ok">Below the knock-on threshold for carbon.${spec.twoD && S.kV > 55 ? ' Only weakly bonded edge atoms can still be displaced.' : ''}</span>${spec.beamSensitive ? ` <span class="warn">But for ${spec.short} lower voltage is worse: radiolysis grows as 1/β², so the critical dose falls to ${sim.critDose().toFixed(1)} e⁻/Å².</span>` : ''}`}`];
    case 'dose': {
      const dx = (S.fov * 10) / 224;
      if (spec.bio) return ['Electron dose', `<b>${S.dose} e⁻/Å²</b> per image. Proteins keep their finest (~3 Å) detail for only about <b>${sim.critDose().toFixed(0)} e⁻/Å²</b> at ${S.kV} kV${sim.isCold() ? ` at ${Math.round(sim.temp())} K` : ', warm'}; coarse features last longer. Single-particle cryo-EM spends ~40–60 e⁻/Å² spread over a movie of 40 or more frames, then weights the early, undamaged frames most. Past roughly four critical doses (~80–100 e⁻/Å² when cold), hydrogen gas forms <b>bubbles</b> inside the protein. ${S.clarity === 'real' ? 'At these doses shot noise dominates every image: that is why cryo-EM averages tens of thousands of particles.' : 'Switch to “physically realistic” to see how noisy a low-dose image is.'}`];
      if (spec.beamSensitive) return ['Electron dose', `<b>${S.dose} e⁻/Å²</b> per image. ${spec.short} tolerates only about <b>${sim.critDose().toFixed(1)} e⁻/Å²</b> in total at ${S.kV} kV before its lattice is gone, so every image spends part of the budget. Radiolysis breaks the linkers first: the fine detail and high-order diffraction spots disappear before the coarse ones. ${S.clarity === 'real' ? 'At these doses shot noise dominates: this is why MOF imaging needs direct electron detectors and dose-efficient methods.' : 'Switch to “physically realistic” to see how noisy a low-dose image is.'}`];
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
      if (S.objAp === 'zpp') return ['Zernike phase plate', `A thin carbon film sits in the back focal plane with a small hole in its center. The unscattered beam passes through the hole; every scattered beam crosses the film and is <b>delayed by a quarter wave</b> (π/2). That turns the transfer function from −sin χ, which is zero at focus, into <b>cos χ</b>, which is largest at focus: weak phase objects such as proteins become visible <b>without defocus</b>, so low spatial frequencies are kept and nothing is delocalized. Look for the bright <b>halo</b> around each particle: frequencies below the hole's cut-on (~${Math.round(1 / 0.004 / 10)} nm here) get no phase shift. Real plates also charge and age; the Volta phase plate, a continuous film whose shift builds up under the beam, avoids the hole.`];
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
    case 'stage': if (S.spec === 'lib') { const ij = ML.nearest(S.cx / 1e4, S.cy / 1e4); return ['Stage', `Stage at <b>(${(S.cx / 1e4).toFixed(3)}, ${(S.cy / 1e4).toFixed(3)}) µm</b>${ij ? `, over particle <b>(${ij[0]}, ${ij[1]})</b>` : ', outside the library'}. The particles sit on a 1 µm grid, each within ~60 nm of its node; a real stage lands within tens of nanometres of where it is sent, so an automated screen re-centres on each particle before it measures.`]; }
      return ['Stage', `Specimen moved to <b>(${f1(S.cx / 10)}, ${f1(S.cy / 10)}) nm</b>. A piezo stage can position a sample to picometer precision. The specimen extends far beyond the field of view; drag to explore it.`];
    case 'camL': return ['Camera length', `<b>L = ${Math.round(S.camL)} mm.</b> The intermediate lens magnifies the diffraction pattern: a spot sits at R = λL/d from the center. Longer L spreads spots apart for precise measurement; shorter L captures high-angle reflections and <b>HOLZ</b> rings. The camera constant λL = ${f1(o.lam * S.camL)} Å·mm is what you calibrate to index a pattern.`];
    case 'sa': return ['Selected-area aperture', `Selecting a <b>${f1(S.sa)} nm</b> region of the specimen. Only electrons that pass through this area reach the pattern. ${spec.poly ? 'A larger area includes more nanoparticles, and their random orientations spread spots into rings.' : spec.id === 'sto' ? 'Straddling the boundary gives two superimposed patterns, one per grain.' : 'Including the oxide adds a diffuse amorphous halo.'} A finite area also broadens each spot: size ∝ 1/diameter.`];
    case 'camera': return S.camera === 'screen'
      ? ['Fluorescent screen', 'A phosphor-coated plate glows green where electrons hit (green because that’s where the eye is most sensitive). It’s instant and intuitive, but the light spreads inside the phosphor (blur) and only a fraction of electrons are effectively recorded. Today it’s mostly used to find your way around.']
      : ['Direct electron detector', 'A radiation-hard CMOS sensor that <b>counts individual electrons</b> directly, with no scintillator and no light, at thousands of frames per second. Near-perfect detection efficiency and sharp point response. Direct detectors started the cryo-EM “resolution revolution” and made 4D-STEM, DPC and ptychography practical: they are fast enough to record a full diffraction pattern at every probe position. Watch the screen swing up in 3D.'];
    case 'beamStop': return ['Beam stop', 'The direct beam is ~10⁴× brighter than the diffracted spots and can saturate or damage the camera. A metal pointer blocks it so faint reflections can be recorded.'];
    case 'spec': return ['Specimen', {
      au: 'Gold nanoparticles on amorphous carbon. Gold (Z = 79) is 13× heavier than carbon, so in HAADF the particles blaze and the support vanishes. Each particle is its own crystal with its own orientation, so the diffraction pattern becomes <b>rings</b>. Try dark field in TEM to light up only the particles that share one orientation.',
      si: 'The silicon/silicon-dioxide interface, the heart of every transistor. Crystalline Si viewed along [110] shows <b>dumbbells</b>: pairs of atom columns only 1.36 Å apart, a classic resolution test. The oxide is amorphous: no lattice, no spots, only a diffuse halo.',
      mof: 'UiO-66, a zirconium <b>metal–organic framework</b>: Zr₆O₄(OH)₄ clusters on an fcc lattice (a = 2.07 nm), each joined to 12 neighbors by terephthalate linkers, leaving large open pores. Viewed along [110], the heavy Zr₆ clusters dominate (bright in HAADF); the organic linkers are faint. A patch where every fourth cluster is missing (reo-type defects) changes the contrast. The catch: MOFs are destroyed by <b>radiolysis</b> after only ~10 e⁻/Å² at 300 kV. Real MOF imaging relies on low-dose protocols, direct electron detectors and dose-efficient methods such as iDPC and 4D-STEM.',
      gr: 'Graphene: a single sheet of carbon atoms in a honeycomb, 0.335 nm thick, the thinnest possible specimen and an almost perfect <b>weak-phase object</b>. This sheet has a hole with hydrocarbon contamination at its edge, a single <b>Si dopant</b> atom (it blazes in HAADF: Z = 14 vs 6), a <b>Stone–Wales</b> defect (a bond rotated 90°, making two pentagons and two heptagons), vacancies, and a region where a second layer is twisted by 5°, producing a <b>moiré</b> with a ~2.8 nm period. At 200 kV the beam knocks atoms out; graphene is usually imaged at 60–80 kV.',
      bio: 'Proteins in <b>vitreous ice</b>, as in single-particle cryo-EM: apoferritin (a hollow 24-subunit protein shell, 12 nm across), ferritin (the same shell holding an iron-oxide core), and a lipid vesicle whose bilayer shows two dark lines, the phosphate head groups. The water was frozen so fast it never crystallized. Proteins scatter only slightly more than the ice around them, so they are <b>weak phase objects</b>: nearly invisible at focus, they appear with 1–3 µm of underfocus or with a <b>Zernike phase plate</b>. They are also fragile: about 20 e⁻/Å² at liquid-nitrogen temperature destroys the finest detail, and much less at room temperature. Keep the cryo holder on.',
      xyz: `${sim.spec.name.replace(/[<>&]/g, '')}. Every atom is placed where your file puts it and projected along the beam; tilting the stage rotates the structure, so zone axes and lattice fringes appear only in the orientations where atoms line up. It sits on a thin amorphous carbon support (the thickness setting). Elements without tabulated X-ray lines get estimates from Moseley's law.`,
      lib: 'A nanoparticle <b>megalibrary</b>: 1000 × 1000 alloy particles, 15–25 nm across, on a 1 µm grid on a 10 nm silicon-nitride membrane, as made by polymer pen lithography. A 10 × 10 array of pens each wrote a 100 × 100 block of polymer dots loaded with Au, Ag, Cu, Co and Ni salts; heating reduced each dot to one particle. The ink changes across the pens and the dot size along each block, so every particle (i, j) is a different synthesis condition. Au, Ag and Cu mix, and so do Co and Ni, but the two groups do not: particles with both separate into two crystals (heterostructures); others are single alloys, some twinned. Each particle has its own orientation, so lattice fringes appear only near a zone axis. Zoom out (up to 1.2 mm, the whole chip) to see the pen blocks: brighter where the dots are bigger or richer in gold. Use HAADF for size and shape, EDS for composition and diffraction for the lattice, and script the stage (Python: <code>goto(i, j)</code>) to screen thousands.',
      sto: 'Strontium titanate with a <b>Σ5 grain boundary</b>: two crystals rotated 36.9° relative to each other. In HAADF, Sr columns (Z = 38) outshine Ti–O columns; pure oxygen columns appear only in ABF or center-of-mass imaging. Boundaries like this control conduction in oxide electronics.',
    }[S.spec]];
    case 'fresh': return ['Fresh area', `The stage moved to an unexposed region: crystallinity is back to 100 %. At ${S.kV} kV the critical dose is about <b>${sim.critDose().toFixed(1)} e⁻/Å²</b>, so at ${S.dose} e⁻/Å² per image you get roughly ${Math.max(1, Math.round(sim.critDose() / S.dose))} good image(s). Low-dose workflows focus on a neighboring area and only then blank the beam onto the region of interest.`];
    case 'restore': return ['Pristine again', 'All sputtered atoms are back. At 60–80 kV the lattice survives indefinitely; above the ~86 kV knock-on threshold, holes nucleate at defects and grow from their edges, where atoms have fewer bonds and a lower displacement threshold.'];
    case 'damage': return null;
    case 'holder': case 'tempSet': return holderText(S, sim);
    case 'newGrid': return ['Fresh grid', 'A new grid, plunge-frozen and never warmed: vitreous ice again, no dose so far. The holder drifts for a while after insertion.'];
    case 'cryo': return holderText(S, sim);
    case 'profile': return ['Instrument profile', `The twin now models a <b>${S.profile.name}</b>: energy spread ${S.profile.dE} eV, C<sub>c</sub> ${S.profile.Cc} mm, uncorrected C<sub>s</sub> ${S.profile.CsUnc} mm${S.profile.corrector ? ', with an aberration corrector' : ''}. With these, the focal spread is <b>${sim.focalSpread().toFixed(0)} Å</b> and the information limit <b>${f2(sim.infoLimit())} Å</b> at ${S.kV} kV. Its magnification, camera length, scan, EDS and holography calibrations start at their nominal values; the calibration dialog measures each of them from your data, mode by mode.`];
    case 'calibrated': {
      const c = S.profile.calibrated || {}, pr = S.profile, parts = [];
      if (c.ctf) parts.push(`<b>TEM</b>: defocus ${(c.ctf.df / 10).toFixed(1)} nm and two-fold astigmatism ${(c.ctf.A1 / 10).toFixed(1)} nm at ${Math.round(c.ctf.A1a)}° from the Thon rings (matched to ${c.ctf.fitRes.toFixed(1)} Å)`);
      if (c.lattice) parts.push(`<b>Image scale</b>: magnification ×${pr.magCal.toFixed(4)}${c.lattice.scanAspect != null ? `, STEM scan aspect ${pr.scanAspect.toFixed(4)} and shear ${pr.scanShear.toFixed(2)}°` : ''} from a ${c.lattice.d} Å lattice`);
      if (c.rings) parts.push(`<b>Diffraction</b>: camera length ×${pr.camLCal.toFixed(4)} and ${(pr.ellip * 100).toFixed(2)} % ellipticity from a ring standard`);
      if (c.disk) parts.push(`<b>Detector angles</b> (4D-STEM, CBED, Ronchigram): ${c.disk.mradPx.toFixed(4)} mrad per pixel`);
      if (c.eds) parts.push(`<b>EDS</b>: ${pr.edsFWHM.toFixed(0)} eV resolution at Mn Kα`);
      if (c.zlp) parts.push(`<b>EELS and TEM</b>: energy spread ${pr.dE.toFixed(2)} eV, information limit ${f2(sim.infoLimit())} Å`);
      if (c.holo) parts.push(`<b>Holography</b>: fringe contrast μ₀ ${pr.holoMu0.toFixed(2)}`);
      return ['Twin calibrated', `${parts.length ? `${parts.join('; ')}.` : `Profile set: <b>${pr.name}</b>.`} Every mode that depends on these values now uses them. Save the session to keep the calibration.`];
    }
    case 'session': return ['Session saved', 'Everything that defines this experiment (specimen, mode, optics, detectors, the instrument profile and its calibrations) is in the JSON file. Load it here later, share it, or run it without a browser with <code>node tools/headless.mjs --session file.json</code>.'];
    case 'loaded': return ['Session loaded', `Restored ${sim.spec.name} in ${S.mode.toUpperCase()} mode with the profile <b>${S.profile.name}</b>.`];
    case 'exported': return ['Data exported', 'A NumPy archive (.npz) with what the detectors recorded in this mode, plus <code>metadata.json</code> with pixel sizes, optics and the full state. Load it with <code>numpy.load()</code>. These are simulated data, and the metadata says so.'];
    case 'clarity':
      return S.clarity === 'real'
        ? ['Physically realistic', 'Poisson shot noise at your chosen dose, grayscale detectors, counts accumulating in real time, log-scale spectra, crystal-field-split Ti L₂,₃ white lines, Kikuchi bands and faster electrons. This is closer to what a microscopist actually sees at the console.']
        : ['Educational clarity', 'Noise-free signals, false color, labels, slower and brighter electrons. The physics underneath is identical; it’s just drawn to be read.'];
    case 'vdet': return ['Virtual detector', {
      bf: 'A <b>virtual bright-field</b> disk: summing the undiffracted cone. Phase contrast, like TEM.',
      abf: 'A <b>virtual annular bright-field</b> ring at the edge of the disk. It picks up light atoms such as oxygen.',
      adf: 'A <b>virtual ADF</b> ring outside the bright-field disk. Heavier columns scatter more into it.',
      disk: 'A small <b>virtual aperture</b> on one diffracted disk. It’s a dark-field image computed after the experiment. Drag it onto different disks and grains light up differently.',
      dpc: '<b>Differential phase contrast</b>: a disk detector cut into four quadrants. When an atom’s electric field pushes the beam sideways, one quadrant gets more electrons than its opposite (A−C, B−D). Color shows the push direction. DPC hardware exists as real segmented detectors; with a direct electron detector you synthesize it afterwards.',
      mptycho: '<b>Multislice ptychography</b>: the specimen is treated as a stack of thin slices, with the wave Fresnel-propagated from one to the next, exactly as the patterns here were simulated (3 slices). Single-slice ptychography assumes one thin phase plate, so on thick crystals channeling and beam spreading leave artifacts and the fit error stalls. The multislice model accounts for them, fits the data better, and gives <b>depth sectioning</b>: on gold-on-carbon, the particles appear in the upper slices and the carbon film in the lower ones. In 2021 multislice electron ptychography reached a resolution limited only by the thermal vibration of the atoms. The cost is many more FFTs per iteration, which is why it runs slower here.',
      ptycho: '<b>Electron ptychography</b>: overlapping diffraction patterns jointly determine the specimen’s phase, the one thing a detector cannot measure directly. The ePIE algorithm iterates: guess the object, predict each pattern, keep the predicted phase but enforce the measured amplitudes, update the object. It’s running live on the patterns recorded here. Ptychography holds the resolution record for any microscope (~0.2 Å, limited by thermal vibration of the atoms).',
      com: 'The <b>center of mass</b> of each pattern. The electron beam is deflected by the atoms’ electric fields; color shows direction, brightness shows strength. It’s a map of the field itself, with arrows in educational mode.',
    }[S.vdet]];
    case 'eelsWin': {
      const w0 = S.eelsWin - S.eelsWidth / 2, w1 = S.eelsWin + S.eelsWidth / 2;
      const hit = P.EDGES.filter((e) => sim.si?.comp[e.key] && e.E < w1 && e.E > w0 - 40).map((e) => e.name);
      if (w1 < 6) return ['Energy window', 'Window on the <b>zero-loss peak</b>: only electrons that lost no energy. Thin regions transmit more of them, so the map is brightest where the sample is thinnest. Energy filtering also sharpens images and diffraction by removing the chromatic blur.'];
      if (w1 < 60) return ['Energy window', `Window at <b>${Math.round(w0)}–${Math.round(w1)} eV</b>, on the <b>plasmon</b> peak. Collective oscillations of valence electrons: the probability of exciting one grows with thickness, so this is essentially a thickness map. Plasmon energy also shifts with electron density, which is how aluminum alloys and hydrides are mapped.`];
      return ['Energy window', `Window at <b>${Math.round(w0)}–${Math.round(w1)} eV</b>${hit.length ? `, on the <b>${hit.join(' and ')}</b> edge` : ', between edges'}. ${S.bgsub ? 'The smooth power-law background extrapolated from before the edge is subtracted, and what remains is the signal from atoms whose inner shells sit in this range.' : 'Background is <b>not</b> subtracted, so the map is dominated by thickness, not chemistry. Real analysis always fits and removes the pre-edge power law.'}`];
    }
    case 'eelsDisp': {
      const res = sim.eelsRes(), nch = res / S.eelsDisp, [a, b] = sim.eelsRangeBounds();
      return ['Dispersion', `<b>${S.eelsDisp} eV per channel</b>: the 2048-channel detector now spans ${a.toFixed(1)} to ${b.toFixed(1)} eV. The magnetic prism spreads the beam by energy; the projector lenses after it set how many eV land on each channel. Fine dispersion resolves the zero loss and the fine structure of edges, coarse dispersion fits more edges on the detector. The energy resolution (${res.toFixed(2)} eV, set by the gun's energy spread) now covers <b>${nch.toFixed(1)} channels</b>${nch < 3 ? ': <span class="warn">fewer than ~3, so the channels themselves blur the zero loss and the edge onsets (the detector point-spread adds about two more)</span>' : ', enough to sample it properly'}. Calibrate dispersion with two known features, for example the zero loss and a sharp edge, or by shifting the drift tube by a known voltage.`];
    }
    case 'eelsOffset': { const [a, b] = sim.eelsRangeBounds(); return ['Energy offset', `The spectrum starts at <b>${S.eelsOffset} eV</b> (through ${b.toFixed(0)} eV). On a real spectrometer this is the drift-tube voltage, or a change of the high voltage: it slides the spectrum across the detector without moving any lens. ${a > 0 ? 'The zero-loss peak is now off the detector, which is normal for core-loss work: it is ~10⁴–10⁶× brighter than the edges and would saturate the camera (dual EELS records both with different exposures).' : 'The zero-loss peak is on the detector: use it to set the energy origin and measure the resolution.'}`]; }
    case 'eelsExp': case 'eelsCurrent': {
      const e = sim.eels, r = e?.ro;
      return [k0(S) === 'eelsCurrent' ? 'Probe current' : 'Exposure', `<b>${S.eelsCurrent} pA</b> for <b>${fmtS(S.eelsExp)}</b> per readout: about ${(S.eelsCurrent * 1e-12 / 1.602e-19 * S.eelsExp).toExponential(1)} electrons go through the spectrometer each readout. The camera integrates them channel by channel up to its <b>full well</b> (~16,400 electrons per channel per readout for a 16-bit converter at ~4 counts per electron). ${r?.sat ? `<span class="warn">${r.sat} channels are saturated: their counts are clipped, so peak shapes, the zero-loss width and anything computed from the spectrum (thickness, quantification) are wrong. ${e.zlp ? 'The zero loss is the culprit: it is 10⁴–10⁶× brighter than the edges.' : ''} Shorten the exposure, lower the current, move the zero loss off the detector, or use dual EELS.</span>` : `The brightest channel gets ${Math.round(r?.peak ?? 0).toLocaleString()} electrons per readout, inside the full well. Weak edges need long exposures (and summing many readouts) to rise above the shot noise and the ~3 electrons of read noise.`}`];
    }
    case 'dualEels': return S.dualEels
      ? ['Dual EELS', `Two spectra in each readout: a fast deflector in the spectrometer sends the beam onto the camera at two energy offsets, one exposure short (<b>${fmtS(S.eelsExpLow)}</b>, low loss with the zero loss, from ${EELS_LOW} eV) and one long (<b>${fmtS(S.eelsExp)}</b>, core loss). The zero loss stays below saturation while the weak edges get enough counts. The recorded zero loss gives the true energy origin of every readout, so the core-loss frames are <b>realigned on it</b> and drift no longer smears them, and the low-loss spectrum gives the thickness (t/λ = ln I_total/I_zero loss)${sim.eels?.low?.tau != null ? `, here <b>${sim.eels.low.tau.toFixed(2)}</b>` : ''}, which is needed to quantify and deconvolve the core loss.`]
      : ['Single spectrum', 'One spectrum per readout. A drifting zero loss now smears long acquisitions, and the zero loss and the edges must share one exposure.'];
    case 'eelsExpLow': return ['Low-loss exposure', `<b>${fmtS(S.eelsExpLow)}</b> per readout for the low-loss spectrum. Keep it short enough that the zero loss stays below the full well${sim.eels?.low?.ro?.sat ? ': <span class="warn">it is saturated now, so its width and the thickness are wrong</span>' : ' (it is now)'}.`];
    case 'alignZLP': return ['Zero loss aligned', 'The zero-loss peak is centered on 0 eV again. The high voltage and the spectrometer drift by a few tenths of an eV per minute, which shifts the whole spectrum and smears long acquisitions; microscopists re-center the zero loss before each acquisition, or record it simultaneously (dual EELS) and correct the energy scale afterwards.'];
    case 'eelsRange': return ['Spectrum range', { zlp: 'Zero loss at 0.01 eV per channel: the electrons that lost no energy. Its width is the instrument\'s energy resolution (the gun\'s energy spread plus spectrometer aberrations); its tails show the gun\'s energy distribution. Its area against the whole spectrum gives the thickness (t/λ = ln I_total/I_zero loss).', low: 'Low loss: zero-loss peak, band gap onset and plasmons. It’s the strongest part of the spectrum, and it tells you thickness and dielectric properties.', core: 'Core loss: ionization edges of light and transition-metal elements (C, O, Si, Ti, Sr). The signal is 100–10,000× weaker than the plasmons, riding on a steep background.', high: 'High loss: deep edges of heavy elements (Si K, Sr L, Au M). The signal is faint; you need a thin sample and long exposures.' }[S.eelsRange]];
    case 'bgsub': return ['Background subtraction', S.bgsub ? 'Fitting A·E<sup>−r</sup> before the edge and subtracting it: the element map now shows chemistry.' : 'Raw window intensity: mostly a thickness map, because the background under an edge scales with thickness too.'];
    case 'edsSel': {
      if (S.edsSel === 'all') return ['Element maps', 'All elements overlaid in false color. Each pixel is a separate X-ray spectrum; the color intensity is the count in each element’s main peak.'];
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
    case 'autotuned': return ['Corrector tuned', `The corrector software measured the aberrations from Ronchigrams and canceled them order by order. The flat-phase region now reaches <b>${sim.ronch.flat ? (sim.ronch.flat * 1000).toFixed(1) : '—'} mrad</b>. Real systems iterate the same loop: measure (Ronchigram or Zemlin tableau fitting), correct, re-measure. The residuals left are set by measurement noise and instabilities.`];
    case 'ronchAp': return ['Ronchigram aperture', `A deliberately oversized <b>${S.ronchAp} mrad</b> aperture shows where the aberration-free region ends. For imaging you would then choose a probe aperture about the size of the flat-phase circle.`];
    case 'cbedKind': return S.cbedKind === 'lacbed'
      ? ['LACBED', 'Large-angle CBED: a defocused probe and a selected-area aperture give one huge disk full of Bragg and HOLZ lines, with a shadow image of the specimen. Drag the pattern to move the boundary through the field and watch the lines break.']
      : ['CBED', 'A focused nanoprobe. Keep α below half the Bragg angle to separate the disks; tilt slightly off the zone axis so one reflection is strongly excited, then read the thickness from its fringes.'];
    case 'alphaCB': return ['Convergence angle', `Disk radius is α = <b>${S.alphaCB} mrad</b>. Larger α shows more of the rocking curve (more fringes, more HOLZ lines) until the disks overlap. For SrTiO₃ that happens above ~3.2 mrad at 200 kV, for Au above ~5 mrad.`];
    case 'alphaLA': return ['LACBED angle', `A <b>${S.alphaLA} mrad</b> cone. The wider it is, the more lines and the larger the area of specimen seen in the shadow image.`];
    case 'strain': return ['Lattice strain', `Lattice parameter changed by <b>${S.strain >= 0 ? '+' : ''}${S.strain.toFixed(2)} %</b>. HOLZ lines come from reflections with large g, where the Bragg condition is extremely sensitive to d-spacing, so they shift visibly for 0.1 % strain. That’s how CBED measures local strain in transistors. The same shift results from a change in accelerating voltage, which is why HOLZ lines also calibrate kV.`];
    case 'holz': return ['HOLZ lines', S.holz ? 'Showing higher-order Laue zone lines: fine deficiency lines where a reflection in the next reciprocal-lattice layer is exactly excited.' : 'HOLZ lines hidden: only zero-order (ZOLZ) dynamical contrast remains.'];
    case 'magSpec': {
      const sp = MAGSPECS[S.magSpec];
      return [sp.name, `${sp.about} Saturation induction ${sp.Bs} T, mean inner potential ${sp.V0} V.${S.magSpec === 'fege' ? ` It only orders below ${sp.Tc} K: pick the liquid-nitrogen holder and cool it, then use the objective-lens field to make skyrmions.` : ''}`];
    }
    case 'magnet': case 'lorReset': return ['Saturate and relax', 'A strong in-plane field saturates the element; when it is removed, the flux closes again with a random sense of rotation and, for the vortex, a random core direction. Find them from the images: the vortex core is bright or dark in Fresnel depending on the rotation sense and the defocus sign, and TIE shows the rotation directly.'];
    case 'lorThick': return ['Film thickness', `The deflection grows with the thickness crossed: β = e·B·t·λ/h ≈ ${(deflection(S, sim.temp(), S.kV) * 1e6).toFixed(1)} µrad here. Thicker films give stronger contrast but scatter more, and the electrostatic phase at the edges (mean inner potential × thickness) grows too.`];
    case 'lorFov': return ['Field of view', `${S.lorFov < 1 ? Math.round(S.lorFov * 1000) + ' nm' : S.lorFov.toFixed(2) + ' µm'} across. Lorentz work happens at low magnification because the objective lens is off; domain walls are 10–100 nm wide, so very large fields of view blur them into the pixels.`];
    case 'lorDf': return ['Lorentz-lens defocus', S.lorDf === 0 ? 'In focus a magnetic film is a pure phase object: no contrast at all. Defocus to see the walls.' : `${Math.abs(S.lorDf)} µm ${S.lorDf < 0 ? 'under' : 'over'}focus. The image contrast is proportional to the defocus times the curvature of the phase: walls where the deflections converge are ${S.lorDf < 0 ? 'bright' : 'dark'}, and every contrast reverses on the other side of focus. More defocus means stronger contrast but broader walls.`];
    case 'lorDiv': return ['Illumination divergence', `${S.lorDiv} µrad. Fresnel contrast needs a coherent beam: at large defocus, a divergent illumination blurs the fringes by about divergence × defocus = ${((S.lorDiv * 1e-6 * Math.abs(S.lorDf) * 1e-6) * 1e9).toFixed(0)} nm here. A field-emission gun and a small condenser aperture keep it to a few µrad.`];
    case 'lorView': return ['Display', { fresnel: 'Fresnel: a defocused image; domain walls and vortex cores appear as bright or dark lines and dots.', foucault: 'Foucault: in focus, with a small aperture in the back focal plane that passes only the beams deflected one way; those domains stay bright.', tie: 'Induction map: the phase from images at ± the defocus (transport of intensity), then the direction of the in-plane induction as colour.', phase: 'Phase: what the electron wave picks up, magnetic plus electrostatic (the edges of the film).' }[S.lorView]];
    case 'lorFouc': case 'lorApR': return ['Foucault aperture', `A ${S.lorApR} µrad aperture displaced to pass the beams deflected ${{ '+x': 'right', '-x': 'left', '+y': 'up', '-y': 'down' }[S.lorFouc]}. The deflections are only a few µrad, so the aperture must be small, and it sits in the back focal plane, shown on the right.`];
    case 'lorField': {
      const st = fegeState(sim.temp(), S.lorField);
      return ['Objective-lens field', `${S.lorField} mT along the beam. ${S.magSpec === 'fege' ? `At ${Math.round(sim.temp())} K the FeGe is ${st.phase}${st.Bc2 ? ` (skyrmions between ${Math.round(st.Bc1)} and ${Math.round(st.Bc2)} mT)` : ''}.` : 'A field along the beam does little to an in-plane film; tilt the specimen and part of it lies in the plane, pushing the vortex core sideways until it is expelled.'}`];
    }
    case 'lstemView': return ['Display', { color: 'Induction map: the two segment differences as colour (hue = direction, brightness = strength).', x: 'Right minus left segments: the deflection along x.', y: 'Top minus bottom segments: the deflection along y.', sum: 'The sum of all four segments: a bright-field image, insensitive to the deflection; it shows the film and its edges.' }[S.lstemView]];
    case 'lorAlpha': return ['Lorentz probe semi-angle', `${Math.round(S.lorAlpha)} µrad gives a ${((0.51 * sim.lam) / (S.lorAlpha * 1e-6) / 10).toFixed(0)} nm probe at ${S.kV} kV. The deflection is ${sim.lor.disp ? Math.round(sim.lor.disp.sat * 100) : '—'} % of the disc radius: below a few per cent the signal drowns in noise, near 100 % the segments saturate.`];
    case 'biprism': {
      const bp = biprism(S.biprism, S.profile), d = sim.oah.disp;
      return ['Biprism voltage', `<b>${S.biprism} V</b> on the wire. A higher voltage deflects the two waves more steeply, so they overlap over a wider region (<b>${f1(bp.W)} nm</b>) with finer fringes (<b>${f2(bp.s)} Å</b>). Finer fringes allow a larger sideband aperture and so better resolution, but the two waves must stay coherent across the whole overlap, so <b>fringe contrast drops</b> (now ${Math.round(bp.mu * 100)} %) and the phase gets noisier.${d?.under ? ' <span class="warn">The fringes are now finer than the detector can sample; reduce the field of view (raise the magnification).</span>' : ''}`];
    }
    case 'sbR': {
      const d = sim.oah.disp;
      return ['Sideband aperture', `The mask around the sideband has a radius of <b>${Math.round(S.sbR * 100)} %</b> of the carrier frequency${d ? `, giving <b>${f2(d.res)} Å</b> resolution` : ''}. A larger mask passes finer detail but also more noise, and above about one third of the carrier it starts to collect the center band, mixing intensity into the phase. Resolution in off-axis holography is set by this mask, which is why it is usually two to three fringe spacings.`];
    }
    case 'numCorr': return ['Numerical aberration correction', S.numCorr
      ? 'The reconstructed wave is multiplied by exp(+iχ), the inverse of the lens’s phase error, so defocus and spherical aberration are undone in the computer. The dashed reference curve is now the true exit wave. Only the information limit, set by the energy spread, cannot be undone.'
      : 'Showing the image wave as the lens delivered it, aberrations included. Turn correction on to undo defocus and Cₛ a posteriori; change the defocus and watch the corrected phase stay put.'];
    case 'holoView': return ['Display', {
      holo: 'The raw <b>hologram</b>: interference fringes whose local position encodes the phase and whose contrast encodes the amplitude. The magnified inset shows the fringes; near the edges of the overlap, the Fresnel fringes from the biprism wire add artifacts.',
      phase: 'The reconstructed <b>phase</b>: how much each part of the specimen has delayed the electron wave. For a thin specimen it is proportional to the projected electrostatic potential.',
      amp: 'The reconstructed <b>amplitude</b>: how much of the wave got through. It looks like an image recorded with an energy filter and no aberrations.',
      contour: '<b>Phase contours</b>, cos(4φ): each dark-to-dark band is a phase step of π/2. This is the classic way holographers display electric and magnetic fields: the contours follow equipotential or magnetic flux lines.',
    }[S.holoView]];
    case 'nFocal': case 'focalStep': case 'series': return ['Focal series', `Recording <b>${S.nFocal}</b> images, <b>${f1(S.focalStep)} nm</b> apart, around ${f1(S.df)} nm defocus. More images over a wider range recover the phase more completely, especially its slowly varying part, but each image only gets 1/${S.nFocal} of the dose, and in a real microscope the specimen drifts during the series, so the images must be aligned before reconstruction.`];
    case 'ilhView': return ['Display', { phase: 'The reconstructed <b>exit-wave phase</b>, free of lens aberrations.', amp: 'The reconstructed <b>exit-wave amplitude</b>. For a thin specimen it is almost uniform: nearly all the information is in the phase.', series: 'The recorded <b>focal series</b>, cycling through the images. Contrast reverses and fringes appear as the focus changes.' }[S.ilhView]];
    case 'mode': return null;
  }
  return null;
}

export function dataRows(S, sim) {
  const spec = sim.spec;
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
  if (!['tem', 'diff', 'oah', 'ilh'].includes(S.mode)) {
    rows.push(['Probe size (FWHM)', sim.probe ? `${sim.probe.fwhm.toFixed(2)} Å` : '—']);
    rows.push(['Depth of field', `${(o.lam / (a * a) / 10).toFixed(1)} nm`]);
  }
  if (S.mode === 'diff') rows.push(['Camera constant λL', `${(o.lam * S.camL).toFixed(1)} Å·mm`]);
  rows.push(['Residual A1 / B2 / A2', `${S.ab.A1} / ${S.ab.B2} / ${S.ab.A2} nm`]);
  rows.push(['Residual A3', `${S.ab.A3} µm`]);
  rows.push(['Dose', `${Math.round(S.dose).toLocaleString()} e⁻/Å²`]);
  const T = sim.temp(), th = sim.thermal();
  rows.push(['Specimen temperature', `${T < 20 ? T.toFixed(1) : Math.round(T)} K (${Math.round(T - 273.15)} °C), drift ${sim.driftSpeed().toFixed(2)} Å/s`]);
  rows.push(['Atomic vibration u_rms', `${(0.08 * Math.sqrt(th.u2r)).toFixed(3)} Å${spec.alpha ? `, thermal strain ${(th.eps * 100).toFixed(3)} %` : ''}`]);
  if (sim.spec.beamSensitive) rows.push([`Critical dose (${sim.spec.short})`, `${sim.critDose().toFixed(1)} e⁻/Å²`], ['Accumulated dose', `${(sim.doseAcc || 0).toFixed(1)} e⁻/Å²`]);
  rows.push(['Inelastic mean free path', `${Math.round(P.imfp(S.kV, sim.spec.zeff))} nm`]);
  rows.push(['Knock-on damage (C)', S.kV > 86 ? 'above threshold' : 'below threshold']);
  return rows;
}
