# Horizon Shadow report — PR #1390

**Recommendation: `OWNER_REVIEW`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T19:16:03Z |
| PR state | open |
| Head SHA | `ae0bd0bb94c675a2f9a11708248bbebbb0dc1a8d` |
| Base SHA | `be3a7aac2353565d9f2beb5d9e2bb3b34bdd28e8` |
| Main SHA (at observation) | `8bd42cb040817873c319ff021bee0668e397aec1` · base is current main: False |
| Risk zone | **C** (path C, behavior C, context B) |
| CI | pending · CI Gate: in_progress/None |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `ca09ed5ce4fe7bb6314ac76138c8cd98109ac03b2f232a3ce8f8946a8aa9752c` |
| Report SHA-256 | `afa15c78d9e843fb0b84ece5100ed69d21234baf8318a525c6d24a187b0774c3` |

## Why this recommendation

`UNREGISTERED_HORIZON_ACTIVE`, `ZONE_C_OWNER_GATED`

## Changed paths and semantic surfaces

Surfaces: `S-RBAC-TENANT` (exclusive)

| Path | Status | Zone | Surfaces |
|---|---|---|---|
| `docs/plans/pos/INT-UX-2-IMPLEMENTATION-REPORT.md` | added | A | - |
| `web/e2e/int-ux-1-integration-center.spec.ts` | modified | B | - |
| `web/e2e/int-ux-2-delivery-platform-catalog.spec.ts` | added | C | - |
| `web/src/app/(app)/integrations/delivery-platforms/[platformKey]/page.test.tsx` | added | B | - |
| `web/src/app/(app)/integrations/delivery-platforms/[platformKey]/page.tsx` | added | B | - |
| `web/src/app/(app)/integrations/delivery-platforms/page.test.tsx` | added | B | - |
| `web/src/app/(app)/integrations/delivery-platforms/page.tsx` | added | B | - |
| `web/src/app/(app)/integrations/page.test.tsx` | modified | B | - |
| `web/src/components/integrations/delivery-ladder.tsx` | added | B | - |
| `web/src/components/integrations/delivery-platform-catalog.test.tsx` | added | C | - |
| `web/src/components/integrations/delivery-platform-catalog.tsx` | added | B | - |
| `web/src/components/integrations/delivery-platform-detail.test.tsx` | added | C | - |
| `web/src/components/integrations/delivery-platform-detail.tsx` | added | B | - |
| `web/src/components/integrations/integration-center-landing.test.tsx` | modified | B | - |
| `web/src/components/integrations/integration-shell.tsx` | added | B | - |
| `web/src/components/integrations/no-connection-controls.test.ts` | added | C | - |
| `web/src/components/integrations/use-delivery-integration-data.ts` | added | B | - |
| `web/src/lib/integration-center.demo.test.ts` | added | C | S-RBAC-TENANT |
| `web/src/lib/integration-center.ladder.test.ts` | added | C | S-RBAC-TENANT |
| `web/src/lib/integration-center.test.ts` | modified | C | S-RBAC-TENANT |
| `web/src/lib/integration-center.ts` | modified | C | S-RBAC-TENANT |
| `web/src/lib/mock-data.ts` | modified | C | S-RBAC-TENANT |
| `web/src/messages/ar.json` | modified | C | - |
| `web/src/messages/en.json` | modified | C | - |

## CI

| Check | Status | Conclusion |
|---|---|---|
| `web build (Next.js)` | in_progress | - |
| `CI Gate` | in_progress | - |
| `php artisan test (L11, pgsql)` | queued | - |
| `php artisan test (L11, sqlite)` | queued | - |

## Parallel Horizon conflicts

| PR | Evidence | Registered | Recent activity | Shared paths | Shared surfaces |
|---|---|---|---|---|---|
| #1391 | observed | False | True | web/src/messages/ar.json, web/src/messages/en.json | - |
| #1392 | observed | False | True | - | S-RBAC-TENANT |

## Missing evidence

_none_

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | ae0bd0bb |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `UNREGISTERED_HORIZON_ACTIVE` | 2 | PR 1391 overlaps with no registered claim |
| STOP | `ZONE_C_OWNER_GATED` | 1 | web/e2e/int-ux-2-delivery-platform-catalog.spec.ts,web/src/components/integrations/delivery-platform-catalog.test.tsx,web/src/components/integrations/delivery-p |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_CHECK_PENDING` | 4 | CI Gate in progress |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 4 | CI Gate: main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | ae0bd0bb |
| INFO | `BEHAVIOR_FINANCIAL_OR_SECURITY_TOKEN` | 5 |  |
| INFO | `BEHAVIOR_NOT_PRESENTATIONAL` | 14 |  |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
