# Horizon Shadow report — PR #1391

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T20:20:35Z |
| PR state | closed |
| Head SHA | `c9dd9aee142547fcaff66bef5353b4f7879896f2` |
| Base SHA | `be3a7aac2353565d9f2beb5d9e2bb3b34bdd28e8` |
| Main SHA (at observation) | `073e102ac9334a4f80f368a64d1a3762bb701350` · base is current main: False |
| Risk zone | **C** (path C, behavior B, context B) |
| CI | passing · CI Gate: completed/success |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `caf939bdaaf6c03a55d8c5c6b7831fe644cd4cdea1899e1c26efab963f858512` |
| Report SHA-256 | `c39f2d78826a37ac51d2cc3e7e55c4b24a35c91260b1beb6b215f9d43d3e2a7c` |

## Why this recommendation

`PR_ALREADY_MERGED`, `TESTED_BASE_UNKNOWN`

## Changed paths and semantic surfaces

Surfaces: _none_

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `docs/plans/platform/AWJ-PLATFORM-UX-H15-08-TENANT-DETAILS-A11Y-REPORT.md` | added | A | - |
| `web/src/components/platform/application-override-card.tsx` | modified | B | - |
| `web/src/components/platform/commercial-operations-card.tsx` | modified | B | - |
| `web/src/components/platform/tenant-details-a11y.test.tsx` | added | B | - |
| `web/src/components/platform/use-horizontal-overflow.ts` | added | B | - |
| `web/src/messages/ar.json` | modified | C | - |
| `web/src/messages/en.json` | modified | C | - |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `web build (Next.js)` | completed | success |
| `CI Gate` | completed | success |
| `php artisan test (L11, pgsql)` | completed | success |
| `php artisan test (L11, sqlite)` | completed | success |

## Parallel Horizon conflicts

| PR | Evidence | Registered | Recent activity | Shared paths | Shared surfaces |
|---|---|---|---|---|---|
| #1390 | observed | False | False | web/src/messages/ar.json, web/src/messages/en.json | - |

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `TESTED_BASE_UNKNOWN` | 4 | CI Gate |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | c9dd9aee |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `INJECTION_SUSPECTED` | 1 | INJ-AUTH-CLAIM,INJ-OVERRIDE |
| STOP | `UNREGISTERED_PR_OVERLAP` | 1 | PR 1390 overlaps with no registered claim |
| STOP | `ZONE_C_OWNER_GATED` | 1 | web/src/messages/ar.json,web/src/messages/en.json |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| BLOCK | `PR_ALREADY_MERGED` | 1 |  |
| BLOCK | `TESTED_BASE_UNKNOWN` | 4 | CI Gate |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | c9dd9aee |
| INFO | `BEHAVIOR_NOT_PRESENTATIONAL` | 4 |  |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
