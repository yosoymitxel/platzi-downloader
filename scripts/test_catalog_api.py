"""HTTP smoke tests for the public catalog API."""
from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server


class PublicCatalogApiTests(unittest.TestCase):
    def setUp(self):
        self.httpd = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            lambda *args, **kwargs: server.ViewerHandler(
                *args, directory=str(server.ROOT), **kwargs
            ),
        )
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = "http://127.0.0.1:%s" % self.httpd.server_address[1]

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)

    def test_import_route_rejects_non_platzi_urls_and_wrong_paths(self):
        for url in (
            "http://platzi.com/mis-rutas/774593/",
            "https://example.com/mis-rutas/774593/",
            "https://platzi.com/cursos/python/",
            "https://platzi.com/mis-rutas/abc/",
            "https://platzi.com/mis-rutas/774593/?next=1",
        ):
            with self.subTest(url=url):
                with self.assertRaises(server.ApiError) as error:
                    server.import_mis_ruta(url)
                self.assertEqual(error.exception.status, 400)

    def test_get_catalog_returns_sqlite_payload_and_sync_state(self):
        catalog = {
            "syncedAt": "2026-10-25T00:00:00Z",
            "count": 1,
            "routeCount": 0,
            "courses": [{"slug": "curso-prueba", "title": "Curso prueba"}],
            "latest": [],
            "routes": [],
        }
        with patch.object(server, "get_catalog_payload", return_value=catalog):
            with urllib.request.urlopen(self.base_url + "/api/catalog", timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))

        self.assertEqual(payload["catalog"]["count"], 1)
        self.assertEqual(payload["catalog"]["courses"][0]["slug"], "curso-prueba")
        self.assertIn("sync", payload)

    def test_post_catalog_refresh_dispatches_background_sync(self):
        expected = {"running": True, "startedAt": 123}
        request = urllib.request.Request(
            self.base_url + "/api/catalog/refresh",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with patch.object(server, "start_public_catalog_sync", return_value=expected) as start:
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
                status = response.status

        self.assertEqual(status, 202)
        self.assertEqual(payload["sync"], expected)
        start.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
