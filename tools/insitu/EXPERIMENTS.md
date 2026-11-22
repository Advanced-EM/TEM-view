# In situ experiment designs

Copyright © 2026 by Northwestern University. All Rights Reserved.

Eight experiments for liquid cells, gas cells and ETEM, heating and biasing, each designed to answer one question.
Each design is a ready session: load it in the exhibit (**Data, dose and compute → Load session**,
[`sessions/`](sessions/)), check the settings, and press **Record movie**. The expected results below come from
recording each design headlessly and measuring it frame by frame; [`experiments.mjs`](experiments.mjs) does that
and writes [`results.json`](results.json):

```bash
node tools/insitu/experiments.mjs          # all designs (about 5 min); or name them: … E3 E5
```

**Design your own.** In the exhibit, turn on **In situ experiment** (below the specimen controls), then:
1. *Start from* a blank design or any of E1–E8.
2. Give the experiment a name and the question it answers.
3. Tick what to measure each frame. Only the observables that apply to the cell, holder, chip, specimen and
   technique in use are offered.
4. Build the timeline. A ramp can drive temperature, gas pressure, bias voltage or the liquid dose rate, and a step
   can switch the gas.
5. Size the movie, and record. The observables plot live.

**Save session** keeps the whole design. **Export data** writes the frames with one array per observable, the
design, and the kinetics behind every process in play, with each parameter's source.

**How far to trust the kinetics.** Every constant comes from a parameter table
([`js/kinetics.js`](../../js/kinetics.js)) with a unit, an uncertainty, a source and a label:

| Process | Label | Model |
| --- | --- | --- |
| Radiolysis | literature | A water-radiolysis reaction network: published yields and rate constants (Buxton et al. 1988; Schneider et al. 2014), diffusion out of the beam, a reservoir that fills in a static cell and is flushed in a flow cell, closed graphene pockets |
| Bubbles | literature | Nucleate where H₂ exceeds its Henry solubility at the liquid's pressure |
| Growth from a precursor | trend | Gold ions reduced by hydrated electrons from the network; the share that deposits on existing particles (η = 0.003) is a placeholder |
| Sintering | trend | One Arrhenius rate; the ×2 in oxygen is established for platinum and unverified for gold |
| Redox | trend | Relaxation to the gas's equilibrium at an Arrhenius rate |
| Electrochemistry | trend | Butler–Volmer with a placeholder exchange rate |

*Literature* means published parameters that have not yet been compared with in situ TEM data here. *Trend*
means the value only reproduces a published trend. Treat results labelled *trend* as qualitative. The next step,
calibrating against measured series, will add *calibrated* parameters with the dataset named.

Holders, cells and chips are described by their physics (window material and size, gap, pressure, electrode
layout), never by product names. Acquisition, export and processing follow [SOP HPC-09](../hpc/SOP.md#hpc-09-acquire-an-in-situ-campaign).

| | Experiment | Environment | Technique | Movie | Full-scale data |
| --- | --- | --- | --- | --- | --- |
| [E1](#e1-radiolysis-bubbles-from-the-beam-or-from-a-cell-that-fills-with-h₂) | Radiolysis: bubbles from the beam, or from a cell that fills with H₂? | liquid (static vs flow) | TEM | 300 s, 1 fps | 9.4 GB per run |
| [E2](#e2-gold-growth-against-dose-rate) | Gold growth against dose rate | liquid + precursor | TEM | 60 s, 2 fps | 3.8 GB |
| [E3](#e3-sintering-of-gold-nanoparticles-oxygen-versus-nitrogen) | Sintering: oxygen versus nitrogen | windowed gas cell + heating | TEM | 180 s, 1 fps | 5.6 GB per run |
| [E4](#e4-how-much-gas-can-the-image-take) | How much gas can the image take? | open column (ETEM) | TEM | 70 s, 1 fps | 2.2 GB |
| [E5](#e5-redox-cycling-of-srtio₃) | Redox cycling of SrTiO₃ | windowed gas cell + heating, gas switched | TEM, then EDS/EELS | 240 s, 1 fps | 7.5 GB |
| [E6](#e6-helium-bubbles-in-silicon-on-annealing) | Helium bubbles in silicon on annealing | heating in vacuum | TEM | 600 s, 1 fps | 18.8 GB |
| [E7](#e7-the-field-across-a-biased-gap-then-breakdown) | The field across a biased gap, then breakdown | biasing chip | off-axis holography | 25 s, 1 fps | 0.8 GB |
| [E8](#e8-electrochemistry-deposit-gold-then-strip-it) | Electrochemistry: deposit gold, then strip it | liquid + biasing | TEM | 60 s, 2 fps | 3.8 GB |

Full-scale data is the estimator's figure for a 4096² camera at 16 bits, all frames. Every design lands in the
*local GPU* tier for processing. The cluster route (bundle → `run_job.py` insitu engine: drift correction, aligned
sum, per-frame environment) is in SOP HPC-09.

**One thing to set consistently in liquid experiments:** the liquid cell's **Dose rate** drives radiolysis, while
the exhibit's **Electron dose** sets image noise and the estimator's dose. On a real microscope they are the same
beam. Before recording, set the electron dose per frame to (dose rate ÷ frames per second). Otherwise the estimate's
total dose will not describe the experiment.

---

## E1 Radiolysis: bubbles from the beam, or from a cell that fills with H₂?

**Question:** below the dose rate at which the beam itself supersaturates H₂, do bubbles still form in a static cell,
and does flow prevent them?

- **Setup:** gold nanoparticles; SiNₓ liquid cell, 50 × 200 µm windows, 500 nm spacer, liquid at 1 bar; TEM at
  40 nm field of view.
- **Variants:** static cell, and flow cell at 2 µL/min (sessions `E1-static`, `E1-flow`).
- **Timeline:** 10 e⁻/Å²/s held for 240 s, then ramped to 200 e⁻/Å²/s over 240–300 s.
- **Measure (preselected):** bubbles in view; H₂ in the beam; H₂ in the rest of the cell; pH.

**Expected:**

| | Beam's own threshold | H₂ in the cell at 200 s | First bubble | Dose rate then |
| --- | --- | --- | --- | --- |
| Static | 109 e⁻/Å²/s (H₂ reaches 770 µM) | 817 µM, supersaturated | 144 s | 10 e⁻/Å²/s |
| Flow, 2 µL/min | 109 e⁻/Å²/s | 0 µM, flushed | 280 s | 137 e⁻/Å²/s |

- At 10 e⁻/Å²/s the beam makes only 79 µM H₂ locally. But H₂ diffuses out into the static cell's liquid, which fills
  until it is supersaturated: bubbles form after 2–3 minutes, far below the beam's own threshold.
- Flow flushes that liquid. Bubbles then come only once the ramp passes the beam's threshold, and a little later
  than the crossing, because nucleation is random.
- The water in the beam is at pH 4.7, with more H₂O₂ than H₂.

**Design notes:**
- The delay depends on the cell's liquid volume (chip area × spacer) and the illuminated area (beam radius 1 µm).
  Both are geometry parameters labelled *trend*: measure your cell's.
- On a real instrument, start at low dose rate and record the time of the first bubble; repeat each variant 3 times.

## E2 Gold growth against dose rate

**Question:** how does the growth rate of gold particles in a precursor solution depend on the dose rate?

- **Setup:** as E1 (static cell, 1 bar), with 1 mM gold ions in the liquid (**Gold precursor** on), 0.5 bar across
  the windows.
- **Timeline:** 0.5 e⁻/Å²/s for 30 s, stepped to 2 e⁻/Å²/s at 30 s, held to 60 s.
- **Measure:** particle radius against time in each half; bubbles; H₂ in the cell.

**Expected:**

| | 0.5 e⁻/Å²/s | 2 e⁻/Å²/s |
| --- | --- | --- |
| Growth rate | 0.044 Å/s | 0.117 Å/s |

- Four times the dose rate gives 2.7 times the growth. The gold ions capture most, but not all, of the hydrated
  electrons, so growth rises less than in proportion to the dose rate, though faster than its square root.
- The radius goes from 21 to 25.8 Å in 60 s, with no bubbles.
- The absolute rate rests on the deposition share η (*trend*, a placeholder). The ratio between dose rates does not.

**Design notes:**
- Keep below bubble formation (E1): bubbles push particles and change the liquid's thickness.
- For the resolution side, compare *the particle sits on the entrance window* with *on the exit window*. STEM
  resolves the first better, TEM (energy-filtered) the second (`tools/liquid-check.mjs`).

## E3 Sintering of gold nanoparticles: oxygen versus nitrogen

**Question:** does an oxidising atmosphere speed up sintering, and at what temperature does it start?

- **Setup:** gold nanoparticles; heating holder; windowed gas cell (SiNₓ, 50 × 200 µm windows, 30 nm), 5 µm gap,
  1 bar. TEM at 40 nm.
- **Variants:** O₂ and N₂ (sessions `E3-O2`, `E3-N2`).
- **Timeline:** setpoint 293 K for 10 s, ramped to 800 K over 10–60 s (10 K/s), held to 180 s.
- **Measure:** the particle radius against time and temperature, and the onset (the first 0.05 Å of growth).

**Expected:**

| | Onset | Radius at 180 s | Contrast kept through the gas (800 K) |
| --- | --- | --- | --- |
| O₂ | 724 K (52 s) | 21 → 29 Å | 95.7 % |
| N₂ | 755 K (55 s) | 21 → 25 Å | 96.0 % |

- Oxygen doubles the sintering rate, and the onset comes about 30 K earlier.
- The ramp adds about 25 Å of thermal drift (31 Å in total over the movie). Drift-correct before measuring sizes
  (SOP HPC-09, or the insitu engine on a cluster).

**Design notes:**
- 800 K keeps the growth well below saturation within 3 minutes. At 900 K both atmospheres reach the same final
  size, and the difference is lost.
- Check the windows' margin in the gas note before recording: these windows hold 8.9 bar.

## E4 How much gas can the image take?

**Question:** in an open differentially pumped column, at what pressure does the image lose half its contrast?

- **Setup:** gold nanoparticles; open column (no windows), N₂, 5 mm gas path through the pole-piece gap; TEM at
  20 nm.
- **Timeline:** 0.1 mbar for 5 s, ramped to 20 mbar over 5–65 s, held to 70 s.
- **Measure:** image contrast (standard deviation / mean) of each frame, normalised to the first. Plot it against
  pressure and compare with exp(−nσL).

**Expected:**
- At 20 mbar the image keeps 37 % of its contrast; it is down to half at 14 mbar.
- Every frame follows exp(−nσL) to within 0.6 %.
- For a reaction that needs more gas, shorten the path or use a windowed cell (about 1 bar over a few µm).

**Design notes:** this calibrates the trade-off before a reaction experiment. Repeat with H₂, which scatters about
2.5× less per molecule than N₂, so the same contrast allows about 2.5× the pressure. Ar scatters about as much as
N₂ per molecule (its one heavy atom against N₂'s two light ones).

## E5 Redox cycling of SrTiO₃

**Question:** how fast is SrTiO₃ reduced in hydrogen and re-oxidised in oxygen at 800 K?

- **Setup:** SrTiO₃; heating holder; windowed gas cell at 1 bar, starting in H₂.
- **Timeline:** setpoint 293 → 800 K over 5–25 s; at 120 s, switch the gas from H₂ to O₂ (a step in the timeline);
  hold to 240 s.
- **Technique:** a TEM movie for drift and morphology. At 120 s and at the end, take an EDS or EELS spectrum for the
  oxygen content: the O K edge falls with reduction, and so does the O/Ti ratio in EDS.
- **Measure:** temperature, and the degree of reduction ξ.

**Expected:**

| | End of stage | Time to 90 % |
| --- | --- | --- |
| In H₂ | ξ = 1.00 | 41 s from the start, including the ramp |
| After the switch to O₂ | ξ = 0.00 | 17 s |

At 1000 K the same cycle completes within a second, too fast for a 1 fps movie, which is why this design runs at
800 K. The kinetics are labelled *trend*.

**Design notes:** a real gas system needs seconds to minutes to purge. Record the switch time, and the time the
new gas actually reaches the cell.

## E6 Helium bubbles in silicon on annealing

**Question:** in what order, and at what temperatures, do implanted helium bubbles coarsen, lose their helium and
become voids?

- **Setup:** helium-implanted silicon (as implanted), 40 nm thick; heating holder in vacuum; TEM at 48 nm.
- **Timeline:** 293 K for 20 s, ramped to 1100 K over 20–220 s (4 K/s), held to 600 s.
- **Measure:** the number and mean diameter of the cavities, and the helium density. The specimen note gives all
  three, and the He 1s→2p peak near 22 eV in low-loss EELS tracks the density.

**Expected:**

| Stage | Begins at |
| --- | --- |
| As implanted | 260 cavities, 1.7 nm mean diameter |
| Coarsening (migration and coalescence) | 750 K (132 s) |
| Helium escaping | 1007 K (195 s) |
| Empty faceted voids | 1110 K (222 s) |
| End (600 s) | 10 voids, 5.9 nm mean diameter, no helium |

- Annealing the voids out needs longer at 1100 K, or a higher temperature.
- The ramp drifts the specimen 58 Å.

**Design notes:**
- At 600 frames this is the largest design (18.8 GB at full scale). The browser keeps every 3rd frame.
- Take a low-loss EELS spectrum at each stage to follow the helium.

## E7 The field across a biased gap, then breakdown

**Question:** does the holographic phase measure the voltage on the specimen, and where does the gap break down?

- **Part A:**
  - Setup: SrTiO₃ film, 100 nm, across a 2 µm gap between parallel electrodes; insulator; contact and series
    resistance 0; stray field off (the film's own phase).
  - Technique: off-axis holography at 5 nm field of view.
  - Timeline: 0 V for 2 s, ramped to 20 V over 2–22 s, held to 25 s.
  - Measure: the phase gradient across the field in each frame, against the specimen voltage.
- **Part B:**
  - Setup: switch to a tip facing a plane, 5 µm gap, breakdown field 10 MV/m, compliance 10 µA.
  - Ramp the voltage, or sweep for an I–V trace.
  - Watch for the breakdown event.

**Expected:**
- **A:** the phase gradient is linear in the voltage. Its slope, −3.55·10⁻⁵ rad/Å per volt, is within 3 % of
  C_E·t/g = −3.64·10⁻⁵. Integrated across the gap, the gradient returns the voltage on the specimen to 0.4 %
  (`tools/bias-check.mjs`).
- **B:** breakdown at 17.9 V, where the field at the tip reaches 10 MV/m. Past breakdown, a conducting filament
  draws the compliance current.

**Design notes:**
- With the stray field on, the vacuum above and below the chip dominates the phase, about 30× the film's own here.
  A real experiment measures both: subtract an unbiased hologram, and compare against a field model.
- Add contact resistance to see the two-terminal readback overstate the voltage that reaches the specimen.

## E8 Electrochemistry: deposit gold, then strip it

**Question:** can the electrode potential switch a gold particle between growth and dissolution?

- **Setup:** gold nanoparticles on the working electrode; liquid cell (300 nm spacer) with gold ions in the liquid,
  at a low imaging dose rate (0.05 e⁻/Å²/s, so radiolytic growth is negligible); biasing chip, semiconductor
  specimen path.
- **Timeline:** 0 V for 5 s, ramped to −0.3 V over 5–10 s and held, then ramped to +0.7 V over 30–35 s and held to
  60 s. The working electrode sits at half the cell voltage.
- **Measure:** the particle radius against time and potential, and the deposition and stripping rates.

**Expected:**
- Deposition at 0.42 Å/s takes the radius from 21 to 30.5 Å by 30 s.
- Stripping at 0.42 Å/s takes it back to 20.5 Å by 60 s.
- The rates follow Butler–Volmer kinetics: they rise exponentially with the overpotential. The exchange rate is
  a placeholder (*trend*).

**Design notes:**
- Keep the imaging dose rate low, or radiolysis grows gold too (E2) and confounds the electrochemistry.
- Without gold ions, the negative step deposits nothing, while stripping still works.

---

## Using the designs

1. Load a session, check the notes (window margin, radiolysis, compliance), and record.
2. Export the data, or the HPC bundle for full-scale processing (SOP HPC-09).
3. To change a design, edit it in [`experiments.mjs`](experiments.mjs) (setup, timeline, movie, what to measure),
   rerun it, and the session and expected results update together.
4. On a real instrument, keep the same plan (length, frame rate, detector, dose rate) and timeline, and check the
   estimator's data volume and dose before booking time. The simulator's kinetics (sintering, reduction, growth,
   bubble nucleation) are simple rate laws chosen to behave like the published trends, not fits to a particular
   material: use them to plan, not to predict values.
