"""A compute connector: reconstructions and simulated series on this computer (Tier 2 of TEM-view's compute path).

Copyright © 2026 by Northwestern University. All Rights Reserved.

    temview-connect serve --adapter recon --port 8800

Jobs (temview-connect/1, POST /jobs):
- reconstruct, mode tomo:  arrays.tilt_series [tilts, N, N] (rows v, columns x; the tilt axis along x), angles_deg,
  method wbp | sirt, iterations, filter ramp | hann, engine auto | numpy | astra → reconstruction [z, y, x]
- reconstruct, mode 4d:    arrays.data [N², n4, n4] (centred patterns), arrays.probe (complex64, n4²), geom
  {N, n4, gridN, dx, step, scan}, iterations, engine auto | numpy | py4dstem → object (complex64, gridN²)
- simulate-series, mode tomo: arrays.volume [z, y, x] and angles_deg → tilt_series (projections)

Engines: numpy (always: the same discretisation as TEM-view's tomo.js and kernels.js, so results match the browser),
ASTRA Toolbox for tomography and py4DSTEM for ptychography when they are installed. ASTRA's angle convention is
checked against the numpy projector before it is used; if the two disagree it is not used.
"""
from __future__ import annotations

import time

import numpy as np

from ..protocol import Description, ProtocolError
from .base import Adapter


def _version(mod):
    try:
        m = __import__(mod)
        return getattr(m, "__version__", "installed")
    except Exception:
        return None


# ---------------------------------------------------------------- the numpy reference (tomo.js conventions)
def project(vol: np.ndarray, th_deg: float) -> np.ndarray:
    """vol [z, y, x] → projection [v, x]; v = (y − c) cos θ − (z − c) sin θ + c, linear splat into two bins."""
    N = vol.shape[0]
    c, cs, sn = N / 2 - 0.5, np.cos(np.radians(th_deg)), np.sin(np.radians(th_deg))
    z, y = np.meshgrid(np.arange(N), np.arange(N), indexing="ij")
    v = (y - c) * cs - (z - c) * sn + c
    v0 = np.floor(v).astype(int)
    f = (v - v0).ravel()
    v0 = v0.ravel()
    rows = vol.reshape(N * N, N)
    out = np.zeros((N + 2, N))
    ok = (v0 >= -1) & (v0 < N)
    np.add.at(out, v0[ok] + 1, (1 - f[ok])[:, None] * rows[ok])
    np.add.at(out, v0[ok] + 2, f[ok][:, None] * rows[ok])
    return out[1:N + 1]


def backproject(p: np.ndarray, th_deg: float, vol: np.ndarray, w: float = 1.0) -> np.ndarray:
    N = vol.shape[0]
    c, cs, sn = N / 2 - 0.5, np.cos(np.radians(th_deg)), np.sin(np.radians(th_deg))
    z, y = np.meshgrid(np.arange(N), np.arange(N), indexing="ij")
    v = (y - c) * cs - (z - c) * sn + c
    v0 = np.floor(v).astype(int)
    f = v - v0
    pp = np.zeros((N + 2, N))
    pp[1:N + 1] = p
    ok = ((v0 >= -1) & (v0 < N))[..., None]
    a = pp[np.clip(v0 + 1, 0, N + 1)] * (1 - f)[..., None] + pp[np.clip(v0 + 2, 0, N + 1)] * f[..., None]
    vol += w * np.where(ok, a, 0)
    return vol


def intervals(ang):
    a = np.radians(np.asarray(ang, dtype=float))
    out = np.empty_like(a)
    for i in range(len(a)):
        lo = (a[i] - a[i - 1]) / 2 if i else ((a[i + 1] - a[i]) / 2 if len(a) > 1 else np.radians(1))
        hi = (a[i + 1] - a[i]) / 2 if i + 1 < len(a) else lo
        out[i] = lo + hi
    return out


def ramp_filter(ser: np.ndarray, filt: str = "ramp") -> np.ndarray:
    """Ram-Lak kernel in real space (h₀ = 1/4, hₙ = −1/(πn)² for odd n) applied along v, as tomo.filterSeries."""
    T, N, _ = ser.shape
    M = 1
    while M < 2 * N:
        M *= 2
    n = np.minimum(np.arange(M), M - np.arange(M))
    h = np.where(n == 0, 0.25, np.where(n % 2 == 1, -1 / (np.pi * np.maximum(n, 1)) ** 2, 0.0))
    H = np.real(np.fft.fft(h))
    if filt == "hann":
        H *= 0.5 + 0.5 * np.cos(2 * np.pi * n / M)
    pad = np.zeros((T, M, N))
    pad[:, :N] = ser
    return np.real(np.fft.ifft(np.fft.fft(pad, axis=1) * H[None, :, None], axis=1))[:, :N]


def wbp_numpy(ser, ang, filt="ramp"):
    N = ser.shape[1]
    vol, w, fs = np.zeros((N, N, N)), intervals(ang), ramp_filter(ser, filt)
    for t, a in enumerate(ang):
        backproject(fs[t], a, vol, w[t])
    return vol


def sirt_numpy(ser, ang, iterations, progress, positivity=True):
    N = ser.shape[1]
    ones = np.ones((N, N, N))
    R = [np.where(r > 1e-6, 1 / np.maximum(r, 1e-12), 0) for r in (project(ones, a) for a in ang)]
    C = np.zeros((N, N, N))
    for a in ang:
        backproject(np.ones((N, N)), a, C)
    C = np.where(C > 1e-6, 1 / np.maximum(C, 1e-12), 0)
    x, resid = np.zeros((N, N, N)), []
    for it in range(iterations):
        upd, r2, p2 = np.zeros_like(x), 0.0, 0.0
        for t, a in enumerate(ang):
            d = ser[t] - project(x, a)
            r2 += float((d * d).sum()); p2 += float((ser[t] ** 2).sum())
            backproject(d * R[t], a, upd)
        x += C * upd
        if positivity:
            np.maximum(x, 0, out=x)
        resid.append(np.sqrt(r2 / (p2 or 1)))
        progress(f"SIRT {it + 1}/{iterations}", (it + 1) / iterations, preview=x[:, :, N // 2])
    return x, resid


# ---------------------------------------------------------------- ASTRA (when installed)
def astra_engine():
    """ASTRA's 2D parallel-beam geometry for each x-slice (the tilt axis is x), with the angle mapping chosen by
    comparing a projection of an off-centre point with the numpy projector. None if ASTRA is missing or no mapping
    matches."""
    try:
        import astra
    except Exception:
        return None
    N, th = 32, 30.0
    vol = np.zeros((N, N, N)); vol[20, 9, 16] = 1  # z, y, x
    ref = project(vol, th)[:, 16]
    for name, f in (("θ", lambda a: a), ("−θ", lambda a: -a), ("θ+90°", lambda a: a + 90), ("90°−θ", lambda a: 90 - a)):
        for flip in (False, True):
            try:
                vg = astra.create_vol_geom(N, N)
                pg = astra.create_proj_geom("parallel", 1.0, N, np.radians([f(th)]))
                pid = astra.create_projector("linear", pg, vg)
                sl = vol[:, :, 16]
                _, s = astra.create_sino(sl if not flip else sl.T, pid)
                astra.projector.delete(pid)
                if np.corrcoef(np.asarray(s)[0], ref)[0, 1] > 0.95:
                    return {"astra": astra, "map": f, "flip": flip, "name": name}
            except Exception:
                continue
    return None


def sirt_astra(eng, ser, ang, iterations, progress):
    astra, f, flip = eng["astra"], eng["map"], eng["flip"]
    T, N, _ = ser.shape
    vol = np.zeros((N, N, N))
    vg = astra.create_vol_geom(N, N)
    pg = astra.create_proj_geom("parallel", 1.0, N, np.radians([f(a) for a in ang]))
    for x in range(N):  # each x-slice is a 2D problem (sinogram [tilts, v])
        sid = astra.data2d.create("-sino", pg, ser[:, :, x])
        rid = astra.data2d.create("-vol", vg, 0)
        cfg = astra.astra_dict("SIRT")
        cfg.update(ReconstructionDataId=rid, ProjectionDataId=sid, ProjectorId=astra.create_projector("linear", pg, vg), option={"MinConstraint": 0})
        aid = astra.algorithm.create(cfg)
        astra.algorithm.run(aid, iterations)
        sl = astra.data2d.get(rid)
        vol[:, :, x] = sl.T if flip else sl
        astra.algorithm.delete(aid); astra.data2d.delete([sid, rid])
        if x % 8 == 7:
            progress(f"ASTRA SIRT: slice {x + 1}/{N}", (x + 1) / N, preview=vol[:, :, N // 2])
    return vol


# ---------------------------------------------------------------- ptychography (ePIE, as kernels.epieStep)
def epie_numpy(data, probe, g, iterations, progress, seed=1234):
    N, n4, G = g["N"], g["n4"], g["gridN"]
    corner = lambda i: int(round(G / 2 + (-g["scan"] / 2 + (i + 0.5) * g["step"]) / g["dx"])) - n4 // 2
    O = np.ones((G, G), complex)
    P = probe.reshape(n4, n4).astype(complex)
    pm = (np.abs(P) ** 2).max()
    amp = np.sqrt(np.fft.ifftshift(data.reshape(N * N, n4, n4), axes=(1, 2)))
    rng, err = np.random.default_rng(seed), []
    for it in range(iterations):
        e = 0.0
        for idx in rng.permutation(N * N):
            top, left = corner(idx // N), corner(idx % N)
            o = O[top:top + n4, left:left + n4]
            psi = o * P
            F = np.fft.fft2(psi)
            a = np.abs(F)
            e += float(((a - amp[idx]) ** 2).sum())
            Fc = np.where(a > 1e-12, F * amp[idx] / np.maximum(a, 1e-12), 0)
            d = np.fft.ifft2(Fc) - psi
            O[top:top + n4, left:left + n4] = o + 0.9 * np.conj(P) * d / pm
        err.append(e)
        progress(f"ePIE {it + 1}/{iterations}", (it + 1) / iterations, preview=np.angle(O))
    return O, err


class ReconstructionService(Adapter):
    def __init__(self):
        self.engines = {"numpy": np.__version__, "astra": _version("astra"), "py4dstem": _version("py4DSTEM")}
        self.description = Description(
            name="Reconstruction service (this computer)", kind="compute", version="1", vendor="TEM-view", model="recon",
            modes=("tomo", "4d"), acquisitions=("reconstruct", "simulate-series"), engines=self.engines,
            citation="ASTRA: van Aarle et al., Opt. Express 24, 25129 (2016); py4DSTEM: Savitzky et al., Microsc. Microanal. 27, 712 (2021)",
        )
        self._astra = None
        self.aborted = False

    def stop(self):
        self.aborted = True

    def run(self, job, progress):
        self.aborted = False
        t0 = time.time()
        if job["kind"] != "reconstruct":
            raise ProtocolError("this service reconstructs, or simulates series")
        if job["mode"] == "tomo":
            ser = np.asarray(job["arrays"]["tilt_series"], dtype=np.float64)
            ang, method, eng = [float(a) for a in job["angles_deg"]], job.get("method", "wbp"), job.get("engine", "auto")
            used = "numpy"
            if eng in ("auto", "astra") and method == "sirt" and self.engines["astra"]:
                if self._astra is None:
                    self._astra = astra_engine() or False
                if self._astra:
                    used = f"astra (angles {self._astra['name']})"
                elif eng == "astra":
                    raise RuntimeError("ASTRA is installed but its geometry did not match the reference; use engine numpy")
            if eng == "astra" and not self.engines["astra"]:
                raise RuntimeError("ASTRA is not installed here (conda install -c astra-toolbox astra-toolbox)")
            progress(f"{method.upper()} on {used}", 0.0)
            resid = []
            if method == "wbp":
                vol = wbp_numpy(ser, ang, job.get("filter", "ramp"))
            elif used.startswith("astra"):
                vol = sirt_astra(self._astra, ser, ang, int(job.get("iterations", 20)), progress)
            else:
                vol, resid = sirt_numpy(ser, ang, int(job.get("iterations", 20)), progress)
            return {"arrays": {"reconstruction": vol.astype(np.float32)}, "meta": {"engine": used, "method": method, "residual": resid, "seconds": round(time.time() - t0, 2)}}
        if job["mode"] == "4d":
            data, probe, g = job["arrays"]["data"], job["arrays"]["probe"], job.get("geom")
            if not isinstance(g, dict) or not {"N", "n4", "gridN", "dx", "step", "scan"} <= set(g):
                raise ProtocolError("4d: geom {N, n4, gridN, dx, step, scan}")
            eng = job.get("engine", "auto")
            if eng == "py4dstem":
                raise RuntimeError("the py4DSTEM engine needs a calibrated DataCube; send it from Python (tools/temview-py)" if self.engines["py4dstem"] else "py4DSTEM is not installed here (pip install py4DSTEM)")
            O, err = epie_numpy(np.asarray(data, float), np.asarray(probe), g, int(job.get("iterations", 10)), progress)
            return {"arrays": {"object": O.astype(np.complex64)}, "meta": {"engine": "numpy ePIE", "error": err, "seconds": round(time.time() - t0, 2)}}
        raise ProtocolError(f"cannot reconstruct mode {job['mode']}")

    def run_series(self, job, progress):
        if job["mode"] != "tomo" or "volume" not in job.get("arrays", {}):
            raise ProtocolError("simulate-series here: mode tomo with arrays.volume [z, y, x]")
        vol, ang = np.asarray(job["arrays"]["volume"], float), job["angles_deg"]
        out = []
        for i, a in enumerate(ang):
            out.append(project(vol, a))
            progress(f"projection {i + 1}/{len(ang)}", (i + 1) / len(ang), preview=out[-1])
        return {"arrays": {"tilt_series": np.stack(out).astype(np.float32), "angles_deg": np.asarray(ang, np.float32)}, "meta": {"engine": "numpy"}}
