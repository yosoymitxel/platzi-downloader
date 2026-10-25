"""Pruebas unitarias del almacenamiento SQLite del catálogo público."""
import tempfile
import unittest
from pathlib import Path

from catalog_db import get_catalog_payload, search_catalog, store_catalog


class PublicCatalogTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db = Path(self.tempdir.name) / "catalog.sqlite3"

    def tearDown(self):
        self.tempdir.cleanup()

    def test_store_and_search_normalizes_accents_and_terms(self):
        store_catalog(
            [
                {
                    "slug": "ciberseguridad-basica",
                    "title": "Curso de Ciberseguridad Básica",
                    "url": "https://platzi.com/cursos/ciberseguridad-basica/",
                    "instructor": "Ana Gómez",
                    "source": "catalog",
                },
                {
                    "slug": "php-avanzado",
                    "title": "Curso de PHP Avanzado",
                    "url": "https://platzi.com/cursos/php-avanzado/",
                    "source": "agenda",
                    "is_new": True,
                    "latest_rank": 0,
                },
            ],
            [],
            self.db,
        )

        hits = search_catalog("ciberseguridad basica", db_path=self.db)
        self.assertEqual([item["slug"] for item in hits], ["ciberseguridad-basica"])
        self.assertTrue(get_catalog_payload(self.db)["courses"][0]["url"].startswith("https://platzi.com/cursos/"))

    def test_latest_courses_and_public_routes_are_separate(self):
        store_catalog(
            [
                {
                    "slug": "curso-nuevo",
                    "title": "Curso nuevo",
                    "url": "https://platzi.com/cursos/curso-nuevo/",
                    "source": "agenda",
                    "is_new": True,
                    "latest_rank": 0,
                }
            ],
            [
                {
                    "id": "ruta-nueva",
                    "title": "Ruta nueva",
                    "url": "https://platzi.com/ruta/ruta-nueva/",
                    "source": "explore",
                    "route_rank": 0,
                }
            ],
            self.db,
        )

        payload = get_catalog_payload(self.db)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["routeCount"], 1)
        self.assertEqual(payload["latest"][0]["slug"], "curso-nuevo")
        self.assertEqual(payload["routes"][0]["id"], "ruta-nueva")

    def test_empty_sync_is_rejected_without_erasing_existing_catalog(self):
        store_catalog(
            [{
                "slug": "curso-conservado",
                "title": "Curso conservado",
                "url": "https://platzi.com/cursos/curso-conservado/",
            }],
            [],
            self.db,
        )
        with self.assertRaises(ValueError):
            store_catalog([], [], self.db)
        self.assertEqual(get_catalog_payload(self.db)["count"], 1)


if __name__ == "__main__":
    unittest.main()
