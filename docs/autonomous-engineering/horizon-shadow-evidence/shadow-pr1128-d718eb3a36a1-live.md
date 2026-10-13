# Horizon Shadow report — PR #1128

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T19:16:59Z |
| PR state | open |
| Head SHA | `d718eb3a36a107de793b5fff3f1e3299666eaa74` |
| Base SHA | `82e5199fe75d06bb3546802d141f42da92e3a63f` |
| Main SHA (at observation) | `8bd42cb040817873c319ff021bee0668e397aec1` · base is current main: False |
| Risk zone | **A** (path A, behavior A, context A) |
| CI | pending · CI Gate: absent/None |
| Owner review required | False |
| Evaluator raw decision | BLOCK |
| Evidence digest | `193b91198d9c00ef538fa3122fb78b6f7788bb4adda1f2e9cfab685965905fcc` |
| Report SHA-256 | `2b9275fed6e776334410c9293014323d1107f21492dc0a68651b341e466f8188` |

## Why this recommendation

`CI_CHECK_NEVER_STARTED`

## Changed paths and semantic surfaces

Surfaces: _none_

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `docs/plans/growth/AWJ_GROWTH_FOUNDATION_HORIZON_V1.md` | added | A | - |
| `docs/plans/growth/AWJ_GROWTH_FOUNDATION_HORIZON_V1_BOOTSTRAP.md` | added | A | - |

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
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 18784m after head push |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | d718eb3a |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 18784m after head push |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 2 | php artisan test  L11, pgsql : main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | d718eb3a |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
