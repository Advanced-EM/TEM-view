// Spoken narration for the column components and the eight modes.
// Scripts are written for the ear (no symbols or subscripts) and kept fixed, so pre-generated
// audio in audio/narration/<id>.mp3 always matches. If a clip is missing, the browser's own
// speech synthesis reads the same script.

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const NARRATION = {
  // ---------------------------------------------------------------- modes
  'mode-tem': `Transmission electron microscopy. A broad, parallel electron wave floods the specimen. Atoms barely absorb electrons. Instead, they shift the phase of the wave passing through them. The objective lens turns those invisible phase shifts into light and dark, by recombining scattered and unscattered waves with a small, deliberate defocus. So the dots you see are interference fringes, not photographs of atoms. Change the focus, and black can swap for white. The panel on the right is the image's Fourier transform. Its rings, called Thon rings, are the fingerprint of the lens.`,
  'mode-stem': `Scanning transmission electron microscopy. The lenses squeeze the beam into a needle about one ångström wide, and raster it across the sample, point by point. At each point, detectors count what comes out. The ring-shaped high-angle annular dark-field detector catches electrons flung outward by close passes to the nucleus. That signal grows roughly as the atomic number to the power of one point seven, so brightness reads almost directly as atomic number. Gold blazes. Carbon nearly vanishes.`,
  'mode-4d': `Four-dimensional STEM. Instead of summing electrons on a fixed ring, a direct electron detector, running at thousands of frames per second, records the entire diffraction pattern at every probe position. That is two scan axes times two detector axes. Detectors are now designed afterwards, in software. Differential phase contrast and centre-of-mass imaging track how each atom's electric field nudges the beam sideways. Ptychography goes further, solving for the specimen's full phase from the overlapping patterns. And multislice ptychography slices the specimen in depth, recovering what single-slice methods blur together.`,
  'mode-diff': `Selected-area electron diffraction. The lower lenses are refocused from the image to the back focal plane of the objective, where every electron leaving the sample in the same direction lands on the same point. A crystal only scatters into Bragg directions, so it prints a lattice of spots. Many randomly oriented crystals print rings. The distance of each spot from the centre gives the spacing between atomic planes directly. The faint straight bands are Kikuchi lines. They are locked to the crystal, and swing as you tilt it.`,
  'mode-cbed': `Convergent-beam electron diffraction. Instead of a parallel beam, a cone of electrons is focused onto one small spot, so each Bragg reflection spreads into a disk. Inside those disks, intensity oscillates as electrons scatter back and forth between beams, and the spacing of those fringes measures the specimen's thickness to a few nanometres. Fine dark lines from higher-order Laue zones shift with tiny changes in lattice parameter, so CBED is used to map strain. Large-angle CBED widens the view, and its lines break where they cross a grain boundary.`,
  'mode-eds': `Energy-dispersive X-ray spectroscopy. When a fast electron knocks out an inner-shell electron, an outer electron drops into the hole and the atom emits an X-ray with an energy unique to that element. A silicon drift detector beside the specimen counts these photons and sorts them by energy. Each peak names an element, and its height tells you how much is there. Scan the probe, and every pixel gets its own spectrum, giving chemical maps at near-atomic resolution. Click a peak to map that element.`,
  'mode-eels': `Electron energy-loss spectroscopy. After the sample, a magnetic prism bends the beam, and slower electrons bend more, spreading the beam into a spectrum of energy lost. The tall zero-loss peak is electrons that lost nothing. The broad hump a few tens of electron volts away is the plasmon, a collective oscillation of the valence electrons. Further out, sharp edges mark inner-shell ionisation, a fingerprint of each element, and their fine structure reveals bonding and oxidation state. Drag the window across the spectrum to map a single edge.`,
  'mode-ronch': `The Ronchigram, and aberration correction. With the beam focused on thin amorphous carbon and the image of the probe's diffraction plane on the camera, the lens's aberrations become visible as distortions in a shadow image. At the centre lies a smooth, flat region where the electron wave's phase stays within a quarter wavelength. That flat patch sets the largest usable convergence angle, and therefore the smallest probe. Adjust the corrector's coefficients, defocus, astigmatism, coma and spherical aberration, to grow the flat region, or press auto-tune and watch the corrector do it.`,

  // ---------------------------------------------------------------- components
  'Electron gun': `The electron gun. A Schottky field-emission tip, a sharp tungsten crystal coated with zirconium oxide and heated to about eighteen hundred kelvin, emits electrons from a virtual source only fifteen nanometres across. Its brightness decides how much current can be packed into an atom-sized probe, and its energy spread, under one electron volt, sets the chromatic limit on resolution. Cold field emitters trade stability for an even narrower energy spread.`,
  'High-voltage accelerator': `The high-voltage accelerator. A stack of electrodes accelerates the electrons to their working voltage, up to three hundred kilovolts. At that energy they travel at seventy-eight percent of the speed of light, with a wavelength of about two picometres. The voltage must be stable to better than one part per million, because any ripple blurs the image just like the gun's own energy spread.`,
  'Condenser lens 1': `The first condenser lens. It demagnifies the image of the source, a setting called the spot size. A stronger lens makes a smaller source image, with less current but more coherence. Like every lens here, it is a copper coil in a soft iron yoke, focusing electrons with a magnetic field, and spinning the image as they spiral through.`,
  'Condenser lens 2': `The second condenser lens. It decides how the beam arrives at the specimen: as a broad, parallel wave for imaging and diffraction, or as a tight converging cone focused to a probe for scanning work.`,
  'Condenser aperture': `The condenser aperture. A small hole in a metal strip that trims the beam. In scanning mode it sets the convergence angle of the probe, and so the balance between diffraction blur, which favours a big aperture, and lens aberrations, which favour a small one.`,
  'Aberration corrector': `The aberration corrector. Round magnetic lenses always suffer from positive spherical aberration: rays far from the axis focus too strongly. A corrector, built from multipole lenses such as hexapoles, introduces a compensating negative aberration. That one idea took electron microscopes from about two ångströms to below half an ångström, and earned the pioneers the Kavli Prize.`,
  'Scan coils': `The scan coils. Two pairs of deflection coils tilt the beam and then tilt it back, so it shifts across the specimen while still passing through the lens's pivot point. In scanning mode they raster the probe line by line. Their calibration, and how fast they settle at the start of each line, decide the accuracy of every distance you measure.`,
  'Objective lens': `The objective lens, the heart of the microscope. The specimen sits inside its pole-piece gap, in a field of about two tesla. Every image detail passes through this lens first, so its spherical and chromatic aberrations, and how it transfers each spatial frequency, set the resolution of the whole instrument.`,
  'EDS X-ray detector': `The energy-dispersive X-ray detector. A silicon drift detector, angled toward the specimen, catches characteristic X-rays and measures each photon's energy. The larger the solid angle it covers, the more of the rare X-ray events it collects, which is why modern instruments surround the sample with several detectors.`,
  'Objective aperture': `The objective aperture. It sits in the back focal plane and selects which scattered beams form the image. A small aperture around the central beam gives bright-field contrast. Shifting it onto a single diffracted beam gives a dark-field image, lighting up only the crystals that diffract into it.`,
  'Back focal plane': `The back focal plane. Here, every electron leaving the specimen in the same direction meets at the same point, so this plane holds the diffraction pattern. Switching between imaging and diffraction simply means telling the lower lenses which plane to magnify: the image plane, or this one.`,
  'Selected-area aperture': `The selected-area aperture. Placed in an image plane, it picks out a region of the specimen, so the diffraction pattern comes only from that region. It is how you get a pattern from one grain, without its neighbours.`,
  'Intermediate lens': `The intermediate lens. By changing its strength, the microscope chooses whether the projector system magnifies the image or the diffraction pattern, and sets the magnification or camera length.`,
  'Projector lens': `The projector lens. The final lens enlarges the image or pattern onto the screen or camera, with total magnifications from a few hundred to several million times.`,
  'Fluorescent screen': `The fluorescent screen. A layer of phosphor glows green where electrons strike, for viewing by eye. It swings up out of the way whenever a camera or detector below it is in use.`,
  'Annular dark-field detector': `The annular dark-field detector. A ring-shaped scintillator collects electrons scattered to high angles. Because that scattering grows strongly with atomic number, the image shows heavy atoms bright and light atoms dim, with little sensitivity to focus or thickness.`,
  'Bright-field detector': `The bright-field detector. A small disk on the axis collects electrons that pass through with little deflection. Its images resemble conventional transmission images, and an annular version, the annular bright-field detector, can reveal light atoms such as oxygen and lithium.`,
  'Direct electron detector': `The direct electron detector. Instead of converting electrons to light, each electron is detected directly in a thin silicon sensor, and counted individually. Running at thousands of frames per second, it records full diffraction patterns at every scan position, which makes four-dimensional STEM and ptychography possible.`,
  'Magnetic prism': `The magnetic prism. A uniform magnetic field bends the beam through ninety degrees or more. Electrons that lost energy in the specimen are slower, so they bend more, spreading the beam into an energy-loss spectrum with a resolution set by the gun's energy spread.`,
  'Energy-loss spectrum': `The energy-loss spectrum. Read from left to right: the zero-loss peak, the plasmon, and then the core-loss edges of each element. With a monochromator, modern instruments resolve energy losses of a few millielectron volts, enough to measure atomic vibrations.`,
};

// Playback: pre-generated ElevenLabs clips when present, browser speech otherwise.
const BASE = 'audio/narration/';
let manifest = null;
const manifestReady = fetch(BASE + 'manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((m) => (manifest = m));

let audio = null, utter = null, current = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f(current));
export const onNarration = (f) => listeners.add(f);
export const playing = () => current;

export function stop() {
  if (audio) { audio.pause(); audio = null; }
  if (utter && 'speechSynthesis' in window) speechSynthesis.cancel();
  utter = null;
  current = null;
  emit();
}

export async function speak(id) {
  stop();
  const text = NARRATION[id];
  if (!text) return;
  current = id;
  emit();
  await manifestReady;
  if (current !== id) return;
  const file = manifest?.[id];
  if (file) {
    const a = new Audio(BASE + file);
    audio = a;
    a.onended = () => { if (audio === a) { audio = null; current = null; emit(); } };
    try { await a.play(); return; } catch { audio = null; if (current !== id) return; }
  }
  if (!('speechSynthesis' in window)) { current = null; emit(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0;
  const v = speechSynthesis.getVoices().find((x) => /en[-_](GB|US)/.test(x.lang) && /Natural|Google|Samantha|Daniel/.test(x.name));
  if (v) u.voice = v;
  u.onend = () => { if (utter === u) { utter = null; current = null; emit(); } };
  utter = u;
  speechSynthesis.speak(u);
}

export const toggle = (id) => (current === id ? stop() : speak(id));
