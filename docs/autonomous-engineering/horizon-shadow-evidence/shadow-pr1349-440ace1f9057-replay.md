# Horizon Shadow report — PR #1349

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | replay-frozen (evidence age 0s) at 2026-10-12T03:43:52Z |
| PR state | closed |
| Head SHA | `440ace1f90573e586d8478d83cda6c4890b018a5` |
| Base SHA | `097c5ee7c40f152aaaa8468a970d3db66c1ebf74` |
| Main SHA (at observation) | `40832b21ffe99ec193ec2e7732c79b987debcc8e` · base is current main: False |
| Risk zone | **B** (path B, behavior B, context B) |
| CI | passing · CI Gate: completed/success |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `04412d7e0bea694830719f0d8ffd48ed0ebe8eab55ab70d221c28e7b412e0ab7` |
| Report SHA-256 | `593b97e9d3ddb0cd9a5952d2d7b7d190ec87ef9a99ff779ff2b1cfe5b848c9a2` |

## Why this recommendation

`PATCH_UNAVAILABLE`, `PR_ALREADY_MERGED`, `TESTED_BASE_UNKNOWN`

## Changed paths and semantic surfaces

Surfaces: _none_

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `docs/plans/store/CUST-HV-V10A-IMPLEMENTATION-REPORT.md` | modified | A | - |
| `docs/plans/store/CUST-HV-V10B-IMPLEMENTATION-REPORT.md` | added | A | - |
| `web/e2e/flowers-h15-bloom-theme.spec.ts` | modified | B | - |
| `web/src/app/(commerce)/commerce/appearance/page.tsx` | modified | B | - |
| `web/src/app/(commerce)/commerce/themes/page.test.tsx` | modified | B | - |
| `web/src/app/(commerce)/commerce/themes/page.tsx` | modified | B | - |
| `web/src/modules/commerce-workspace/messages.ts` | modified | B | - |
| `web/src/modules/commerce-workspace/theme-registry.test.ts` | removed | B | - |
| `web/src/modules/commerce-workspace/theme-registry.ts` | removed | B | - |
| `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` | modified | B | - |
| `web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.themePreview.test.tsx` | added | B | - |
| `web/src/modules/store-experience-builder/__tests__/apply-theme-flow.test.ts` | added | B | - |
| `web/src/modules/store-experience-builder/messages.ts` | modified | B | - |
| `web/src/modules/store-experience-builder/themes/ThemePreviewBar.tsx` | added | B | - |
| `web/src/modules/store-experience-builder/themes/apply-theme-flow.ts` | added | B | - |
| `web/src/modules/store-experience-builder/themes/apply-theme.ts` | modified | B | - |
| `web/src/modules/store-experience-builder/themes/built-in-themes.ts` | modified | B | - |
| `web/src/modules/store-experience-builder/themes/index.ts` | modified | B | - |
| `web/src/modules/store-experience-builder/themes/preview-link.ts` | added | B | - |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `web build (Next.js)` | completed | success |
| `php artisan test (L11, sqlite)` | completed | success |
| `php artisan test (L11, pgsql)` | completed | success |
| `CI Gate` | completed | success |

## Parallel Horizon conflicts

| PR | Evidence | Registered | Recent activity | Shared paths | Shared surfaces |
|---|---|---|---|---|---|
| #1353 | observed | False | True | web/src/modules/store-experience-builder/messages.ts, web/src/modules/store-experience-builder/themes/index.ts | - |

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `PATCH_UNAVAILABLE` | 19 | docs/plans/store/CUST-HV-V10A-IMPLEMENTATION-REPORT.md |
| BLOCK | `TESTED_BASE_UNKNOWN` | 4 | CI Gate |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `GUARDIAN_MISSING` | 1 | 440ace1f |
| WAIT | `INDEPENDENT_REVIEW_MISSING` | 1 | 440ace1f |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 440ace1f |
| WAIT | `REGRESSION_TEST_MISSING` | 1 | 440ace1f |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `UNREGISTERED_HORIZON_ACTIVE` | 1 | PR 1353 overlaps with no registered claim |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| BLOCK | `PATCH_UNAVAILABLE` | 19 | docs/plans/store/CUST-HV-V10A-IMPLEMENTATION-REPORT.md |
| BLOCK | `PR_ALREADY_MERGED` | 1 |  |
| BLOCK | `TESTED_BASE_UNKNOWN` | 4 | CI Gate |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `GUARDIAN_MISSING` | 1 | 440ace1f |
| WAIT | `INDEPENDENT_REVIEW_MISSING` | 1 | 440ace1f |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 440ace1f |
| WAIT | `REGRESSION_TEST_MISSING` | 1 | 440ace1f |
| WAIT | `SHADOW_REPLAY_HISTORICAL` | 1 | frozen snapshot evaluated at its own recorded time; historical, cannot be ready |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
