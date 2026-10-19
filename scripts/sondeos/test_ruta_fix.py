"""Reintenta rutas que quedaron vacias, probando slugs alternativos, y parchea rutas_cursos.json."""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

SDIR = Path(__file__).resolve().parent
STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
FIX = {
    "seguridad-informatica-old": ["seguridad-informatica", "ciberseguridad", "seguridad"],
    "diseno-ux": ["diseno-ux", "diseno-de-experiencia-de-usuario", "experiencia-de-usuario", "ux"],
    "interfaces-ui": ["interfaces-ui", "diseno-de-interfaces", "ui"],
}

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
    path = SDIR / "rutas_cursos.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    cookies = json.loads(STATE.read_text(encoding="utf-8"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto("https://platzi.com/mis-rutas/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(5000)

        for key, candidates in FIX.items():
            entry = data.get(key)
            if not entry or entry.get("courses"):
                continue
            for cand in candidates:
                res = page.evaluate(FETCH_JS, f"https://platzi.com/ruta/{cand}/")
                slugs = res.get("slugs") or []
                print(f"{key} -> {cand}: status={res.get('status')} cursos={len(slugs)}")
                if slugs:
                    entry["courses"] = slugs
                    entry["fetch_slug"] = cand
                    print(f"   PARCHEADO {key} con {len(slugs)} cursos desde /ruta/{cand}/")
                    break
        browser.close()

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    vacias = [k for k, v in data.items() if not v.get("courses")]
    print("rutas aun vacias:", vacias)


if __name__ == "__main__":
    main()
