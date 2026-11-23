# TEM-view job bundles (temview-job/1): Tier 3

Copyright © 2026 by Northwestern University. All Rights Reserved.

In the exhibit, **Data, dose and compute → Export HPC bundle** writes a zip for a cluster:

| File | What it is |
| --- | --- |
| `session.json` | the exhibit's session (`tem-view-session/2`); its SHA-256 is in `job.json` |
| `specimen.xyz` | the specimen's 3D model (atoms, Å) |
| `job.json` | technique, engine, full-resolution parameters (from the footprint estimate), resources, provenance |
| `data.npz` | tomography: the recorded tilt series and its angles; an in situ movie: its frames, times, true drift and per-frame environment |
| `run.slurm` | a Slurm script: time, memory and GPU from the estimate (edit the partition and account) |
| `temview-hpc.def` | an Apptainer recipe (NumPy, h5py, ASTRA, abTEM and the temview-abtem bridge) |
| `run_job.py` | this directory's runner: NumPy only; ASTRA, abTEM, h5py when installed |

```bash
apptainer build temview-hpc.sif temview-hpc.def   # once
sbatch run.slurm                                   # or, on a workstation: python3 run_job.py job.json --out results
```

Results land in `results/`: `result.npz` (TEM-view's format), `result.zarr` (OME-Zarr v0.4, uncompressed chunks)
and `result.zarr.zip`, and `result.h5` when h5py is installed, each with a provenance block (engine and versions,
parameters, the session's SHA-256, host, time). Drop `result.npz` or `result.zarr.zip` on the exhibit (or **Load
results…**): volumes open in the tomography viewer, and the exhibit says whether they came from the current session.

Engines: an in situ movie (recorded in the exhibit, then exported) is drift-corrected by phase correlation against the
first frame and aligned (Fourier shift); the result holds the aligned frames, their sum, the measured and true drift and
each frame's environment. Tomography runs WBP and SIRT in NumPy with the browser's discretisation (results match to ~10⁻⁷), or SIRT in
ASTRA once its angle convention has been checked against the NumPy projector. TEM, STEM, 4D-STEM, SAED and CBED jobs
carry a `temview-abtem/1` request (the `full` preset) for abTEM. Cryo-EM SPA and 3D ED jobs
record their parameters for RELION/cryoSPARC and DIALS/XDS. Exit codes: 0 done, 2 a bad bundle,
3 the engine is not installed (`result-error.json` names it).

Step-by-step procedures, including an in situ campaign: [SOP.md](SOP.md).

`node tools/bundle-check.mjs` builds a bundle, runs it with this runner and reads the results back.
