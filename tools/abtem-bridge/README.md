# temview-abtem: TEM-view → abTEM bridge

Copyright © 2026 by Northwestern University. All Rights Reserved.

Run what the TEM-view microscope is showing as an **abTEM** simulation (Madsen & Susi,
[Open Research Europe 1, 24 (2021)](https://doi.org/10.12688/openreseurope.13015.2)). abTEM is a widely used,
peer-reviewed open-source multislice code. The bridge returns:
- the same acquisition, from a full dynamical 3D calculation with frozen phonons;
- in TEM-view's own `.npz` format;
- with abTEM's version, its settings and the citation in the metadata.

The microscope is the user interface, and abTEM is the reference simulation behind it.

```
TEM-view (browser, Python, MCP)  ──  temview-abtem/1 request (JSON)  ──▶  bridge  ──▶  abTEM (CPU or GPU)
                                ◀──  TEM-view .npz + metadata  ───────────────┘
```

## What it runs

| TEM-view mode | abTEM | Returns |
| --- | --- | --- |
| TEM | `PlaneWave` → multislice → `CTF` (aberrations, focal spread, angular spread, objective aperture) | `image`, `diffractogram` |
| STEM | `Probe` (or PRISM `SMatrix`) → `GridScan` → `AnnularDetector` (the exhibit's inner and outer angles) | `image` |
| 4D-STEM | `Probe` (or PRISM) → `GridScan` → `PixelatedDetector` | `datacube` (scan y, scan x, ky, kx), `virtual_image` |
| SAED | `PlaneWave` → multislice over the selected area → diffraction patterns | `pattern` |
| CBED | `Probe` at one position → multislice → diffraction pattern | `pattern` |

**Specimens** are rebuilt in 3D from the same recipe the exhibit uses (`temview_abtem/structures.py`):
- **Gold on carbon:** the same particles, positions, radii and in-plane rotations, viewed along [110], on an amorphous carbon film at 2.0 g/cm³.
- **Si/SiO₂:** Si along [110] up to the exhibit's interface line, then amorphous SiO₂ at 2.2 g/cm³.
- **SrTiO₃ Σ5:** two [001] grains at ±18.43°, with clashing atoms at the boundary removed.
- **Graphene:** the exhibit's own atom list, including the hole, the vacancies, the Si dopant and the twisted second layer.

The MOF and the proteins in ice need structure files (CIF, PDB) and are not supported yet.

**Frozen phonons** follow the specimen temperature. The exhibit sends the holder's u²(T)/u²(293 K), and the
room-temperature amplitudes are scaled by its square root.

## Conventions

TEM-view sends the request in abTEM's conventions (`js/abtem.js`, `abtemRequest`).

| TEM-view | abTEM |
| --- | --- |
| defocus `df` (nm, negative = underfocus) | `C10` = df·10 Å (abTEM's `defocus` = −C10) |
| Cs (mm uncorrected, µm corrected) | `C30` (Å) |
| A1, A1 angle (nm, °) | `C12`, `phi12` (Å, rad) |
| B2, B2 angle (Krivanek) | `C21` = 3·B2, `phi21` |
| A2, A3 | `C23`, `C34` and angles |
| focal spread Δ (standard deviation, from Cc, ΔE, HT and lens stability) | `focal_spread` = √2·Δ (1/e width, Kirkland convention) |
| TEM illumination semi-angle | `angular_spread` (mrad; approximate equivalence) |
| objective aperture (40, 20, 10 µm) | CTF `semiangle_cutoff` 12, 6, 3 mrad |
| specimen tilt (small) | beam tilt in mrad |

On a test case, abTEM and TEM-view agree:
- **Position:** graphene at 80 kV gives the same field of view, zero offset between the two images.
- **Contrast:** correlation 0.94 between the two images, which validates both the conventions and the specimen geometry.

Where they differ (thick crystals, channelling, inelastic background), abTEM is the reference.

## Use

**Install**, then start the service:

```bash
pip install -e tools/abtem-bridge
temview-abtem serve
```

- Python 3.11 or newer is required.
- Add `[gpu]` to the install for CUDA through CuPy.
- The service listens on 127.0.0.1:8797.

**From the exhibit:** Controls → *Simulate with abTEM…* → Run on this computer. The dialog shows TEM-view's data
and abTEM's result side by side, and offers the `.npz` for download.

The service only accepts requests from the exhibit's own site and from localhost. It never runs code from a
request, and it bounds the size of every job.

**Anywhere else** (a GPU workstation, a cluster): in the dialog, choose *Download request (.json)*, then:

```bash
temview-abtem run request.json --preset standard -o result.npz
```

**From a script:**

```python
import temview as tv                      # tools/temview-py
from temview_abtem import simulate, write_npz
tem = tv.connect("headless")
tem.set(mode="stem", specimen="sto", kV=200, detector="haadf", fov_nm=2)
write_npz(simulate(tem.abtem_request(preset="quick", algorithm="prism")), "sto-haadf.npz")
```

**Presets:**

| Preset | Frozen-phonon configurations | Probe positions | Largest potential grid |
| --- | --- | --- | --- |
| quick | 2 | 32 × 32 | 1536² |
| standard | 8 | 64 × 64 | 3072² |
| full | 16 | Nyquist | 6144² |

The potential sampling follows the largest angle needed. Because of abTEM's 2/3 antialiasing aperture,
θ_max = (2/3)·λ/(2·dx); HAADF out to 200 mrad at 200 kV therefore needs about 0.04 Å. A request that would
exceed the preset's grid is refused, with a message saying what to change.

**Typical CPU times** (Apple M2 Max, quick preset):

| Simulation | Time |
| --- | --- |
| TEM, 6 nm of graphene | about 1 s |
| TEM, 5 nm of SrTiO₃ | about 3 s |
| SAED, 10 nm area | about 12 s |
| CBED | about 4 s |
| 4D-STEM, 1.5 nm, 32², PRISM | about 16 s |
| HAADF-STEM, 2 nm, 32², PRISM | about 30 min (measured 32 min, abTEM 1.0.11) |

Use a GPU for the larger runs.

## Tests

```bash
pytest tools/abtem-bridge/tests
```

The tests check:
- the conventions;
- refusals;
- validation limits;
- specimen densities;
- a small TEM run with the `.npz` round trip;
- the local service, including its origin check.

The abTEM tests are skipped when abTEM is not installed.

## Licensing

abTEM is **GPL-3.0-or-later**. This bridge imports it, so distributing the bridge implies GPL-compatible terms
for the bridge itself. TEM-view does not import abTEM. It only exchanges JSON and `.npz` with the bridge, a
separate program, over HTTP or files.

The bridge's license is to be decided with the abTEM authors. Options:
- GPL-3.0 here;
- or hosting the bridge alongside abTEM.
