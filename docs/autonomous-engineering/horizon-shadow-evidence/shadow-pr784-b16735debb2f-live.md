# Horizon Shadow report — PR #784

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T20:21:35Z |
| PR state | open |
| Head SHA | `b16735debb2f8619f2d3b1ac913be0b15695993d` |
| Base SHA | `f23db797c7032d522f098d4622b0e3447d6cba39` |
| Main SHA (at observation) | `073e102ac9334a4f80f368a64d1a3762bb701350` · base is current main: False |
| Risk zone | **C** (path C, behavior C, context A) |
| CI | failing · CI Gate: absent/None |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `5f0721d9a7ada9fdd44fa2b9410262261ad9b9fe83390804698ef4779d6cf289` |
| Report SHA-256 | `19e08fad63e65a44e830f1db0eb0d83969111bd2b9107469292f80c373a87cfe` |

## Why this recommendation

`CI_CHECK_NEVER_STARTED`, `CI_CHECK_NOT_SUCCESS`

## Changed paths and semantic surfaces

Surfaces: _none_

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `app/Console/Commands/RecoverHistoricalTenantCommand.php` | added | C | - |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `php artisan test (L11, sqlite)` | completed | failure |
| `php artisan test (L11, pgsql)` | completed | failure |

## Parallel Horizon conflicts

_none observed_

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 45600m after head push |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | b16735de |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `ZONE_C_OWNER_GATED` | 1 | app/Console/Commands/RecoverHistoricalTenantCommand.php |
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 45600m after head push |
| BLOCK | `CI_CHECK_NOT_SUCCESS` | 2 | php artisan test  L11, pgsql  failure |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 2 | php artisan test  L11, pgsql : main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | b16735de |
| WAIT | `PR_DRAFT` | 1 |  |
| INFO | `BEHAVIOR_FINANCIAL_OR_SECURITY_TOKEN` | 1 |  |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
