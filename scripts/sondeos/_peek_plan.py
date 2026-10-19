"""Peek rapido del plan: que entro y que quedo fuera por ruta."""
import json
from pathlib import Path

SDIR = Path(__file__).resolve().parent
p = json.loads((SDIR / "expansion_plan.json").read_text(encoding="utf-8"))
sel, skip = p["selected"], p["skipped"]


def by_route(items):
    d = {}
    for c in items:
        d.setdefault(c["route"], []).append(c)
    return d


sd, kd = by_route(sel), by_route(skip)
web = sd.get("desarrollo-web", [])
print(f"== desarrollo-web seleccionados: {len(web)}")
print(", ".join(c["slug"] for c in web))
print()
routes = [
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
]
for r in routes:
    s, k = sd.get(r, []), kd.get(r, [])
    tot = len(s) + len(k)
    gbh = sum(c["est_gb"] for c in k)
    selslugs = [c["slug"] for c in s][:8]
    skipslugs = [c["slug"] for c in k][:8]
    print(f"{r}: sel {len(s)}/{tot} | fuera ~{gbh:.1f} GB")
    print(f"   sel:  {selslugs}")
    print(f"   fuera:{skipslugs}")
