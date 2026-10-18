# Seeing with Electrons

**Live exhibit: https://advanced-em.github.io/TEM-view/**

An interactive transmission electron microscope in the browser, built as a small science-museum exhibit.

- **3D cutaway column:** gun, condensers, scan coils, objective, apertures, projector, fluorescent screen, direct electron detector, ADF/BF detectors, EDS detector, EELS prism. The beam path reconfigures for each mode.
- **Six specimens:** gold nanoparticles on carbon, a Si/SiO₂ interface, a SrTiO₃ Σ5 grain boundary, the metal–organic framework **UiO-66**, and **graphene** (monolayer with a hole, a single Si dopant, a Stone–Wales defect, vacancies and a 5° twisted-bilayer moiré). Above ~86 kV the beam knocks carbon atoms out of graphene in TEM/STEM: watch holes nucleate and grow, then compare 60–80 kV. **UiO-66** (Zr₆ clusters + BDC linkers, Fm3̄m, a = 20.7 Å, viewed along [110], with a missing-cluster defect patch) is destroyed by radiolysis: the dose accumulates while the beam is on, the critical dose (~12 e⁻/Å² at 300 kV) falls as β² at lower voltage, and high-order diffraction spots fade first. It opens with low-dose settings and a *Move to a fresh area* button. **Proteins in ice**: apoferritin and ferritin (with its iron-oxide core) and a lipid vesicle in vitreous ice across a hole in a carbon film, set up as for single-particle cryo-EM (300 kV, no corrector, ~1.5 µm underfocus, ~30 e⁻/Å²). The proteins are weak phase objects, radiolysis destroys their finest detail after ~20 e⁻/Å² when cold, and the ice sublimes if the holder is warmed.
- **Ten modes:** TEM, STEM, 4D-STEM, SAED, CBED/LACBED, EDS, EELS, Ronchigram/corrector tuning, and off-axis and in-line electron holography. Each detector image is computed from a real atomic model: phase-object wave optics with a full contrast-transfer function, aberrated probes, CBED patterns per probe position, Bragg diffraction with Kikuchi lines, Fano-limited X-ray spectra, and Drude plasmons with core-loss edges.
- **Direct electron detector:** record images and patterns in counting mode instead of on the phosphor screen, and synthesize virtual BF/ABF/ADF/dark-field, **DPC**, **center-of-mass**, and live **ePIE ptychography** from the 4D dataset. The 4D data are simulated multislice (3 slices with Fresnel propagation), so single-slice ptychography shows thick-specimen artifacts, while **multislice ptychography** (MS-ePIE) fits them and reconstructs each slice in depth.
- **Aberration correction:** a Ronchigram computed from the aberrated probe on amorphous carbon; tune C1, A1, B2, A2, C3, A3 by hand (with a π/4 flat-phase readout) or run Auto-tune. Residual aberrations propagate to every probe and image.
- **CBED / LACBED:** two-beam dynamical disks with a live Kossel–Möllenstedt thickness fit, HOLZ lines that shift with lattice strain and voltage, and large-angle patterns whose lines break across the grain boundary.
- **EELS spectrometer:** a 2048-channel detector with selectable **dispersion** (0.01–1 eV per channel) and **energy offset** (drift tube). Presets for the zero loss, low loss, core loss and high loss. Each channel integrates the spectrum over its width and the detector smears it over ~2 channels, so coarse dispersion visibly broadens the **zero-loss peak** and edge onsets. The zero loss's width and position are measured live; in realistic mode it drifts by a few tenths of an eV per minute (smearing long acquisitions) until you press *Align zero loss*. The camera has a probe current, an exposure per readout and a **full well** (~16,400 electrons per channel per readout): the zero loss saturates within milliseconds at fine dispersion, and saturated channels are clipped (flat, in red) in both the expected and the recorded spectra, with read noise in each readout. **Dual EELS** records a short-exposure low-loss spectrum and a long-exposure core-loss spectrum together: the core loss is realigned frame by frame on the recorded zero loss (no drift smear), and the low loss gives the thickness t/λ, flagged as wrong when its zero loss saturates.
- **Acquire:** the camera button above the detector (or `I`, or the panels) records what the detector shows as a numbered acquisition, with its data and settings; on beam-sensitive specimens it spends a dose. Acquisitions collect in a gallery for this session, each downloadable as PNG or NumPy `.npz`.
- **Specimen holders and temperature** (all modes): room temperature, a liquid-nitrogen cryo holder (grid ~90–300 K), a liquid-helium cryo holder (tip 4.2 K, grid ~8–15 K with ±1.5 K fluctuations), and a MEMS heating holder (up to ~1470 K, reading accurate to ~1 %). The specimen's real temperature differs from the setpoint and fluctuates, and it drives:
  - *radiolysis*: critical dose ×3–4 at liquid-nitrogen temperature, ~20–50 % more with helium, and falling when hot; knock-on damage is unaffected;
  - *atomic vibrations* (Einstein model, u_rms 0.047 Å zero-point → 0.08 Å at 293 K → 0.15 Å at 1000 K): atom width and Debye–Waller damping in images, diffraction and CBED, and thermal-diffuse scattering into HAADF;
  - *thermal expansion* per material (gold +1 % at 1000 K and −0.3 % at 10 K; graphene and UiO-66 contract when heated), which moves CBED HOLZ lines;
  - *ice*: vitreous ice crystallizes irreversibly above ~140 K and sublimes above ~165 K;
  - *thermal effects*: hydrocarbon contamination desorbs from hot graphene and its vacancies heal; UiO-66 decomposes above ~720 K and proteins above ~315 K;
  - *drift*: each holder's own drift plus settling after insertion, cooling or a temperature step.
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
  - *Headless*: the simulator runs without a browser: `node tools/headless.mjs --mode tem --spec bio --cryo --df -1500 --out tem.npz` (or `--holder lhe --temp 4.2`, `--holder heat --temp 1000`), or `--session file.json` to replay a saved session.
- **Control panel:** a physical panel laid out like a microscope's hand panels (focus, magnification, intensity, multifunction knobs, stage joystick) drives the exhibit through the Gamepad API, with no drivers; ordinary game controllers work as a stand-in. Knob functions follow the mode (magnification becomes camera length in diffraction, a context knob sets convergence, selected area, biprism voltage or temperature). A heads-up display shows the multifunction mode and the last change; the panel dialog (gamepad icon) shows live input and remaps axes and buttons. Without hardware, the **on-screen panel** (key `V`, or the panel dialog) offers the same console with keyboard and mouse: Q/W focus, A/S magnification, Z/X intensity, H/L and K/J multifunction, O/P context knob, arrow keys for the stage, Tab for the multifunction mode (stigmator, image shift, tilt; in the Ronchigram with the corrector on also coma B2, three-fold A2, four-fold A3 and Cₛ, each as an X/Y vector), F fine/coarse, B wobbler, G optimal focus, `,`/`.` mode (Shift = 5 detents); knobs also turn by dragging or scrolling. It docks over the page (draggable) or pops out into its own window, for a second screen. Protocol, reference RP2040 firmware, pin map and parts list: [`hardware/panel`](hardware/panel/README.md). The physical **TEM-view Console** (concept, in development for Kickstarter) has its own page at [`console/`](console/index.html), linked from the help panel, the on-screen panel and the panel dialog; its 3D-printable prototype enclosure is in [`hardware/panel/enclosure`](hardware/panel/enclosure/README.md).
- **Training scenarios and behavior telemetry (research pilot):** The **Training** button at the top of the controls (or `T`) opens training scenarios: tasks that start a task with a hidden, seeded misalignment that the user must find: **Focus and stigmate** (TEM, gold: correct an unknown two-fold astigmatism and reach Scherzer defocus) and **Tune the corrector** (Ronchigram: null hidden C1, C3, A1, B2, A2, A3, up to a few µm of coma and three-fold, until the flat area reaches 30 mrad, with auto-tune disabled; corrector knobs cover C1 ±300 nm, Cₛ ±200 µm, A1 500 nm, B2 and A2 8 µm, A3 80 µm with 0.1° angles). The user only sees the image; the exhibit keeps the truth (wave-aberration phase error against the Rayleigh quarter-wave limit, residual terms, dose) and asks the user to rate the result and name the cues they used before revealing how good it really was. Recording is **opt-in** for each scenario, stores no personal data (an anonymous random id and a self-reported experience level) and never leaves the browser: the session downloads as JSON (`tem-view-telemetry/1`: every setting change with its input source, mouse, keyboard, panel or controller, snapshots every 0.5 s, acquisitions, judgments, hidden metrics). *Replay a session* plays a file back with a scrubber, the true score over time and the action log. `python3 tools/analysis/sessions.py sessions/*.json --plot score.png --csv summary.csv` summarizes sessions: duration, time to success, changes per setting and input, the order of operations (stigmate → focus → …) and how far the user's judgment was from the truth. **To Hugging Face:** [`hf/`](hf/README.md) turns sessions into a dataset (`sessions` and `steps` tables for imitation learning and judgment models), pushes it to a private dataset repo, and includes a session collector: a free Cloudflare Worker (`hf/worker`) or a Hugging Face Space on a paid plan (`hf/space`). Visitors who choose *Record and share* on the consent screen send their session automatically when the task ends; *Record only* keeps it local unless they send it from the result screen. `js/config.js` holds the collector address; leave it empty to keep everything local.
- **Voice and AI agents:**
  - **Typed commands:** the command bar above the results, shown with the **AI mode** (brain) button at the top of the controls or with `/`, and hidden with Esc, takes the same commands, with history (↑/↓) and suggestions. Near misses ("swich to stm", "defocs minus 80") are spell-corrected against the microscope's vocabulary and **confirmed before they run** ("Did you mean *switch to STEM*?"): click, or say or type "yes", "no", or "the second one".
  - **Analyses** of what is on screen, compared with the simulator's true settings ([`js/analyze.js`](js/analyze.js)):

    | Command | Analysis | emskills skill |
    | --- | --- | --- |
    | "fit the CTF", "what is the defocus?" | `fit_ctf` | ctf-fitter |
    | "index the rings", "measure the d-spacings" | `fit_lattice` | lattice-dspacing |
    | "which edges are there?" | `identify_edges` | eels-edge-id |
    | "fit the EDS peaks" | `fit_eds` | not in the registry (edax-phase-map is related) |
    | "what is the energy spread?" | `fit_zlp` | not in the registry |
    | "measure the fringes" | `fit_hologram` | not in the registry |
  - **Voice commands:** hold `M` (or the microphone button, the on-screen panel's Talk key, or the Console's talk key) and speak a command, such as "switch to STEM", "load graphene", "defocus minus fifty", "cool to 90 kelvin" or "acquire". The grammar is in [`js/voice.js`](js/voice.js). The browser's speech recognition does the listening; in Chrome and Edge that happens on Google's or Microsoft's servers, and the exhibit asks for consent the first time.
  - **AI agents:** [`tools/temview-mcp`](tools/temview-mcp/README.md) is an MCP server. With it, an agent (for example with [emskills](https://emskills.org)) can run the twin headlessly, or drive an open exhibit after the visitor clicks *Connect agent*: read the state, change settings, acquire data, and answer spoken questions out loud. The twin is also the `tem-view-twin` skill in the emskills registry.
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

Drag the column to orbit and scroll to zoom. Keys `1`–`9` and `0` switch modes, `Space` pauses, `C` toggles clarity, `L` toggles labels, `R` resets the view, `N` toggles narration, `X` enlarges the results panel, `V` opens the on-screen control panel, `I` acquires, `T` opens training, hold `M` to talk, `[` and `]` hide or show the explanation and controls panels (or the ‹ › buttons; a tab at the screen edge brings them back). Drag the detector image to move the stage and scroll it to change magnification (in diffraction, dragging tilts the crystal). In EDS, click a peak to map it; in EELS, drag the spectrum to move the energy window. In 4D-STEM, hover the image to read patterns and drag on the pattern to reshape the detector.

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
| `js/panel.js` | Hardware control panel and game controllers (Gamepad API) |
| `js/vpanel.js` | On-screen control panel (keyboard, mouse, touch; docked or popped out) |
| `js/acquire.js` | Acquisitions and their gallery |
| `js/voice.js`, `js/agent.js` | Command grammar, spelling correction and confirmation, push-to-talk; bridge to an AI agent |
| `js/analyze.js` | Analyses of the live data (CTF, indexed d-spacings, EELS edges, ZLP, EDS, hologram), named after emskills tools |
| `tools/temview-mcp/` | MCP server for agents: headless simulation and live control of the exhibit |
| `js/telemetry.js` | Opt-in session recorder (`tem-view-telemetry/1`) |
| `js/scenarios.js` | Training scenarios with hidden misalignments, judgment, reveal, replay |
| `js/config.js` | Deployment settings (where shared sessions go; empty = local only) |
| `hf/build_dataset.py`, `hf/worker/`, `hf/space/` | Hugging Face dataset builder; session collector as a Cloudflare Worker or an HF Space |
| `tools/analysis/sessions.py` | Summaries and plots of recorded sessions (with an example in `sample/`) |
| `hardware/panel/` | Panel protocol, reference firmware (RP2040), pin map, parts |
| `js/components.js` | Instrument-physics cards for the column labels |
| `js/render2d.js` | Detector views, spectra, overlays |
| `js/scene3d.js` | Three.js column, beams, electrons, labels, tour |
| `js/explain.js` | Plain-English explanations and instrument readout |
| `js/narration.js` | Narration scripts and audio playback |
| `tools/narrate.mjs` | Generates the narration clips with ElevenLabs |
| `js/main.js` | State, controls, interaction, render loop |
