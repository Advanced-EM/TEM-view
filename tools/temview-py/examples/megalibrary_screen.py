"""High-throughput, multimodal screen of a nanoparticle megalibrary, scored against the true particles.

The megalibrary (specimen "lib") holds 1000 × 1000 alloy particles, 15–25 nm across, on a 1 µm grid: a
10 × 10 array of pens each wrote a 100 × 100 block, with the ink composition (Au, Ag, Cu, Co, Ni) changing
across the pens and the dot size along each block. For each particle chosen, the script does what an
automated microscope would:

  1. drive the stage to the particle's grid node and find it in a 120 nm HAADF survey (the stage misses by
     tens of nm, and each particle sits up to ~60 nm off its node), then re-centre on it;
  2. HAADF at 40 nm: size and elongation from the projected outline;
  3. EDS: composition from background-subtracted line intensities, and from the element maps whether the
     noble metals (Au, Ag, Cu) and Co–Ni segregate into a heterostructure;
  4. diffraction: d-spacings of any reflections, indexed to the fcc lattice parameter that best agrees with
     the composition (Vegard's law) — the same spacing can be Au 200 or Ni 111, so it needs the EDS.

Then it asks the simulator for the true particles (particle(i, j)) and reports the errors. It runs headless
on a desktop (python megalibrary_screen.py --n 10), against an open exhibit, or in the exhibit's IDE.
"""
import csv
import math
import sys

import numpy as np

import temview as tv

N = 6  # particles per side of the sample: N × N spread across the library (10 → one per pen block)
if "--n" in sys.argv:
    N = int(sys.argv[sys.argv.index("--n") + 1])
REALISTIC = "--clean" not in sys.argv  # stage errors and shot noise unless --clean

tem = tv.connect()
lib = tem.library()
ELS = lib["elements"]
A0 = {"Au": 4.078, "Ag": 4.086, "Cu": 3.615, "Co": 3.544, "Ni": 3.524}  # fcc lattice parameters, Å
# X-ray line families above 1.5 keV: (energy keV, relative weight). The per-element yields play the role of
# k-factors, which a real instrument gets from standards.
LINES = {
    "Au": [(2.123, 0.55), (9.713, 1), (11.442, 0.62), (13.381, 0.1)], "Ag": [(2.984, 1), (3.151, 0.55)],
    "Cu": [(8.048, 1), (8.905, 0.13)], "Co": [(6.930, 1), (7.649, 0.13)], "Ni": [(7.478, 1), (8.265, 0.13)],
    "Si": [(1.74, 1), (1.836, 0.03)],
}
YIELD = {"Au": 1.0, "Ag": 0.95, "Cu": 1.0, "Co": 1.0, "Ni": 1.0, "Si": 1.0}


def fwhm_keV(E):
    """Detector resolution: 128 eV at Mn Kα, Fano-limited."""
    return math.sqrt(2087 + 2.4237 * E * 1000) / 1000


def det_eff(E):
    """Detector efficiency: window absorption at low energy, a thin sensor at high energy."""
    return np.exp(-((0.35 / E) ** 2)) * np.exp(-E / 40)


def smooth(img):
    p = np.pad(img, 1, mode="edge")
    return sum(p[dy:dy + img.shape[0], dx:dx + img.shape[1]] for dy in range(3) for dx in range(3)) / 9


def blob(img, frac=0.2):
    """Pixels of the particle: above frac of the way from the background to the peak (after a light smooth)."""
    img = smooth(img)
    bg, pk = np.percentile(img, 30), np.percentile(img, 99.8)
    m = img > bg + frac * (pk - bg)
    return m if m.sum() > 4 else None


def centre(img, pix_nm):
    """Offset (nm) of the particle from the image centre, or None if nothing stands out."""
    m = blob(img)
    if m is None or img[m].mean() < np.percentile(img, 50) * 1.5:
        return None
    ys, xs = np.nonzero(m)
    w = img[ys, xs] - np.percentile(img, 30)
    n = img.shape[0]
    return ((np.average(xs, weights=w) + 0.5 - n / 2) * pix_nm, (np.average(ys, weights=w) + 0.5 - n / 2) * pix_nm)


def find_particle():
    """Survey at 120 nm, re-centre, and repeat once more closely. False if the field is empty."""
    for fov in (120, 60):
        tem.set(mode="stem", detector="haadf", fov_nm=fov)
        a = tem.acquire()
        c = centre(a.image, a.calibration["pixel_A"] / 10)
        if c is None:
            return False
        tem.move(dx_nm=c[0], dy_nm=c[1])
    return True


def size_shape():
    tem.set(mode="stem", fov_nm=40)
    a = tem.acquire()
    m = blob(a.image)
    pix = a.calibration["pixel_A"] / 10
    ys, xs = np.nonzero(m)
    d = 2 * math.sqrt(m.sum() / math.pi) * pix  # equivalent diameter
    ev = np.linalg.eigvalsh(np.cov(np.vstack([xs, ys])))
    return d, math.sqrt(ev[1] / max(ev[0], 1e-9))


def composition():
    tem.set(mode="eds", fov_nm=40)
    a = tem.acquire(steps=200)  # 10 s live time
    sp = a["spectrum"].astype(float)
    E = (np.arange(len(sp)) + 0.5) * a.calibration["energy_keV_per_bin"]
    # multiple linear least squares, weighted by the Poisson noise: each element's whole line family
    # (Gaussians at the detector resolution) plus a Kramers-law continuum, (E0 − E)/E, over 1.5–14 keV.
    # Elements not detected at 3σ are dropped and the fit repeated.
    E0, fit = tem.state()["kV"], (E > 1.5) & (E < 14)
    cols = {el: sum(w * det_eff(e) * np.exp(-0.5 * ((E - e) / (fwhm_keV(e) / 2.355)) ** 2) for e, w in L) for el, L in LINES.items()}
    cont = [(E0 - E) / E * det_eff(E)]
    wt = 1 / np.sqrt(np.maximum(sp[fit], 1))
    use = list(cols)
    while True:
        X = np.column_stack([cols[el] for el in use] + cont)[fit]
        c = np.linalg.lstsq(X * wt[:, None], sp[fit] * wt, rcond=None)[0]
        sig = np.sqrt(np.diag(np.linalg.inv((X * wt[:, None]).T @ (X * wt[:, None]))))
        weak = [el for el, v, e in zip(use, c, sig) if v < 3 * e]
        if not weak:
            break
        use = [el for el in use if el not in weak]
    raw = {el: v / YIELD[el] for el, v in zip(use, c) if el in ELS}
    tot = sum(raw.values()) or 1
    comp = {el: v / tot for el, v in raw.items() if v / tot >= 0.02}
    t = sum(comp.values()) or 1
    comp = {el: v / t for el, v in comp.items()}
    # segregation: do the noble-metal and Co–Ni maps have different centres?
    def cen(els):
        m = sum((a[f"map_{e}"] for e in els if f"map_{e}" in a.arrays), np.zeros(a.image.shape if a.image.ndim == 2 else (128, 128)))
        if m.sum() <= 0:
            return None
        ys, xs = np.indices(m.shape)
        return np.array([np.average(xs, weights=m), np.average(ys, weights=m)])
    cn, cm = cen(["Au", "Ag", "Cu"]), cen(["Co", "Ni"])
    sep = float(np.hypot(*(cn - cm))) * a.calibration["map_pixel_A"] / 10 if cn is not None and cm is not None else 0.0
    return comp, sep


def lattice(comp):
    """fcc lattice parameter from the diffraction spots, choosing the indexing nearest Vegard's law."""
    tem.set(mode="diff")
    a = tem.acquire()
    p, kpx = a.image.astype(float), a.calibration["k_per_px_invA"]
    n = p.shape[0]
    yy, xx = np.indices(p.shape)
    k = np.hypot(xx + 0.5 - n / 2, yy + 0.5 - n / 2) * kpx
    ring = (k > 0.35) & (k < 0.75)
    if not ring.any():
        return float("nan")
    thr = np.median(p[ring]) + 12 * p[ring].std() / max(1, math.sqrt(ring.sum()) / 30)
    peaks = []
    for y, x in zip(*np.nonzero(ring & (p > thr))):
        if p[y, x] == p[max(0, y - 2):y + 3, max(0, x - 2):x + 3].max():
            peaks.append(k[y, x])
    if not peaks:
        return float("nan")
    guess = sum(A0[e] * f for e, f in comp.items()) or 3.8
    best = None
    for kk in peaks:
        for s in (3, 4, 8, 11):  # 111, 200, 220, 311
            aa = math.sqrt(s) / kk
            if best is None or abs(aa - guess) < abs(best - guess):
                best = aa
    return best


rows = []
step = lib["particles"][0] // N
for gj in range(N):
    for gi in range(N):
        i, j = gi * step + step // 2, gj * step + step // 2
        tem.goto(i, j)
        if not REALISTIC:
            tem.set(realistic=False)
        found = find_particle()
        row = {"i": i, "j": j, "found": found}
        if found:
            row["d_nm"], row["aspect"] = size_shape()
            comp, sep = composition()
            row.update({f"x_{e}": round(comp.get(e, 0.0), 4) for e in ELS})
            row["segregated"] = sep > 2.0
            row["a_A"] = lattice(comp)
        t = tem.particle(i, j)
        row.update({"true_present": t["present"], "true_d_nm": t["diameter_nm"], "true_phase": t["phase"], "true_a_A": t["lattice_A"]})
        row.update({f"true_x_{e}": t["composition"].get(e, 0.0) for e in ELS})
        rows.append(row)
        print(f"({i:3d},{j:3d}) " + (f"d {row['d_nm']:.1f} nm (true {t['diameter_nm']}), " + " ".join(f"{e} {row['x_' + e]:.2f}/{t['composition'].get(e, 0):.2f}" for e in ELS if row['x_' + e] or t['composition'].get(e)) + f", {'segregated' if row['segregated'] else 'single'} ({t['phase']})" if found else f"no particle found (present: {t['present']})"))

# ------------------------------------------------------------------ how well did the screen do?
ok = [r for r in rows if r["found"] and r["true_present"]]
if ok:
    comp_err = np.mean([abs(r[f"x_{e}"] - r[f"true_x_{e}"]) for r in ok for e in ELS]) * 100
    size_err = np.mean([abs(r["d_nm"] - r["true_d_nm"]) for r in ok])
    phase_ok = np.mean([r["segregated"] == (r["true_phase"] == "heterostructure") for r in ok]) * 100
    la = [r for r in ok if not math.isnan(r["a_A"])]
    print(f"\n{len(ok)}/{len(rows)} particles measured. Composition error {comp_err:.1f} at.% per element; size error {size_err:.1f} nm; "
          f"heterostructures recognized correctly in {phase_ok:.0f} %; lattice parameter from {len(la)} patterns"
          + (f", error {np.mean([abs(r['a_A'] - r['true_a_A']) for r in la]):.3f} Å." if la else "."))
if not tv.in_browser():
    with open("megalibrary_screen.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) + [k for k in ("d_nm", "aspect", "segregated", "a_A") if k not in rows[0]] + [f"x_{e}" for e in ELS if f"x_{e}" not in rows[0]])
        w.writeheader()
        w.writerows(rows)
    print("Results in megalibrary_screen.csv")
