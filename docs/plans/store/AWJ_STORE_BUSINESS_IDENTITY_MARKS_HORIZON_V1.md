# AWJ Store Business Identity Marks Horizon V1

**Status:** Defined / implementation gated  
**Repository:** `safwan5001-source/Nebrax`  
**Owner:** Safwan  
**No merge / deploy without explicit owner approval**

## 1. Objective

Complete the visual presentation of AWJ Store business identity in Preview and Published Storefront without changing the existing identity architecture.

Scope:

- Commercial Registration (CR) visual treatment;
- VAT Number visual treatment;
- Saudi Business Center (SBC) presentation continuity;
- Preview ↔ Published visual parity;
- responsive, RTL/LTR and accessibility verification.

This horizon is visual completion only.

## 2. Start Gate

Before implementation, verify latest `origin/main` and PR #1077:

`test(store): complete brand QA published-route follow-up`

Do not start implementation while #1077 is unresolved, failing, or has open P1/P2 findings.

If #1077 is not clean and merged, stop and report the current state.

## 3. Existing AWJ Authority — Do Not Rebuild

### Canonical Business Identity

Existing authority remains:

- `business_identity.legal_name`
- `business_identity.cr_number`
- `business_identity.vat_number`

These values come from the resolved Tenant and remain canonical.

Do not create a second CR/VAT authority in presentation settings.

Relevant prior work:

- `STORE-TRUST-BIZ-1`
- `docs/plans/store/STORE-TRUST-BIZ-1-IMPLEMENTATION-REPORT.md`
- `docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_EVIDENCE.md`

### Saudi Business Center

Existing Published implementation remains authoritative:

`storefront/src/components/layout/SbcSeal.tsx`

Official loader:

`https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js`

Rules:

- keep the existing official SBC loader;
- do not redraw or imitate the SBC seal;
- do not display or log the raw `seal_token`; passing it to the official SBC loader via its required `data-token` mechanism is permitted and required for the existing official integration;
- Preview must remain inert and must not execute the government script;
- SBC without an official seal token must use a neutral, non-verified fallback state. This horizon may replace the current misleading `sbcVerified` fallback for tokenless SBC, but must preserve the official loader path when a token exists.

Relevant prior work:

- `STORE-TRUST-SBC-1`
- `docs/plans/store/STORE-TRUST-SBC-1-IMPLEMENTATION-REPORT.md`

## 4. Salla Reference Pass

Before implementation, perform a focused current comparison against Salla storefronts and official Salla documentation where available.

Record:

- CR presentation pattern;
- VAT presentation pattern;
- Saudi Business Center / verification presentation;
- grouping and hierarchy;
- mobile + RTL behavior;
- missing-value behavior;
- whether CR/VAT marks are official external marks or generic utility icons.

Separate clearly:

### External Evidence

What Salla and authoritative Saudi sources actually show.

### AWJ Decision

What AWJ chooses and why.

Do not copy Salla blindly.

## 5. Mark Classification

Every new visual mark must be classified as one of:

- `OFFICIAL_EXTERNAL_MARK`
- `AWJ_UTILITY_ICON`
- `TEXT_ONLY`
- `NOT_AUTHORIZED`

SBC is an official external trust mechanism.

CR and VAT are business information, not proof of verification.

Before implementation, verify whether Saudi authorities prescribe an official storefront mark for CR or VAT.

If not proven, use AWJ utility icons from the existing maintained icon system rather than inventing an official-looking badge.

## 6. Visual Direction

Keep the AWJ Footer:

- dense;
- calm;
- professional;
- readable;
- trustworthy;
- free from a decorative logo wall.

Business Identity and SBC remain separate semantic groups.

Recommended structure:

- Business information
  - Commercial registration + value
  - VAT number + value
- Saudi Business Center
  - existing official seal/fallback behavior

Icons supplement visible labels and values; they never replace them.

Missing values hide the complete corresponding row.

## 7. Required Surfaces

Maintain semantic parity across:

- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`

Prefer one small reusable identity-detail component rather than duplicating CR/VAT markup across surfaces.

Do not create a generic arbitrary brand/icon renderer.

## 8. Data / Architecture Guardrails

Do not add or change:

- DB columns or migrations;
- Tenant identity fields;
- public API contracts;
- presentation schema fields;
- Tenant Isolation;
- RBAC;
- hostname/storefront resolution;
- Draft/Public separation;
- accounting;
- VAT calculations;
- ZATCA;
- checkout/payment behavior.

No cross-tenant fallback.

No fabricated identity values.

## 9. Payment Boundary

Payment brands remain outside this horizon.

Do not add:

- mada;
- Visa;
- Mastercard;
- Apple Pay;
- Google Pay.

`STORE-BRAND-PAY-1` remains deferred until an authoritative supported+enabled payment capability exists.

## 10. Localization

Reuse existing keys where possible.

Required concepts:

Arabic:

- معلومات المنشأة
- السجل التجاري
- الرقم الضريبي
- existing AWJ wording for Saudi Business Center

English:

- Business information
- Commercial registration
- VAT number
- existing AWJ Saudi Business Center wording

Avoid duplicate translation keys.

## 11. Accessibility

For utility icons beside visible text:

- icon is supporting/decorative;
- use `aria-hidden="true"` where appropriate;
- visible label/value remains the accessible meaning.

Preserve:

- visible keyboard focus;
- usable touch targets;
- readable contrast;
- intentional RTL/LTR alignment.

## 12. Required QA Matrix

Widths:

- 390
- 430
- 768
- 1024
- 1280
- 1440

Locales:

- Arabic RTL
- English LTR

Identity states:

- full: legal name + CR + VAT + SBC;
- CR only;
- VAT only;
- no CR/VAT;
- long legal name;
- SBC with seal token;
- SBC without seal token using a neutral, non-verified fallback.

Verify:

- no horizontal overflow;
- missing rows/icons do not render;
- icon proportions are stable;
- Preview and Published semantics match;
- SBC official behavior is unchanged.

Do not weaken the existing Store Brand QA matrix.

## 13. Expected Tests

At minimum:

### Published Footer

- canonical CR renders with its visual treatment;
- canonical VAT renders with its visual treatment;
- absent CR hides CR row/icon;
- absent VAT hides VAT row/icon;
- legal-name behavior unchanged;
- legacy `verification.crNumber` never becomes public authority;
- SBC official-token loader behavior unchanged; tokenless fallback must be neutral/non-verified.

### Merchant / Storefront Preview

Same CR/VAT semantics and absent-state behavior.

### Browser QA

Verify responsive RTL/LTR parity and overflow across the required widths.

## 14. Implementation Workflow

1. Verify latest `origin/main`.
2. Verify #1077 gate.
3. Record exact Base SHA.
4. Review existing AWJ identity/SBC code and prior reports only as needed.
5. Perform Salla + authoritative-source evidence pass.
6. Record mark classification.
7. Implement the smallest safe slice.
8. Run focused tests.
9. Run relevant storefront/web/Brand QA.
10. Self-review exact diff.
11. Open one focused PR.
12. Follow relevant CI and resolve in-scope P1/P2.
13. Stop before merge.

No deploy.

## 15. Stop Conditions

Stop and report rather than improvising if:

- PR #1077 is not clean/merged;
- CR/VAT would require an unproven official mark;
- SBC would require a new government verification mechanism;
- a DB/API/schema change appears necessary;
- canonical identity authority becomes ambiguous;
- Tenant Isolation/RBAC must change;
- scope expands into tax/accounting/ZATCA/payments.

## 16. Definition of Done

Done only when:

- Salla/current external evidence is recorded;
- CR/VAT mark classification is explicit;
- CR and VAT have truthful, non-misleading visual treatment;
- official SBC token/loader behavior remains intact; tokenless SBC uses the defined neutral/non-verified fallback;
- missing values render nothing;
- Preview ↔ Published parity passes;
- RTL/LTR and required widths pass;
- no horizontal overflow;
- accessibility remains correct;
- focused tests + relevant CI are green;
- no unresolved P1/P2 remains;
- PR is ready for owner review;
- Merge not performed;
- Deploy not performed.

## 17. Final Implementation Report

The implementer must deliver an MD report containing:

- Summary;
- Base SHA / Branch / PR / Head SHA;
- Salla + authoritative-source evidence;
- CR/VAT/SBC mark classification;
- AWJ decision;
- changed files;
- tests and exact results;
- CI status;
- Tenant/Security confirmation;
- Accounting/Tax/ZATCA confirmation;
- Preview ↔ Published verification;
- review findings and disposition;
- risks/remaining;
- `Merge: NOT PERFORMED`;
- `Deploy: NOT PERFORMED`;
- next step.

## 18. Horizon End

This horizon ends after the focused PR is green, reviewed, and ready for owner merge approval.

Do not automatically start another Store/Payment/Trust horizon.
