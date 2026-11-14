#!/usr/bin/env python3
"""Electron Explorer kiosk totals: pull the anonymous daily totals that museum kiosks share, and summarize them.

Kiosks whose staff turned on "Send the daily totals" post them to the collector Worker (/kiosk), which keeps the
latest totals per kiosk and day in its D1 database and commits a snapshot each night to the private usage dataset
as kiosk/kiosk_days.jsonl.

Usage:
    python3 tools/analysis/kiosks.py --hf                        # the nightly snapshot from Hugging Face
    python3 tools/analysis/kiosks.py --d1                        # live, from the collector's database
    python3 tools/analysis/kiosks.py kiosk_days.jsonl            # a file you downloaded
  options:
    --site "Science Center"   keep kiosks whose name contains this (repeatable); --kiosk <id prefix> likewise
    --since 2026-11-01 --until 2026-11-30
    --json report.json        write the totals in the format kids/report.html reads ("Add another kiosk's data"),
                              one file for all selected kiosks
    --csv kiosk-days.csv      one row per kiosk and day

--hf needs `pip install huggingface_hub` and a token with read access to the dataset (`hf auth login`, or
HF_TOKEN). --d1 runs wrangler from hf/worker and needs `npm ci` and `npx wrangler login` there. Otherwise only the
standard library is used.
"""
import argparse
import csv
import json
import os
import subprocess
import sys
from collections import defaultdict

REPO = os.environ.get("TEMVIEW_USAGE_REPO", "rmsreis/tem-view-usage")
WORKER = os.environ.get("TEMVIEW_WORKER") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "hf", "worker")


def from_lines(lines):
    return [json.loads(l) for l in lines if l.strip()]


def load_hf():
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        raise SystemExit("pip install huggingface_hub (and `hf auth login`), or download kiosk/kiosk_days.jsonl yourself")
    path = hf_hub_download(REPO, "kiosk/kiosk_days.jsonl", repo_type="dataset", force_download=True)
    with open(path) as f:
        return from_lines(f)


def load_d1():
    sql = "SELECT kiosk, day, site, version, place, totals, updated FROM kiosk_days ORDER BY kiosk, day"
    r = subprocess.run(["npx", "wrangler", "d1", "execute", "tem-view-usage", "--remote", "--json", "--command", sql],
                       cwd=WORKER, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"wrangler failed (run `npm ci` and `npx wrangler login` in {WORKER}):\n{r.stderr or r.stdout}")
    rows = json.loads(r.stdout)[0]["results"]
    return [{"kiosk": x["kiosk"], "day": x["day"], "site": x["site"], "version": x["version"], "updated": x["updated"],
             "place": json.loads(x["place"] or "{}"), "totals": json.loads(x["totals"])} for x in rows]


def add(into, d):
    # the same rule as kids/visits.js: numbers add, lists add by position, objects add by key
    for k, v in d.items():
        if isinstance(v, (int, float)):
            into[k] = into.get(k, 0) + v
        elif isinstance(v, list):
            cur = into.setdefault(k, [0] * len(v))
            for i, x in enumerate(v):
                cur[i] += x
        elif isinstance(v, dict):
            cur = into.setdefault(k, {})
            for kk, x in v.items():
                cur[kk] = cur.get(kk, 0) + x
    return into


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*")
    ap.add_argument("--hf", action="store_true"); ap.add_argument("--d1", action="store_true")
    ap.add_argument("--site", action="append", default=[]); ap.add_argument("--kiosk", action="append", default=[])
    ap.add_argument("--since"); ap.add_argument("--until")
    ap.add_argument("--json"); ap.add_argument("--csv")
    a = ap.parse_args()
    rows = load_hf() if a.hf else load_d1() if a.d1 else [r for p in a.files for r in from_lines(open(p))]
    if not rows:
        raise SystemExit("no kiosk totals (give a file, --hf or --d1)")
    keep = lambda r: ((not a.site or any(s.lower() in (r.get("site") or "").lower() for s in a.site))
                      and (not a.kiosk or any(r["kiosk"].startswith(k) or r["kiosk"].startswith(f"kiosk-{k}") for k in a.kiosk))
                      and (not a.since or r["day"] >= a.since) and (not a.until or r["day"] <= a.until))
    rows = [r for r in rows if keep(r)]
    if not rows:
        raise SystemExit("nothing matches those filters")

    # per kiosk
    kiosks = defaultdict(lambda: {"days": 0, "t": {}, "site": "", "place": {}, "first": None, "last": None, "updated": ""})
    for r in rows:
        k = kiosks[r["kiosk"]]; t = r["totals"]
        k["days"] += 1; add(k["t"], t); k["site"] = r.get("site") or k["site"]; k["place"] = r.get("place") or k["place"]
        k["first"] = min(filter(None, [k["first"], r["day"]])); k["last"] = max(filter(None, [k["last"], r["day"]])); k["updated"] = max(k["updated"], r.get("updated") or "")
    print(f"{len(kiosks)} kiosks, {len(rows)} kiosk-days, {rows[0]['day'] if rows else ''}…\n")
    print(f"{'kiosk':10} {'name':28} {'place':24} {'days':>5} {'visits':>7} {'engaged':>8} {'avg stay':>9} {'missions':>9}  last report")
    total = {}
    for kid, k in sorted(kiosks.items(), key=lambda kv: -kv[1]["t"].get("sessions", 0)):
        t = k["t"]; n = t.get("sessions", 0); add(total, t)
        place = ", ".join(x for x in [k["place"].get("city"), k["place"].get("country")] if x)
        eng = f"{round(100 * t['engaged'] / n)} %" if n and "engaged" in t else "—"
        print(f"{kid[6:14]:10} {k['site'][:28]:28} {place[:24]:24} {k['days']:>5} {n:>7} {eng:>8} {round(t.get('dwell', 0) / max(1, n)):>7} s {sum(t.get('missions', {}).values()):>9}  {k['updated'][:16]}")
    n = total.get("sessions", 0)
    print(f"\nall: {n} visits, {total.get('dwell', 0) / 3600:.1f} h exploring, {sum(total.get('missions', {}).values())} missions, "
          f"{total.get('snaps', 0)} pictures, {total.get('prints', 0)} stickers; languages "
          + ", ".join(f"{l} {v}" for l, v in sorted(total.get("langs", {}).items(), key=lambda kv: -kv[1])))

    if a.json:
        days = defaultdict(dict)
        for r in rows:
            add(days[r["day"]], r["totals"])
        sites = sorted({k["site"] or kid[6:14] for kid, k in kiosks.items()})
        json.dump({"format": "electron-explorer-visits/1", "site": " + ".join(sites), "exported": max(r["day"] for r in rows), "days": days}, open(a.json, "w"), indent=1)
        print(f"wrote {a.json}: open kids/report.html, then \"Add another kiosk's data\"")
    if a.csv:
        with open(a.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["kiosk", "site", "city", "country", "day", "visits", "engaged", "total_seconds", "missions", "finished_all", "pictures", "stickers", "qr", "languages", "samples"])
            for r in rows:
                t, p = r["totals"], r.get("place") or {}
                w.writerow([r["kiosk"], r.get("site", ""), p.get("city", ""), p.get("country", ""), r["day"], t.get("sessions", 0), t.get("engaged", ""), t.get("dwell", 0),
                            sum(t.get("missions", {}).values()), t.get("allMissions", 0), t.get("snaps", 0), t.get("prints", 0), t.get("qr", 0),
                            " ".join(f"{k}:{v}" for k, v in t.get("langs", {}).items()), " ".join(f"{k}:{v}" for k, v in t.get("samples", {}).items())])
        print(f"wrote {a.csv}")


if __name__ == "__main__":
    sys.exit(main())
