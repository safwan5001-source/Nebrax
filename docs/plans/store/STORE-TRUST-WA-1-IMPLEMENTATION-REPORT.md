# STORE-TRUST-WA-1 — Implementation Report

STATUS: Implementation ready for review.
DATE: 2026-09-26

## Outcome

Published WhatsApp links open in a new tab. The maintained dev-mirror preview does not navigate. The control stays the existing Lucide `MessageCircle` with its accessible name. No official WhatsApp glyph was added.

## Repository evidence / root cause

Evidence permits `wa.me` and the existing placements. It does not permit the official glyph for this horizon. The published footer and floating control lacked `target="_blank"`. The dev mirror footer and floating control did not call `preventDefault`. The Web preview already did.

## Approach chosen

Add `target="_blank"` beside the existing `rel="noopener noreferrer"` on the published links. Call `preventDefault` on the mirror preview controls. Do not change phone normalization, placements, or the icon.

## Why this approach fits AWJ

The brand-center condition for the official glyph was not met, and no official file was obtained. A Lucide icon plus an accessible name is the allowed control.

## Changed files

- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/Footer.test.tsx`
- `storefront/src/components/layout/StoreWhatsApp.tsx`
- `storefront/src/components/layout/StoreWhatsApp.test.tsx`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `storefront/src/components/customizer/__tests__/ExperienceBuilder.test.tsx`
- this report

## Tests and exact results

Before rebase, the same tests passed on the stacked commit. After rebase onto `a4d6cfe0`, storefront vitest passed 18 tests (`Footer.test.tsx`, `StoreWhatsApp.test.tsx`, customizer `ExperienceBuilder.test.tsx`) and Biome check on those files was clean.

## Build / lint / typecheck

Not a production build. See CI on the PR head.

## CI

Recorded on the PR for the exact head.

## Pre-merge review

- PRE_MERGE_REVIEW: pending the PR comment for the exact head
- Reviewed Head SHA:
- Findings / resolution:

## Merge

- Merge status: not merged
- Merge SHA:

## Post-merge review

- POST_MERGE_REVIEW: pending
- Reviewed Merge SHA:
- Target-branch checks/smoke:
- Findings / resolution:

## Self-review

### Implementer

Invalid phones still hide the control. Preview links do not use `target="_blank"`.

### Reviewer

No new host, no message send, no official artwork file.

### AWJ Guardian

WhatsApp stays a presentation link. It does not become a support-identity or verification claim.

## Accounting impact

None.

## Tenant / branch isolation impact

None.

## Security / authorization impact

Published external links keep `noopener noreferrer` and now leave the storefront tab explicitly.

## Backward compatibility

Placements `floating` / `footer` / `both` are unchanged.

## API / DB / migration impact

None.

## External research used

The evidence pass already recorded why the official glyph is not adopted. This task did not fetch a new asset.

## Risks / remaining work

Footer grouping is COMPOSE-1. Visual widths are QA-1. BIZ-1 post-merge CI must be green before this is merged, because the branch is based on that squash.

## Discovered backlog

None.

## Git state

- Branch: `feat/store-trust-wa-1`
- PR:
- Base SHA: `a4d6cfe0e7d76310aa2ab6de51ddd08027fcec7a`
- Head SHA: the commit that adds this report, after rebase commit `2bfc8e0e`

## Recommended next dependency-ready task

STORE-TRUST-SOCIAL-1 after this merges, then APPS-1. SBC-1 is the open docs PR #1051.
