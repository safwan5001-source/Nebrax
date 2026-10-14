"""Static guards over the new workflow, scripts and fixtures (no SDK, no network)."""
import glob
import os
import re
import unittest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
WORKFLOW = os.path.join(REPO, ".github", "workflows", "zatca-sdk-conformance.yml")
FIXTURES = os.path.join(REPO, "tests", "Fixtures", "zatca-sdk")
SCRIPTS = os.path.join(REPO, "scripts", "zatca-sdk")


def read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


class WorkflowGuardTest(unittest.TestCase):
    def setUp(self):
        self.text = read(WORKFLOW)

    def test_every_action_is_pinned_to_a_full_commit_sha(self):
        uses = re.findall(r"^\s*-?\s*uses:\s*(\S+)", self.text, re.M)
        self.assertTrue(uses)
        for ref in uses:
            self.assertRegex(ref, r"^[\w.-]+/[\w.-]+@[0-9a-f]{40}$", ref)

    def test_least_privilege_and_no_secrets(self):
        self.assertRegex(self.text, r"(?m)^permissions:\s*\n\s+contents:\s*read\s*$")
        self.assertEqual(len(re.findall(r"(?m)^\s*permissions:", self.text)), 1, "no per-job permission widening")
        for forbidden in ("secrets.", "pull_request_target", "GITHUB_TOKEN", "id-token", "contents: write"):
            self.assertNotIn(forbidden, self.text, forbidden)

    def test_no_artifact_cache_or_upload_actions(self):
        for forbidden in ("actions/cache", "upload-artifact", "download-artifact", "actions/upload-pages"):
            self.assertNotIn(forbidden, self.text, forbidden)

    def test_no_sdk_flag_other_than_validate_is_referenced(self):
        for flag in ("-sign", "-csr", "-invoiceRequest", "-generateHash", "-qr "):
            self.assertNotIn(flag, self.text, flag)

    def test_triggers_are_path_filtered_and_unscheduled(self):
        self.assertNotRegex(self.text, r"(?m)^\s*schedule:")
        self.assertIn("workflow_dispatch", self.text)
        self.assertEqual(len(re.findall(r"(?m)^\s{4}paths:", self.text)), 1, "push is path-filtered")

    def test_no_pull_request_trigger_so_the_ci_gate_does_not_discover_this_workflow(self):
        # scripts/ci-gate/test_ci_gate.py::test_repo_is_clean fails on any unclassified PR-triggered job, and this
        # slice must not edit required-checks.json (D-03e). Adding `pull_request:` here would fail the mandatory gate.
        on_block = self.text.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertNotRegex(on_block, r"(?m)^\s{2}pull_request", "see comment in the workflow")
        self.assertRegex(on_block, r"(?m)^\s{2}push:")

    def test_checkout_does_not_persist_credentials(self):
        self.assertIn("persist-credentials: false", self.text)

    def test_advisory_job_name_is_explicit(self):
        self.assertIn("(advisory)", self.text)


class FixtureDigestTest(unittest.TestCase):
    """The PHP drift test compares generator output with DIGESTS (the CI overlay does not receive fixture files);
    this guard ties the committed fixture files to the very same digests."""

    def test_committed_fixtures_match_the_digests_in_the_php_drift_test(self):
        import hashlib
        php = read(os.path.join(REPO, "tests", "Feature", "ZatcaSdkFixtureDriftTest.php"))
        block = php.split("private const DIGESTS = [", 1)[1].split("];", 1)[0]
        digests = dict(re.findall(r"'([a-z0-9-]+)'\s*=>\s*'([0-9a-f]{64})'", block))
        self.assertTrue(digests)
        files = sorted(glob.glob(os.path.join(FIXTURES, "awj", "*.xml")))
        self.assertEqual(sorted(digests), [os.path.basename(f)[:-4] for f in files],
                         "fixture files and DIGESTS must list the same fixtures")
        for f in files:
            with open(f, "rb") as fh:
                self.assertEqual(hashlib.sha256(fh.read()).hexdigest(), digests[os.path.basename(f)[:-4]], f)

    def test_baseline_lists_exactly_the_fixtures(self):
        import json
        base = json.loads(read(os.path.join(FIXTURES, "baseline.json")))
        files = sorted(os.path.basename(f) for f in glob.glob(os.path.join(FIXTURES, "awj", "*.xml")))
        self.assertEqual(sorted(base["awj"]), files)


class ScopeGuardTest(unittest.TestCase):
    def test_existing_ci_surfaces_are_untouched_by_this_change(self):
        # Informational anchor: the workflow must not be one of the gate-managed files.
        self.assertFalse(WORKFLOW.endswith("ci-gate.yml"))
        self.assertNotIn("zatca-sdk", read(os.path.join(REPO, ".github", "ci-gate", "required-checks.json")))

    def test_no_key_material_or_sdk_content_in_repo_additions(self):
        for path in glob.glob(os.path.join(FIXTURES, "**", "*"), recursive=True) + \
                glob.glob(os.path.join(SCRIPTS, "**", "*"), recursive=True):
            if not os.path.isfile(path) or path.endswith(".pyc") or os.sep + "tests" + os.sep in path.replace(REPO, ""):
                if not path.startswith(FIXTURES):
                    continue
            if not os.path.isfile(path) or path.endswith(".pyc"):
                continue
            body = read(path)
            self.assertNotRegex(body, r"-----BEGIN [A-Z ]*PRIVATE KEY-----", path)
            self.assertNotIn("BEGIN CERTIFICATE", body, path)
            self.assertFalse(path.endswith((".jar", ".zip", ".pem", ".xsl")), path)

    def test_fixtures_use_only_the_synthetic_test_vat_number(self):
        for path in glob.glob(os.path.join(FIXTURES, "awj", "*.xml")):
            ids = re.findall(r"<cbc:CompanyID>(\d+)</cbc:CompanyID>", read(path))
            self.assertEqual(ids, ["300000000000003"], path)


if __name__ == "__main__":
    unittest.main()
