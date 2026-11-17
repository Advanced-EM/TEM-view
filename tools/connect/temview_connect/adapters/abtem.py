"""abTEM as a temview-connect/1 simulator (through the temview-abtem bridge package).

Copyright © 2026 by Northwestern University. All Rights Reserved.

abTEM computes what the microscope would record; it has no Lorentz optics, spectrometer or X-ray detector, so it
offers the modes a multislice code can do: TEM, STEM, 4D-STEM, SAED and CBED. A job carries the temview-abtem/1
request the exhibit already writes (js/abtem.js), so the conventions are the bridge's.
"""
from __future__ import annotations

from ..protocol import Description, ProtocolError
from .base import Adapter


class AbTEMSimulator(Adapter):
    def __init__(self):
        import abtem
        from temview_abtem import CITATION
        from temview_abtem.request import MODES, SPECIMENS

        self.description = Description(
            name="abTEM", kind="simulator", version=abtem.__version__, vendor="abTEM (Madsen & Susi)",
            modes=tuple(MODES), specimens=tuple(SPECIMENS), acquisitions=("simulate",), citation=CITATION,
            links={"github": "https://github.com/abTEM/abTEM", "docs": "https://abtem.readthedocs.io/",
                   "doi": "https://doi.org/10.12688/openreseurope.13015.2"},
        )

    @staticmethod
    def to_npz(result: dict) -> bytes:  # the bridge's own TEM-view .npz, with abTEM's metadata and citation
        from temview_abtem import to_npz_bytes

        return to_npz_bytes(result)

    def run(self, job: dict, progress) -> dict:
        from temview_abtem import RequestError, simulate, validate

        req = job.get("request")
        if not isinstance(req, dict):
            raise ProtocolError("an abTEM job needs the temview-abtem/1 request in job.request")
        if req.get("mode") != job["mode"]:
            raise ProtocolError("job.mode and job.request.mode differ")
        try:
            return simulate(validate(req), progress=progress)
        except RequestError as e:
            raise ProtocolError(str(e)) from e
