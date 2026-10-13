# Horizon Shadow report — PR #1346

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | replay-frozen (evidence age 0s) at 2026-10-12T03:43:42Z |
| PR state | closed |
| Head SHA | `473f6a83a1c0b2f9edbcd1efcaf564906c6734cb` |
| Base SHA | `b3dc3d8e68a127dfd2ca5d1c3f50e4e5a8676ffd` |
| Main SHA (at observation) | `40832b21ffe99ec193ec2e7732c79b987debcc8e` · base is current main: False |
| Risk zone | **C** (path C, behavior B, context B) |
| CI | passing · CI Gate: completed/success |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `6458dd88d34e88874c880fb1ed752015d105477c8502a1966833220d3e535775` |
| Report SHA-256 | `1089f259819e8f2d66339f049a4293195e6d5dd6a2c57be8c19206f50d6fcbcf` |

## Why this recommendation

`PATCH_UNAVAILABLE`, `PR_ALREADY_MERGED`, `TESTED_BASE_UNKNOWN`

## Changed paths and semantic surfaces

Surfaces: `S-GOV-DOCS` (exclusive)

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `docs/autonomous-engineering/AWJ-HORIZON-AUTONOMY-V2-PROPOSAL.md` | modified | C | S-GOV-DOCS |
| `docs/autonomous-engineering/AWJ-HORIZON-V2-1B-AUTHORITY-THREAT-MODEL.md` | added | C | S-GOV-DOCS |
| `docs/autonomous-engineering/AWJ-HORIZON-V2-1B-IMPLEMENTATION-REPORT.md` | added | C | S-GOV-DOCS |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `php artisan test (L11, sqlite)` | completed | success |
| `php artisan test (L11, pgsql)` | completed | success |
| `CI Gate` | completed | success |

## Parallel Horizon conflicts

| PR | Evidence | Registered | Recent activity | Shared paths | Shared surfaces |
|---|---|---|---|---|---|
| #202 | observed | False | False | - | S-GOV-DOCS |
| #1351 | observed | False | True | - | S-GOV-DOCS |

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `PATCH_UNAVAILABLE` | 3 | docs/autonomous-engineering/AWJ-HORIZON-AUTONOMY-V2-PROPOSAL.md |
| BLOCK | `TESTED_BASE_UNKNOWN` | 3 | CI Gate |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 473f6a83 |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `SHADOW_HARD_DENY_PATH` | 1 | 3 governance/production path s : docs/autonomous-engineering/AWJ-HORIZON-AUTONOMY-V2-PROPOSAL.md,docs/autonomous-engineering/AWJ-HORIZON-V2-1B-AUTHORITY-THREAT-… |
| STOP | `UNREGISTERED_HORIZON_ACTIVE` | 1 | PR 1351 overlaps with no registered claim |
| STOP | `UNREGISTERED_PR_OVERLAP` | 1 | PR 202 overlaps with no registered claim |
| STOP | `ZONE_C_OWNER_GATED` | 1 | docs/autonomous-engineering/AWJ-HORIZON-AUTONOMY-V2-PROPOSAL.md,docs/autonomous-engineering/AWJ-HORIZON-V2-1B-AUTHORITY-THREAT-MODEL.md,docs/autonomous-engineer |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| BLOCK | `PATCH_UNAVAILABLE` | 3 | docs/autonomous-engineering/AWJ-HORIZON-AUTONOMY-V2-PROPOSAL.md |
| BLOCK | `PR_ALREADY_MERGED` | 1 |  |
| BLOCK | `TESTED_BASE_UNKNOWN` | 3 | CI Gate |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 473f6a83 |
| WAIT | `SHADOW_REPLAY_HISTORICAL` | 1 | frozen snapshot evaluated at its own recorded time; historical, cannot be ready |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
