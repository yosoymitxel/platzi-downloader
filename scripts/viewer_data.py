"""Genera viewer/data.js (datos del visor offline) y descarga sus portadas.

Entradas (scripts/): rutas_cursos.json, rutas_duraciones.json, cursos_progreso.json,
certificados.json, titles_extra.json, cola_descarga.json, cursos_covers.json,
rutas_covers.json, rutas.json y viewer_overrides.json (mapeo manual carpeta->slug).

Salidas:
- viewer/data.js                        (window.PLATZI_LOCAL = {...})
- viewer/assets/covers/<slug>.<ext>     (portadas de cursos)
- viewer/assets/rutas/<id>.<ext>        (portadas de rutas)
- scripts/viewer_durations_cache.json   (cache de duraciones ffprobe)
- scripts/viewer_overrides.json         (se completa con null en carpetas sin match)

Uso: python scripts/viewer_data.py
"""
import json
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

SDIR = Path(__file__).resolve().parent
ROOT = SDIR.parent
COURSES = ROOT / "Courses"
VIEWER = ROOT / "viewer"
COVERS_DIR = VIEWER / "assets" / "covers"
RUTAS_DIR = VIEWER / "assets" / "rutas"
OUT_DATA = VIEWER / "data.js"
DUR_CACHE = SDIR / "viewer_durations_cache.json"
OVERRIDES = SDIR / "viewer_overrides.json"

FUZZY_MIN = 0.86          # umbral de similitud carpeta -> titulo
WORKERS = 8               # hilos para ffprobe y descargas
HTTP_TIMEOUT = 20
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
    ),
    "Referer": "https://platzi.com/",
}
EXT_BY_TYPE = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
NUM_PREFIX = re.compile(r"^\s*(\d{1,4})")
PREFIX_STRIP = re.compile(r"^\s*\d{1,4}\s*[-_.–—)]*\s*")
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def load(name, default=None):
    p = SDIR / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def dump(path, obj, pretty=True):
    txt = json.dumps(obj, ensure_ascii=False, indent=2 if pretty else None,
                     separators=None if pretty else (",", ":"))
    path.write_text(txt, encoding="utf-8")


def norm(s):
    """Minusculas sin acentos y solo [a-z0-9 ], para comparar titulos."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return " ".join(s.split())


def sort_key(name):
    """Orden por prefijo numerico; sin prefijo, alfabetico al final."""
    m = NUM_PREFIX.match(name)
    if m:
        return (0, int(m.group(1)), name.lower())
    return (1, 0, name.lower())


def strip_prefix(name):
    """Titulo visible: quita el prefijo numerico del nombre de archivo."""
    return PREFIX_STRIP.sub("", name).strip() or name


def run_ffprobe(path):
    """Duracion en segundos via ffprobe, o None si falla o es <= 1 s."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120, creationflags=CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    txt = (out.stdout or "").strip().splitlines()
    if not txt:
        return None
    try:
        secs = float(txt[0].strip().rstrip(","))
    except ValueError:
        return None
    if secs <= 1:
        return None
    return int(round(secs))


# --- escaneo de Courses/ -----------------------------------------------------

def scan_course(folder):
    """Devuelve (modulos, total_mp4) de una carpeta de curso ya en disco."""
    modules = []
    for mod in sorted((d for d in folder.iterdir() if d.is_dir()), key=lambda p: sort_key(p.name)):
        classes = []
        for f in sorted((x for x in mod.iterdir() if x.is_file() and x.suffix.lower() == ".mp4"),
                        key=lambda p: sort_key(p.name)):
            classes.append(f)
        if classes:  # modulos sin mp4 se omiten
            modules.append((mod.name, classes))
    # mp4 sueltos en la raiz del curso: modulo "Clases" para no perderlos
    loose = sorted((x for x in folder.iterdir() if x.is_file() and x.suffix.lower() == ".mp4"),
                   key=lambda p: sort_key(p.name))
    if loose:
        modules.append(("Clases", loose))
    total = sum(1 for _ in folder.rglob("*.mp4"))
    return modules, total


def build_module(folder_name, mod_name, files):
    """Construye el objeto modulo del esquema §2 (clases + subtitulos)."""
    lookup = {x.name.lower(): x.name for x in files[0].parent.iterdir() if x.is_file()}
    classes = []
    for f in files:
        subs = {}
        for lang in ("es", "en", "pt"):
            hit = lookup.get(f"{f.stem}_{lang}.vtt".lower())
            if hit:
                subs[lang] = "../Courses/%s/%s/%s" % (folder_name, mod_name, hit)
        classes.append({
            "src": "../Courses/%s/%s/%s" % (folder_name, mod_name, f.name),
            "title": strip_prefix(f.stem),
            "durationSec": None,          # lo rellena apply_durations
            "subs": subs,
        })
    return {"name": mod_name, "classes": classes}


# --- duraciones con cache ----------------------------------------------------

def fill_durations(courses_scan):
    """Rellena durationSec de cada clase usando ffprobe y el cache por mtime."""
    cache = load("viewer_durations_cache.json", {}) or {}
    if not isinstance(cache, dict):
        cache = {}
    tasks = []  # (modulo, clase, ruta_absoluta, clave_cache, mtime)
    for _folder, modules, _total in courses_scan.values():
        for mod in modules:
            for cls in mod["classes"]:
                abs_path = ROOT / cls["src"].replace("../", "", 1)
                try:
                    mtime = int(abs_path.stat().st_mtime)
                except OSError:
                    mtime = 0
                key = abs_path.relative_to(ROOT).as_posix()
                tasks.append((cls, abs_path, key, mtime))

    hits, pending = 0, []
    for cls, abs_path, key, mtime in tasks:
        ent = cache.get(key)
        if isinstance(ent, list) and len(ent) == 2 and ent[0] == mtime:
            cls["durationSec"] = ent[1] if isinstance(ent[1], int) else None
            hits += 1
        else:
            pending.append((cls, abs_path, key, mtime))

    new_cache = {}
    for cls, _abs_path, key, mtime in tasks:
        if cls["durationSec"] is not None:
            new_cache[key] = [mtime, cls["durationSec"]]

    probed = 0
    if pending and shutil.which("ffprobe"):
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            results = list(pool.map(lambda t: run_ffprobe(t[1]), pending))
        for (cls, _abs_path, key, mtime), secs in zip(pending, results):
            cls["durationSec"] = secs
            if secs is not None:
                new_cache[key] = [mtime, secs]
            probed += 1
    dump(DUR_CACHE, dict(sorted(new_cache.items())), pretty=False)
    return hits, probed


# --- portadas ----------------------------------------------------------------

def safe_name(s):
    """Nombre de archivo seguro: solo [A-Za-z0-9._-]."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", s or "").strip("._") or "cover"


def find_asset(directory, slug):
    """Nombre de una portada ya descargada para el slug, o None."""
    for p in sorted(directory.glob(safe_name(slug) + ".*")):
        if p.is_file() and p.suffix.lower() in IMG_EXTS:
            return p.name
    return None


def url_ext(url):
    """Extension segun la URL; .jpg por defecto."""
    suffix = Path(urllib.parse.urlparse(url or "").path).suffix.lower()
    if suffix in IMG_EXTS:
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".jpg"


def fetch_cover(slug, url, directory):
    """Descarga una portada. Devuelve (estado, nombre_archivo|None)."""
    name = find_asset(directory, slug)
    if name:
        return "cache", name
    data, ctype = None, ""
    for _ in range(2):  # 1 reintento
        try:
            req = urllib.request.Request(url, headers=HTTP_HEADERS)
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                ctype = (resp.headers.get_content_type() or "").lower()
                data = resp.read()
            if data:
                break
        except (urllib.error.URLError, OSError, ValueError):
            data, ctype = None, ""
    if not data:
        return "fail", None
    name = safe_name(slug) + (EXT_BY_TYPE.get(ctype) or url_ext(url))
    target = directory / name
    tmp = target.with_name(target.name + ".part")
    try:
        tmp.write_bytes(data)
        tmp.replace(target)
    except OSError:
        return "fail", None
    return "ok", name


def fetch_covers(pairs, directory):
    """Descarga portadas en paralelo por lotes. pairs = [(slug, url)].

    Devuelve (mapa slug->ruta relativa, conteos). Si un lote entero falla sin
    una sola descarga, considera la red caida y no sigue intentando el resto.
    """
    directory.mkdir(parents=True, exist_ok=True)
    mapping, counts = {}, {"ok": 0, "cache": 0, "fail": 0}
    chunk_size = 32
    for start in range(0, len(pairs), chunk_size):
        chunk = pairs[start:start + chunk_size]
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            results = list(pool.map(lambda p: (p[0],) + fetch_cover(p[0], p[1], directory), chunk))
        for slug, status, name in results:
            counts[status] += 1
            if name:
                mapping[slug] = "%s/%s" % (directory.relative_to(VIEWER).as_posix(), name)
        if counts["ok"] + counts["cache"] == 0 and counts["fail"] >= len(chunk):
            counts["fail"] += len(pairs) - start - len(chunk)
            break
    return mapping, counts


# --- programa ----------------------------------------------------------------

def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    rutas = load("rutas_cursos.json", {}) or {}
    horas = load("rutas_duraciones.json", {}) or {}
    progreso = (load("cursos_progreso.json", {}) or {}).get("courses") or []
    certs = (load("certificados.json", {}) or {}).get("certs") or []
    titles_extra = load("titles_extra.json", {}) or {}
    cola = load("cola_descarga.json", {}) or {}
    cover_urls = load("cursos_covers.json", {}) or {}
    route_cover_urls = load("rutas_covers.json", {}) or {}
    rutas_meta = (load("rutas.json", {}) or {}).get("routes") or []
    overrides = load("viewer_overrides.json", {}) or {}
    if not isinstance(overrides, dict):
        overrides = {}

    # --- titulos conocidos por slug
    titles = {}
    for slug, v in horas.items():
        if isinstance(v, dict) and v.get("title"):
            titles.setdefault(slug, v["title"])
    for c in progreso:
        titles.setdefault(c["slug"], c["title"])
    for c in certs:
        titles.setdefault(c["slug"], c["title"])
    for slug, t in titles_extra.items():
        titles.setdefault(slug, t)
    title_norms = {s: norm(t) for s, t in titles.items()}

    prog_by_slug = {c["slug"]: c for c in progreso}
    cert_by_slug = {c["slug"]: c for c in certs}

    # --- carpetas descargadas -> slug
    folders = sorted((d for d in COURSES.iterdir() if d.is_dir()), key=lambda p: p.name.lower()) \
        if COURSES.exists() else []
    slug_to_folder, unmatched, learned, duplicated = {}, [], [], []
    for d in folders:
        ov = overrides.get(d.name)
        if isinstance(ov, str) and ov.strip():
            slug = ov.strip()
        elif d.name in overrides:  # null explicito: no mapear
            slug = None
        else:
            n = norm(d.name)
            slug = next((s for s, tn in sorted(title_norms.items()) if tn == n), None)
            if slug is None:
                best, score = None, 0.0
                for s, tn in sorted(title_norms.items()):
                    r = SequenceMatcher(None, n, tn).ratio()
                    if r > score:
                        best, score = s, r
                if score >= FUZZY_MIN:
                    slug = best
            if slug:
                learned.append((d.name, slug, "difusa" if norm(titles[slug]) != n else "exacta"))
        if slug is None:
            unmatched.append(d.name)
            if d.name not in overrides:
                overrides[d.name] = None
            continue
        if slug in slug_to_folder:
            duplicated.append((d.name, slug))
            continue
        slug_to_folder[slug] = d.name

    # --- escaneo de las carpetas
    scan = {}  # slug -> (carpeta, modulos, total_mp4)
    for slug, folder_name in sorted(slug_to_folder.items()):
        modules, total = scan_course(COURSES / folder_name)
        scan[slug] = (folder_name, [build_module(folder_name, m, f) for m, f in modules], total)

    dur_hits, dur_probed = fill_durations(scan)

    # --- universo de cursos
    universe = set(slug_to_folder)
    for info in rutas.values():
        universe.update(info.get("courses") or [])
    universe.update(prog_by_slug)
    universe.update(cert_by_slug)

    # --- portadas
    covers, cover_counts = fetch_covers(
        [(s, cover_urls[s]) for s in sorted(universe) if cover_urls.get(s)], COVERS_DIR)

    queued = {it.get("slug") for it in (cola.get("queue_unfinished") or []) if isinstance(it, dict)}

    # --- rutas que contienen cada slug
    slug_routes = {}
    for rid, info in rutas.items():
        for s in info.get("courses") or []:
            slug_routes.setdefault(s, []).append(rid)

    # --- cursos
    courses = []
    total_classes = total_duration = 0
    downloaded_count = 0
    for slug in sorted(universe):
        folder_name = slug_to_folder.get(slug)
        title = titles.get(slug) or folder_name or slug
        rec = prog_by_slug.get(slug)
        cert = cert_by_slug.get(slug)
        modules = None
        if folder_name:
            _folder, modules, mp4_total = scan[slug]
            downloaded = mp4_total >= 1
        else:
            modules, downloaded = [], False
        classes_total = sum(len(m["classes"]) for m in modules)
        secs = [c["durationSec"] for m in modules for c in m["classes"] if c["durationSec"] is not None]
        course_secs = sum(secs) if secs else None
        if downloaded:
            downloaded_count += 1
            total_classes += classes_total
            total_duration += course_secs or 0
        courses.append({
            "slug": slug,
            "url": "https://platzi.com/cursos/%s/" % slug,
            "title": title,
            "folder": folder_name,
            "routes": slug_routes.get(slug, []),
            "hours": (horas.get(slug) or {}).get("hours") if isinstance(horas.get(slug), dict) else None,
            "category": (rec or {}).get("category"),
            "cert": {"date": (cert.get("approved_date") or "")[:10], "url": cert.get("diploma_url")} if cert else None,
            "platzi": {
                "done": rec.get("pos_material"),
                "total": rec.get("total_materials"),
                "at": (rec.get("watched_at") or "")[:10] or None,
                "last": rec.get("last_material"),
            } if rec else None,
            "cover": covers.get(slug) or None,
            "coverRemote": (cover_urls.get(slug) or None) if not covers.get(slug) else None,
            "queued": slug in queued and not downloaded,
            "downloaded": downloaded,
            "classesTotal": classes_total if downloaded else 0,
            "durationSec": course_secs if downloaded else None,
            "modules": modules,
        })

    # --- horas de rutas: rutas.json por titulo (plural aproximado)
    def plural_key(s):
        return " ".join(w.rstrip("s") for w in norm(s).split())

    hours_by_norm, hours_by_plural = {}, {}
    for m in rutas_meta:
        if m.get("duration_hours") is None:
            continue
        hours_by_norm.setdefault(norm(m.get("title")), m["duration_hours"])
        hours_by_plural.setdefault(plural_key(m.get("title")), m["duration_hours"])

    def route_hours(title):
        n = norm(title)
        if n in hours_by_norm:
            return hours_by_norm[n]
        if plural_key(title) in hours_by_plural:
            return hours_by_plural[plural_key(title)]
        best, score = None, 0.0
        for k, v in hours_by_norm.items():
            r = SequenceMatcher(None, n, k).ratio()
            if r > score:
                best, score = v, r
        return best if score >= FUZZY_MIN else None

    route_list = [k for k, v in rutas.items() if v.get("courses")]
    route_covers, route_cover_counts = fetch_covers(
        [(rid, route_cover_urls[rid]) for rid in sorted(route_list) if route_cover_urls.get(rid)],
        RUTAS_DIR)

    routes = [{
        "id": rid,
        "title": rutas[rid].get("route_title") or rid,
        "pct": rutas[rid].get("percentage"),
        "hours": route_hours(rutas[rid].get("route_title") or rid),
        "coursesCount": len(rutas[rid].get("courses") or []),
        "cover": route_covers.get(rid) or None,
        "courses": list(rutas[rid].get("courses") or []),
    } for rid in route_list]
    routes.sort(key=lambda r: (-(r["pct"] or 0), r["title"].lower()))

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stats": {
            "courses": len(courses),
            "downloaded": downloaded_count,
            "classes": total_classes,
            "durationSec": total_duration,
        },
        "routes": routes,
        "courses": courses,
    }
    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    OUT_DATA.write_text(
        "window.PLATZI_LOCAL = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8")

    if unmatched:
        dump(OVERRIDES, dict(sorted(overrides.items())))

    # --- reporte
    def fmt_span(sec):
        h, m = divmod(int(sec) // 60, 60)
        return f"{h} h {m} min" if h else f"{m} min"

    print(f"cursos: {len(courses)} | descargados: {downloaded_count} | clases en disco: "
          f"{total_classes} | duracion total: {fmt_span(total_duration)}")
    print(f"rutas: {len(routes)} | portadas de curso: {cover_counts['ok']} nuevas, "
          f"{cover_counts['cache']} en cache, {cover_counts['fail']} fallidas | "
          f"portadas de ruta: {route_cover_counts['ok']} nuevas, {route_cover_counts['cache']} en cache, "
          f"{route_cover_counts['fail']} fallidas")
    print(f"carpetas emparejadas: {len(slug_to_folder)} | duraciones: {dur_hits} de cache, {dur_probed} con ffprobe")
    if learned:
        print("  " + " | ".join(f"{f} -> {s} ({how})" for f, s, how in learned))
    if unmatched:
        print(f"carpetas sin match ({len(unmatched)}): {unmatched}")
    if duplicated:
        print(f"carpetas duplicadas para un mismo slug (ignoradas): {duplicated}")
    if not shutil.which("ffprobe"):
        print("AVISO: ffprobe no esta en PATH; durationSec queda en null")
    print(f"data.js: {OUT_DATA.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
