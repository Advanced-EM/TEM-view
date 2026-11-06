"""Bridge from the TEM-view digital twin to abTEM: run the microscope's current state as an abTEM simulation.

    from temview_abtem import simulate, write_npz
    write_npz(simulate(request), "result.npz")

Copyright © 2026 by Northwestern University. All Rights Reserved.
"""
from .request import FORMAT, RequestError, validate
from .simulate import CITATION, simulate, to_npz_bytes, write_npz

__all__ = ["FORMAT", "RequestError", "validate", "simulate", "write_npz", "to_npz_bytes", "CITATION"]
__version__ = "0.1.0"
