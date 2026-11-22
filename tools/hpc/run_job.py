#!/usr/bin/env python3
"""Run a TEM-view job bundle (temview-job/1) on a cluster or a workstation: Tier 3 of TEM-view's compute path.

Copyright © 2026 by Northwestern University. All Rights Reserved.

    python3 run_job.py job.json --out results          (inside the Apptainer image: see temview-hpc.def)

The bundle (exported from the exhibit: Data, dose and compute → Export HPC bundle) holds session.json, the
specimen as XYZ, job.json (technique, engine, full-resolution parameters, provenance) and, for tomography, the
recorded tilt series (data.npz). This runner needs only NumPy; it uses ASTRA, abTEM (through the temview-abtem
bridge), h5py when they are installed.

Results go to --out, each with a provenance block (engine and versions, parameters, the session's SHA-256, host,
time):
- result.npz          TEM-view's data format: drop it on the exhibit (Load results) to view it
- result.zarr/        OME-Zarr v0.4 (uncompressed chunks, so the exhibit can read it too: result.zarr.zip)
- result.h5           HDF5, when h5py is installed
Exit codes: 0 done; 2 a bad bundle; 3 the engine this job needs is not installed (result-error.json says which).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import socket
import sys
import time
import zipfile

import numpy as np

FORMAT = "temview-job/1"


# ---------------------------------------------------------------- tomography (the browser's discretisation, tomo.js)
def project(vol, th):
    N = vol.shape[0]
    c, cs, sn = N / 2 - 0.5, np.cos(np.radians(th)), np.sin(np.radians(th))
    z, y = np.meshgrid(np.arange(N), np.arange(N), indexing="ij")
    v = (y - c) * cs - (z - c) * sn + c
    v0 = np.floor(v).astype(int)
    f, v0 = (v - v0).ravel(), v0.ravel()
    rows, out, ok = vol.reshape(N * N, N), np.zeros((N + 2, N)), None
    ok = (v0 >= -1) & (v0 < N)
    np.add.at(out, v0[ok] + 1, (1 - f[ok])[:, None] * rows[ok])
    np.add.at(out, v0[ok] + 2, f[ok][:, None] * rows[ok])
    return out[1:N + 1]


def backproject(p, th, vol, w=1.0):
    N = vol.shape[0]
    c, cs, sn = N / 2 - 0.5, np.cos(np.radians(th)), np.sin(np.radians(th))
    z, y = np.meshgrid(np.arange(N), np.arange(N), indexing="ij")
    v = (y - c) * cs - (z - c) * sn + c
    v0 = np.floor(v).astype(int)
    f = v - v0
    pp = np.zeros((N + 2, N)); pp[1:N + 1] = p
    ok = ((v0 >= -1) & (v0 < N))[..., None]
    vol += w * np.where(ok, pp[np.clip(v0 + 1, 0, N + 1)] * (1 - f)[..., None] + pp[np.clip(v0 + 2, 0, N + 1)] * f[..., None], 0)
    return vol


def wbp(ser, ang, filt="ramp"):
    T, N, _ = ser.shape
    M = 1
    while M < 2 * N:
        M *= 2
    n = np.minimum(np.arange(M), M - np.arange(M))
    H = np.real(np.fft.fft(np.where(n == 0, 0.25, np.where(n % 2 == 1, -1 / (np.pi * np.maximum(n, 1)) ** 2, 0.0))))
    if filt == "hann":
        H *= 0.5 + 0.5 * np.cos(2 * np.pi * n / M)
    pad = np.zeros((T, M, N)); pad[:, :N] = ser
    fs = np.real(np.fft.ifft(np.fft.fft(pad, axis=1) * H[None, :, None], axis=1))[:, :N]
    a = np.radians(np.asarray(ang, float))
    w = np.array([((a[i] - a[i - 1]) / 2 if i else (a[1] - a[0]) / 2 if T > 1 else np.radians(1)) + ((a[i + 1] - a[i]) / 2 if i + 1 < T else (a[i] - a[i - 1]) / 2 if T > 1 else np.radians(1)) for i in range(T)])
    vol = np.zeros((N, N, N))
    for t in range(T):
        backproject(fs[t], ang[t], vol, w[t])
    return vol


def sirt(ser, ang, iterations, log):
    N = ser.shape[1]
    ones = np.ones((N, N, N))
    R = [np.where(r > 1e-6, 1 / np.maximum(r, 1e-12), 0) for r in (project(ones, a) for a in ang)]
    C = np.zeros((N, N, N))
    for a in ang:
        backproject(np.ones((N, N)), a, C)
    C = np.where(C > 1e-6, 1 / np.maximum(C, 1e-12), 0)
    x = np.zeros((N, N, N))
    for it in range(iterations):
        upd = np.zeros_like(x)
        for t, a in enumerate(ang):
            backproject((ser[t] - project(x, a)) * R[t], a, upd)
        x = np.maximum(x + C * upd, 0)
        log(f"SIRT {it + 1}/{iterations}")
    return x


# ---------------------------------------------------------------- engines
class EngineMissing(RuntimeError):
    pass


def version(mod):
    try:
        return getattr(__import__(mod), "__version__", "installed")
    except Exception:
        return None


def run_tomo(job, data, log):
    p = job["parameters"]
    ser, ang = np.asarray(data["tilt_series"], float), [float(a) for a in data["angles_deg"]]
    method, eng = p.get("method", "wbp"), job["engine"]["name"]
    if eng == "astra" and not version("astra"):
        if job["engine"].get("fallback") != "numpy":
            raise EngineMissing("astra")
        eng = "numpy"
    log(f"tomography: {method.upper()} on {ser.shape[0]} projections of {ser.shape[1]}², engine {eng}")
    amap = astra_angle_map() if eng == "astra" else None
    if eng == "astra" and amap is None:
        log("ASTRA's geometry did not match the reference projector: using the numpy engine")
        eng = "numpy"
    if eng == "astra" and method == "sirt":
        import astra  # each x-slice is a 2D parallel-beam problem (the tilt axis is x)

        N = ser.shape[1]
        vol = np.zeros((N, N, N))
        vg, pg = astra.create_vol_geom(N, N), astra.create_proj_geom("parallel", 1.0, N, np.radians([amap(a) for a in ang]))
        for x in range(N):
            sid, rid = astra.data2d.create("-sino", pg, ser[:, :, x]), astra.data2d.create("-vol", vg, 0)
            cfg = astra.astra_dict("SIRT_CUDA" if job["parameters"].get("gpu") else "SIRT")
            cfg.update(ReconstructionDataId=rid, ProjectionDataId=sid, option={"MinConstraint": 0})
            if not job["parameters"].get("gpu"):
                cfg["ProjectorId"] = astra.create_projector("linear", pg, vg)
            aid = astra.algorithm.create(cfg)
            astra.algorithm.run(aid, int(p.get("iterations", 20)))
            vol[:, :, x] = astra.data2d.get(rid)
            astra.algorithm.delete(aid); astra.data2d.delete([sid, rid])
        note = "ASTRA (angle convention checked against the numpy projector)"
    else:
        vol = wbp(ser, ang, p.get("filter", "ramp")) if method == "wbp" else sirt(ser, ang, int(p.get("iterations", 20)), log)
        note = "numpy reference engine (the browser's discretisation)"
    return {"reconstruction": vol.astype(np.float32)}, {"engine": eng, "note": note, "voxel_A": p.get("voxel_A")}


def astra_angle_map():
    """The mapping from TEM-view's tilt angle to ASTRA's, found by projecting an off-centre point with both."""
    try:
        import astra
    except Exception:
        return None
    N, th = 32, 30.0
    vol = np.zeros((N, N, N)); vol[20, 9, 16] = 1
    ref = project(vol, th)[:, 16]
    for f in (lambda a: a, lambda a: -a, lambda a: a + 90, lambda a: 90 - a):
        try:
            vg, pg = astra.create_vol_geom(N, N), astra.create_proj_geom("parallel", 1.0, N, np.radians([f(th)]))
            pid = astra.create_projector("linear", pg, vg)
            _, s = astra.create_sino(vol[:, :, 16], pid)
            astra.projector.delete(pid)
            if np.corrcoef(np.asarray(s)[0], ref)[0, 1] > 0.95:
                return f
        except Exception:
            continue
    return None


def run_abtem(job, data, log):
    try:
        from temview_abtem import simulate, validate
    except Exception:
        raise EngineMissing("abtem")
    log("abTEM: " + job["parameters"]["request"]["mode"])
    res = simulate(validate(job["parameters"]["request"]), progress=log)
    return {k: np.asarray(v) for k, v in res["arrays"].items()}, {"engine": "abtem", **{k: v for k, v in res.get("meta", {}).items() if isinstance(v, (str, int, float, bool, list, dict))}}


def _phase_corr(a, b):
    """Sub-pixel shift (dy, dx) that moves image b onto image a: phase correlation with a Hann window."""
    wy, wx = np.hanning(a.shape[0]), np.hanning(a.shape[1])
    w = np.outer(wy, wx)
    A, B = np.fft.fft2((a - a.mean()) * w), np.fft.fft2((b - b.mean()) * w)
    R = A * np.conj(B)
    r = np.real(np.fft.ifft2(R / np.maximum(np.abs(R), 1e-30)))
    iy, ix = np.unravel_index(np.argmax(r), r.shape)
    def sub(m, c, p):
        d = m - 2 * c + p
        return 0.0 if d == 0 else (m - p) / (2 * d)
    ny, nx = r.shape
    dy = iy + sub(r[(iy - 1) % ny, ix], r[iy, ix], r[(iy + 1) % ny, ix])
    dx = ix + sub(r[iy, (ix - 1) % nx], r[iy, ix], r[iy, (ix + 1) % nx])
    return (dy - ny if dy > ny / 2 else dy), (dx - nx if dx > nx / 2 else dx)


def _shift(img, dy, dx):
    """Shift an image by (dy, dx) pixels with the Fourier shift theorem."""
    ky, kx = np.fft.fftfreq(img.shape[0])[:, None], np.fft.fftfreq(img.shape[1])[None, :]
    return np.real(np.fft.ifft2(np.fft.fft2(img) * np.exp(-2j * np.pi * (ky * dy + kx * dx))))


def run_insitu(job, data, log):
    """An in situ movie: drift measured by phase correlation against the first frame (frame to frame where the
    specimen has changed too much), the frames aligned onto the first, their sum, and each frame's environment."""
    p = job["parameters"]
    mov = np.asarray(data["movie"], float)
    F = mov.shape[0]
    out = {"time_s": np.asarray(data["time_s"], np.float32)}
    for k in ("T_K", "tempSet", "gcP", "bsV", "lcRate"):
        if k in data:
            out[k] = np.asarray(data[k], np.float32)
    info = {"engine": "numpy", "frames": F, "mode": p.get("mode"), "voxel_A": p.get("pixel_A")}
    if not p.get("align") or not p.get("pixel_A"):
        log(f"in situ series: {F} frames of {p.get('mode')} (patterns: no drift correction)")
        out["movie"] = mov.astype(np.float32)
        return out, {**info, "note": "series packaged with its environment; patterns are not drift-corrected"}
    px = float(p["pixel_A"])
    log(f"in situ movie: {F} frames of {mov.shape[1]}x{mov.shape[2]}, {px:.4f} A per pixel, drift correction")
    # each frame against the first (no accumulation of sub-pixel bias); if a frame correlates poorly with the first
    # (the specimen changed), its shift from the previous frame is added instead
    shifts = np.zeros((F, 2))
    for k in range(1, F):
        dy, dx = _phase_corr(mov[0], mov[k])
        sy, sx = _phase_corr(mov[k - 1], mov[k])
        step = (shifts[k - 1, 0] + sy, shifts[k - 1, 1] + sx)
        shifts[k] = (dy, dx) if np.hypot(dy - step[0], dx - step[1]) < 3 else step
        if k % max(1, F // 10) == 0:
            log(f"  frame {k}/{F}: shift ({shifts[k, 1]:.2f}, {shifts[k, 0]:.2f}) px")
    aligned = np.stack([_shift(mov[k], shifts[k, 0], shifts[k, 1]) for k in range(F)])
    # the image moves against the specimen: the specimen drift is minus the image shift onto the first frame
    drift = np.stack([shifts[:, 1], shifts[:, 0]], axis=1) * px
    out.update(movie_aligned=aligned.astype(np.float32), aligned_sum=aligned.mean(0).astype(np.float32), drift_measured_A=drift.astype(np.float32))
    note = "phase correlation against the first frame (frame to frame where the specimen changed); Fourier-shift alignment"
    if "drift_true_A" in data:
        t = np.asarray(data["drift_true_A"], float)
        err = np.sqrt(np.mean(np.sum((drift - t) ** 2, axis=1)))
        out["drift_true_A"] = t.astype(np.float32)
        info["drift_rms_error_A"] = round(float(err), 4)
        info["drift_rms_error_px"] = round(float(err / px), 4)
        log(f"  drift vs the exhibit's true drift: RMS {err:.3f} A ({err / px:.2f} px)")
    return out, {**info, "note": note}


ENGINES = {"tomo": run_tomo, "abtem": run_abtem, "insitu": run_insitu}


# ---------------------------------------------------------------- outputs
def write_npz(path, arrays, meta):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for k, v in arrays.items():
            b = io.BytesIO(); np.save(b, np.ascontiguousarray(v)); z.writestr(f"{k}.npy", b.getvalue())
        z.writestr("metadata.json", json.dumps({"format": "tem-view-data/1", **meta}, indent=1, default=str))


def write_ome_zarr(path, arrays, meta, voxel=1.0):
    """OME-Zarr v0.4 written by hand (zarr v2 layout, one array per group, uncompressed little-endian chunks), so
    that it needs no zarr library here and the exhibit can read it without a codec."""
    os.makedirs(path, exist_ok=True)
    json.dump({"zarr_format": 2}, open(os.path.join(path, ".zgroup"), "w"))
    json.dump({"temview": meta, "arrays": list(arrays)}, open(os.path.join(path, ".zattrs"), "w"), default=str, indent=1)
    for name, a in arrays.items():
        a = np.ascontiguousarray(a)
        if a.dtype.kind == "c":
            a = np.stack([a.real, a.imag], -1).astype(np.float32)
        a = a.astype("<f4")
        g = os.path.join(path, name)
        os.makedirs(os.path.join(g, "0"), exist_ok=True)
        json.dump({"zarr_format": 2}, open(os.path.join(g, ".zgroup"), "w"))
        axes = [{"name": n, "type": "space", "unit": "angstrom"} for n in ("zyx"[-a.ndim:] if a.ndim <= 3 else [f"d{i}" for i in range(a.ndim)])]
        if name in ("movie", "movie_aligned") and a.ndim == 3:  # an in situ movie: time, then the image
            axes[0] = {"name": "t", "type": "time", "unit": "second"}
        scale = [voxel] * a.ndim
        if axes[0].get("type") == "time":
            pr = (meta.get("provenance") or {}).get("parameters") or {}
            scale[0] = float(pr.get("every", 1)) / float(pr.get("fps", 1))
        json.dump({"multiscales": [{"version": "0.4", "name": name, "axes": axes, "datasets": [{"path": "0", "coordinateTransformations": [{"type": "scale", "scale": scale}]}]}]},
                  open(os.path.join(g, ".zattrs"), "w"), indent=1)
        json.dump({"zarr_format": 2, "shape": list(a.shape), "chunks": list(a.shape), "dtype": "<f4", "compressor": None, "fill_value": 0.0, "order": "C", "filters": None, "dimension_separator": "."},
                  open(os.path.join(g, "0", ".zarray"), "w"), indent=1)
        a.tofile(os.path.join(g, "0", ".".join("0" * a.ndim)))
    # the same, zipped (stored), for the browser
    with zipfile.ZipFile(path + ".zip", "w", zipfile.ZIP_STORED) as z:
        for root, _, files in os.walk(path):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, os.path.dirname(path)))


def write_h5(path, arrays, meta):
    try:
        import h5py
    except Exception:
        return False
    with h5py.File(path, "w") as f:
        for k, v in arrays.items():
            f.create_dataset(k, data=v)
        f.attrs["temview"] = json.dumps(meta, default=str)
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description="Run a TEM-view job bundle (temview-job/1)")
    ap.add_argument("job", help="job.json from the bundle")
    ap.add_argument("--out", default="results")
    a = ap.parse_args(argv)
    t0, here = time.time(), os.path.dirname(os.path.abspath(a.job))
    os.makedirs(a.out, exist_ok=True)
    log = lambda m: print(f"[{time.time() - t0:7.1f} s] {m}", flush=True)
    try:
        job = json.load(open(a.job))
        if job.get("format") != FORMAT:
            raise ValueError(f"not a {FORMAT} job")
        kind = job["engine"]["kind"]
        if kind not in ENGINES:
            raise EngineMissing(job["engine"]["name"])
        data = {}
        if job.get("data"):
            with np.load(os.path.join(here, job["data"]["file"])) as d:
                data = {k: d[k] for k in d.files}
        session = open(os.path.join(here, "session.json"), "rb").read() if os.path.exists(os.path.join(here, "session.json")) else b""
        if job.get("provenance", {}).get("session_sha256") and hashlib.sha256(session).hexdigest() != job["provenance"]["session_sha256"]:
            log("warning: session.json differs from the one this job was made from")
    except EngineMissing as e:
        json.dump({"error": f"the engine {e} is not installed", "engine": str(e)}, open(os.path.join(a.out, "result-error.json"), "w"))
        print(f"the engine {e} is not installed here (see temview-hpc.def)", file=sys.stderr)
        return 3
    except Exception as e:
        print(f"bad bundle: {e}", file=sys.stderr)
        return 2
    try:
        arrays, info = ENGINES[kind](job, data, log)
    except EngineMissing as e:
        json.dump({"error": f"the engine {e} is not installed", "engine": str(e)}, open(os.path.join(a.out, "result-error.json"), "w"))
        print(f"the engine {e} is not installed here (see temview-hpc.def)", file=sys.stderr)
        return 3
    meta = {"technique": job["technique"], "result_of": FORMAT, "provenance": {**job.get("provenance", {}), **info, "parameters": job.get("parameters"),
            "runner": "run_job.py 1", "numpy": np.__version__, "python": platform.python_version(), "host": socket.gethostname(), "seconds": round(time.time() - t0, 2),
            "finished": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "versions": {m: version(m) for m in ("astra", "abtem", "h5py")}}}
    write_npz(os.path.join(a.out, "result.npz"), arrays, meta)
    write_ome_zarr(os.path.join(a.out, "result.zarr"), arrays, meta, voxel=float(info.get("voxel_A") or 1.0))
    h5 = write_h5(os.path.join(a.out, "result.h5"), arrays, meta)
    log(f"done: result.npz, result.zarr(.zip){', result.h5' if h5 else ''} in {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
