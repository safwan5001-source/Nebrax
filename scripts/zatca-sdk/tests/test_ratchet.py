"""Baseline / ratchet and run-policy tests (no SDK, no Java, no network)."""
import copy
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import conformance as c  # noqa: E402


def res(global_status, stages, errors=None, warnings=None):
    r = c.SdkResult(global_status=global_status, stages=dict(stages))
    r.errors = {s: sorted((errors or {}).get(s, [])) for s in stages}
    r.warnings = sorted(warnings or [])
    return r


BASE_AWJ = {
    "global": "FAILED",
    "stages": {
        "XSD": {"status": "FAILED", "errors": ["SAXParseException"]},
        "EN": {"status": "FAILED", "errors": ["BR-CO-04", "BR-CO-15"]},
        "PIH": {"status": "FAILED", "errors": ["KSA-13"]},
    },
}
SAME = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
           {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]})


class AwjRatchetTest(unittest.TestCase):
    def test_identical_is_ok(self):
        self.assertEqual(c.compare_awj(SAME, BASE_AWJ)[0], "OK")

    def test_baselined_failure_that_starts_passing_demands_baseline_shrink(self):
        better = res("FAILED", {"XSD": "PASSED", "EN": "FAILED", "PIH": "FAILED"},
                     {"EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]})
        verdict, details = c.compare_awj(better, BASE_AWJ)
        self.assertEqual(verdict, "STALE_BASELINE")
        self.assertTrue(any("XSD: FAILED → PASSED" in d for d in details))
        self.assertTrue(any("shrink the baseline" in d for d in details))

    def test_error_code_that_disappears_demands_baseline_shrink(self):
        better = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                     {"XSD": ["SAXParseException"], "EN": ["BR-CO-04"], "PIH": ["KSA-13"]})
        self.assertEqual(c.compare_awj(better, BASE_AWJ)[0], "STALE_BASELINE")

    def test_new_error_code_is_a_regression(self):
        worse = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15", "BR-NEW-1"], "PIH": ["KSA-13"]})
        verdict, details = c.compare_awj(worse, BASE_AWJ)
        self.assertEqual(verdict, "REGRESSION")
        self.assertTrue(any("BR-NEW-1" in d for d in details))

    def test_previously_passing_stage_that_fails_is_a_regression(self):
        base = copy.deepcopy(BASE_AWJ)
        base["stages"]["XSD"] = {"status": "PASSED", "errors": []}
        verdict, _ = c.compare_awj(SAME, base)
        self.assertEqual(verdict, "REGRESSION")

    def test_stage_missing_or_extra_vs_baseline_is_a_regression(self):
        fewer = res("FAILED", {"XSD": "FAILED", "EN": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"]})
        self.assertEqual(c.compare_awj(fewer, BASE_AWJ)[0], "REGRESSION")
        more = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED", "QR": "FAILED"},
                   {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"], "QR": ["Q"]})
        self.assertEqual(c.compare_awj(more, BASE_AWJ)[0], "REGRESSION")

    def test_regression_wins_over_improvement(self):
        mixed = res("FAILED", {"XSD": "PASSED", "EN": "FAILED", "PIH": "FAILED"},
                    {"EN": ["BR-CO-04", "BR-CO-15", "BR-X"], "PIH": ["KSA-13"]})
        self.assertEqual(c.compare_awj(mixed, BASE_AWJ)[0], "REGRESSION")


OFFICIAL = {"expected_count": 2, "allowed_warning_codes": ["BR-KSA-98"],
            "samples": {"a.xml": {"stages": ["XSD", "PIH"]}, "b.xml": {"stages": ["XSD", "PIH"]}}}
BASELINE = {"official": OFFICIAL, "awj": {"f1.xml": BASE_AWJ}}
OK_OFFICIAL = res("PASSED", {"XSD": "PASSED", "PIH": "PASSED"})


class OfficialAndEvaluateTest(unittest.TestCase):
    def evaluate(self, official, awj):
        return c.evaluate(official, awj, BASELINE)

    def test_all_good(self):
        rows, ok = self.evaluate({"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL}, {"f1.xml": SAME})
        self.assertTrue(ok, rows)

    def test_tolerated_warning_only(self):
        warn = res("PASSED", {"XSD": "PASSED", "PIH": "PASSED"}, warnings=["BR-KSA-98"])
        self.assertEqual(c.compare_official("a.xml", warn, OFFICIAL["samples"]["a.xml"], ["BR-KSA-98"]), [])
        other = res("PASSED", {"XSD": "PASSED", "PIH": "PASSED"}, warnings=["BR-KSA-98", "BR-X"])
        self.assertTrue(c.compare_official("a.xml", other, OFFICIAL["samples"]["a.xml"], ["BR-KSA-98"]))

    def test_official_sample_failure_fails(self):
        bad = res("FAILED", {"XSD": "FAILED", "PIH": "PASSED"}, {"XSD": ["E"]})
        rows, ok = self.evaluate({"a.xml": bad, "b.xml": OK_OFFICIAL}, {"f1.xml": SAME})
        self.assertFalse(ok)

    def test_unknown_awj_fixture_fails(self):
        rows, ok = self.evaluate({"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL}, {"f1.xml": SAME, "f2.xml": SAME})
        self.assertFalse(ok)
        self.assertIn("UNEXPECTED_FIXTURE", [r["verdict"] for r in rows])

    def test_missing_awj_fixture_fails(self):
        rows, ok = self.evaluate({"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL}, {})
        self.assertFalse(ok)
        self.assertIn("MISSING_FIXTURE", [r["verdict"] for r in rows])

    def test_sdk_sample_set_drift_fails(self):
        rows, ok = self.evaluate({"a.xml": OK_OFFICIAL}, {"f1.xml": SAME})
        self.assertFalse(ok)
        rows, ok = self.evaluate({"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL, "c.xml": OK_OFFICIAL}, {"f1.xml": SAME})
        self.assertFalse(ok)


class PolicyTest(unittest.TestCase):
    def test_only_validate_flag_is_allowlisted(self):
        self.assertEqual(c.ALLOWED_SDK_FLAGS, ("-validate",))
        runner = c.SdkRunner.__new__(c.SdkRunner)
        runner.isolation, runner.java, runner.java_flags, runner.jar = [], "java", [], "x.jar"
        runner.config, runner.sdk_root = "/c.json", "/sdk"
        for flag in ("-sign", "-csr", "-invoiceRequest", "-qr", "-generateHash", "-validateQR"):
            with self.assertRaises(c.HarnessError):
                runner.command("f.xml", flag)
        self.assertIn("-validate", runner.command("f.xml"))

    def test_scrubbed_env_drops_tokens_and_proxies(self):
        with mock.patch.dict(os.environ, {"GITHUB_TOKEN": "t", "HTTPS_PROXY": "p", "JAVA_TOOL_OPTIONS": "-Dx"}):
            env = c.scrubbed_env({"SDK_CONFIG": "/c"})
        self.assertEqual(sorted(env), ["LANG", "LC_ALL", "PATH", "SDK_CONFIG"])

    def test_no_provable_isolation_refuses_to_run(self):
        with mock.patch.object(c.shutil, "which", return_value=None):
            with self.assertRaisesRegex(c.HarnessError, "cannot prove network isolation"):
                c.detect_isolation()

    def test_a_candidate_that_leaves_network_reachable_is_rejected(self):
        fake = mock.Mock(returncode=2, stdout="NOT_ISOLATED interfaces=['eth0', 'lo']\n", stderr="")
        with mock.patch.object(c.shutil, "which", return_value="/usr/bin/x"), \
                mock.patch.object(c.subprocess, "run", return_value=fake):
            with self.assertRaisesRegex(c.HarnessError, "NOT_ISOLATED"):
                c.detect_isolation()

    def test_unisolated_override_is_refused_on_ci(self):
        class A: isolation = "skip"; pin = "p"
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "ZATCA_SDK_ALLOW_UNISOLATED": "1"}):
            with self.assertRaisesRegex(c.HarnessError, "refused"):
                c.build_runner(A(), "/tmp")

    def test_update_baseline_is_refused_on_ci(self):
        with mock.patch.dict(os.environ, {"CI": "true"}):
            with self.assertRaisesRegex(c.HarnessError, "refused on CI"):
                c.cmd_update_baseline(mock.Mock())

    def test_result_metadata_has_only_awj_detail(self):
        rows, ok = c.evaluate({"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL}, {"f1.xml": SAME}, BASELINE)
        meta = c.result_metadata(rows, [], "proof", ok)
        self.assertEqual(sorted(meta), ["awj", "isolation_proof", "mutation_problems", "official", "ok"])
        self.assertEqual(meta["official"], {"samples": 2, "ok": 2})
        self.assertNotIn("a.xml", str(meta))


if __name__ == "__main__":
    unittest.main()
