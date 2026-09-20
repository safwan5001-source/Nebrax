# AWJ Store — SBC Verification V1 Contract

Status: Proposed contract, evidence-gated
Scope: Saudi Business Center (منصة الأعمال) e-commerce authentication only.

## 1. Purpose

Define the smallest safe contract for associating an AWJ Storefront with Saudi Business Center e-commerce authentication. This document defines product and trust boundaries; it does not implement the feature.

## 2. Terminology

Merchant-facing field: **رقم توثيق منصة الأعمال**.

This is separate from Commercial Registration (CR), VAT number, licenses, ZATCA, payment brands, and other trust features.

## 3. Ownership

- Tenant remains the canonical legal/business identity.
- CR remains `Tenant.cr_number`.
- VAT remains `Tenant.vat_number`.
- Storefront remains the public store identity and is the subject of the SBC e-commerce authentication association.
- SBC evidence must never replace or override Tenant legal identity.

This is an ownership contract, not yet a database schema decision.

## 4. Merchant input

V1 has one conceptual input: `authentication_number`.

Rules:
- treat it as an opaque string until an official format specification is established;
- trim harmless surrounding whitespace;
- do not guess a fixed length or regex from examples;
- do not interpret it as CR or VAT;
- saving the number does not make the Storefront verified.

## 5. Verification authority

The merchant and Store Customizer are not verification authorities.

A public verified state may be produced only from a trustworthy Saudi Business Center mechanism that AWJ is permitted to use.

Until such a mechanism is documented:
- the existence of an authentication number is not proof;
- presentation settings cannot elevate it to verified;
- AWJ must not claim **موثّق في منصة الأعمال**;
- implementation must not depend on scraping the public inquiry website.

No public machine-readable API is assumed by this contract.

## 6. Minimal state semantics

Do not invent a large status enum before integration evidence exists.

The contract needs only this trust boundary:
- **not authoritatively verified**: no official verified claim may be rendered;
- **authoritatively verified**: the approved trust presentation may be rendered after verification and official-asset gates are satisfied.

Operational states may be added later only when grounded in the real integration.

## 7. Public Storefront

Fail closed by default.

When all evidence gates are satisfied, intended presentation:
- text equivalent to **موثّق في منصة الأعمال**;
- authentic official SBC/منصة الأعمال asset when its source and usage permission are documented;
- an official verification/inquiry destination if a supported public destination is established.

The authentication number does not need to be prominent customer-facing content in V1.

Do not expose internal Tenant, Storefront, evidence, or integration identifiers.

## 8. Customizer boundary

Customizer may eventually control presentation of an already trustworthy state, such as visibility or ordering.

Customizer must not:
- change verification truth;
- provide an “I am verified” switch;
- accept a merchant-uploaded government mark as proof;
- create verified status from presentation JSON;
- override the Storefront/evidence association.

Preview must not fake an official verified state.

## 9. Official asset gate

No SBC/منصة الأعمال logo or trust mark may ship as an official verification mark until:
1. its authentic official source is established; and
2. applicable usage permission/guidelines for this storefront context are documented.

Do not use recreated SVGs, approximate icons, screenshot crops, or merchant-uploaded substitutes.

Use by another commerce platform is UX evidence only, not authorization for AWJ.

## 10. Tenant Isolation and security

- Resolve Tenant and Storefront server-side using existing trusted context.
- SBC evidence must be scoped to the owned Storefront.
- Cross-tenant reads/writes fail closed.
- Client input and presentation configuration cannot establish verification authority.
- Public payload exposes only minimum trustworthy presentation state.
- SBC verification must not alter accounting, invoicing, tax, ZATCA, checkout, or canonical legal identity.

## 11. Backward compatibility

Existing presentation verification fields remain non-authoritative.

Do not reinterpret legacy `requestedVerifiedLabel`, merchant-provided CR/license/source URL, or similar presentation fields as SBC verification evidence.

Do not silently change the meaning of existing public fields.

## 12. Out of scope

SBC Verification V1 excludes:
- QR codes;
- AWJ-generated government QR;
- VAT verification;
- CR editing;
- license verification;
- WhatsApp branding;
- App Store / Google Play badges;
- payment brands;
- broad Trust Center work;
- unrelated accounting, ZATCA, auth, or domain changes.

Each remains a separate feature under: Evidence → Contract → UX/UI → Implementation → Tests → Production Verification.

## 13. Open evidence gates

Before implementation, establish from official sources:
1. official credential terminology and any documented format constraints;
2. whether a supported machine-readable verification integration exists;
3. official inquiry/deep-link behavior suitable for storefront use;
4. authoritative result/status semantics AWJ may rely on;
5. official SBC/منصة الأعمال asset source;
6. permitted third-party storefront usage of that asset.

If these cannot be established, AWJ remains fail-closed and does not display an official verified claim.

## 14. UX handoff

After the necessary evidence gates are resolved, design SBC-only Desktop + Mobile UX for:
- merchant authentication-number entry;
- verification feedback grounded in actual supported states;
- verified public footer/trust block;
- safe unverified/unavailable behavior.

Do not expand that UX pass into VAT, WhatsApp, app badges, payments, or other trust features.
