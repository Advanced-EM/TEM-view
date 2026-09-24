# Seeing with Electrons

**Live exhibit: https://advanced-em.github.io/TEM-view/**

An interactive transmission electron microscope in the browser, built as a small science-museum exhibit.

- **3D cutaway column:** gun, condensers, scan coils, objective, apertures, projector, fluorescent screen, direct electron detector, ADF/BF detectors, EDS detector, EELS prism. The beam path reconfigures for each mode.
- **Six modes:** TEM, STEM, 4D-STEM, Diffraction, EDS, EELS. Each detector image is computed from a real atomic model: phase-object wave optics with a full contrast-transfer function, aberrated probes, CBED patterns per probe position, Bragg diffraction with Kikuchi lines, Fano-limited X-ray spectra, and Drude plasmons with core-loss edges.
- **Direct electron detector:** record images and patterns in counting mode instead of on the phosphor screen, and synthesise virtual BF/ABF/ADF/dark-field, **DPC**, **centre-of-mass**, and live **ePIE ptychography** from the 4D dataset.
- **Educational ↔ realistic toggle:** a clean, labelled, false-colour view, or Poisson shot noise, grayscale detectors, accumulating counts and log spectra.
- **Experiments:** *One electron at a time* (watch the pattern build from single electron arrivals) and *Fly down the column*.

## Run

ES modules need to be served over HTTP (not opened as `file://`):

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. Three.js loads from jsDelivr, so the first load needs an internet connection.

To publish, push this folder to a GitHub repository and enable **Pages** on the main branch; no build step is needed.

## Controls

Drag the column to orbit and scroll to zoom. Keys `1`–`6` switch modes, `Space` pauses, `C` toggles clarity, `L` toggles labels, `R` resets the view. Drag the detector image to move the stage and scroll it to change magnification (in diffraction, dragging tilts the crystal). In EDS, click a peak to map it; in EELS, drag the spectrum to move the energy window. In 4D-STEM, hover the image to read patterns and drag on the pattern to reshape the detector.

## Code map

| File | Role |
| --- | --- |
| `js/physics.js` | Electron optics, FFT, specimen models (Au/C, Si/SiO₂, SrTiO₃ Σ5), X-ray and EELS tables |
| `js/sim.js` | Per-mode signal computation, 4D acquisition, DPC, ptychography, spectrum-image accumulation |
| `js/render2d.js` | Detector views, spectra, overlays |
| `js/scene3d.js` | Three.js column, beams, electrons, labels, tour |
| `js/explain.js` | Plain-English explanations and instrument readout |
| `js/main.js` | State, controls, interaction, render loop |
