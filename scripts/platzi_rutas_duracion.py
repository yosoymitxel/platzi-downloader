"""Extrae duracion de cada curso desde las paginas de rutas (/ruta/<slug>/).

Genera scripts/rutas_duraciones.json: {slug_curso: {title, hours, route, route_pct}}
"""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

SDIR = Path(__file__).resolve().parent
STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
OUT = SDIR / "rutas_duraciones.json"

HORAS = re.compile(r"(\d+(?:[.,]\d+)?)\s*horas?", re.I)
MIN = re.compile(r"(\d+)\s*minutos?", re.I)

LINKS_JS = """els => {
    const seen = new Set();
    const out = [];
    for (const e of els) {
        const h = e.getAttribute('href');
        if (!h || seen.has(h)) continue;
        seen.add(h);
        out.push({ href: h, text: (e.innerText || '').trim() });
    }
    return out;
}"""


def main() -> None:
    rutas = json.loads((SDIR / "rutas_cursos.json").read_text(encoding="utf-8"))
    cookies = json.loads(STATE.read_text(encoding="utf-8"))
    courses = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto("https://platzi.com/mis-rutas/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)

        for i, (rslug, info) in enumerate(rutas.items(), 1):
            if not info.get("courses"):
                continue
            target = info.get("fetch_slug") or rslug
            try:
                page.goto(
                    f"https://platzi.com/ruta/{target}/",
                    wait_until="domcontentloaded",
                    timeout=60000,
                )
                page.wait_for_timeout(3600)
                links = page.eval_on_selector_all("a[href^='/cursos/']", LINKS_JS)
            except Exception as e:
                print(f"[{i}] {rslug}: ERROR {e!r}")
                continue

            n = 0
            for l in links:
                m = re.match(r"/cursos/([^/]+)/", l["href"] or "")
                if not m:
                    continue
                slug = m.group(1)
                text = l["text"]
                hours = None
                mh = HORAS.search(text)
                if mh:
                    hours = float(mh.group(1).replace(",", "."))
                else:
                    mm = MIN.search(text)
                    if mm:
                        hours = int(mm.group(1)) / 60
                if slug:
                    prev = courses.get(slug)
                    if prev is None or (hours and not prev.get("hours")):
                        courses[slug] = {
                            "title": (text.splitlines() or [""])[0].strip(),
                            "hours": hours,
                            "route": rslug,
                            "route_pct": info.get("percentage"),
                        }
                n += 1
            print(f"[{i}] {target}: {n} cursos")

        browser.close()

    OUT.write_text(json.dumps(courses, ensure_ascii=False, indent=2), encoding="utf-8")
    sin_h = [k for k, v in courses.items() if not v.get("hours")]
    print(f"cursos con duracion: {len(courses)} | sin horas: {len(sin_h)} -> {sin_h[:20]}")


if __name__ == "__main__":
    main()
