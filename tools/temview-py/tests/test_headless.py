"""Headless backend: the same calls a script makes in the exhibit. Run: pytest tools/temview-py/tests"""
import numpy as np
import pytest

import temview as tv
from temview.transports import TemviewError


@pytest.fixture(scope="module")
def tem():
    m = tv.connect("headless")
    yield m
    m.close()


def test_info_lists_the_instrument(tem):
    i = tem.info()
    assert i["api"] == 1 and i["backend"] == "headless"
    assert "stem" in i["modes"] and "gr" in i["specimens"] and "fit_ctf" in i["analyses"]
    assert {c["id"] for c in i["challenges"]} == {"tem-focus-stig", "corrector-ronch"}


def test_set_and_state(tem):
    done = tem.set(specimen="sto", mode="stem", kV=300, detector="haadf", defocus_nm=-2)
    assert any("STEM" in d for d in done)
    s = tem.state()
    assert (s["mode"], s["specimen"], s["kV"], s["defocus_nm"]) == ("stem", "sto", 300, -2)
    assert s["detector_mrad"][0] >= 60  # HAADF inner angle


def test_unknown_setting_is_refused(tem):
    with pytest.raises(TemviewError, match="unknown setting"):
        tem.set(focus=3)


def test_acquire_returns_calibrated_arrays(tem):
    tem.set(mode="tem", specimen="au", fov_nm=10)
    a = tem.acquire()
    assert a.image.ndim == 2 and a.image.dtype == np.float32 and np.isfinite(a.image).all()
    assert a.calibration["pixel_A"] > 0
    assert "diffractogram" in a.arrays


def test_command_grammar(tem):
    r = tem.command("defocus minus 40")
    assert r["understood"] and tem.state()["defocus_nm"] == -40
    assert tem.command("make the beam purple")["understood"] is False


def test_aberrations(tem):
    tem.set(corrector=True)
    ab = tem.aberrations(A1=(3, 45), B2=(50, 10))
    assert ab["A1"] == 3 and ab["A1a"] == 45 and ab["B2"] == 50
    tem.aberrations(A1=(0, 0), B2=(0, 0))


def test_analysis_matches_truth(tem):
    tem.set(mode="tem", specimen="au", corrector=False, fov_nm=20, defocus_nm=-80)
    r = tem.analyze("fit_ctf")["result"]
    assert abs(r["defocus_nm"] + 80) < 5


def test_challenge_is_scored_from_hidden_truth(tem):
    c = tem.challenge("tem-focus-stig", seed=4)
    assert c["seed"] == 4 and "Scherzer" in c["task"]
    assert tem.score()["success"] is False  # misaligned at the start
    hidden = tem.reveal()["hidden"]
    assert hidden["A1"] > 0
    tem.end_challenge()
    assert tem.state()["challenge"] is None


def test_same_seed_same_challenge(tem):
    a = tem.challenge("corrector-ronch", seed=11)["target"]
    h1 = tem.reveal()["hidden"]
    tem.challenge("corrector-ronch", seed=11)
    assert tem.reveal()["hidden"] == h1 and a["flat_mrad"] == 30
    tem.end_challenge()


def test_end_challenge_restores_the_instrument(tem):
    tem.set(mode="stem", specimen="sto", kV=300, defocus_nm=0)
    before = {k: tem.state()[k] for k in ("mode", "specimen", "kV", "aberrations", "defocus_nm")}
    tem.challenge("tem-focus-stig", seed=2)
    tem.aberrations(A1=(20, 10))
    tem.set(defocus_nm=-100)
    tem.end_challenge()
    assert {k: tem.state()[k] for k in before} == before


# ------------------------------------------------------------------ Lorentz microscopy (js/lorentz.js)
def _vortex_core(img):
    n = img.shape[0]
    c = img[n // 2 - 2:n // 2 + 3, n // 2 - 2:n // 2 + 3].mean()
    return c / img.mean()


def test_lorentz_deflection_and_fresnel_reversal(tem):
    tem.set(mode="ltem", kV=200, magnetic_specimen="vortex", film_thickness_nm=30, lorentz_view="fresnel", lorentz_defocus_um=-400)
    a = tem.acquire()
    # β = e·B·t·λ/h ≈ 18 µrad for 30 nm of permalloy (1 T) at 200 kV
    assert a.calibration["lorentz_deflection_urad"] == pytest.approx(18.2, rel=0.03)
    under = _vortex_core(a["image"])
    tem.set(lorentz_defocus_um=400)
    over = _vortex_core(tem.acquire()["image"])
    assert (under - 1) * (over - 1) < 0, "the vortex core must reverse contrast through focus"


def test_lorentz_tie_recovers_the_vortex_rotation(tem):
    tem.set(mode="ltem", magnetic_specimen="vortex", lorentz_view="tie", lorentz_defocus_um=-400)
    a = tem.acquire()
    bx, by = a["induction_x"], a["induction_y"]
    n = bx.shape[0]
    y, x = np.mgrid[0:n, 0:n] - n / 2 + 0.5
    r = np.hypot(x, y)
    ring = (r > n * 0.08) & (r < n * 0.22)
    # curl sense of the recovered induction: positive = counter-clockwise (the default chirality +1)
    curl = np.mean((x * by - y * bx)[ring] / r[ring])
    assert curl > 0


def test_lorentz_fege_phase_diagram(tem):
    tem.set(mode="ltem", magnetic_specimen="fege", holder="room", lorentz_view="phase")
    assert tem.acquire().calibration["magnetic_state"] == "paramagnetic"  # 293 K > Tc = 278 K
    tem.set(holder="ln2", temperature_K=250)
    tem.step(400)  # let the holder reach the setpoint
    states = {}
    for B in (0, 60, 400):
        tem.set(field_mT=B)
        states[B] = tem.acquire().calibration["magnetic_state"]
    assert states == {0: "helical", 60: "skyrmion lattice", 400: "field-polarized"}
    tem.set(holder="room", field_mT=0)


def test_lorentz_stem_dpc_saturates_with_a_small_probe_angle(tem):
    tem.set(mode="lstem", kV=200, magnetic_specimen="vortex", probe_urad=300)
    weak = tem.acquire()
    tem.set(probe_urad=20)
    strong = tem.acquire()
    # inside the disc (away from the edge, where the electrostatic phase gradient deflects strongly too):
    # 20 µrad, the 18 µrad deflection fills the bright-field disc (signal near ±1); 300 µrad, a few per cent
    n = weak["dpc_x"].shape[0]
    y, x = np.mgrid[0:n, 0:n] - n / 2 + 0.5
    r = np.hypot(x, y)
    inside = (r > n * 0.08) & (r < n * 0.22)
    mag = lambda a: np.median(np.hypot(a["dpc_x"], a["dpc_y"])[inside])
    assert mag(strong) > 0.9 and mag(weak) < 0.15
    assert strong.calibration["probe_fwhm_A"] > weak.calibration["probe_fwhm_A"]
    tem.set(mode="tem")
