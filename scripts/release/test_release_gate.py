import unittest

import release_gate as g

MANIFEST = {"checks": [
    {"name": "php sqlite", "tier": "always"},
    {"name": "php pgsql", "tier": "always"},
    {"name": "web build", "tier": "paths"},
    {"name": "visual", "tier": "advisory"},
]}


def run(name, status="completed", conclusion="success", started="2026-10-17T08:00:00Z", rid=1, app="github-actions"):
    return {"id": rid, "name": name, "status": status, "conclusion": conclusion, "started_at": started, "app": {"slug": app}}


class EvaluateTest(unittest.TestCase):
    def ok(self, runs):
        return g.evaluate(MANIFEST, runs)[0]

    def test_green_commit_is_releasable(self):
        self.assertTrue(self.ok([run("php sqlite"), run("php pgsql", rid=2), run("web build", rid=3)]))

    def test_missing_required_check_blocks(self):
        self.assertFalse(self.ok([run("php sqlite")]))

    def test_running_required_check_blocks(self):
        self.assertFalse(self.ok([run("php sqlite"), run("php pgsql", status="in_progress", conclusion=None, rid=2)]))

    def test_failed_required_check_blocks(self):
        self.assertFalse(self.ok([run("php sqlite"), run("php pgsql", conclusion="failure", rid=2)]))

    def test_failed_path_check_blocks_but_failed_advisory_does_not(self):
        base = [run("php sqlite"), run("php pgsql", rid=2)]
        self.assertFalse(self.ok(base + [run("web build", conclusion="failure", rid=3)]))
        self.assertTrue(self.ok(base + [run("visual", conclusion="failure", rid=3)]))

    def test_rerun_supersedes_earlier_failure(self):
        runs = [run("php sqlite"), run("php pgsql", conclusion="failure", rid=2, started="2026-10-17T08:00:00Z"),
                run("php pgsql", rid=3, started="2026-10-17T08:30:00Z")]
        self.assertTrue(self.ok(runs))

    def test_a_check_from_another_app_cannot_satisfy_the_gate(self):
        self.assertFalse(self.ok([run("php sqlite"), run("php pgsql", rid=2, app="some-other-app")]))

    def test_running_unclassified_job_blocks(self):
        base = [run("php sqlite"), run("php pgsql", rid=2)]
        self.assertFalse(self.ok(base + [run("lint", status="queued", conclusion=None, rid=3)]))


class MigrationsTest(unittest.TestCase):
    def test_only_migration_php_files_count(self):
        files = ["app/X.php", "database/migrations/2026_01_01_000001_x.php", "database/migrations/README.md", "web/a.ts"]
        self.assertEqual(g.migrations_in(files), ["database/migrations/2026_01_01_000001_x.php"])


def approval(state="approved", env="production", login="owner"):
    return {"state": state, "user": {"login": login}, "environments": [{"name": env}]}


class ApprovalTest(unittest.TestCase):
    def test_no_approval_record_blocks(self):
        # e.g. the environment was auto-created without reviewers: the run proceeds but nobody approved
        self.assertEqual(g.approvers([], "production"), [])

    def test_only_approved_state_for_this_environment_counts(self):
        records = [approval("rejected"), approval("pending"), approval(env="staging"), approval(login="owner")]
        self.assertEqual(g.approvers(records, "production"), ["owner"])

    def test_missing_fields_do_not_crash(self):
        self.assertEqual(g.approvers([{"state": "approved"}, {"state": "approved", "environments": None}], "production"), [])


if __name__ == "__main__":
    unittest.main()
