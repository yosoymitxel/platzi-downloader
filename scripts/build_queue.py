"""Construye la cola de descarga priorizada cruzando progreso, certificados y rutas.

Lee:  scripts/cursos_progreso.json + scripts/certificados.json + scripts/rutas_cursos.json
Genera: scripts/cola_descarga.json  (queue_unfinished + queue_certified)

Orden: grupos pedidos por el usuario (ingles, claude, laravel/php, react) primero;
dentro de cada grupo y en 'resto' se ordena por afinidad con las rutas inscritas
(maximo % de avance de las rutas que contienen el curso) y luego actividad reciente.
"""
import json
import re
from pathlib import Path

SDIR = Path(__file__).resolve().parent
prog = json.loads((SDIR / "cursos_progreso.json").read_text(encoding="utf-8"))
certs = json.loads((SDIR / "certificados.json").read_text(encoding="utf-8"))
ruts = json.loads((SDIR / "rutas_cursos.json").read_text(encoding="utf-8"))

cert_slugs = {c["slug"] for c in certs["certs"] if c.get("slug")}
cert_dates = {
    c["slug"]: (c.get("approved_date") or "")[:10] for c in certs["certs"] if c.get("slug")
}

# slug de curso -> [(slug_ruta, titulo_ruta, porcentaje)]
course_routes = {}
for rslug, info in ruts.items():
    pct = info.get("percentage")
    for cslug in info.get("courses") or []:
        course_routes.setdefault(cslug, []).append((rslug, info.get("route_title"), pct))

# Cursos NUEVOS de Claude (nunca iniciados) que estan en la ruta AI-Native:
# el usuario pidio "cursos de claude" como prioridad, asi que se agregan a la cola.
AINATIVE = ruts.get("ainative", {})
extra_claude = [s for s in (AINATIVE.get("courses") or []) if "claude" in s]

GROUPS = [
    ("ingles", re.compile(r"ingl[eé]s|english", re.I)),
    ("claude", re.compile(r"claude|openclaw|devs-ai|spec-driven", re.I)),
    ("laravel/php", re.compile(r"laravel|php", re.I)),
    ("react", re.compile(r"react|nextjs", re.I)),
]

courses = []
for c in prog["courses"]:
    key = f"{c['slug']} {c.get('title') or ''}"
    group = None
    for g, pat in GROUPS:
        if pat.search(key):
            group = g
            break
    routes = sorted(
        course_routes.get(c["slug"], []),
        key=lambda r: (r[2] if r[2] is not None else -1),
        reverse=True,
    )
    affinity = max((r[2] for r in routes if r[2] is not None), default=None)
    courses.append(
        {
            **c,
            "group": group,
            "certified": c["slug"] in cert_slugs,
            "cert_date": cert_dates.get(c["slug"]),
            "routes": routes,
            "affinity": affinity,
        }
    )

unfinished = [c for c in courses if not c["certified"]]
certified = [c for c in courses if c["certified"]]


def ascore(c):
    """afinidad con rutas activas (desc) y luego actividad reciente (desc)."""
    aff = c["affinity"] if c["affinity"] is not None else -1
    return (aff, c.get("watched_at") or "")


extra_courses = [
    {
        "slug": s,
        "title": f"{s} (nuevo)",
        "group": "claude",
        "pos_material": None,
        "total_materials": None,
        "watched_at": None,
        "certified": False,
        "cert_date": None,
        "routes": [("ainative", AINATIVE.get("route_title"), AINATIVE.get("percentage"))],
        "affinity": AINATIVE.get("percentage"),
    }
    for s in extra_claude
]

queue = []
for g, _ in GROUPS:
    queue.extend(sorted([c for c in unfinished if c["group"] == g], key=ascore, reverse=True))
    if g == "claude":
        queue.extend(extra_courses)
queue.extend(sorted([c for c in unfinished if c["group"] is None], key=ascore, reverse=True))
certified.sort(key=ascore, reverse=True)


def item(c):
    return {
        "slug": c["slug"],
        "title": c["title"],
        "group": c["group"] or "resto",
        "pos": c["pos_material"],
        "total": c["total_materials"],
        "watched_at": c["watched_at"],
        "cert_date": c["cert_date"],
        "affinity": c["affinity"],
        "routes": [
            {"slug": rs, "title": rt, "percentage": rp} for rs, rt, rp in c["routes"]
        ],
    }


data = {
    "generado": "cruce cursos_progreso x certificados x rutas_cursos",
    "queue_unfinished": [item(c) for c in queue],
    "queue_certified": [item(c) for c in certified],
}
(SDIR / "cola_descarga.json").write_text(
    json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
)

print(f"cursos con actividad: {len(courses)} | sin certificado -> COLA: {len(queue)}")
print("=== COLA PRIORIZADA (grupo | afinidad de rutas) ===")
for i, c in enumerate(queue, 1):
    grupo = c["group"] or "resto"
    rstr = ", ".join(
        f"{rs} ({rp}%)" for rs, _rt, rp in c["routes"][:3]
    ) or "sin ruta"
    print(
        f"{i:>2}. [{grupo:<10}] aff={str(c['affinity'] or '-'):>4}  {c['slug']}  ->  {rstr}"
    )
print(f"=== CON CERTIFICADO ({len(certified)}) -> fuera de la cola por defecto ===")
