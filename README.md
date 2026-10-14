# Seeing with Electrons

**Live exhibit: https://advanced-em.github.io/TEM-view/**

An interactive transmission electron microscope in the browser, built as a small science-museum exhibit.

- **3D cutaway column:** gun, condensers, scan coils, objective, apertures, projector, fluorescent screen, direct electron detector, ADF/BF detectors, EDS detector, EELS prism. The beam path reconfigures for each mode.
- **Six specimens:** gold nanoparticles on carbon, a Si/SiO₂ interface, a SrTiO₃ Σ5 grain boundary, the metal–organic framework **UiO-66**, and **graphene** (monolayer with a hole, a single Si dopant, a Stone–Wales defect, vacancies and a 5° twisted-bilayer moiré). Above ~86 kV the beam knocks carbon atoms out of graphene in TEM/STEM: watch holes nucleate and grow, then compare 60–80 kV. **UiO-66** (Zr₆ clusters + BDC linkers, Fm3̄m, a = 20.7 Å, viewed along [110], with a missing-cluster defect patch) is destroyed by radiolysis: the dose accumulates while the beam is on, the critical dose (~12 e⁻/Å² at 300 kV) falls as β² at lower voltage, and high-order diffraction spots fade first. It opens with low-dose settings and a *Move to a fresh area* button. **Proteins in ice**: apoferritin and ferritin (with its iron-oxide core) and a lipid vesicle in vitreous ice across a hole in a carbon film, set up as for single-particle cryo-EM (300 kV, no corrector, ~1.5 µm underfocus, ~30 e⁻/Å²). The proteins are weak phase objects, radiolysis destroys their finest detail after ~20 e⁻/Å² when cold, and the ice sublimes if the holder is warmed.
- **Ten modes:** TEM, STEM, 4D-STEM, SAED, CBED/LACBED, EDS, EELS, Ronchigram/corrector tuning, and off-axis and in-line electron holography. Each detector image is computed from a real atomic model: phase-object wave optics with a full contrast-transfer function, aberrated probes, CBED patterns per probe position, Bragg diffraction with Kikuchi lines, Fano-limited X-ray spectra, and Drude plasmons with core-loss edges.
- **Direct electron detector:** record images and patterns in counting mode instead of on the phosphor screen, and synthesize virtual BF/ABF/ADF/dark-field, **DPC**, **center-of-mass**, and live **ePIE ptychography** from the 4D dataset. The 4D data are simulated multislice (3 slices with Fresnel propagation), so single-slice ptychography shows thick-specimen artifacts, while **multislice ptychography** (MS-ePIE) fits them and reconstructs each slice in depth.
- **Aberration correction:** a Ronchigram computed from the aberrated probe on amorphous carbon; tune C1, A1, B2, A2, C3, A3 by hand (with a π/4 flat-phase readout) or run Auto-tune. Residual aberrations propagate to every probe and image.
- **CBED / LACBED:** two-beam dynamical disks with a live Kossel–Möllenstedt thickness fit, HOLZ lines that shift with lattice strain and voltage, and large-angle patterns whose lines break across the grain boundary.
- **Cryo holder** (all modes): a liquid-nitrogen dewar cools the specimen to about −180 °C. Radiolysis slows several-fold (not knock-on), vitreous ice can exist, and the holder drifts as it settles: blur in TEM (mostly removed by a direct detector's motion correction), shear in STEM, broader spectrum-image maps and weaker holographic fringes.
- **Zernike phase plate** (TEM): a π/2 plate in the back focal plane turns −sin χ into cos χ, so weak phase objects show strong contrast in focus, with the characteristic halos below the cut-on frequency.
- **Electron holography:** *Off-axis*: a Möllenstedt biprism overlaps the object wave with a vacuum reference wave; the hologram's Fourier transform shows the center band and sidebands, and the selected sideband is reconstructed into amplitude, phase and phase contours, with optional numerical removal of the lens aberrations. Biprism voltage trades fringe spacing and overlap width against fringe contrast, and the phase precision (2π/N) follows from contrast and dose. *In-line*: a focal series is recorded and the exit wave is recovered by iterative focal-series reconstruction, with a live convergence curve; the focal range controls how well slowly varying phase is recovered.
- **Results panel:** enlarge it in place (`X`) or open it in a separate window for a second screen.
- **Digital twin, across all modalities:**
  - *Instrument profile*: the parameters that belong to one particular microscope, each used by the modes it affects:

    | Modes | Profile parameters |
    | --- | --- |
    | TEM, in-line holography | energy spread, Cc, Cs, illumination angle, HV and lens stability (focal spread, information limit) |
    | TEM, STEM, spectrum-image maps | magnification calibration |
    | STEM, EDS/EELS maps | effective source size, scan aspect ratio and shear |
    | SAED, STEM detectors, 4D-STEM, CBED, Ronchigram | camera-length calibration; projector ellipticity (SAED) |
    | EDS | detector resolution at Mn Kα |
    | EELS | energy spread |
    | Off-axis holography | fringe contrast μ₀ and coherence width |

    Three generic presets (200 kV Schottky with corrector, 300 kV cryo-TEM, 300 kV cold-FEG STEM), plus an editor for your own values.
  - *Calibrate from data*, one fit per modality, in the browser (files never leave it):

    | Modality | Data | Measures |
    | --- | --- | --- |
    | TEM | image of an amorphous film (.mrc, .npy, .png, .jpg, .tif) | defocus, two-fold astigmatism (Thon rings) |
    | TEM / STEM | atomic-resolution image of a single crystal with a known spacing | magnification; STEM scan aspect and shear |
    | Diffraction | ring pattern of a gold, aluminum or silicon standard | camera length, projector ellipticity |
    | 4D-STEM, CBED, Ronchigram | vacuum pattern at a known convergence angle | mrad per pixel (camera length) |
    | EDS | spectrum with known, isolated lines | resolution at Mn Kα, energy gain and offset |
    | EELS | zero-loss peak | gun energy spread |
    | Off-axis holography | vacuum hologram | fringe spacing and contrast |

    Every tab can also simulate data from a "mystery" instrument with hidden miscalibrations, so the fits can be tried and checked. On such data they recover magnification, scan aspect and shear to ~0.02 %, defocus to ~2 nm, camera length to <1 %, detector angles to <0.1 %, energy spread to ~0.01 eV, EDS resolution to ~4 % and fringe contrast exactly.
  - *Sessions*: save and load the complete state, profile and calibrations as JSON.
  - *Export*: what the detectors recorded in the current mode as a NumPy `.npz` (images, 4D datacube, spectra, holograms, focal series) with `metadata.json` (calibrated pixel sizes, optics, state).
  - *Headless*: the simulator runs without a browser: `node tools/headless.mjs --mode tem --spec bio --cryo --df -1500 --out tem.npz`, or `--session file.json` to replay a saved session.
- **Phones and tablets:** below 1100 px the exhibit becomes one scrolling page: title, a sticky swipeable mode bar, the column, the results, then the explanation (folded to a few lines) and the controls (sections fold). Vertical swipes scroll the page; horizontal drags rotate the column or move the stage, and pinch zooms.
- **Educational ↔ realistic toggle:** a clean, labeled, false-color view, or Poisson shot noise, grayscale detectors, accumulating counts and log spectra.
- **Voice narration:** a speaker button on every component card and on the mode panel, plus an *Auto-narrate* toggle (`N`) that reads each mode and component as you open it. Two levels, **General** (for a broad audience) and **Physics** (equations, limits and metrology, in words), each in a **female** or **male** voice. Clips are generated with ElevenLabs into `audio/narration/<voice>/<level>/` (`ELEVENLABS_API_KEY=… node tools/narrate.mjs`, which only regenerates changed scripts); any clip not yet generated falls back to the browser's speech synthesis.
- **Experiments:** *One electron at a time* (watch the pattern build from single electron arrivals) and *Fly down the column*.

## Run

ES modules need to be served over HTTP (not opened as `file://`):

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. Three.js loads from jsDelivr, so the first load needs an internet connection.

To publish, push this folder to a GitHub repository and enable **Pages** on the main branch; no build step is needed. Before each release, run `node tools/stamp.mjs`: it stamps a version onto every module and the stylesheet in `index.html`, so browsers load the new code instead of a cached copy.

## Controls

Drag the column to orbit and scroll to zoom. Keys `1`–`9` and `0` switch modes, `Space` pauses, `C` toggles clarity, `L` toggles labels, `R` resets the view, `N` toggles narration, `X` enlarges the results panel. Drag the detector image to move the stage and scroll it to change magnification (in diffraction, dragging tilts the crystal). In EDS, click a peak to map it; in EELS, drag the spectrum to move the energy window. In 4D-STEM, hover the image to read patterns and drag on the pattern to reshape the detector.

## Code map

| File | Role |
| --- | --- |
| `js/physics.js` | Electron optics, FFT, specimen models (Au/C, Si/SiO₂, SrTiO₃ Σ5, graphene, UiO-66), X-ray and EELS tables |
| `js/sim.js` | Per-mode signal computation, 4D acquisition, DPC, ptychography, spectrum-image accumulation |
| `js/techniques.js` | Ronchigram & corrector, CBED/LACBED |
| `js/holography.js` | Off-axis and in-line (focal-series) electron holography |
| `js/profile.js` | Instrument profile, presets, focal spread |
| `js/state.js` | Default state and the keys a session stores |
| `js/calibrate.js`, `js/calibui.js` | Thon-ring and zero-loss fits, file readers (.mrc, .npy, images), calibration dialog |
| `js/export.js`, `js/npy.js` | Data export to NumPy `.npz` |
| `tools/headless.mjs` | Run the simulator in Node and save `.npz` |
| `js/components.js` | Instrument-physics cards for the column labels |
| `js/render2d.js` | Detector views, spectra, overlays |
| `js/scene3d.js` | Three.js column, beams, electrons, labels, tour |
| `js/explain.js` | Plain-English explanations and instrument readout |
| `js/narration.js` | Narration scripts and audio playback |
| `tools/narrate.mjs` | Generates the narration clips with ElevenLabs |
| `js/main.js` | State, controls, interaction, render loop |
