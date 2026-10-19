"""Explora la página de Mis Cursos de Platzi con la sesión guardada.

Uso: python scripts/platzi_scan.py [url]
Genera scripts/scan_raw.json con el crudo para inspección.
"""
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
OUT = Path(__file__).resolve().parent / "scan_raw.json"
URL = sys.argv[1] if len(sys.argv) > 1 else "https://platzi.com/mis-cursos/"


def main() -> None:
    # El cf_clearance de Cloudflare está atado al navegador visible del login;
    # por eso por defecto se usa un navegador visible (se cierra solo al terminar).
    headless = os.environ.get("PLATZI_SCAN_HEADLESS", "0") == "1"
    cookies = json.loads(STATE.read_text(encoding="utf-8"))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, channel="chromium")
        ctx = browser.new_context(locale="es-ES")
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(7000)

        # Si Cloudflare mostró el desafío, dar tiempo a que se auto-resuelva.
        try:
            body_now = page.inner_text("body")
        except Exception:
            body_now = ""
        if "firewall" in body_now.lower():
            print("(desafío de Cloudflare detectado, esperando...)", flush=True)
            page.wait_for_timeout(12000)

        title = page.title()
        final_url = page.url

        links = page.eval_on_selector_all(
            "a[href*='/cursos/']",
            """els => els.slice(0, 300).map(e => {
                const card = e.closest("article, li, div[class*='Card'], div[class*='card']") || e;
                return {
                    href: e.getAttribute('href'),
                    text: (e.innerText || '').trim().slice(0, 160),
                    card: (card.innerText || '').trim().slice(0, 200),
                };
            })""",
        )

        next_data = None
        try:
            raw = page.eval_on_selector(
                "script#__NEXT_DATA__", "e => e.textContent"
            )
            next_data = json.loads(raw)
        except Exception:
            pass

        body = page.inner_text("body")[:2500]

        all_links = page.eval_on_selector_all(
            "a[href]",
            "els => [...new Set(els.map(e => e.getAttribute('href')))]",
        )
        buttons = page.eval_on_selector_all(
            "button, [role=button]",
            "els => els.map(e => (e.innerText || '').trim()).filter(t => t).slice(0, 60)",
        )

        data = {
            "title": title,
            "final_url": final_url,
            "n_links": len(links),
            "links": links,
            "has_next_data": next_data is not None,
            "next_data_keys": list(next_data.get("props", {}).get("pageProps", {}).keys())
            if next_data
            else None,
            "body_snippet": body,
            "all_links": all_links,
            "buttons": buttons,
        }
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        print(f"title: {title}")
        print(f"final_url: {final_url}")
        print(f"links a /cursos/: {len(links)}")
        print(f"__NEXT_DATA__: {data['has_next_data']}")
        if data["next_data_keys"]:
            print(f"pageProps keys: {data['next_data_keys'][:40]}")
        interesantes = [
            u
            for u in all_links
            if any(k in (u or "").lower() for k in ("progreso", "perfil", "mis-cursos", "ver", "todo"))
        ]
        print(f"links interesantes: {interesantes[:30]}")
        print(f"botones: {buttons[:30]}")
        for i, link in enumerate(links[:25]):
            print(f"  [{i}] {link['href']} | {link['text'][:80]!r}")
        if not links:
            print("--- body ---")
            print(body[:1200])
        browser.close()


if __name__ == "__main__":
    main()
