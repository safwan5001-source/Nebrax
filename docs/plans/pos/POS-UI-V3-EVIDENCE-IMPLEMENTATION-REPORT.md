# POS-UI-V3-EVIDENCE — Implementation Report

STATUS: READY FOR REVIEW
DATE: 2026-10-02

## Outcome

Bounded evidence map of the current POS UI onto the approved AWJ POS UI V3 Horizon. No production code. No Decision Gate.

Deliverable: `docs/plans/pos/POS-UI-V3-EVIDENCE.md`.

## Repository evidence / root cause

Execution Base SHA `72a9c4e239cdca0dd90483878307eb328bdd70f4` (`docs(pos): AWJ POS UI V3 Horizon plan (#1165)`).

Confirmed on that Base:

- `docs/plans/design/AWJ_POS_UI_V3_VISUAL_DIRECTION.md`
- `docs/plans/pos/AWJ_POS_UI_V3_HORIZON.md`
- `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`

Current sale shell is `web/src/app/(pos)/pos/page.tsx` with layout tokens in `web/src/lib/pos-responsive.ts`: three-column cart | products | category rail from `lg`, search inside the products panel, mobile single-workspace tabs plus a cart FAB. Floor posture and tokens already exist. Checkout, tender, scanner, focus, and interaction-mode modules are separate and must be reused.

## Approach chosen

Documentation-only slice. Record preserve / restyle / recompose, presentation-only state, tests, and per-slice files so later slices do not rediscover the POS.

## Why this approach fits AWJ

The Horizon forbids a broad re-investigation and forbids business-contract changes. The map keeps financial and security modules untouched and limits each later PR to presentation files.

## Changed files

- `docs/plans/pos/POS-UI-V3-EVIDENCE.md` (new)
- `docs/plans/pos/POS-UI-V3-EVIDENCE-IMPLEMENTATION-REPORT.md` (new)

## Tests and exact results

Not run locally. This slice does not change executable code. Root PHP CI is expected because `ci.yml` has no path filter. Web CI is not expected (no `web/**` change).

## Build / lint / typecheck

Not run. No `web/**` or PHP source changes.

## CI

Recorded on the PR against the exact final Head before merge. This section is not a substitute for the PR check list.

## Pre-merge review

- PRE_MERGE_REVIEW: PENDING until the exact final Head is reviewed
- Reviewed Head SHA: the tip of `pos-ui-v3-evidence` after this report correction (authoritative SHA is the one cited by `PRE_MERGE_REVIEW` on the PR)
- Findings / resolution: none in the evidence diff; formal pass is recorded on the PR at that tip

## Merge

- Merge status: not merged
- Merge SHA: —

## Post-merge review

- POST_MERGE_REVIEW: PENDING
- Reviewed Merge SHA: —
- Target-branch checks/smoke: —
- Findings / resolution: —

## Self-review

### Implementer

Evidence cites the files and class strings read on the Base. No production code edits. Git state below names the evidence-content commit instead of "pending commit".

### Reviewer

Scope is two markdown files. No production path, no invariant change.

### AWJ Guardian

- Accounting impact: none.
- Tenant / branch isolation impact: none.
- Security / authorization impact: none.
- Backward compatibility: no runtime change.
- API / DB / migration impact: none.

## Accounting impact

None. No journal entries.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

No runtime change.

## API / DB / migration impact

None.

## External research used

None. Repository documents and current POS presentation files only.

## Risks / remaining work

Later slices must update tests that pin V2 grid class strings. Search relocation must keep the focus-manager registration. Density mode must not override server `show_product_images` semantics silently — it is an additional presentation preference.

## Discovered backlog

None that blocks this Horizon. Portrait sticky transaction bar is intentionally deferred to POS-UI-V3-5.

## Git state

- Branch: `pos-ui-v3-evidence`
- PR: opened against `main` after this correction
- Base SHA: `72a9c4e239cdca0dd90483878307eb328bdd70f4`
- Evidence content SHA: `05b288ec8cea2e80ae352659d6001f15e0de9f63`
- Head SHA: tip of `pos-ui-v3-evidence` after this correction commit. That tip, not `05b288ec`, is the review authority (`PRE_MERGE_REVIEW` records it verbatim).

## Recommended next dependency-ready task

POS-UI-V3-1 — Floor shell + topbar + responsive 65/35 foundation, after this slice is merged and POST_MERGE_REVIEW passes.
