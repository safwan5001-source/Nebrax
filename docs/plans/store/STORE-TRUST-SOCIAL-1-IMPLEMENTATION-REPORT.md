# STORE-TRUST-SOCIAL-1 — Implementation Report

STATUS: Rebased onto the unmerged WA-1 head. Not opened until WA-1 is on main.
DATE: 2026-09-26

## Outcome

The seven supported networks keep https-only links. Published links show a readable name, use that name as `aria-label`, and open in a new tab. Preview does not navigate. No official icon file was added.

## Repository evidence / root cause

Evidence lists Instagram, X, TikTok, Snapchat, YouTube, LinkedIn, and Facebook. Official icon files were not obtained. The published footer printed the raw network key and had no `target="_blank"`.

## Approach chosen

Localized names in the storefront footer messages. Arabic uses the established Arabic names. Other locales use the English official names rather than redrawn marks. The same names are used in both preview canvases. Preview calls `preventDefault`.

## Why this approach fits AWJ

No new network, no new host allow-list, and no unofficial icon pack.

## Changed files

- `storefront/messages/{ar,de,en,es,fr,pl}.json`
- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/Footer.test.tsx`
- `storefront/src/components/customizer/messages.ts`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/messages.ts`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
- this report

## Tests and exact results

After rebase onto WA-1 head `4ca57abc`:

- storefront vitest: Footer + customizer ExperienceBuilder, 18 passed
- storefront biome on the touched TS files: clean
- web vitest ExperienceBuilder: 14 passed

## Build / lint / typecheck

Not a production build. Locale JSON keys were added in every storefront locale file so the parity check stays aligned.

## CI

Not opened yet.

## Pre-merge review

- PRE_MERGE_REVIEW: not recorded
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

Empty and non-https URLs still drop the link. The test mock returns the message key, so the footer test expects `socialInstagram`.

### Reviewer

No eighth network. No icon binary. Published links keep `noopener noreferrer`.

### AWJ Guardian

Social links are presentation only. They are not a verification or identity source.

## Accounting impact

None.

## Tenant / branch isolation impact

None.

## Security / authorization impact

External links open in a new tab with the existing rel. Invalid URLs stay omitted.

## Backward compatibility

Stored network ids are unchanged.

## API / DB / migration impact

None.

## External research used

Names follow the evidence pass. No new brand asset was fetched.

## Risks / remaining work

This branch still contains the WA-1 commits until WA-1 squash-merges and this branch is rebased onto that main. Grouping is COMPOSE-1.

## Discovered backlog

None.

## Git state

- Branch: `feat/store-trust-social-1`
- PR: not opened
- Stacked on WA-1 head `4ca57abc` until that PR merges
- Head SHA: the commit that adds this report

## Recommended next dependency-ready task

STORE-TRUST-APPS-1 after this and WA-1 are merged and post-merge reviewed.
