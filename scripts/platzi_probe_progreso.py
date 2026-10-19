"""Probe de red de una página de Platzi que guarda todo el crudo en probe_full.json.

Uso: python scripts/platzi_probe_progreso.py [url]
"""
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE = Path(os.environ["LOCALAPPDATA"]) / "Platzi" / "Platzi" / "state.json"
OUT = Path(__file__).resolve().parent / "probe_full.json"
TARGET = sys.argv[1] if len(sys.argv) > 1 else "https://platzi.com/mi-progreso/"

cookies = json.loads(STATE.read_text(encoding="utf-8"))
api_hits = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, channel="chromium")
    ctx = browser.new_context(locale="es-ES")
    ctx.add_cookies(cookies)
    page = ctx.new_page()

    def on_response(resp):
        try:
            url = resp.url
            if "api.platzi.com" in url or "platzi.com/api" in url:
                ct = resp.headers.get("content-type", "")
                entry = {"status": resp.status, "url": url, "ct": ct[:60]}
                if "json" in ct:
                    try:
                        entry["body"] = resp.json()
                    except Exception as e:
                        entry["body_err"] = str(e)[:120]
                api_hits.append(entry)
        except Exception:
            pass

    page.on("response", on_response)
    page.goto(TARGET, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(12000)
    for _ in range(6):
        page.mouse.wheel(0, 1500)
        page.wait_for_timeout(800)
    page.wait_for_timeout(5000)

    body = page.inner_text("body")
    links = page.eval_on_selector_all(
        "a[href*='/cursos/']",
        "els => [...new Set(els.map(e => e.getAttribute('href')))]",
    )
    buttons = page.eval_on_selector_all(
        "button, [role=button], a[class*='Tab'], [class*='tab']",
        "els => [...new Set(els.map(e => (e.innerText||'').trim()).filter(t=>t))].slice(0,80)",
    )

    data = {
        "api_hits": api_hits,
        "links_cursos": links,
        "buttons": buttons,
        "body": body[:12000],
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"API hits: {len(api_hits)}")
    for h in api_hits:
        has_body = "body" in h
        print(f"  {h['status']} | {h['url'][:120]} | body={'si' if has_body else 'no'}")
    print(f"links /cursos/: {len(links)}")
    print(f"botones: {buttons[:20]}")
    print(f"body len: {len(body)}")
    browser.close()
