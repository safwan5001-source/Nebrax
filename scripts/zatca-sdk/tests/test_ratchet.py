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


class ForbiddenWarningTest(unittest.TestCase):
    """REM-15a: party rules are SDK *warnings*, so the error ratchet cannot see them; they are pinned at zero."""

    def test_a_forbidden_warning_is_a_regression_even_when_errors_are_unchanged(self):
        dirty = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]},
                    warnings=["BR-KSA-81", "BR-CO-10"])
        self.assertEqual(c.compare_awj(dirty, BASE_AWJ)[0], "OK")  # no list: previous behaviour
        verdict, details = c.compare_awj(dirty, BASE_AWJ, ["BR-KSA-81"])
        self.assertEqual(verdict, "REGRESSION")
        self.assertTrue(any("BR-KSA-81" in d and "forbidden" in d for d in details))
        self.assertFalse(any("BR-CO-10" in d for d in details))

    def test_prefix_pattern_matches_a_family_of_codes_only(self):
        dirty = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]},
                    warnings=["BR-KSA-F-06-C23", "BR-KSA-F-05"])
        self.assertEqual(c.forbidden_warnings(dirty, ["BR-KSA-F-06-*"]), ["BR-KSA-F-06-C23"])

    def test_evaluate_reads_the_list_from_the_baseline(self):
        dirty = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]},
                    warnings=["BR-08"])
        official = {"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL}
        _, ok = c.evaluate(official, {"f1.xml": dirty}, BASELINE)
        self.assertTrue(ok)
        _, ok = c.evaluate(official, {"f1.xml": dirty}, dict(BASELINE, awj_forbidden_warning_codes=["BR-08"]))
        self.assertFalse(ok)

    def test_a_documented_known_gap_is_tolerated_for_that_fixture_only_and_a_stale_gap_demands_removal(self):
        dirty = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]},
                    warnings=["BR-CO-16", "BR-S-09"])
        # الثغرة الموثَّقة BR-CO-16 مقبولة؛ BR-S-09 غير موثَّقة ⇒ انحدار.
        verdict, details = c.compare_awj(dirty, BASE_AWJ, ["BR-CO-16", "BR-S-09"], ["BR-CO-16"])
        self.assertEqual(verdict, "REGRESSION")
        self.assertTrue(any("BR-S-09" in d and "BR-CO-16" not in d.split("forbidden")[-1] for d in details))
        # لا ثغرة موثَّقة ⇒ BR-CO-16 نفسها انحدار.
        self.assertEqual(c.compare_awj(dirty, BASE_AWJ, ["BR-CO-16"], [])[0], "REGRESSION")
        # ثغرة توقّفت عن الظهور ⇒ يجب حذفها من baseline (تحسّن لا يُخفى).
        clean = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]})
        verdict, details = c.compare_awj(clean, BASE_AWJ, ["BR-CO-16"], ["BR-CO-16"])
        self.assertEqual(verdict, "STALE_BASELINE")
        self.assertTrue(any("no longer reported" in d for d in details))

    def test_evaluate_reads_the_known_gaps_per_fixture_name_without_the_extension(self):
        dirty = res("FAILED", {"XSD": "FAILED", "EN": "FAILED", "PIH": "FAILED"},
                    {"XSD": ["SAXParseException"], "EN": ["BR-CO-04", "BR-CO-15"], "PIH": ["KSA-13"]},
                    warnings=["BR-CO-16"])
        official = {"a.xml": OK_OFFICIAL, "b.xml": OK_OFFICIAL}
        base = dict(BASELINE, awj_forbidden_warning_codes=["BR-CO-16"])
        self.assertFalse(c.evaluate(official, {"f1.xml": dirty}, base)[1])
        self.assertTrue(c.evaluate(official, {"f1.xml": dirty}, dict(base, awj_known_gap_warnings={"f1": ["BR-CO-16"]}))[1])
        self.assertFalse(c.evaluate(official, {"f1.xml": dirty}, dict(base, awj_known_gap_warnings={"other": ["BR-CO-16"]}))[1])

    def test_the_committed_baseline_pins_the_monetary_rules_and_documents_exactly_four_known_gaps(self):
        import json
        path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "tests", "Fixtures", "zatca-sdk", "baseline.json")
        with open(path, encoding="utf-8") as fh:
            base = json.load(fh)
        for code in ("BR-S-09", "BR-CO-17", "BR-S-01", "BR-S-08", "BR-CO-10", "BR-CO-13", "BR-CO-16", "BR-KSA-51",
                     "BR-KSA-EN16931-08", "BR-KSA-EN16931-09", "BR-KSA-EN16931-11", "BR-KSA-19"):
            self.assertIn(code, base["awj_forbidden_warning_codes"])
        self.assertEqual(base["awj_known_gap_warnings"], {
            "awj-note-standard-zero-rate": ["BR-KSA-EN16931-08", "BR-KSA-EN16931-09"],  # REM-18a: same REM-12 gap
            "awj-standard-adjustment": ["BR-CO-16"],
            "awj-standard-shipping": ["BR-KSA-19"],
            "awj-standard-zero-rate": ["BR-KSA-EN16931-08", "BR-KSA-EN16931-09"],
        })
        # كل ثغرة موثَّقة تخصّ fixture موجوداً.
        for name in base["awj_known_gap_warnings"]:
            self.assertIn(name + ".xml", base["awj"])

    def test_the_committed_baseline_pins_every_party_rule_at_zero(self):
        import json
        path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "tests", "Fixtures", "zatca-sdk", "baseline.json")
        with open(path, encoding="utf-8") as fh:
            forbidden = json.load(fh)["awj_forbidden_warning_codes"]
        for code in ("BR-08", "BR-KSA-08", "BR-KSA-09", "BR-KSA-10", "BR-KSA-37", "BR-KSA-63",
                     "BR-KSA-66", "BR-KSA-67", "BR-KSA-81"):
            self.assertIn(code, forbidden)


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
        self.assertEqual(sorted(meta), ["awj", "awj_signed", "crypto", "isolation_proof", "mutation_problems", "notes", "official", "ok"])
        self.assertEqual(meta["official"], {"samples": 2, "ok": 2})
        self.assertNotIn("a.xml", str(meta))

    def test_result_metadata_aggregates_official_crypto_reference_cases(self):
        rows = [{"kind": "crypto", "name": "official/Simplified/a.xml", "verdict": "REGRESSION", "details": ["x"]},
                {"kind": "crypto", "name": "official/Simplified/b.xml", "verdict": "OK", "details": []},
                {"kind": "crypto", "name": "awj-signed/f1.xml", "verdict": "OK", "details": []}]
        meta = c.result_metadata(rows, [], "proof", False)
        self.assertEqual(meta["crypto"], {"official_reference": {"checked": 2, "ok": 1}, "awj_signed": {"f1.xml": []}})
        self.assertNotIn("a.xml", str(meta))


if __name__ == "__main__":
    unittest.main()
