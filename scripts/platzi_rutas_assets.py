"""Segunda pasada de rutas: arregla duraciones con lazy-render y captura portadas.

- Merge conservador en rutas_duraciones.json (no pisa valores buenos).
- cursos_covers.json: {slug_curso: url_portada}
- rutas_covers.json: {slug_ruta: url_portada}
"""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

SDIR = Path(__file__).resolve().parent
STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
DUR = SDIR / "rutas_duraciones.json"
COV = SDIR / "cursos_covers.json"
RCOV = SDIR / "rutas_covers.json"

HORAS = re.compile(r"(\d+(?:[.,]\d+)?)\s*horas?", re.I)
MIN = re.compile(r"(\d+)\s*minutos?", re.I)

LINKS_JS = """els => {
    const seen = new Map();
    for (const e of els) {
        const h = e.getAttribute('href');
        if (!h || !h.startsWith('/cursos/') || seen.has(h)) continue;
        const scope = e.closest('li, article') || e.parentElement || e;
        const img = e.querySelector('img') || (scope ? scope.querySelector('img') : null);
        let cand = '';
        if (img) {
            cand = img.currentSrc || img.src || img.dataset.src || '';
            if (cand.startsWith('data:')) cand = '';
        }
        seen.set(h, {
            href: h,
            text: (e.innerText || '').trim(),
            img: /^https?:/.test(cand) ? cand : null
        });
    }
    return [...seen.values()];
}"""


def extract_hours(text: str):
    mh = HORAS.search(text)
    if mh:
        return float(mh.group(1).replace(",", "."))
    mm = MIN.search(text)
    if mm:
        return int(mm.group(1)) / 60
    return None


def main() -> None:
    rutas = json.loads((SDIR / "rutas_cursos.json").read_text(encoding="utf-8"))
    dur = json.loads(DUR.read_text(encoding="utf-8"))
    covers = json.loads(COV.read_text(encoding="utf-8")) if COV.exists() else {}
    rcovers = json.loads(RCOV.read_text(encoding="utf-8")) if RCOV.exists() else {}
    cookies = json.loads(STATE.read_text(encoding="utf-8"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto(
            "https://platzi.com/mis-rutas/",
            wait_until="domcontentloaded",
            timeout=60000,
        )
        page.wait_for_timeout(3500)

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
                page.wait_for_timeout(3000)
                for _ in range(5):
                    page.evaluate("window.scrollBy(0, 1600)")
                    page.wait_for_timeout(450)
                page.wait_for_timeout(800)
                og = page.evaluate(
                    "() => { const m = document.querySelector(\"meta[property='og:image']\"); return m ? m.content : null; }"
                )
                links = page.eval_on_selector_all("a[href^='/cursos/']", LINKS_JS)
            except Exception as e:  # noqa: BLE001
                print(f"[{i}] {target}: ERROR {e!r}")
                continue

            if og:
                rcovers[rslug] = og
            nuevos = 0
            for l in links:
                m = re.match(r"/cursos/([^/]+)/", l["href"] or "")
                if not m:
                    continue
                slug = m.group(1)
                text = l["text"] or ""
                hours = extract_hours(text)
                if slug not in dur:
                    dur[slug] = {
                        "title": (text.splitlines() or [""])[0].strip(),
                        "hours": hours,
                        "route": rslug,
                        "route_pct": info.get("percentage"),
                    }
                    nuevos += 1
                elif not dur[slug].get("hours") and hours:
                    dur[slug]["hours"] = hours
                if l["img"] and slug not in covers:
                    covers[slug] = l["img"]
            print(f"[{i}] {target}: {len(links)} links, {nuevos} nuevos")

        browser.close()

    DUR.write_text(json.dumps(dur, ensure_ascii=False, indent=2), encoding="utf-8")
    COV.write_text(json.dumps(covers, ensure_ascii=False, indent=2), encoding="utf-8")
    RCOV.write_text(json.dumps(rcovers, ensure_ascii=False, indent=2), encoding="utf-8")
    sin_h = [k for k, v in dur.items() if not v.get("hours")]
    print(
        f"TOTAL cursos: {len(dur)} | covers: {len(covers)} | rutas covers: {len(rcovers)} | sin horas: {len(sin_h)}"
    )


if __name__ == "__main__":
    main()
