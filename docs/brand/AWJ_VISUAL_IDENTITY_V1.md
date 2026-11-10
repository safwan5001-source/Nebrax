# AWJ visual identity v1 — implementation

- Base: `7570b9bf379483ed5b787ece52d1f98927c6a8e1` (`main`).
- Branch: `codex/awj-visual-identity-v1`.
- Approved source: owner's `AWJ-complete-identity-v1.zip`, created 2026-11-10.
- Review status: implementation prepared for PR review; no merge or deployment authorized.

## Result

The shared `AwjLogo` now renders the approved geometric Arabic identity as inline SVG outlines instead of a locale-dependent text wordmark. Arabic and English surfaces use the same artwork; accessible names remain controlled by the caller's `alt` prop. The legacy `NebraxLogo` export continues to resolve to the shared component.

| Surface | Artwork / behavior |
| --- | --- |
| Landing and customer/platform authentication | Shared Arabic wordmark; existing height utilities continue to work |
| Company shell fallback, medium | Arabic wordmark |
| Company shell fallback, small | Narrow alif/hamza mark, for constrained mobile/collapsed headers |
| Large explicit placements | `variant="full"` adds the outlined AWJ lettering below the Arabic wordmark |
| Browser fallback | New multi-resolution `web/src/app/icon.ico` (16/32/48/64) |
| Fuel Stations installed app | New static 192/512 PNG, maskable 512 PNG, and 180 Apple touch icon |
| Reusable vector masters | Six blue/white SVG assets in `web/public/brand/awj/` |

The SVG uses `currentColor` and the existing `text-primary` token, with the semantic `text-text` ink in dark mode. Existing landing/auth navy-surface CSS can still override the ink. No theme tokens or stylesheets changed. Brand paths are font-independent and are never mirrored for RTL.

## Company identity and compatibility

Uploaded company logos retain precedence. The existing failure fallback and retry-on-logo-change behavior remain intact. Root metadata, company browser identity client component, server icon endpoint, company-logo URL checks, and tenant-origin resolution were not changed. The new favicon is only the existing default fallback.

The Fuel Stations manifest's ID, scope, start URL, names, colors, icon URLs and icon purposes remain unchanged. This updates the artwork without changing the installed application's identity. Already-installed OS icons may require OS/browser refresh or reinstall to pick up artwork at the same URL.

No changes to customer storefront branding, payment-brand marks, lucide-react functional icons, accounting, authorization, APIs, database schema, or tenant data. Brand collateral and social templates are not bundled into the application.

## Files

- `web/src/components/layout/awj-logo.tsx`
- `web/src/components/layout/company-logo-mark.tsx`
- `web/src/components/layout/awj-logo.test.tsx`
- `web/src/app/icon.ico`
- Four `web/public/fuel-ops-pwa/*.png` icon assets
- Six `web/public/brand/awj/*.svg` master assets
- This implementation report

## Validation

Completed locally:

- `git diff --check` passes.
- PNG signatures/dimensions verified against the real manifest; 192/512/512 maskable/180 Apple dimensions match.
- PWA image backgrounds are fully opaque; favicon contains 16/32/48/64 resolutions.
- Six SVG masters parse as XML and contain vector paths with no embedded raster images.
- Identity-sensitive metadata/route/client source and the PWA manifest are unchanged.
- Visual review of the blue/white assets and compact icon at small sizes.

Added six focused Vitest cases for accessible/decorative inline rendering, sizing compatibility, RTL/LTR artwork stability, compact/full variants, company-logo precedence, and error fallback followed by retry when the logo changes.

Local Vitest command was attempted but could not start: `vitest: not found`. This environment has a focused snapshot obtained through GitHub's connector, not a full authenticated clone with installed dependencies. No local test/build pass is claimed. The repository's normal Web CI must validate the complete checkout, including the existing brand, favicon, company browser identity, PWA tests, full TypeScript checks and Next.js build. GitHub Head SHA and CI outcomes are recorded on the PR.

## Next step

Review Web CI and the visual result on mobile/desktop, then obtain owner approval before merge and deployment. Verify the actual authenticated tenant logo and icon still override the AWJ fallback after deployment.

## CI follow-up: semantic palette regression

Web CI run 42876776560 reported one token-ratchet regression in `awj-logo.tsx`: palette classes 0 → 1. The introduced `dark:text-white` bypassed semantic tokens. Replaced it with `dark:text-text`; the actual repository scanner reproduced palette=1 before the fix and reports palette=0, hex=0 afterward for this component. No baseline, guard, theme token, SVG outline or company identity logic was changed. Full Web CI must confirm the updated head.
