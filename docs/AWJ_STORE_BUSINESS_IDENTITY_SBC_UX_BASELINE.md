# AWJ Store — Business Identity & SBC Trust UI/UX Baseline

Status: Product/UX baseline  
Scope: Public storefront business identity and Saudi Business Center (SBC / منصة الأعمال) trust presentation only.

## 1. Purpose

This document fixes the UI/UX direction before implementation. It is based on the supplied mobile storefront benchmark screenshot, adapted to AWJ rather than copied literally.

The benchmark demonstrates a useful separation between:
1. legal/business information (Commercial Registration and VAT number), and
2. official e-commerce trust/verification (منصة الأعمال).

This separation is mandatory in AWJ.

## 2. Source-of-truth boundaries

### Commercial Registration (CR)
- Canonical value: `Tenant.cr_number`.
- The Store Customizer must not create a second authoritative CR value.
- Presentation data must never override the canonical Tenant value.

### VAT number
- Canonical value: `Tenant.vat_number`.
- The Store Customizer must not create a second authoritative VAT value.
- Presentation data must never override the canonical Tenant value.

### Public store name vs legal identity
- `Storefront.name` remains the public store/display name.
- Legal identity remains owned by Tenant data.
- These concepts must not be silently collapsed.

### Saudi Business Center verification
- The merchant-facing input for SBC V1 is the **منصة الأعمال e-commerce authentication/verification number**.
- It is not the CR number and not the VAT number.
- Typing a number alone must never mint an authoritative `verified` claim.
- The backend must establish trustworthy verification/association before AWJ publicly presents the store as verified.

## 3. Public Storefront information architecture

The storefront footer/trust area must preserve semantic separation:

`Business Identity → Official Trust → Payments / Communication / Other services`

### A. Business Identity
Display:
- Commercial Registration label + canonical CR number.
- VAT label + canonical VAT number.

These are business/legal data, not “verified badges”.

### B. Official Trust — منصة الأعمال
Render as a visually separate trust block.

Target content:
- Arabic concept: **موثّق في منصة الأعمال**.
- Official منصة الأعمال / Saudi Business Center verification asset when its official source and permitted usage are established.
- The authentication number does not need to be the primary customer-facing element in V1.
- If an official verification destination/link is supported and appropriate, the trust mark may link to it.

### C. Payments and other brands
Payment logos, communication channels and other external brands belong to their own groups.
They must not be mixed into the SBC verification block.

## 4. Mobile baseline

On mobile, use a clear vertical hierarchy:

1. Business information
   - Commercial Registration
   - CR number
   - VAT number
2. Divider / sufficient spacing
3. Official trust
   - “موثّق في منصة الأعمال”
   - official trust mark
4. Subsequent footer groups such as payments and communication

The supplied benchmark screenshot is a **UX benchmark**, not authorization to copy its layout, artwork, or assets.

## 5. Desktop baseline

Desktop may place CR and VAT side-by-side when space permits.

The SBC trust block remains semantically and visually separate from Business Identity and from payment logos.

Do not derive a desktop layout by simply stretching the mobile benchmark.

## 6. Merchant / AWJ UX

### CR and VAT
- Do not ask the merchant to re-enter CR or VAT in Store Customizer when canonical Tenant values exist.
- Store Customizer controls presentation only (for example visibility/order where supported), not legal values.

### SBC V1
Keep merchant UX intentionally small:
1. Merchant enters the **منصة الأعمال authentication/verification number**.
2. AWJ performs the supported trustworthy verification/association flow.
3. Only a trustworthy successful state may enable the public verified presentation.

Do not add a merchant-controlled “I am verified” toggle.

## 7. Official asset rule

**AWJ Official Assets Rule**

Any government mark, verification mark, or third-party trademark displayed by AWJ Storefront must use the authentic official asset from a documented official source and comply with the applicable usage rules.

Therefore:
- Do not replace official marks with Lucide icons, emojis, approximate drawings, recreated SVGs, or screenshot crops.
- Do not redraw or recolor an official mark unless its official guidelines explicitly allow it.
- Preserve required proportions, colors, clear space, locale variants, and minimum sizes where applicable.
- The existence of a logo online or its use by another commerce platform is not, by itself, permission for AWJ to use it.
- Store the provenance/usage evidence for an external official asset before treating it as production-approved.

This rule applies to the CR/VAT visual assets where an official mark is used and to the منصة الأعمال trust mark.

## 8. Explicit V1 exclusions

For this SBC V1 baseline:
- No QR code.
- No AWJ-generated government-style QR.
- No merchant-uploaded substitute for an official verification mark.
- No VAT verification workflow.
- No WhatsApp brand work.
- No App Store / Google Play badge work.
- No payment-brand implementation.
- No broad Trust Center feature.
- No unrelated accounting, invoice, ZATCA, auth, tenant-resolution, or domain changes.

Each of those items must be handled as a separate scoped feature/evidence pass.

## 9. Security and trust invariants

- Tenant Isolation is mandatory.
- Legal identity must be resolved server-side from the correct Tenant.
- Browser input, query strings, cookies, arbitrary Host values, or presentation JSON cannot become legal identity authority.
- Public contracts must not expose internal Tenant/Storefront IDs unnecessarily.
- Legacy presentation fields may remain readable for backward compatibility but cannot override canonical identity or mint official verification.
- A presentation setting must never be the source of government verification truth.

## 10. UX acceptance principles

A future implementation is acceptable only when:
- CR and VAT are readable and clearly identified.
- CR/VAT values come from canonical AWJ business identity.
- SBC trust is visually distinct from CR/VAT.
- SBC trust is distinct from payment/communication logos.
- The merchant setup for SBC is simple and does not expose internal complexity.
- No false “verified”, “official”, or government affiliation can be produced by presentation configuration.
- Official marks are authentic assets with documented provenance and permitted usage.
- Mobile and desktop are intentionally designed, not mechanically scaled versions of each other.

## 11. Next scoped step

Before implementation of the SBC trust mark:
1. establish the official verification/lookup mechanism for the منصة الأعمال authentication number;
2. establish the official asset source and permitted storefront usage;
3. freeze the minimal SBC data/verification contract;
4. design the SBC merchant setup and public storefront states for mobile + desktop;
5. only then implement.

Do not expand this task into VAT, WhatsApp, app-store badges, payments, or other trust features.
