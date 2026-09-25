# Seeing with Electrons

**Live exhibit: https://advanced-em.github.io/TEM-view/**

An interactive transmission electron microscope in the browser, built as a small science-museum exhibit.

- **3D cutaway column:** gun, condensers, scan coils, objective, apertures, projector, fluorescent screen, direct electron detector, ADF/BF detectors, EDS detector, EELS prism. The beam path reconfigures for each mode.
- **Ten techniques:** TEM, STEM, 4D-STEM, electron tomography, SAED, CBED/LACBED, 3D-ED (MicroED), EDS, EELS and Ronchigram/corrector tuning. Each detector image is computed from a real atomic model: phase-object wave optics with a full contrast-transfer function, aberrated probes, CBED patterns per probe position, Bragg diffraction with Kikuchi lines, Fano-limited X-ray spectra, and Drude plasmons with core-loss edges.
- **Direct electron detector:** record images and patterns in counting mode instead of on the phosphor screen, and synthesise virtual BF/ABF/ADF/dark-field, **DPC**, **centre-of-mass**, and live **ePIE ptychography** from the 4D dataset.
- **Aberration correction:** a Ronchigram computed from the aberrated probe on amorphous carbon; tune C1, A1, B2, A2, C3, A3 by hand (with a π/4 flat-phase readout) or run Auto-tune. Residual aberrations propagate to every probe and image.
- **CBED / LACBED:** two-beam dynamical disks with a live Kossel–Möllenstedt thickness fit, HOLZ lines that shift with lattice strain and voltage, and large-angle patterns whose lines break across the grain boundary.
- **3D-ED / MicroED:** continuous-rotation frames build a 3D reciprocal lattice with a missing wedge; completeness, the lattice parameter, and lattice centring and glide planes are read from systematic absences.
- **Tomography:** an HAADF tilt series of a 3D catalyst phantom, reconstructed live by weighted back-projection or SIRT, with orthoslices, a volume render, Crowther resolution and missing-wedge elongation.
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

Drag the column to orbit and scroll to zoom. Keys `1`–`9` and `0` switch modes, `Space` pauses, `C` toggles clarity, `L` toggles labels, `R` resets the view. Drag the detector image to move the stage and scroll it to change magnification (in diffraction, dragging tilts the crystal). In EDS, click a peak to map it; in EELS, drag the spectrum to move the energy window. In 4D-STEM, hover the image to read patterns and drag on the pattern to reshape the detector.

## Code map

| File | Role |
| --- | --- |
| `js/physics.js` | Electron optics, FFT, specimen models (Au/C, Si/SiO₂, SrTiO₃ Σ5), X-ray and EELS tables |
| `js/sim.js` | Per-mode signal computation, 4D acquisition, DPC, ptychography, spectrum-image accumulation |
| `js/techniques.js` | Ronchigram & corrector, CBED/LACBED, 3D-ED, tomography |
| `js/components.js` | Instrument-physics cards for the column labels |
| `js/render2d.js` | Detector views, spectra, overlays |
| `js/scene3d.js` | Three.js column, beams, electrons, labels, tour |
| `js/explain.js` | Plain-English explanations and instrument readout |
| `js/main.js` | State, controls, interaction, render loop |
