"""The temview-connect/1 HTTP service in front of one adapter.

Copyright © 2026 by Northwestern University. All Rights Reserved.

    GET  /describe          name, kind (simulator | instrument), modes, controls with limits, armed
    GET  /state             the device's actual state (instruments)
    POST /state             {"token": ..., "set": {control: value, ...}} → the state reached   (instruments)
    POST /stop              blank the beam, abort the running job; always allowed, no token
    POST /jobs              {"format": "temview-connect/1", "kind": "simulate" | "acquire", "mode": ..., ...}
                            (acquire needs the token) → {"id": ...}; jobs run one at a time
    GET  /jobs/<id>         {"status": queued | running | done | error, "progress": ..., "error": ...}
    GET  /jobs/<id>/result  TEM-view .npz

Safety, for instruments that are driven:
- it listens on 127.0.0.1 only, and answers browsers only from the exhibit's sites and localhost;
- anything that changes the device (POST /state, acquire jobs) needs the pairing token printed in this
  terminal when the service starts: whoever runs the service at the instrument decides who drives it;
- every value is checked against the limits the adapter declares (refused, never silently clamped), including
  the largest single step for stage and tilt;
- writes are rate-limited, and every write, refusal and stop is appended to an audit log (JSON lines).
"""
from __future__ import annotations

import io
import json
import os
import queue
import re
import secrets
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

from .protocol import FORMAT, ProtocolError, validate_job

ORIGINS = [o.strip() for o in os.environ.get("TEMVIEW_ORIGINS", "https://advanced-em.github.io").split(",") if o.strip()]
LOCAL = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
MAX_BODY = 20 * 1024 * 1024
MIN_WRITE_INTERVAL_S = 0.1


def npz_bytes(result: dict) -> bytes:
    """TEM-view's .npz layout: one .npy per array plus metadata.json, stored (not compressed) so a browser reads it."""
    import zipfile

    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_STORED) as z:
        for k, v in result["arrays"].items():
            a = io.BytesIO()
            np.save(a, np.ascontiguousarray(v))
            z.writestr(f"{k}.npy", a.getvalue())
        z.writestr("metadata.json", json.dumps({"format": "tem-view-data/1", **result.get("meta", {})}, indent=1, default=str))
    return b.getvalue()


class Service:
    def __init__(self, adapter, token: str | None = None, log_path: str | None = None):
        self.adapter = adapter
        self.desc = adapter.description
        self.token = token if token is not None else (secrets.token_hex(4) if self.desc.kind == "instrument" else "")
        self.log_path = log_path
        self.jobs: dict[str, dict] = {}
        self.q: "queue.Queue[str]" = queue.Queue()
        self.last_write = 0.0
        self.write_lock = threading.Lock()
        threading.Thread(target=self._worker, daemon=True).start()

    # -- audit log
    def log(self, event: str, **kw):
        if not self.log_path:
            return
        with open(self.log_path, "a") as f:
            f.write(json.dumps({"t": time.time(), "event": event, **kw}, default=str) + "\n")

    def armed(self, token) -> bool:
        return not self.token or (isinstance(token, str) and secrets.compare_digest(token, self.token))

    # -- driving
    def set_state(self, body: dict) -> dict:
        if not self.armed(body.get("token")):
            self.log("refused", reason="token", set=body.get("set"))
            raise PermissionError("wrong or missing pairing token (shown in the connector's terminal)")
        changes = body.get("set")
        if not isinstance(changes, dict) or not changes:
            raise ProtocolError("set must be a non-empty object of control: value")
        current = self.adapter.read_state()
        checked = {}
        for k, v in changes.items():
            c = self.desc.controls.get(k)
            if c is None:
                raise ProtocolError(f"{k} is not a control of this connector")
            checked[k] = c.check(v, current.get(k))
        with self.write_lock:
            wait = self.last_write + MIN_WRITE_INTERVAL_S - time.time()
            if wait > 0:
                time.sleep(wait)
            try:
                reached = self.adapter.apply(checked)
            finally:
                self.last_write = time.time()
        self.log("set", set=checked, reached=reached)
        return reached

    def stop(self):
        try:
            self.adapter.stop()
        finally:
            for j in self.jobs.values():
                if j["status"] in ("queued", "running"):
                    j.update(status="error", error="stopped")
            self.log("stop")

    # -- jobs
    def submit(self, job: dict) -> str:
        job = validate_job(job, self.desc)
        if job["kind"] == "acquire" and not self.armed(job.get("token")):
            self.log("refused", reason="token", job=job.get("mode"))
            raise PermissionError("wrong or missing pairing token (shown in the connector's terminal)")
        jid = uuid.uuid4().hex
        self.jobs[jid] = {"status": "queued", "progress": "queued", "job": {k: v for k, v in job.items() if k != "token"}, "created": time.time()}
        self.q.put(jid)
        self.log("job", id=jid, kind=job["kind"], mode=job["mode"])
        return jid

    def _worker(self):
        while True:
            jid = self.q.get()
            j = self.jobs[jid]
            if j["status"] != "queued":
                continue
            j.update(status="running", started=time.time())
            try:
                res = self.adapter.run(j["job"], lambda m: j.update(progress=m))
                if j["status"] == "running":
                    j.update(status="done", result=(getattr(self.adapter, "to_npz", None) or npz_bytes)(res), seconds=round(time.time() - j["started"], 2), progress="done")
            except Exception as e:  # report, keep serving
                j.update(status="error", error=str(e) if isinstance(e, (ProtocolError, RuntimeError)) else f"{type(e).__name__}: {e}",
                         trace=traceback.format_exc()[-2000:])
            j.pop("job", None)


def make_handler(svc: Service):
    class Handler(BaseHTTPRequestHandler):
        server_version = "temview-connect/1"

        def _origin(self):
            o = self.headers.get("Origin")
            if o is None:
                return None  # not a browser
            return o if (o in ORIGINS or LOCAL.match(o)) else ""

        def _send(self, code, body: bytes, ctype="application/json"):
            o = self._origin()
            if o == "":
                code, body, ctype = 403, b'{"error": "origin not allowed"}', "application/json"
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if o:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code, obj):
            self._send(code, json.dumps(obj, default=str).encode())

        def do_OPTIONS(self):
            o = self._origin()
            self.send_response(204 if o != "" else 403)
            if o:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            if self._origin() == "":
                return self._json(403, {"error": "origin not allowed"})
            if self.path == "/describe":
                return self._json(200, svc.desc.to_json(armed=bool(svc.token)) | {"queued": svc.q.qsize()})
            if self.path == "/state":
                return self._json(200, {"format": FORMAT, "state": svc.adapter.read_state()})
            m = re.fullmatch(r"/jobs/([0-9a-f]{32})(/result)?", self.path)
            if not m or m.group(1) not in svc.jobs:
                return self._json(404, {"error": "not found"})
            j = svc.jobs[m.group(1)]
            if m.group(2):
                if j["status"] != "done":
                    return self._json(409, {"error": f"job is {j['status']}"})
                return self._send(200, j["result"], "application/octet-stream")
            self._json(200, {k: j.get(k) for k in ("status", "progress", "error", "seconds")} | {"queue": svc.q.qsize()})

        def do_POST(self):
            if self._origin() == "":
                return self._json(403, {"error": "origin not allowed"})
            if self.path == "/stop":  # first, and with no body or token needed
                svc.stop()
                return self._json(200, {"stopped": True, "state": svc.adapter.read_state()})
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 < n <= MAX_BODY:
                return self._json(413, {"error": "request too large"})
            try:
                body = json.loads(self.rfile.read(n))
                if self.path == "/state":
                    return self._json(200, {"format": FORMAT, "state": svc.set_state(body)})
                if self.path == "/jobs":
                    return self._json(202, {"id": svc.submit(body)})
                return self._json(404, {"error": "not found"})
            except PermissionError as e:
                return self._json(401, {"error": str(e)})
            except NotImplementedError:
                return self._json(405, {"error": "this connector cannot be driven"})
            except (ValueError, ProtocolError) as e:
                return self._json(400, {"error": str(e)})

        def log_message(self, fmt, *args):
            pass

    return Handler


def serve(adapter, port: int, token: str | None = None, log_path: str | None = None, host: str = "127.0.0.1"):
    svc = Service(adapter, token, log_path)
    srv = ThreadingHTTPServer((host, port), make_handler(svc))
    d = svc.desc
    print(f"temview-connect: {d.name} ({d.kind}) on http://{host}:{port}  modes: {', '.join(d.modes)}")
    if svc.token:
        print(f"pairing token: {svc.token}   (enter it in TEM-view → Connections to drive this {d.kind})")
    if log_path:
        print(f"audit log: {log_path}")
    return srv, svc
