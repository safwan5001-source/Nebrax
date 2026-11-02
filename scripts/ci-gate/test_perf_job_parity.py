"""COPS-H1-1: وظيفة `pg-perf` تنسخ خطوات تجميع التطبيق من وظيفة `test` حرفياً (مشغّل خاص = لا مشاركة خطوات). هذا الحارس يفشل إن انحرفت إحداهما،
ويثبّت أن قياس الأداء لا يمرّ بخطوة الاختبار المضبوطة ولا يُخفَّف بإعدادات تجاوز، وأن وظيفة `test` الكاملة بلا تصفية."""
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CI = ROOT / ".github" / "workflows" / "ci.yml"
SHARED = [
    "Checkout core (النواة)",
    "Setup PHP 8.4",
    "السماح بتثبيت Laravel 11 (بيئة CI مؤقتة)",
    "إنشاء مشروع Laravel 11",
    "تثبيت Sanctum + تخزين S3/R2 + تفعيل مسارات API",
    "دمج ملفات النواة وطبقة الـ API",
    "تسجيل TenancyServiceProvider + حذف users migration الافتراضية",
]
PERF_STEP = "قياسات أداء تغذية الأحداث — تسلسلية على مشغّل خاص"


def steps(job):
    return {s.get("name"): s for s in job["steps"] if s.get("name")}


class PerfJobParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = CI.read_text(encoding="utf-8")
        cls.doc = yaml.safe_load(cls.text)
        cls.test_job = cls.doc["jobs"]["test"]
        cls.perf_job = cls.doc["jobs"]["pg-perf"]
        cls.ts, cls.ps = steps(cls.test_job), steps(cls.perf_job)

    def test_shared_assembly_steps_are_identical(self):
        for name in SHARED:
            with self.subTest(step=name):
                self.assertIn(name, self.ts)
                self.assertIn(name, self.ps)
                for key in ("run", "uses", "with", "working-directory", "shell", "env"):
                    self.assertEqual(self.ts[name].get(key), self.ps[name].get(key), f"{name!r}: {key} انحرف بين test وpg-perf")

    def test_same_postgres_service_and_app_dir(self):
        self.assertEqual(self.test_job["services"]["postgres"], self.perf_job["services"]["postgres"])
        self.assertEqual(self.test_job["env"], self.perf_job["env"])
        self.assertEqual(self.test_job["runs-on"], self.perf_job["runs-on"])

    def test_perf_step_is_not_a_guarded_artisan_test_step(self):
        run = self.ps[PERF_STEP]["run"]
        self.assertIn("vendor/bin/phpunit --group cops-h1-1-perf", run)
        self.assertNotIn("php artisan test", run)
        for need in ("set -euo pipefail", "--fail-on-skipped"):
            self.assertIn(need, run)
        for bad in ("|| true", "--filter", "--exclude-group", "--stop-on", "--parallel"):
            self.assertNotIn(bad, run)

    def test_perf_job_is_not_skippable(self):
        self.assertNotIn("if", self.perf_job, "job-level if يجعل الوظيفة المتخطّاة تُحتسب نجاحاً")
        self.assertNotIn("needs", self.perf_job, "الوظيفة مستقلة على مشغّل خاص")
        self.assertNotIn("if", self.ps[PERF_STEP])
        self.assertNotIn("continue-on-error", self.text)

    def test_full_suite_job_is_untouched_by_the_perf_group(self):
        for s in self.test_job["steps"]:
            run = str(s.get("run", ""))
            self.assertNotIn("cops-h1-1-perf", run, "وظيفة test يجب ألا تذكر المجموعة (التخطي ذاتي داخل الاختبار)")
            self.assertNotIn("--exclude-group", run)
            self.assertNotIn("--group", run)

    def test_the_summary_step_always_runs_and_the_artifact_is_uploaded_on_failure(self):
        summary = next(s for s in self.perf_job["steps"] if "summarize_feed_perf.py" in str(s.get("run", "")))
        self.assertIn("!cancelled()", str(summary.get("if")))
        upload = next(s for s in self.perf_job["steps"] if str(s.get("uses", "")).startswith("actions/upload-artifact"))
        self.assertEqual(upload.get("if"), "always()")

    def test_job_is_a_required_always_check_in_the_gate_manifest(self):
        import json

        m = json.loads((ROOT / ".github" / "ci-gate" / "required-checks.json").read_text(encoding="utf-8"))
        entry = next((c for c in m["checks"] if c["job"] == "pg-perf"), None)
        self.assertIsNotNone(entry, "pg-perf غير مصنَّف في CI Gate")
        self.assertEqual(entry["tier"], "always")
        self.assertEqual(entry["name"], self.perf_job["name"])
        self.assertEqual(entry["workflow"], ".github/workflows/ci.yml")
        self.assertEqual(entry["guard"]["step_run_contains"], "vendor/bin/phpunit --group cops-h1-1-perf")


if __name__ == "__main__":
    unittest.main()
