"""Almacenamiento SQLite del catálogo público de Platzi.

El catálogo público se mantiene separado de los datos de progreso y descargas
del usuario. La base se crea localmente y no se versiona.
"""
from __future__ import annotations

import os
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "scripts" / "public_catalog.sqlite3"
DB_PATH = Path(os.environ.get("PLATZI_PUBLIC_CATALOG_DB", str(DEFAULT_DB)))


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize(value: Any) -> str:
    text = str(value or "").casefold()
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def empty_catalog() -> dict[str, Any]:
    return {
        "syncedAt": None,
        "count": 0,
        "routeCount": 0,
        "courses": [],
        "latest": [],
        "routes": [],
    }


def connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    path = Path(db_path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=8)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 8000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS public_courses (
            slug TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            cover TEXT,
            instructor TEXT,
            duration TEXT,
            lessons TEXT,
            source TEXT NOT NULL DEFAULT 'catalog',
            search_text TEXT NOT NULL DEFAULT '',
            is_new INTEGER NOT NULL DEFAULT 0,
            latest_rank INTEGER,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS public_routes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            cover TEXT,
            description TEXT,
            source TEXT NOT NULL DEFAULT 'explore',
            route_rank INTEGER,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_public_courses_title ON public_courses(title COLLATE NOCASE)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_public_courses_new ON public_courses(is_new, latest_rank)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS catalog_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    return conn


def store_catalog(
    courses: list[dict[str, Any]],
    routes: list[dict[str, Any]],
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if not courses and not routes:
        raise ValueError("Platzi no devolvió cursos ni rutas; se conserva la caché existente.")

    now = utc_now()
    conn = connect(db_path)
    try:
        with conn:
            conn.execute("UPDATE public_courses SET is_new = 0, latest_rank = NULL")
            for item in courses:
                slug = str(item.get("slug") or "").strip().lower()
                title = str(item.get("title") or "").strip()
                url = str(item.get("url") or "").strip()
                if not slug or not title or not url:
                    continue
                instructor = str(item.get("instructor") or "").strip() or None
                duration = str(item.get("duration") or "").strip() or None
                lessons = str(item.get("lessons") or "").strip() or None
                cover = str(item.get("cover") or "").strip() or None
                source = str(item.get("source") or "catalog")
                is_new = 1 if item.get("is_new") else 0
                rank = item.get("latest_rank") if is_new else None
                search_text = normalize(" ".join((title, slug, instructor or "")))
                conn.execute(
                    """
                    INSERT INTO public_courses
                        (slug, title, url, cover, instructor, duration, lessons, source,
                         search_text, is_new, latest_rank, first_seen, last_seen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(slug) DO UPDATE SET
                        title = CASE
                            WHEN excluded.title <> '' AND excluded.title <> excluded.slug THEN excluded.title
                            ELSE public_courses.title
                        END,
                        url = excluded.url,
                        cover = COALESCE(excluded.cover, public_courses.cover),
                        instructor = COALESCE(excluded.instructor, public_courses.instructor),
                        duration = COALESCE(excluded.duration, public_courses.duration),
                        lessons = COALESCE(excluded.lessons, public_courses.lessons),
                        source = excluded.source,
                        search_text = CASE
                            WHEN excluded.title <> '' AND excluded.title <> excluded.slug
                            THEN excluded.search_text
                            ELSE public_courses.search_text
                        END,
                        is_new = MAX(public_courses.is_new, excluded.is_new),
                        latest_rank = CASE
                            WHEN excluded.is_new = 1 THEN excluded.latest_rank
                            ELSE public_courses.latest_rank
                        END,
                        last_seen = excluded.last_seen
                    """,
                    (slug, title, url, cover, instructor, duration, lessons, source,
                     search_text, is_new, rank, now, now),
                )

            for item in routes:
                route_id = str(item.get("id") or "").strip().lower()
                title = str(item.get("title") or "").strip()
                url = str(item.get("url") or "").strip()
                if not route_id or not title or not url:
                    continue
                conn.execute(
                    """
                    INSERT INTO public_routes
                        (id, title, url, cover, description, source, route_rank, first_seen, last_seen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE public_routes.title END,
                        url = excluded.url,
                        cover = COALESCE(excluded.cover, public_routes.cover),
                        description = COALESCE(excluded.description, public_routes.description),
                        source = excluded.source,
                        route_rank = excluded.route_rank,
                        last_seen = excluded.last_seen
                    """,
                    (
                        route_id, title, url,
                        str(item.get("cover") or "").strip() or None,
                        str(item.get("description") or "").strip() or None,
                        str(item.get("source") or "explore"),
                        item.get("route_rank"), now, now,
                    ),
                )

            count = conn.execute("SELECT COUNT(*) FROM public_courses").fetchone()[0]
            route_count = conn.execute("SELECT COUNT(*) FROM public_routes").fetchone()[0]
            for key, value in (
                ("synced_at", now),
                ("course_count", str(count)),
                ("route_count", str(route_count)),
            ):
                conn.execute(
                    "INSERT INTO catalog_meta(key, value) VALUES(?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, value),
                )
        return {"syncedAt": now, "count": count, "routeCount": route_count}
    finally:
        conn.close()


def get_catalog_payload(db_path: str | Path | None = None) -> dict[str, Any]:
    path = Path(db_path or DB_PATH)
    if not path.exists():
        return empty_catalog()

    conn = connect(path)
    try:
        meta = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM catalog_meta")}
        fields = "slug, title, url, cover, instructor, duration, lessons, source, is_new"
        course_rows = conn.execute(
            "SELECT " + fields + " FROM public_courses ORDER BY title COLLATE NOCASE, slug"
        ).fetchall()
        latest_rows = conn.execute(
            "SELECT " + fields + " FROM public_courses WHERE is_new = 1 "
            "ORDER BY latest_rank IS NULL, latest_rank, title COLLATE NOCASE LIMIT 24"
        ).fetchall()
        route_rows = conn.execute(
            "SELECT id, title, url, cover, description, source, route_rank "
            "FROM public_routes ORDER BY route_rank IS NULL, route_rank, title COLLATE NOCASE LIMIT 36"
        ).fetchall()

        def course_dict(row: sqlite3.Row) -> dict[str, Any]:
            return {
                "slug": row["slug"],
                "title": row["title"],
                "url": row["url"],
                "cover": row["cover"],
                "instructor": row["instructor"],
                "duration": row["duration"],
                "lessons": row["lessons"],
                "source": row["source"],
                "isNew": bool(row["is_new"]),
            }

        return {
            "syncedAt": meta.get("synced_at"),
            "count": int(meta.get("course_count") or len(course_rows)),
            "routeCount": int(meta.get("route_count") or len(route_rows)),
            "courses": [course_dict(row) for row in course_rows],
            "latest": [course_dict(row) for row in latest_rows],
            "routes": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "url": row["url"],
                    "cover": row["cover"],
                    "description": row["description"],
                    "source": row["source"],
                    "rank": row["route_rank"],
                }
                for row in route_rows
            ],
        }
    finally:
        conn.close()


def search_catalog(query: str, limit: int = 40, db_path: str | Path | None = None) -> list[dict[str, Any]]:
    q = normalize(query).strip()
    if not q:
        return []
    terms = [part for part in q.split() if part]
    where = " AND ".join("search_text LIKE ?" for _ in terms)
    params = ["%" + part + "%" for part in terms]
    path = Path(db_path or DB_PATH)
    if not path.exists():
        return []
    conn = connect(path)
    try:
        rows = conn.execute(
            "SELECT slug, title, url, cover, instructor, duration, lessons, is_new "
            "FROM public_courses WHERE " + where +
            " ORDER BY is_new DESC, title COLLATE NOCASE LIMIT ?",
            params + [max(1, min(int(limit), 100))],
        ).fetchall()
        return [
            {
                "slug": row["slug"], "title": row["title"], "url": row["url"],
                "cover": row["cover"], "instructor": row["instructor"],
                "duration": row["duration"], "lessons": row["lessons"],
                "isNew": bool(row["is_new"]),
            }
            for row in rows
        ]
    finally:
        conn.close()
