# AWJ Store — SBC V1 Presentation Contract

**Status:** Implementation-ready product and presentation contract
**Scope:** Saudi Business Center (منصة الأعمال) presentation inside the AWJ Storefront Footer.

## 1. Purpose

This document defines the smallest safe V1 contract for presenting a Saudi Business Center (SBC / منصة الأعمال) item in an AWJ Storefront. V1 is a **merchant-configured presentation feature**. It does not introduce a customer-facing verification-status workflow and does not establish an external verification integration.

The feature must use the existing Storefront, StorefrontPresentation, Customizer, public configuration API, and Footer paths. It must not become a Home Builder section or a block above the Footer.

## 2. Source-of-truth boundaries

- `Tenant.name` is the canonical legal/business entity name.
- `Tenant.cr_number` is the canonical Commercial Registration number.
- `Tenant.vat_number` is the canonical VAT number.
- `Storefront.name` is the public store/trading display name.
- SBC settings are Storefront presentation settings only. They must never replace, override, duplicate, or mutate Tenant legal identity.
- Legacy presentation fields such as `verification.crNumber`, `licenseNumber`, `sourceUrl`, and `requestedVerifiedLabel` remain legacy presentation data and must not be reinterpreted as SBC configuration.

## 3. SBC V1 contract

V1 contains exactly two conceptual settings:

| Setting | Merchant-facing label | Type | Behavior |
|---|---|---|---|
| `authentication_number` | رقم توثيق منصة الأعمال | String | Opaque merchant-entered value. Trim surrounding whitespace and preserve leading zeros. |
| `show_in_storefront` | إظهار توثيق منصة الأعمال في المتجر | Boolean | Explicit Footer presentation setting. Defaults to `false` for existing and new stores unless explicitly enabled. |

### 3.1 `authentication_number`

The value must be handled as an opaque string:

- trim only external whitespace;
- preserve leading zeros;
- never coerce it to an integer or numeric value;
- do not assume a length, format, or regular expression that is not documented by an authoritative source;
- keep it independent from CR, VAT, licenses, and ZATCA data;
- do not display it prominently to customers by default.

An entered authentication number is configuration data. It is not a second CR/VAT field and does not change Tenant identity.

### 3.2 `show_in_storefront`

`show_in_storefront` is a presentation setting scoped to the resolved Storefront:

- **OFF:** the SBC item is absent from the public Footer and Preview; no empty space, placeholder, or status message remains.
- **ON:** the SBC item appears inside the Footer itself and uses the approved SBC presentation.
- The item is not a standalone Home Builder section and must not render above or outside the Footer.

## 4. Verification authority and presentation semantics

The merchant, Customizer, and presentation JSON are not external verification authorities. V1 does not implement lookup, polling, scraping, or an authoritative SBC verification result.

For this product decision, enabling `show_in_storefront` authorizes the approved **presentation label**:

> **موثّق في منصة الأعمال**

This label is a Footer presentation choice defined by the AWJ product contract. It must not be expanded into a separate verification-status workflow or used to alter legal identity, tax, accounting, checkout, or ZATCA behavior.

V1 must not render any customer-facing state or copy containing:

- Pending;
- Unverified;
- Not verified;
- Waiting for verification;
- لم يتم التحقق من التوثيق بعد;
- equivalent status messaging.

The authentication number is not shown to customers by default. A future separately scoped evidence/integration contract may define an official lookup destination or authoritative result semantics.

## 5. Public Storefront behavior

The public Storefront must expose only the minimum presentation data needed by the existing Footer path and must not expose internal Tenant, Storefront, sales-channel, evidence, or integration identifiers.

The Footer information architecture is:

1. **Business Information**
   - canonical Commercial Registration from `Tenant.cr_number`;
   - canonical VAT number from `Tenant.vat_number`.
2. **SBC trust presentation**
   - rendered only when `show_in_storefront` is `true`;
   - rendered inside the Footer itself;
   - text: **موثّق في منصة الأعمال**;
   - official SBC asset only when the Official Asset Gate is satisfied.
3. Existing Footer groups such as communication, applications, policies, and payment-related content.

When `show_in_storefront` is `false`, the complete SBC item is omitted. No placeholder, empty row, pending state, or unverified state may be emitted.

The public Storefront must not display `authentication_number` by default. If a future UX explicitly displays it, that must be a separate documented decision and must not change its ownership or meaning.

## 6. Customizer and Preview boundary

The existing Store Customizer may provide exactly the V1 controls needed to:

1. enter `authentication_number`;
2. toggle `show_in_storefront`.

The Preview must use the same Footer presentation path and semantics as the public Storefront:

- OFF means the SBC item is not present;
- ON means the item is present inside the Footer;
- Preview must not create a Pending, Unverified, or “not verified” state;
- the toggle controls presentation visibility only and does not claim to perform external verification;
- the Customizer must not provide a merchant-controlled “I am verified” authority switch;
- legacy verification fields remain readable for compatibility but cannot activate or configure SBC V1.

## 7. Official Asset Gate

The official SBC / منصة الأعمال asset remains gated. AWJ may ship or render it as an official asset only after:

1. its authentic official source is documented; and
2. applicable usage permission and guidelines for this Storefront context are documented.

Until those conditions are satisfied:

- do not invent, redraw, recolor, or approximate the logo;
- do not use Lucide as a substitute;
- do not use an emoji;
- do not use an AI-generated logo;
- do not crop it from a screenshot;
- do not accept a merchant-uploaded substitute as the official asset;
- record the missing provenance as an Asset Gate in the implementation report.

The lack of an approved asset must not block the persistence and Show/Hide contract itself. It blocks only shipping an official SBC logo or trust mark.

### 7.1 Official merchant seal integration boundary

The official merchant-facing seal is rendered only through the Saudi Business
Center's government-hosted integration:

`https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js`

An authenticated merchant obtains the opaque `data-token` through the official
Saudi Business Center **Add QR Seal** flow and copies only that token into the
typed `sbc.seal_token` setting. AWJ does not accept or persist merchant-provided
HTML or JavaScript.

The published Storefront may load the official loader so that the SBC service
continues to own the seal artwork, QR, certificate link, and verification
presentation. AWJ does not copy, locally host, mirror, modify, or recreate
`seal.js`, SBC emblem/logo artwork, the government QR, or a government status.
The authenticated AWJ Admin/Customizer must not execute the loader; the public
Storefront is the only AWJ runtime permitted to do so.

When the official service is unavailable, the existing text-only
`موثّق في منصة الأعمال` presentation is retained as an AWJ presentation choice.
It is not an independent AWJ verification result and must not be changed into
an invalid, expired, suspended, unverified, or other status claim. Any future
official asset or integration change must repeat the official-source,
usage-guidance, and permission evidence gate; assets must not be copied from
Salla, Zid, or another platform.

## 8. Persistence and API boundary

Use the smallest persistence path compatible with the existing StorefrontPresentation contract. Do not create a new table or migration if the existing presentation document can represent these two settings safely and backward-compatibly.

The public API may expose only the sanitized, minimum SBC presentation fields required by the existing Footer. It must not expose internal IDs or raw server-side implementation details.

The SBC settings must not modify:

- `Tenant.name`;
- `Tenant.cr_number`;
- `Tenant.vat_number`;
- accounting or invoices;
- tax or ZATCA calculations;
- checkout or payment behavior;
- authentication, authorization, or domain/tenant resolution.

## 9. Tenant Isolation and security

- Tenant and Storefront are resolved server-side from the existing trusted context.
- `authentication_number` and `show_in_storefront` are scoped to the owned Storefront.
- Cross-tenant reads and writes must fail closed.
- Browser-supplied tenant IDs, query parameters, cookies, arbitrary Host values, presentation JSON, or client-side environment variables cannot establish tenant or legal-identity authority.
- Public responses must not leak Tenant, Storefront, sales-channel, evidence, or integration IDs.
- SBC presentation configuration cannot override canonical CR/VAT or read values from another Tenant.

## 10. Backward compatibility

- Existing stores without SBC settings continue to work unchanged.
- Missing SBC settings normalize to `show_in_storefront = false`.
- Existing stores must not show SBC automatically.
- Existing presentation documents remain readable.
- Legacy `requestedVerifiedLabel`, `verification.crNumber`, `licenseNumber`, and `sourceUrl` retain their existing compatibility meaning and do not become SBC settings.
- Existing public fields must not be silently renamed or changed in meaning.
- Stored legacy keys must not be deleted merely to introduce SBC V1.

## 11. Scope exclusions

SBC V1 does not include:

- QR codes or AWJ-generated government-style QR codes;
- VAT verification;
- CR editing;
- license verification;
- WhatsApp branding;
- App Store or Google Play badges;
- payment brands;
- a broad Trust Center;
- government lookup, scraping, polling, or external API integration;
- unrelated accounting, invoice, ZATCA, authentication, authorization, tenant-resolution, or domain changes.

Each excluded item requires its own evidence, contract, UX, implementation, and verification scope.

## 12. Implementation acceptance criteria

An implementation satisfies this contract only when:

1. a merchant can save `authentication_number` as a trimmed opaque String;
2. leading zeros are preserved;
3. a merchant can toggle `show_in_storefront`;
4. OFF removes the SBC item completely from public Footer and Preview;
5. ON renders the SBC item inside the Footer, not above it;
6. ON renders **موثّق في منصة الأعمال** and no Pending/Unverified status;
7. the authentication number is not customer-facing by default;
8. CR/VAT remain canonical Tenant values;
9. Preview and public Footer have equivalent SBC visibility behavior;
10. cross-tenant reads/writes fail closed;
11. internal IDs are absent from the public contract;
12. existing stores and legacy presentation snapshots remain compatible;
13. the official asset is used only when the Official Asset Gate is satisfied.

## 13. Future evidence and integration work

Future work may establish an official SBC asset source, usage permission, supported inquiry destination, or authoritative verification integration. Such work must be separate from this V1 presentation implementation.

Until then, the approved V1 behavior is the explicit Footer Show/Hide presentation contract above. It does not introduce customer-facing Pending/Unverified states and does not alter canonical business identity.

## 14. UX handoff

The implementation UX is intentionally small and limited to:

- merchant input: **رقم توثيق منصة الأعمال**;
- merchant control: **إظهار توثيق منصة الأعمال في المتجر**;
- Footer presentation: **موثّق في منصة الأعمال** when enabled;
- no SBC Home Builder section;
- no status workflow in Preview or Public Storefront;
- no default customer-facing authentication number;
- responsive Footer behavior that preserves the same semantic order on desktop and mobile.

No broader Footer redesign or trust-feature expansion is authorized by this contract.
