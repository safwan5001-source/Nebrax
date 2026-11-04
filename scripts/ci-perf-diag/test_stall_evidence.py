import json
import os
import tempfile
import unittest

import analyze as A
import stall_evidence as E
from test_analyze import rnd, stalled_queue


def stalled_round(commit=90.0, **kw):
    r = rnd(stalled_queue(commit=commit), added=80.0, slow=12, over=True, **kw)
    return r, A.freeze_of(r)


def sched(window, dt_us=5000, events=(), psi=(0, 0), busy=(0, 0)):
    """مرصد اصطناعي: عيّنة كل 5ms حول النافذة؛ psi/busy = زيادة داخل النافذة."""
    t0, t1 = window
    samples, t = [], int((t0 - 0.05) * 1e6)
    end = int((t1 + 0.05) * 1e6)
    n = max(1, (end - t) // 5000)
    for i in range(n + 1):
        frac = i / n
        samples.append([t + i * 5000, dt_us if i != n // 2 else dt_us, int(psi[0] * frac), 0, 0, int(busy[0] * frac), int(busy[1] * frac), 0, 0])
    return {"ok": True, "nspid_available": True, "samples": samples, "events": list(events)}


def log_line(t, pid, ms, stmt):
    from datetime import datetime, timezone
    ts = datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    return f"2026-11-04T12:00:00.000000000Z {ts} UTC [{pid}] LOG:  duration: {ms} ms  execute <unnamed>: {stmt}"


class ParseLog(unittest.TestCase):
    def test_parses_durations_checkpoints_and_autovacuum_with_docker_prefix(self):
        text = "\n".join([
            log_line(1_000_000.0, 1002, 90.5, "COMMIT"),
            "2026-11-04T12:00:00.1Z 2026-11-04 09:39:53.233 UTC [49] LOG:  checkpoint starting: time",
            "2026-11-04T12:00:00.2Z 2026-11-04 09:39:54.233 UTC [60] LOG:  automatic vacuum of table \"nibras.public.x\": index scans: 0",
            "noise line",
        ])
        out = E.parse_pg_log(text)
        kinds = [e["kind"] for e in out]
        self.assertEqual(kinds, ["duration", "checkpoint", "autovacuum"])
        self.assertEqual((out[0]["pid"], out[0]["ms"], out[0]["stmt"]), (1002, 90.5, "COMMIT"))

    def test_simple_and_named_statement_protocols_both_yield_the_statement_text(self):
        simple = "2026-11-04T12:00:00Z 2026-11-04 09:39:53.233 UTC [7] LOG:  duration: 61.2 ms  statement: COMMIT"
        named = "2026-11-04T12:00:00Z 2026-11-04 09:39:53.233 UTC [8] LOG:  duration: 3.0 ms  execute S_2: COMMIT"
        out = E.parse_pg_log(simple + "\n" + named)
        self.assertEqual([e["stmt"] for e in out], ["COMMIT", "COMMIT"])


class Evidence(unittest.TestCase):
    def setUp(self):
        self.rnd, self.fr = stalled_round()
        self.w = (self.fr["t_start"], self.fr["t_end"])
        self.mid = int(sum(self.w) / 2 * 1e6)

    def test_root_backend_runnable_but_not_running_is_cpu_proof(self):
        s = sched(self.w, events=[[self.mid, 5000, 1002, 200, 80_000]])
        ev = E.evidence(self.rnd, self.fr, s, [])
        self.assertIn("P2_root_backend_waited_cpu", ev["proofs"])
        self.assertEqual(ev["cause"], "cpu_scheduling")

    def test_other_backend_delay_does_not_prove_the_holder_waited(self):
        s = sched(self.w, events=[[self.mid, 5001, 1003, 200, 80_000]])    # باكند آخر
        ev = E.evidence(self.rnd, self.fr, s, [])
        self.assertNotIn("P2_root_backend_waited_cpu", ev["proofs"])
        self.assertEqual(ev["cause"], "unproven")

    def test_sampler_starvation_is_cpu_proof(self):
        s = sched(self.w)
        s["samples"][len(s["samples"]) // 2][1] = int(0.8 * self.fr["freeze_ms"] * 1000)
        ev = E.evidence(self.rnd, self.fr, s, [])
        self.assertIn("P1_sampler_starved", ev["proofs"])
        self.assertEqual(ev["cause"], "cpu_scheduling")

    def test_psi_alone_is_only_supporting_never_a_proof(self):
        s = sched(self.w, psi=(int(self.fr["freeze_ms"] * 1000), 0), busy=(95, 5))
        ev = E.evidence(self.rnd, self.fr, s, None)
        self.assertIn("S1_psi_cpu_some", ev["supporting"])
        self.assertEqual(ev["proofs"], [])
        self.assertEqual(ev["cause"], "unproven")

    def test_slow_commit_logged_by_postgres_is_server_side_proof(self):
        log = E.parse_pg_log(log_line(self.w[1], 1002, 88.0, "COMMIT"))
        ev = E.evidence(self.rnd, self.fr, sched(self.w), log)
        self.assertIn("P3_pg_commit_slow_in_pg", ev["proofs"])
        self.assertEqual(ev["cause"], "postgres_internal")

    def test_client_measured_commit_slow_but_postgres_fast_is_client_side(self):
        # السجل حيّ (التقط انتظار منتظرٍ آخر على القفل) ولا COMMIT بطيئاً للماسك ⇒ التأخر خارج الباكند.
        log = E.parse_pg_log(log_line(self.w[0] + 0.03, 1005, 60.0, "UPDATE commerce_order_feed_heads SET ..."))
        ev = E.evidence(self.rnd, self.fr, sched(self.w), log)
        self.assertIn("P4_client_side", ev["proofs"])
        self.assertEqual(ev["cause"], "client_side")

    def test_silent_log_does_not_prove_client_side(self):
        ev = E.evidence(self.rnd, self.fr, sched(self.w), [])
        self.assertNotIn("P4_client_side", ev["proofs"])
        self.assertEqual(ev["cause"], "unproven")

    def test_background_pg_event_is_supporting_only(self):
        log = E.parse_pg_log("2026-11-04T12:00:00Z " + __import__("datetime").datetime.fromtimestamp(self.w[0], tz=__import__("datetime").timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC [49] LOG:  checkpoint starting: time")
        ev = E.evidence(self.rnd, self.fr, sched(self.w), log)
        self.assertIn("S3_background_pg_event", ev["supporting"])
        self.assertFalse(any(p.startswith("P3") for p in ev["proofs"]))

    def test_missing_inputs_are_declared_not_guessed(self):
        ev = E.evidence(self.rnd, self.fr, None, None)
        self.assertEqual(ev["sched"], "missing")
        self.assertEqual(ev["pg_log"], "missing")
        self.assertEqual(ev["cause"], "unproven")


class Report(unittest.TestCase):
    def test_end_to_end_report_separates_proof_from_support_and_scores_controls(self):
        r_bad, fr = stalled_round()
        r_ok = rnd(stalled_queue(commit=5.0), added=12.0, over=False)
        r_ok["round"] = 2
        with tempfile.TemporaryDirectory() as root:
            d = os.path.join(root, "diag-main-tmpfs-1")
            os.makedirs(d)
            payload = {"workload": {"writers": 5, "per_writer": 4}, "host": {"variant": "main-tmpfs", "repeat": "1"}, "rounds": [r_bad, r_ok]}
            for rr in payload["rounds"]:
                rr.setdefault("kind", "gate_equiv")
            json.dump(payload, open(os.path.join(d, "cops-h1-1-diag.json"), "w"))
            w = (fr["t_start"], fr["t_end"])
            json.dump(sched(w, events=[[int(sum(w) / 2 * 1e6), 5000, 1002, 100, 80_000]]), open(os.path.join(d, "sched.json"), "w"))
            open(os.path.join(d, "pg.log"), "w").write("")
            jobs = E.collect(root)
            self.assertEqual(len(jobs), 1)
            text = E.build_report(jobs)
        self.assertIn("cpu_scheduling", text)
        self.assertIn("ضابط", text)
        self.assertIn("جولات gate_equiv", text)
        self.assertIn("داعم فقط", text)


if __name__ == "__main__":
    unittest.main()
