# Horizon Shadow evidence — status and how to read it

**Advisory, historical evidence. Nothing here authorises a merge, and none of it proves the *current* state of any PR.**

Regenerated for the V2-2 closure with the **final** implementation (file hashes in `MANIFEST.json → implementation_sha256`);
every report carries the real policy SHA-256 (`observation.policy_sha256`) and its evidence digest. Reports produced by earlier
iterations of this PR were deleted, not kept.

| Kind | Files (`-live` / `-replay`) | Status | Reproducible? |
|---|---|---|---|
| **replay** | 5 frozen snapshots in `scripts/horizon-eval/snapshots/` (PRs #1093, #1346, #1349, #1350, #586) | **Historical.** Evaluated at the snapshot's own recorded time; by design never `READY_FOR_MANUAL_REVIEW`. | **Yes** — byte-for-byte from the committed snapshot (guarded by `test_shadow_evidence.py`). |
| **live** | 9 open PRs observed read-only on 2026-10-13 (#1391, #1390, #1359, #586, #784, #1128, #853, #704, #1089) | **Point-in-time record.** The PR may since have merged, moved or been re-tested (e.g. #1391 and #1359 had merged by the time of this run). Not proof of current behaviour. | **No** — the raw GitHub snapshots are not committed (they contain PR text/logins). Integrity of the *report* is verifiable: `report_sha256` recomputes, policy SHA matches the policy file. |

Files per observation: `.json` (canonical, sorted keys) and `.md` (rendered). `MANIFEST.json` lists each report with its
`report_sha256`, `evidence_digest` and `policy_sha256`. `shadow-summary.md` is the one-page table.

**Regenerate:** `cd scripts/horizon-eval && python3 shadow_run.py --pr N … --snapshot snapshots/live-prNNN.json … --out-dir <dir>`,
then rebuild `MANIFEST.json`. If `shadow_observe.py`, `shadow_run.py`, `horizon_eval.py`, `collect_snapshot.py` or the policy file change,
`test_shadow_evidence.py` fails until the evidence is regenerated — stale evidence cannot sit in the repository silently.
