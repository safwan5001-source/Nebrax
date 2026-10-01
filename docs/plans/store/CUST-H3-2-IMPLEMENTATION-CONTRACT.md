# CUST-H3-2 — Implementation Contract: Color + Typography Truth

**Status:** Proposed implementation contract · owner review required  
**Baseline:** `2981743de0bea007ca1f3941bc0f2cbf9840b23d`

## 1. Required implementation

### Color

- Preserve the existing `primaryColor` control and semantic derivation.
- Verify Canvas and public parity with focused tests.
- Do not activate `accentColor`.
- If an accent control is currently rendered anywhere merchant-facing in the Store Customizer, hide/gate it without deleting persisted data.

### Typography

Attempt the curated V1 preset:

- existing: `cairo-geist`
- candidate: `tajawal-geist`

Before changing the enum, verify that the storefront's current Next.js/font stack can load Tajawal with the required Arabic weights and build successfully.

If verified:

1. extend the closed font preset allow-list consistently across:
   - PHP normalizer;
   - web presentation mirror;
   - storefront presentation mirror;
2. load Tajawal through the same first-party `next/font` strategy used by the storefront;
3. expose the font selector in the Store Customizer;
4. resolve font family from `config.fontPreset` in Canvas;
5. resolve font family from Published presentation in the public storefront;
6. preserve `cairo-geist` as the default/fail-closed fallback.

If Tajawal cannot be verified, STOP the font expansion and report the exact blocker; do not invent another font in the same slice.

## 2. Schema rule

Adding a new allowed enum value to the existing `fontPreset` field is permitted by this contract.

Do not:

- add a new persisted field;
- bump presentation schema version solely for the new enum value;
- create headingFont/bodyFont fields.

Forward safety remains fail-closed for readers that do not know a newer enum.

Implementation must examine compatibility implications before merge and document them explicitly.

## 3. Files likely involved

Expected, not mandatory:

- `app/Support/Commerce/StorefrontPresentationNormalizer.php`
- `web/src/modules/store-experience-builder/presentation/tokens.ts`
- `web/src/modules/store-experience-builder/presentation/config.ts`
- `web/src/modules/store-experience-builder/ControlPanels.tsx`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/messages.ts`
- `storefront/src/lib/presentation/tokens.ts`
- `storefront/src/lib/presentation/config.ts`
- `storefront/src/lib/presentation/public.ts`
- `storefront/src/components/layout/DocumentShell.tsx`
- related focused tests

Do not touch unrelated App Builder code.

## 4. Test requirements

Focused first:

- PHP normalizer accepts both known presets and rejects unknown values to default;
- web/storefront normalizer parity;
- existing `cairo-geist` behavior unchanged;
- font selection modifies Canvas immediately;
- Home/Product/Category keep one global preset;
- Published Snapshot drives public runtime;
- Draft does not leak publicly;
- Arabic RTL and English LTR;
- 390px mobile no clipping/overflow;
- primary color contrast behavior remains green.

Then:

- relevant web/storefront Vitest;
- Laravel presentation tests;
- typecheck;
- web/storefront build as affected;
- CI.

## 5. Stop conditions

STOP and report before widening scope if implementation requires:

- DB migration;
- new API;
- new persisted typography fields;
- arbitrary font upload/storage;
- external runtime font CDN;
- page-specific identity state;
- weakening backward compatibility.

## 6. Merge/deploy

No Merge, Deploy or Production release without owner approval.
