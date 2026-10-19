"""Plan de expansion de la cola: estima peso real y ordena candidatos por prioridad.

Salida:
- scripts/expansion_plan.json  (analisis completo)
- scripts/cola_descarga.json.new (cola lista para revisar y reemplazar)
"""
import json
import re
import shutil
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

SDIR = Path(__file__).resolve().parent
ROOT = SDIR.parent
COURSES = ROOT / "Courses"

MARGIN_GB = 25.0


def load(name, default=None):
    p = SDIR / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return " ".join(s.split())


# Orden de prioridad: intereses declarados -> rutas en curso -> resto.
PRIORITY = [
    "idioma-ingles",       # inglés (interés #1)
    "beginner-core2",      # inglés A2 en curso
    "beginner-core",       # inglés A1
    "ainative",            # claude / IA (interés #2)
    "desarrollo-react",    # react (interés #4)
    "web-react",
    "desarrollo-php",      # laravel / php (interés #3)
    "contenerizacion-y-orquestacion",
    "infraestructura-como-codigo-iac-y-ci-cd",
    "asp-net",
    "fundamentos-de-cloud-y-devops",
    "devops-y-cloud-para-desarrolladores-web",
    "web-vue",
    "fundamentos-data",
    "seguridad-informatica",
    "desarrollo-web",
    "estratega",
    "desarrollo-java",
    "content-creator",
    "finanzas-legacy",
    "base-de-datos",
    "backend-python",
    "javascript-full-stack",
    "motores-videojuegos",
    "arquitecturas-web-modernas-y-escalabilidad",
    "data-scientist-python",
    "ux",
    "gd",
    "contenido-audiovisual",
    "desarrollo-wordpress",
    "administracion-de-servidores-linux",
]

# Solo intereses (eleccion del usuario): ingles (solo A2) / IA / React (web) / PHP.
# El resto queda fuera y es podable. Podas acumuladas: sin C# (asp-net), sin Vue (web-vue),
# sin motores de videojuegos, sin contenerizacion, sin fundamentos de cloud, sin fundamentos-data.
ALLOW = [
    "idioma-ingles",
    "ainative",
    "desarrollo-react",
    "web-react",
    "desarrollo-php",
    "infraestructura-como-codigo-iac-y-ci-cd",
    "devops-y-cloud-para-desarrolladores-web",
    "seguridad-informatica",
    "desarrollo-web",
]

# Filtros finos por bloque: si el bloque aparece aca, solo pasan estos slugs.
KEEP_SLUGS = {
    # ingles: solo nivel A2
    "idioma-ingles": {
        "cantidad-gerundios", "infinitivos", "conjunciones-superlativos",
        "experiencias-pasadas", "ingles-basico-descripciones-comparativos",
        "basico-preguntas-respuestas", "articulos-verbosmodales",
        "adverbios",
    },
    # IaC: solo GitHub Actions (terraform fuera)
    "infraestructura-como-codigo-iac-y-ci-cd": {"github-actions"},
    # seguridad: solo lo directamente relacionado con web
    "seguridad-informatica-old": {"hacking-aplicaciones-web-server-side"},
    # desarrollo-web: solo lo directamente relacionado con PHP o React
    "desarrollo-web": {"webpack-practico", "nextjs-graphql"},
}

# Podas puntuales dentro de bloques permitidos (slugs exactos).
PODA_SLUGS = {
    # Angular (dentro del bloque desarrollo-web)
    "angular16", "angular-componentes", "angular-apis", "angular-modular",
    "angular-unit-testing-servicios", "angular-unit-testing-componentes",
    "angular-unit-testing-formularios", "angular-unit-testing-routing",
    "angular-performance", "angular-forms",
    # Videojuegos: no interesan por ahora (no hay ninguno "con IA" en la cola)
    "javascript-practico-videojuegos",
    "unity2dintermedio", "introduccion-godot", "introduccion-moviles-unity",
    # React Native (no es web), Laravel+Vue, y de la cola original: RN y hacking generico
    "react-native-listas-apis", "react-native-formularios-almacenamiento",
    "laravel-spa", "react-native", "ethical-hacking",
}


def allowed(key):
    nk = norm(key)
    for a in ALLOW:
        na = norm(a)
        if nk == na or nk.startswith(na) or na.startswith(nk):
            return True
    return False


def route_rank(key):
    nk = norm(key)
    for i, p in enumerate(PRIORITY):
        np_ = norm(p)
        if nk.startswith(np_) or np_.startswith(nk):
            return i
    return len(PRIORITY)


def folder_size_mb(d: Path) -> float:
    total = 0
    for f in d.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except OSError:
                pass
    return total / 1e6


rutas = load("rutas_cursos.json", {})
dur = load("rutas_duraciones.json", {})
certs = load("certificados.json", {"certs": []})["certs"]
prog = load("cursos_progreso.json", {"courses": []})["courses"]
cola = load("cola_descarga.json", {})
overrides = load("viewer_overrides.json", {})

cert_slugs = {c["slug"] for c in certs}
queue_all = set()
for it in cola.get("queue_unfinished", []):
    queue_all.add(it["slug"])
for it in cola.get("queue_certified", []):
    queue_all.add(it["slug"])

titles = {}
for slug, v in dur.items():
    if v.get("title"):
        titles.setdefault(slug, v["title"])
for c in prog:
    titles.setdefault(c["slug"], c["title"])
for c in certs:
    titles.setdefault(c["slug"], c["title"])
extra_titles = load("titles_extra.json", {})
for slug, t in extra_titles.items():
    titles.setdefault(slug, t)

# --- carpetas descargadas -> slug ---
folders = [d for d in COURSES.iterdir() if d.is_dir()] if COURSES.exists() else []
title_norms = {slug: norm(t) for slug, t in titles.items()}

folder_map = {}
unmatched = []
for d in folders:
    n = norm(d.name)
    if d.name in overrides:
        slug = overrides[d.name]
    else:
        slug = None
        for s, tn in title_norms.items():
            if tn == n:
                slug = s
                break
        if slug is None:
            best, score = None, 0.0
            for s, tn in title_norms.items():
                r = SequenceMatcher(None, n, tn).ratio()
                if r > score:
                    best, score = s, r
            if score >= 0.86:
                slug = best
    if slug is None:
        unmatched.append(d.name)
    else:
        folder_map.setdefault(slug, (d.name, folder_size_mb(d)))

# --- calibracion MB/hora ---
samples = []
for slug, (fname, mb) in folder_map.items():
    h = (dur.get(slug) or {}).get("hours")
    if h and h > 0 and mb > 50:
        samples.append(
            {
                "slug": slug,
                "folder": fname,
                "mb": round(mb),
                "hours": h,
                "mb_per_hour": round(mb / h),
            }
        )
mbh = sorted(s["mb_per_hour"] for s in samples)
cal = load("calibracion_ratio.json")
if isinstance(cal, dict) and cal.get("mb_per_hour_weighted"):
    ratio = float(cal["mb_per_hour_weighted"])
    ratio_source = "ffprobe ponderado (real)"
else:
    ratio = mbh[len(mbh) // 2] if mbh else 250.0
    ratio_source = "mediana de muestras"

all_hours = sorted(v["hours"] for v in dur.values() if v.get("hours"))
med_h = all_hours[len(all_hours) // 2] if all_hours else 3.0

# --- candidatos en orden de prioridad ---
downloaded_slugs = set(folder_map.keys())
route_keys = sorted(
    rutas.keys(), key=lambda k: (route_rank(k), -(rutas[k].get("percentage") or 0))
)

cand = []
skipped_cert = 0
skipped_queue = 0
skipped_downloaded = 0
skipped_nointeres = 0
skipped_poda = 0
skipped_fino = 0
sin_titulo = []
sin_horas = 0
seen = set()
for k in route_keys:
    info = rutas[k]
    pct = info.get("percentage")
    if not allowed(k):
        for slug in info.get("courses", []):
            if slug in seen:
                continue
            seen.add(slug)
            if slug in cert_slugs:
                skipped_cert += 1
            elif slug in queue_all:
                skipped_queue += 1
            elif slug in downloaded_slugs:
                skipped_downloaded += 1
            else:
                skipped_nointeres += 1
        continue
    for slug in info.get("courses", []):
        if slug in seen:
            continue
        seen.add(slug)
        if slug in PODA_SLUGS:
            skipped_poda += 1
            continue
        keep = KEEP_SLUGS.get(k)
        if keep is not None and slug not in keep:
            skipped_fino += 1
            continue
        if slug in cert_slugs:
            skipped_cert += 1
            continue
        if slug in queue_all:
            skipped_queue += 1
            continue
        if slug in downloaded_slugs:
            skipped_downloaded += 1
            continue
        if slug not in titles:
            sin_titulo.append(slug)
            continue
        h = (dur.get(slug) or {}).get("hours")
        est = (h or med_h) * ratio / 1024.0
        if not h:
            sin_horas += 1
        cand.append(
            {
                "slug": slug,
                "title": titles[slug],
                "hours": h,
                "est_gb": round(est, 3),
                "route": k,
                "route_title": info.get("route_title"),
                "route_pct": pct,
                "hours_est": h is None,
            }
        )

# --- presupuesto ---
free = shutil.disk_usage(str(ROOT)).free / 2**30
q_rem = 0.0
q_rem_n = 0
for it in cola.get("queue_unfinished", []):
    slug = it["slug"]
    if slug in downloaded_slugs or slug in PODA_SLUGS:
        continue
    h = (dur.get(slug) or {}).get("hours") or med_h
    q_rem += h * ratio / 1024.0
    q_rem_n += 1

available = free - MARGIN_GB - q_rem
sel, skipped = [], []
cum = 0.0
for c in cand:
    if cum + c["est_gb"] <= available:
        sel.append(c)
        cum += c["est_gb"]
    else:
        skipped.append(c)

total_cand = sum(c["est_gb"] for c in cand)

plan = {
    "computed_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    "ratio_mb_per_hour": ratio,
    "ratio_source": ratio_source,
    "ratio_samples": samples,
    "median_hours_fallback": med_h,
    "disk": {
        "free_gb": round(free, 1),
        "queue_remaining_est_gb": round(q_rem, 1),
        "queue_remaining_courses": q_rem_n,
        "margin_gb": MARGIN_GB,
        "available_for_new_gb": round(available, 1),
    },
    "counts": {
        "routes": len(route_keys),
        "universe": len(seen),
        "candidates": len(cand),
        "selected": len(sel),
        "skipped_budget": len(skipped),
        "skipped_cert": skipped_cert,
        "skipped_queue": skipped_queue,
        "skipped_downloaded": skipped_downloaded,
        "skipped_nointeres": skipped_nointeres,
        "skipped_poda": skipped_poda,
        "skipped_fino_bloque": skipped_fino,
        "sin_titulo": sin_titulo,
        "candidatos_sin_horas": sin_horas,
    },
    "totals_gb": {
        "candidates": round(total_cand, 1),
        "selected": round(cum, 1),
        "skipped": round(total_cand - cum, 1),
        "projected_free_after_gb": round(free - q_rem - cum, 1),
    },
    "selected": sel,
    "skipped": skipped,
    "unmatched_folders": unmatched,
}
(SDIR / "expansion_plan.json").write_text(
    json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8"
)

# --- cola nueva ---
new_entries = [
    {
        "slug": c["slug"],
        "title": c["title"],
        "group": c["route"],
        "pos": None,
        "total": None,
        "watched_at": None,
        "cert_date": None,
        "affinity": c["route_pct"],
        "routes": [
            {
                "slug": c["route"],
                "title": c["route_title"],
                "percentage": c["route_pct"],
            }
        ],
        "est_gb": c["est_gb"],
        "hours": c["hours"],
    }
    for c in sel
]
existing = [
    it for it in cola.get("queue_unfinished", []) if it["slug"] not in PODA_SLUGS
]
podados_existentes = len(cola.get("queue_unfinished", [])) - len(existing)
new_cola = dict(cola)
new_cola["queue_unfinished"] = existing + new_entries
new_cola["expansion"] = {
    "added": len(new_entries),
    "plan": "expansion_plan.json",
    "est_gb_total": round(
        sum(c["est_gb"] for c in sel) + q_rem, 1
    ),
}
(SDIR / "cola_descarga.json.new").write_text(
    json.dumps(new_cola, ensure_ascii=False, indent=2), encoding="utf-8"
)

# --- reporte ---
print(f"ratio calibrado: {ratio} MB/h  ({len(samples)} muestras)")
print(f"disco libre: {free:.1f} GB | cola actual pendiente: {q_rem:.1f} GB ({q_rem_n} cursos)")
print(f"margen: {MARGIN_GB} GB | disponible para nuevos: {available:.1f} GB")
print(
    f"universo: {len(seen)} | ya en cola: {skipped_queue} | certificados: {skipped_cert} | descargados: {skipped_downloaded} | fuera por interes: {skipped_nointeres}"
)
print(f"candidatos nuevos: {len(cand)} (~{total_cand:.1f} GB)")
print(f"SELECCIONADOS: {len(sel)} (~{cum:.1f} GB) | fuera por presupuesto: {len(skipped)}")
if skipped_poda or podados_existentes:
    print(
        f"podados por interes: {skipped_poda} candidatos + {podados_existentes} de la cola existente"
    )
if skipped_fino:
    print(f"filtrados finos por bloque: {skipped_fino} candidatos")
print(f"libre proyectado al terminar todo: {free - q_rem - cum:.1f} GB")
if sin_titulo:
    print(f"sin titulo (excluidos): {len(sin_titulo)} -> {sin_titulo[:10]}")
if unmatched:
    print(f"carpetas sin match: {unmatched}")
print("\nprimeros 15 seleccionados:")
for c in sel[:15]:
    print(f"  {c['est_gb']:5.2f} GB  {c['slug']:40s} [{c['route']}]")
if skipped:
    print("\nprimeros 10 fuera:")
    for c in skipped[:10]:
        print(f"  {c['est_gb']:5.2f} GB  {c['slug']:40s} [{c['route']}]")

sel_by_route = {}
for c in sel:
    sel_by_route.setdefault(c["route"], [0, 0])
    sel_by_route[c["route"]][0] += 1
for k in route_keys:
    tot = sum(1 for c in cand if c["route"] == k)
    if tot:
        inc = sel_by_route.get(k, [0])[0]
        print(f"  ruta {k:50s} {inc}/{tot} cursos")

# listado por ruta para podar (pedir al usuario que diga que no le interesa)
lines = []
for k in route_keys:
    if not allowed(k):
        continue
    items = [c for c in sel if c["route"] == k]
    if not items:
        continue
    tot_gb = sum(c["est_gb"] for c in items)
    lines.append(f"## {k} ({len(items)} cursos, ~{tot_gb:.0f} GB)")
    for cu in items:
        lines.append(f"- {cu['slug']} — {cu['title']}")
    lines.append("")
(SDIR / "cola_por_ruta.txt").write_text("\n".join(lines), encoding="utf-8")
