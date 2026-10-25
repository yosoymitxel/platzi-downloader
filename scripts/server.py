#!/usr/bin/env python3
"""Servidor local del visor Platzi Local.

Sirve viewer/ y Courses/ y expone una API minima para gestionar la cola de
descargas. Solo escucha en 127.0.0.1 y no usa dependencias externas.

Uso:
    python scripts/server.py

Variables de entorno:
    PORT           puerto (8787 por defecto)
    PLATZI_BIN     ejecutable del CLI (platzi por defecto)
    PLATZI_PREFIX  argumentos extra antes de "download", como JSON
                   (solo para pruebas: ["C:\\ruta\\fake_platzi.py"])
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from catalog_db import get_catalog_payload

ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT / "scripts" / "download_state.json"
VIEWER_DATA = ROOT / "scripts" / "viewer_data.py"
PUBLIC_CATALOG_SCRIPT = ROOT / "scripts" / "sync_public_catalog.py"
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8787"))
PLATZI_BIN = os.environ.get("PLATZI_BIN", "platzi")
try:
    PLATZI_PREFIX = json.loads(os.environ.get("PLATZI_PREFIX", "[]"))
    if not isinstance(PLATZI_PREFIX, list):
        PLATZI_PREFIX = []
except json.JSONDecodeError:
    PLATZI_PREFIX = []

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")
ERROR_RE = re.compile(r"\b(error|traceback|exception|failed|fallo|falló)\b", re.I)
LOGIN_RE = re.compile(r"login first|inicia sesi[oó]n|not (logged|authenticated|authorized)|unauthorized|401|403", re.I)
TOTAL_RE = re.compile(r"\|\s*total\s*\|\s*(\d+)\s*\|", re.I)
VIDEO_RE = re.compile(r"\[DOWNLOADING-VIDEO\]", re.I)
SUBS_RE = re.compile(r"\[DOWNLOADING-SUBS\]", re.I)
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

MAX_BODY = 64 * 1024
MAX_ENQUEUE = 200
HISTORY_MAX = 30
PROGRESS_SAVE_MS = 2000

ALLOWED_ORIGINS = {
    f"http://localhost:{PORT}",
    f"http://127.0.0.1:{PORT}",
}
BLOCKED_PREFIXES = (
    "/scripts",
    "/logs",
    "/.git",
    "/.impeccable",
    "/.taste-skill",
    "/graphify-out",
)

LOCK = threading.RLock()
STOP = threading.Event()
WORKER = None
CURRENT_PROC = None

STATE = {
    "items": [],
    "catalog": {"refreshing": False, "lastRefresh": None, "lastRefreshOk": None},
    "session": {"checkedAt": None, "loggedIn": None, "message": ""},
}

PUBLIC_CATALOG_SYNC_LOCK = threading.Lock()
PUBLIC_CATALOG_SYNC = {"running": False, "startedAt": None, "finishedAt": None, "ok": None, "error": ""}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now_ms():
    return int(time.time() * 1000)


def clean_slug(value):
    if not isinstance(value, str):
        return None
    slug = value.strip().lower()
    return slug if SLUG_RE.fullmatch(slug) else None


def clean_title(value, fallback):
    if not isinstance(value, str):
        return fallback
    title = CONTROL_RE.sub("", value).strip()
    return title[:200] if title else fallback


def cli_available():
    if Path(PLATZI_BIN).is_file():
        return True
    return shutil.which(PLATZI_BIN) is not None


def find_item(slug):
    for item in STATE["items"]:
        if item.get("slug") == slug:
            return item
    return None


def normalize_order():
    """Deja corriendo, luego en cola, luego historial. Un solo proceso activo."""
    running = []
    queued = []
    history = []
    for item in STATE["items"]:
        if item.get("status") == "running":
            running.append(item)
        elif item.get("status") == "queued":
            queued.append(item)
        else:
            history.append(item)
    if len(running) > 1:
        for item in running[1:]:
            item["status"] = "queued"
            item["startedAt"] = None
            item["progress"] = 0
            item["phase"] = ""
        queued = running[1:] + queued
        running = running[:1]
    STATE["items"][:] = running + queued + history[:HISTORY_MAX]


def save_state_locked():
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    payload = {
        "items": STATE["items"],
        "catalog": STATE["catalog"],
        "updated": now_ms(),
    }
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


def load_state():
    if not STATE_PATH.exists():
        return
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Aviso: no se pudo leer {STATE_PATH.name}: {exc}")
        return
    items = raw.get("items") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return
    clean = []
    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue
        slug = clean_slug(raw_item.get("slug"))
        if not slug:
            continue
        status = raw_item.get("status")
        if status not in ("queued", "running", "completed", "error", "canceled"):
            status = "queued"
        if status == "running":
            status = "queued"
        clean.append({
            "slug": slug,
            "title": clean_title(raw_item.get("title"), slug),
            "status": status,
            "progress": 0 if status == "queued" else max(0, min(100, int(raw_item.get("progress") or 0))),
            "phase": "",
            "error": str(raw_item.get("error") or "")[:300],
            "addedAt": int(raw_item.get("addedAt") or now_ms()),
            "startedAt": raw_item.get("startedAt"),
            "finishedAt": raw_item.get("finishedAt"),
        })
    STATE["items"] = clean
    catalog = raw.get("catalog") if isinstance(raw.get("catalog"), dict) else {}
    STATE["catalog"] = {
        "refreshing": False,
        "lastRefresh": catalog.get("lastRefresh"),
        "lastRefreshOk": catalog.get("lastRefreshOk"),
    }
    session = raw.get("session") if isinstance(raw.get("session"), dict) else {}
    STATE["session"] = {
        "checkedAt": session.get("checkedAt"),
        "loggedIn": session.get("loggedIn"),
        "message": str(session.get("message") or "")[:300],
    }
    normalize_order()


def snapshot():
    with LOCK:
        items = [dict(item) for item in STATE["items"]]
        catalog = dict(STATE["catalog"])
    stats = {"running": 0, "queued": 0, "completed": 0, "error": 0, "canceled": 0}
    for item in items:
        if item["status"] in stats:
            stats[item["status"]] += 1
    return {
        "ok": True,
        "items": items,
        "stats": stats,
        "catalog": catalog,
        "session": dict(STATE["session"]),
        "cliAvailable": cli_available(),
        "stateFile": str(STATE_PATH),
        "serverTime": now_ms(),
    }


def enqueue(raw_items, position):
    added = 0
    created = []
    with LOCK:
        seen = set()
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            slug = clean_slug(raw.get("slug"))
            if not slug or slug in seen:
                continue
            seen.add(slug)
            title = clean_title(raw.get("title"), slug)
            existing = find_item(slug)
            if existing:
                if existing.get("status") in ("queued", "running"):
                    continue
                STATE["items"].remove(existing)
            created.append({
                "slug": slug,
                "title": title,
                "status": "queued",
                "progress": 0,
                "phase": "",
                "error": "",
                "addedAt": now_ms(),
                "startedAt": None,
                "finishedAt": None,
            })
        if not created:
            return 0
        if position == "front":
            index = 0
            while index < len(STATE["items"]) and STATE["items"][index].get("status") == "running":
                index += 1
            STATE["items"][index:index] = created
        else:
            index = len(STATE["items"])
            while index > 0 and STATE["items"][index - 1].get("status") not in ("running", "queued"):
                index -= 1
            STATE["items"][index:index] = created
        added = len(created)
        normalize_order()
        save_state_locked()
    return added


def reorder(slug, direction):
    with LOCK:
        item = find_item(slug)
        if not item or item.get("status") != "queued":
            return False
        index = STATE["items"].index(item)
        step = -1 if direction == "up" else 1
        other = index + step
        if other < 0 or other >= len(STATE["items"]):
            return False
        neighbor = STATE["items"][other]
        if neighbor.get("status") != "queued":
            return False
        STATE["items"][index], STATE["items"][other] = neighbor, item
        save_state_locked()
    return True


def terminate_tree(proc):
    if proc is None:
        return
    if proc.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
                check=False,
            )
            return
        except (OSError, subprocess.TimeoutExpired):
            pass
    try:
        proc.terminate()
    except OSError:
        pass


def cancel(slug):
    proc = None
    with LOCK:
        item = find_item(slug)
        if not item or item.get("status") not in ("queued", "running"):
            return False
        if item["status"] == "running":
            proc = CURRENT_PROC
        item["status"] = "canceled"
        item["phase"] = "Cancelado"
        item["finishedAt"] = now_ms()
        normalize_order()
        save_state_locked()
    if proc is not None:
        terminate_tree(proc)
    return True


def remove_item(slug):
    with LOCK:
        item = find_item(slug)
        if not item or item.get("status") in ("queued", "running"):
            return False
        STATE["items"].remove(item)
        save_state_locked()
    return True


def clear_history():
    with LOCK:
        STATE["items"][:] = [
            item for item in STATE["items"]
            if item.get("status") in ("queued", "running")
        ]
        save_state_locked()


def check_session():
    checked_at = now_ms()
    if not cli_available():
        result = {"checkedAt": checked_at, "loggedIn": False, "message": "No se encontró el comando platzi en PATH."}
        with LOCK:
            STATE["session"] = dict(result)
            save_state_locked()
        return dict(result)
    command = [PLATZI_BIN] + PLATZI_PREFIX + ["download", "https://platzi.com/cursos/__platzi_local_probe__/"]
    output = ""
    try:
        proc = subprocess.run(
            command,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )
        output = proc.stdout or ""
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        output += "\nTiempo de espera agotado al comprobar la sesión."
    except OSError as exc:
        output = f"No se pudo ejecutar platzi: {exc}"
    logged_in = LOGIN_RE.search(output) is None
    msg = ""
    for line in output.splitlines():
        if LOGIN_RE.search(line) or ERROR_RE.search(line):
            msg = clean_line(line)
    if not logged_in:
        msg = msg or "La sesión de Platzi no está iniciada. Ejecuta platzi login."
    else:
        msg = ""
    result = {"checkedAt": now_ms(), "loggedIn": logged_in, "message": msg[:300]}
    with LOCK:
        STATE["session"] = dict(result)
        save_state_locked()
    return dict(result)


def public_catalog_sync_snapshot():
    with PUBLIC_CATALOG_SYNC_LOCK:
        return dict(PUBLIC_CATALOG_SYNC)


def start_public_catalog_sync():
    with PUBLIC_CATALOG_SYNC_LOCK:
        if PUBLIC_CATALOG_SYNC["running"]:
            raise ApiError(409, "Ya se está actualizando el catálogo público.")
        PUBLIC_CATALOG_SYNC.update({
            "running": True,
            "startedAt": now_ms(),
            "finishedAt": None,
            "ok": None,
            "error": "",
        })

    def run():
        ok = False
        error = ""
        try:
            proc = subprocess.run(
                [sys.executable, str(PUBLIC_CATALOG_SCRIPT)],
                cwd=str(ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=900,
                check=False,
            )
            output = proc.stdout or ""
            ok = proc.returncode == 0
            if not ok:
                error = output.strip()[-700:] or "No se pudo actualizar el catálogo público."
            elif output.strip():
                print(output.strip()[-1200:])
        except (OSError, subprocess.TimeoutExpired) as exc:
            error = str(exc)[:700]
        finally:
            with PUBLIC_CATALOG_SYNC_LOCK:
                PUBLIC_CATALOG_SYNC.update({
                    "running": False,
                    "finishedAt": now_ms(),
                    "ok": ok,
                    "error": error,
                })

    threading.Thread(target=run, name="public-catalog-sync", daemon=True).start()
    return public_catalog_sync_snapshot()


def refresh_catalog():
    with LOCK:
        if STATE["catalog"].get("refreshing"):
            raise ApiError(409, "Ya se está actualizando el catálogo.")
        if any(item.get("status") in ("queued", "running") for item in STATE["items"]):
            raise ApiError(409, "Espera a que termine la cola para actualizar el catálogo.")
        STATE["catalog"]["refreshing"] = True
        save_state_locked()

    def run():
        ok = False
        try:
            proc = subprocess.run(
                [sys.executable, str(VIEWER_DATA)],
                cwd=str(ROOT),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=900,
                check=False,
            )
            ok = proc.returncode == 0
            if not ok and proc.stderr:
                print("viewer_data.py fallo:", proc.stderr.strip()[-500:])
        except (OSError, subprocess.TimeoutExpired) as exc:
            print("No se pudo actualizar el catalogo:", exc)
        with LOCK:
            STATE["catalog"]["refreshing"] = False
            STATE["catalog"]["lastRefresh"] = now_ms()
            STATE["catalog"]["lastRefreshOk"] = ok
            save_state_locked()

    threading.Thread(target=run, name="catalog-refresh", daemon=True).start()


def build_command(slug):
    url = f"https://platzi.com/cursos/{slug}/"
    return [PLATZI_BIN] + PLATZI_PREFIX + ["download", url]


def clean_line(line):
    return CONTROL_RE.sub("", line).strip()[:300]


def request_path(raw_path):
    return re.sub(r"/+", "/", unquote(raw_path))


def set_progress(slug, progress, phase):
    with LOCK:
        item = find_item(slug)
        if not item or item.get("status") != "running":
            return
        if progress is not None and progress > item.get("progress", 0):
            item["progress"] = progress
        if phase:
            item["phase"] = phase


def worker_loop():
    global CURRENT_PROC
    last_save = 0
    while not STOP.is_set():
        with LOCK:
            item = next(
                (it for it in STATE["items"] if it.get("status") == "queued"),
                None,
            )
            if item is not None:
                item["status"] = "running"
                item["startedAt"] = now_ms()
                item["finishedAt"] = None
                item["progress"] = 0
                item["phase"] = "Preparando"
                item["error"] = ""
                save_state_locked()
                slug = item["slug"]
        if item is None:
            time.sleep(0.6)
            continue

        command = build_command(slug)
        last_error = ""
        login_failed = False
        total_lessons = 0
        videos_seen = 0
        proc = None
        returncode = -1
        try:
            with LOCK:
                current = find_item(slug)
                if current is None or current.get("status") != "running":
                    continue
            proc = subprocess.Popen(
                command,
                cwd=str(ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            with LOCK:
                CURRENT_PROC = proc
                current = find_item(slug)
                canceled_now = current is None or current.get("status") == "canceled"
            if canceled_now:
                terminate_tree(proc)
            if proc.stdout is not None:
                total_lessons = 0
                videos_seen = 0
                for line in proc.stdout:
                    match_total = TOTAL_RE.search(line)
                    if match_total:
                        total_lessons = max(0, int(match_total.group(1)))
                        continue
                    progress = None
                    phase = None
                    if VIDEO_RE.search(line):
                        videos_seen += 1
                        phase = "Video"
                        progress = int(((videos_seen - 1) / total_lessons) * 100) if total_lessons else 0
                    elif SUBS_RE.search(line):
                        phase = "Subtítulos"
                        progress = int((videos_seen / total_lessons) * 100) if total_lessons else 0
                    elif "processing" in line.lower():
                        phase = "Preparando"
                        progress = 0
                    if phase:
                        if total_lessons:
                            phase = f"{phase} · clase {max(1, videos_seen)} de {total_lessons}"
                        set_progress(slug, progress, phase)
                    if "info: hi" not in line.lower() and (LOGIN_RE.search(line) or ERROR_RE.search(line)):
                        last_error = clean_line(line)
                        if LOGIN_RE.search(line):
                            login_failed = True
                    if phase:
                        moment = now_ms()
                        if moment - last_save >= PROGRESS_SAVE_MS:
                            with LOCK:
                                save_state_locked()
                            last_save = moment
                    with LOCK:
                        current = find_item(slug)
                        canceled = current is None or current.get("status") == "canceled"
                    if canceled:
                        terminate_tree(proc)
                        break
            returncode = proc.wait()
        except FileNotFoundError:
            returncode = -1
            last_error = "No se encontró el comando platzi en PATH."
        except OSError as exc:
            returncode = -1
            last_error = f"No se pudo iniciar el comando: {exc}"
        finally:
            with LOCK:
                CURRENT_PROC = None

        with LOCK:
            item = find_item(slug)
            if item is not None:
                if item.get("status") == "canceled":
                    item["finishedAt"] = item.get("finishedAt") or now_ms()
                elif login_failed or (last_error and LOGIN_RE.search(last_error)):
                    item["status"] = "error"
                    item["phase"] = "Error"
                    item["error"] = last_error or "La sesión de Platzi no está iniciada. Ejecuta platzi login."
                    item["finishedAt"] = now_ms()
                    STATE["session"]["loggedIn"] = False
                    STATE["session"]["checkedAt"] = now_ms()
                    STATE["session"]["message"] = item["error"]
                elif returncode != 0:
                    item["status"] = "error"
                    item["phase"] = "Error"
                    item["error"] = last_error or f"El comando terminó con código {returncode}."
                    item["finishedAt"] = now_ms()
                elif last_error and videos_seen == 0 and total_lessons == 0:
                    item["status"] = "error"
                    item["phase"] = "Error"
                    item["error"] = last_error
                    item["finishedAt"] = now_ms()
                else:
                    item["status"] = "completed"
                    item["progress"] = 100
                    item["phase"] = "Completado"
                    item["finishedAt"] = now_ms()
                    STATE["session"]["loggedIn"] = True
                    STATE["session"]["checkedAt"] = now_ms()
                    STATE["session"]["message"] = ""
                normalize_order()
                save_state_locked()
        last_save = 0


def start_worker():
    global WORKER
    WORKER = threading.Thread(target=worker_loop, name="download-worker", daemon=True)
    WORKER.start()


class ViewerHandler(SimpleHTTPRequestHandler):
    server_version = "PlatziLocal/1.0"

    def log_message(self, fmt, *args):
        pass

    def _blocked(self, path):
        return any(
            path == prefix or path.startswith(prefix + "/")
            for prefix in BLOCKED_PREFIXES
        )

    def _same_origin(self):
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return False
        host = self.headers.get("Host")
        if host and not re.fullmatch(r"(localhost|127\.0\.0\.1)(:\d+)?", host, re.I):
            return False
        return True

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status, message):
        self._send_json({"ok": False, "error": message}, status)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            raise ApiError(400, "Content-Length inválido.")
        if length > MAX_BODY:
            raise ApiError(413, "Solicitud demasiado grande.")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "JSON inválido.")
        if not isinstance(data, dict):
            raise ApiError(400, "Se esperaba un objeto JSON.")
        return data

    def do_GET(self):
        parsed = urlparse(self.path)
        path = request_path(parsed.path)
        if path in ("", "/"):
            self.send_response(302)
            self.send_header("Location", "/viewer/")
            self.end_headers()
            return
        if path == "/api/state":
            self._send_json(snapshot())
            return
        if path == "/api/catalog":
            self._send_json({"ok": True, "catalog": get_catalog_payload(), "sync": public_catalog_sync_snapshot()})
            return
        if path.startswith("/api/catalog/"):
            self._error(404, "Ruta no encontrada.")
            return
        if path == "/api/session":
            with LOCK:
                session = dict(STATE["session"])
            self._send_json({"ok": True, "session": session, "cliAvailable": cli_available(), "serverTime": now_ms()})
            return
        if path == "/api":
            self._send_json({"ok": True, "endpoints": ["state", "catalog", "catalog/refresh", "enqueue", "reorder", "cancel", "remove", "clear", "refresh"]})
            return
        if path.startswith("/api/"):
            self._error(404, "Ruta no encontrada.")
            return
        if self._blocked(path) or ".." in path.split("/"):
            self._error(404, "Ruta no encontrada.")
            return
        if self.headers.get("Range"):
            target = self.translate_path(parsed.path)
            if os.path.isfile(target) and self._send_range(target):
                return
        super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        path = request_path(parsed.path)
        if path == "/api/state":
            self._send_json(snapshot())
            return
        if self._blocked(path) or ".." in path.split("/"):
            self._error(404, "Ruta no encontrada.")
            return
        if self.headers.get("Range"):
            target = self.translate_path(parsed.path)
            if os.path.isfile(target) and self._send_range(target, head_only=True):
                return
        super().do_HEAD()

    def do_POST(self):
        if not self._same_origin():
            self._error(403, "Origen no permitido.")
            return
        path = request_path(urlparse(self.path).path).rstrip("/")
        try:
            if path == "/api/import-route":
                data = self._read_json()
                imported = import_mis_ruta(data.get("url"))
                self._send_json({"ok": True, "route": imported})
                return
            if path == "/api/enqueue":
                data = self._read_json()
                raw_items = data.get("items")
                if not isinstance(raw_items, list) or not raw_items:
                    raise ApiError(400, "Falta la lista de cursos.")
                if len(raw_items) > MAX_ENQUEUE:
                    raise ApiError(400, "Demasiados cursos en una sola solicitud.")
                position = data.get("position", "back")
                if position not in ("back", "front"):
                    raise ApiError(400, "Posición inválida.")
                added = enqueue(raw_items, position)
                result = snapshot()
                result["added"] = added
                self._send_json(result)
                return
            if path == "/api/reorder":
                data = self._read_json()
                slug = clean_slug(data.get("slug"))
                direction = data.get("direction")
                if not slug:
                    raise ApiError(400, "Curso inválido.")
                if direction not in ("up", "down"):
                    raise ApiError(400, "Dirección inválida.")
                if not reorder(slug, direction):
                    raise ApiError(409, "Ese curso ya no se puede mover.")
                self._send_json(snapshot())
                return
            if path == "/api/cancel":
                data = self._read_json()
                slug = clean_slug(data.get("slug"))
                if not slug:
                    raise ApiError(400, "Curso inválido.")
                if not cancel(slug):
                    raise ApiError(409, "Ese curso ya no está en la cola.")
                self._send_json(snapshot())
                return
            if path == "/api/remove":
                data = self._read_json()
                slug = clean_slug(data.get("slug"))
                if not slug:
                    raise ApiError(400, "Curso inválido.")
                if not remove_item(slug):
                    raise ApiError(409, "No se puede quitar ese curso.")
                self._send_json(snapshot())
                return
            if path == "/api/clear":
                self._read_json()
                clear_history()
                self._send_json(snapshot())
                return
            if path == "/api/session/check":
                self._read_json()
                result = check_session()
                self._send_json({"ok": True, "session": result, "cliAvailable": cli_available(), "serverTime": now_ms()})
                return
            if path == "/api/catalog/refresh":
                self._read_json()
                sync = start_public_catalog_sync()
                self._send_json({"ok": True, "sync": sync}, 202)
                return
            if path == "/api/refresh":
                self._read_json()
                refresh_catalog()
                self._send_json(snapshot())
                return
            raise ApiError(404, "Ruta no encontrada.")
        except ApiError as exc:
            self._error(exc.status, exc.message)
        except Exception:
            self._error(500, "Error interno del servidor.")

    def end_headers(self):
        # El visor se edita a mano: sin esto el navegador sirve copias viejas.
        if not urlparse(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def _range_bounds(self, size, header):
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", (header or "").strip())
        if not match or (not match.group(1) and not match.group(2)):
            return None
        first, last = match.group(1), match.group(2)
        if not first:
            length = int(last)
            if length <= 0:
                return None
            return max(0, size - length), size - 1
        start = int(first)
        if start >= size:
            return start, start
        end = int(last) if last else size - 1
        if end < start:
            return None
        return start, end

    def _send_range(self, file_path, head_only=False):
        """Responde 206 para que Chrome pueda buscar dentro del video."""
        try:
            size = os.path.getsize(file_path)
        except OSError:
            return False
        bounds = self._range_bounds(size, self.headers.get("Range"))
        if bounds is None:
            return False
        start, end = bounds
        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        end = min(end, size - 1)
        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", mimetypes.guess_type(file_path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(length))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(file_path)))
        self.end_headers()
        if head_only:
            return True
        try:
            with open(file_path, "rb") as handle:
                handle.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = handle.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

    def list_directory(self, path):
        self._error(404, "Ruta no encontrada.")
        return None


def import_mis_ruta(raw_url):
    """Lee cursos de una ruta compartida /mis-rutas/<id>/ sin alterar la biblioteca."""
    url = str(raw_url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ("platzi.com", "www.platzi.com"):
        raise ApiError(400, "Usa una URL https://platzi.com/mis-rutas/ID/.")
    match = re.fullmatch(r"/mis-rutas/(\d+)/?", parsed.path)
    if not match or parsed.query or parsed.fragment:
        raise ApiError(400, "La URL debe tener el formato https://platzi.com/mis-rutas/ID/.")

    from playwright.sync_api import sync_playwright
    from sync_public_catalog import read_cookies

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        try:
            context = browser.new_context(locale="es-ES")
            cookies = read_cookies()
            if cookies:
                context.add_cookies(cookies)
            page = context.new_page()
            response = page.goto(url, wait_until="domcontentloaded", timeout=90000)
            page.wait_for_timeout(1800)
            if response and response.status >= 400:
                raise ApiError(502, "Platzi respondió HTTP " + str(response.status) + " al abrir esa ruta.")
            result = page.evaluate(r"""() => {
              const trim = (v) => (v || '').replace(/\s+/g, ' ').trim();
              const title = trim(document.querySelector('h1')?.innerText) || trim(document.title) || 'Ruta de Platzi';
              const courses = new Map();
              for (const a of document.querySelectorAll('a[href]')) {
                let u;
                try { u = new URL(a.getAttribute('href'), location.href); } catch (_) { continue; }
                if (u.hostname !== 'platzi.com' && u.hostname !== 'www.platzi.com') continue;
                const m = u.pathname.match(/^\/cursos\/([a-z0-9][a-z0-9-]*)\/?$/i);
                if (!m) continue;
                const slug = m[1].toLowerCase();
                if (courses.has(slug)) continue;
                const card = a.closest('article, li, [class*="course"], [data-testid*="course"]') || a;
                const heading = trim(card.querySelector('h2,h3,h4')?.innerText) || trim(a.getAttribute('aria-label')) || trim(a.innerText) || slug;
                courses.set(slug, {slug, title: heading.slice(0, 180), url: 'https://platzi.com/cursos/' + slug + '/'});
              }
              return {title, courses: Array.from(courses.values())};
            }""")
            if not isinstance(result, dict) or not result.get("courses"):
                raise ApiError(422, "No encontré cursos en esa página. Comprueba que la ruta sea visible con tu sesión de Platzi.")
            return {"title": result.get("title") or "Ruta de Platzi", "url": url, "courses": result["courses"][:MAX_ENQUEUE]}
        finally:
            browser.close()


def port_in_use(host, port):
    """True si ya hay algo escuchando: evita un segundo worker sobre el mismo estado."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.6)
        try:
            return sock.connect_ex((host, port)) == 0
        except OSError:
            return False


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    if port_in_use(HOST, PORT):
        print(f"El puerto {PORT} ya esta en uso: quiza ya hay un servidor de Platzi Local.")
        print(f"Abre http://localhost:{PORT}/viewer/ o cierra el otro proceso (o define otro PORT).")
        return 1
    load_state()
    start_worker()
    if not cli_available():
        print("Aviso: no se encontro 'platzi' en PATH. Define PLATZI_BIN o instala el CLI.")
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), lambda *args, **kwargs: ViewerHandler(*args, directory=str(ROOT), **kwargs))
    except OSError as exc:
        print(f"No se pudo abrir http://{HOST}:{PORT}: {exc}")
        print("Cierra el servidor anterior o define otro PORT.")
        return 1
    print(f"Platzi Local en http://localhost:{PORT}/viewer/")
    print("Descargas: cola local en scripts/download_state.json. Ctrl+C para detener.")
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nDeteniendo servidor...")
    finally:
        STOP.set()
        with LOCK:
            proc = CURRENT_PROC
        terminate_tree(proc)
        httpd.server_close()
        with LOCK:
            save_state_locked()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
