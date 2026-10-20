#!/usr/bin/env python3
"""REM-11 — offline ZATCA SDK conformance harness (advisory).

Runs the official SDK's `-validate` against
  * the SDK's own bundled samples (oracle self-check: every stage must PASS), and
  * AWJ-owned synthetic fixtures (tests/Fixtures/zatca-sdk/awj), compared with a
    committed expected-failure baseline using ratchet rules.

Hard rules (enforced in code, covered by scripts/zatca-sdk/tests):
  * Only `-validate` is ever passed to the SDK (argv allowlist). No -sign / -csr /
    -invoiceRequest / -qr / -generateHash: nothing that touches credentials or ZATCA.
  * The SDK runs inside a network namespace that provably has no route out
    (loopback-only interface list + a failing connect canary). If isolation cannot be
    proven the run aborts; there is no unisolated mode on CI.
  * The SDK process gets a scrubbed environment (no tokens, no proxies).
  * The SDK exit code is NOT trusted: `-validate` exits 0 on `GLOBAL VALIDATION RESULT =
    FAILED`. Pass/fail comes from the parsed stage lines and the global marker; a missing,
    duplicate or inconsistent marker is a harness error, never a pass.

Exit codes: 0 all expectations met · 1 conformance expectation violated ·
            3 harness error (isolation / Java / parse / setup).
Stdlib only; run with `python3 -I`.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

EXIT_OK, EXIT_VIOLATION, EXIT_HARNESS = 0, 1, 3

KNOWN_STAGES = ("XSD", "EN", "KSA", "QR", "SIGNATURE", "PIH")
ALLOWED_SDK_FLAGS = ("-validate",)  # argv allowlist (value flags are handled separately)
SDK_VERSION_ARG = "238-R3.4.8"

STAGE_RE = re.compile(r"\[(?P<stage>[A-Z]+)\] validation result : (?P<status>PASSED|FAILED)\b")
GLOBAL_RE = re.compile(r"GLOBAL VALIDATION RESULT = (?P<status>PASSED|FAILED)\b")
CODE_RE = re.compile(r"\[(?P<level>ERROR|WARN)\]\s.*?\bCODE : (?P<code>[A-Za-z0-9_.-]+)\s*,")


class HarnessError(Exception):
    """The run cannot be trusted (not a conformance verdict)."""


# ───────────────────────────── parsing ─────────────────────────────

@dataclass
class SdkResult:
    global_status: str
    stages: dict[str, str] = field(default_factory=dict)
    errors: dict[str, list[str]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def parse_output(text: str, returncode: int | None = None) -> SdkResult:
    """Parse `-validate` output. The exit code is deliberately ignored for pass/fail."""
    globals_ = GLOBAL_RE.findall(text)
    if not globals_:
        raise HarnessError(
            "no 'GLOBAL VALIDATION RESULT' marker in SDK output"
            + (f" (exit code {returncode})" if returncode is not None else "")
        )
    if len(globals_) != 1:
        raise HarnessError(f"{len(globals_)} GLOBAL markers in SDK output (expected exactly 1)")

    result = SdkResult(global_status=globals_[0])
    current: str | None = None
    for line in text.splitlines():
        stage = STAGE_RE.search(line)
        if stage:
            name = stage.group("stage")
            if name not in KNOWN_STAGES:
                raise HarnessError(f"unknown validation stage '{name}' (SDK behaviour changed?)")
            if name in result.stages:
                raise HarnessError(f"stage '{name}' reported twice")
            result.stages[name] = stage.group("status")
            result.errors[name] = []
            current = name
            continue
        code = CODE_RE.search(line)
        if code:
            if current is None:
                raise HarnessError("CODE line before any stage result")
            if code.group("level") == "ERROR":
                if code.group("code") not in result.errors[current]:
                    result.errors[current].append(code.group("code"))
            elif code.group("code") not in result.warnings:
                result.warnings.append(code.group("code"))

    if not result.stages:
        raise HarnessError("GLOBAL marker present but no stage result lines")
    any_failed = any(s == "FAILED" for s in result.stages.values())
    if result.global_status == "PASSED" and any_failed:
        raise HarnessError("GLOBAL PASSED but a stage FAILED (inconsistent output)")
    if result.global_status == "FAILED" and not any_failed:
        raise HarnessError("GLOBAL FAILED but no stage FAILED (inconsistent output)")
    for name in result.errors:
        result.errors[name].sort()
    result.warnings.sort()
    return result


# ───────────────────────────── isolation ─────────────────────────────

_CANARY = (
    "import os,socket,sys\n"
    "ifs=sorted(l.split(':')[0].strip() for l in open('/proc/net/dev').read().splitlines()[2:] if ':' in l)\n"
    "if ifs!=['lo']:\n"
    "    print('NOT_ISOLATED interfaces=%r'%ifs); sys.exit(2)\n"
    "for host,port in (('1.1.1.1',443),('8.8.8.8',53),('140.82.112.3',443)):\n"
    "    s=socket.socket(); s.settimeout(3)\n"
    "    try:\n"
    "        s.connect((host,port)); print('NOT_ISOLATED connected %s'%host); sys.exit(2)\n"
    "    except OSError:\n"
    "        pass\n"
    "    finally:\n"
    "        s.close()\n"
    "print('ISOLATED')\n"
)

def _drop_privileges(prefix: list[str]) -> list[str]:
    """After `sudo unshare`, run the payload as the invoking user, not root."""
    if prefix and prefix[0] == "sudo":
        return prefix + ["setpriv", f"--reuid={os.getuid()}", f"--regid={os.getgid()}", "--clear-groups"]
    return prefix


ISOLATION_CANDIDATES = (
    ["unshare", "-n"],
    ["unshare", "-rn"],
    ["sudo", "-n", "unshare", "-n"],
)


def detect_isolation(python: str | None = None) -> tuple[list[str], str]:
    """Return (command prefix, proof text). Raise HarnessError if none is provably isolated."""
    python = python or sys.executable
    tried = []
    for base in ISOLATION_CANDIDATES:
        prefix = _drop_privileges(list(base))
        if shutil.which(prefix[0]) is None:
            tried.append(f"{' '.join(prefix)}: tool missing")
            continue
        try:
            proc = subprocess.run(
                prefix + [python, "-I", "-c", _CANARY],
                capture_output=True, text=True, timeout=60, env=scrubbed_env({}),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            tried.append(f"{' '.join(prefix)}: {exc}")
            continue
        if proc.returncode == 0 and proc.stdout.strip() == "ISOLATED":
            return prefix, f"{' '.join(prefix)} → interfaces=['lo'], 3 outbound connects refused"
        tried.append(f"{' '.join(prefix)}: rc={proc.returncode} {(proc.stdout + proc.stderr).strip()[:160]}")
    raise HarnessError("cannot prove network isolation; refusing to run the SDK. Tried: " + " | ".join(tried))


def scrubbed_env(extra: dict[str, str]) -> dict[str, str]:
    """Minimal environment for subprocesses: no tokens, no proxy variables."""
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    env.update(extra)
    return env


# ───────────────────────────── running the SDK ─────────────────────────────

def write_sdk_config(sdk_root: str, workdir: str, cert_dir: str | None = None) -> str:
    """Generate SDK_CONFIG with absolute paths (the shipped config.json has Windows paths).

    `cert_dir` (REM-17): the SDK compares XAdES IssuerSerial with the certificate its config points at, so AWJ
    fixtures signed at run time with an EPHEMERAL synthetic credential need a second config whose certPath is that
    synthetic leaf. Nothing else changes (same schemas, rules and PIH)."""
    j = lambda *p: os.path.join(sdk_root, *p)  # noqa: E731
    config = {
        "xsdPath": j("Data", "Schemas", "xsds", "UBL2.1", "xsd", "maindoc", "UBL-Invoice-2.1.xsd"),
        "enSchematron": j("Data", "Rules", "Schematrons", "CEN-EN16931-UBL.xsl"),
        "zatcaSchematron": j("Data", "Rules", "Schematrons", "20210819_ZATCA_E-invoice_Validation_Rules.xsl"),
        "certPath": j("Data", "Certificates", "cert.pem"),
        "privateKeyPath": j("Data", "Certificates", "ec-secp256k1-priv-key.pem"),
        "pihPath": j("Data", "PIH", "pih.txt"),
        "inputPath": j("Data", "Input"),
        "usagePathFile": j("Configuration", "usage.txt"),
    }
    if cert_dir is not None:
        config["certPath"] = os.path.join(cert_dir, "cert.pem")
        config["privateKeyPath"] = os.path.join(cert_dir, "ec-secp256k1-priv-key.pem")
    for key, path in config.items():
        if key != "inputPath" and not os.path.exists(path):
            raise HarnessError(f"SDK file for '{key}' missing: {path}")
    out = os.path.join(workdir, "sdk-config.json" if cert_dir is None else "sdk-config-signed.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(config, fh)
    return out


class SdkRunner:
    def __init__(self, java: str, sdk_root: str, jar_rel: str, java_flags: list[str],
                 isolation: list[str], workdir: str, timeout: int = 180, cert_dir: str | None = None):
        self.java, self.sdk_root, self.java_flags = java, sdk_root, list(java_flags)
        self.jar = os.path.join(sdk_root, jar_rel)
        self.isolation, self.timeout = list(isolation), timeout
        self.config = write_sdk_config(sdk_root, workdir, cert_dir)
        if not os.path.isfile(self.jar):
            raise HarnessError(f"SDK jar missing: {self.jar}")

    def command(self, invoice: str, flag: str = "-validate") -> list[str]:
        if flag not in ALLOWED_SDK_FLAGS:
            raise HarnessError(f"SDK flag {flag!r} is not allowlisted (only {ALLOWED_SDK_FLAGS})")
        env_args = [f"{k}={v}" for k, v in sorted(self.env().items())]
        return (self.isolation + ["/usr/bin/env", "-i"] + env_args + [self.java] + self.java_flags +
                ["-jar", self.jar, "--globalVersion", SDK_VERSION_ARG, flag, "-invoice", invoice])

    def env(self) -> dict[str, str]:
        return scrubbed_env({
            "SDK_CONFIG": self.config,
            "FATOORA_HOME": os.path.join(self.sdk_root, "Apps"),
        })

    def validate(self, invoice: str) -> SdkResult:
        invoice = os.path.abspath(invoice)
        if not os.path.isfile(invoice):
            raise HarnessError(f"invoice file not found: {invoice}")
        try:
            proc = subprocess.run(self.command(invoice), capture_output=True, text=True,
                                  timeout=self.timeout, env=self.env(), cwd=self.sdk_root)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise HarnessError(f"SDK did not run: {exc}")
        return parse_output(proc.stdout + "\n" + proc.stderr, proc.returncode)


# ───────────────────────────── expectations ─────────────────────────────

def compare_official(name: str, res: SdkResult, expect: dict, allowed_warnings: list[str]) -> list[str]:
    problems = []
    if sorted(res.stages) != sorted(expect["stages"]):
        problems.append(f"stage set {sorted(res.stages)} != expected {sorted(expect['stages'])}")
    failed = [s for s, v in res.stages.items() if v != "PASSED"]
    if failed or res.global_status != "PASSED":
        problems.append(f"official sample must PASS every stage; failed={failed} global={res.global_status}")
    errs = sorted({c for v in res.errors.values() for c in v})
    if errs:
        problems.append(f"unexpected error codes {errs}")
    extra = [w for w in res.warnings if w not in allowed_warnings]
    if extra:
        problems.append(f"unexpected warning codes {extra} (tolerated: {allowed_warnings})")
    return problems


def forbidden_warnings(res: SdkResult, forbidden: list[str]) -> list[str]:
    """Warning codes the AWJ fixtures must never trigger (exact code, or a trailing-`*` prefix pattern).

    REM-15a: the error ratchet alone cannot see party defects, because almost every seller/buyer rule is a
    *warning* in the SDK. These are therefore pinned at zero for the synthetic fixtures; an intentional change
    edits `awj_forbidden_warning_codes` in baseline.json in the same PR, with review."""
    return sorted(w for w in res.warnings if any(fnmatch.fnmatchcase(w, pattern) for pattern in forbidden))


def compare_awj(res: SdkResult, expect: dict, forbidden: list[str] | None = None,
                known_gaps: list[str] | None = None) -> tuple[str, list[str]]:
    """Ratchet comparison. Returns (verdict, details); verdict in OK|REGRESSION|STALE_BASELINE.

    `known_gaps`: forbidden warning codes this fixture is *documented* to trigger (REM-16: a deliberately
    unsupported shape such as a zero-rate line, an arbitrary adjustment or a shipping charge without a verified
    reason code). They are tolerated for that fixture only; a gap that stops firing demands removal (stale)."""
    regress, improve = [], []
    known = set(known_gaps or [])
    bad_warnings = [w for w in forbidden_warnings(res, forbidden or []) if w not in known]
    if bad_warnings:
        regress.append(f"forbidden warning codes {bad_warnings}")
    stale_gaps = sorted(known - set(res.warnings))
    if stale_gaps:
        improve.append(f"known-gap warning codes no longer reported {stale_gaps}")
    exp_stages = expect["stages"]
    for stage in sorted(set(exp_stages) | set(res.stages)):
        want = exp_stages.get(stage)
        got = res.stages.get(stage)
        if want is None:
            regress.append(f"{stage}: stage not in baseline (got {got})")
            continue
        if got is None:
            regress.append(f"{stage}: stage no longer reported (baseline {want['status']})")
            continue
        if want["status"] == "PASSED" and got == "FAILED":
            regress.append(f"{stage}: PASSED → FAILED")
        elif want["status"] == "FAILED" and got == "PASSED":
            improve.append(f"{stage}: FAILED → PASSED")
        new_codes = sorted(set(res.errors.get(stage, [])) - set(want["errors"]))
        gone_codes = sorted(set(want["errors"]) - set(res.errors.get(stage, [])))
        if new_codes:
            regress.append(f"{stage}: new error codes {new_codes}")
        if gone_codes and got != "PASSED":
            improve.append(f"{stage}: error codes no longer reported {gone_codes}")
    if res.global_status != expect["global"]:
        (improve if res.global_status == "PASSED" else regress).append(
            f"GLOBAL: {expect['global']} → {res.global_status}")
    if regress:
        return "REGRESSION", regress + improve
    if improve:
        return "STALE_BASELINE", improve + ["shrink the baseline (conformance.py update-baseline, locally) in this PR"]
    return "OK", []


def baseline_entry(res: SdkResult) -> dict:
    return {
        "global": res.global_status,
        "stages": {s: {"status": res.stages[s], "errors": res.errors[s]} for s in KNOWN_STAGES if s in res.stages},
    }


# ───────────────────────── independent cryptographic checks (REM-17) ─────────────────────────
#
# Re-derives, WITHOUT the SDK and WITHOUT AWJ's PHP code, the cryptographic material of every signed invoice
# (official samples = reference cases; AWJ fixtures signed at run time) with stdlib Python + the OpenSSL CLI:
#   * SignatureValue = ECDSA (DER) over the RAW 32 bytes of the invoice hash (DTG step 2), verified with the
#     certificate's public key; the same signature over the hash's hex text must NOT verify (negative control).
#   * CertDigest = Base64(hex(SHA-256(certificate Base64 text))) (DTG step 3).
#   * SignedProperties digest = Base64(hex(SHA-256(T))), T = embedded element + xmlns:xades on the root +
#     xmlns:ds on each ds: element, whitespace preserved (SDK serialisation; verified on the official samples).
#   * QR: tag 6 = DigestValue text, tag 7 = SignatureValue text, tag 8 = certificate SPKI (DER), tag 9 = the
#     certificate's own signature (DER) — tags 8/9 only where the document carries them.
#   * PIH of a first invoice = the BR-KSA-26 literal (Base64 of the hex text of SHA-256("0")).

GENESIS_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="
XADES_NS = "http://uri.etsi.org/01903/v1.3.2#"
XMLDSIG_NS = "http://www.w3.org/2000/09/xmldsig#"


def _one(pattern: str, text: str, label: str) -> str:
    found = re.findall(pattern, text, re.S)
    if len(found) != 1:
        raise ValueError(f"{label}: found {len(found)} (expected exactly 1)")
    return found[0].strip()


def signed_properties_digest(embedded: str) -> str:
    """Base64(hex(SHA-256(T))) of an embedded SignedProperties element (independent re-implementation)."""
    import base64
    import hashlib
    if "xmlns" in embedded or not embedded.startswith("<xades:SignedProperties "):
        raise ValueError("embedded SignedProperties carries namespace declarations or an unexpected prefix")
    t = embedded.replace("<xades:SignedProperties ", f'<xades:SignedProperties xmlns:xades="{XADES_NS}" ', 1)
    t = re.sub(r"<ds:([A-Za-z][A-Za-z0-9]*)", lambda m: f'<ds:{m.group(1)} xmlns:ds="{XMLDSIG_NS}"', t)
    return base64.b64encode(hashlib.sha256(t.encode("utf-8")).hexdigest().encode("ascii")).decode("ascii")


def tlv_decode(qr_base64: str) -> dict[int, bytes]:
    import base64
    raw = base64.b64decode(qr_base64, validate=True)
    fields, i = {}, 0
    while i < len(raw):
        if i + 2 > len(raw):
            raise ValueError("truncated TLV header")
        tag, length = raw[i], raw[i + 1]
        if tag in fields or i + 2 + length > len(raw):
            raise ValueError(f"duplicate or truncated TLV tag {tag}")
        fields[tag] = raw[i + 2:i + 2 + length]
        i += 2 + length
    return fields


def _der_elements(der: bytes, start: int, end: int) -> list[tuple[int, int, int]]:
    """(tag, content_start, content_end) of each DER element in der[start:end]."""
    out, i = [], start
    while i < end:
        tag, length = der[i], der[i + 1]
        i += 2
        if length & 0x80:
            n = length & 0x7F
            length = int.from_bytes(der[i:i + n], "big")
            i += n
        out.append((tag, i, i + length))
        i += length
    if i != end:
        raise ValueError("DER element overruns its container")
    return out


def certificate_signature(cert_der: bytes) -> bytes:
    (tag, start, end), = _der_elements(cert_der, 0, len(cert_der))
    parts = _der_elements(cert_der, start, end)
    if tag != 0x30 or len(parts) != 3 or parts[2][0] != 0x03 or cert_der[parts[2][1]] != 0:
        raise ValueError("certificate is not SEQUENCE{tbs, alg, BIT STRING}")
    return cert_der[parts[2][1] + 1:parts[2][2]]


def _openssl(args: list[str], data: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["openssl"] + args, input=data, capture_output=True, timeout=60, env=scrubbed_env({}))


def crypto_check(path: str, workdir: str, pih_reference: str = GENESIS_PIH) -> list[str]:
    """Independent checks on one signed invoice; returns problems (empty = all good)."""
    import base64
    import hashlib
    with open(path, "r", encoding="utf-8") as fh:
        xml = fh.read()
    problems: list[str] = []
    try:
        signature = _one(r"<ds:SignatureValue>([^<]*)</ds:SignatureValue>", xml, "SignatureValue")
        certificate = re.findall(r"<ds:X509Certificate>([^<]*)</ds:X509Certificate>", xml)[0].strip()
        invoice_digest = _one(r'<ds:Reference Id="invoiceSignedData"[^>]*>.*?<ds:DigestValue>([^<]*)</ds:DigestValue>',
                              xml, "invoice DigestValue")
        properties_digest = _one(r'<ds:Reference[^>]*URI="#xadesSignedProperties"[^>]*>.*?<ds:DigestValue>([^<]*)</ds:DigestValue>',
                                 xml, "SignedProperties DigestValue")
        cert_digest = re.findall(r"<xades:CertDigest>.*?<ds:DigestValue>([^<]*)</ds:DigestValue>", xml, re.S)[0].strip()
        embedded = _one(r"(<xades:SignedProperties\s.*?</xades:SignedProperties>)", xml, "SignedProperties")
        qr = _one(r"<cbc:ID>QR</cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]*)<", xml, "QR")
        pih = _one(r"<cbc:ID>PIH</cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]*)<", xml, "PIH")
        sig_der, cert_der = base64.b64decode(signature, validate=True), base64.b64decode(certificate, validate=True)
        invoice_hash = base64.b64decode(invoice_digest, validate=True)
    except (ValueError, IndexError) as exc:
        return [f"cannot extract signed material: {exc}"]

    if len(invoice_hash) != 32:
        problems.append(f"invoice DigestValue decodes to {len(invoice_hash)} bytes (expected 32)")
    if sig_der[:1] != b"\x30":
        problems.append("SignatureValue is not ASN.1 DER (no SEQUENCE tag)")

    tmp = tempfile.mkdtemp(prefix="crypto-", dir=workdir)
    j = lambda name: os.path.join(tmp, name)  # noqa: E731
    for name, body in (("cert.der", cert_der), ("sig.der", sig_der), ("hash.bin", invoice_hash),
                       ("hash.hex", invoice_hash.hex().encode("ascii"))):
        with open(j(name), "wb") as fh:
            fh.write(body)
    pub = _openssl(["x509", "-inform", "DER", "-in", j("cert.der"), "-noout", "-pubkey", "-out", j("pub.pem")])
    if pub.returncode != 0:
        return problems + ["openssl cannot read the embedded certificate"]
    verify = lambda data: _openssl(["dgst", "-sha256", "-verify", j("pub.pem"), "-signature", j("sig.der"), data])  # noqa: E731
    if verify(j("hash.bin")).returncode != 0:
        problems.append("ECDSA signature does NOT verify over the raw 32-byte invoice hash (openssl)")
    if verify(j("hash.hex")).returncode == 0:
        problems.append("negative control failed: signature also verifies over the hash's hex text")

    expected_cert_digest = base64.b64encode(hashlib.sha256(certificate.encode("ascii")).hexdigest().encode()).decode()
    if cert_digest != expected_cert_digest:
        problems.append("CertDigest != Base64(hex(SHA-256(certificate Base64 text)))")
    try:
        if signed_properties_digest(embedded) != properties_digest:
            problems.append("SignedProperties digest != Base64(hex(SHA-256(T)))")
    except ValueError as exc:
        problems.append(f"SignedProperties: {exc}")
    if pih != pih_reference:
        problems.append(f"PIH {pih[:16]}… != first-invoice reference value")

    try:
        tags = tlv_decode(qr)
    except ValueError as exc:
        return problems + [f"QR is not valid TLV: {exc}"]
    if tags.get(6) != invoice_digest.encode("ascii"):
        problems.append("QR tag 6 != DigestValue Base64 text")
    if tags.get(7) != signature.encode("ascii"):
        problems.append("QR tag 7 != SignatureValue Base64 text")
    if 8 in tags:
        spki = _openssl(["pkey", "-pubin", "-in", j("pub.pem"), "-outform", "DER"])
        if spki.returncode != 0 or tags[8] != spki.stdout:
            problems.append("QR tag 8 != certificate SubjectPublicKeyInfo (DER)")
    if 9 in tags:
        try:
            if tags[9] != certificate_signature(cert_der):
                problems.append("QR tag 9 != certificate signature (DER)")
        except ValueError as exc:
            problems.append(f"QR tag 9: {exc}")
    return problems


def crypto_checks(sdk_root: str, signed_paths: list[str], workdir: str) -> list[dict]:
    """Rows for the official signed samples (reference cases) and the AWJ signed fixtures."""
    rows = []
    samples_root = os.path.join(sdk_root, "Data", "Samples")
    with open(os.path.join(sdk_root, "Data", "PIH", "pih.txt"), "r", encoding="utf-8") as fh:
        sdk_pih = fh.read().strip()
    if sdk_pih != GENESIS_PIH:
        rows.append({"kind": "crypto", "name": "Data/PIH/pih.txt", "verdict": "REGRESSION",
                     "details": ["SDK pih.txt differs from the BR-KSA-26 literal"]})
    reference = 0
    for path in list_xml(samples_root):
        with open(path, "r", encoding="utf-8") as fh:
            if "<ds:SignatureValue>" not in fh.read():
                continue
        reference += 1
        problems = crypto_check(path, workdir)
        rows.append({"kind": "crypto", "name": "official/" + os.path.relpath(path, samples_root).replace(os.sep, "/"),
                     "verdict": "OK" if not problems else "REGRESSION", "details": problems})
    if reference == 0:
        rows.append({"kind": "crypto", "name": "(official)", "verdict": "REGRESSION",
                     "details": ["no signed official sample found: reference cases missing"]})
    for path in signed_paths:
        problems = crypto_check(path, workdir)
        rows.append({"kind": "crypto", "name": "awj-signed/" + os.path.basename(path),
                     "verdict": "OK" if not problems else "REGRESSION", "details": problems})
    return rows


# ───────────────────────────── orchestration ─────────────────────────────

def list_xml(directory: str) -> list[str]:
    found = []
    for base, _, files in os.walk(directory):
        found += [os.path.join(base, f) for f in files if f.lower().endswith(".xml")]
    return sorted(found)


def collect(runner: SdkRunner, sdk_root: str, fixtures_dir: str) -> tuple[dict, dict]:
    official, awj = {}, {}
    samples_root = os.path.join(sdk_root, "Data", "Samples")
    for path in list_xml(samples_root):
        official[os.path.relpath(path, samples_root).replace(os.sep, "/")] = runner.validate(path)
    awj_dir = os.path.join(fixtures_dir, "awj")
    for path in list_xml(awj_dir):
        awj[os.path.basename(path)] = runner.validate(path)
    return official, awj


MUTATION_SOURCE = "Simplified/Invoice/Simplified_Invoice.xml"
MUTATION_FROM, MUTATION_TO = "<cbc:IssueTime>17:41:08", "<cbc:IssueTime>17:41:09"
MUTATION_EXPECT = {"QR": "FAILED", "SIGNATURE": "FAILED"}


def mutation_liveness(runner: SdkRunner, sdk_root: str, workdir: str) -> list[str]:
    """Flip one character of a signed official sample; QR and SIGNATURE MUST fail.
    Proves the oracle is live (a harness that always printed PASSED would be caught)."""
    src = os.path.join(sdk_root, "Data", "Samples", MUTATION_SOURCE)
    with open(src, "r", encoding="utf-8") as fh:
        body = fh.read()
    if body.count(MUTATION_FROM) != 1:
        return [f"mutation anchor {MUTATION_FROM!r} not found exactly once in {MUTATION_SOURCE} (sample changed?)"]
    out = os.path.join(workdir, "mutated-sample.xml")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(body.replace(MUTATION_FROM, MUTATION_TO))
    res = runner.validate(out)
    problems = []
    for stage, want in MUTATION_EXPECT.items():
        if res.stages.get(stage) != want:
            problems.append(f"mutated sample: {stage} expected {want}, got {res.stages.get(stage)}")
    if res.global_status != "FAILED":
        problems.append("mutated sample: GLOBAL expected FAILED")
    return problems


SIGNED_MUTATION_PATTERN = re.compile(r"(<xades:SigPolicyHash>.*?<ds:DigestValue>)([^<]+)", re.S)


def signed_mutation_liveness(runner: "SdkRunner", signed_paths: list[str], workdir: str) -> list[str]:
    """REM-17: change one character of the signature-policy digest inside SignedProperties of an AWJ-signed
    simplified fixture; SIGNATURE MUST fail. Proves the SDK's SignedProperties digest covers the policy AWJ keeps
    (the official samples carry none), so keeping SignaturePolicyIdentifier is checked, not assumed."""
    simplified = [p for p in signed_paths if "simplified" in os.path.basename(p)]
    if not simplified:
        return ["signed mutation: no signed simplified AWJ fixture"]
    with open(simplified[0], "r", encoding="utf-8") as fh:
        body = fh.read()
    match = SIGNED_MUTATION_PATTERN.search(body)
    if match is None:
        return ["signed mutation: SigPolicyHash not found in the signed AWJ fixture"]
    value = match.group(2)
    mutated = body[:match.start(2)] + ("B" if value[0] == "A" else "A") + value[1:] + body[match.end(2):]
    out = os.path.join(workdir, "mutated-awj-signed.xml")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(mutated)
    res = runner.validate(out)
    problems = []
    if res.stages.get("SIGNATURE") != "FAILED" or res.global_status != "FAILED":
        problems.append(f"signed mutation (policy digest): SIGNATURE expected FAILED, got {res.stages.get('SIGNATURE')}")
    return problems


def evaluate(official: dict, awj: dict, baseline: dict, awj_signed: dict | None = None) -> tuple[list[dict], bool]:
    rows, ok = [], True
    off_base = baseline["official"]
    allowed = off_base["allowed_warning_codes"]
    expected_names = set(off_base["samples"])
    if len(official) != off_base["expected_count"]:
        rows.append({"kind": "official", "name": "(count)", "verdict": "REGRESSION",
                     "details": [f"{len(official)} official samples found, expected {off_base['expected_count']}"]})
        ok = False
    for name in sorted(set(official) | expected_names):
        if name not in official:
            rows.append({"kind": "official", "name": name, "verdict": "MISSING_FIXTURE", "details": ["sample not found in SDK"]})
            ok = False
        elif name not in expected_names:
            rows.append({"kind": "official", "name": name, "verdict": "UNEXPECTED_FIXTURE", "details": ["new sample not in baseline"]})
            ok = False
        else:
            problems = compare_official(name, official[name], off_base["samples"][name], allowed)
            rows.append({"kind": "official", "name": name, "verdict": "OK" if not problems else "REGRESSION",
                         "details": problems, "result": official[name]})
            ok &= not problems
    groups = [("awj", awj, baseline["awj"])]
    if awj_signed is not None:
        groups.append(("awj_signed", awj_signed, baseline.get("awj_signed", {})))
    for kind, results, base in groups:
        for name in sorted(set(results) | set(base)):
            if name not in results:
                rows.append({"kind": kind, "name": name, "verdict": "MISSING_FIXTURE", "details": ["baseline entry without fixture file"]})
                ok = False
            elif name not in base:
                rows.append({"kind": kind, "name": name, "verdict": "UNEXPECTED_FIXTURE", "details": ["fixture without baseline entry"]})
                ok = False
            else:
                verdict, details = compare_awj(results[name], base[name], baseline.get("awj_forbidden_warning_codes", []),
                                             baseline.get("awj_known_gap_warnings", {}).get(name[:-4] if name.endswith(".xml") else name, []))
                rows.append({"kind": kind, "name": name, "verdict": verdict, "details": details, "result": results[name]})
                ok &= verdict == "OK"
    return rows, ok


def ratchet_controls(official: dict, awj: dict, baseline: dict) -> list[str]:
    """Negative controls on the REAL results: each deliberately wrong baseline must be rejected.
    Proves the ratchet is live on this runner, not just in unit tests."""
    import copy

    problems: list[str] = []
    if not awj:
        return ["ratchet controls: no AWJ fixtures found"]
    # الضوابط السلبية تحتاج fixture ومرحلة **فاشلتين فعلاً** (وإلا صار التعديل بلا أثر): اختر أول مرحلة فاشلة بأخطاء.
    name, first_stage = next(
        ((n, st) for n in sorted(awj) for st in sorted(awj[n].stages)
         if awj[n].stages[st] == "FAILED" and awj[n].errors.get(st)),
        (sorted(awj)[0], sorted(awj[sorted(awj)[0]].stages)[0]),
    )

    def expect_rejected(label: str, mutate) -> None:
        variant = copy.deepcopy(baseline)
        mutate(variant)
        _, ok = evaluate(official, awj, variant)
        if ok:
            problems.append(f"ratchet control '{label}' was NOT rejected")

    entry = lambda b: b["awj"][name]["stages"]  # noqa: E731
    expect_rejected("baseline claims a failing stage passes",
                    lambda b: entry(b)[first_stage].update(status="PASSED", errors=[]))
    expect_rejected("baseline lists an error code the SDK no longer reports",
                    lambda b: entry(b)[first_stage]["errors"].append("BR-NONEXISTENT-1"))
    expect_rejected("baseline omits an error code the SDK reports",
                    lambda b: [entry(b)[st]["errors"].clear() for st in entry(b) if entry(b)[st]["errors"]])
    expect_rejected("baseline lacks a fixture that exists", lambda b: b["awj"].pop(name))
    expect_rejected("baseline expects a fixture that is missing",
                    lambda b: b["awj"].update({"awj-ghost.xml": copy.deepcopy(b["awj"][name])}))
    expect_rejected("official sample count drifts", lambda b: b["official"].update(expected_count=999))
    gaps = baseline.get("awj_known_gap_warnings", {})
    reported = sorted({w for n, r in awj.items() for w in r.warnings
                       if w not in gaps.get(n[:-4] if n.endswith(".xml") else n, [])})
    if reported:
        expect_rejected("a reported warning code is declared forbidden",
                        lambda b: b.update(awj_forbidden_warning_codes=[reported[0]]))
    return problems


def render_summary(rows: list[dict], proof: str, mutation: list[str], sdk_version: str, ok: bool) -> str:
    out = [f"## ZATCA SDK conformance (advisory) — SDK {sdk_version}", "",
           f"**Result:** {'✅ expectations met' if ok and not mutation else '❌ expectation violated'}  ",
           f"**Network isolation proof:** `{proof}`  ",
           f"**Oracle + ratchet liveness (mutated sample must fail QR+SIGNATURE; wrong baselines must be rejected):** "
           f"{'✅' if not mutation else '❌ ' + '; '.join(mutation)}", "",
           "Advisory only — not a ZATCA compliance statement and not real ZATCA acceptance. Unsigned AWJ fixtures "
           "fail QR/SIGNATURE by construction; signed ones use an ephemeral synthetic credential. The baseline is a "
           "ratchet.", ""]
    for kind, title in (("awj", "AWJ synthetic fixtures (unsigned)"),
                        ("awj_signed", "AWJ fixtures signed at run time (ephemeral synthetic credential)"),
                        ("official", "Official SDK samples (oracle self-check)")):
        if not any(r["kind"] == kind for r in rows):
            continue
        out += [f"### {title}", "", "| Fixture | Verdict | " + " | ".join(KNOWN_STAGES) + " | Notes |",
                "|---|---|" + "---|" * len(KNOWN_STAGES) + "---|"]
        for row in (r for r in rows if r["kind"] == kind):
            res: SdkResult | None = row.get("result")
            cells = [(res.stages.get(s, "–") if res else "?") for s in KNOWN_STAGES]
            note = "; ".join(row["details"]) if row["details"] else ""
            out.append(f"| `{row['name']}` | {row['verdict']} | " + " | ".join(cells) + f" | {note} |")
        out.append("")
    crypto = [r for r in rows if r["kind"] == "crypto"]
    if crypto:
        out += ["### Independent cryptographic checks (stdlib + OpenSSL CLI; no SDK, no AWJ PHP)", "",
                "| Signed invoice | Verdict | Notes |", "|---|---|---|"]
        out += [f"| `{r['name']}` | {r['verdict']} | {'; '.join(r['details'])} |" for r in crypto]
        out.append("")
    return "\n".join(out)


def result_metadata(rows: list[dict], mutation: list[str], proof: str, ok: bool) -> dict:
    """AWJ-owned metadata only (D-03d): per-AWJ-fixture stage status + rule ids; official samples aggregated."""
    awj = {r["name"]: {"verdict": r["verdict"], **baseline_entry(r["result"])} for r in rows
           if r["kind"] == "awj" and "result" in r}
    signed = {r["name"]: {"verdict": r["verdict"], **baseline_entry(r["result"])} for r in rows
              if r["kind"] == "awj_signed" and "result" in r}
    crypto = [r for r in rows if r["kind"] == "crypto"]
    off = [r for r in rows if r["kind"] == "official"]
    return {
        "ok": bool(ok and not mutation), "isolation_proof": proof, "mutation_problems": mutation,
        "awj": awj,
        "awj_signed": signed,
        # D-03d: official reference cases aggregated; AWJ-signed fixtures by name.
        "crypto": {
            "official_reference": {"checked": sum(1 for r in crypto if not r["name"].startswith("awj-signed/")),
                                   "ok": sum(1 for r in crypto if not r["name"].startswith("awj-signed/")
                                             and r["verdict"] == "OK")},
            "awj_signed": {r["name"][len("awj-signed/"):]: r["details"] for r in crypto
                           if r["name"].startswith("awj-signed/")},
        },
        "official": {"samples": len(off), "ok": sum(1 for r in off if r["verdict"] == "OK")},
    }


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def in_ci() -> bool:
    return os.environ.get("CI", "").lower() == "true" or bool(os.environ.get("GITHUB_ACTIONS"))


def build_runner(args, workdir: str) -> tuple[SdkRunner, str]:
    if args.isolation == "skip":
        if in_ci() or os.environ.get("ZATCA_SDK_ALLOW_UNISOLATED") != "1":
            raise HarnessError("--isolation skip is refused (CI, or ZATCA_SDK_ALLOW_UNISOLATED!=1)")
    pin = load_json(args.pin)
    if args.isolation == "skip":
        prefix, proof = [], "UNISOLATED (local developer override)"
    else:
        prefix, proof = detect_isolation()
    java = args.java or shutil.which("java")
    if not java:
        raise HarnessError("java not found")
    ver = subprocess.run([java, "-version"], capture_output=True, text=True, env=scrubbed_env({}))
    m = re.search(r'version "(\d+)', ver.stderr + ver.stdout)
    if not m or int(m.group(1)) != int(pin["java_major"]):
        raise HarnessError(f"Java {pin['java_major']} required, found: {(ver.stderr or ver.stdout).splitlines()[:1]}")
    runner = SdkRunner(java, args.sdk_root, pin["jar"], pin["java_flags"], prefix, workdir)
    signed_runner = None
    if args.stamp_cert_dir:
        signed_runner = SdkRunner(java, args.sdk_root, pin["jar"], pin["java_flags"], prefix, workdir,
                                  cert_dir=args.stamp_cert_dir)
    return runner, proof, signed_runner


def signed_inputs(args, baseline: dict | None) -> list[str] | None:
    """Signed AWJ fixtures for this run, or None. Both flags go together; a baseline that records signed
    expectations cannot be satisfied by a run that skips them."""
    if bool(args.stamped_fixtures) != bool(args.stamp_cert_dir):
        raise HarnessError("--stamped-fixtures and --stamp-cert-dir must be given together")
    if not args.stamped_fixtures:
        if baseline is not None and baseline.get("awj_signed"):
            raise HarnessError("baseline lists signed AWJ fixtures; pass --stamped-fixtures/--stamp-cert-dir")
        return None
    paths = list_xml(args.stamped_fixtures)
    if not paths:
        raise HarnessError(f"no signed fixtures in {args.stamped_fixtures}")
    return paths


def cmd_run(args) -> int:
    with tempfile.TemporaryDirectory(prefix="zatca-sdk-run-") as workdir:
        runner, proof, signed_runner = build_runner(args, workdir)
        print(f"isolation: {proof}")
        baseline = load_json(os.path.join(args.fixtures, "baseline.json"))
        signed_paths = signed_inputs(args, baseline)
        official, awj = collect(runner, args.sdk_root, args.fixtures)
        mutation = mutation_liveness(runner, args.sdk_root, workdir)
        awj_signed = None
        if signed_paths is not None:
            awj_signed = {os.path.basename(p): signed_runner.validate(p) for p in signed_paths}
            mutation += signed_mutation_liveness(signed_runner, signed_paths, workdir)
        crypto = crypto_checks(args.sdk_root, signed_paths or [], workdir)
    mutation += ratchet_controls(official, awj, baseline)
    rows, ok = evaluate(official, awj, baseline, awj_signed)
    rows += crypto
    ok &= all(r["verdict"] == "OK" for r in crypto)
    summary = render_summary(rows, proof, mutation, load_json(args.pin)["version"], ok)
    meta = result_metadata(rows, mutation, proof, ok)
    print(summary)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(summary + "\n")
    if args.result_json:
        with open(args.result_json, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2, sort_keys=True)
    return EXIT_OK if ok and not mutation else EXIT_VIOLATION


def cmd_update_baseline(args) -> int:
    """Local developer tool: record current SDK results as the baseline. Refused on CI."""
    if in_ci():
        raise HarnessError("update-baseline is refused on CI; run it locally and commit the diff")
    with tempfile.TemporaryDirectory(prefix="zatca-sdk-run-") as workdir:
        runner, proof, signed_runner = build_runner(args, workdir)
        signed_paths = signed_inputs(args, None)
        official, awj = collect(runner, args.sdk_root, args.fixtures)
        awj_signed = None
        if signed_paths is not None:
            awj_signed = {os.path.basename(p): signed_runner.validate(p) for p in signed_paths}
    path = os.path.join(args.fixtures, "baseline.json")
    allowed = ["BR-KSA-98"]
    # قائمة الإنذارات الممنوعة تُحرَّر يدوياً في المراجعة؛ التسجيل لا يمحوها (REM-15a).
    previous = load_json(path) if os.path.isfile(path) else {}
    for name, res in official.items():
        bad = [w for w in res.warnings if w not in allowed]
        if res.global_status != "PASSED" or bad:
            raise HarnessError(f"official sample {name} does not pass cleanly; refusing to record a baseline")
    data = {
        "schema": 1,
        "sdk_version": load_json(args.pin)["version"],
        "_comment": "AWJ expected-failure baseline (ratchet). Regenerate only locally via "
                    "`python3 -I scripts/zatca-sdk/conformance.py update-baseline ...`; review the diff. "
                    "A fixture that now PASSES a stage or loses an error code must shrink this file.",
        "official": {
            "expected_count": len(official),
            "allowed_warning_codes": allowed,
            "samples": {n: {"stages": sorted(r.stages, key=KNOWN_STAGES.index)} for n, r in sorted(official.items())},
        },
        "awj_forbidden_warning_codes": previous.get("awj_forbidden_warning_codes", []),
        "awj_known_gap_warnings": previous.get("awj_known_gap_warnings", {}),
        "awj": {n: baseline_entry(r) for n, r in sorted(awj.items())},
        "awj_signed": ({n: baseline_entry(r) for n, r in sorted(awj_signed.items())} if awj_signed is not None
                       else previous.get("awj_signed", {})),
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"baseline written: {path} (isolation: {proof})")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("run", "update-baseline"):
        p = sub.add_parser(name)
        p.add_argument("--sdk-root", required=True)
        p.add_argument("--pin", required=True)
        p.add_argument("--fixtures", required=True, help="tests/Fixtures/zatca-sdk")
        p.add_argument("--java")
        p.add_argument("--isolation", choices=("required", "skip"), default="required")
        p.add_argument("--stamped-fixtures", help="AWJ fixtures signed at run time (scripts/zatca-sdk/sign_fixtures.php)")
        p.add_argument("--stamp-cert-dir", help="ephemeral synthetic certificate dir written by sign_fixtures.php")
        if name == "run":
            p.add_argument("--summary", help="append markdown here (GITHUB_STEP_SUMMARY)")
            p.add_argument("--result-json")
    args = parser.parse_args(argv)
    for attr in ("sdk_root", "pin", "fixtures", "stamped_fixtures", "stamp_cert_dir"):
        if getattr(args, attr):
            setattr(args, attr, os.path.abspath(getattr(args, attr)))
    try:
        return cmd_run(args) if args.cmd == "run" else cmd_update_baseline(args)
    except HarnessError as exc:
        print(f"HARNESS_ERROR: {exc}", file=sys.stderr)
        return EXIT_HARNESS


if __name__ == "__main__":
    sys.exit(main())
