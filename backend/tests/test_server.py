import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.server import build_uvicorn_options


class BuildUvicornOptionsTests(unittest.TestCase):
    def test_uses_http_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            options = build_uvicorn_options()

        self.assertEqual(options["host"], "0.0.0.0")
        self.assertEqual(options["port"], 8000)
        self.assertEqual(options["app_dir"], "/app/backend")
        self.assertNotIn("ssl_certfile", options)
        self.assertNotIn("ssl_keyfile", options)

    def test_enables_https_when_certificate_and_key_are_configured(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SSL_CERTFILE": "/app/certs/alpha-nas.tail2b5c2.ts.net.crt",
                "SSL_KEYFILE": "/app/certs/alpha-nas.tail2b5c2.ts.net.key",
            },
            clear=True,
        ):
            options = build_uvicorn_options()

        self.assertEqual(options["ssl_certfile"], "/app/certs/alpha-nas.tail2b5c2.ts.net.crt")
        self.assertEqual(options["ssl_keyfile"], "/app/certs/alpha-nas.tail2b5c2.ts.net.key")

    def test_rejects_incomplete_https_configuration(self) -> None:
        with patch.dict(os.environ, {"SSL_CERTFILE": "/app/certs/cert.crt"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "SSL_CERTFILE and SSL_KEYFILE"):
                build_uvicorn_options()


if __name__ == "__main__":
    unittest.main()
