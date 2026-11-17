# temview-connect: connect simulators and instruments to TEM-view

Copyright © 2026 by Northwestern University. All Rights Reserved. Confidential: patent pending material,
local only.

One protocol, **temview-connect/1**, lets other programs and real instruments join the microscope.

- A **simulator** (abTEM, another multislice code) runs the current acquisition and returns data.
- An **instrument** (a microscope through its vendor's API, a camera, a holder) is **driven**:
  - it receives settings and reports its actual state;
  - it acquires;
  - it stops when asked.

```
TEM-view (browser: Controls → Connections…, or Python: temview_connect.Client)
        │  HTTP + JSON on 127.0.0.1, results as TEM-view .npz
        ▼
temview-connect serve --adapter …   ──▶   adapter   ──▶   abTEM / vendor API / camera SDK
```

## Run

```bash
pip install -e tools/connect            # add [abtem] for the abTEM simulator
temview-connect serve --adapter mock    # a test instrument, no hardware (port 8799)
temview-connect serve --adapter abtem --port 8800
temview-connect serve --adapter mypkg.scope:MyAdapter   # your own adapter
```

The exhibit looks on ports 8799–8801 when **Connections…** opens, and more addresses can be added there.

## Protocol

| Request | Does |
| --- | --- |
| `GET /describe` | Name, kind (`simulator` or `instrument`), modes, the controls with units and limits, and whether driving needs a token |
| `GET /state` | The device's actual state, in protocol units |
| `POST /state` `{"token", "set": {…}}` | Drives the device and returns the state reached |
| `POST /stop` | Blanks the beam and aborts jobs. Always allowed, no token |
| `POST /jobs` `{"format": "temview-connect/1", "kind": "simulate"\|"acquire", "mode", …}` | Starts a job. An acquire needs the token |
| `GET /jobs/<id>`, `GET /jobs/<id>/result` | Job status, and the result as `.npz` (one `.npy` per array plus `metadata.json`) |

**Controls** use one instrument-neutral vocabulary in explicit units (`protocol.CONTROLS`):
- `mode`, `ht_kV`, `beam_blanked`, `defocus_nm`, `fov_nm`;
- `stage_x_nm`, `stage_y_nm`, `tilt_alpha_deg`, `tilt_beta_deg`;
- `convergence_mrad`, `camera_length_mm`, `objective_aperture`;
- `holder_temperature_K`, `detector_inner_mrad`, `detector_outer_mrad`.

A connector exposes the subset it supports. For each control it declares whether it is writable, its min and max (or its choices), and the largest single step allowed for stage moves and tilts.

**abTEM** offers the modes a multislice code can do: TEM, STEM, 4D-STEM, SAED and CBED. It has no Lorentz optics, spectrometer or X-ray detector. Its jobs carry the `temview-abtem/1` request (`tools/abtem-bridge`).

## Safety when an instrument is driven

- **Local only.** The service listens on 127.0.0.1 and answers browsers only from the exhibit's site and localhost.
- **Pairing token.** Everything that changes the device needs the token printed in the connector's terminal. Whoever starts the service at the instrument decides who drives it.
- **Limits.** Values outside the declared limits, or a step larger than allowed, are **refused, never clamped**. Read-only controls (by default the high tension) cannot be written.
- **Safe order.** The adapter applies changes in a safe order: blank first, move the stage before tilting, unblank last.
- **Rate limit.** Writes are rate-limited.
- **Audit log.** Every write, refusal and stop goes to a JSON-lines audit log.
- **Live following.** In the exhibit, *Follow the exhibit* sends changes as you make them. It stops by itself at the first value the instrument would refuse, and **Stop** always ends it.

## Writing an adapter

Subclass `temview_connect.Adapter`:
- set `description` (name, kind, modes, controls);
- implement `read_state()`, `apply(changes)`, `run(job, progress)` and `stop()`.

`adapters/mock.py` is the template.

## Tests

```bash
pytest tools/connect/tests     # the abTEM test is skipped without abTEM
```
