"""PG-SHARD-ADDITIVE-1: the PostgreSQL shard jobs copy the `test` job's assembly literally, change no PostgreSQL durability
setting, filter nothing, and prove from the trusted base. Guards ci.yml the way test_perf_job_parity.py guards `pg-perf`.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import json
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CI = ROOT / ".github" / "workflows" / "ci.yml"
MANIFEST = ROOT / ".github" / "ci-gate" / "required-checks.json"
SHARD, PROOF, FULL = "test-pg-shards", "test-pg-shards-proof", "test"
RUN_STEP_PREFIX = "تشغيل اختبارات الشريحة"
FORBIDDEN_RUN = ("--filter", "--group", "--exclude-group", "--testsuite", "--stop-on", "|| true", "--bail")
DURABILITY = ("fsync", "synchronous_commit", "full_page_writes", "tmpfs", "wal_sync_method", "shared_buffers")


def steps(job):
    return {s.get("name"): s for s in job["steps"] if s.get("name")}


def norm(step):
    s = {k: v for k, v in step.items() if k != "if"}  # the lock-limit step loses only its matrix-only `if`
    return s


class ShardJobParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = CI.read_text(encoding="utf-8")
        cls.doc = yaml.safe_load(cls.text)
        cls.jobs = cls.doc["jobs"]
        cls.shard, cls.proof, cls.full = cls.jobs[SHARD], cls.jobs[PROOF], cls.jobs[FULL]
        cls.group = json.loads(MANIFEST.read_text(encoding="utf-8"))["shard_groups"][0]

    # ── assembly is a literal copy of `test` ──────────────────────────────────────────────────────────────
    def test_shared_steps_are_identical_to_the_full_job(self):
        full, shard = steps(self.full), steps(self.shard)
        shared = [n for n in shard if n in full]
        self.assertGreaterEqual(len(shared), 11, shared)  # checkout…tenancy (11) + the lock-limit step
        for name in shared:
            self.assertEqual(norm(shard[name]), norm(full[name]), f"step drifted from the full job: {name}")

    def test_the_full_job_is_still_the_complete_unfiltered_pgsql_run(self):
        self.assertEqual(self.full["strategy"]["matrix"]["db"], ["sqlite", "pgsql"])
        run = steps(self.full)["تشغيل الاختبارات"]["run"]
        for bad in FORBIDDEN_RUN:
            self.assertNotIn(bad, run)
        self.assertIn("php artisan test --parallel", run)

    def test_service_env_and_runner_match_the_full_job(self):
        for key in ("services", "env", "runs-on", "timeout-minutes"):
            self.assertEqual(self.shard[key], self.full[key], key)

    # ── PostgreSQL durability / isolation untouched ───────────────────────────────────────────────────────
    def test_no_durability_or_storage_setting_appears_in_the_shard_jobs(self):
        blob = json.dumps({SHARD: self.shard, PROOF: self.proof})
        for word in DURABILITY:
            self.assertNotIn(word, blob, f"{word} must not be configured for the shard jobs")
        self.assertNotIn("tmpfs", json.dumps(self.shard["services"]))

    def test_whole_file_still_has_tmpfs_only_for_pg_perf(self):
        self.assertEqual(len(re.findall(r"--tmpfs", self.text)), len(re.findall(r"--tmpfs", yaml.safe_dump(self.jobs["pg-perf"]))))

    # ── shard job shape ───────────────────────────────────────────────────────────────────────────────────
    def test_matrix_name_and_count_agree_everywhere(self):
        self.assertEqual(self.shard["strategy"]["matrix"], {"shard": [1, 2]})
        self.assertEqual(self.group["count"], 2)
        self.assertEqual(self.group["job"], SHARD)
        self.assertEqual(self.shard["name"], "php artisan test (L11, pgsql, shard ${{ matrix.shard }})")
        sel = steps(self.shard)["اختيار الشريحة (${{ matrix.shard }}/2) وجرد الاختبارات"]["run"]
        self.assertIn("--count 2", sel)
        self.assertIn('--shard "${{ matrix.shard }}"', sel)
        self.assertIn("--shards 2", self.proof_step()["run"])

    def run_step(self):
        return next(s for s in self.shard["steps"] if s.get("name", "").startswith(RUN_STEP_PREFIX))

    def proof_step(self):
        return next(s for s in self.proof["steps"] if "shard_proof.py" in s.get("run", ""))

    def test_shard_run_step_filters_nothing_and_fails_closed(self):
        run = self.run_step()["run"]
        self.assertIn("set -o pipefail", run)
        self.assertIn("php artisan test --parallel", run)
        self.assertIn("--log-junit", run)
        for bad in FORBIDDEN_RUN:
            self.assertNotIn(bad, run)
        self.assertNotIn("if", self.run_step())
        self.assertEqual(sum("php artisan test" in s.get("run", "") for s in self.shard["steps"]), 1)

    def test_inventory_is_taken_before_selection_and_plan_after(self):
        sel = steps(self.shard)["اختيار الشريحة (${{ matrix.shard }}/2) وجرد الاختبارات"]["run"]
        inv, pick, plan = (sel.index(x) for x in ('> "$OUT/inventory.txt"', "select_shard.py", '> "$OUT/planned.txt"'))
        self.assertLess(inv, pick)
        self.assertLess(pick, plan)
        order = [s.get("name", "") for s in self.shard["steps"]]
        self.assertLess(order.index("اختيار الشريحة (${{ matrix.shard }}/2) وجرد الاختبارات"), order.index(self.run_step()["name"]))

    def test_no_step_is_skippable_except_the_artifact_upload(self):
        self.assertNotIn("if", self.shard)
        self.assertNotIn("continue-on-error", self.shard)
        for s in self.shard["steps"]:
            self.assertNotIn("continue-on-error", s, s.get("name"))
            if "if" in s:
                self.assertEqual(s["if"], "always()")
                self.assertTrue(s["uses"].startswith("actions/upload-artifact@"), s.get("name"))

    def test_artifacts_are_named_per_shard_and_complete(self):
        up = next(s for s in self.shard["steps"] if str(s.get("uses", "")).startswith("actions/upload-artifact@"))
        self.assertEqual(up["with"]["name"], "shard-${{ matrix.shard }}")
        self.assertEqual(up["with"]["if-no-files-found"], "error")
        self.assertTrue(up["with"]["overwrite"])
        for f in ("all_files.txt", "assigned.txt", "inventory.txt", "planned.txt", "junit.xml", "env.txt"):
            self.assertIn(f"shard-out/{f}", up["with"]["path"])
        # every uploaded path stays under shard-out/ so the artifact root is shard-out/ (the layout shard_proof.py reads)
        for line in (l.strip() for l in up["with"]["path"].splitlines() if l.strip()):
            self.assertIn("/shard-out/", line, line)

    # ── PG-SHARD-SAFETY-PARITY (A): runner facts, recording only ───────────────────────────────────────────
    FACTS = "حقائق المشغّل (تسجيل فقط)"

    def test_runner_facts_step_records_cpu_image_cores_and_a_bench(self):
        st = steps(self.shard)[self.FACTS]
        run = st["run"]
        for needle in ("RUNNER_NAME", "ImageOS", "ImageVersion", "nproc", "/proc/cpuinfo", "model name", "bench_ms", "shard-out/env.txt", "GITHUB_STEP_SUMMARY"):
            self.assertIn(needle, run)
        self.assertEqual(sum(self.FACTS == s.get("name") for s in self.shard["steps"]), 1)

    def test_runner_facts_step_cannot_change_behaviour_or_fail_the_job(self):
        st = steps(self.shard)[self.FACTS]
        self.assertNotIn("if", st)
        self.assertNotIn("continue-on-error", st)  # forbidden in required jobs: failures are contained by `|| true` instead
        run = st["run"]
        self.assertTrue(run.rstrip().endswith("|| true"), "the whole recording block must be failure-proof")
        for bad in ("php artisan", "phpunit", "docker", "psql", "composer", "sed -i", "export ", "PGOPTIONS", ">> .env", "> .env"):
            self.assertNotIn(bad, run, bad)
        self.assertIsNone(st.get("env"))
        self.assertIsNone(st.get("working-directory"))

    def test_runner_facts_step_runs_after_setup_and_before_selection_and_tests(self):
        order = [s.get("name", "") for s in self.shard["steps"]]
        i = order.index(self.FACTS)
        self.assertGreater(i, order.index("تهيئة قاعدة البيانات (pgsql)"))
        self.assertLess(i, order.index("اختيار الشريحة (${{ matrix.shard }}/2) وجرد الاختبارات"))
        self.assertLess(i, order.index(self.run_step()["name"]))

    def test_the_full_job_and_proof_job_do_not_carry_the_facts_step(self):
        self.assertNotIn(self.FACTS, steps(self.full))
        self.assertNotIn(self.FACTS, steps(self.proof))

    # ── proof job: trusted script, needs the shards, no skip ──────────────────────────────────────────────
    def test_proof_runs_the_script_from_the_trusted_base_not_the_pr(self):
        run = self.proof_step()["run"]
        self.assertIn(".trusted/scripts/ci-gate/shard_proof.py", run)
        self.assertNotRegex(run, r"(?<!\.trusted/)scripts/ci-gate/shard_proof\.py")
        co = [s for s in self.proof["steps"] if str(s.get("uses", "")).startswith("actions/checkout@")]
        trusted = next(s for s in co if s.get("with", {}).get("path") == ".trusted")
        self.assertEqual(trusted["with"]["ref"], "${{ github.event.pull_request.base.sha || github.sha }}")
        self.assertIn("scripts/ci-gate", trusted["with"]["sparse-checkout"])

    def test_proof_needs_shards_downloads_them_and_cannot_be_skipped(self):
        self.assertEqual(self.proof["needs"], [SHARD])
        for k in ("if", "continue-on-error"):
            self.assertNotIn(k, self.proof)
        for s in self.proof["steps"]:
            self.assertNotIn("if", s, s.get("name"))
            self.assertNotIn("continue-on-error", s, s.get("name"))
        dl = next(s for s in self.proof["steps"] if str(s.get("uses", "")).startswith("actions/download-artifact@"))
        self.assertEqual(dl["with"]["pattern"], "shard-*")
        self.assertEqual(dl["with"]["path"], "proof")
        run = self.proof_step()["run"]
        self.assertIn("set -euo pipefail", run)
        self.assertIn("git ls-files tests/Feature tests/Unit", run)
        self.assertIn("--manifest scripts/ci-gate/pg-shards.json", run)
        self.assertNotIn("|| true", run)

    def test_the_selector_and_the_proof_read_the_same_assignment_manifest(self):
        sel = steps(self.shard)["اختيار الشريحة (${{ matrix.shard }}/2) وجرد الاختبارات"]["run"]
        self.assertIn("scripts/ci-gate/pg-shards.json", sel)
        self.assertIn("scripts/ci-gate/pg-shards.json", self.proof_step()["run"])
        self.assertTrue((ROOT / "scripts/ci-gate/pg-shards.json").is_file())

    # ── additive: nothing existing was removed or renamed ─────────────────────────────────────────────────
    def test_group_is_additive_and_the_full_pgsql_check_is_still_required(self):
        self.assertEqual(self.group["status"], "additive")
        raw = json.loads(MANIFEST.read_text(encoding="utf-8"))["checks"]
        legacy = next(c for c in raw if c["name"] == "php artisan test (L11, pgsql)")
        self.assertEqual((legacy["workflow"], legacy["job"], legacy["tier"]), (".github/workflows/ci.yml", FULL, "always"))
        self.assertNotEqual(self.group["proof"]["name"], legacy["name"])


if __name__ == "__main__":
    unittest.main()
