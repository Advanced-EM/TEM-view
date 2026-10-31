# temview: Python scripting for TEM-view

Script the TEM-view microscope simulator from Python:
- set the optics and the specimen
- record NumPy data with calibrations
- run analyses that report the simulator's true values
- test automation algorithms against a hidden misalignment

The same script runs in three places:

| Where | How | Needs |
| --- | --- | --- |
| In the exhibit | the **Python IDE**: the terminal button at the top of the controls, Controls → Python scripting, or <kbd>P</kbd> | a browser (Python runs in it, through Pyodide) |
| On a desktop, headless | `tv.connect()` or `tv.connect("headless")` | Python 3.9+, NumPy, Node.js 20+ |
| On a desktop, driving an open exhibit | `tv.connect("live")`, then **Connect agent** in the exhibit | the above plus `websockets` |

## Install (desktop)

```bash
git clone https://github.com/Advanced-EM/TEM-view
pip install -e "TEM-view/tools/temview-py[live,plot]"
```

The headless backend runs the simulator's own JavaScript in Node.js, so install from a clone of the repository.
`-e` keeps the package linked to it. To use a clone elsewhere, set `TEMVIEW_ROOT` to its folder.

## A first script

```python
import temview as tv

tem = tv.connect()                       # headless here; the exhibit itself inside its IDE
tem.set(mode="stem", specimen="sto", kV=300, detector="haadf")
img = tem.acquire()                      # Acquisition: NumPy arrays and metadata
print(img, img.calibration)              # pixel size and more, as recorded
tv.show(img, "HAADF, SrTiO3")            # matplotlib on a desktop, the output panel in the IDE
img.save("haadf.npz")                    # the same .npz the exhibit's Export button writes
```

## Calls

| Call | What it does |
| --- | --- |
| `tem.set(**settings)` | `mode`, `specimen`, `kV`, `defocus_nm`, `fov_nm`, `dose`, `thickness_nm`, `corrector`, `holder`, `temperature_K`, `realistic`, `detector`, `convergence_mrad`, `camera_length_mm`, `tilt_x_deg`, `tilt_y_deg`, `eels_range`, `beam` |
| `tem.state()` | the current settings and optics: Cs, aberrations, Scherzer defocus, temperature, … |
| `tem.command(text)` | a plain-language command with the exhibit's grammar: `"defocus minus 50"` |
| `tem.aberrations(A1=(nm, deg), …)` | residual aberrations: A1, B2, A2 in nm and A3 in µm as (magnitude, angle); `Cs_um` |
| `tem.acquire(steps=None)` | record the detectors; returns an `Acquisition` (`.image`, `["name"]`, `.arrays`, `.calibration`, `.meta`, `.save()`) |
| `tem.analyze(name)` | `fit_ctf`, `fit_lattice`, `identify_edges`, `fit_eds`, `fit_zlp`, `fit_hologram`; the result includes the true values |
| `tem.step(n)` | advance the simulation n frames of 50 ms (drift, dose, temperature) |
| `tem.challenge(id, seed)` | start a hidden misalignment: `tem-focus-stig` or `corrector-ronch` |
| `tem.score()` | the challenge score, computed from the true optics, as in the training tasks |
| `tem.reveal()` / `tem.end_challenge()` | the hidden values / restore the instrument as it was before the challenge |
| `tem.load_xyz(path_or_text, name=None)` | your own structure from an XYZ file (Å, any elements) as specimen `xyz`, on a thin carbon support; tilt (±30°) rotates it |
| `tem.move(dx_nm, dy_nm)` | move the stage, e.g. to centre a feature found in an image |
| `tem.library()` / `tem.goto(i, j)` | the nanoparticle megalibrary's layout / drive to its particle (i, j) (`specimen="lib"`) |
| `tem.particle(i, j)` | the true particle (i, j): composition, size, shape, phase, lattice, orientations; for scoring a screen |
| `tem.info()` | modes, specimens, settings, analyses and challenges this backend offers |

## Testing automation

A challenge hides a misalignment, as a training task does, so the knob readings no longer show the true optics.
Your algorithm sees only what a real microscope would: images, FFTs, fits. `score()` then grades the result
against the truth. A fixed `seed` repeats the same misalignment, so algorithms can be compared on the same
cases.

`examples/auto_focus_stig.py` is a complete automatic focus and stigmation routine. It works from Thon rings
alone, rejects untrustworthy fits, and resolves the over- and underfocus ambiguity with a known focus step.
On seeds 1 to 8 it scores 93 to 94/100: about 1 nm from Scherzer focus and under 0.4 nm of astigmatism.
Headless and in the exhibit's IDE, the same seeds give the same scores.

```bash
python examples/auto_focus_stig.py
```

### A high-throughput screen

The megalibrary specimen (`lib`) is a million alloy nanoparticles (Au, Ag, Cu, Co, Ni; 15–25 nm) on a 1 µm grid,
laid out as polymer pen lithography makes them: a 10 × 10 pen array, each pen writing a 100 × 100 block, with
the ink composition changing across the pens and the dot size along each block. Particles where the noble
metals meet Co–Ni segregate into two-crystal heterostructures; others are alloys, some twinned; every particle
has its own crystal orientation. The same library, particle for particle, is in SEM-view for TKD.

`examples/megalibrary_screen.py` drives the stage particle by particle, finds and re-centres each one in a
HAADF survey (in the realistic view the stage misses by ~25 nm), then measures size and shape (HAADF),
composition and segregation (EDS, multiple least squares over a Kramers continuum) and the lattice parameter
(diffraction, indexed with the composition), and scores everything against `particle(i, j)`. On a 4 × 4
sample: composition within 3.9 at.% per element, size within 0.4 nm, every heterostructure recognized,
lattice parameter within 0.03 Å; about 3 s per particle headless.

```bash
python examples/megalibrary_screen.py --n 10   # one particle per pen block
```

Other examples: `xyz_structure.py` (a structure of your own from an XYZ file, on and off a zone axis), `quickstart.py`, `through_focus.py`, `stem_detectors.py`. All of them are in the IDE's
Examples menu.

## Rules

- **Training tasks:** while a person is doing a training task in the exhibit, scripts cannot change it. The
  exhibit refuses, so recorded practice stays human.
- **Challenge runs:** these are never recorded or shared.
- **Port:** `connect("live")` listens on 127.0.0.1 only, on the port temview-mcp uses (8790). Run one or the
  other, or pick another port: `connect("live", port=8791)`.
- **IDE:** scripts run on the page's thread, so the exhibit pauses while a script runs and redraws when it
  ends. Keep long loops on a desktop.

## Speed and WebGPU

A typical acquisition takes 10–100 ms and a CTF fit about half a second. The simulator computes on the CPU in
JavaScript, both headless and in the browser. The calls above do not depend on how it computes. A future
WebGPU backend for the wave optics (the FFTs and multislice) could speed up the same scripts without changing
them. The IDE's status line shows whether the browser offers WebGPU.

## Test

```bash
pip install -e "tools/temview-py[test]"
pytest tools/temview-py/tests
```
