// Instrument-physics cards for each labelled component of the column.
// Each entry: what it does, the physics behind it, typical specifications,
// how it is measured / calibrated in practice, what limits it, and live values from the current state.
import * as P from './physics.js';
import { AP_MRAD, FOCAL_SPREAD, stemDetType } from './sim.js';

const f2 = (v) => v.toFixed(2), f1 = (v) => v.toFixed(1);
const lamOf = (S) => P.wavelength(S.kV);

export const COMPONENTS = {
  'Electron gun': {
    kicker: 'Source',
    role: 'Emits the electrons. Its <b>brightness</b> and <b>energy spread</b> set the ultimate limits on probe current, coherence and chromatic resolution.',
    physics: 'A Schottky field-emission gun uses a ZrO-coated W(100) tip at ~1800 K. The zirconia lowers the work function from 4.5 to ~2.8 eV, and a strong extraction field (~10⁹ V/m) thins the barrier further, so electrons escape from a virtual source only ~15 nm across. Cold-FEG tips run at room temperature and emit by pure tunnelling, trading stability for a narrower energy spread.',
    specs: [['Reduced brightness', '~1 × 10⁸ A m⁻² sr⁻¹ V⁻¹'], ['Energy spread (Schottky)', '0.6–0.8 eV'], ['Energy spread (cold FEG)', '0.3–0.4 eV'], ['Virtual source size', '~15 nm'], ['Emission current', '50–200 µA']],
    metrology: 'Energy spread is read directly as the <b>FWHM of the zero-loss peak</b> in EELS. Brightness comes from measuring probe current (Faraday cup or calibrated screen current) against probe size and convergence angle. Emission stability is logged as %/hour.',
    limits: 'Brightness caps how much current fits into an atomic probe; energy spread couples to chromatic aberration and sets the information limit.',
    live: (S, sim) => [['Assumed focal spread Δ', `${FOCAL_SPREAD} Å`], ['Information limit', `${f2(P.infoLimit(lamOf(S), FOCAL_SPREAD))} Å`]],
  },
  'High-voltage accelerator': {
    kicker: 'Acceleration',
    role: 'Accelerates electrons through a stack of electrodes to the working voltage, fixing their <b>wavelength</b> and <b>penetration</b>.',
    physics: 'Kinetic energy eV makes the electron relativistic: λ = h / √(2m₀eV(1 + eV/2m₀c²)). At 300 kV electrons move at 0.78 c. Ripple and drift in the high voltage broaden the energy just like the gun does, so the tank is actively stabilised.',
    specs: [['Voltage range', '30–300 kV'], ['HV stability', '< 1 ppm (ΔV/V)'], ['Accelerator stages', '6–12 electrodes']],
    metrology: 'The absolute voltage is calibrated from <b>HOLZ line positions in CBED</b>, which shift sensitively with λ, or from a known lattice spacing. The <b>HT wobbler</b> modulates the voltage so the <i>chromatic (voltage) centre</i> can be aligned onto the optic axis.',
    limits: 'Chromatic focal spread Δ = C<sub>c</sub>·√[(ΔE/E)² + (ΔV/V)² + (2ΔI/I)²]; high voltage drives knock-on damage above ~86 kV in carbon.',
    live: (S) => [['Voltage', `${S.kV} kV`], ['Wavelength', `${f2(lamOf(S) * 100)} pm`], ['Speed', `${P.betaOf(S.kV).toFixed(3)} c`], ['Mass', `${P.gammaOf(S.kV).toFixed(3)} m₀`]],
  },
  'Condenser lens 1': {
    kicker: 'Illumination',
    role: 'Demagnifies the source image (the "spot size" setting) and so controls <b>beam current</b>: stronger C1 means a smaller source image, less current, more coherence.',
    physics: 'A magnetic round lens: a copper coil in a soft-iron yoke concentrates the field across a narrow pole-piece gap. Focal length scales as f ∝ V*/(NI)², where V* is the relativistic voltage and NI the ampere-turns. Electrons spiral through, so the image is also rotated.',
    specs: [['Spot-size steps', '~1–11'], ['Current per step', '≈ ×0.5–0.7'], ['Coil excitation', '10³–10⁴ ampere-turns']],
    metrology: 'Beam current per spot size is tabulated with a <b>Faraday cup</b> or the calibrated screen current. Lenses are <b>normalised</b> (cycled through saturation) before measurements so magnetic hysteresis doesn\'t make settings irreproducible.',
    limits: 'Current and coherence trade off directly: the same brightness can’t give you both a big current and a tiny, coherent source.',
    live: () => [],
  },
  'Condenser lens 2': {
    kicker: 'Illumination',
    role: 'Sets how the beam arrives at the sample: <b>parallel</b> for TEM and diffraction, or a <b>converging cone</b> focused to a probe for STEM.',
    physics: 'Modern columns use C2 + C3 (plus the objective pre-field) to vary the illuminated area while keeping the beam parallel, like Köhler illumination in light optics. In STEM the same lenses image the source onto the specimen with a chosen convergence semi-angle α.',
    specs: [['TEM illumination angle', '< 0.1 mrad (parallel)'], ['STEM convergence α', '5–40 mrad']],
    metrology: 'Parallelism is checked in diffraction: spots stay sharp and the same size when C2 changes slightly. α is calibrated by measuring the <b>bright-field disk diameter</b> in a CBED pattern against a known Bragg spacing: α = θ<sub>B</sub> × (disk radius / spot spacing).',
    limits: 'Residual convergence damps high-frequency transfer (the spatial-coherence envelope).',
    live: (S) => [['Convergence α', `${S.mode === '4d' ? S.alpha4d : S.alpha} mrad`], ['TEM illumination', '0.08 mrad']],
  },
  'Condenser aperture': {
    kicker: 'Beam limiting',
    role: 'A platinum or molybdenum disk with a precise hole. In STEM it is the <b>probe-forming aperture</b> and directly sets α and probe current.',
    physics: 'The aperture selects which rays reach the specimen. The probe’s diffraction limit ∝ λ/α fights spherical aberration ∝ C<sub>s</sub>α³, so there is an optimum aperture for each C<sub>s</sub>.',
    specs: [['Typical sizes', '10–150 µm'], ['Material', 'Pt or Mo, heated to stay clean'], ['Optimum α (uncorrected)', '~10 mrad at 200 kV']],
    metrology: 'Centred with the <b>aperture wobble / Ronchigram</b>: the Ronchigram’s flat, aberration-free region should fill it symmetrically. Its angular size is calibrated from CBED disks.',
    limits: 'Contamination on the edge charges up and adds astigmatism; a smaller aperture means less current.',
    live: (S, sim) => [['α now', `${S.mode === '4d' ? S.alpha4d : S.alpha} mrad`], ['Optimum α for this Cₛ', `${Math.round(1.27 * Math.pow(lamOf(S) / Math.max(1, Math.abs(sim.CsA())), 0.25) * 1000)} mrad`]],
  },
  'Aberration corrector': {
    kicker: 'Resolution',
    role: 'A stack of multipole lenses that cancels the unavoidable aberrations of round lenses. Here it’s a probe corrector above the objective, so the STEM probe can reach sub-ångström size.',
    physics: 'Round magnetic lenses always have positive C<sub>s</sub> and C<sub>c</sub> (Scherzer’s theorem). Breaking rotational symmetry escapes it: two <b>hexapoles</b> joined by a transfer doublet produce a rotationally symmetric <b>negative</b> third-order aberration that cancels C<sub>s</sub> (Rose/Haider design); quadrupole–octupole correctors (Krivanek) do the same and also reach fifth order. Dozens of power supplies must hold ppm stability.',
    specs: [['Corrected order', '3rd (C3) routinely, 5th in advanced designs'], ['Residual targets', 'A1 < 1 nm, B2 < 20 nm, A2 < 20 nm, C3 ~ µm'], ['Flat-phase angle', '25–40 mrad at 200–300 kV']],
    metrology: 'Aberrations are <b>measured</b>, not assumed: from Ronchigrams (STEM) by fitting local magnification in a grid of sub-regions, or from a <b>Zemlin tableau</b> (TEM) of diffractograms at tilted illumination. The software then applies corrections order by order and re-measures, iterating until residuals fall below π/4 at the chosen aperture.',
    limits: 'Chromatic aberration (unless Cc-corrected), higher-order residuals (C5, A5, S5), and instabilities: power-supply noise, temperature drift, magnetic fields, vibration.',
    live: (S, sim) => [['On', S.corrector ? 'yes' : 'no (Cₛ uncorrected)'], ['C3', S.corrector ? `${S.csCor} µm` : `${S.csUnc} mm`], ['A1 / B2 / A2', `${S.ab.A1} / ${S.ab.B2} / ${S.ab.A2} nm`], ['Flat phase', sim.ronch.flat ? `${(sim.ronch.flat * 1000).toFixed(1)} mrad` : 'open Ronchigram mode']],
  },
  'Scan coils': {
    kicker: 'Scanning',
    role: 'Pairs of deflection coils <b>raster</b> the probe across the sample in STEM, and pivot the beam for alignments.',
    physics: 'Two deflectors tilt the beam in opposite directions, so it pivots about the objective’s front focal plane and lands on the specimen <b>parallel to the axis</b> at every position (a telecentric scan). Descan coils below the specimen keep the diffraction pattern stationary on the detector, which is critical for 4D-STEM.',
    specs: [['Pixel dwell time', '0.1–100 µs'], ['Frame size', '256² – 4096²'], ['Flyback delay', '~100 µs per line']],
    metrology: 'Pixel size is calibrated against a known lattice (for example Si 111 = 3.135 Å). <b>Scan distortion and drift</b> are measured by acquiring the same area at 0° and 90° scan rotation and fitting a nonlinear correction. Pivot points are aligned so beam tilt doesn’t move the probe.',
    limits: 'Specimen drift (~0.5 nm/min), scan-coil hysteresis and line flyback artefacts; fast scans trade dose for distortion.',
    live: (S) => [['Pixel size', `${f2((S.fov * 10) / 224)} Å`], ['Field of view', `${f1(S.fov)} nm`]],
  },
  'Objective lens': {
    kicker: 'Resolution',
    role: 'The strongest lens, with the specimen immersed in its field. It forms the first image in TEM and the probe in STEM, and its <b>aberrations set the resolution of the whole instrument</b>.',
    physics: 'A ~2 T immersion field gives f ≈ 1.5–2 mm. Round lenses always have positive spherical and chromatic aberration (Scherzer, 1936). The wave aberration χ(k) = πλΔf k² + ½πC<sub>s</sub>λ³k⁴ plus astigmatism, coma, and so on is cancelled by a multipole <b>corrector</b> (hexapole or quadrupole-octupole), which can even make C<sub>s</sub> negative.',
    specs: [['Cₛ uncorrected', '0.5–1.5 mm'], ['Cc', '1–1.5 mm'], ['Pole-piece gap', '2–5 mm'], ['Corrected resolution', '< 0.6 Å (TEM & STEM)']],
    metrology: 'Aberrations are measured, not assumed. In TEM a <b>Zemlin tableau</b> (diffractograms of amorphous carbon at several tilted illuminations) fits defocus, astigmatism, coma and C<sub>s</sub>. In STEM the <b>Ronchigram</b> is fitted. Coma-free alignment uses beam-tilt wobbling; the corrector software iterates until residual aberrations are below target.',
    limits: 'After correcting Cₛ, chromatic aberration and the source energy spread take over, along with instabilities (lens current, vibration, stray fields).',
    live: (S, sim) => {
      const lam = lamOf(S), Cs = sim.CsA(), sch = Cs !== 0 ? P.scherzerDefocus(Cs, lam) / 10 : null;
      return [['Cₛ', S.corrector ? `${S.csCor} µm` : `${S.csUnc} mm`], ['Defocus', `${S.df > 0 ? '+' : ''}${S.df.toFixed(1)} nm`], ['Scherzer defocus', sch === null ? '—' : `${sch > 0 ? '+' : ''}${f1(sch)} nm`], ['Point resolution', `${f2(P.pointResolution(Cs, lam))} Å`]];
    },
  },
  Specimen: {
    kicker: 'Sample',
    role: 'A 3 mm grid or FIB lamella, thinned until electrons pass through, held in a goniometer that tilts and translates it inside the lens gap.',
    physics: 'The specimen must be thinner than about one inelastic mean free path (~100 nm) for quantitative work. Beam damage comes from <b>knock-on</b> displacement (above a voltage threshold), <b>radiolysis</b> (ionisation that breaks bonds), heating and charging.',
    specs: [['Tilt range (double-tilt)', '±20–35°'], ['Stage drift', '< 0.5 nm/min'], ['Positioning', 'piezo, ~20 pm steps']],
    metrology: '<b>Eucentric height</b> is set with the α-wobbler: the image shouldn’t move as the stage rocks. <b>Thickness</b> is measured by EELS log-ratio (t/λ = ln I<sub>total</sub>/I<sub>0</sub>) or from CBED Kossel–Möllenstedt fringes. Orientation comes from Kikuchi patterns; dose is logged in e⁻/Å².',
    limits: 'Thickness, drift, contamination and damage often limit results before optics do.',
    live: (S, sim) => [['Thickness', `${S.thick} nm`], ['t/λ (approx.)', `${f2((S.thick) / P.imfp(S.kV, sim.spec.zeff))}`], ['Dose', `${Math.round(S.dose).toLocaleString()} e⁻/Å²`], ['Tilt', `${f2(S.tiltX)}°, ${f2(S.tiltY)}°`]],
  },
  'EDS X-ray detector': {
    kicker: 'Spectroscopy',
    role: 'Counts characteristic X-rays emitted by the specimen to identify and quantify elements.',
    physics: 'A <b>silicon drift detector</b> turns each X-ray into ~E/3.8 eV electron-hole pairs; the collected charge measures the photon energy. Resolution is Fano-limited: FWHM² = noise² + 2.355²·F·ε·E. Modern designs use several windowless detectors around the specimen to capture more solid angle.',
    specs: [['Resolution', '~125–130 eV at Mn Kα'], ['Solid angle', '0.1–4 sr'], ['Throughput', '10⁵–10⁶ counts/s']],
    metrology: 'Energy scale calibrated on known lines (Cu Kα 8.048 keV, Cu L). Quantification uses <b>Cliff–Lorimer k-factors</b> or the <b>ζ-factor</b> method, which needs the probe current measured. Spurious signals (the "hole count", Cu grid and system peaks) are measured on a blank area.',
    limits: 'Low collection efficiency, peak overlaps (for example Si Kα / Sr Lα), absorption of soft X-rays, dead time at high rates.',
    live: (S) => [['Overvoltage for Au L', `${f1(S.kV / 11.92)}`], ['Resolution at Mn Kα', `${Math.round(P.edsFWHM(5.9) * 1000)} eV`]],
  },
  'Objective aperture': {
    kicker: 'Contrast',
    role: 'Sits in the back focal plane and chooses <b>which scattered beams form the image</b>, so it sets contrast, resolution and dark-field selection.',
    physics: 'A hole of diameter d at focal length f passes scattering angles up to α = d/2f, i.e. spatial frequencies up to α/λ. Removing beams removes the fringes they would make; displacing the aperture onto one reflection gives a dark-field image.',
    specs: [['Sizes', '5–70 µm'], ['Angular cut-off', '~2–20 mrad'], ['Heating', 'self-cleaning, ~200 °C']],
    metrology: 'Centred in <b>diffraction mode</b> around the direct beam; its angular radius is calibrated against known Bragg reflections.',
    limits: 'Too small cuts resolution; charging on a dirty aperture adds phase shifts and astigmatism.',
    live: (S) => {
      const m = AP_MRAD[S.objAp];
      return [['Setting', S.objAp === 'none' ? 'open' : S.objAp === 'df' ? 'dark field' : `${S.objAp} µm`], ['Finest spacing passed', isFinite(m) ? `${f2(lamOf(S) / (m * 1e-3))} Å` : 'all']];
    },
  },
  'Back focal plane': {
    kicker: 'Fourier plane',
    role: 'The plane one focal length below the objective where every electron leaving the sample in the same direction meets at one point: the <b>diffraction pattern</b>.',
    physics: 'Mathematically the back focal plane holds the Fourier transform of the exit wave; position here is angle (spatial frequency) at the specimen. STEM detectors are imaged from this plane, so their angular ranges are set by the <b>camera length</b>.',
    specs: [['Distance below objective', '≈ f ≈ 2 mm'], ['Angular scale', 'set by camera length']],
    metrology: 'Detector collection angles are calibrated by imaging the detector in diffraction mode ("detector scan") against a known reflection or the BF-disk edge.',
    limits: 'Descan errors move the pattern as the probe scans, which is critical for DPC and 4D-STEM.',
    live: (S) => (S.mode === 'stem' ? [['Detector', `${stemDetType(S.detIn, S.detOut, S.alpha)} ${S.detIn}–${S.detOut} mrad`]] : [['Camera length', `${Math.round(S.camL)} mm`]]),
  },
  'Selected-area aperture': {
    kicker: 'Diffraction',
    role: 'Sits in the first image plane and limits <b>which region of the specimen</b> contributes to the diffraction pattern.',
    physics: 'Being conjugate to the specimen, the effective area is the aperture size divided by the objective magnification (~50×): a 10 µm aperture selects ~200 nm.',
    specs: [['Aperture sizes', '10–200 µm'], ['Smallest area', '~100–200 nm']],
    metrology: 'The image must be focused precisely in the SA plane. Spherical aberration displaces high-angle beams by C<sub>s</sub>θ³, a <b>selection error</b> that makes very small SA areas unreliable (use nanobeam diffraction instead).',
    limits: 'Selection error from Cₛ and defocus; for small features, convergent nanobeam diffraction is preferred.',
    live: (S) => [['Selected area', `${f1(S.sa)} nm`]],
  },
  'Intermediate lens': {
    kicker: 'Imaging system',
    role: 'The switch between <b>image</b> and <b>diffraction</b>: it focuses on either the first image plane or the back focal plane, and sets magnification or camera length.',
    physics: 'Changing its excitation moves its object plane between two conjugate planes of the objective. Together with the projectors it provides 10²–10⁶× magnification with controlled image rotation.',
    specs: [['Magnification range', '~50× – 1.5M×'], ['Camera lengths', '~20 mm – 5 m']],
    metrology: 'Magnification is calibrated with a <b>cross-grating replica</b> at low mag and lattice fringes at high mag. Camera length is calibrated with a <b>polycrystalline Au or Al</b> ring pattern. Image-versus-diffraction rotation is calibrated with MoO₃ crystals.',
    limits: 'Calibration drifts with lens hysteresis and specimen height; ~1–2% accuracy is typical without internal standards.',
    live: (S) => [['Camera constant λL', `${f1(lamOf(S) * S.camL)} Å·mm`]],
  },
  'Projector lens': {
    kicker: 'Imaging system',
    role: 'Final magnification onto the screen or camera.',
    physics: 'Works at large angles and long distances, so its dominant aberrations are geometric <b>distortions</b> (barrel/pincushion, spiral) rather than resolution-limiting ones.',
    specs: [['Distortion', '< 1% across the field'], ['Final image size', '~10–100 mm']],
    metrology: 'Distortion is measured from the <b>ellipticity of polycrystalline rings</b> or a grating across the field, then corrected in software. This matters for strain mapping from diffraction.',
    limits: 'Residual distortion biases lattice-parameter and strain measurements.',
    live: () => [],
  },
  'Fluorescent screen': {
    kicker: 'Detector',
    role: 'A phosphor-coated plate that glows where electrons land, for live viewing and alignment.',
    physics: 'ZnS-type phosphor (P22 or P43) emits ~530 nm green light, near the eye’s sensitivity peak. Light spreads inside the grains, so resolution is ~50 µm and only a fraction of the electrons’ information survives (low DQE).',
    specs: [['Emission', '~530 nm (green)'], ['Resolution', '~30–50 µm'], ['Screen current', 'pA/cm² meter']],
    metrology: 'The <b>screen current meter</b>, calibrated against a Faraday cup, gives the dose rate (e⁻/Å²/s), essential for low-dose and damage studies.',
    limits: 'Low detective quantum efficiency and blur; not used for quantitative recording.',
    live: (S) => [['Dose', `${Math.round(S.dose).toLocaleString()} e⁻/Å²`], ['Camera', S.camera === 'screen' ? 'screen in use' : 'lifted (DED in use)']],
  },
  'Annular dark-field detector': {
    kicker: 'STEM detector',
    role: 'A ring-shaped scintillator that collects electrons scattered outside the bright-field cone, giving Z-contrast (HAADF) or strain-sensitive (LAADF) images.',
    physics: 'Scintillator (YAP/YAG) and photomultiplier. High inner angles (> ~3α) collect thermal-diffuse and Rutherford-like scattering, which is incoherent and grows as ~Z<sup>1.7</sup>.',
    specs: [['Inner angle', '~30–100 mrad (camera-length set)'], ['Outer angle', '~150–250 mrad'], ['Bandwidth', '~1–10 MHz']],
    metrology: 'For quantitative STEM the <b>detector sensitivity map</b> is recorded by scanning the beam over the detector, and intensities are normalised to the incident beam. Black level and gain are set so the response is linear.',
    limits: 'Non-uniform response and nonlinearity bias atom counting; camera-length errors shift the angular range.',
    live: (S) => [['Collection', `${S.detIn}–${S.detOut} mrad`], ['Type', stemDetType(S.detIn, S.detOut, S.alpha)]],
  },
  'Bright-field detector': {
    kicker: 'STEM detector',
    role: 'A small on-axis detector collecting the undiffracted cone. By reciprocity it gives TEM-like phase-contrast images.',
    physics: 'Reciprocity: a small STEM detector is equivalent to a small TEM illumination aperture. An annular version collecting the outer rim (ABF) shows light atoms such as O, N and Li.',
    specs: [['Collection', '0 – α (BF), α/2 – α (ABF)']],
    metrology: 'Its angular size relative to the BF disk is checked in diffraction mode; alignment of the disk on the detector is set with descan.',
    limits: 'Coherent contrast reverses with focus and thickness, so interpretation needs simulation.',
    live: () => [],
  },
  'Direct electron detector': {
    kicker: 'Detector',
    role: 'A radiation-hard CMOS or hybrid-pixel sensor that detects each electron directly: the camera behind 4D-STEM, DPC, ptychography and cryo-EM.',
    physics: 'Electrons deposit charge straight into the sensor, with no scintillator and no optics. In <b>counting mode</b> each event is localised and counted, suppressing read noise and Landau fluctuations, which gives near-ideal DQE. Monolithic CMOS gives small pixels; hybrid pixel arrays (for example EMPAD or Medipix) give huge dynamic range for diffraction.',
    specs: [['DQE(0), counting', '~0.8–0.9'], ['Frame rate', '1 kHz – 100 kHz'], ['Pixel size', '5–150 µm'], ['Dynamic range (hybrid)', '10⁶ : 1']],
    metrology: '<b>Gain (flat-field) and dark references</b> are taken regularly. <b>MTF</b> is measured with the knife-edge method and <b>DQE</b> from MTF and the noise power spectrum. At high flux, coincidence loss needs correction. For 4D-STEM the pattern centre and camera length are calibrated so centre-of-mass shifts are absolute.',
    limits: 'Count-rate saturation (coincidence loss), data volume (tens of GB per scan), radiation lifetime.',
    live: (S, sim) => (sim.fd ? [['4D dataset here', `${sim.fd.N}² × ${sim.fd.n4}²`], ['Angular sampling', `${f2(sim.fd.mradPx)} mrad/px`]] : [['In use for', S.mode === '4d' ? '4D-STEM' : S.camera === 'ded' ? 'imaging' : 'standby']]),
  },
  'Magnetic prism': {
    kicker: 'Spectrometer',
    role: 'A 90° magnetic sector that disperses the transmitted beam by energy: slower (energy-lost) electrons bend more.',
    physics: 'Radius of curvature r = p/(eB), so momentum differences become position differences. Multipole lenses after the prism correct second- and higher-order aberrations and magnify the dispersion onto the camera.',
    specs: [['Dispersion at camera', '0.005–1 eV/channel'], ['Resolution (monochromated)', 'down to ~5–10 meV'], ['Collection semi-angle β', '10–100 mrad']],
    metrology: 'Dispersion is calibrated by shifting the <b>drift-tube voltage</b> by a known amount or using known edges (C K 284 eV, Ni L₃ 855 eV). <b>Dual EELS</b> records the zero-loss peak simultaneously to correct energy drift. β comes from the entrance aperture and camera length.',
    limits: 'Source energy spread, HV and prism-current stability; spectrometer aberrations at large β.',
    live: (S, sim) => [['Energy resolution', `${sim.eelsRes().toFixed(2)} eV`], ['Window', `${Math.round(S.eelsWin - S.eelsWidth / 2)}–${Math.round(S.eelsWin + S.eelsWidth / 2)} eV`]],
  },
  'Energy-loss spectrum': {
    kicker: 'Spectrometer',
    role: 'The camera at the end of the spectrometer records intensity versus energy loss, from which composition, bonding and thickness are extracted.',
    physics: 'Low loss (plasmons, band gaps) and core loss (ionisation edges with fine structure) span 10⁴–10⁶ in intensity, so high-dynamic-range or dual-exposure acquisition is standard.',
    specs: [['Energy range', '0 – ~3 keV'], ['Dynamic range needed', '> 10⁵']],
    metrology: 'Quantification: fit and subtract the power-law background, then divide edge intensities by <b>cross-sections</b> for the chosen β and energy window. Thickness from log-ratio t/λ; plural scattering is removed by Fourier-ratio deconvolution. Gain/dark correction and point-spread-tail correction are applied first.',
    limits: 'Signal-to-background for weak or high-energy edges, cross-section accuracy (~5–10%), beam damage during long acquisitions.',
    live: (S, sim) => (sim.si ? [['t/λ (field of view)', `${f2(sim.si.tauMean)}`]] : []),
  },
};

export function renderComponent(name, S, sim) {
  const c = COMPONENTS[name];
  if (!c) return null;
  const live = c.live(S, sim) || [];
  const rows = (r) => r.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  return `
    <p class="eyebrow">${c.kicker} · instrument physics</p>
    <h3>${name}</h3>
    <p class="role">${c.role}</p>
    <h4>How it works</h4><p>${c.physics}</p>
    ${live.length ? `<h4>Right now</h4><table class="kv live">${rows(live)}</table>` : ''}
    <h4>Typical specifications</h4><table class="kv">${rows(c.specs)}</table>
    <h4>Measurement &amp; calibration</h4><p>${c.metrology}</p>
    <h4>What limits it</h4><p>${c.limits}</p>`;
}
