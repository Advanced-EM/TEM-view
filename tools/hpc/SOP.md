# Standard operating procedures: sending TEM-view jobs to an HPC cluster (Tier 3)

Copyright © 2026 by Northwestern University. All Rights Reserved.

These procedures take a simulation or reconstruction from the exhibit to a cluster and bring the result back. The
browser never holds cluster credentials: you download a job bundle (`temview-job/1`), copy it to the cluster
yourself, submit it with Slurm, and load the result back into the exhibit. [README.md](README.md) lists what a
bundle contains.

| SOP | Procedure | When |
| --- | --- | --- |
| [HPC-01](#hpc-01-decide-where-the-job-runs) | Decide where the job runs | before every job |
| [HPC-02](#hpc-02-set-up-a-cluster-once) | Set up a cluster | once per cluster, and when the image changes |
| [HPC-03](#hpc-03-prepare-and-export-a-bundle) | Prepare and export a bundle | every job |
| [HPC-04](#hpc-04-transfer-and-submit) | Transfer and submit | every job |
| [HPC-05](#hpc-05-monitor-and-troubleshoot) | Monitor and troubleshoot | while the job runs |
| [HPC-06](#hpc-06-retrieve-verify-and-load-the-results) | Retrieve, verify and load the results | when the job ends |
| [HPC-07](#hpc-07-techniques-that-run-in-external-packages) | Techniques that run in external packages | SPA, ptycho-tomography, 3D ED |
| [HPC-08](#hpc-08-records-and-data-handling) | Records and data handling | every job |
| [HPC-09](#hpc-09-acquire-an-in-situ-campaign) | Acquire an in situ campaign | heating, gas, liquid or biasing series |

What runs where:

| Technique | Engine in the bundle | What `run_job.py` does |
| --- | --- | --- |
| In situ movie (TEM, STEM, holography, Lorentz) | NumPy | drift correction by phase correlation; aligned frames, their sum, measured and true drift, each frame's environment |
| In situ series of patterns (SAED, CBED, Ronchigram) | NumPy | packages the frames with their environment (drift does not move a pattern) |
| Tomography | NumPy (WBP or SIRT); ASTRA for SIRT when installed | reconstructs the recorded tilt series; matches the browser to ~10⁻⁷ with NumPy |
| TEM, STEM, 4D-STEM, SAED, CBED | abTEM through the `temview-abtem/1` request (`full` preset) | runs the full multislice simulation |
| Cryo-EM SPA, ptychographic tomography, 3D ED | RELION/cryoSPARC, py4DSTEM/PtyRAD, DIALS/XDS | records the parameters only (exit code 3, [HPC-07](#hpc-07-techniques-that-run-in-external-packages)) |

---

## HPC-01 Decide where the job runs

**Purpose:** send a job to the cluster only when it needs one.

1. In the exhibit, open the technique and set it up as you would for the real experiment.
2. In **Data, dose and compute**, set the acquisition plan (scan size, detector, bit depth, dwell or exposure,
   frames; for tomography the tilts and the reconstruction; for an in situ movie its length and frame rate).
3. Read the badge:
   - **In browser**: run it in the exhibit. No bundle is needed.
   - **Local GPU**: use a lab computer running [`temview-connect`](../connect/) (Tier 2, connected from the
     **Status** section) if one is available. Otherwise continue with HPC-03.
   - **HPC batch**: continue with HPC-03.
4. Note the estimate (raw data, working set, GPU time). The bundle's Slurm request is derived from it, and you
   will compare the actual run against it in HPC-06.

## HPC-02 Set up a cluster (once)

**Purpose:** a container image with the engines, built and checked once per cluster.

**Needs:** an allocation (account and GPU partition), Apptainer on the cluster, and permission to build images
(`--fakeroot`, a build node, or a remote builder; ask your research computing group which one applies).

1. Export any bundle (HPC-03) and copy `temview-hpc.def` and `run_job.py` to a project directory, for example
   `$PROJECT/temview/`.
2. Build the image:
   ```bash
   cd $PROJECT/temview
   apptainer build temview-hpc.sif temview-hpc.def            # or: apptainer build --fakeroot …
   ```
   The recipe installs Python 3.11, NumPy, SciPy, h5py, the ASTRA toolbox, abTEM and the temview-abtem bridge from
   conda-forge and PyPI. It needs network access while it builds.
3. Pin the versions you have validated: edit the `mamba install` and `pip install` lines to exact versions, rebuild,
   and keep the `.def` with the image.
4. Record the image's checksum and versions:
   ```bash
   sha256sum temview-hpc.sif > temview-hpc.sif.sha256
   apptainer exec temview-hpc.sif python3 -c "import numpy, h5py, astra, abtem; print(numpy.__version__, h5py.__version__, astra.__version__, abtem.__version__)"
   ```
5. Check the image with a small tomography bundle (HPC-03 with a 64³ tilt series), run interactively on a GPU node:
   ```bash
   srun --partition=<gpu-partition> --account=<account> --gres=gpu:1 --time=00:15:00 --pty \
     apptainer exec --nv $PROJECT/temview/temview-hpc.sif python3 run_job.py job.json --out results
   ```
   Expect `done: result.npz, result.zarr(.zip), result.h5`. Load `results/result.npz` into the exhibit (HPC-06). The
   volume should match the exhibit's own reconstruction of the same series. Check the log too: if it says
   *ASTRA's geometry did not match the reference projector*, the runner falls back to NumPy, which is correct but slower.
   Report the mismatch.
6. Keep one image per validated version. Do not rebuild it for each job.

## HPC-03 Prepare and export a bundle

**Purpose:** a self-contained, reproducible job.

1. Set up the technique as in HPC-01, then:
   - **Tomography:** record the whole tilt series first. The bundle carries the recorded projections (`data.npz`),
     and a partial series is not runnable.
   - **abTEM techniques:** set the specimen, optics and detector as you want them simulated at full scale.
2. In **Data, dose and compute**, click **Export HPC bundle (Slurm, Apptainer)**. The browser downloads
   `tem-view-job-<technique>-<date-time>.zip`.
3. Check the bundle before sending it:
   ```bash
   unzip -l tem-view-job-*.zip       # session.json, specimen.xyz, job.json, run.slurm, temview-hpc.def, run_job.py, README.txt (+ data.npz for tomography)
   unzip -p tem-view-job-*.zip job.json | python3 -m json.tool | less
   ```
   In `job.json`, confirm:
   - `technique` and `engine.name` are what you expect;
   - `resources` (tier, memory_gb, wall_seconds, gpu_seconds_estimate) are reasonable;
   - `provenance.session_sha256` is present.
4. Optional, for a small job: run it on a workstation first to catch problems before queueing:
   ```bash
   mkdir job && cd job && unzip ../tem-view-job-*.zip
   python3 run_job.py job.json --out results       # NumPy only; ASTRA, abTEM and h5py when installed
   ```

## HPC-04 Transfer and submit

**Purpose:** each job runs in its own directory with the validated image.

1. Copy the bundle to the cluster's scratch or project space:
   ```bash
   rsync -av tem-view-job-tomo-20261122-1530.zip <user>@<cluster>:$SCRATCH/temview/
   ```
2. Unpack it into its own directory, one directory per job:
   ```bash
   cd $SCRATCH/temview && mkdir tomo-20261122-1530 && cd tomo-20261122-1530
   unzip ../tem-view-job-tomo-20261122-1530.zip
   ln -s $PROJECT/temview/temview-hpc.sif .          # run.slurm expects temview-hpc.sif in the job directory
   ```
3. Edit `run.slurm`:
   - uncomment and set `#SBATCH --partition=` and `#SBATCH --account=` (they ship commented out as `##SBATCH`);
   - change `--gres=gpu:1` to your cluster's syntax if it differs (for example `--gpus=1` or a GPU type);
   - leave `--time` and `--mem` as estimated unless HPC-05 told you otherwise (time is at least 15 min, at most
     48 h; memory is 1.5 × the estimated working set + 2 GB, at least 4 GB).
4. Submit and record the job ID:
   ```bash
   sbatch run.slurm                                    # → Submitted batch job 123456
   ```
5. Write the job ID, bundle name, image checksum and date in your log (HPC-08).

## HPC-05 Monitor and troubleshoot

**Purpose:** know when the job finished, and why if it failed.

1. Watch the queue and the log:
   ```bash
   squeue -u $USER
   tail -f temview-123456.log                          # timestamped lines: [   12.3 s] …
   sacct -j 123456 --format=JobID,State,Elapsed,MaxRSS,ExitCode
   ```
2. Read the exit code:

   | Exit | Meaning | Action |
   | --- | --- | --- |
   | 0 | done: `results/result.npz`, `result.zarr`, `result.zarr.zip` (and `result.h5` with h5py) | HPC-06 |
   | 2 | bad bundle (`job.json` is not `temview-job/1`, or a file is missing) | export the bundle again (HPC-03); do not edit `job.json` by hand |
   | 3 | the engine is not installed; `results/result-error.json` names it | rebuild or fix the image (HPC-02), or use the external package (HPC-07) |

3. Common problems:

   | Symptom | Cause | Fix |
   | --- | --- | --- |
   | `OUT_OF_MEMORY` in `sacct` | working set above the estimate | raise `--mem` by 50 % and resubmit; note it for HPC-08 |
   | `TIMEOUT` | slower GPU or more iterations than estimated | raise `--time`; compare against `gpu_seconds_estimate` |
   | `the engine abtem is not installed here` | image built without the bridge | HPC-02 step 2, then check `import temview_abtem` |
   | *ASTRA's geometry did not match the reference projector* | ASTRA's angle convention differs | the runner already used NumPy; the result is valid |
   | *warning: session.json differs from the one this job was made from* | `session.json` was edited or replaced | export a fresh bundle; the result would not trace back to the session |
   | `apptainer: command not found` | module not loaded | add `module load apptainer` (or your site's name for it) to `run.slurm` |
   | no GPU in the container | `--nv` missing or no GPU allocated | keep `apptainer exec --nv` and the `--gres` line |

## HPC-06 Retrieve, verify and load the results

**Purpose:** bring the result back with proof of where it came from.

1. Copy the results home:
   ```bash
   rsync -av <user>@<cluster>:$SCRATCH/temview/tomo-20261122-1530/results ./tomo-20261122-1530/
   rsync -av <user>@<cluster>:$SCRATCH/temview/tomo-20261122-1530/temview-123456.log ./tomo-20261122-1530/
   ```
2. Check the provenance (the same block is in all three formats):
   ```bash
   python3 -c "import zipfile, json; print(json.dumps(json.loads(zipfile.ZipFile('results/result.npz').read('metadata.json'))['provenance'], indent=1))"
   ```
   Or simply load the result into the exhibit (step 3), which shows the same fields. Confirm:
   - `engine`, `host` and `versions` match the image you validated;
   - `seconds` is in line with the estimate;
   - `session_sha256` matches the bundle's `job.json`.
3. Load the result into the exhibit: **Data, dose and compute → Load results…**, or drag `result.npz` (or
   `result.zarr.zip`) onto the page.
   - Volumes open in the tomography viewer, resampled if needed.
   - The note says who made the result, where and when, and whether it came from the session now open in the
     exhibit.
   - 2D results (abTEM images and patterns, 4D data) and in situ movies do not open in the exhibit: load
     `result.npz` or `result.h5` in Python. For a movie the exhibit still shows the frame count and the drift
     correction's error.
4. Delete the job's directory from scratch once the results and the log are safely stored (HPC-08). Scratch is
   usually purged without notice.

## HPC-07 Techniques that run in external packages

Cryo-EM SPA, ptychographic tomography and 3D ED bundles carry the full-scale parameters in `job.json`
(`parameters.full_scale`) and the session, but `run_job.py` does not run them: it exits with code 3 and
`result-error.json` names the package.

1. Use the bundle as the job description for the package:

   | Technique | Package | What to take from `job.json` and `session.json` |
   | --- | --- | --- |
   | Cryo-EM SPA | RELION or cryoSPARC | pixel size, dose and frames per movie, defocus range, particle count, box size |
   | Ptychographic tomography | py4DSTEM or PtyRAD | tilts, scan, detector, probe semi-angle, slices, iterations |
   | 3D ED / MicroED | DIALS or XDS | rotation range and step, exposure per frame, dose per frame |

2. Run the package with your site's own procedure for it.
3. Keep the bundle with the package's outputs, so the run traces back to the exhibit session (HPC-08).

## HPC-08 Records and data handling

1. **Log every job** (a lab notebook or a shared sheet):
   - date and the bundle file name;
   - cluster, partition and job ID;
   - the image checksum (`temview-hpc.sif.sha256`);
   - the estimate (from `job.json` `resources`) next to the actual result (`seconds`, `MaxRSS` from `sacct`);
   - exit code, and where the results are stored.
2. **Keep together:** the bundle zip, `results/`, and the Slurm log. Together they reproduce the run: same session,
   same parameters, same image.
3. **Data policy:** a bundle contains the full exhibit session and the specimen model. Treat it like the data it
   describes:
   - Do not put unpublished, confidential or collaborator-restricted work on shared scratch, or on a cluster outside
     your institution's agreements, without the data owner's approval.
   - Never put credentials, tokens or keys in a bundle or a Slurm script.
4. **Feedback:** if a job needed more memory or time than estimated, note both numbers. The estimator's rates in
   [`js/footprint.js`](../../js/footprint.js) can be tuned against them.

## HPC-09 Acquire an in situ campaign

**Purpose:** a planned series under changing conditions (heating, gas, liquid, bias), recorded with its environment
and drift, sized before it starts, and processed on a cluster when it is too large for the browser.

**Before you start:** choose the specimen and the region. Cryo holders and liquid or gas cells exclude each other.
Heating combines with gas and with biasing. A liquid cell and biasing together give electrochemistry.

1. **Set up the environment** (controls, below the specimen):
   - **Specimen holder**: *Heating (MEMS)* for temperature ramps. A cryo holder ramps only within its own range,
     and the room-temperature holder not at all.
   - **Cell around the specimen**: *Liquid cell* (class, window size and thickness, spacer, pressure difference,
     flow, dose rate, where the particle sits) or *Gas cell / ETEM* (windowed or open column, gas, pressure, gap or
     path).
   - **Biasing chip**: electrode layout and gap, specimen material, source mode, compliance, contact and series
     resistance, leakage, breakdown field.
   - Read the notes under each section before you go on: the window burst margin, radiolysis (bubbles), the
     contrast the gas leaves, the operating point and where the source limits. Change any setting that is outside
     the margin you want.
   - The holder sets the tilt range (±20° in a cell, ±25° on a heating or biasing chip). Choose the zone axis or
     tilt now and keep it fixed while the movie records.
2. **Choose the technique** for the series: TEM, STEM, SAED, CBED, Ronchigram, off-axis holography, or Lorentz TEM or
   STEM. Holography or Lorentz shows fields under bias. SAED shows phase changes, and the diffuse background of gas
   or liquid.
3. **Plan the movie:** turn on **In situ movie**, then set its **length** and **frames per second**.
4. **Write the timeline:** add a ramp for each change.
   - Each ramp has a quantity (temperature setpoint in K, gas pressure in mbar, bias voltage in V, or the liquid
     cell's dose rate), a target value, and a start and end time in seconds from the movie's start.
   - A ramp starts from whatever value the quantity has then, either the current setting or the end of the
     previous ramp, and the value holds after the ramp ends.
   - Leave a few seconds at the start with no change, for the reference frames.
   - Example, gold sintering in oxygen: windowed gas cell, O₂ at 1 bar, heating holder; ramp the temperature setpoint
     from 293 to 900 K over 10–60 s; hold to 120 s.
5. **Size it before you record:** read **Data, dose and compute**. It covers the full campaign at real detector
   size, all frames:
   - data volume and acquisition time;
   - the total dose against the specimen's critical dose;
   - the analysis memory and where it can run.

   If a scanned frame is slower than 1/fps, the estimator says so and gives the rate you will actually get. If the
   dose exceeds the critical dose, lower the frame rate, the length or the dose.
6. **Record:** click **Record movie**.
   - Recording runs in simulated time, one frame interval per step. The timeline sets the environment at each
     frame, and the processes advance: sintering, reduction, bubbles, particle growth, Joule heating, breakdown.
   - The specimen drifts by the holder's drift, plus thermal drift while the temperature ramps.
   - The browser keeps up to 240 frames; for longer movies it keeps every k-th frame (the note says which). The
     estimate still covers all of them.
   - **Stop** ends early. **Discard movie** clears it and resets the drift.
7. **Check the run** in the notes:
   - frames recorded, the time reached, temperature, pressure or specimen voltage, and the drift;
   - events: a window burst (the beam is blanked), breakdown, contact burn-out or electromigration, each with the
     time it happened.

   If an event ended the experiment early, decide whether to keep the movie or change the plan and record it again.
8. **Save it** (both, when the movie is to be processed elsewhere):
   - **Export data** writes a `.npz` with the frames, their times, temperatures and true drift. The metadata holds
     the timeline and every frame's environment (setpoint, pressure, bias, dose rate, specimen voltage and current).
   - **Export HPC bundle** (after the recording has finished) writes a job bundle with the movie and the per-frame
     environment. Then follow HPC-04 to
     HPC-06.
9. **On the cluster:** the runner's `insitu` engine measures the drift by phase correlation against the first frame
   and aligns the frames. It writes:
   - `movie_aligned`, `aligned_sum` and `drift_measured_A`;
   - `drift_true_A`, with the RMS error of the correction in the provenance;
   - `time_s` and the per-frame environment (`T_K`, `tempSet`, `gcP`, `bsV`, `lcRate`).

   Series of diffraction patterns are packaged with their environment but not drift-corrected.
10. **Analyse and record:**
    - Load `result.npz` (or `result.h5`) in Python. Plot the measured quantity (particle size, the oxygen edge,
      the holographic phase) against `time_s` and the environment.
    - Log the campaign as in HPC-08, adding the timeline, any events with their times, and the drift-correction
      error.

What carries over to a real instrument: the same plan (length, frame rate, detector, dose rate), the same timeline,
and the estimator's data volume and dose. Check them before booking time on a microscope.

## References

- [README.md](README.md): the bundle's files and the runner.
- [`tools/bundle-check.mjs`](../bundle-check.mjs): builds a bundle, runs it with `run_job.py` and reads the result back.
- [`tools/connect/`](../connect/): Tier 2, jobs on a lab computer with live progress.
