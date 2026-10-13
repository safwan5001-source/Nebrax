# Horizon Shadow report — PR #1391

**Recommendation: `OWNER_REVIEW`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T19:15:50Z |
| PR state | open |
| Head SHA | `c9dd9aee142547fcaff66bef5353b4f7879896f2` |
| Base SHA | `be3a7aac2353565d9f2beb5d9e2bb3b34bdd28e8` |
| Main SHA (at observation) | `8bd42cb040817873c319ff021bee0668e397aec1` · base is current main: False |
| Risk zone | **C** (path C, behavior B, context B) |
| CI | pending · CI Gate: in_progress/None |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `affa869383d84b1288f86077f021112a80e8de598bfa7f25b21d15ac9bded761` |
| Report SHA-256 | `ae9d3b00d1cf75947593d4b031a599fa4a70e0e8d6fa61a055472db83e302de3` |

## Why this recommendation

`INJECTION_SUSPECTED`, `UNREGISTERED_HORIZON_ACTIVE`, `ZONE_C_OWNER_GATED`

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
| `CI Gate` | in_progress | - |
| `php artisan test (L11, pgsql)` | in_progress | - |
| `php artisan test (L11, sqlite)` | completed | success |

## Parallel Horizon conflicts

| PR | Evidence | Registered | Recent activity | Shared paths | Shared surfaces |
|---|---|---|---|---|---|
| #1390 | observed | False | True | web/src/messages/ar.json, web/src/messages/en.json | - |

## Missing evidence

_none_

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
| STOP | `INJECTION_SUSPECTED` | 1 | INJ-OVERRIDE |
| STOP | `UNREGISTERED_HORIZON_ACTIVE` | 1 | PR 1390 overlaps with no registered claim |
| STOP | `ZONE_C_OWNER_GATED` | 1 | web/src/messages/ar.json,web/src/messages/en.json |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_CHECK_PENDING` | 2 | CI Gate in progress |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 4 | CI Gate: main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | c9dd9aee |
| INFO | `BEHAVIOR_NOT_PRESENTATIONAL` | 4 |  |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
