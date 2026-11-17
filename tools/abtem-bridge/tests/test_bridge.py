"""The bridge without and with abTEM: requests, specimens, conventions, the local service.
Run: pytest tools/abtem-bridge/tests (abTEM tests are skipped when abTEM is not installed)."""
import json
import math
import sys
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "tools" / "temview-py"), str(ROOT / "tools" / "abtem-bridge")]

from temview_abtem.request import RequestError, sampling_for, validate, wavelength_A  # noqa: E402
from temview_abtem.structures import build  # noqa: E402

try:
    import abtem  # noqa: F401
    HAVE_ABTEM = True
except ImportError:
    HAVE_ABTEM = False


@pytest.fixture(scope="module")
def tem():
    import temview as tv
    m = tv.connect("headless")
    yield m
    m.close()


def test_request_conventions(tem):
    """TEM-view's state arrives in abTEM's conventions."""
    tem.set(specimen="sto", mode="stem", kV=200, corrector=True, defocus_nm=-3)
    tem.aberrations(A1=(2.0, 30), B2=(50, 90), A2=(40, 10), A3=(1.0, 20), Cs_um=5)
    r = tem.abtem_request()
    o = r["optics"]
    assert r["format"] == "temview-abtem/1" and r["mode"] == "stem"
    assert o["C10"] == pytest.approx(-30)                  # nm → Å, negative = underfocus
    assert o["C30"] == pytest.approx(5e4)                  # µm → Å
    assert o["C12"] == pytest.approx(20) and o["phi12"] == pytest.approx(math.radians(30))
    assert o["C21"] == pytest.approx(3 * 500)              # Krivanek B2 = C21 / 3
    assert o["C34"] == pytest.approx(1e4)
    s = tem.state()
    assert o["semiangle_mrad"] == pytest.approx(s["convergence_mrad"])
    assert r["detector"]["outer_mrad"] == s["detector_mrad"][1]
    tem.aberrations(A1=(0, 0), B2=(0, 0), A2=(0, 0), A3=(0, 0))


def test_unsupported_states_are_refused(tem):
    from temview.transports import TemviewError
    tem.set(mode="eels")
    with pytest.raises(TemviewError, match="abTEM runs"):
        tem.abtem_request()
    tem.set(mode="tem", specimen="bio")
    with pytest.raises(TemviewError, match="structure files"):
        tem.abtem_request()
    tem.set(specimen="au")
    tem.set(kV=200)
    tem.challenge("tem-focus-stig", seed=1)
    with pytest.raises(TemviewError, match="training task"):
        tem.abtem_request()
    tem.end_challenge()


def test_validation_limits():
    base = {"format": "temview-abtem/1", "mode": "tem", "beam": {"energy_eV": 200e3},
            "specimen": {"id": "au", "fov_A": 80, "thickness_A": 50, "center_A": [0, 0]}}
    assert validate(base)["preset"] == "quick"
    for bad, msg in [({**base, "mode": "eels"}, "mode"), ({**base, "format": "x"}, "request"),
                     ({**base, "specimen": {**base["specimen"], "id": "bio"}}, "not supported"),
                     ({**base, "specimen": {**base["specimen"], "fov_A": 5000}}, "fov_A")]:
        with pytest.raises(RequestError, match=msg):
            validate(bad)
    # sampling follows the largest angle: HAADF out to 200 mrad needs ~0.04 Å at 200 kV
    r = validate({**base, "mode": "stem", "detector": {"outer_mrad": 200}, "specimen": {**base["specimen"], "fov_A": 20}})
    assert sampling_for(r) == pytest.approx((2 / 3) * wavelength_A(200e3) / (2 * 0.21), rel=1e-6)


def test_specimens_build_with_the_right_density(tem):
    rng = np.random.default_rng(0)
    tem.set(mode="tem", specimen="sto", thickness_nm=4, fov_nm=4)
    a, info = build({**tem.abtem_request()["specimen"]}, 40.0, rng)
    n_per_A3 = len(a) / (40 * 40 * 40)
    assert n_per_A3 == pytest.approx(5 / 3.905 ** 3, rel=0.1)  # perovskite: 5 atoms per cell
    tem.set(specimen="au", thickness_nm=5, fov_nm=8)
    a, info = build({**tem.abtem_request()["specimen"]}, 80.0, rng)
    syms = a.get_chemical_symbols()
    assert syms.count("Au") > 1000 and syms.count("C") > 0.08 * 80 * 80 * 50  # particles + film at ~0.1 /Å³
    tem.set(specimen="gr", mode="tem")
    req = tem.abtem_request()
    a, info = build(req["specimen"], req["specimen"]["fov_A"], rng)
    assert {"C", "Si"} <= set(a.get_chemical_symbols())  # the Si dopant came along
    assert np.ptp(a.positions[:, 2]) == pytest.approx(3.35, abs=0.01)  # two layers


@pytest.mark.skipif(not HAVE_ABTEM, reason="abTEM not installed")
def test_small_tem_simulation_and_npz(tmp_path, tem):
    from temview_abtem import simulate, write_npz
    tem.set(mode="tem", specimen="gr", kV=80, corrector=True, defocus_nm=-2, fov_nm=2)
    res = simulate(tem.abtem_request())
    img = res["arrays"]["image"]
    assert img.ndim == 2 and np.isfinite(img).all() and img.std() > 0
    p = write_npz(res, tmp_path / "r.npz")
    z = np.load(p)
    meta = json.loads(z["metadata.json"])
    assert "image" in z.files and z["image"].shape == img.shape
    assert meta["format"] == "tem-view-data/1" and meta["abtem"]["version"] and meta["request"]["mode"] == "tem"


@pytest.mark.skipif(not HAVE_ABTEM, reason="abTEM not installed")
def test_local_service_and_origins(tem):
    from temview_abtem import server
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=server._worker, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    h = json.load(urllib.request.urlopen(f"{url}/health"))
    assert h["ok"] and "tem" in h["modes"]
    # a page on another site may not use it
    req = urllib.request.Request(f"{url}/health", headers={"Origin": "https://evil.example"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req)
    assert e.value.code == 403
    tem.set(mode="tem", specimen="gr", kV=80, corrector=True, defocus_nm=-2, fov_nm=2)
    body = json.dumps(tem.abtem_request()).encode()
    post = urllib.request.Request(f"{url}/jobs", data=body, headers={"Content-Type": "application/json", "Origin": "http://localhost:8765"})
    r = urllib.request.urlopen(post)
    assert r.headers["Access-Control-Allow-Origin"] == "http://localhost:8765"
    jid = json.load(r)["id"]
    for _ in range(300):
        st = json.load(urllib.request.urlopen(f"{url}/jobs/{jid}"))
        if st["status"] in ("done", "error"):
            break
        time.sleep(0.5)
    assert st["status"] == "done", st
    data = urllib.request.urlopen(f"{url}/jobs/{jid}/result").read()
    assert data[:2] == b"PK"  # a zip (.npz)
    srv.shutdown()
