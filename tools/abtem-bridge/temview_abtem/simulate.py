"""Run a TEM-view request with abTEM and return arrays in TEM-view's data format.

    from temview_abtem import simulate
    out = simulate(request)                 # {"arrays": {name: ndarray}, "meta": {...}}
    write_npz(out, "result.npz")            # the same .npz layout as TEM-view's Export button

Modes: tem (plane wave + CTF), stem (annular detector), 4d (pixelated detector), diff (selected-area
diffraction of the exit wave), cbed (one probe position). Frozen phonons follow the specimen temperature.
"""
from __future__ import annotations

import datetime as _dt
import time

import numpy as np

from .request import sampling_for, validate, wavelength_A
from .structures import build

CITATION = ("J. Madsen and T. Susi, 'The abTEM code: transmission electron microscopy from first principles', "
            "Open Research Europe 1, 24 (2021), doi:10.12688/openreseurope.13015.2")
# room-temperature rms displacement per axis (Å), scaled by √(u²(T)/u²(293 K)) from the request
U_RMS_293 = {"Au": 0.087, "Si": 0.076, "Sr": 0.088, "Ti": 0.072, "O": 0.090, "C": 0.085}


def _aberrations(o: dict) -> dict:
    keys = ("C10", "C12", "phi12", "C21", "phi21", "C23", "phi23", "C30", "C34", "phi34")
    return {k: float(o[k]) for k in keys if k in o}


def simulate(request: dict, progress=None) -> dict:
    import abtem

    t0 = time.time()
    req = validate(request)
    say = progress or (lambda msg: None)
    sp, run, o, mode = req["specimen"], req["run"], req["optics"], req["mode"]
    E = float(req["beam"]["energy_eV"])
    lam = wavelength_A(E)
    margin = 8.0 if mode in ("stem", "4d", "cbed") else 4.0  # room for probe tails / CTF wrap-around
    sp["margin_A"] = margin
    dx = sampling_for(req)
    box = sp["fov_A"] + 2 * margin
    rng = np.random.default_rng(int(run.get("seed", 0)))
    say("building the specimen")
    atoms, sinfo = build(sp, box, rng)
    u2r = float(sp.get("u2_ratio", 1.0))
    sig = {el: U_RMS_293.get(el, 0.08) * np.sqrt(u2r) for el in set(atoms.get_chemical_symbols())}
    fp = abtem.FrozenPhonons(atoms, num_configs=run["frozen_phonons"], sigmas=sig, seed=int(run.get("seed", 0)))
    # PRISM interpolates the S-matrix: the grid must be a multiple of 2 × the interpolation factor
    step = 2 * int(run.get("interpolation", 2)) if run["algorithm"] == "prism" else 2
    gpts = int(np.ceil(box / dx / step) * step)
    dx = box / gpts
    pot = abtem.Potential(fp, gpts=gpts, slice_thickness=float(run.get("slice_thickness_A", 2.0)),
                          projection="infinite", parametrization="lobato")
    ab = _aberrations(o)
    tilt = tuple(float(v) for v in (sp.get("tilt_mrad") or (0.0, 0.0)))
    arrays, cal = {}, {"abtem_sampling_A": dx, "box_A": box, "margin_A": margin}
    crop = lambda a, px: a[int(round(margin / px)):int(round((margin + sp["fov_A"]) / px)), int(round(margin / px)):int(round((margin + sp["fov_A"]) / px))]

    if mode in ("tem", "diff"):
        say("multislice (plane wave)")
        exit_waves = abtem.PlaneWave(energy=E, tilt=tilt).multislice(pot)
        if mode == "tem":
            ctf = abtem.CTF(semiangle_cutoff=o.get("objective_aperture_mrad", np.inf), energy=E,
                            focal_spread=o.get("focal_spread_A", 0.0), angular_spread=o.get("angular_spread_mrad", 0.0),
                            aberration_coefficients=ab)
            img = exit_waves.apply_ctf(ctf).intensity()
            img = (img.mean(0) if len(img.shape) > 2 else img).compute(progress_bar=False)
            a = np.asarray(img.array).T  # abTEM arrays are (x, y); TEM-view images are (row = y, column = x)
            a = crop(a, dx)
            arrays["image"] = a.astype(np.float32)
            cal["pixel_A"] = dx
            f = np.fft.fftshift(np.abs(np.fft.fft2((a - a.mean()) * np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1])))))
            arrays["diffractogram"] = np.log1p(f).astype(np.float32)
        else:
            d = req.get("detector") or {}
            dp = exit_waves.diffraction_patterns(max_angle=d.get("max_angle_mrad", 60))
            dp = (dp.mean(0) if len(dp.shape) > 2 else dp).compute(progress_bar=False)
            arrays["pattern"] = np.asarray(dp.array).T.astype(np.float32)
            cal["k_per_px_invA"] = float(dp.sampling[0])
            cal["mrad_per_px"] = float(dp.angular_sampling[0])
    else:
        probe = abtem.Probe(energy=E, semiangle_cutoff=o.get("semiangle_mrad", 20.0), aberrations=ab,
                            tilt=tilt)
        d = req.get("detector") or {}
        if mode == "cbed":
            say("multislice (one probe position)")
            pos = d.get("position_A") or [0.0, 0.0]
            p = (pos[0] - sp["center_A"][0] + box / 2, pos[1] - sp["center_A"][1] + box / 2)
            w = probe.multislice(pot, scan=abtem.CustomScan([p]))
            dp = w.diffraction_patterns(max_angle=d.get("max_angle_mrad", 60))
            while len(dp.shape) > 2:
                dp = dp.mean(0)
            dp = dp.compute(progress_bar=False)
            arrays["pattern"] = np.asarray(dp.array).T.astype(np.float32)
            cal["mrad_per_px"] = float(dp.angular_sampling[0])
        else:
            n = run.get("scan_gpts")
            scan_kw = {"gpts": n} if n else {"sampling": probe.aperture.nyquist_sampling if hasattr(probe, "aperture") else 0.5}
            scan = abtem.GridScan(start=(margin, margin), end=(margin + sp["fov_A"], margin + sp["fov_A"]), **scan_kw)
            dets = [abtem.AnnularDetector(inner=d.get("inner_mrad", 70), outer=d.get("outer_mrad", 200))] if mode == "stem" \
                else [abtem.PixelatedDetector(max_angle=d.get("max_angle_mrad", 60))]
            say(f"scanning {scan.gpts[0]}×{scan.gpts[1]} probe positions ({run['algorithm']})")
            if run["algorithm"] == "prism":
                alpha = o.get("semiangle_mrad", 20.0)
                smat = abtem.SMatrix(semiangle_cutoff=alpha, energy=E, potential=pot,
                                     interpolation=int(run.get("interpolation", 2)))
                m = smat.scan(scan=scan, detectors=dets,
                              ctf=abtem.CTF(semiangle_cutoff=alpha, aberration_coefficients=ab, energy=E))
            else:
                m = probe.scan(pot, scan=scan, detectors=dets)
            m = m[0] if isinstance(m, (list, tuple)) else m
            m = m.compute(progress_bar=False)
            a = np.asarray(m.array)
            if mode == "stem":
                arrays["image"] = a.T.astype(np.float32)
                cal["pixel_A"] = float(m.sampling[0])
            else:
                arrays["datacube"] = np.transpose(a, (1, 0, 3, 2)).astype(np.float32)  # (scan y, scan x, ky, kx)
                arrays["virtual_image"] = arrays["datacube"].sum(axis=(2, 3))
                cal["scan_step_A"] = float(scan.sampling[0])
                cal["detector_mrad_per_px"] = float(m.angular_sampling[-1]) if hasattr(m, "angular_sampling") else None

    meta = {
        "format": "tem-view-data/1",
        "generator": f"abTEM {abtem.__version__} via the TEM-view bridge (temview-abtem)",
        "created": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "simulated": True,
        "mode": mode,
        "specimen": sp.get("name", sp["id"]),
        "calibration": cal,
        "specimen_temperature_K": sp.get("temperature_K"),
        "optics": {"wavelength_A": lam, **ab, "focal_spread_A": o.get("focal_spread_A"), "energy_eV": E},
        "arrays": {k: {"shape": list(v.shape)} for k, v in arrays.items()},
        "abtem": {"version": abtem.__version__, "citation": CITATION, "frozen_phonons": run["frozen_phonons"],
                  "algorithm": run["algorithm"], "sampling_A": dx, "slice_thickness_A": float(run.get("slice_thickness_A", 2.0)),
                  "parametrization": "lobato", "atoms": sinfo["n_atoms"], "specimen_height_A": sinfo["height_A"],
                  "seconds": round(time.time() - t0, 2)},
        "request": request,
    }
    return {"arrays": arrays, "meta": meta}


def write_npz(result: dict, path) -> str:
    """The same layout as TEM-view's export: one .npy per array plus metadata.json."""
    import io
    import json
    import zipfile

    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for k, v in result["arrays"].items():
            b = io.BytesIO()
            np.save(b, np.ascontiguousarray(v))
            z.writestr(f"{k}.npy", b.getvalue())
        z.writestr("metadata.json", json.dumps(result["meta"], indent=1, default=float))
    return str(path)


def to_npz_bytes(result: dict) -> bytes:
    import io

    b = io.BytesIO()
    write_npz(result, b)
    return b.getvalue()
