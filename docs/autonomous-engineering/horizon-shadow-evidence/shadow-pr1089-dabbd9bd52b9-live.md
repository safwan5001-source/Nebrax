# Horizon Shadow report — PR #1089

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T20:22:31Z |
| PR state | open |
| Head SHA | `dabbd9bd52b97174981dacceac70b97a0d3703e4` |
| Base SHA | `019f2ad36ae775f0d4ef51103282fa5f8c8c16c8` |
| Main SHA (at observation) | `073e102ac9334a4f80f368a64d1a3762bb701350` · base is current main: False |
| Risk zone | **C** (path C, behavior C, context A) |
| CI | pending · CI Gate: absent/None |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `5f976b8aa95e9d935cd344c8f6c3ee04ec628f37b9609ca0f7ba793764596e48` |
| Report SHA-256 | `134fb026d9223ea6efcbd75e5721973323739cbec39fca9652715233fd5b6b3c` |

## Why this recommendation

`CI_CHECK_NEVER_STARTED`

## Changed paths and semantic surfaces

Surfaces: `S-ROUTES` (shared-write)

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `app/Http/Controllers/Api/CommerceWorkspaceStorefrontPresentationVersionController.php` | modified | C | - |
| `app/Http/Requests/PublishStorefrontPresentationVersionRequest.php` | added | C | - |
| `app/Services/Commerce/StorefrontPresentationVersionService.php` | modified | C | - |
| `routes/api.php` | modified | C | S-ROUTES |
| `tests/Feature/CommerceModuleBoundaryTest.php` | modified | B | - |
| `tests/Feature/StorefrontPresentationVersionPublishApiTest.php` | added | C | - |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `php artisan test (L11, pgsql)` | completed | success |
| `php artisan test (L11, sqlite)` | completed | success |

## Parallel Horizon conflicts

_none observed_

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 21884m after head push |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | dabbd9bd |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `ZONE_C_OWNER_GATED` | 1 | app/Http/Controllers/Api/CommerceWorkspaceStorefrontPresentationVersionController.php,app/Http/Requests/PublishStorefrontPresentationVersionRequest.php,app/Serv |
| BLOCK | `CI_CHECK_NEVER_STARTED` | 1 | CI Gate absent 21884m after head push |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 2 | php artisan test  L11, pgsql : main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | dabbd9bd |
| INFO | `BEHAVIOR_FINANCIAL_OR_SECURITY_TOKEN` | 2 |  |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
