"""Lista las rutas (learning paths) del usuario con su porcentaje de avance.

Uso: python scripts/platzi_rutas.py
Genera scripts/rutas.json
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
OUT = Path(__file__).resolve().parent / "rutas.json"
ULPS_API = "https://api.platzi.com/api/v4/user-learning-paths/"
PROGRESS_API = "https://api.platzi.com/user-learning-path/v1/progress/?ulps_ids={ids}"


def fetch_json(page, url):
    resp = page.evaluate(
        """async (api) => {
            const r = await fetch(api, { credentials: 'include', headers: { accept: 'application/json' } });
            if (r.status !== 200) return { status: r.status, body: null };
            return { status: 200, body: await r.json() };
        }""",
        url,
    )
    return resp["body"] if resp["status"] == 200 else None


def main() -> None:
    cookies = json.loads(STATE.read_text(encoding="utf-8"))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto(
            "https://platzi.com/mis-rutas/", wait_until="domcontentloaded", timeout=60000
        )
        page.wait_for_timeout(6000)

        ulps = fetch_json(page, ULPS_API) or []
        print(f"rutas (ulps) encontradas: {len(ulps)}")

        ids = [str(u["id"]) for u in ulps]
        progress = {}
        for i in range(0, len(ids), 40):
            chunk = ids[i : i + 40]
            body = fetch_json(page, PROGRESS_API.format(ids=",".join(chunk)))
            for row in (body or {}).get("data", []):
                progress[row["id"]] = row
        browser.close()

    routes = []
    for u in ulps:
        pr = progress.get(u["id"], {})
        routes.append(
            {
                "id": u["id"],
                "learning_path_id": u.get("learningPathId"),
                "title": u.get("title"),
                "type": u.get("learningPathType"),
                "level": u.get("level"),
                "courses_count": u.get("coursesCount"),
                "percentage": pr.get("percentage"),
                "duration_hours": pr.get("duration_hours"),
                "approved": (u.get("progress") or {}).get("approved"),
                "url": u.get("url"),
            }
        )
    routes.sort(key=lambda r: (r["percentage"] if r["percentage"] is not None else -1), reverse=True)

    OUT.write_text(json.dumps({"total": len(routes), "routes": routes}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{'%':>4}  {'cursos':>6}  {'tipo':<10} ruta")
    for r in routes:
        pct = f"{r['percentage']:>3}" if r["percentage"] is not None else "  ?"
        print(f"{pct}%  {r['courses_count']:>6}  {str(r['type']):<10} {r['title']}  |  {r['url']}")


if __name__ == "__main__":
    main()
