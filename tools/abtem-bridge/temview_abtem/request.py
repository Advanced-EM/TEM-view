"""The simulation request (format temview-abtem/1) that TEM-view sends, and its validation.

A request is plain JSON, written by the exhibit (js/abtem.js) or by a script (temview-py:
Microscope.abtem_request()). Everything is in abTEM's conventions already:
- aberrations: polar coefficients C10, C12/phi12, C21/phi21, C23/phi23, C30, C34/phi34 in Å and radians
  (C10 = TEM-view's defocus, negative = underfocus; C21 = 3·B2 in TEM-view's Krivanek notation)
- focal_spread_A: 1/e width (Kirkland convention) = √2 × TEM-view's focal spread σ
- angular_spread_mrad, semiangle_mrad, detector angles in mrad; lengths in Å; tilt in mrad (beam tilt
  standing in for the small specimen tilt)
"""
from __future__ import annotations

import math

FORMAT = "temview-abtem/1"
MODES = ("tem", "stem", "4d", "diff", "cbed")
SPECIMENS = ("au", "si", "sto", "gr")
PRESETS = {
    # frozen-phonon configurations, scan points per side (probe modes), largest potential grid
    "quick": {"frozen_phonons": 2, "scan_gpts": 32, "max_gpts": 1536},
    "standard": {"frozen_phonons": 8, "scan_gpts": 64, "max_gpts": 3072},
    "full": {"frozen_phonons": 16, "scan_gpts": None, "max_gpts": 6144},  # scan at the probe's Nyquist sampling
}
LIMITS = {"fov_A": 400.0, "thickness_A": 1500.0, "frozen_phonons": 32, "scan_gpts": 256}


class RequestError(ValueError):
    pass


def wavelength_A(energy_eV: float) -> float:
    m0c2 = 510998.95
    return 12.2643 / math.sqrt(energy_eV * (1 + energy_eV / (2 * m0c2)))


def validate(req: dict) -> dict:
    """Check a request and fill in the defaults; returns a normalized copy. Raises RequestError."""
    if not isinstance(req, dict) or req.get("format") != FORMAT:
        raise RequestError(f"not a {FORMAT} request")
    r = {k: v for k, v in req.items()}
    if r.get("mode") not in MODES:
        raise RequestError(f"mode must be one of {', '.join(MODES)} (got {r.get('mode')!r})")
    sp = r.get("specimen") or {}
    if sp.get("id") not in SPECIMENS:
        raise RequestError(f"specimen {sp.get('id')!r} is not supported yet: use one of {', '.join(SPECIMENS)}")
    for key, lim in (("fov_A", LIMITS["fov_A"]), ("thickness_A", LIMITS["thickness_A"])):
        v = float(sp.get(key, 0))
        if not 0 < v <= lim:
            raise RequestError(f"specimen.{key} must be in (0, {lim}] (got {v})")
    beam = r.get("beam") or {}
    E = float(beam.get("energy_eV", 0))
    if not 20e3 <= E <= 400e3:
        raise RequestError("beam.energy_eV must be between 20 and 400 keV")
    preset = r.get("preset", "quick")
    if preset not in PRESETS:
        raise RequestError(f"preset must be one of {', '.join(PRESETS)}")
    run = {**PRESETS[preset], **(r.get("run") or {})}
    run["frozen_phonons"] = int(min(max(1, run["frozen_phonons"]), LIMITS["frozen_phonons"]))
    if run.get("scan_gpts") is not None:
        run["scan_gpts"] = int(min(max(4, run["scan_gpts"]), LIMITS["scan_gpts"]))
    run.setdefault("algorithm", "multislice")
    if run["algorithm"] not in ("multislice", "prism"):
        raise RequestError("run.algorithm must be multislice or prism")
    r["run"] = run
    r["preset"] = preset
    r["optics"] = {k: float(v) for k, v in (r.get("optics") or {}).items() if isinstance(v, (int, float))}
    return r


def sampling_for(req: dict) -> float:
    """Potential sampling (Å) fine enough for the largest angle the request needs: abTEM keeps (2/3) of the
    Nyquist frequency (antialiasing), so θ_max = (2/3)·λ/(2·dx)."""
    lam = wavelength_A(req["beam"]["energy_eV"])
    d = req.get("detector") or {}
    theta = {
        "tem": max(d.get("max_angle_mrad", 0), req["optics"].get("objective_aperture_mrad", 0), 40),
        "diff": d.get("max_angle_mrad", 60),
        "cbed": d.get("max_angle_mrad", 60),
        "4d": d.get("max_angle_mrad", 60),
        "stem": d.get("outer_mrad", 200),
    }[req["mode"]] * 1e-3 * 1.05
    dx = (2 / 3) * lam / (2 * theta)
    dx = min(dx, 0.1)
    box = req["specimen"]["fov_A"] + 2 * req["specimen"].get("margin_A", 0)
    gmax = req["run"]["max_gpts"]
    if box / dx > gmax:
        raise RequestError(f"this needs {int(box / dx)} grid points per side at {dx:.3f} Å for {theta * 1e3 / 1.05:.0f} mrad; "
                           f"the {req['preset']!r} preset allows {gmax}: reduce the field of view or the angle, or use a larger preset")
    return dx
