"""temview-connect/1 against the test instrument: describe, pairing, limits, driving, acquiring, stop, origins."""
import json
import threading
import urllib.error
import urllib.request

import pytest

from temview_connect import Client, serve
from temview_connect.adapters.mock import MockInstrument
from temview_connect.client import ConnectError


@pytest.fixture()
def conn(tmp_path):
    log = tmp_path / "audit.jsonl"
    srv, svc = serve(MockInstrument(speed=50), 0, token="secret", log_path=str(log))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    yield url, log
    srv.shutdown()


def test_describe(conn):
    d = Client(conn[0]).describe()
    assert d["format"] == "temview-connect/1" and d["kind"] == "instrument" and d["armed"]
    assert d["controls"]["defocus_nm"]["writable"] and not d["controls"]["ht_kV"]["writable"]
    assert d["controls"]["stage_x_nm"]["max_step"] == 20000


def test_driving_needs_the_token(conn):
    with pytest.raises(ConnectError, match="401"):
        Client(conn[0]).set(defocus_nm=-50)
    with pytest.raises(ConnectError, match="401"):
        Client(conn[0], token="wrong").set(defocus_nm=-50)
    assert Client(conn[0], token="secret").set(defocus_nm=-50)["defocus_nm"] == -50


def test_limits_are_refused_not_clamped(conn):
    c = Client(conn[0], token="secret")
    with pytest.raises(ConnectError, match="outside"):
        c.set(tilt_alpha_deg=45)
    with pytest.raises(ConnectError, match="read-only"):
        c.set(ht_kV=300)
    with pytest.raises(ConnectError, match="at most"):
        c.set(stage_x_nm=50_000)  # one jump larger than the allowed step
    with pytest.raises(ConnectError, match="one of"):
        c.set(objective_aperture="5")
    with pytest.raises(ConnectError, match="not a control"):
        c.set(gun_extraction_V=4000)
    assert c.state()["tilt_alpha_deg"] == 0  # nothing moved


def test_acquire_and_stop(conn):
    url, log = conn
    c = Client(url, token="secret")
    with pytest.raises(ConnectError, match="blanked"):
        c.run({"kind": "acquire", "mode": "tem", "exposure_s": 0.1})
    c.set(beam_blanked=False, defocus_nm=-20, fov_nm=10)
    out = c.run({"kind": "acquire", "mode": "tem", "exposure_s": 0.1, "pixels": 64})
    assert out["image"].shape == (64, 64) and out["meta"]["state"]["defocus_nm"] == -20
    with pytest.raises(ConnectError, match="401"):
        Client(url).run({"kind": "acquire", "mode": "tem"})
    with pytest.raises(ConnectError, match="not available"):
        c.run({"kind": "acquire", "mode": "eels"})
    assert Client(url).stop()["state"]["beam_blanked"] is True  # stop needs no token
    events = [json.loads(l)["event"] for l in log.read_text().splitlines()]
    assert "set" in events and "refused" in events and "stop" in events


def test_foreign_origins_are_refused(conn):
    r = urllib.request.Request(conn[0] + "/describe", headers={"Origin": "https://evil.example"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(r)
    assert e.value.code == 403
    r = urllib.request.Request(conn[0] + "/describe", headers={"Origin": "http://localhost:8765"})
    with urllib.request.urlopen(r) as f:
        assert f.headers["Access-Control-Allow-Origin"] == "http://localhost:8765"


def test_abtem_as_a_simulator(tmp_path):
    """abTEM through the same protocol: a small graphene TEM image from the headless microscope's request."""
    pytest.importorskip("abtem")
    pytest.importorskip("temview_abtem")
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "temview-py"))
    import temview as tv
    from temview_connect.adapters.abtem import AbTEMSimulator

    m = tv.connect("headless")
    try:
        m.set(specimen="gr", mode="tem", kV=80, fov_nm=2)
        req = m.abtem_request()
    finally:
        m.close()
    srv, _ = serve(AbTEMSimulator(), 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        c = Client(f"http://127.0.0.1:{srv.server_address[1]}")
        d = c.describe()
        assert d["kind"] == "simulator" and not d["armed"] and set(d["modes"]) == {"tem", "stem", "4d", "diff", "cbed"}
        assert "openreseurope.13015.2" in d["links"]["doi"]
        out = c.run({"kind": "simulate", "mode": "tem", "request": req}, timeout=600)
        assert out["image"].ndim == 2 and out["image"].std() > 0
        with pytest.raises(ConnectError, match="not available"):
            c.run({"kind": "simulate", "mode": "ltem", "request": req})
    finally:
        srv.shutdown()
