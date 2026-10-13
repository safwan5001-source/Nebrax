# Horizon Shadow report — PR #704

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T19:17:24Z |
| PR state | open |
| Head SHA | `6a73b21e7838b3f374ad520615043f187ea1d01b` |
| Base SHA | `506a8c53238b7892ff1958ef860af8a9a6a3f0b6` |
| Main SHA (at observation) | `8bd42cb040817873c319ff021bee0668e397aec1` · base is current main: False |
| Risk zone | **A** (path A, behavior A, context A) |
| CI | pending · CI Gate: absent/None |
| Owner review required | False |
| Evaluator raw decision | BLOCK |
| Evidence digest | `444af7c6a8a9aa68a12eb00ed70b22ad54bc5c504885ab9cfa5df6fa5015701a` |
| Report SHA-256 | `c349733490b89428ca6953535b0cfb6ccbedb49317cb76518686895137e233ed` |

## Why this recommendation

`CI_CHECK_NEVER_STARTED`, `PATCH_UNAVAILABLE`

## Changed paths and semantic surfaces

Surfaces: _none_

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `docs/audits/AWJ_ACCOUNTING_SETTINGS_PRODUCT_COMPLETENESS_AUDIT_2026-09.md` | added | A | - |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `php artisan test (L11, sqlite)` | completed | success |
| `php artisan test (L11, pgsql)` | completed | success |

## Parallel Horizon conflicts

_none observed_

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 50199m after head push |
| BLOCK | `PATCH_UNAVAILABLE` | 1 | docs/audits/AWJ ACCOUNTING SETTINGS PRODUCT COMPLETENESS AUDIT 2026-09.md |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 6a73b21e |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 50199m after head push |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| BLOCK | `PATCH_UNAVAILABLE` | 1 | docs/audits/AWJ ACCOUNTING SETTINGS PRODUCT COMPLETENESS AUDIT 2026-09.md |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 2 | php artisan test  L11, pgsql : main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 6a73b21e |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
