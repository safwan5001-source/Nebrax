#!/usr/bin/env python3
"""REM-11 — download the official ZATCA SDK, verify it, extract an allowlisted subset.

Fail closed. There is no fallback source, no cache and no unverified path:
  exit 0   verified and extracted
  exit 10  integrity failure (size or SHA-256 differs from the pin)
  exit 11  source unavailable / not a zip (HTTP error, sign-in page, wrong host, too large)
  exit 12  unsafe archive (path traversal, symlink, absolute path, entry/size bomb)
  exit 2   bad invocation / bad pin

Network use is a single GET chain restricted to the pinned HTTPS host. Nothing about the
repository, the tenant or any credential is sent. The SDK is never executed from here.
Stdlib only; run with `python3 -I`.
"""
from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
import os
import shutil
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

EXIT_OK, EXIT_USAGE, EXIT_INTEGRITY, EXIT_UNAVAILABLE, EXIT_UNSAFE = 0, 2, 10, 11, 12

MAX_ENTRIES = 2000
MAX_UNCOMPRESSED = 400 * 1024 * 1024
MAX_REDIRECTS = 8
USER_AGENT = "nebrax-zatca-sdk-conformance/1 (offline validation; CI)"


class FetchError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def load_pin(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            pin = json.load(fh)
    except (OSError, ValueError) as exc:
        raise FetchError(EXIT_USAGE, f"cannot read pin file: {exc}")
    for key in ("version", "url", "allowed_host", "sha256", "size", "max_download_bytes", "jar", "extract_allowlist"):
        if key not in pin:
            raise FetchError(EXIT_USAGE, f"pin file lacks '{key}'")
    sha = str(pin["sha256"]).lower()
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise FetchError(EXIT_USAGE, "pin sha256 is not 64 hex chars")
    return pin


class _HostLockedRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = MAX_REDIRECTS

    def __init__(self, host: str):
        self._host = host

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme != "https" or parsed.hostname != self._host:
            raise FetchError(EXIT_UNAVAILABLE, f"redirect leaves the pinned host ({parsed.scheme}://{parsed.hostname})")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str, dest: str, allowed_host: str, max_bytes: int) -> None:
    """GET `url` (+download=1) into `dest`. Only https to `allowed_host`; cookies stay in memory."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != allowed_host:
        raise FetchError(EXIT_USAGE, "pinned URL is not https on the allowed host")
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    if not any(k == "download" for k, _ in query):
        query.append(("download", "1"))
    target = urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query)))

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), _HostLockedRedirect(allowed_host)
    )
    request = urllib.request.Request(target, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        with opener.open(request, timeout=120) as response, open(dest, "wb") as out:
            ctype = (response.headers.get("Content-Type") or "").lower()
            if ctype.startswith("text/html"):
                raise FetchError(EXIT_UNAVAILABLE, "source returned an HTML page (sign-in or error page), not the SDK")
            total = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise FetchError(EXIT_UNAVAILABLE, f"download exceeds the {max_bytes}-byte cap")
                out.write(chunk)
    except FetchError:
        raise
    except urllib.error.HTTPError as exc:
        raise FetchError(EXIT_UNAVAILABLE, f"HTTP {exc.code} from the official source")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise FetchError(EXIT_UNAVAILABLE, f"cannot reach the official source: {exc}")


def verify(path: str, sha256: str, size: int) -> None:
    actual_size = os.path.getsize(path)
    if actual_size != size:
        raise FetchError(EXIT_INTEGRITY, f"size {actual_size} != pinned {size}")
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != sha256.lower():
        raise FetchError(EXIT_INTEGRITY, f"sha256 {digest.hexdigest()} != pinned {sha256.lower()}")


def _strip_root(name: str, root: str | None) -> str:
    return name[len(root):] if root and name.startswith(root) else name


def safe_extract(archive: str, dest: str, allowlist: list[str]) -> str:
    """Extract only allowlisted members; refuse anything unsafe. Returns the SDK root dir."""
    try:
        zf = zipfile.ZipFile(archive)
    except zipfile.BadZipFile:
        raise FetchError(EXIT_UNAVAILABLE, "downloaded file is not a zip archive")
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ENTRIES:
            raise FetchError(EXIT_UNSAFE, f"archive has {len(infos)} entries (> {MAX_ENTRIES})")
        if sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
            raise FetchError(EXIT_UNSAFE, "archive uncompressed size exceeds the cap")
        names = [i.filename for i in infos]
        first = names[0].split("/", 1)[0] if names else ""
        root = first + "/" if first and all(n == first + "/" or n.startswith(first + "/") for n in names) else None
        dest_real = os.path.realpath(dest)
        extracted = 0
        for info in infos:
            name = info.filename
            if name.startswith("/") or "\\" in name or ".." in name.split("/") or ":" in name.split("/")[0]:
                raise FetchError(EXIT_UNSAFE, f"unsafe member path: {name!r}")
            mode = (info.external_attr >> 16) & 0o170000
            if mode and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise FetchError(EXIT_UNSAFE, f"non-regular member (symlink/device): {name!r}")
            rel = _strip_root(name, root)
            if info.is_dir() or not any(rel == a or (a.endswith("/") and rel.startswith(a)) for a in allowlist):
                continue
            target = os.path.realpath(os.path.join(dest_real, rel))
            if os.path.commonpath([dest_real, target]) != dest_real:
                raise FetchError(EXIT_UNSAFE, f"member escapes destination: {name!r}")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
            extracted += 1
        if extracted == 0:
            raise FetchError(EXIT_UNSAFE, "no allowlisted member found in the archive")
    return dest_real


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pin", required=True)
    parser.add_argument("--dest", required=True, help="new or empty directory")
    parser.add_argument("--archive", help="verify+extract this local file instead of downloading (tests)")
    args = parser.parse_args(argv)

    try:
        pin = load_pin(args.pin)
        if os.path.exists(args.dest) and os.listdir(args.dest):
            raise FetchError(EXIT_USAGE, "destination exists and is not empty")
        os.makedirs(args.dest, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="zatca-sdk-dl-") as tmp:
            archive = args.archive or os.path.join(tmp, "sdk.zip")
            if not args.archive:
                print(f"fetching SDK {pin['version']} from {pin['allowed_host']} (GET only)")
                download(pin["url"], archive, pin["allowed_host"], int(pin["max_download_bytes"]))
            verify(archive, pin["sha256"], int(pin["size"]))
            print(f"integrity OK: sha256={pin['sha256']} size={pin['size']}")
            root = safe_extract(archive, args.dest, list(pin["extract_allowlist"]))
        jar = os.path.join(root, pin["jar"])
        if not os.path.isfile(jar):
            raise FetchError(EXIT_UNSAFE, "pinned jar missing after extraction")
        print(f"SDK_ROOT={root}")
        return EXIT_OK
    except FetchError as exc:
        print(f"SDK_FETCH_FAILED[{exc.code}]: {exc.message}", file=sys.stderr)
        return exc.code


if __name__ == "__main__":
    sys.exit(main())
