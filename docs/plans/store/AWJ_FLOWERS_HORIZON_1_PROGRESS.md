# AWJ Flowers & Gifts — Horizon 1 Progress

**Status:** IN PROGRESS — H1 and H2a merged; H2b–H2d in review/CI  
**Date:** 2026-10-03  
**Planning Base:** `main` @ `318cc72d10bb304cef4b401f548772008ea1618e`  
**Execution Authority:** `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md`  
**Product Direction:** `AWJ_FLOWERS_GIFTS_VERTICAL_V1.md`  
**Reuse/Gap Evidence:** `FLOWERS_EVIDENCE_1_AWJ_REUSE_GAP_AUDIT.md`

---

## Current verified state

Completed and merged before Horizon implementation:

| Item | Status | Evidence |
|---|---|---|
| FNP preliminary evidence | MERGED | PR #1180 |
| FNP deep evidence audit | MERGED | PR #1181 |
| AWJ reuse/gap audit | MERGED | PR #1183 |
| Flowers & Gifts vertical direction | MERGED | PR #1179 / Merge SHA `318cc72d10bb304cef4b401f548772008ea1618e` |
| Autonomous implementation Horizon | DOCUMENTATION IN PROGRESS | this planning branch |

H1 and H2a are merged (see the per-slice log below). H2b–H2d are open as a temporary stack and are being merged strictly in order (review → CI → merge → sync main). H3 and H4 have open PRs (#1191, #1192) that are **on hold** until H2 is fully merged; H5 has a pushed branch with no PR, and H6 exists only locally. No further Flowers PR is opened until the backlog is reduced.

No Deploy or Production change is authorized by this Horizon.

---

## Slice tracker

| Slice | Scope | Status | PR | Merge SHA |
|---|---|---|---|---|
| H1 | Business Vertical Foundation | MERGED | #1186 | `83635d6` |
| H2a | Taxonomy — facets: ADR-14, data model, admin API | MERGED | #1187 | `fbc0eeb` |
| H2b | Taxonomy — storefront/mobile facet filtering | PR OPEN (#1188) | #1188 | — |
| H2c | Taxonomy — collections | PR OPEN (#1189) | #1189 | — |
| H2d | Taxonomy — merchandising admin UI | PR OPEN (#1190) | #1190 | — |
| H3 | Gifting Identity & Gift Message | ON HOLD (PR open, awaits H2) | #1191 | — |
| H4 | Personalization | ON HOLD (PR open, awaits H2) | #1192 | — |
| H5 | Structured Product Content | NOT STARTED | — | — |
| H6 | Add-ons | NOT STARTED | — | — |
| H7 | Delivery Scheduling Contract | NOT STARTED | — | — |
| H8 | Availability / Same-day | NOT STARTED | — | — |
| H9 | Store Builder Flowers Experience | NOT STARTED | — | — |
| H10 | Storefront Discovery UX | NOT STARTED | — | — |
| H11 | Flowers/Gifts PDP | NOT STARTED | — | — |
| H12 | Cart & Checkout Gifting UX | NOT STARTED | — | — |
| H13 | Account / Saved Recipient / Order Experience | NOT STARTED | — | — |
| H14 | Vertical Onboarding & Defaults | NOT STARTED | — | — |
| H15 | Theme / Presentation Pack | NOT STARTED | — | — |
| H16 | Cross-Horizon Integration / Polish | NOT STARTED | — | — |

---

## Per-slice log template

Copy this section for every completed/active slice.

### Hx — Name

**Status:** NOT STARTED / IN PROGRESS / PR OPEN / REVIEW / CI / MERGED / BLOCKED  
**Base SHA:**  
**Branch:**  
**PR:**  
**Head SHA:**  
**Merge SHA:**  

#### What was implemented

- 

#### Evidence / decisions

- 

#### Tests

- 

#### CI

- 

#### Visual verification

- 

#### Tenant Isolation / Security

- 

#### Backward compatibility

- 

#### Risks / findings

- 

#### Deferred

- 

#### Next

- 

### H1 — Business Vertical Foundation

**Status:** MERGED  
**Base SHA:** `9c71d236272f2ab92b99a27b5278dd38150b279e`  
**Branch:** `flowers/h1-business-vertical-foundation`  
**PR:** #1186  
**Head SHA:** `941962628874c9d2a0e970fbde8c1e6a7ff7f808`  
**Merge SHA:** `83635d6` (squash)

#### What was implemented

- `BusinessVertical` (`general`, `flowers_gifts`) and `VerticalCapability` (platform-owned, finite; every capability reports `available = false` until its slice merges).
- Additive 1:1 side table `storefront_business_profiles`; absence of a row means `general`, so no backfill and existing stores are unchanged.
- Workspace API: `business_vertical` on store update and first-store provisioning; store payload gains `business_vertical` and `vertical_profile`; public config exposes only the vertical key.
- Store settings dialog: plain-language "Business type" chooser.
- Review fixes: identity and vertical updates are one transaction with row locking; pgsql `products_type_check` test data fixed.

#### Tests / CI / visual

- `FlowersBusinessVerticalApiTest` (16 cases + atomic-rollback case); updated exact-key-list tests; web unit tests; Playwright spec (AR 390/430/1440, EN 390, no horizontal overflow). CI (sqlite, pgsql, web build) green on the head.

#### Tenant isolation / backward compatibility / risks

- Ownership re-verified through `TenantContext`; cross-tenant storefront rejected, IDOR returns 404. Store payload only gains trailing keys; settings requests send the field only when changed.
- No journal, inventory, pricing, checkout or ZATCA behaviour touched, so no posting table applies.

#### Deferred

- Applying starter defaults on selection (H14); the capabilities themselves (H2–H9).

---

### H2a — Catalog facets (ADR-14, data model, admin API)

**Status:** MERGED  
**Base SHA:** `9c71d236272f2ab92b99a27b5278dd38150b279e` (re-synced with main before merge)  
**Branch:** `flowers/h2a-catalog-facets`  
**PR:** #1187  
**Head SHA:** `93e9b65db1765d7dd50d2eb7b8ea3d8cb38f5194`  
**Merge SHA:** `fbc0eeb715e92dc955b958a3fdb86bf0a1b8a0b9` (squash)

#### What was implemented

- ADR-14: category = structure, facet = tenant-governed filterable dimension with localized values, occasion/recipient = system-key facets, brand = built-in filter, collection = curated group (H2c), variant = SKU identity only.
- Additive migrations `commerce_facets`, `commerce_facet_values`, `commerce_product_facet_values` (CompanyWide, tenant FKs).
- `CommerceFacetService` and admin API `api/commerce/workspace/facets…` + `products/{id}/facets` under `products.view` / `products.manage`.
- Review hardening: one facet-row lock protocol for every path that touches a facet's values (create/update/delete value, update/delete facet, assignment), tenant-row lock for the facet limit, normalized-name checks that keep `"0"`, assignment rejects a product deleted after load, facet assignments classified `OWNED_CHILD` in `ProductReferenceRegistry` and removed by `ProductLifecycleService`.

#### Tests / CI

- `CommerceFacetApiTest` (17 cases), registry/guard suites, route allow-list and OpenAPI contract tests. CI sqlite and pgsql green on the head. The pgsql suite also verified locally against PostgreSQL 16.

#### Tenant isolation / backward compatibility / risks

- Structural tenant guards in model `saving` hooks; foreign ids return 404 without revealing existence. No journal, ledger, inventory, price, ZATCA, order or invoice behaviour touched.
- Known unrelated flake observed in CI: `ZatcaQrCertificateMaterialExtractorTest` compares a randomly generated EC coordinate that `openssl_pkey_get_details` can return without leading zero bytes; it is outside this Horizon and was only re-run, not changed.

#### Deferred

- Tenant-wide product search in the collection picker for multi-branch tenants with product sharing off (needs a backend endpoint; tracked as a follow-up).

#### Next

- H2b → H2c → H2d in order, then re-verify H3 and H4 against the new main.

---

## Evidence-gated domains

These remain outside automatic implementation until their dedicated evidence/contract is sufficient:

- fixed/configurable bundles;
- bouquet BOM/recipe/assembly;
- substitutions;
- failed delivery;
- no-address gifting;
- money bouquets/cash gifts;
- corporate gifting;
- perishable/personalized returns and cancellation.

---

## Production state

```text
MERGES: only according to Horizon authorization
DEPLOY: NOT PERFORMED
PRODUCTION: NOT CHANGED
```
