// The technique registry: the one list of techniques (modes) that the exhibit, scripting (ops.js, scripting.js),
// the headless runner, the MCP server and the Python package all read, so they cannot drift apart.
//
// Each technique has a stable id (saved in sessions, used by scripts: ids never change), a group for the UI, a
// beam family ('tem' = parallel illumination, 'probe' = focused, scanned probe) and capabilities. Modifiers (for
// example precession) attach to techniques by capability instead of adding top-level modes; see MODIFIERS.

// UI groups, in display order
export const GROUPS = ['Imaging', 'Diffraction', '4D-STEM & Phase', 'Spectroscopy', '3D & Cryo Reconstruction', 'Optics & Fields'];

// key: the keyboard shortcut. The twelve original shortcuts keep their keys; new techniques get none here.
export const TECHNIQUES = [
  { id: 'tem', name: 'TEM', sub: 'parallel-beam imaging', group: 'Imaging', family: 'tem', key: '1', caps: ['image', 'phase-contrast'] },
  { id: 'stem', name: 'STEM', sub: 'scanned probe', group: 'Imaging', family: 'probe', key: '2', caps: ['image', 'scan'] },
  { id: 'diff', name: 'SAED', sub: 'selected-area diffraction', group: 'Diffraction', family: 'tem', key: '4', caps: ['diffraction'] },
  { id: 'cbed', name: 'CBED', sub: 'convergent beam', group: 'Diffraction', family: 'probe', key: '5', caps: ['diffraction'] },
  { id: '4d', name: '4D-STEM', sub: 'pattern per pixel', group: '4D-STEM & Phase', family: 'probe', key: '3', caps: ['diffraction', 'scan', 'phase'] },
  { id: 'oah', name: 'Off-axis', sub: 'biprism holography', group: '4D-STEM & Phase', family: 'tem', key: '9', caps: ['phase'] },
  { id: 'ilh', name: 'In-line', sub: 'focal-series exit wave', group: '4D-STEM & Phase', family: 'tem', key: '0', caps: ['phase', 'focal-series'] },
  { id: 'eds', name: 'EDS', sub: 'X-ray spectra', group: 'Spectroscopy', family: 'probe', key: '6', caps: ['spectrum', 'scan'] },
  { id: 'eels', name: 'EELS', sub: 'energy loss', group: 'Spectroscopy', family: 'probe', key: '7', caps: ['spectrum', 'scan'] },
  // 3D reconstruction: a rotation series of diffraction patterns (no shortcut key: new techniques add none)
  { id: 'ed3d', name: '3D ED', sub: 'MicroED · rotation series', group: '3D & Cryo Reconstruction', family: 'tem', caps: ['diffraction', 'tilt-series'] },
  // a tilt series of images reconstructed into a volume; HAADF-STEM by default (its own signal model, no atomic probe)
  { id: 'tomo', name: 'Tomography', sub: 'tilt series · WBP / SIRT', group: '3D & Cryo Reconstruction', family: 'probe', caps: ['image', 'tilt-series'], ownProbe: true },
  { id: 'ronch', name: 'Ronchigram', sub: 'corrector tuning', group: 'Optics & Fields', family: 'probe', key: '8', caps: ['alignment'] },
  { id: 'ltem', name: 'Lorentz TEM', sub: 'magnetic domains', group: 'Optics & Fields', family: 'tem', key: '-', caps: ['image', 'magnetic'] },
  // Lorentz STEM scans a probe, but with its own (µrad) probe model rather than the atomic-resolution one
  { id: 'lstem', name: 'Lorentz STEM', sub: 'DPC induction maps', group: 'Optics & Fields', family: 'probe', key: '=', caps: ['scan', 'magnetic'], ownProbe: true },
];

// Cross-cutting modifiers: each needs one of the listed capabilities (scaffold; implemented in later milestones)
export const MODIFIERS = [
  { id: 'ped', name: 'Precession', needs: ['diffraction'] },
  { id: 'zpp', name: 'Zernike phase plate', needs: ['phase-contrast'] },
];

const BY_ID = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));
export const MODE_IDS = TECHNIQUES.map((t) => t.id);
export const technique = (id) => BY_ID[id] ?? null;
export const isMode = (id) => id in BY_ID;
// 'tem' (parallel beam) or 'probe'; unknown ids count as probe, as before
export const family = (id) => BY_ID[id]?.family ?? 'probe';
export const isParallel = (id) => family(id) === 'tem';
export const hasCap = (id, cap) => !!BY_ID[id]?.caps.includes(cap);
// the atomic-resolution probe is needed by probe techniques that do not bring their own
export const needsProbe = (id) => family(id) === 'probe' && !BY_ID[id]?.ownProbe;
export const KEYS = Object.fromEntries(TECHNIQUES.filter((t) => t.key).map((t) => [t.id, t.key]));
// techniques in display order: grouped, groups in GROUPS order, registry order within a group
export const DISPLAY = GROUPS.flatMap((g) => TECHNIQUES.filter((t) => t.group === g));
export const modifiersFor = (id) => MODIFIERS.filter((m) => m.needs.some((c) => hasCap(id, c)));
