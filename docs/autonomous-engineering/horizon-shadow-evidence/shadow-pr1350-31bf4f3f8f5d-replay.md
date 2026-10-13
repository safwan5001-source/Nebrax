# Horizon Shadow report — PR #1350

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | replay-frozen (evidence age 0s) at 2026-10-12T03:43:10Z |
| PR state | closed |
| Head SHA | `31bf4f3f8f5ddcb412f6a72f497a286b5760e6c9` |
| Base SHA | `11abda97dd1d25782d27f06f0312a3d5abec57a2` |
| Main SHA (at observation) | `40832b21ffe99ec193ec2e7732c79b987debcc8e` · base is current main: False |
| Risk zone | **C** (path C, behavior B, context B) |
| CI | passing · CI Gate: completed/success |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `8e6c4bde73db8ac7383e212d4c6bb39e16d726df82cffb4d16789d156a58e024` |
| Report SHA-256 | `ef011c29b51b33b604780e5d04a53f6838266e67844f0701a7680f6cc5312426` |

## Why this recommendation

`PATCH_UNAVAILABLE`, `PR_ALREADY_MERGED`, `TESTED_BASE_UNKNOWN`

## Changed paths and semantic surfaces

Surfaces: `S-ATTACH-STORAGE` (shared-write)

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `AWJ-HORIZON-MEDIA-STORAGE-S7-IMPLEMENTATION-REPORT.md` | added | C | - |
| `app/Services/DocumentCenter/DocumentStorageService.php` | modified | C | S-ATTACH-STORAGE |
| `tests/Feature/DocumentStorageDurableProfileTest.php` | added | B | - |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `php artisan test (L11, pgsql)` | completed | success |
| `CI Gate` | completed | success |
| `php artisan test (L11, sqlite)` | completed | success |

## Parallel Horizon conflicts

| PR | Evidence | Registered | Recent activity | Shared paths | Shared surfaces |
|---|---|---|---|---|---|
| #1354 | observed | False | True | app/Services/DocumentCenter/DocumentStorageService.php | S-ATTACH-STORAGE |

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `PATCH_UNAVAILABLE` | 3 | AWJ-HORIZON-MEDIA-STORAGE-S7-IMPLEMENTATION-REPORT.md |
| BLOCK | `TESTED_BASE_UNKNOWN` | 3 | CI Gate |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 31bf4f3f |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `UNREGISTERED_HORIZON_ACTIVE` | 1 | PR 1354 overlaps with no registered claim |
| STOP | `ZONE_C_OWNER_GATED` | 1 | AWJ-HORIZON-MEDIA-STORAGE-S7-IMPLEMENTATION-REPORT.md,app/Services/DocumentCenter/DocumentStorageService.php |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| BLOCK | `PATCH_UNAVAILABLE` | 3 | AWJ-HORIZON-MEDIA-STORAGE-S7-IMPLEMENTATION-REPORT.md |
| BLOCK | `PR_ALREADY_MERGED` | 1 |  |
| BLOCK | `TESTED_BASE_UNKNOWN` | 3 | CI Gate |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 31bf4f3f |
| WAIT | `SHADOW_REPLAY_HISTORICAL` | 1 | frozen snapshot evaluated at its own recorded time; historical, cannot be ready |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
