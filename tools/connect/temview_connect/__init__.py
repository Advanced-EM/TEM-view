"""temview-connect: one protocol (temview-connect/1) between the TEM-view microscope and other software or
hardware: simulators that compute an acquisition, and instruments that are driven.

    temview-connect serve --adapter mock     # a test instrument, no hardware
    temview-connect serve --adapter abtem    # abTEM as a simulator

Copyright © 2026 by Northwestern University. All Rights Reserved.
"""
from .adapters.base import Adapter
from .client import Client
from .protocol import CONTROLS, FORMAT, Control, Description, ProtocolError
from .server import Service, serve

__all__ = ["Adapter", "Client", "CONTROLS", "FORMAT", "Control", "Description", "ProtocolError", "Service", "serve"]
__version__ = "0.1.0"
