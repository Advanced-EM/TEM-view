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


def test_lorentz_tilt_in_field_expels_the_vortex(tem):
    tem.set(mode="ltem", kV=200, magnetic_specimen="vortex", lorentz_view="phase", field_mT=0, tilt_x_deg=0)
    assert tem.acquire().calibration["magnetic_state"] == "vortex"
    tem.set(field_mT=300, tilt_x_deg=25)  # Lorentz holders tilt to ±30°; ~127 mT now lies in the plane
    assert tem.state()["tilt_deg"][0] == 25
    assert "single domain" in tem.acquire().calibration["magnetic_state"]
    tem.set(mode="tem")  # leaving the Lorentz modes brings the tilt back within ±3°
    assert abs(tem.state()["tilt_deg"][0]) <= 3
    tem.set(field_mT=0)


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


def test_megalibrary_goto_and_truth(tem):
    lay = tem.library()
    assert lay["particles"] == [1000, 1000] and lay["pitch_um"] == 1
    r = tem.goto(123, 456)
    assert tem.state()["specimen"] == "lib" and r["nearest_particle"] == [123, 456]
    t = tem.particle(123, 456)
    assert 15 <= t["diameter_nm"] <= 25 and abs(sum(t["composition"].values()) - 1) < 1e-3
    # centre on the true particle: EDS sees its elements, and only its elements among the metals
    s = tem.state()["stage_um"]
    tem.move(dx_nm=(t["center_um"][0] - s[0]) * 1000, dy_nm=(t["center_um"][1] - s[1]) * 1000)
    tem.set(mode="eds", fov_nm=40)
    a = tem.acquire()
    metals = {k[4:] for k in a.arrays if k.startswith("map_")} - {"Si", "N"}
    assert metals == set(t["composition"]) if t["present"] else metals == set()
    with pytest.raises(TemviewError, match="outside the library"):
        tem.goto(1000, 0)


def test_load_xyz(tem):
    xyz = "4\ntest\nAu 0 0 0\nAu 2.04 2.04 0\nPd 2.04 0 2.04\nO 0 2.04 2.04\n"
    r = tem.load_xyz(xyz, "tiny.xyz")
    assert r["atoms"] == 4 and set(r["elements"]) == {"Au", "Pd", "O"}
    assert tem.state()["specimen"] == "xyz"
    tem.set(mode="eds", fov_nm=3)
    a = tem.acquire()
    assert {"map_Au", "map_Pd", "map_O"} <= set(a.arrays)
    with pytest.raises(TemviewError, match="not an XYZ file"):
        tem.load_xyz("hello\nworld\n")


def test_footprint_matches_hand_calculation(tem):
    tem.set(specimen="sto", mode="4d", fov_nm=5, dose=400)
    f = tem.footprint(scan=256, det=256, bits=16, dwell_us=1000)
    assert f["technique"] == "4d" and f["raw_bytes"] == 256**4 * 2
    assert abs(f["acquire_s"] - 65.536) < 1e-9
    assert f["tier"] in ("gpu", "hpc") and "browser budget" in f["tier_reason"]
    # the same numbers the export metadata carries, once the plan is applied
    tem.footprint(scan=64, det=64, analysis="ptycho", apply=True)
    acq = tem.acquire(steps=5)
    fp = acq.meta["footprint"]
    assert fp["plan"]["scan"] == 64 and fp["raw_bytes"] == 64**4 * 2 and fp["tier"] == "browser"
    assert tem.footprint(technique="tem")["shape"] == [4096, 4096]
    with pytest.raises(TemviewError):
        tem.footprint(technique="tem", scan=256)


def test_structure_and_tilted_thickness(tem):
    tem.set(specimen="sto", mode="tem", tilt_x_deg=0, tilt_y_deg=0)
    s = tem.structure()
    assert s["formula"].endswith("SrTiO₃") and s["atoms_in_view"] > 1000 and s["kind"] == "atoms"
    assert abs(s["thickness_nm"] - s["flat_thickness_nm"]) < 1e-9
    tem.set(tilt_x_deg=20)
    t = tem.structure()
    import math
    a, b = (math.radians(v) for v in t["tilt_deg"])  # the tilt actually applied (atomic specimens stop at ±3°)
    assert a > 0 and abs(t["thickness_nm"] - t["flat_thickness_nm"] / (math.cos(a) * math.cos(b))) < 1e-3
    assert abs(tem.footprint()["thickness_nm"] - t["thickness_nm"]) < 1e-3  # the estimator uses the same path
    tem.set(tilt_x_deg=0)


def test_eels_msa_opens_in_hyperspy(tem, tmp_path):
    hs = pytest.importorskip("hyperspy.api")
    tem.set(specimen="sto", mode="eels", eels_offset_eV=400, eels_dispersion=0.25, eels_beta_mrad=30, dual_eels=False)
    path = str(tmp_path / "sto.msa")
    tem.save_msa(path)
    s = hs.load(path)
    ax = s.axes_manager.signal_axes[0]
    assert ax.units == "eV" and abs(ax.scale - 0.25) < 1e-9 and abs(ax.offset - 400.125) < 1e-6 and ax.size == 2048
    assert s.metadata.Signal.signal_type == "EELS"
    tem_md = s.metadata.Acquisition_instrument.TEM
    assert tem_md.beam_energy == 200 and abs(tem_md.Detector.EELS.collection_angle - 30) < 1e-9
    a = tem.analyze("fit_edge")
    assert 2 < a["result"]["r"] < 5 and a["result"]["S_over_N"] > 0


def test_orientation_map_finds_the_sto_grains(tem):
    tem.set(specimen="sto", mode="4d", convergence_mrad=3, precession_mrad=0)
    tem.acquire()
    a = tem.analyze("map_orientation")
    grains = sorted(g["omega_deg"] for g in a["result"]["grains"])
    assert len(grains) == 2 and abs(grains[0] - 18.43) < 2 and abs(grains[1] - 71.57) < 2
    assert a["result"]["phase_fraction"]["crystal"] > 0.9


def test_other_zone_axis(tem):
    tem.set(specimen="sto", mode="diff", zone_axis=[0, 1, 1])
    s = tem.structure()
    assert "[011]" in s["name"] and s["kind"] == "atoms"
    a = tem.analyze("fit_lattice")
    d = [x["d_A"] for x in a["result"]["spacings"]]
    # (11-1) at 2.25 Å lies in the [011] zone but not in the as-built [001] one
    assert any(abs(v - 2.255) < 0.05 for v in d) and any(abs(v - 2.761) < 0.05 for v in d)
    tem.set(zone_axis=None)
    assert "[011]" not in tem.structure()["name"]


def test_3d_ed_completeness(tem):
    tem.set(specimen="sto", mode="ed3d", zone_axis=[1, 2, 5], ed_range_deg=[-45, 45], ed_merge="friedel")
    acq = tem.acquire(steps=5)
    assert acq.meta["calibration"]["frames"] > 10 and "reflections" in acq.arrays
    a = tem.analyze("ed3d_stats")
    assert abs(a["result"]["completeness"] - 0.5) < 0.06  # Friedel pairs only: Φ / 180°
    tem.set(ed_merge="laue")
    assert tem.analyze("ed3d_stats")["result"]["completeness"] > 0.95  # cubic symmetry fills the rest
    tem.set(zone_axis=None)


def test_tomography_series_and_reconstruction():
    tem = tv.connect("headless")
    tem.set(mode="tomo", specimen="au", tomo_object="beads", tomo_volume=64, tomo_max_tilt_deg=60, tomo_dose=1e7)
    acq = tem.acquire()
    assert acq["tilt_series"].shape == (61, 64, 64)
    assert acq["reconstruction"].shape == (64, 64, 64)
    a = tem.analyze("tomo_stats")
    r = a["result"]
    assert r["projections"] == 61 and r["max_tilt_deg"] == 60
    assert abs(r["elongation_predicted"] - 1.552) < 0.01
    assert abs(r["elongation_measured"] / r["elongation_predicted"] - 1) < 0.15


def test_single_particle_cryo_em():
    tem = tv.connect("headless")
    tem.set(mode="spa", specimen="bio", holder="ln2", spa_particles=300, spa_dose=40)
    acq = tem.acquire()
    assert acq["micrograph"].shape == (512, 512)
    assert acq["half1"].shape == (64, 64, 64) and acq["half2"].shape == (64, 64, 64)
    r = tem.analyze("spa_stats")["result"]
    assert r["particles"] == 300 and r["kept"] > 250
    assert 6 < r["resolution_A"] < 40
    assert r["picking"]["recall"] > 0.5


def test_ptychographic_tomography_preview():
    tem = tv.connect("headless")
    tem.set(mode="ptychotomo", pt_tilts=3, pt_iterations=3)
    acq = tem.acquire()
    assert acq["fused"].shape == (64, 64, 64) and acq["single_tilt"].shape == (64, 64, 64)
    r = tem.analyze("ptychotomo_stats")["result"]
    assert r["tilts"] == 3
    assert r["depth_fwhm_fused_A"] < r["depth_fwhm_single_A"]
