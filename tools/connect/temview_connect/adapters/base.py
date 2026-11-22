"""The adapter interface: what a simulator or an instrument implements to join temview-connect/1.

Copyright © 2026 by Northwestern University. All Rights Reserved.

Write one subclass per program or instrument (a vendor API, a camera SDK, a simulation code). The server
(temview_connect.server) handles HTTP, origins, pairing, limits, queueing and logging; the adapter only talks to
the device.
"""
from __future__ import annotations

from typing import Callable

from ..protocol import Description


class Adapter:
    description: Description

    def read_state(self) -> dict:
        """The device's actual state, in protocol units (only the controls it exposes)."""
        return {}

    def apply(self, changes: dict) -> dict:
        """Apply already-validated changes, in a safe order; return the state actually reached."""
        raise NotImplementedError("this connector cannot be driven")

    def run(self, job: dict, progress: Callable[[str], None]) -> dict:
        """Simulate or acquire. Return {"arrays": {name: numpy array}, "meta": {...}}."""
        raise NotImplementedError

    def run_series(self, job: dict, progress) -> dict:
        """A simulate-series job: one simulation per tilt (job["angles_deg"]), the arrays stacked along a new first
        axis. Adapters with a faster way (one model, many projections) override this."""
        import numpy as np

        out, meta, ang = {}, {}, job["angles_deg"]
        for i, a in enumerate(ang):
            sub = {**job, "kind": "simulate", "tilt_alpha_deg": a}
            if isinstance(job.get("request"), dict):
                sub["request"] = {**job["request"], "tilt_alpha_deg": a}
            res = self.run(sub, lambda m, *x, **k: None)
            for k, v in res["arrays"].items():
                out.setdefault(k, []).append(np.asarray(v))
            meta = res.get("meta", {})
            progress(f"tilt {i + 1} of {len(ang)} ({a:+.1f}°)", (i + 1) / len(ang))
        return {"arrays": {k: np.stack(v) for k, v in out.items()} | {"angles_deg": np.asarray(ang, dtype=np.float32)}, "meta": {**meta, "series": True}}

    def stop(self) -> None:
        """Make the device safe now: blank the beam, stop motion, abort an exposure. Must not raise."""
