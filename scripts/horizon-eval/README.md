# Horizon authorization evaluator — DRY-RUN pilot (AWJ-HORIZON-V2-1C)

Implements the V2-1B evaluation algorithm (`docs/autonomous-engineering/AWJ-HORIZON-V2-1B-AUTHORITY-THREAT-MODEL.md` §4.2, §6, §8) as a **pure, offline, read-only** decision function.

**ELIGIBLE_SIMULATED never authorises anything.** The tool has no merge, deploy, settings, credential or network capability (enforced by `test_static_guards.py`). In `live` mode it can never output `ELIGIBLE_SIMULATED`, because no independent owner-authenticity verifier exists (V2-1B §4.6, decision D2).

| Output | Meaning |
|---|---|
| `ELIGIBLE_SIMULATED` | every rule passed **for a synthetic fixture** — a statement about the logic, not permission |
| `WAIT` | evidence may still arrive (CI pending, review missing, base moved, observation stale) |
| `BLOCK` | a rule failed (CI failed, grant expired/unauthentic, head changed, scope exceeded, bad input) |
| `STOP_OWNER_DECISION` | Zone C/P, governance paths, owner-gated action, parallel-horizon conflict, injection suspicion |

Severity: `STOP_OWNER_DECISION > BLOCK > WAIT > ELIGIBLE_SIMULATED`. Every decision carries machine-readable reason codes and an audit record (no secrets, no PR text, no tenant data).

## Files
| File | Role |
|---|---|
| `horizon_eval.py` | the evaluator + CLI (`evaluate`) — pure, no network/process/env |
| `policy/zone_policy.v1.json` | Zone A/B/C/P path table, surfaces, hard-deny list, CI floor (editing it is Zone C) |
| `ledger.py` | idempotent local audit store for interrupted-run recovery |
| `contract_runner.py` | loads the 23-case contract fixtures; prints the PASS/FAIL table |
| `collect_snapshot.py` | **read-only** `gh api` GET collector that builds a `live` snapshot of one PR |
| `shadow_observe.py` | **Shadow Mode (V2-2)** — pure: live evidence → evaluator → advisory report (`WAIT`/`BLOCK`/`OWNER_REVIEW`/`READY_FOR_MANUAL_REVIEW`) |
| `shadow_run.py` | **manual** Shadow runner: collects PRs read-only (via `collect_snapshot.py`), writes JSON + Markdown reports to a local directory |
| `fixtures/synthetic/` | **synthetic only** — the only place any grant-like file may exist |
| `snapshots/` | frozen read-only evidence from the real repository (live mode, never eligible) |
| `test_*.py` | unit, contract + exhaustive fail-closed mutation tests, static guards, CI-wiring guards (`test_ci_integration.py`) |

## Use
```bash
# tests (stdlib only; no PyYAML needed)
python3 -I -m unittest discover -s scripts/horizon-eval -v

# the 11-scenario / 23-case contract table
cd scripts/horizon-eval && python3 contract_runner.py

# evaluate a synthetic fixture (the flag is refused for any file outside fixtures/synthetic/)
python3 horizon_eval.py evaluate fixtures/synthetic/cases/DR-03.json --allow-synthetic-fixtures --replay
# without --replay the CLI binds `now` to the wall clock and refuses a case whose time differs by >5 min (CLOCK_SKEW)

# evaluate the live state of a PR (read-only; will be BLOCK/WAIT/STOP by design)
python3 collect_snapshot.py --pr 1349 --horizon CUST-HV --task V10b --category presentational-ui --agent my-session --out /tmp/pr1349.json
python3 horizon_eval.py evaluate /tmp/pr1349.json [--ledger /tmp/ledger]   # --replay for a frozen snapshot, e.g. snapshots/live-pr1349.json
```

## Shadow Mode (AWJ-HORIZON-V2-2) — manual, advisory, read-only
```bash
# observe open PRs now (read-only GETs through `gh api`; nothing is posted to them) -> local reports
python3 shadow_run.py --pr 1391 --pr 1390 --out-dir /tmp/shadow          # run from scripts/horizon-eval/
# re-render frozen evidence (historical; can never recommend READY_FOR_MANUAL_REVIEW)
python3 shadow_run.py --snapshot snapshots/live-pr586.json --out-dir /tmp/shadow
```
Writes `shadow-pr<N>-<head12>.json|.md` and `shadow-summary.md` (deterministic; no PR text, logins, tenant data or credentials).
The recommendation is **never** an authorization: every report carries `merge_authorized: false`, `grant_verified: false`, and lists the
authorization blockers (no registered horizon / claim / grant / attestation) instead of hiding them.

| Recommendation | Meaning |
|---|---|
| `BLOCK` | something failed or cannot be verified: CI failed/never started, incomplete/unassessable evidence, closed/merged PR, unknown reason code |
| `OWNER_REVIEW` | Zone C/P, governance/hard-deny path, parallel-Horizon conflict, injection suspicion (an owner is needed regardless of anything else) |
| `WAIT` | evidence may still arrive: CI pending, draft, base moved, stale snapshot, or a replayed (historical) snapshot |
| `READY_FOR_MANUAL_REVIEW` | fresh, complete, Zone A/B, CI Gate + required checks green on the head, base is current main, no conflicts — *worth a person's time*, nothing more |

Precedence `BLOCK > OWNER_REVIEW > WAIT > READY…`; `owner_review_required` is reported separately so a BLOCK never hides it.
Only the identity/registration/grant/attestation codes in `AUTHORIZATION_CODES` are excluded from the recommendation; every other
non-INFO reason (including codes added later) keeps its evaluator severity. No schedule or workflow runs it; adding one needs a separate approval.

## CI (AWJ-HORIZON-V2-1D)
`.github/workflows/horizon-eval-ci.yml` runs the suite on **every** push and pull request (no path filter, no skip) as the check
`Horizon dry-run evaluator (tests)`. It is a `tier: always` entry in `.github/ci-gate/required-checks.json`, so **CI Gate waits for it** on every PR.
It fails on any test failure/error/skip, on fewer tests than the `MIN_TESTS` floor, on a non-zero contract table (false-eligible must be 0),
or if the tests dirty the working tree. Raise `MIN_TESTS` when you add tests; never lower it. It does not enable anything: no merge, no grant, no ruleset.

## Not covered (by design — see the implementation report)
Real merges, auto-merge, branch updates, grant issuance, owner-authenticity verification, registry/grant directories on `main`, and semantic checking that a PR matches the grant's `approved_outcome` (listed as `human_checks_remaining` in every record).
