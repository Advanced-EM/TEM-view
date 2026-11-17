"""A test instrument: behaves like a microscope behind a vendor API, without hardware.

Copyright © 2026 by Northwestern University. All Rights Reserved.

Use it to develop and test driving from TEM-view (and as the template for a real adapter). It keeps a state,
moves the stage and changes the high tension slowly as a real column does, refuses to acquire with the beam
blanked, and returns a synthetic lattice image whose contrast follows the defocus, the field of view and the
stage position, so a client can see that its settings arrived.
"""
from __future__ import annotations

import math
import threading
import time

import numpy as np

from ..protocol import Control, Description
from .base import Adapter

STAGE_UM = 1000.0  # ±1 mm


class MockInstrument(Adapter):
    def __init__(self, speed: float = 1.0):
        self.speed = speed  # >1 makes slow operations faster (tests)
        self.description = Description(
            name="Test instrument (no hardware)", kind="instrument", version="1", vendor="TEM-view", model="mock",
            modes=("tem", "stem", "diff"), acquisitions=("acquire",),
            controls={
                "mode": Control("mode", True, choices=("tem", "stem", "diff")),
                "ht_kV": Control("ht_kV", False),  # high tension: read-only from outside, as on most instruments
                "beam_blanked": Control("beam_blanked", True),
                "defocus_nm": Control("defocus_nm", True, -5000, 5000, max_step=2000),
                "fov_nm": Control("fov_nm", True, 1, 5000),
                "stage_x_nm": Control("stage_x_nm", True, -STAGE_UM * 1e3, STAGE_UM * 1e3, max_step=20_000),
                "stage_y_nm": Control("stage_y_nm", True, -STAGE_UM * 1e3, STAGE_UM * 1e3, max_step=20_000),
                "tilt_alpha_deg": Control("tilt_alpha_deg", True, -30, 30, max_step=10),
                "tilt_beta_deg": Control("tilt_beta_deg", True, -20, 20, max_step=10),
                "camera_length_mm": Control("camera_length_mm", True, 50, 4000),
                "objective_aperture": Control("objective_aperture", True, choices=("none", "40", "20", "10")),
            },
        )
        self.state = {"mode": "tem", "ht_kV": 200.0, "beam_blanked": True, "defocus_nm": 0.0, "fov_nm": 20.0,
                      "stage_x_nm": 0.0, "stage_y_nm": 0.0, "tilt_alpha_deg": 0.0, "tilt_beta_deg": 0.0,
                      "camera_length_mm": 1000.0, "objective_aperture": "none"}
        self.lock = threading.Lock()
        self.aborted = threading.Event()

    def read_state(self) -> dict:
        with self.lock:
            return dict(self.state)

    def apply(self, changes: dict) -> dict:
        # a safe order: blank first if asked, move the stage before tilting, unblank last
        order = ["beam_blanked"] if changes.get("beam_blanked") is True else []
        order += [k for k in ("mode", "objective_aperture", "camera_length_mm", "fov_nm", "defocus_nm",
                              "stage_x_nm", "stage_y_nm", "tilt_alpha_deg", "tilt_beta_deg") if k in changes]
        if changes.get("beam_blanked") is False:
            order.append("beam_blanked")
        for k in order:
            if k.startswith("stage") or k.startswith("tilt"):  # motion takes time
                d = abs(changes[k] - self.state[k])
                time.sleep(min(0.5, (d / 5e4 if k.startswith("stage") else d / 20)) / self.speed)
            with self.lock:
                self.state[k] = changes[k]
        return self.read_state()

    def run(self, job: dict, progress) -> dict:
        self.aborted.clear()
        st = self.read_state()
        if st["beam_blanked"]:
            raise RuntimeError("the beam is blanked: unblank it before acquiring")
        if job["mode"] != st["mode"]:
            raise RuntimeError(f"the instrument is in {st['mode']} mode, not {job['mode']}")
        n = int(job.get("pixels", 256))
        n = max(32, min(n, 1024))
        t = float(job.get("exposure_s", 1.0))
        progress(f"exposing {t:g} s")
        end = time.time() + min(t, 5) / self.speed
        while time.time() < end:
            if self.aborted.is_set():
                raise RuntimeError("acquisition aborted")
            time.sleep(0.02)
        img = self._image(st, n)
        rng = np.random.default_rng(int(job.get("seed", 0)))
        counts = rng.poisson(np.clip(img, 0, None) * 200 * t).astype(np.float32)
        return {"arrays": {"image": counts}, "meta": {"instrument": self.description.model, "state": st,
                                                       "pixel_nm": st["fov_nm"] / n, "exposure_s": t}}

    def _image(self, st: dict, n: int) -> np.ndarray:
        if st["mode"] == "diff":  # a square spot pattern whose spacing follows the camera length
            k = np.arange(n) - n / 2
            X, Y = np.meshgrid(k, k)
            p = 0.02 * st["camera_length_mm"] / 10
            return 0.05 + np.exp(-((np.mod(X + p / 2, p) - p / 2) ** 2 + (np.mod(Y + p / 2, p) - p / 2) ** 2) / 4)
        a = 0.39  # nm lattice
        x = st["stage_x_nm"] + (np.arange(n) / n - 0.5) * st["fov_nm"]
        y = st["stage_y_nm"] + (np.arange(n) / n - 0.5) * st["fov_nm"]
        X, Y = np.meshgrid(x, y)
        tilt = math.hypot(st["tilt_alpha_deg"], st["tilt_beta_deg"])
        amp = math.sin(math.pi * st["defocus_nm"] / 40) * math.exp(-tilt / 2) * (1 if st["fov_nm"] < 60 else 0.1)
        if st["mode"] == "stem":
            amp = math.exp(-((st["defocus_nm"] / 5) ** 2)) * math.exp(-tilt / 2)
        return 1 + 0.3 * amp * np.cos(2 * np.pi * X / a) * np.cos(2 * np.pi * Y / a)

    def stop(self) -> None:
        self.aborted.set()
        with self.lock:
            self.state["beam_blanked"] = True
