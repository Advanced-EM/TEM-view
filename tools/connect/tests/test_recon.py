"""temview-connect/1 Tier 2 additions: reconstruct and simulate-series jobs, server-sent events, previews and the
resource report, against the reconstruction service (numpy engine)."""
import json
import threading
import time
import urllib.request

import numpy as np
import pytest

from temview_connect import serve
from temview_connect.adapters.recon import ReconstructionService, project
from temview_connect.protocol import encode_array


@pytest.fixture()
def svc():
    srv, _ = serve(ReconstructionService(), 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def post(url, obj):
    req = urllib.request.Request(url, json.dumps(obj).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def wait(url, jid):
    for _ in range(600):
        s = json.loads(get(f"{url}/jobs/{jid}"))
        if s["status"] in ("done", "error"):
            return s
        time.sleep(0.05)
    raise TimeoutError


def phantom(N=32):
    z, y, x = np.mgrid[:N, :N, :N] - (N / 2 - 0.5)
    return ((x - 3) ** 2 + (y + 2) ** 2 + (z - 4) ** 2 < 16).astype(float) + 0.5 * ((x + 5) ** 2 + (y - 4) ** 2 + (z + 3) ** 2 < 9)


def read_npz(b):
    import io
    import zipfile

    z = zipfile.ZipFile(io.BytesIO(b))
    return {n[:-4]: np.load(io.BytesIO(z.read(n))) for n in z.namelist() if n.endswith(".npy")}, json.loads(z.read("metadata.json"))


def test_describe_reports_resources_and_engines(svc):
    d = json.loads(get(f"{svc}/describe"))
    assert d["kind"] == "compute" and "reconstruct" in d["acquisitions"] and "simulate-series" in d["acquisitions"]
    assert d["engines"]["numpy"] and d["resources"]["cpus"] >= 1 and d["resources"]["memory_bytes"] > 0


def test_simulate_series_then_reconstruct(svc):
    vol, ang = phantom(), list(np.linspace(-70, 70, 36))
    jid = post(f"{svc}/jobs", {"format": "temview-connect/1", "kind": "simulate-series", "mode": "tomo", "angles_deg": ang, "arrays": {"volume": encode_array(vol)}})["id"]
    assert wait(svc, jid)["status"] == "done"
    arr, _ = read_npz(get(f"{svc}/jobs/{jid}/result"))
    ser = arr["tilt_series"]
    assert ser.shape == (36, 32, 32) and np.allclose(ser[0], project(vol, ang[0]), atol=1e-4)
    for method in ("wbp", "sirt"):
        jid = post(f"{svc}/jobs", {"format": "temview-connect/1", "kind": "reconstruct", "mode": "tomo", "method": method, "iterations": 15, "angles_deg": ang, "arrays": {"tilt_series": encode_array(ser)}})["id"]
        assert wait(svc, jid)["status"] == "done"
        arr, meta = read_npz(get(f"{svc}/jobs/{jid}/result"))
        rec = arr["reconstruction"]
        c = np.corrcoef(rec.ravel(), vol.ravel())[0, 1]
        assert rec.shape == (32, 32, 32) and c > 0.85, (method, c)
        assert meta["engine"] == "numpy"


def test_events_stream_and_preview(svc):
    vol, ang = phantom(), list(np.linspace(-60, 60, 25))
    ser = np.stack([project(vol, a) for a in ang])
    jid = post(f"{svc}/jobs", {"format": "temview-connect/1", "kind": "reconstruct", "mode": "tomo", "method": "sirt", "iterations": 12, "angles_deg": ang, "arrays": {"tilt_series": encode_array(ser)}})["id"]
    with urllib.request.urlopen(f"{svc}/jobs/{jid}/events", timeout=60) as r:
        assert r.headers["Content-Type"] == "text/event-stream"
        text = r.read().decode()
    events = [b.split("\n")[0][7:] for b in text.split("\n\n") if b.startswith("event:")]
    assert events.count("progress") >= 12 and events[-1] == "done"
    p = json.loads(get(f"{svc}/jobs/{jid}/preview"))
    assert p["preview"]["shape"] == [32, 32] and p["fraction"] == 1.0


def test_refusals(svc):
    import urllib.error

    bad = [
        {"format": "temview-connect/1", "kind": "reconstruct", "mode": "tomo", "angles_deg": [0], "arrays": {"tilt_series": encode_array(np.zeros((2, 8, 8)))}},  # angles ≠ tilts
        {"format": "temview-connect/1", "kind": "reconstruct", "mode": "tomo", "angles_deg": [0], "arrays": {"tilt_series": {"dtype": "float32", "shape": [1, 8, 8], "b64": "AAAA"}}},  # wrong size
        {"format": "temview-connect/1", "kind": "acquire", "mode": "tomo"},  # not offered
    ]
    for b in bad:
        with pytest.raises(urllib.error.HTTPError) as e:
            post(f"{svc}/jobs", b)
        assert e.value.code == 400


def test_ptychography_epie(svc):
    # a weak phase object scanned by a small probe; ePIE (numpy) recovers its phase
    n4, G, N, dx = 16, 48, 8, 1.0
    yy, xx = np.mgrid[:G, :G]
    obj = np.exp(1j * 0.3 * np.exp(-((xx - 24) ** 2 + (yy - 24) ** 2) / 20))
    k = np.fft.fftfreq(n4)
    K2 = k[None] ** 2 + k[:, None] ** 2
    P = np.fft.fftshift(np.fft.ifft2((K2 < 0.06).astype(complex)))
    g = {"N": N, "n4": n4, "gridN": G, "dx": dx, "step": 3.0, "scan": 24.0}
    corner = lambda i: int(round(G / 2 + (-g["scan"] / 2 + (i + 0.5) * g["step"]) / dx)) - n4 // 2
    data = np.zeros((N * N, n4, n4))
    for idx in range(N * N):
        t, l = corner(idx // N), corner(idx % N)
        data[idx] = np.fft.fftshift(np.abs(np.fft.fft2(obj[t:t + n4, l:l + n4] * P)) ** 2)
    jid = post(f"{svc}/jobs", {"format": "temview-connect/1", "kind": "reconstruct", "mode": "4d", "iterations": 15, "geom": g,
                               "arrays": {"data": encode_array(data.astype(np.float32)), "probe": encode_array(P.astype(np.complex64))}})["id"]
    s = wait(svc, jid)
    assert s["status"] == "done", s
    arr, _ = read_npz(get(f"{svc}/jobs/{jid}/result"))
    ph = np.angle(arr["object"])[16:32, 16:32]
    c = np.corrcoef(ph.ravel(), np.angle(obj)[16:32, 16:32].ravel())[0, 1]
    assert c > 0.9, c


def test_python_client_reconstructs(svc):
    from temview_connect import Client

    vol, ang = phantom(), list(np.linspace(-60, 60, 31))
    ser = np.stack([project(vol, a) for a in ang])
    seen = []
    rec = Client(svc).reconstruct_tomo(ser, ang, method="sirt", iterations=6, progress=seen.append)
    assert rec.shape == (32, 32, 32) and len(seen) >= 6 and np.corrcoef(rec.ravel(), vol.ravel())[0, 1] > 0.8
