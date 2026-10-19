"""Descarga la lista completa de certificados (cursos aprobados) del usuario.

Uso: python scripts/platzi_certificados.py
Genera scripts/certificados.json
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
OUT = Path(__file__).resolve().parent / "certificados.json"
BASE = "https://api.platzi.com/profile/v1/"


def fetch_json(page, url):
    """Fetch con cookies; si falla, reintenta con token Bearer. None si no hay 200."""
    for attempt in (1, 2):
        resp = page.evaluate(
            """async (api) => {
                const r = await fetch(api, { credentials: 'include', headers: { accept: 'application/json' } });
                if (r.status !== 200) return { status: r.status, body: null };
                return { status: 200, body: await r.json() };
            }""",
            url,
        )
        if resp["status"] == 200:
            return resp["body"]
        if attempt == 1:
            page.evaluate(
                """async () => {
                    try { await fetch('/api/v5/users/credentials/', { credentials: 'include' }); } catch (e) {}
                }"""
            )
    return None


def fetch_all_pages(page, resource, key):
    items = []
    total = None
    for page_num in range(1, 51):
        url = f"{BASE}{resource}/?page={page_num}&page_size=100&only_approved=true"
        body = fetch_json(page, url)
        if not body:
            break
        data = body.get("data") or {}
        batch = data.get(key) or []
        if total is None:
            total = data.get("total")
        if not batch:
            break
        items.extend(batch)
        if total is not None and len(items) >= int(total):
            break
    return items


def main() -> None:
    cookies = json.loads(STATE.read_text(encoding="utf-8"))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto(
            "https://platzi.com/mis-certificados/",
            wait_until="domcontentloaded",
            timeout=60000,
        )
        page.wait_for_timeout(6000)

        courses = fetch_all_pages(page, "courses", "courses")
        paths = fetch_all_pages(page, "learning-paths", "learning_paths")
        browser.close()

    certs = []
    for c in courses:
        d = c.get("diploma") or {}
        certs.append(
            {
                "slug": c.get("slug"),
                "title": c.get("title"),
                "progress": c.get("progress"),
                "approved_date": d.get("approved_date"),
                "diploma_url": d.get("diploma_url"),
            }
        )
    certs.sort(key=lambda c: c.get("approved_date") or "", reverse=True)

    paths_out = []
    for lp in paths:
        d = lp.get("diploma") or {}
        paths_out.append(
            {
                "slug": lp.get("slug"),
                "title": lp.get("title"),
                "approved_date": d.get("approved_date"),
            }
        )
    paths_out.sort(key=lambda c: c.get("approved_date") or "", reverse=True)

    data = {"total_certs": len(certs), "certs": certs, "learning_paths": paths_out}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"certificados de cursos: {len(certs)}")
    print(f"rutas aprobadas: {len(paths_out)}")
    for i, c in enumerate(certs, 1):
        fecha = (c["approved_date"] or "?")[:10]
        print(f"{i:>3}. ({fecha})  {c['slug']}  |  {c['title']}")


if __name__ == "__main__":
    main()
