import unittest

from mlx_studio_runtime.domain.web import public_result_url


class WebReferenceUrlTests(unittest.TestCase):
    def test_rejects_nonpublic_literals_local_names_and_credential_urls(self):
        for url in (
            "http://127.0.0.1/",
            "http://127.1/",
            "http://2130706433/",
            "http://0177.0.0.1/",
            "http://192.168.1.1/",
            "http://198.18.0.17/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://localhost./",
            "http://printer.local/",
            "http://metadata.internal/",
            "http://intranet/",
            "https://private-key@example.com/",
            "https://example.com:8080/",
            "file:///etc/passwd",
            "https://example.com/\npage",
        ):
            with self.subTest(url=url):
                self.assertIsNone(public_result_url(url))

    def test_normalizes_references_without_resolving_their_addresses(self):
        self.assertEqual(
            public_result_url("https://EXAMPLE.com/page?q=MLX#source"),
            "https://example.com/page?q=MLX",
        )
        self.assertEqual(
            public_result_url("https://8.8.8.8/page"), "https://8.8.8.8/page"
        )
