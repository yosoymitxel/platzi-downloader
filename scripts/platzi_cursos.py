"""Lista los cursos del usuario desde la API interna de Platzi.

Usa la sesión guardada (state.json) en un navegador visible (Cloudflare).
Genera scripts/cursos_progreso.json con todos los cursos y los pendientes
(pos_material < total_materials).
"""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
OUT = Path(__file__).resolve().parent / "cursos_progreso.json"
API = "https://api.platzi.com/api/v4/materials/progress/all-courses/"


def main() -> None:
    cookies = json.loads(STATE.read_text(encoding="utf-8"))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto(
            "https://platzi.com/mis-cursos/",
            wait_until="domcontentloaded",
            timeout=60000,
        )
        page.wait_for_timeout(6000)

        resp = page.evaluate(
            """async (api) => {
                const attempt = async (headers) => {
                    const r = await fetch(api, { credentials: 'include', headers });
                    if (r.status !== 200) return { status: r.status, how: 'cookies', body: null };
                    return { status: 200, how: headers.Authorization ? 'token' : 'cookies', body: await r.json() };
                };
                let out = await attempt({ accept: 'application/json' });
                if (out.status !== 200) {
                    let token = null;
                    try {
                        const rc = await fetch('/api/v5/users/credentials/', {
                            credentials: 'include',
                            headers: { accept: 'application/json' },
                        });
                        if (rc.ok) {
                            const jc = await rc.json();
                            token = (jc && jc.token && jc.token.access) || null;
                        }
                    } catch (e) {}
                    const h = { accept: 'application/json', 'api-is-logged': 'true' };
                    if (token) h['Authorization'] = 'Bearer ' + token;
                    out = await attempt(h);
                }
                return out;
            }""",
            API,
        )
        browser.close()

    assert resp["status"] == 200, f"API respondio status {resp['status']}"
    print(f"(autenticado via: {resp.get('how')})")
    body = resp["body"]

    courses = []
    for _cat_id, cat in body.items():
        if not isinstance(cat, dict):
            continue
        for c in cat.get("courses", []):
            m = c.get("material") or {}
            url = m.get("url") or ""
            mt = re.match(r"/cursos/([^/]+)/", url)
            if not mt:
                continue
            total = c.get("total_materials") or 0
            pos = c.get("pos_material") or 0
            courses.append(
                {
                    "slug": mt.group(1),
                    "title": c.get("title"),
                    "category": c.get("course_category"),
                    "course_id": c.get("course_id"),
                    "total_materials": total,
                    "pos_material": pos,
                    "watched_at": c.get("watched_at"),
                    "last_material": m.get("title"),
                }
            )

    pending = [c for c in courses if c["pos_material"] < c["total_materials"]]
    pending.sort(key=lambda c: c["watched_at"] or "", reverse=True)

    data = {
        "total": len(courses),
        "pending": len(pending),
        "courses": courses,
        "pending_courses": pending,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"total cursos con progreso: {len(courses)}")
    print(f"pendientes: {len(pending)}")
    for i, c in enumerate(pending, 1):
        print(f"{i:>2}. {c['pos_material']}/{c['total_materials']}  {c['slug']}  |  {c['title']}")


if __name__ == "__main__":
    main()
