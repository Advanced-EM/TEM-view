#!/usr/bin/env python3
"""Summary of TEM-view usage metrics ("tem-view-usage/1", the daily usage/<year>/<day>.jsonl files).

Usage:
    python3 tools/analysis/usage.py usage/2026/*.jsonl [--csv visits.csv] [--map map.html]

Prints visits per day and per exhibit, unique visitors per day (the daily visitor key), countries and cities,
time in view, the most used modes and specimens, feature counts and devices. --csv writes one row per visit;
--map writes a self-contained HTML page with one circle per city, sized by visits (Leaflet, from a CDN).

Get the files with
    huggingface-cli download rmsreis/tem-view-usage --repo-type dataset --local-dir usage-data
Needs only the standard library.
"""
import argparse
import csv
import json
from collections import Counter, defaultdict
from statistics import median

FORMAT = "tem-view-usage/1"


def load(paths):
    visits = []
    for p in paths:
        with open(p) as f:
            for line in f:
                if line.strip():
                    v = json.loads(line)
                    if v.get("format") == FORMAT:
                        visits.append(v)
    return visits


def top(counter, n=10):
    return ", ".join(f"{k} {v}" for k, v in counter.most_common(n)) or "-"


def minutes(s):
    return f"{s / 60:.1f} min"


def summary(visits):
    days = Counter(v["started"][:10] for v in visits)
    people = defaultdict(set)
    for v in visits:
        if v.get("visitor"):
            people[v["started"][:10]].add(v["visitor"])
    print(f"{len(visits)} visits, {len(days)} days")
    for d in sorted(days):
        print(f"  {d}  {days[d]:5d} visits  {len(people[d]):5d} visitors")
    print("exhibits:", top(Counter(v["page"] for v in visits)))
    print("countries:", top(Counter(v.get("country") or "?" for v in visits), 15))
    print("cities:", top(Counter(f"{v.get('city') or '?'}, {v.get('country') or '?'}" for v in visits), 15))
    act = [v["active_s"] for v in visits]
    print(f"time in view: median {minutes(median(act))}, total {sum(act) / 3600:.1f} h")
    for page in sorted({v["page"] for v in visits}):
        dims = defaultdict(Counter)
        for v in visits:
            if v["page"] == page:
                for dim, t in v.get("time", {}).items():
                    dims[dim].update(t)
        for dim, c in dims.items():
            print(f"{page} {dim} (minutes):", ", ".join(f"{k} {s / 60:.0f}" for k, s in c.most_common(10)))
    counts = Counter()
    for v in visits:
        counts.update(v.get("counts", {}))
    print("used:", top(counts, 20))
    print("devices:", top(Counter(v.get("device") for v in visits)))
    print("inputs:", top(Counter(i for v in visits for i in v.get("inputs", []))))
    print("referrers:", top(Counter(v["referrer"] for v in visits if v.get("referrer"))))


def write_csv(visits, path):
    cols = ["started", "page", "version", "duration_s", "active_s", "country", "region", "city", "lat", "lon",
            "device", "lang", "referrer", "kiosk", "visitor"]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols + ["counts"])
        for v in visits:
            w.writerow([v.get(c) for c in cols] + [json.dumps(v.get("counts", {}))])


def write_map(visits, path):
    cities = defaultdict(lambda: [0, None, None])
    for v in visits:
        if v.get("lat") is not None:
            c = cities[f"{v.get('city') or '?'}, {v.get('country') or '?'}"]
            c[0] += 1
            c[1], c[2] = v["lat"], v["lon"]
    pts = [{"name": k, "n": n, "lat": la, "lon": lo} for k, (n, la, lo) in cities.items()]
    html = f"""<!doctype html><meta charset="utf-8"><title>TEM-view usage</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{{height:100%;margin:0}}</style><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>const P={json.dumps(pts)};const m=L.map('m').setView([30,0],2);
L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png',{{attribution:'© OpenStreetMap'}}).addTo(m);
for(const p of P)L.circleMarker([p.lat,p.lon],{{radius:4+3*Math.sqrt(p.n)}}).bindTooltip(p.name+': '+p.n+' visits').addTo(m);</script>"""
    with open(path, "w") as f:
        f.write(html)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--csv")
    ap.add_argument("--map")
    a = ap.parse_args()
    visits = load(a.files)
    if not visits:
        raise SystemExit("no tem-view-usage/1 records")
    summary(visits)
    if a.csv:
        write_csv(visits, a.csv)
    if a.map:
        write_map(visits, a.map)


if __name__ == "__main__":
    main()
