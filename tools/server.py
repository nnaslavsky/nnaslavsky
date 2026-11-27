#!/usr/bin/env python3
"""Local server for Naava's website project.

Serves the website folder as static files and provides a tiny API used by the
arrangement tool (arrange/):

    GET  /api/arrangement   -> current data/arrangement.json
    POST /api/arrangement   -> body {"base_updated_at": <str|null>, "arrangement": {...}}
                               200 {"ok": true, "arrangement": {...}}  on success
                               409 {"error": "conflict", "arrangement": {...}}  if someone
                                   else saved since base_updated_at
                               400 {"error": "..."}  if the data looks wrong

Every successful save writes atomically, keeps a copy of the previous state in
data/arrangement-history/, and (if tools/build_mockups.py exists) rebuilds the
mockups in the background.

Standard library only (runs on macOS's /usr/bin/python3, 3.9).

Usage:  python3 tools/server.py [port] [--no-build]   (default 8765, binds 127.0.0.1;
        --no-build skips regenerating the mockups after each save)
"""

import copy
import datetime
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
import time

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(SITE, "data")
ARR_PATH = os.path.join(DATA, "arrangement.json")
HIST_DIR = os.path.join(DATA, "arrangement-history")
BUILD_SCRIPT = os.path.join(SITE, "tools", "build_mockups.py")
MAX_BODY = 5 * 1024 * 1024
MAX_HISTORY_FILES = 400

LOCK = threading.Lock()

DEFAULT_ARR = {
    "version": 1,
    "updated_at": None,
    "hero": [],
    "featured": [],
    "covers": {},
    "order": {},
    "feedback": [],
}


def log(msg):
    sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), msg))
    sys.stderr.flush()


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_arrangement():
    try:
        with open(ARR_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("not an object")
    except FileNotFoundError:
        data = copy.deepcopy(DEFAULT_ARR)
    for k, v in DEFAULT_ARR.items():
        data.setdefault(k, copy.deepcopy(v))
    return data


def _is_str_list(x):
    return isinstance(x, list) and all(isinstance(i, str) for i in x)


def validate(arr):
    """Return an error message, or None if the arrangement looks right."""
    if not isinstance(arr, dict):
        return "arrangement must be an object"
    for key in ("hero", "featured"):
        if key in arr and not _is_str_list(arr[key]):
            return "%s must be a list of work ids" % key
    covers = arr.get("covers", {})
    if not isinstance(covers, dict) or not all(
        isinstance(k, str) and (isinstance(v, str) or v is None) for k, v in covers.items()
    ):
        return "covers must map category -> work id"
    order = arr.get("order", {})
    if not isinstance(order, dict) or not all(isinstance(k, str) and _is_str_list(v) for k, v in order.items()):
        return "order must map category -> list of work ids"
    fb = arr.get("feedback", [])
    if not isinstance(fb, list):
        return "feedback must be a list"
    for item in fb:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not isinstance(item.get("text", ""), str):
            return "each feedback item needs an id and text"
    return None


def atomic_write_json(path, data):
    tmp = "%s.tmp-%d-%d" % (path, os.getpid(), threading.get_ident())
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def save_history(previous_text):
    """Keep the state as it was before this change.

    - history/previous.json is always the state right before the latest change.
    - one timestamped copy per minute (the first state seen in that minute).
    """
    if previous_text is None:
        return
    os.makedirs(HIST_DIR, exist_ok=True)
    with open(os.path.join(HIST_DIR, "previous.json"), "w", encoding="utf-8") as f:
        f.write(previous_text)
    stamp = time.strftime("%Y-%m-%d_%H-%M")
    path = os.path.join(HIST_DIR, "arrangement-%s.json" % stamp)
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(previous_text)
    # prune the oldest timestamped copies
    files = sorted(n for n in os.listdir(HIST_DIR) if n.startswith("arrangement-") and n.endswith(".json"))
    for name in files[:-MAX_HISTORY_FILES]:
        try:
            os.remove(os.path.join(HIST_DIR, name))
        except OSError:
            pass


class MockupBuilder:
    """Runs build_mockups.py in the background; coalesces rapid saves."""

    def __init__(self):
        self.cond = threading.Condition()
        self.pending = False
        self.thread = None
        self.enabled = True

    def request(self):
        if not self.enabled or not os.path.exists(BUILD_SCRIPT):
            return
        with self.cond:
            self.pending = True
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._run, daemon=True)
                self.thread.start()

    def _run(self):
        while True:
            time.sleep(1.5)  # let a burst of saves settle
            with self.cond:
                if not self.pending:
                    self.thread = None
                    return
                self.pending = False
            started = time.time()
            try:
                res = subprocess.run(
                    [sys.executable, BUILD_SCRIPT],
                    cwd=SITE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    timeout=600,
                )
                if res.returncode == 0:
                    log("mockups rebuilt (%.1fs)" % (time.time() - started))
                else:
                    tail = res.stdout.decode("utf-8", "replace")[-1500:]
                    log("build_mockups.py failed (exit %s):\n%s" % (res.returncode, tail))
            except Exception as e:  # noqa: BLE001 - log and carry on
                log("build_mockups.py could not run: %r" % (e,))


BUILDER = MockupBuilder()


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "NaavaSite/1.0"

    def log_message(self, fmt, *args):
        # Only log API calls and errors, not every image request.
        msg = fmt % args
        if "/api/" in msg or " 404 " in msg or " 500 " in msg:
            log("%s %s" % (self.address_string(), msg))

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/") or path.endswith((".html", ".js", ".css", ".json", "/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/arrangement":
            with LOCK:
                try:
                    data = read_arrangement()
                except Exception as e:  # corrupted file
                    return self._send_json(500, {"error": "could not read arrangement.json: %s" % e})
            return self._send_json(200, data)
        if path == "/api/ping":
            return self._send_json(200, {"ok": True, "server": "naava-site"})
        if path.startswith("/api/"):
            return self._send_json(404, {"error": "unknown endpoint"})
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/arrangement":
            return self._send_json(404, {"error": "unknown endpoint"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._send_json(400, {"error": "missing or oversized body"})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return self._send_json(400, {"error": "body is not valid JSON"})
        if not isinstance(payload, dict) or "arrangement" not in payload:
            return self._send_json(400, {"error": "expected {base_updated_at, arrangement}"})
        arr = payload["arrangement"]
        err = validate(arr)
        if err:
            return self._send_json(400, {"error": err})

        with LOCK:
            try:
                current = read_arrangement()
            except Exception:
                current = None  # unreadable file: allow overwrite (it is in history)
            if current is not None and current.get("locked"):
                # The arrangement was reviewed and locked. To unlock, set "locked": false in data/arrangement.json by hand.
                return self._send_json(423, {"error": "locked", "arrangement": current})
            if current is not None and current.get("updated_at") != payload.get("base_updated_at"):
                return self._send_json(409, {"error": "conflict", "arrangement": current})
            try:
                with open(ARR_PATH, "r", encoding="utf-8") as f:
                    previous_text = f.read()
            except FileNotFoundError:
                previous_text = None

            new = copy.deepcopy(DEFAULT_ARR)
            new.update(arr)
            new["version"] = arr.get("version", 1) if isinstance(arr.get("version"), int) else 1
            stamp = now_iso()
            if current is not None and current.get("updated_at") == stamp:
                time.sleep(0.002)
                stamp = now_iso()
            new["updated_at"] = stamp
            try:
                save_history(previous_text)
            except Exception as e:  # history is nice-to-have
                log("could not write history: %r" % (e,))
            atomic_write_json(ARR_PATH, new)
        log("arrangement saved (%s)" % stamp)
        BUILDER.request()
        return self._send_json(200, {"ok": True, "arrangement": new})


def main():
    port = 8765
    for arg in sys.argv[1:]:
        if arg == "--no-build":
            BUILDER.enabled = False
        elif arg.isdigit():
            port = int(arg)
        else:
            sys.exit("usage: server.py [port] [--no-build]")
    handler = functools.partial(Handler, directory=SITE)
    # Refuse to start if anything already answers on this port (SO_REUSEADDR
    # could otherwise let two servers share it on macOS).
    import socket
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(0.5)
    try:
        if probe.connect_ex(("127.0.0.1", port)) == 0:
            sys.exit("Port %d is already in use. Try another: python3 tools/server.py %d" % (port, port + 1))
    finally:
        probe.close()
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError as e:
        sys.exit("Port %d is busy (%s). Try another: python3 tools/server.py 8766" % (port, e))
    print("Serving %s at http://127.0.0.1:%d/  (arrange tool: /arrange/)" % (SITE, port), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
