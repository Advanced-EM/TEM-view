"""temview: script the TEM-view electron microscope simulator from Python.

    import temview as tv
    tem = tv.connect()                      # headless on a desktop; the open exhibit inside its Python IDE
    tem.set(mode="stem", specimen="sto", detector="haadf")
    img = tem.acquire()                     # NumPy arrays with calibrations
    tv.show(img)

Backends, all with the same calls:
    tv.connect("headless")   the simulator in a Node.js process, no browser (needs Node 20+)
    tv.connect("live")       an exhibit open in a browser: select "Connect agent" there (needs `websockets`)
    tv.connect("browser")    inside the exhibit's Python IDE (Pyodide); the default there

Copyright © 2026 by Northwestern University. All Rights Reserved.
"""
from .microscope import Microscope, Acquisition, connect, show, in_browser

__all__ = ["Microscope", "Acquisition", "connect", "show", "in_browser"]
__version__ = "0.1.0"
