"""temview-abtem: serve TEM-view's requests, or run one from a file.

    temview-abtem serve [--port 8797]
    temview-abtem run request.json [-o result.npz]
"""
import argparse
import json
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(prog="temview-abtem", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="local service for the exhibit")
    s.add_argument("--port", type=int, default=8797)
    r = sub.add_parser("run", help="run one request file")
    r.add_argument("request")
    r.add_argument("-o", "--out")
    r.add_argument("--preset", choices=["quick", "standard", "full"])
    a = ap.parse_args(argv)
    if a.cmd == "serve":
        from .server import serve
        serve(a.port)
        return
    from .simulate import simulate, write_npz
    req = json.load(open(a.request))
    if a.preset:
        req["preset"] = a.preset
    res = simulate(req, progress=lambda m: print(m, file=sys.stderr))
    out = a.out or a.request.rsplit(".", 1)[0] + ".abtem.npz"
    write_npz(res, out)
    print(f"wrote {out}: {', '.join(f'{k} {v.shape}' for k, v in res['arrays'].items())} in {res['meta']['abtem']['seconds']} s")


if __name__ == "__main__":
    main()
