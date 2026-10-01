# CUST-H3-ARCH-1 — Architecture Report

## Status

**CUST-H3 ARCHITECTURE READY FOR OWNER REVIEW.**

No implementation, merge, deploy or Production release is authorized by this report.

## Baseline

- Repository: `safwan5001-source/Nebrax`
- Baseline main: `956d9865cd12622cb9fd5190fed5284b8f053e70`
- CUST-H2: formally CLOSED

## Repository evidence inspected

- `web/src/modules/store-experience-builder/presentation/tokens.ts`
- `web/src/modules/store-experience-builder/presentation/config.ts`
- storefront twin presentation config/tokens
- `storefront/src/app/globals.css`
- `storefront/src/lib/presentation/public.ts`
- Customizer `ControlPanels.tsx`
- `StorefrontPreviewCanvas.tsx`
- PHP `StorefrontPresentationNormalizer`
- branding-media owner decision
- storefront design system / design-first capability policy
- prior visual-completion evidence

## Key findings

1. AWJ already owns the required global presentation persistence; H3 must not create another settings model.
2. Display name, branding media, primary color, radius and header style have existing real contracts.
3. `accentColor` persists but currently has no proven public semantic consumer.
4. `fontPreset` currently contains one preset, so there is no meaningful font choice yet.
5. `density` and `productCard` are persisted but their public runtime parity is not closed.
6. H3 is therefore primarily a **UX consolidation + runtime parity Horizon**, not a backend/storage Horizon.
7. Custom font upload remains gated.

## External evidence used

First-party sources only:

- Shopify Theme Settings / Theme Editor:
  - https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/theme-settings
  - https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor
- Salla Twilight:
  - https://docs.salla.dev/421945m0
  - https://docs.salla.dev/421921m0
  - https://docs.salla.dev/421879m0

External evidence supports the global-vs-contextual settings split, semantic shared theme variables, and merchant-facing customization. AWJ's exact contract remains constrained by its own Version lifecycle and runtime.

## Decisions

- Reuse CUST-H1 Version lifecycle.
- Keep identity global across Home/Product/Category.
- No DB migration in ARCH-1.
- No second API.
- No automatic schema bump.
- Hide/gate any merchant control that is a persisted visual no-op until parity is real.
- Curated fonts before uploaded fonts.
- Uploaded fonts require a separate storage/security/licensing architecture.
- Preserve existing branding-media decision.

## Proposed slices

1. H3-1 Identity Studio shell + branding consolidation.
2. H3-2 Color + typography truth.
3. H3-3 Global component appearance parity.
4. H3-4 Cross-page/global parity + integrated QA.
5. Horizon Closure.

## Next step

After owner review/merge of this architecture PR:

**CUST-H3-1 — Identity Studio shell + consolidation**, starting from latest `origin/main`, with no schema/API/DB changes.
