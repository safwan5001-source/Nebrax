# Horizon Shadow report — PR #586

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T19:16:33Z |
| PR state | open |
| Head SHA | `156b4270f9e454bcf78362ea9a2088afbe478e1a` |
| Base SHA | `4710169140224f8439a809920c2a6e56c8cbab84` |
| Main SHA (at observation) | `8bd42cb040817873c319ff021bee0668e397aec1` · base is current main: False |
| Risk zone | **C** (path C, behavior C, context A) |
| CI | pending · CI Gate: absent/None |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `31789dfae9dc8cc108a40e04c40996c0dbd3fd8c26ff4c8f45156ce0378be835` |
| Report SHA-256 | `140c361eeb7097541c9744b5090d67cd395ddb26cf4b70c1d540b4c99e99464f` |

## Why this recommendation

`CI_CHECK_NEVER_STARTED`

## Changed paths and semantic surfaces

Surfaces: `S-LEDGER` (exclusive), `S-ZATCA-ICV` (exclusive)

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `app/Services/Accounting/ZatcaSignedInvoiceQrCoordinator.php` | added | C | S-LEDGER,S-ZATCA-ICV |
| `app/Services/Accounting/ZatcaSignedInvoiceQrResult.php` | added | C | S-LEDGER,S-ZATCA-ICV |
| `tests/Feature/ZatcaSignedInvoiceQrCoordinatorTest.php` | added | C | S-ZATCA-ICV |

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
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 63666m after head push |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 156b4270 |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `ZONE_C_OWNER_GATED` | 1 | app/Services/Accounting/ZatcaSignedInvoiceQrCoordinator.php,app/Services/Accounting/ZatcaSignedInvoiceQrResult.php,tests/Feature/ZatcaSignedInvoiceQrCoordinator |
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 63666m after head push |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 2 | php artisan test  L11, pgsql : main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 156b4270 |
| INFO | `BEHAVIOR_FINANCIAL_OR_SECURITY_TOKEN` | 3 |  |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
