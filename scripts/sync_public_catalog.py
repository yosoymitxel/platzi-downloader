"""Sincroniza el catálogo público de Platzi en la caché SQLite local.

Usa páginas públicas de Platzi mediante Chromium, aprovechando la sesión local
si existe. No descarga vídeos y no altera el catálogo personal del usuario.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from catalog_db import DB_PATH, store_catalog

ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Platzi" / "Platzi" / "state.json"
SOURCES = (
    ("catalog", "https://platzi.com/cursos/"),
    ("explore", "https://platzi.com/cursos/explora/"),
    ("agenda", "https://platzi.com/agenda/"),
)


def read_cookies() -> list[dict[str, Any]]:
    if not STATE_PATH.exists():
        return []
    raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("cookies"), list):
        return raw["cookies"]
    return []


def collect_page(page: Any, url: str, source: str) -> dict[str, list[dict[str, Any]]]:
    page.goto(url, wait_until="domcontentloaded", timeout=90000)
    page.wait_for_timeout(2200)

    # La vista Explorar muestra inicialmente solo unas pocas rutas. Expandir
    # "Ver más" antes de recorrer el DOM para incluir las demás rutas visibles.
    if source == "explore":
        for _ in range(12):
            expanded = page.evaluate(
                """() => {
                    const trim = (v) => (v || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                    const button = Array.from(document.querySelectorAll('button, [role="button"]'))
                        .find((el) => trim(el.innerText).replace('expand_more', '').trim() === 'ver más');
                    if (!button || button.disabled) return false;
                    button.click();
                    return true;
                }"""
            )
            if not expanded:
                break
            page.wait_for_timeout(350)

    previous = -1
    stable = 0
    for _ in range(10):
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(450)
        count = page.locator("a[href]").count()
        if count == previous:
            stable += 1
        else:
            stable = 0
        previous = count
        if stable >= 2:
            break
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(200)

    return page.evaluate(
        r"""(source) => {
          const trim = (v) => (v || '').replace(/\s+/g, ' ').trim();
          const coursePattern = /^\/cursos\/([a-z0-9][a-z0-9-]*)\/?$/i;
          const routePattern = /^\/(?:ruta|rutas)\/([a-z0-9][a-z0-9-]*)\/?$/i;
          const getCard = (a) => a.closest(
            'article, li, [data-testid*="course"], [class*="course-card"], [class*="CourseCard"], [class*="route-card"], [class*="RouteCard"]'
          ) || a.parentElement || a;
          const getText = (a, card) => {
            const ownHeading = a.querySelector('h1,h2,h3,h4');
            const cardHeading = card.querySelector('h1,h2,h3,h4');
            const img = card.querySelector('img') || a.querySelector('img');
            let heading = trim((ownHeading && ownHeading.innerText) || (cardHeading && cardHeading.innerText));
            if (!heading || heading.length > 140) {
              const alt = trim(img && img.getAttribute('alt'));
              const label = trim(a.getAttribute('aria-label') || a.getAttribute('title'));
              const lines = (card.innerText || a.innerText || '').split(/\n+/).map(trim).filter(Boolean);
              const likelyTitle = lines.find((line) =>
                line.length < 140 && /^(curso|audiocurso|reto|taller|ruta|bootcamp|masterclass|diplomado|carrera|programa|certificaci[oó]n)/i.test(line)
              );
              heading = alt || label || likelyTitle || lines[0] || '';
            }
            return { heading: trim(heading), img: img || null };
          };
          const courseMap = new Map();
          const routeMap = new Map();
          for (const a of document.querySelectorAll('a[href]')) {
            let parsed;
            try { parsed = new URL(a.getAttribute('href'), location.href); } catch (e) { continue; }
            if (parsed.protocol !== 'https:' || !/(^|\.)platzi\.com$/i.test(parsed.hostname)) continue;
            const path = parsed.pathname.replace(/\/+$/, '') + '/';
            const cm = path.match(coursePattern);
            const rm = path.match(routePattern);
            const card = getCard(a);
            const details = getText(a, card);
            const img = details.img;
            const lines = (card.innerText || a.innerText || '').split(/\n+/).map(trim).filter(Boolean);
            const cover = img ? (img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
            if (cm && cm[1].toLowerCase() !== 'explora') {
              const slug = cm[1].toLowerCase();
              let title = details.heading;
              if (!title || title.length > 140 || /^curso$/i.test(title)) title = trim(a.getAttribute('aria-label') || a.getAttribute('title') || a.innerText) || slug;
              const duration = lines.find((line) => /\d+(?:[.,]\d+)?\s*horas? de contenido/i.test(line) || /^\d+(?:[.,]\d+)?\s*horas?$/i.test(line)) || '';
              const lessons = lines.find((line) => /\d+\s*clases?/i.test(line)) || '';
              const instructor = lines.find((line) => line !== title && line.length < 90 &&
                !/curso|audiocurso|reto|clases?|horas?|nivel|b[aá]sico|intermedio|avanzado|minutos?|contenido|profe/i.test(line)) || '';
              const item = {
                slug, title, url: 'https://platzi.com/cursos/' + slug + '/',
                cover: cover.startsWith('https://') ? cover : '',
                instructor, duration, lessons, source,
                is_new: source === 'agenda', latest_rank: source === 'agenda' ? courseMap.size : null
              };
              const old = courseMap.get(slug);
              if (!old || (item.title && item.title.length > (old.title || '').length) ||
                  ((item.cover || item.instructor) && !old.cover && !old.instructor)) courseMap.set(slug, item);
            }
            if (rm) {
              const id = rm[1].toLowerCase();
              if (id === 'explora') continue;
              let title = details.heading || trim(a.getAttribute('aria-label') || a.getAttribute('title') || a.innerText);
              if (!title || title.length > 140) title = lines[0] || id;
              const item = {
                id, title, url: 'https://platzi.com' + path,
                cover: cover.startsWith('https://') ? cover : '',
                description: lines.find((line) => line !== title && line.length > 30 && line.length < 260) || '',
                source, route_rank: routeMap.size
              };
              if (!routeMap.has(id)) routeMap.set(id, item);
            }
          }
          return { courses: Array.from(courseMap.values()), routes: Array.from(routeMap.values()) };
        }""",
        source,
    )


def merge_records(target: dict[str, dict[str, Any]], records: list[dict[str, Any]]) -> None:
    for item in records:
        slug = item.get("slug")
        if not slug:
            continue
        old = target.get(slug, {})
        merged = dict(old)
        for key, value in item.items():
            if value not in (None, ""):
                merged[key] = value
        target[slug] = merged


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Falta Playwright. Ejecuta: pip install playwright && playwright install chromium", file=sys.stderr)
        return 2

    courses: dict[str, dict[str, Any]] = {}
    routes: dict[str, dict[str, Any]] = {}
    try:
        cookies = read_cookies()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False, channel="chromium")
            try:
                context = browser.new_context(locale="es-ES")
                if cookies:
                    context.add_cookies(cookies)
                page = context.new_page()
                for source, url in SOURCES:
                    print("Leyendo " + url, flush=True)
                    result = collect_page(page, url, source)
                    if source == "catalog" and len(result["courses"]) < 20:
                        print("Aviso: el catálogo devolvió menos de 20 cursos; se conservará la caché y se añadirán solo los resultados obtenidos.", flush=True)
                    merge_records(courses, result["courses"])
                    if source == "explore":
                        for route in result["routes"]:
                            routes.setdefault(route["id"], route)
            finally:
                browser.close()
        if not courses and not routes:
            print("No se pudieron extraer cursos ni rutas de Platzi. La caché SQLite se conserva.", file=sys.stderr)
            return 3
        result = store_catalog(list(courses.values()), list(routes.values()), DB_PATH)
        print("Catálogo SQLite actualizado: {count} cursos, {routeCount} rutas. Fecha: {syncedAt}".format(**result))
        return 0
    except Exception as exc:
        print("Falló la sincronización del catálogo público: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
