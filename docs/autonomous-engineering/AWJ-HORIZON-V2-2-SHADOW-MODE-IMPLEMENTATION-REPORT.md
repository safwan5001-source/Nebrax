# AWJ-HORIZON-V2-2 — Shadow Mode Pilot: Implementation Report

**Status:** implemented, awaiting owner review. **Not merged. No deploy. No settings changed.**

| | |
|---|---|
| Branch | `horizon/v2-2-shadow-mode-pilot` |
| Starting point | `37daa1bce54709e604b9ca5953d938da307c4bfb` (merge of PR #1382, V2-1D) |
| PR / final Head SHA / CI on final head | recorded in the PR description (a report cannot contain the SHA of the commit that carries it) |

## 1. What was built

A read-only observer that turns the existing V2-1C evaluator's audit record for a live PR snapshot into an **advisory** report with one recommendation:
`WAIT`, `BLOCK`, `OWNER_REVIEW` or `READY_FOR_MANUAL_REVIEW`. It reuses `collect_snapshot.py` (GET-only) and `horizon_eval.evaluate()` unchanged.

**Shadow Mode never authorises anything.** Every report carries `merge_authorized: false` and `grant_verified: false` (constants, guarded by tests);
the authorization blockers (no registered horizon / claim / grant / attestation) are listed, never hidden. `READY_FOR_MANUAL_REVIEW` means "worth a person's time".

### Files changed
| File | Change |
|---|---|
| `scripts/horizon-eval/shadow_observe.py` | **new** — pure observer + JSON/Markdown renderers (no network/process/env/filesystem/clock) |
| `scripts/horizon-eval/shadow_run.py` | **new** — manual runner: `--pr N` (live, read-only) / `--snapshot FILE` (replay), `--out-dir` required |
| `scripts/horizon-eval/test_shadow_observe.py` | **new** — 52 tests (see §3) |
| `scripts/horizon-eval/README.md` | usage + recommendation table |
| `.github/workflows/horizon-eval-ci.yml` | **one number**: `MIN_TESTS` 181 → 233 (raise-only floor; an existing guard test *requires* it to track the suite size). No step, trigger, name or permission changed |
| `docs/autonomous-engineering/horizon-shadow-evidence/*` | **new** — 15 generated reports (14 observations + summary), §4 |
| this report | **new** |

Not touched: application code, accounting, ZATCA, RBAC, tenancy, migrations, APIs, `horizon_eval.py`, `collect_snapshot.py`, policy JSON, CI Gate, `required-checks.json`, rulesets, branch protection, any other workflow.

### Report content
PR number, head/base/main SHA (+ whether base is current main) · risk zone A/B/C/P with basis · changed paths with per-path zone and semantic surfaces ·
CI + CI Gate status and per-check table · parallel Horizon conflicts (PR, shared paths/surfaces, evidence kind, registered, recent activity) ·
missing evidence · authorization blockers · all reasons (collapsed, with counts) · recommendation + the codes driving it · `owner_review_required` ·
evaluator's raw decision, evidence digest, policy hash, report SHA-256 · `human_checks_remaining`.

### Recommendation logic (fail-closed)
Precedence `BLOCK > OWNER_REVIEW > WAIT > READY`; `owner_review_required` is reported separately so a BLOCK never hides it.
* Only the explicit `AUTHORIZATION_CODES` (horizon registration, claim, label, no-grant, registry-owner/author/branch, missing attestations) are excluded from the verdict.
  **Every other non-INFO reason — including codes added to the evaluator later — keeps its evaluator severity.** No `GRANT_*` prefix carve-out (review finding, fixed).
* READY additionally requires, re-checked independently: Zone A/B, CI Gate and all required checks green on the head, PR open and not draft, base == current main,
  no conflicts, no hard-deny path, no injection flag, live (not replay), evaluator record sane (`would_merge` false, zero tool calls, never ELIGIBLE_SIMULATED).
  A failed re-check becomes `BLOCK` (`SHADOW_*`).
* Stale/future evidence, clock skew, missing clock, truncated text, incomplete file/patch lists, unknown tested-base, non-Actions check apps, dropped manifest checks → WAIT/BLOCK, never READY.
* Replayed (frozen) snapshots are historical and can **never** be READY. Synthetic cases/fixtures are rejected (`allow_synthetic` hard-wired `False`).
* Any internal exception → a BLOCK report; nothing raises. Hostile `horizon_id` collision with the reserved `SHADOW` id → BLOCK.
* Output hygiene: report is built from allow-listed fields; evaluator reason *details* are shown only for codes known to carry names/counts/paths (others by code alone);
  Markdown cells neutralise pipes, backticks, tags, links, mentions, emphasis; secret-like content withholds the report; file names derive only from int PR number + 40-hex SHA + mode.

## 2. Usage
```bash
cd scripts/horizon-eval
python3 shadow_run.py --pr 1391 --pr 1390 --out-dir /tmp/shadow            # live, read-only GETs
python3 shadow_run.py --snapshot snapshots/live-pr586.json --out-dir /tmp/shadow   # replay (historical)
```
Manual only. **No workflow, schedule or trigger runs it** (a test fails if any workflow references it). Exit 0 = reports written; 1 = an observation failed (nothing written for it); 2 = bad arguments.

## 3. Test results
| Suite | Result |
|---|---|
| `python3 -I -B -m unittest discover -s scripts/horizon-eval` | **233 tests, OK** (181 existing + 52 new), 0 skips |
| `contract_runner.py` | 23/23 PASS in 11 scenarios, **false-eligible 0** |
| `python3 -I -B -m unittest discover -s scripts/ci-gate` | 72 tests, OK (CI Gate behaviour unchanged) |
| Working tree after tests | clean (`git status --porcelain --ignored`) |

New tests cover: recommendation matrix and precedence · 30+ fail-closed mutations (CI pending/failed/skipped/cancelled/wrong app/wrong event/other head/unknown base/completed-before-push,
gate absent inside and outside grace, base moved, manifest not from main, draft/closed/merged, changes requested, incomplete file list, dropped patch, truncated text, counters,
head not in commits, fork, stale/future/skewed evidence, missing clock, replay, injection, CI-hollowing patch, synthetic/non-live input, garbage input, evaluator exception,
unknown future reason codes at every severity, quiet/lying evaluator, stale/foreign grant store, reserved-id collision) · every synthetic contract fixture can never make Shadow READY ·
determinism and report hash · no PR text/logins/secrets/branch names in output · Markdown hostile input · path-list cap · the five frozen real snapshots ·
runner (deterministic files, hermetic live path with mocked collector, failed observation writes nothing, hostile file names, repository stays clean) ·
read-only-by-construction guards (imports, no clock/env/fs, no GitHub-write vocabulary, constant-false authorization, no workflow wiring).

Mutation sanity (by hand during review): removing the READY re-check, the carve-out narrowing, and the detail allow-list each fail a named test.

## 4. Read-only observation evidence
Collected with `shadow_run.py` (GET-only). **Nothing was posted to any observed PR** (no comments, labels, reviews, statuses). Full reports: `docs/autonomous-engineering/horizon-shadow-evidence/`.

| PR | Mode | Rec. | Zone | CI | Driving codes |
|---|---|---|---|---|---|
| #1391 (web a11y) | live | OWNER_REVIEW | C | pending | INJECTION_SUSPECTED, UNREGISTERED_HORIZON_ACTIVE, ZONE_C_OWNER_GATED |
| #1390 (web catalog) | live | OWNER_REVIEW | C | pending | UNREGISTERED_HORIZON_ACTIVE, ZONE_C_OWNER_GATED |
| #1359 (docs, merged during the run) | live | BLOCK | C | passing | PR_ALREADY_MERGED, TESTED_BASE_UNKNOWN |
| #586 (ZATCA) | live / replay | BLOCK | C | pending | CI_CHECK_NEVER_STARTED |
| #784 (draft, recovery) | live | BLOCK | C | failing | CI_CHECK_NEVER_STARTED, CI_CHECK_NOT_SUCCESS |
| #1128, #853, #704 (docs) | live | BLOCK | A | pending | CI_CHECK_NEVER_STARTED (legacy PRs: no CI Gate run) |
| #1089 | live | BLOCK | C | pending | CI_CHECK_NEVER_STARTED |
| #1093, #1346, #1349, #1350 | replay | BLOCK | A/C/B/C | — | historical; merged or no gate |

Observations worth the owner's attention:
* **No real PR is READY today.** The READY path is proven by tests on a synthetic all-green case only; every real open PR either predates CI Gate, is Zone C by default-deny, or is in flight.
* `#1359`: the PR merged between two of my runs; the second run correctly reported `PR_ALREADY_MERGED` — the tool reflects GitHub, not a cached view.
* `#1391`: `INJECTION_SUSPECTED` (pattern `INJ-OVERRIDE`) is the evaluator's existing text screen; it may be a false positive on benign wording. Left conservative; not changed here.
* Zone classification is the evaluator's, unchanged: root-level `AWJ-*.md` docs and `web/src/messages/*` are Zone C by default-deny. Shadow Mode does **not** expand Zone A or B.

## 5. Fail-closed behaviour and known limitations
* The observer cannot see attestations (agent-recorded, not on GitHub), registries or grants — it reports them as authorization blockers; it cannot verify owner authenticity (V2-1B D2).
* A fully green Zone A/B PR can reach READY despite the authorization blockers, by design; consumers must not read READY as permission.
* Dropped patches (large diffs, `--patch-limit`) make behaviour unassessable → BLOCK. Conservative; raise `--patch-limit` to observe big PRs.
* Live freshness relies on the caller's clock; evaluator `CLOCK_SKEW` (>5 min) and `EVIDENCE_STALE` (>300 s) apply.
* A `GRANT_*` problem in a future grant store makes Shadow BLOCK/WAIT rather than ignore it (stricter than needed; deliberate).
* `snapshot_time` is the evidence time, not generation time (kept so output is deterministic).
* Live collection enumerates every open PR's files (≈ 10–15 s per PR); fine for manual use, not for tight loops.

## 6. Security and backward compatibility
* No new capability: observer is pure (static tests: no network/process/env/fs/clock imports or identifiers); runner's only network path is the existing GET-only `gh_get`; only local writes are the report files (atomic temp+replace) in `--out-dir`.
* No credentials, PR text, logins, branch names or tenant data in output; secret-shaped content withholds the report.
* Existing behaviour: evaluator, collector, policy, contract table, CI Gate and required checks unchanged; existing 181 tests untouched and green. The only shared-file edit is the `MIN_TESTS` number.
* Governed path: `scripts/horizon-eval/**` and `.github/**` are Zone C in the evaluator's own policy — this PR therefore needs an owner decision by design.

## 7. Review record
* **Implementer:** self-review + full suites above.
* **Independent Reviewer / AWJ Guardian (unanchored subagent, adversarial, read-only):** no blockers; 1 major + minors, all addressed:
  1. *Major* — `GRANT_`/`SYNTHETIC_GRANT_` prefix carve-out ignored stale/foreign grant-store signals → prefixes removed, carve-out narrowed to registration/no-grant/attestation codes; tests added.
  2. Reviewer login leaked via `CHANGES_REQUESTED_OUTSTANDING` detail → details allow-listed by code; test added.
  3. Markdown link/mention/emphasis not neutralised → stricter escaping outside code spans; tests added.
  4. Placeholder id `SHADOW` could collide with a registered horizon → `SHADOW_HORIZON_ID_COLLISION` BLOCK; test added.
  5. Zone B reaching READY undocumented → documented. Nit: `generated_at` renamed `snapshot_time`.
  Self-found: live and replay reports for the same PR/head overwrote each other → mode added to file names.
* **PRE_MERGE_REVIEW:** scope check against the brief — no merge/deploy/auto-merge/ruleset/protection/permission change, no CI Gate behaviour change, no app code, no GitHub writes to observed PRs, no other Horizon branch touched, no grant activation, no new workflow, no zone expansion. ✔
  (This is an agent-recorded review, not a human approval and not an attestation the evaluator can consume.)

## 8. Risks, remaining decisions, rollback, next step
* **Risk:** READY is misread as approval → mitigated by constants, wording in every report, tests; keep it advisory.
* **Risk:** `MIN_TESTS` is exact (233); any later test-count change must move it (existing convention).
* **Decisions for the owner:** (a) accept Zone-C-governed edit of `.github/workflows/horizon-eval-ci.yml` (one number); (b) whether Shadow output may later be posted anywhere (currently never); (c) whether to enable scheduled execution (not enabled; separate approval); (d) whether to review the `INJ-OVERRIDE` false-positive pattern; (e) whether Zone B should be able to reach READY.
* **Rollback:** revert the PR (new files + one number); nothing else depends on them.
* **Next step (V2-2b, needs approval):** optional scheduled runner writing artifacts only, then comparison of Shadow recommendations against actual human merge decisions to calibrate before any authority is ever considered.
