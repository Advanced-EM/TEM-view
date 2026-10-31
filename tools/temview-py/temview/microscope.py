"""The Microscope object and its acquisitions. Every call goes to js/scripting.js through a transport, so a
script behaves the same headless, against an open exhibit, and inside the exhibit's Python IDE."""
from __future__ import annotations

import io
import json
import sys
import zipfile

import numpy as np


def in_browser() -> bool:
    """True inside the exhibit's Python IDE (Pyodide)."""
    return sys.platform == "emscripten"


class Acquisition:
    """What the detectors recorded: NumPy arrays by name, with metadata (calibrations, optics, state).

    acq.image          the main array (image, pattern, spectrum, ...)
    acq["probe"]       any array by name; acq.arrays lists them
    acq.calibration    pixel size, camera length, energy scale, ... as recorded
    acq.save("x.npz")  the same .npz the exhibit's Export button writes
    """

    MAIN = ("image", "pattern", "spectrum", "virtual_image", "hologram", "phase", "datacube")

    def __init__(self, npz: bytes, meta: dict | None = None):
        self.npz = bytes(npz)
        self.arrays: dict[str, np.ndarray] = {}
        with zipfile.ZipFile(io.BytesIO(self.npz)) as z:
            for name in z.namelist():
                if name.endswith(".npy"):
                    self.arrays[name[:-4]] = np.load(io.BytesIO(z.read(name)))
                elif name == "metadata.json":
                    meta = json.loads(z.read(name))
        self.meta: dict = meta or {}

    @property
    def image(self) -> np.ndarray:
        for k in self.MAIN:
            if k in self.arrays:
                return self.arrays[k]
        return next(iter(self.arrays.values()))

    @property
    def calibration(self) -> dict:
        return self.meta.get("calibration") or self.meta.get("calibrations") or {}

    def __getitem__(self, name: str) -> np.ndarray:
        return self.arrays[name]

    def save(self, path: str) -> str:
        with open(path, "wb") as f:
            f.write(self.npz)
        return path

    def __repr__(self) -> str:
        shapes = ", ".join(f"{k} {tuple(v.shape)}" for k, v in self.arrays.items())
        mode = self.meta.get("state", {}).get("mode") or self.meta.get("mode") or "?"
        return f"<Acquisition {mode}: {shapes}>"


class Microscope:
    """One simulated microscope. Get one with temview.connect()."""

    def __init__(self, transport):
        self._t = transport

    # -- reading and changing the instrument
    def info(self) -> dict:
        """What this backend offers: modes, specimens, settings, analyses, challenges."""
        return self._t.call("info")

    def state(self) -> dict:
        """The current settings and optics (mode, specimen, kV, defocus, Cs, aberrations, temperature, ...)."""
        return self._t.call("state")

    def set(self, **settings) -> list:
        """Change settings, e.g. set(mode="stem", specimen="gr", kV=80, defocus_nm=-20, detector="haadf").
        See info()["settings"] for the full list. Returns what was done."""
        return self._t.call("set", settings)

    def command(self, text: str) -> dict:
        """Run a plain-language command with the exhibit's grammar: "defocus minus 50", "300 kV"."""
        return self._t.call("command", {"text": text})

    def aberrations(self, **values) -> dict:
        """Set residual aberrations: A1, B2, A2 in nm and A3 in µm, each as (magnitude, angle in degrees);
        Cs_um sets the corrector's spherical aberration. Example: aberrations(A1=(5, 30), B2=(100, 0))."""
        return self._t.call("aberrations", {k: list(v) if isinstance(v, (tuple, list)) else v for k, v in values.items()})

    # -- recording and measuring
    def acquire(self, steps: int | None = None) -> Acquisition:
        """Record the detectors. The simulator first advances `steps` frames of 50 ms (a sensible default by
        mode), so the data reflects the current settings."""
        r = self._t.call("acquire", {} if steps is None else {"steps": int(steps)})
        return Acquisition(r["npz"], r.get("meta"))

    def analyze(self, name: str | None = None) -> dict:
        """Measure the live data and compare it with the simulator's truth: fit_ctf, fit_lattice,
        identify_edges, fit_eds, fit_zlp, fit_hologram. None picks the analysis for the current mode."""
        return self._t.call("analyze", {} if name is None else {"name": name})

    def step(self, n: int = 1) -> dict:
        """Advance the simulation n frames of 50 ms (drift, dose, temperature change with time)."""
        return self._t.call("step", {"n": int(n)})

    # -- a structure of your own
    def load_xyz(self, xyz: str, name: str | None = None) -> dict:
        """Use an XYZ file (a path, or the file's text) as the specimen "xyz": atoms in Å, any elements, on a
        thin carbon support. Tilting the stage rotates the structure. Returns the atom count and elements."""
        import os

        if "\n" not in xyz and os.path.exists(xyz):
            name = name or os.path.basename(xyz)
            with open(xyz) as f:
                xyz = f.read()
        return self._t.call("load_xyz", {"text": xyz, "name": name or "structure.xyz"})

    # -- the stage, and the nanoparticle megalibrary (specimen="lib")
    def move(self, dx_nm: float = 0, dy_nm: float = 0) -> dict:
        """Move the stage by (dx, dy) nm, e.g. to centre a particle found in an image."""
        return self._t.call("move", {"dx_nm": float(dx_nm), "dy_nm": float(dy_nm)})

    def library(self) -> dict:
        """The megalibrary's layout: 1000 × 1000 particles on a 1 µm grid, the pen blocks, the elements."""
        return self._t.call("library")

    def goto(self, i: int, j: int) -> dict:
        """Drive the stage to particle (i, j) of the megalibrary (loads it if needed). With realistic=True the
        stage lands within ~25 nm of the node, and the particle sits within ~60 nm of it: re-centre before
        measuring."""
        return self._t.call("goto", {"i": int(i), "j": int(j)})

    def particle(self, i: int, j: int) -> dict:
        """The true particle (i, j): composition, size, shape, phase, lattice, domains and orientations. For
        scoring an automated screen, not for running one."""
        return self._t.call("particle", {"i": int(i), "j": int(j)})

    # -- challenges: a training task's hidden misalignment, for testing automation
    def challenge(self, id: str, seed: int | None = None) -> dict:
        """Start a training task as a challenge: tem-focus-stig or corrector-ronch. The knob readings no
        longer show the true optics. Use score() to see how well your script aligned it."""
        return self._t.call("challenge", {"id": id} if seed is None else {"id": id, "seed": int(seed)})

    def score(self) -> dict:
        """The challenge's score from the true optics (the same metrics the training task reports)."""
        return self._t.call("score")

    def reveal(self) -> dict:
        """The hidden misalignment of the running challenge."""
        return self._t.call("reveal")

    def end_challenge(self) -> dict:
        return self._t.call("end_challenge")

    def close(self) -> None:
        self._t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __repr__(self) -> str:
        return f"<Microscope {self._t.name}>"


def connect(backend: str = "auto", **options) -> Microscope:
    """Open a microscope.

    backend="headless"  the simulator in a Node.js process (default on a desktop)
    backend="live"      an exhibit in a browser; options: port=8790, timeout=120 (seconds to wait for
                        "Connect agent" in the exhibit)
    backend="browser"   inside the exhibit's Python IDE (default there)
    """
    from . import transports

    if backend == "auto":
        backend = "browser" if in_browser() else "headless"
    if backend == "browser":
        return Microscope(transports.Browser())
    if backend == "headless":
        return Microscope(transports.Headless(**options))
    if backend == "live":
        return Microscope(transports.Live(**options))
    raise ValueError('backend must be "auto", "headless", "live" or "browser"')


def _as_array(x):
    return x.image if isinstance(x, Acquisition) else np.asarray(x)


def show(x, title: str | None = None):
    """Display an image (2D) or a spectrum or profile (1D). Accepts an Acquisition or an array. In the IDE it
    draws in the output panel; on a desktop it uses matplotlib."""
    a = _as_array(x)
    if a.ndim > 2:
        raise ValueError(f"show() takes a 1D or 2D array; this one is {a.shape}")
    if in_browser():
        from js import temviewIDE  # provided by the exhibit's IDE
        from pyodide.ffi import to_js

        a = np.nan_to_num(a.astype(np.float64))
        if a.ndim == 2:
            lo, hi = np.percentile(a, [0.5, 99.5])
            g = np.clip((a - lo) / ((hi - lo) or 1) * 255, 0, 255).astype(np.uint8)
            temviewIDE.showImage(to_js(g.tobytes()), g.shape[1], g.shape[0], title or "")
        else:
            temviewIDE.showPlot(to_js(a.astype(np.float32).tobytes()), len(a), title or "")
        return None
    try:
        import matplotlib.pyplot as plt
    except ImportError as e:
        raise ImportError("show() needs matplotlib on a desktop: pip install matplotlib") from e
    plt.figure()
    if a.ndim == 2:
        plt.imshow(a, cmap="gray")
        plt.axis("off")
    else:
        plt.plot(a)
    if title:
        plt.title(title)
    plt.show()
