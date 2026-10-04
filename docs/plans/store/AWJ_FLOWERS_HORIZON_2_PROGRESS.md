# AWJ Flowers & Gifts — Horizon 2 Progress

**Status:** PLANNED — execution not started  
**Date:** 2026-10-04  
**Planning Base:** `main` @ `6ded662bfada8f72f5ebf321dcf27b08be7939c1`  
**Execution Authority:** `AWJ_FLOWERS_HORIZON_2_MERCHANT_ADMIN_SURFACES.md`  
**Predecessor Final Report:** `AWJ_FLOWERS_HORIZON_1_FINAL_REPORT.md`

---

## Current verified state

Horizon 1 is complete.

- H1–H16 merged.
- Final Horizon 1 Merge SHA: `6ded662bfada8f72f5ebf321dcf27b08be7939c1`.
- Core Flowers & Gifts capabilities work end to end.
- Main adoption gap: several merchant configuration capabilities are API-backed but lack complete AWJ dashboard surfaces.
- Railway is connected to `main` and may auto-deploy merged commits. Horizon 2 does not authorize manual deploys; every slice must report actual observed CI/CD state rather than assuming Production is unchanged.

---

## Slice tracker

| Slice | Scope | Status | PR | Merge SHA |
|---|---|---|---|---|
| H2-1 | Gift Policy Admin | NOT STARTED | — | — |
| H2-2 | Delivery Schedule Admin | NOT STARTED | — | — |
| H2-3 | Delivery Windows & Capacity | NOT STARTED | — | — |
| H2-4 | Blocked Dates & Exceptions | NOT STARTED | — | — |
| H2-5 | Fulfillment Warehouse Setup | NOT STARTED | — | — |
| H2-6 | Product Preparation Time | NOT STARTED | — | — |
| H2-7 | Product Personalization Admin | NOT STARTED | — | — |
| H2-8 | Product Add-ons Admin | NOT STARTED | — | — |
| H2-9 | Structured Product Content Admin | NOT STARTED | — | — |
| H2-10 | Unified Product Gifting Workspace | NOT STARTED | — | — |
| H2-11 | Vertical Setup Center V2 | NOT STARTED | — | — |
| H2-12 | Merchant Onboarding Flow | NOT STARTED | — | — |
| H2-13 | Permissions / RBAC / Tenant Isolation Pass | NOT STARTED | — | — |
| H2-14 | Admin UX / RTL / Mobile Polish | NOT STARTED | — | — |
| H2-15 | Real Merchant Journey Contract | NOT STARTED | — | — |
| H2-16 | Cross-Horizon Integration & Final Report | NOT STARTED | — | — |

---

## Mandatory UI evidence for every UI slice

A UI slice is not complete until its progress entry records:

- Arabic RTL mobile verification;
- Arabic RTL desktop verification;
- English LTR mobile verification;
- English LTR desktop verification;
- tablet verification when layout materially changes;
- loading state;
- empty state;
- validation/error state;
- disabled/dependency state when applicable;
- keyboard/focus behavior;
- no horizontal overflow;
- design-token compliance;
- confirmation that no AI-template visual patterns were introduced.

---

## Per-slice log template

### H2-x — Name

**Status:** NOT STARTED / IN PROGRESS / PR OPEN / REVIEW / CI / MERGED / BLOCKED  
**Base SHA:**  
**Branch:**  
**PR:**  
**Head SHA:**  
**Merge SHA:**  

#### Contract / scope
- 

#### UI / information architecture
- 

#### What was implemented
- 

#### Tests
- 

#### CI
- 

#### Visual QA
- Arabic RTL mobile:
- Arabic RTL desktop:
- English LTR mobile:
- English LTR desktop:
- Tablet:
- Dark mode:
- Empty/loading/error:
- Keyboard/focus:
- Overflow:

#### Tenant Isolation / RBAC
- 

#### Backward compatibility
- 

#### Findings / risks
- 

#### Deferred
- 

#### Deployment observation
- Manual deploy: NOT PERFORMED
- Automatic CI/CD deploy: UNKNOWN / NOT OBSERVED / OBSERVED
- Production verification: NOT PERFORMED / UNKNOWN / VERIFIED
- Notes:

#### Next
- 

---

## Deferred / evidence-gated

Do not pull these into Horizon 2 merely because adjacent UI is being built:

- bundles;
- bouquet BOM / recipe / assembly;
- substitutions;
- no-address gifting;
- recipient notifications;
- customer image/file personalization upload;
- money/cash gifts;
- corporate gifting;
- saved recipients before shared identity/address contract;
- reorder before safe repricing/availability contract;
- wishlist before shared capability;
- payment activation / gateway fee accounting;
- perishable/personalized returns policy;
- App Builder/mobile admin unless separately authorized.

---

## Final report target

At H2-16 create:

`docs/plans/store/AWJ_FLOWERS_HORIZON_2_FINAL_REPORT.md`

It must contain the complete branch/PR/SHA table, test/CI evidence, UI evidence, security/tenancy review, remaining risks, deferred domains, and the **actual** deployment state.
