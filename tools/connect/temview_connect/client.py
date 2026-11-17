"""A Python client for any temview-connect/1 connector (scripts, notebooks, other programs).

Copyright © 2026 by Northwestern University. All Rights Reserved.

    c = Client("http://127.0.0.1:8798", token="…")
    c.describe(); c.state(); c.set(defocus_nm=-50, beam_blanked=False)
    data = c.run({"kind": "acquire", "mode": "tem", "exposure_s": 1})   # dict of numpy arrays + "meta"
    c.stop()
"""
from __future__ import annotations

import io
import json
import time
import urllib.error
import urllib.request

import numpy as np

from .protocol import FORMAT


class ConnectError(RuntimeError):
    pass


class Client:
    def __init__(self, url: str, token: str | None = None, timeout: float = 30):
        self.url, self.token, self.timeout = url.rstrip("/"), token, timeout

    def _req(self, method, path, body=None, raw=False):
        data = None if body is None else json.dumps(body).encode()
        r = urllib.request.Request(self.url + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=self.timeout) as f:
                b = f.read()
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get("error")
            except Exception:
                msg = str(e)
            raise ConnectError(f"{e.code}: {msg}") from None
        return b if raw else json.loads(b)

    def describe(self) -> dict:
        return self._req("GET", "/describe")

    def state(self) -> dict:
        return self._req("GET", "/state")["state"]

    def set(self, **changes) -> dict:
        return self._req("POST", "/state", {"token": self.token, "set": changes})["state"]

    def stop(self) -> dict:
        return self._req("POST", "/stop", {})

    def submit(self, job: dict) -> str:
        return self._req("POST", "/jobs", {"format": FORMAT, "token": self.token, **job})["id"]

    def run(self, job: dict, poll: float = 0.2, timeout: float = 3600) -> dict:
        jid, t0 = self.submit(job), time.time()
        while True:
            s = self._req("GET", f"/jobs/{jid}")
            if s["status"] == "done":
                import zipfile

                z = zipfile.ZipFile(io.BytesIO(self._req("GET", f"/jobs/{jid}/result", raw=True)))
                out = {n[:-4]: np.load(io.BytesIO(z.read(n)), allow_pickle=False) for n in z.namelist() if n.endswith(".npy")}
                if "metadata.json" in z.namelist():
                    out["meta"] = json.loads(z.read("metadata.json"))
                return out
            if s["status"] == "error":
                raise ConnectError(s["error"])
            if time.time() - t0 > timeout:
                raise ConnectError("timed out")
            time.sleep(poll)
