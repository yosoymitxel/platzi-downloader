"""Extrae los cursos de cada ruta de Platzi.

Estrategia: fetch del HTML de /ruta/<slug>/ (SSR) y regex de /cursos/<slug>/.
Si el fetch no trae cursos, cae a navegacion real + DOM.

Genera scripts/rutas_cursos.json: {slug_ruta: {route_title, percentage, courses: [slugs]}}
"""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

SDIR = Path(__file__).resolve().parent
STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
OUT = SDIR / "rutas_cursos.json"

FETCH_JS = """async (url) => {
    const r = await fetch(url, { credentials: 'include', headers: { accept: 'text/html' } });
    if (r.status !== 200) return { status: r.status, slugs: [] };
    const html = await r.text();
    const re = /\\/cursos\\/([a-z0-9][a-z0-9-]*)\\//g;
    const seen = new Set();
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    }
    return { status: 200, slugs: out };
}"""


def main() -> None:
    routes = json.loads((SDIR / "rutas.json").read_text(encoding="utf-8"))["routes"]
    cookies = json.loads(STATE.read_text(encoding="utf-8"))
    result = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto("https://platzi.com/mis-rutas/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(5000)

        for i, r in enumerate(routes, 1):
            m = re.match(r"/clases/learning-path/([^/]+)/", r.get("url") or "")
            if not m:
                continue
            slug = m.group(1)
            pct = r.get("percentage")
            data = page.evaluate(FETCH_JS, f"https://platzi.com/ruta/{slug}/")
            slugs = data.get("slugs") or []

            if not slugs:
                # fallback: navegacion real
                try:
                    page.goto(
                        f"https://platzi.com/ruta/{slug}/",
                        wait_until="domcontentloaded",
                        timeout=60000,
                    )
                    page.wait_for_timeout(3000)
                    links = page.eval_on_selector_all(
                        "a[href^='/cursos/']",
                        "els => [...new Set(els.map(e => e.getAttribute('href')))]",
                    )
                    for href in links:
                        mm = re.match(r"/cursos/([^/]+)/", href or "")
                        if mm and mm.group(1) not in slugs:
                            slugs.append(mm.group(1))
                except Exception as e:
                    print(f"[{i}] {slug}: ERROR {e!r}")

            result[slug] = {
                "route_title": r.get("title"),
                "percentage": pct,
                "declared_courses": r.get("courses_count"),
                "courses": slugs,
            }
            print(f"[{i:>2}] {str(pct):>4}%  {slug}: {len(slugs)} cursos (declara {r.get('courses_count')})")

        browser.close()

    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"rutas con cursos extraidos: {len(result)}")


if __name__ == "__main__":
    main()
