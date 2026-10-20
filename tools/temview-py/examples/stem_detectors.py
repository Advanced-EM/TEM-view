"""STEM: the same specimen with bright-field, annular bright-field and HAADF detectors. Light oxygen columns
show in ABF; heavy Sr and Ti dominate HAADF (Z-contrast)."""
import temview as tv

tem = tv.connect()
tem.set(mode="stem", specimen="sto", kV=300, corrector=True, fov_nm=3)
for det in ("bf", "abf", "haadf"):
    tem.set(detector=det)
    s = tem.state()
    tv.show(tem.acquire(), f"{det.upper()}: {s['detector_mrad'][0]}–{s['detector_mrad'][1]} mrad")
