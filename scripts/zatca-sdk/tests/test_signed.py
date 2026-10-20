"""REM-17 — signed-fixture plumbing and independent crypto helpers (no SDK, no Java, no network, no keys)."""
import base64
import copy
import hashlib
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import conformance as c  # noqa: E402
from tests.test_ratchet import BASELINE, OK_OFFICIAL, SAME, BASE_AWJ  # noqa: E402

EMBEDDED = (
    '<xades:SignedProperties Id="xadesSignedProperties">\n'
    '                                    <xades:SignedSignatureProperties>\n'
    '                                        <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>\n'
    '                                        <ds:DigestValue>AAAA</ds:DigestValue>\n'
    '                                    </xades:SignedSignatureProperties>\n'
    '                                </xades:SignedProperties>'
)
# T written out by hand (not derived by the code under test): declarations added, whitespace untouched.
STANDALONE = (
    '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">\n'
    '                                    <xades:SignedSignatureProperties>\n'
    '                                        <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>\n'
    '                                        <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">AAAA</ds:DigestValue>\n'
    '                                    </xades:SignedSignatureProperties>\n'
    '                                </xades:SignedProperties>'
)


class SignedPropertiesDigestTest(unittest.TestCase):
    def test_digest_is_base64_of_the_hex_sha256_of_the_standalone_serialisation(self):
        expected = base64.b64encode(hashlib.sha256(STANDALONE.encode()).hexdigest().encode()).decode()
        self.assertEqual(c.signed_properties_digest(EMBEDDED), expected)

    def test_digest_is_whitespace_sensitive(self):
        self.assertNotEqual(c.signed_properties_digest(EMBEDDED), c.signed_properties_digest(EMBEDDED.replace("\n", "", 1)))

    def test_embedded_namespace_declarations_are_refused(self):
        with self.assertRaises(ValueError):
            c.signed_properties_digest(STANDALONE)


class TlvAndDerTest(unittest.TestCase):
    def test_tlv_round_trip_and_rejections(self):
        payload = bytes([1, 3]) + b"abc" + bytes([6, 2]) + b"xy"
        self.assertEqual(c.tlv_decode(base64.b64encode(payload).decode()), {1: b"abc", 6: b"xy"})
        for broken in (bytes([1, 5]) + b"abc", bytes([1, 1]) + b"a" + bytes([1, 1]) + b"b", bytes([1])):
            with self.assertRaises(ValueError):
                c.tlv_decode(base64.b64encode(broken).decode())

    def test_certificate_signature_is_the_bit_string_payload(self):
        tbs, alg, sig = b"\x30\x00", b"\x30\x00", b"\x30\x03\x02\x01\x01"
        bit = b"\x03" + bytes([len(sig) + 1]) + b"\x00" + sig
        cert = b"\x30" + bytes([len(tbs + alg + bit)]) + tbs + alg + bit
        self.assertEqual(c.certificate_signature(cert), sig)
        with self.assertRaises(ValueError):
            c.certificate_signature(b"\x30\x04" + tbs + alg)


class SignedRunTest(unittest.TestCase):
    def test_signed_flags_go_together_and_a_signed_baseline_requires_them(self):
        both_missing = mock.Mock(stamped_fixtures=None, stamp_cert_dir=None)
        self.assertIsNone(c.signed_inputs(both_missing, {"awj_signed": {}}))
        with self.assertRaisesRegex(c.HarnessError, "baseline lists signed"):
            c.signed_inputs(both_missing, {"awj_signed": {"f1.xml": BASE_AWJ}})
        with self.assertRaisesRegex(c.HarnessError, "together"):
            c.signed_inputs(mock.Mock(stamped_fixtures="/x", stamp_cert_dir=None), None)

    def test_second_sdk_config_points_only_the_certificate_at_the_ephemeral_dir(self):
        import json
        with tempfile.TemporaryDirectory() as root:
            for rel in (("Data", "Schemas", "xsds", "UBL2.1", "xsd", "maindoc"), ("Data", "Rules", "Schematrons"),
                        ("Data", "Certificates"), ("Data", "PIH"), ("Configuration",)):
                os.makedirs(os.path.join(root, *rel), exist_ok=True)
            for rel in (("Data", "Schemas", "xsds", "UBL2.1", "xsd", "maindoc", "UBL-Invoice-2.1.xsd"),
                        ("Data", "Rules", "Schematrons", "CEN-EN16931-UBL.xsl"),
                        ("Data", "Rules", "Schematrons", "20210819_ZATCA_E-invoice_Validation_Rules.xsl"),
                        ("Data", "Certificates", "cert.pem"), ("Data", "Certificates", "ec-secp256k1-priv-key.pem"),
                        ("Data", "PIH", "pih.txt"), ("Configuration", "usage.txt")):
                open(os.path.join(root, *rel), "w").close()
            cert_dir = os.path.join(root, "ephemeral")
            os.makedirs(cert_dir)
            for name in ("cert.pem", "ec-secp256k1-priv-key.pem"):
                open(os.path.join(cert_dir, name), "w").close()
            default = json.load(open(c.write_sdk_config(root, root)))
            signed = json.load(open(c.write_sdk_config(root, root, cert_dir)))
            self.assertEqual(signed["certPath"], os.path.join(cert_dir, "cert.pem"))
            self.assertEqual(signed["privateKeyPath"], os.path.join(cert_dir, "ec-secp256k1-priv-key.pem"))
            self.assertEqual({k: v for k, v in signed.items() if k not in ("certPath", "privateKeyPath")},
                             {k: v for k, v in default.items() if k not in ("certPath", "privateKeyPath")})

    def test_signed_fixtures_use_the_same_ratchet_and_report_missing_or_unexpected(self):
        baseline = copy.deepcopy(BASELINE)
        baseline["awj_signed"] = {"f1.xml": BASE_AWJ}
        official = {"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL}
        rows, ok = c.evaluate(official, {"f1.xml": SAME}, baseline, {"f1.xml": SAME})
        self.assertTrue(ok, rows)
        rows, ok = c.evaluate(official, {"f1.xml": SAME}, baseline, {})
        self.assertFalse(ok)
        self.assertIn(("awj_signed", "MISSING_FIXTURE"), [(r["kind"], r["verdict"]) for r in rows])
        rows, ok = c.evaluate(official, {"f1.xml": SAME}, baseline, {"f1.xml": SAME, "f2.xml": SAME})
        self.assertFalse(ok)

    def test_signed_mutation_targets_the_policy_digest(self):
        body = "<xades:SigPolicyHash>\n<ds:DigestMethod/>\n<ds:DigestValue>Abc=</ds:DigestValue>"
        self.assertEqual(c.SIGNED_MUTATION_PATTERN.search(body).group(2), "Abc=")

    def test_genesis_literal_is_base64_of_the_hex_sha256_of_zero(self):
        self.assertEqual(c.GENESIS_PIH, base64.b64encode(hashlib.sha256(b"0").hexdigest().encode()).decode())


if __name__ == "__main__":
    unittest.main()
