"""Parser tests on synthetic SDK-shaped output (no SDK, no Java, no network)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import conformance as c  # noqa: E402

TS = "2026-10-14 01:28:22,300"


def line(level, body):
    return f"{TS} [{level}] ValidationProcessorImpl - {body}"


def stage(name, status):
    return line("INFO", f"[{name}] validation result : {status}")


GLOBAL_PASS = f"{TS} [INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED "
GLOBAL_FAIL = f"{TS} [INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = FAILED "


class ParserTest(unittest.TestCase):
    def test_passed_with_warning(self):
        text = "\n".join([
            "********** Welcome banner **********",
            stage("XSD", "PASSED"), stage("EN", "PASSED"), stage("KSA", "PASSED"),
            line("ERROR", "ksa validation warnings : "),
            line("WARN", "CODE : BR-KSA-98, MESSAGE : [BR-KSA-98] - late"),
            stage("PIH", "PASSED"), GLOBAL_PASS,
        ])
        res = c.parse_output(text, 0)
        self.assertEqual(res.global_status, "PASSED")
        self.assertEqual(list(res.stages), ["XSD", "EN", "KSA", "PIH"])
        self.assertEqual(res.warnings, ["BR-KSA-98"])
        self.assertEqual(res.errors["KSA"], [])

    def test_failed_with_exit_code_zero_is_a_failure_not_a_pass(self):
        text = "\n".join([
            stage("XSD", "FAILED"),
            line("ERROR", "CODE : SAXParseException, MESSAGE : boom"),
            stage("EN", "FAILED"),
            line("ERROR", "CODE : BR-03, MESSAGE : x"),
            line("ERROR", "CODE : BR-CO-04, MESSAGE : y"),
            stage("PIH", "PASSED"), GLOBAL_FAIL,
        ])
        res = c.parse_output(text, 0)  # exit code 0 on purpose: SDK does that
        self.assertEqual(res.global_status, "FAILED")
        self.assertEqual(res.errors["XSD"], ["SAXParseException"])
        self.assertEqual(res.errors["EN"], ["BR-03", "BR-CO-04"])

    def test_usage_text_exit_1_without_marker_is_harness_error(self):
        text = "********** Welcome **********\nUsage: fatoora ...\n"
        with self.assertRaisesRegex(c.HarnessError, "no 'GLOBAL VALIDATION RESULT' marker"):
            c.parse_output(text, 1)

    def test_empty_output_is_harness_error(self):
        with self.assertRaises(c.HarnessError):
            c.parse_output("", 0)

    def test_truncated_output_before_marker_is_harness_error(self):
        with self.assertRaises(c.HarnessError):
            c.parse_output("\n".join([stage("XSD", "PASSED"), stage("EN", "PASSED")]), 0)

    def test_duplicate_markers_are_harness_error(self):
        text = "\n".join([stage("XSD", "PASSED"), GLOBAL_PASS, GLOBAL_PASS])
        with self.assertRaisesRegex(c.HarnessError, "2 GLOBAL markers"):
            c.parse_output(text)

    def test_global_passed_with_failed_stage_is_inconsistent(self):
        text = "\n".join([stage("XSD", "FAILED"), GLOBAL_PASS])
        with self.assertRaisesRegex(c.HarnessError, "inconsistent"):
            c.parse_output(text)

    def test_global_failed_without_failed_stage_is_inconsistent(self):
        text = "\n".join([stage("XSD", "PASSED"), GLOBAL_FAIL])
        with self.assertRaisesRegex(c.HarnessError, "inconsistent"):
            c.parse_output(text)

    def test_unknown_stage_is_harness_error(self):
        text = "\n".join([stage("NEWSTAGE", "PASSED"), GLOBAL_PASS])
        with self.assertRaisesRegex(c.HarnessError, "unknown validation stage"):
            c.parse_output(text)

    def test_marker_without_any_stage_is_harness_error(self):
        with self.assertRaisesRegex(c.HarnessError, "no stage result"):
            c.parse_output(GLOBAL_PASS)

    def test_code_line_before_stage_is_harness_error(self):
        text = "\n".join([line("ERROR", "CODE : X, MESSAGE : y"), stage("XSD", "PASSED"), GLOBAL_PASS])
        with self.assertRaisesRegex(c.HarnessError, "before any stage"):
            c.parse_output(text)

    def test_stage_reported_twice_is_harness_error(self):
        text = "\n".join([stage("XSD", "PASSED"), stage("XSD", "PASSED"), GLOBAL_PASS])
        with self.assertRaisesRegex(c.HarnessError, "twice"):
            c.parse_output(text)


if __name__ == "__main__":
    unittest.main()
