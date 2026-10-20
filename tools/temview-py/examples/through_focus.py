"""A through-focus series in TEM: how image contrast changes with defocus. Scherzer focus gives the best
phase contrast for an uncorrected lens."""
import numpy as np

import temview as tv

tem = tv.connect()
tem.set(mode="tem", specimen="au", corrector=False, fov_nm=10)
scherzer = tem.state()["scherzer_defocus_nm"]
print(f"Scherzer defocus: {scherzer} nm")

print(f"{'defocus (nm)':>13} {'contrast':>9}")
best = None
for df in range(-120, 41, 20):
    tem.set(defocus_nm=df)
    img = tem.acquire().image
    contrast = float(img.std() / img.mean())
    print(f"{df:13d} {contrast:9.3f}")
    if best is None or contrast > best[1]:
        best = (df, contrast, img)

tv.show(best[2], f"highest contrast at {best[0]} nm")
