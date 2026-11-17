"""temview-connect serve --adapter mock|abtem|module:Class [--port 8798] [--log audit.jsonl]

Copyright © 2026 by Northwestern University. All Rights Reserved.
"""
from __future__ import annotations

import argparse
import importlib


def load_adapter(name: str):
    if name == "mock":
        from .adapters.mock import MockInstrument

        return MockInstrument()
    if name == "abtem":
        from .adapters.abtem import AbTEMSimulator

        return AbTEMSimulator()
    mod, _, cls = name.partition(":")  # your own adapter: package.module:ClassName
    if not cls:
        raise SystemExit("--adapter is mock, abtem or package.module:ClassName")
    return getattr(importlib.import_module(mod), cls)()


def main(argv=None):
    p = argparse.ArgumentParser(prog="temview-connect", description="Connect a simulator or an instrument to TEM-view (temview-connect/1).")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run a connector on this computer")
    s.add_argument("--adapter", default="mock", help="mock (test instrument), abtem, or package.module:ClassName")
    s.add_argument("--port", type=int, default=8799)
    s.add_argument("--log", default="temview-connect-audit.jsonl", help="audit log of every write and stop ('' for none)")
    s.add_argument("--token", default=None, help="pairing token (default: a new random one, printed)")
    a = p.parse_args(argv)
    from .server import serve

    srv, _ = serve(load_adapter(a.adapter), a.port, a.token, a.log or None)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
