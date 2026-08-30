# AWJ / أَوْج — Rebrand Audit Baseline

## Decision

The customer-facing product brand is migrating from **نبراكس / Nebrax** to **أَوْج / AWJ**.

This is a controlled brand migration. It is **not** a blanket rename of technical identifiers.

## Phase 1 scope

### Rename / replace
- Customer-facing product name and accessible brand labels.
- Web metadata and page titles.
- Shared logo component and its consumer imports.
- Authentication shell branding.
- Landing-page branding.
- Arabic and English translation strings that visibly refer to the old brand.
- Brand assets used by the web application.
- User-facing document/report/email branding where confirmed by audit.
- Product-facing documentation.

### Preserve unless separately approved
- GitHub repository name and repository URLs.
- Production/staging domains and deployment project identifiers.
- Database names, table/column names, migrations and historical identifiers.
- Environment variable names and API contracts when changing them would create compatibility risk.
- Historical migration/audit records where rewriting history is inappropriate.

## Confirmed current touchpoints on `main`

1. `web/src/app/layout.tsx`: metadata title is currently `نبراكس`.
2. `web/src/components/layout/nebrax-logo.tsx`: shared localized logo component is named `NebraxLogo`; it uses `/brand/nebrax-logo.png` for Arabic and `/brand/nebrax-logo-en.png` for English, with the design-system `--primary` token.
3. `web/src/app/page.tsx`: landing page imports and renders `NebraxLogo`.
4. `web/src/components/auth/auth-shell.tsx`: authentication shell imports and renders `NebraxLogo`.
5. `web/public/brand/`: four Nebrax logo assets are present.
6. `web/src/messages/ar.json` and `web/src/messages/en.json`: central translation catalogs require a brand-string audit before replacement.

## Design-system constraints

- Keep brand color controlled by the existing design token; do not hard-code a new blue inside components.
- Preserve RTL/LTR behavior and Arabic/English localization.
- Preserve light/dark compatibility.
- Prefer a single shared AWJ logo component rather than screen-specific logo implementations.
- Keep the accounting UI dense, clear and operational; the rebrand must not trigger unrelated UI redesign.

## Asset requirement

The supplied AWJ artwork is the visual reference, but production assets must have genuine transparency and suitable crops/aspect ratios. Required web variants should include at minimum Arabic AWJ, English AWJ or an approved bilingual equivalent, symbol-only, and favicon/app-icon assets. The app must not ship a checkerboard baked into the image background.

## Validation gates

Before merge: audit old-brand occurrences and classify retained technical references; run frontend checks/build; smoke-check RTL/LTR and light/dark; check landing, auth, application shell and POS; check invoice/document/PDF/email branding where applicable; require green CI.

## Safety boundary

This branch/PR must stop before merge and production deployment until explicit approval is given.
