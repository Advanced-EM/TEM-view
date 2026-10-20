"""Quick start: change the microscope, record, and look at the data."""
import numpy as np

import temview as tv

tem = tv.connect()  # the exhibit in its IDE; headless on a desktop
print(tem.state()["mode"], "→ STEM")

tem.set(mode="stem", specimen="sto", kV=300, corrector=True, detector="haadf")
img = tem.acquire()
print(img)
print("pixel size:", round(img.calibration["pixel_A"], 3), "Å")
tv.show(img, "HAADF STEM, SrTiO3 grain boundary")

# the probe that made the image, and its width
probe = img["probe"]
row = probe[probe.shape[0] // 2]
print("probe FWHM ≈", round(np.sum(row > row.max() / 2) * img.calibration["probe_pixel_A"], 2), "Å")
tv.show(row, "probe profile")
