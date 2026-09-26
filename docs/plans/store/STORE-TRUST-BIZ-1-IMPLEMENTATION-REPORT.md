# STORE-TRUST-BIZ-1 — Implementation Report

STATUS: Implementation ready for review.
DATE: 2026-09-26

## Outcome

Public legal name, CR, and VAT stay on the resolved Tenant. The merchant cannot edit a second CR in the Web Customizer or the maintained dev mirror. A blank canonical value stays blank. The existing merchant license renders in its own footer group, separate from Business Identity and from SBC.

## Repository evidence / root cause

The Web Customizer already rendered canonical CR and hid `verification.crNumber`. It did not show read-only legal name or VAT in the verification panel. The published footer omitted `verification.licenseNumber` while the Web preview showed it. The storefront `/dev` mirror still offered an editable CR and a "request verified" toggle that the normalizer forces off.

## Approach chosen

Read-only identity rows from the company object already passed into the Web builder. Published footer gains only the license line. The dev mirror drops the second CR editor and the badge-request toggle, and previews canonical identity when it is provided.

## Why this approach fits AWJ

No new identity column, no Customizer authority over Tenant fields, and no rendering of the legacy CR. The license field already existed.

## Changed files

- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/Footer.test.tsx`
- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx`
- `storefront/src/components/customizer/ControlPanels.tsx`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `storefront/src/components/customizer/ExperienceBuilder.tsx`
- `storefront/src/components/customizer/messages.ts`
- `storefront/src/components/customizer/__tests__/ExperienceBuilder.test.tsx`
- `web/src/modules/store-experience-builder/ControlPanels.tsx`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.test.tsx`
- this report

## Tests and exact results

Storefront vitest, 22 passed:

- `Footer.test.tsx`
- `layout.test.tsx`
- customizer `ExperienceBuilder.test.tsx`
- customizer `architecture.test.ts`

Web vitest, 24 passed:

- `ExperienceBuilder.test.tsx`
- `presentation.test.ts`

Biome check on the changed storefront files: clean.

## Build / lint / typecheck

Not a full production build. Biome on the storefront diff is clean. Web tests passed under the repo vitest config.

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

Absence hides the public identity lines and the license group. The legacy CR remains in JSON and is not painted.

### Reviewer

No schema, no public field removal, no SBC loader change.

### AWJ Guardian

Identity still comes from the company/tenant object already resolved for the merchant, and from `business_identity` on the public config. The dev mirror cannot mint a verified badge.

## Accounting impact

None.

## Tenant / branch isolation impact

None. No new query.

## Security / authorization impact

None. `commerce.manage` routes are unchanged. Public payload shape is unchanged.

## Backward compatibility

`verification.crNumber` is still stored and still returned. It is not displayed as the CR.

## API / DB / migration impact

None.

## External research used

None. This task does not add a trademark.

## Risks / remaining work

Footer grouping of social, SBC, and apps is STORE-TRUST-COMPOSE-1. Screenshots are STORE-TRUST-QA-1.

## Discovered backlog

None.

## Git state

- Branch: `feat/store-trust-biz-1`
- PR:
- Base SHA: `fa237e392bd4a5bfd1ffc19e3800aaa81e6e53bc`
- Head SHA:

## Recommended next dependency-ready task

STORE-TRUST-SBC-1, WA-1, SOCIAL-1, and APPS-1 stay ready. COMPOSE waits for all of them plus this task.
