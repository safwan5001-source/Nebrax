# STORE-TRUST-APPS-1 — Implementation Report

STATUS: Implementation ready for review. Not opened as a PR until BIZ-1 is on main and this branch is rebased.
DATE: 2026-09-26

## Outcome

App Store links are accepted only for `apps.apple.com`. Google Play stays on `play.google.com` and `play.app.goo.gl`. Published footer and App Promo, plus both preview canvases, show the live first-party badges only beside an allow-listed URL. None, one, or both. Arabic uses the Arabic publisher badge. Every other locale uses the official English badge. No badge file is committed.

## Repository evidence / root cause

`isSafeAppStoreUrl` accepted any `*.apple.com` host. Published App Promo and the footer rendered text buttons, and the previews used `sanitizeExternalUrl` without the store-host check. Evidence already permits the unmodified Apple and Play badges from the live publisher URLs.

## Approach chosen

Tighten the three host twins. Add `appStoreBadgeUrl` / `playStoreBadgeUrl`. Render `<img height 40px>` from those URLs inside a link that re-checks the host. Published links use `target="_blank"` and `rel="noopener noreferrer"`. Preview links call `preventDefault` and do not set `target`.

## Why this approach fits AWJ

The allow-list name does not change. The defect is a narrower host inside that allow-list. Badges stay first-party and unmodified. No new store, no binary, no inline SVG.

## Changed files

- `app/Support/Commerce/StorefrontPresentationNormalizer.php`
- `tests/Feature/StorefrontPresentationNormalizerTest.php`
- `storefront/src/lib/presentation/urls.ts`
- `storefront/src/lib/presentation/__tests__/urls.test.ts`
- `storefront/src/lib/presentation/__tests__/config.test.ts`
- `storefront/src/components/store/OfficialStoreBadge.tsx`
- `storefront/src/components/home/AppPromoBand.tsx`
- `storefront/src/components/home/AppPromoBand.test.tsx`
- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/Footer.test.tsx`
- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx`
- `storefront/src/app/[country]/[locale]/(storefront)/page.tsx`
- `storefront/src/app/dev/customizer-visual/page.tsx`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/presentation/urls.ts`
- `web/src/modules/store-experience-builder/OfficialStoreBadge.tsx`
- `web/src/modules/store-experience-builder/OfficialStoreBadge.test.tsx` under `__tests__`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
- this report

## Tests and exact results

Storefront vitest, observed passing:

- `urls.test.ts`, `config.test.ts`, `AppPromoBand.test.tsx`, `Footer.test.tsx`, customizer `ExperienceBuilder.test.tsx`, `StoreWhatsApp.test.tsx`: 39 passed, then the badge subset 17 passed after the footer host filter.
- `tsc --noEmit` in `storefront`: exit 0.

Web vitest:

- `OfficialStoreBadge.test.tsx`: 1 passed.
- `ExperienceBuilder.test.tsx`: 14 passed.

PHP feature test was edited and not executed here. There is no local PHP runtime.

## Build / lint / typecheck

Biome check on the changed storefront files: clean. The `<img>` warning is suppressed because `next/image` would proxy the publisher badge.

Web eslint on the badge, preview canvas, urls, and the new test: exit 0.

## CI

Not opened. This commit is stacked on SOCIAL-1 until BIZ-1 merges.

## Pre-merge review

- PRE_MERGE_REVIEW: not recorded. No PR yet.
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

Empty and unsafe URLs render no badge. A rejected `www.apple.com` link does not leave an empty footer item. Both badges use `h-10` (40px).

### Reviewer

Host check is exact equality after https sanitize, in PHP, storefront, and web. Preview does not navigate and does not use `target="_blank"`.

### AWJ Guardian

No claim that an app exists without a configured allow-listed URL. No redrawn mark, no committed artwork, no new external brand.

## Accounting impact

None.

## Tenant / branch isolation impact

None.

## Security / authorization impact

The App Store host check is narrower. Play hosts are unchanged. External links that remain published open in a new tab with `noopener noreferrer`.

## Backward compatibility

A previously stored `https://www.apple.com/...` iosUrl normalizes to `""`. `apps.apple.com` is unchanged. Play hosts are unchanged.

## API / DB / migration impact

None. Normalization still writes `apps.iosUrl` / `apps.androidUrl` as strings.

## External research used

Badge URLs recorded in `AWJ_STORE_TRUST_BUSINESS_IDENTITY_EVIDENCE.md` §3, confirmed live on 2026-09-26. Apple marketing guidelines and Play badge guidelines are cited there. This task does not add a source.

## Risks / remaining work

Footer still places the badges inside the policies column. STORE-TRUST-COMPOSE-1 groups applications separately. Visual widths are STORE-TRUST-QA-1. PHPUnit was not run locally.

## Discovered backlog

None.

## Git state

- Branch: `feat/store-trust-apps-1`
- PR: not opened. Rebase onto main after BIZ-1 before opening.
- Base at authoring time: `0922efd1` (SOCIAL-1, itself stacked on WA-1 and BIZ-1)
- Head SHA: filled after the commit

## Recommended next dependency-ready task

STORE-TRUST-COMPOSE-1 after BIZ-1, SBC-1, WA-1, SOCIAL-1, and this task are merged and post-merge reviewed.
