# STORE-TRUST-COMPOSE-1 — Implementation Report

STATUS: Implemented on a local branch stacked on APPS-1. Not opened until APPS-1 is on main.
DATE: 2026-09-26

## Outcome

The existing footer, the Web preview, and the dev-mirror preview keep one footer. Business identity, the merchant license, SBC, communication (contact, WhatsApp, social), and applications are separate groups. Policies stay a navigation column and no longer hold store badges. The account column no longer holds WhatsApp.

## Repository evidence / root cause

After BIZ, WA, SOCIAL, and APPS, those facts still shared one lower band, and the app badges sat inside the policies list. The horizon asks for distinct groups without a second footer.

## Approach chosen

A two-column grid from the `sm` breakpoint, one column on narrow screens. Each group is its own `section` with a heading. Badges stay `h-10` with `gap-3`. Identity text uses `break-words` and `min-w-0`.

## Why this approach fits AWJ

No new footer component, no payment marks, and no mixing of CR/VAT with SBC or social brands.

## Changed files

- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/Footer.test.tsx`
- `storefront/messages/{ar,de,en,es,fr,pl}.json`
- `storefront/src/components/customizer/messages.ts`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/messages.ts`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
- this report

## Tests and exact results

- storefront vitest Footer + customizer ExperienceBuilder: 19 passed
- locale parity against `en.json`: ar, de, es, fr, pl OK
- biome check on the touched storefront TS files: clean after format
- web vitest ExperienceBuilder: 14 passed

## Build / lint / typecheck

Not a production build.

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

A blank group is omitted. WhatsApp is only in the communication group. App badges are only in the applications group.

### Reviewer

Published external links still use `target="_blank"` and `rel="noopener noreferrer"`. Preview still calls `preventDefault`.

### AWJ Guardian

SBC copy is unchanged. The group title names the platform. It does not add a pending or unverified state. No storage or payment change.

## Accounting impact

None.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None beyond the existing external-link attributes.

## Backward compatibility

No API change. Footer headings are new message keys.

## API / DB / migration impact

None.

## External research used

None.

## Risks / remaining work

Screenshot proof at the six widths is STORE-TRUST-QA-1. This branch must be rebased onto main after APPS-1 merges.

## Discovered backlog

None.

## Git state

- Branch: `feat/store-trust-compose-1`
- PR: not opened
- Stacked on the rebased APPS-1 tip until that task merges
- Head SHA: the commit that adds this report

## Recommended next dependency-ready task

STORE-TRUST-QA-1 after this merges and post-merge review passes.
