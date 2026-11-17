"""A small local HTTP service the TEM-view exhibit sends requests to.

    temview-abtem serve            # http://127.0.0.1:8797

  GET  /health            versions, presets, supported modes and specimens
  POST /jobs              a temview-abtem/1 request (JSON) → {"id": ...}; jobs run one at a time
  GET  /jobs/<id>         {"status": queued|running|done|error, "progress": "...", "error": ...}
  GET  /jobs/<id>/result  the result as TEM-view .npz

It listens on 127.0.0.1 only and answers browsers only from the exhibit's own sites (and localhost), so a web
page elsewhere cannot use it. Requests are data, never code, and are bounded (see request.py).
"""
from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .request import MODES, PRESETS, SPECIMENS, RequestError, validate
from .simulate import simulate, to_npz_bytes

ORIGINS = [o.strip() for o in os.environ.get("TEMVIEW_ORIGINS", "https://advanced-em.github.io").split(",") if o.strip()]
LOCAL = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
MAX_BODY = 20 * 1024 * 1024
JOBS: dict[str, dict] = {}
Q: "queue.Queue[str]" = queue.Queue()


def _worker():
    while True:
        jid = Q.get()
        job = JOBS[jid]
        job.update(status="running", started=time.time())
        try:
            res = simulate(job["request"], progress=lambda m: job.update(progress=m))
            job.update(status="done", result=to_npz_bytes(res), seconds=res["meta"]["abtem"]["seconds"], progress="done")
        except RequestError as e:
            job.update(status="error", error=str(e))
        except Exception as e:  # report, keep serving
            job.update(status="error", error=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-2000:])
        job.pop("request", None)


class Handler(BaseHTTPRequestHandler):
    server_version = "temview-abtem/0.1"

    def _origin_ok(self) -> str | None:
        o = self.headers.get("Origin")
        if o is None:
            return None  # not a browser (curl, Python): allowed, no CORS headers needed
        return o if (o in ORIGINS or LOCAL.match(o)) else ""

    def _send(self, code: int, body: bytes, ctype="application/json"):
        o = self._origin_ok()
        if o == "":
            code, body, ctype = 403, b'{"error": "origin not allowed"}', "application/json"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj).encode())

    def do_OPTIONS(self):  # CORS preflight, including Chrome's private-network access
        o = self._origin_ok()
        self.send_response(204 if o != "" else 403)
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            import abtem
            return self._json(200, {"ok": True, "abtem": abtem.__version__, "modes": MODES, "specimens": SPECIMENS,
                                    "presets": PRESETS, "queued": Q.qsize()})
        m = re.fullmatch(r"/jobs/([0-9a-f]{32})(/result)?", self.path)
        if not m or m.group(1) not in JOBS:
            return self._json(404, {"error": "no such job"})
        job = JOBS[m.group(1)]
        if m.group(2):
            if job["status"] != "done":
                return self._json(409, {"error": f"job is {job['status']}"})
            return self._send(200, job["result"], "application/octet-stream")
        self._json(200, {k: job.get(k) for k in ("status", "progress", "error", "seconds")} | {"queue": Q.qsize()})

    def do_POST(self):
        if self.path != "/jobs":
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX_BODY:
            return self._json(413, {"error": "request too large"})
        if self._origin_ok() == "":
            return self._json(403, {"error": "origin not allowed"})
        try:
            req = validate(json.loads(self.rfile.read(n)))
        except (ValueError, RequestError) as e:
            return self._json(400, {"error": str(e)})
        jid = uuid.uuid4().hex
        JOBS[jid] = {"status": "queued", "progress": "queued", "request": req, "created": time.time()}
        Q.put(jid)
        self._json(202, {"id": jid})

    def log_message(self, fmt, *args):  # quiet: one line per request
        print(f"{self.address_string()} {fmt % args}")


def serve(port: int = 8797):
    threading.Thread(target=_worker, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"temview-abtem bridge on http://127.0.0.1:{port} (sites allowed: {', '.join(ORIGINS)}, localhost)")
    srv.serve_forever()
