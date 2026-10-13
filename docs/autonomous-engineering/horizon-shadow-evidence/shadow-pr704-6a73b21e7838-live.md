# Horizon Shadow report — PR #704

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T20:22:18Z |
| PR state | open |
| Head SHA | `6a73b21e7838b3f374ad520615043f187ea1d01b` |
| Base SHA | `506a8c53238b7892ff1958ef860af8a9a6a3f0b6` |
| Main SHA (at observation) | `073e102ac9334a4f80f368a64d1a3762bb701350` · base is current main: False |
| Risk zone | **A** (path A, behavior A, context A) |
| CI | pending · CI Gate: absent/None |
| Owner review required | False |
| Evaluator raw decision | BLOCK |
| Evidence digest | `2317c07b437d3e99392eb2304764a997b98a91292de258ef996b34436868426d` |
| Report SHA-256 | `34a9e5790d6a3b783b75a69957a7e21a0615ff247cede37d27fdf5d4fc79719d` |

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
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 50264m after head push |
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
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 50264m after head push |
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
