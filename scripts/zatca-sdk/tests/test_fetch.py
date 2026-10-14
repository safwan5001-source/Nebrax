"""Checksum-tamper, archive-safety and source-failure tests (no real network)."""
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import fetch_sdk as f  # noqa: E402

JAR = "Apps/zatca-einvoicing-sdk-238-R3.4.8.jar"


def make_zip(path, members, root="sdk-root/"):
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in members.items():
            zf.writestr(root + name, data)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = self.tmp.name
        self.zip = os.path.join(self.dir, "a.zip")
        make_zip(self.zip, {JAR: b"jar", "Data/Rules/r.xsl": b"x", "Data/Samples/Standard/s.xml": b"<a/>",
                            "Apps/fatoora": b"#!/bin/sh", "install.sh": b"evil"})
        self.sha = hashlib.sha256(open(self.zip, "rb").read()).hexdigest()
        self.size = os.path.getsize(self.zip)
        self.pin = os.path.join(self.dir, "pin.json")
        self.write_pin()

    def write_pin(self, **over):
        pin = {"version": "t", "url": "https://sadzit.sharepoint.com/x?e=1", "allowed_host": "sadzit.sharepoint.com",
               "sha256": self.sha, "size": self.size, "max_download_bytes": 10_000_000, "jar": JAR,
               "extract_allowlist": [JAR, "Data/Rules/", "Data/Samples/Standard/"]}
        pin.update(over)
        json.dump(pin, open(self.pin, "w"))

    def run_main(self, archive=None):
        dest = os.path.join(self.dir, "out")
        return f.main(["--pin", self.pin, "--dest", dest, "--archive", archive or self.zip]), dest


class ChecksumTamperTest(Base):
    def test_good_archive_extracts_only_the_allowlist(self):
        rc, dest = self.run_main()
        self.assertEqual(rc, f.EXIT_OK)
        root = os.path.join(dest, JAR)
        self.assertTrue(os.path.isfile(root))
        self.assertFalse(os.path.exists(os.path.join(dest, "install.sh")))
        self.assertFalse(os.path.exists(os.path.join(dest, "Apps", "fatoora")))

    def test_pin_sha_off_by_one_hex_char_fails_before_extraction(self):
        flipped = ("0" if self.sha[0] != "0" else "1") + self.sha[1:]
        self.write_pin(sha256=flipped)
        rc, dest = self.run_main()
        self.assertEqual(rc, f.EXIT_INTEGRITY)
        self.assertFalse(os.path.exists(os.path.join(dest, JAR)))

    def test_one_flipped_byte_in_archive_fails(self):
        data = bytearray(open(self.zip, "rb").read())
        data[len(data) // 2] ^= 0x01
        bad = os.path.join(self.dir, "bad.zip")
        open(bad, "wb").write(bytes(data))
        rc, dest = self.run_main(bad)
        self.assertEqual(rc, f.EXIT_INTEGRITY)
        self.assertEqual(os.listdir(dest), [])

    def test_truncated_archive_fails_on_size(self):
        data = open(self.zip, "rb").read()[:-10]
        bad = os.path.join(self.dir, "short.zip")
        open(bad, "wb").write(data)
        rc, _ = self.run_main(bad)
        self.assertEqual(rc, f.EXIT_INTEGRITY)

    def test_size_mismatch_in_pin_fails(self):
        self.write_pin(size=self.size + 1)
        rc, _ = self.run_main()
        self.assertEqual(rc, f.EXIT_INTEGRITY)

    def test_bad_pin_is_usage_error(self):
        self.write_pin(sha256="zz")
        rc, _ = self.run_main()
        self.assertEqual(rc, f.EXIT_USAGE)


class ArchiveSafetyTest(Base):
    def attempt(self, members, root="sdk-root/"):
        bad = os.path.join(self.dir, "evil.zip")
        make_zip(bad, members, root)
        self.sha = hashlib.sha256(open(bad, "rb").read()).hexdigest()
        self.size = os.path.getsize(bad)
        self.write_pin(extract_allowlist=[JAR, "Data/", "../"])
        return self.run_main(bad)

    def test_zip_slip_is_rejected(self):
        rc, dest = self.attempt({JAR: b"j", "../../evil.txt": b"x"})
        self.assertEqual(rc, f.EXIT_UNSAFE)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "evil.txt")))

    def test_absolute_member_is_rejected(self):
        rc, _ = self.attempt({JAR: b"j"}, root="/")
        self.assertEqual(rc, f.EXIT_UNSAFE)

    def test_symlink_member_is_rejected(self):
        bad = os.path.join(self.dir, "link.zip")
        with zipfile.ZipFile(bad, "w") as zf:
            zf.writestr("sdk-root/" + JAR, b"j")
            info = zipfile.ZipInfo("sdk-root/Data/link")
            info.external_attr = 0o120777 << 16
            zf.writestr(info, "/etc/passwd")
        self.sha = hashlib.sha256(open(bad, "rb").read()).hexdigest()
        self.size = os.path.getsize(bad)
        self.write_pin()
        rc, _ = self.run_main(bad)
        self.assertEqual(rc, f.EXIT_UNSAFE)

    def test_archive_without_pinned_jar_is_rejected(self):
        rc, _ = self.attempt({"Data/x": b"1"})
        self.assertEqual(rc, f.EXIT_UNSAFE)

    def test_not_a_zip_is_unavailable(self):
        bad = os.path.join(self.dir, "page.zip")
        open(bad, "wb").write(b"<html>sign in</html>")
        self.sha = hashlib.sha256(open(bad, "rb").read()).hexdigest()
        self.size = os.path.getsize(bad)
        self.write_pin()
        rc, _ = self.run_main(bad)
        self.assertEqual(rc, f.EXIT_UNAVAILABLE)

    def test_nonempty_destination_is_refused(self):
        dest = os.path.join(self.dir, "out")
        os.makedirs(dest)
        open(os.path.join(dest, "x"), "w").write("1")
        rc = f.main(["--pin", self.pin, "--dest", dest, "--archive", self.zip])
        self.assertEqual(rc, f.EXIT_USAGE)


class FakeResponse:
    def __init__(self, body=b"", ctype="application/zip"):
        self._buf = io.BytesIO(body)
        self.headers = {"Content-Type": ctype}

    def read(self, n=-1):
        return self._buf.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class SourceFailureTest(Base):
    def download_with(self, opener_open):
        opener = mock.Mock()
        opener.open = opener_open
        with mock.patch.object(f.urllib.request, "build_opener", return_value=opener):
            return f.main(["--pin", self.pin, "--dest", os.path.join(self.dir, "out")])

    def test_http_403_fails_closed(self):
        def boom(*a, **k):
            raise urllib.error.HTTPError("u", 403, "Forbidden", {}, None)
        self.assertEqual(self.download_with(boom), f.EXIT_UNAVAILABLE)

    def test_network_error_fails_closed(self):
        def boom(*a, **k):
            raise urllib.error.URLError("no route")
        self.assertEqual(self.download_with(boom), f.EXIT_UNAVAILABLE)

    def test_html_signin_page_fails_closed(self):
        rc = self.download_with(lambda *a, **k: FakeResponse(b"<html>sign in</html>", "text/html; charset=utf-8"))
        self.assertEqual(rc, f.EXIT_UNAVAILABLE)

    def test_oversized_download_fails_closed(self):
        self.write_pin(max_download_bytes=10)
        rc = self.download_with(lambda *a, **k: FakeResponse(b"x" * 100))
        self.assertEqual(rc, f.EXIT_UNAVAILABLE)

    def test_download_that_does_not_match_the_pin_is_an_integrity_failure(self):
        rc = self.download_with(lambda *a, **k: FakeResponse(b"not the sdk"))
        self.assertEqual(rc, f.EXIT_INTEGRITY)

    def test_good_download_through_the_network_path(self):
        data = open(self.zip, "rb").read()
        self.assertEqual(self.download_with(lambda *a, **k: FakeResponse(data)), f.EXIT_OK)

    def test_request_is_a_plain_get_to_the_pinned_host_with_download_flag(self):
        seen = {}

        def capture(request, timeout=None):
            seen["url"], seen["method"], seen["data"] = request.full_url, request.get_method(), request.data
            seen["headers"] = dict(request.header_items())
            return FakeResponse(open(self.zip, "rb").read())
        self.assertEqual(self.download_with(capture), f.EXIT_OK)
        self.assertTrue(seen["url"].startswith("https://sadzit.sharepoint.com/"))
        self.assertIn("download=1", seen["url"])
        self.assertEqual(seen["method"], "GET")
        self.assertIsNone(seen["data"])
        self.assertEqual(sorted(k.lower() for k in seen["headers"]), ["accept", "user-agent"])

    def test_non_https_or_foreign_host_pin_is_rejected(self):
        for url in ("http://sadzit.sharepoint.com/x", "https://evil.example/x"):
            self.write_pin(url=url)
            self.assertEqual(self.download_with(lambda *a, **k: FakeResponse(b"")), f.EXIT_USAGE)

    def test_redirect_off_host_is_rejected(self):
        handler = f._HostLockedRedirect("sadzit.sharepoint.com")
        with self.assertRaises(f.FetchError):
            handler.redirect_request(mock.Mock(), None, 302, "Found", {}, "https://evil.example/x.zip")
        with self.assertRaises(f.FetchError):
            handler.redirect_request(mock.Mock(), None, 302, "Found", {}, "http://sadzit.sharepoint.com/x.zip")


if __name__ == "__main__":
    unittest.main()
