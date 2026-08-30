# AWJ Rebrand Audit

## Decision

The customer-facing product brand is migrating from **نبراكس / Nebrax** and legacy **نبراس / Nibras** references to **أَوْج / AWJ**.

This is a controlled product-brand migration, not a blanket technical rename.

## Canonical names

- Arabic UI: `أَوْج`
- English UI: `AWJ`
- Combined metadata/docs: `أَوْج | AWJ`

## Search variants

Every migration pass must inspect all of these variants:

- `نبراكس`
- `Nebrax`, `NEBRAX`, `nebrax`
- `نبراس`
- `Nibras`, `NIBRAS`, `nibras`

## Rename customer-facing references

- Product name and metadata.
- Shared product wordmark/logo component.
- Authentication shell and public landing page.
- Arabic and English translations.
- User-facing emails, templates, reports and PDFs where the old name is confirmed as product branding.
- Current product documentation and design-system wording.

## Preserve technical compatibility unless separately approved

Do not blindly rename:

- GitHub repository name or repository URLs.
- Production/deployment hostnames such as legacy `nebrax` / `nibras` URLs.
- Database names, tables, migrations or namespaces.
- Environment variable names or API contracts.
- Historical records whose value is evidence/history rather than current product branding.

Every retained old-brand occurrence must be classified as an intentional legacy/technical reference.

## Confirmed touchpoints

- `web/src/lib/brand.ts` is the canonical runtime brand-name source.
- `web/src/app/layout.tsx` reads metadata from the central brand source.
- `web/src/components/layout/awj-logo.tsx` is the shared AWJ product wordmark.
- Authentication and landing surfaces consume the AWJ component.
- Company branding remains separate (`CompanyLogoMark`) and must not be overwritten by the product brand.
- `web/src/lib/brand-migration-guard.test.ts` guards migrated customer-facing surfaces against reintroducing legacy display names.
- `web/scripts/awj-brand-value-migration.mjs` performs value-only translation migration while preserving JSON keys and whitelisted technical/historical identifiers.

## Current verified status

- Canonical runtime identity: complete.
- Metadata, landing page and authentication shell: complete.
- README and design-system visible identity: complete.
- Compatibility shim for legacy `NebraxLogo` imports: intentionally preserved.
- Legacy Nebrax image assets under `web/public/brand` have been removed so migrated surfaces cannot accidentally reuse them.
- `web/src/messages/ar.json` and `web/src/messages/en.json`: customer-facing values migrated to `أَوْج` / `AWJ` by the guarded migration workflow; translation keys and whitelisted technical identifiers were preserved.
- The pre-translation migration head passed Web CI and backend CI, including SQLite and PostgreSQL. The bot-generated translation commit requires GitHub Actions approval (`action_required`) before its own CI can execute; this is not a test failure.
- `CLAUDE.md`: full safe source was restored after the intermediate truncation incident. Historical reference-company name `نبراس الطموح` must remain unchanged; any remaining current-product wording is subject to the same controlled migration rules.
- Repository search after translation migration returned no indexed direct matches for `Nebrax` or `نبراكس`; repository search is treated as supporting evidence rather than the sole audit gate.

## Design-system constraints

- Preserve existing design tokens; no unrelated redesign in this migration.
- Product identity uses token-controlled `text-primary` / `--primary`, never hard-coded component colors.
- Preserve RTL/LTR behavior and light/dark modes.
- Keep IBM Plex Sans Arabic for product wordmark fallback and UI typography.
- Do not introduce gradients, decorative shadows, or unrelated visual effects.

## Final logo assets

When approved production artwork is available, add genuine transparent assets for:

- Arabic `أَوْج` wordmark.
- English `AWJ` wordmark or approved bilingual lockup.
- Symbol-only mark.
- Favicon/app icon.

Do not ship checkerboard pixels as transparency. Until final artwork is committed, the shared AWJ component uses the canonical text wordmark and design tokens so no legacy Nebrax artwork is shown on migrated surfaces.

## Validation gates

Before merge:

1. Audit customer-facing code and content for all eight legacy variants above.
2. Verify intentional technical legacy references against the whitelist.
3. Run frontend build and relevant unit/i18n tests on the final head.
4. Verify Arabic/English, RTL/LTR, light/dark, landing and auth surfaces.
5. Review the independent PR and its final CI state.
6. Do not merge or deploy without explicit approval.
