# Horizon Shadow report — PR #1390

**Recommendation: `BLOCK`** — advisory only. `merge_authorized: false` · `grant_verified: false` · GitHub writes: 0

> Shadow Mode never grants permission to merge, deploy or change settings. A person decides.

| Field | Value |
|---|---|
| Observation | live (evidence age 0s) at 2026-10-13T20:20:51Z |
| PR state | open |
| Head SHA | `6e12fb1f83019b806b945910d6ebfb820b9182c8` |
| Base SHA | `be3a7aac2353565d9f2beb5d9e2bb3b34bdd28e8` |
| Main SHA (at observation) | `073e102ac9334a4f80f368a64d1a3762bb701350` · base is current main: False |
| Risk zone | **C** (path C, behavior C, context A) |
| CI | pending · CI Gate: completed/success |
| Owner review required | True |
| Evaluator raw decision | STOP OWNER DECISION |
| Evidence digest | `e5d5407a47713808e60f057cb79cfbe9e42a6361ab01bcd99d9744f753531a7e` |
| Report SHA-256 | `21db37175728412f42ead3a1054122eef35d183775ef60189354a0fd7ba55796` |

## Why this recommendation

`PATCH_UNAVAILABLE`

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
| `web build (Next.js)` | completed | success |
| `php artisan test (L11, sqlite)` | completed | success |
| `php artisan test (L11, pgsql)` | completed | success |
| `CI Gate` | completed | success |

## Parallel Horizon conflicts

_none observed_

## Missing evidence

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `PATCH_UNAVAILABLE` | 1 | docs/plans/pos/INT-UX-2-IMPLEMENTATION-REPORT.md |

## Authorization blockers (expected in Shadow Mode — no grant exists)

| Severity | Code | × | Detail |
|---|---|---|---|
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 6e12fb1f |

## All reasons

| Severity | Code | × | Detail |
|---|---|---|---|
| STOP | `ZONE_C_OWNER_GATED` | 1 | web/e2e/int-ux-2-delivery-platform-catalog.spec.ts,web/src/components/integrations/delivery-platform-catalog.test.tsx,web/src/components/integrations/delivery-p |
| BLOCK | `CLAIM_MISSING_OR_MISMATCH` | 1 |  |
| BLOCK | `HORIZON_LABEL_MISSING_OR_CONTRADICTORY` | 1 | 0 horizon label s  |
| BLOCK | `HORIZON_NOT_REGISTERED_V2` | 1 |  |
| BLOCK | `NO_ACTIVE_GRANT` | 1 |  |
| BLOCK | `PATCH_UNAVAILABLE` | 1 | docs/plans/pos/INT-UX-2-IMPLEMENTATION-REPORT.md |
| WAIT | `BASE_MOVED_RETEST` | 1 |  |
| WAIT | `CI_TESTED_AGAINST_OLDER_BASE` | 4 | CI Gate: main moved since this run; re-run needed |
| WAIT | `PRE_MERGE_REVIEW_MISSING` | 1 | 6e12fb1f |
| INFO | `BEHAVIOR_FINANCIAL_OR_SECURITY_TOKEN` | 5 |  |
| INFO | `BEHAVIOR_NOT_PRESENTATIONAL` | 14 |  |
| INFO | `CI_NON_PR_EVENT_RUNS_IGNORED` | 1 |  |

## Human checks remaining

- `a_person_decides_merge_shadow_mode_never_does`
- `approved_outcome_matches_pr_intent`
- `refetch_grants_and_head_immediately_before_any_real_merge`
