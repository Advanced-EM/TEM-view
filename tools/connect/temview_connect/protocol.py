"""temview-connect/1: one protocol between the TEM-view microscope and other software or hardware.

Copyright © 2026 by Northwestern University. All Rights Reserved.

A *connector* is a small local HTTP service in front of something that can take the microscope's state:
- a **simulator** (abTEM, another multislice code) runs an acquisition and returns data;
- an **instrument** (a real microscope, through its vendor's API) is driven: it receives settings, reports its
  actual state, acquires, and stops on request.

The microscope state is instrument-neutral and in explicit units (see CONTROLS). A connector declares which
controls it reads and writes, with its own limits; TEM-view never sends a value outside them and the connector
enforces them again. Data come back in TEM-view's .npz format.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

FORMAT = "temview-connect/1"
MODES = ("tem", "stem", "4d", "diff", "cbed", "eds", "eels", "tomo")
# what POST /jobs can do: run the current acquisition, drive an instrument to acquire, reconstruct data sent with the job
# (a tilt series, a 4D-STEM scan), or simulate a series (one acquisition per tilt)
JOB_KINDS = ("simulate", "acquire", "reconstruct", "simulate-series")
MAX_ARRAY_BYTES = 256 * 1024 * 1024

# The shared vocabulary: key -> (unit, kind, description). A connector exposes a subset, each with its limits.
CONTROLS: dict[str, tuple[str, str, str]] = {
    "mode": ("", "choice", "operating mode: tem, stem, 4d (4D-STEM), diff (SAED), cbed, eds, eels"),
    "ht_kV": ("kV", "number", "accelerating voltage"),
    "beam_blanked": ("", "bool", "beam blanked"),
    "defocus_nm": ("nm", "number", "objective defocus C1, negative = underfocus"),
    "fov_nm": ("nm", "number", "field of view (sets the magnification)"),
    "stage_x_nm": ("nm", "number", "stage x"),
    "stage_y_nm": ("nm", "number", "stage y"),
    "tilt_alpha_deg": ("deg", "number", "stage tilt about the holder axis"),
    "tilt_beta_deg": ("deg", "number", "stage tilt about the perpendicular axis"),
    "convergence_mrad": ("mrad", "number", "probe convergence semi-angle"),
    "camera_length_mm": ("mm", "number", "camera length"),
    "objective_aperture": ("", "choice", "objective aperture: none, 40, 20, 10 (µm)"),
    "holder_temperature_K": ("K", "number", "specimen holder set temperature"),
    "detector_inner_mrad": ("mrad", "number", "annular detector inner angle"),
    "detector_outer_mrad": ("mrad", "number", "annular detector outer angle"),
    "slit_width_eV": ("eV", "number", "energy-filter slit width"),
    "slit_inserted": ("", "bool", "energy-filter slit inserted"),
    "energy_shift_eV": ("eV", "number", "energy-filter energy shift"),
}


class ProtocolError(ValueError):
    pass


@dataclass
class Control:
    """One control as a connector exposes it."""

    key: str
    writable: bool = False
    min: float | None = None
    max: float | None = None
    choices: tuple | None = None
    max_step: float | None = None  # largest change in one write (a stage jump, a tilt step), None = any

    def describe(self) -> dict:
        unit, kind, text = CONTROLS[self.key]
        d = {"unit": unit, "kind": kind, "text": text, "writable": self.writable}
        for k in ("min", "max", "max_step"):
            if getattr(self, k) is not None:
                d[k] = getattr(self, k)
        if self.choices is not None:
            d["choices"] = list(self.choices)
        return d

    def check(self, value, current=None):
        """The value this control will take, or ProtocolError. Numbers are refused (not clamped) outside the
        limits: on an instrument, a silently changed request is worse than a refused one."""
        unit, kind, _ = CONTROLS[self.key]
        if not self.writable:
            raise ProtocolError(f"{self.key} is read-only here")
        if kind == "bool":
            if not isinstance(value, bool):
                raise ProtocolError(f"{self.key} must be true or false")
            return value
        if kind == "choice":
            v = str(value)
            if self.choices is not None and v not in self.choices:
                raise ProtocolError(f"{self.key} must be one of {', '.join(map(str, self.choices))}")
            return v
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ProtocolError(f"{self.key} must be a number")
        v = float(value)
        if self.min is not None and v < self.min or self.max is not None and v > self.max:
            raise ProtocolError(f"{self.key} = {v:g} {unit} is outside [{self.min:g}, {self.max:g}] {unit}")
        if self.max_step is not None and current is not None and abs(v - float(current)) > self.max_step:
            raise ProtocolError(f"{self.key} would change by {abs(v - float(current)):g} {unit}; this connector allows "
                                f"at most {self.max_step:g} {unit} per step")
        return v


@dataclass
class Description:
    """What GET /describe returns."""

    name: str
    kind: str  # "simulator" or "instrument"
    version: str = ""
    vendor: str = ""
    model: str = ""
    modes: tuple = ()
    specimens: tuple | None = None  # simulators: which TEM-view specimens they can rebuild; None = any / real sample
    controls: dict[str, Control] = field(default_factory=dict)
    acquisitions: tuple = ()  # what POST /jobs can do: JOB_KINDS
    engines: dict = field(default_factory=dict)  # compute connectors: engine -> version (None: not installed)
    citation: str = ""
    links: dict = field(default_factory=dict)

    def to_json(self, armed: bool) -> dict:
        return {
            "format": FORMAT, "name": self.name, "kind": self.kind, "version": self.version, "vendor": self.vendor,
            "model": self.model, "modes": list(self.modes), "specimens": None if self.specimens is None else list(self.specimens),
            "controls": {k: c.describe() for k, c in self.controls.items()}, "acquisitions": list(self.acquisitions),
            "armed": armed, "citation": self.citation, "links": self.links, "engines": self.engines,
        }


def decode_array(a) -> "np.ndarray":
    """An array sent in a job: {"dtype": "float32" | "float64" | "complex64", "shape": [...], "b64": base64 of the
    little-endian bytes}."""
    import base64

    import numpy as np

    if not isinstance(a, dict) or not isinstance(a.get("shape"), list) or a.get("dtype") not in ("float32", "float64", "complex64"):
        raise ProtocolError("an array is {dtype: float32 | float64 | complex64, shape: [...], b64}")
    shape = tuple(int(n) for n in a["shape"])
    if any(n <= 0 for n in shape) or len(shape) > 5:
        raise ProtocolError("bad array shape")
    dt = np.dtype(a["dtype"]).newbyteorder("<")
    n = int(np.prod(shape)) * dt.itemsize
    if n > MAX_ARRAY_BYTES:
        raise ProtocolError(f"array of {n / 2**20:.0f} MB is larger than {MAX_ARRAY_BYTES // 2**20} MB")
    raw = base64.b64decode(a.get("b64", ""), validate=True)
    if len(raw) != n:
        raise ProtocolError(f"array data is {len(raw)} bytes; shape {list(shape)} of {a['dtype']} needs {n}")
    return np.frombuffer(raw, dt).reshape(shape)


def encode_array(x) -> dict:
    import base64

    import numpy as np

    x = np.ascontiguousarray(x)
    dt = {"f": "float32", "c": "complex64"}[x.dtype.kind] if x.dtype.kind in "fc" else "float32"
    x = x.astype(np.dtype(dt).newbyteorder("<"))
    return {"dtype": dt, "shape": list(x.shape), "b64": base64.b64encode(x.tobytes()).decode()}


def validate_job(job: dict, desc: Description) -> dict:
    if not isinstance(job, dict) or job.get("format") != FORMAT:
        raise ProtocolError(f"not a {FORMAT} job")
    kind = job.get("kind")
    if kind not in desc.acquisitions:
        raise ProtocolError(f"this connector does not {kind!r} (it can: {', '.join(desc.acquisitions) or 'nothing'})")
    mode = job.get("mode")
    if mode not in desc.modes:
        raise ProtocolError(f"mode {mode!r} is not available here (modes: {', '.join(desc.modes)})")
    if kind == "reconstruct":
        arrays = job.get("arrays")
        if not isinstance(arrays, dict) or not arrays:
            raise ProtocolError("a reconstruct job carries its data in arrays")
        job = {**job, "arrays": {k: decode_array(v) for k, v in arrays.items()}}
        if mode == "tomo":
            ser, ang = job["arrays"].get("tilt_series"), job.get("angles_deg")
            if ser is None or ser.ndim != 3 or ser.shape[1] != ser.shape[2]:
                raise ProtocolError("tomo: arrays.tilt_series is [tilts, N, N]")
            if not isinstance(ang, list) or len(ang) != ser.shape[0] or not all(isinstance(a, (int, float)) and -90 < a < 90 for a in ang):
                raise ProtocolError("tomo: angles_deg lists one angle in (−90°, 90°) per projection")
            if job.get("method", "wbp") not in ("wbp", "sirt"):
                raise ProtocolError("tomo: method is wbp or sirt")
            it = job.get("iterations", 20)
            if not isinstance(it, int) or not 1 <= it <= 500:
                raise ProtocolError("iterations must be 1–500")
        return job
    if kind == "simulate-series":
        ang = job.get("angles_deg")
        if not isinstance(ang, list) or not 1 <= len(ang) <= 361 or not all(isinstance(a, (int, float)) and -90 < a < 90 for a in ang):
            raise ProtocolError("simulate-series: angles_deg lists 1–361 angles in (−90°, 90°)")
        if "arrays" in job:
            job = {**job, "arrays": {k: decode_array(v) for k, v in job["arrays"].items()}}
    t = job.get("exposure_s", 1.0)
    if not isinstance(t, (int, float)) or not 0 < t <= 600:
        raise ProtocolError("exposure_s must be in (0, 600]")
    return job
