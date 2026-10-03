# AWJ Flowers & Gifts — Horizon 1 Progress

**Status:** IN PROGRESS — H1–H5 merged; H6 in review  
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

H1–H5 are merged (see the per-slice log below); the open Flowers backlog was emptied before H5 was rebuilt on the new main, and H6 was rebuilt on the H5 main. One slice at a time: review → CI → merge → sync main → next.

No Deploy or Production change is authorized by this Horizon.

---

## Slice tracker

| Slice | Scope | Status | PR | Merge SHA |
|---|---|---|---|---|
| H1 | Business Vertical Foundation | MERGED | #1186 | `83635d6` |
| H2a | Taxonomy — facets: ADR-14, data model, admin API | MERGED | #1187 | `fbc0eeb` |
| H2b | Taxonomy — storefront/mobile facet filtering | MERGED | #1188 | `6c085e6` |
| H2c | Taxonomy — collections | MERGED | #1189 | `5851d00` |
| H2d | Taxonomy — merchandising admin UI | MERGED | #1190 | `1e8ba70` |
| H3 | Gifting Identity & Gift Message | MERGED | #1191 | `d2b8cac` |
| H4 | Personalization | MERGED | #1192 | `a4866df` |
| H5 | Structured Product Content | MERGED | #1199 | `8663d48` |
| H6 | Add-ons | PR OPEN, in review | (see log) | — |
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

### H2b — Storefront / mobile facet filtering

**Status:** MERGED  
**Base SHA:** `fbc0eeb715e92dc955b958a3fdb86bf0a1b8a0b9` (main after H2a)  
**Branch:** `flowers/h2b-facet-storefront-filter`  
**PR:** #1188 (stacked on H2a, retargeted to `main` after H2a merged)  
**Head SHA:** `a66b77e864e80f1461d6ab404f8d21222f91931a`  
**Merge SHA:** `6c085e6819b563a45702a6bf0a45084de16130a2` (squash)

#### What was implemented

- `CatalogFacetFilter`, the single source of truth for public filtering semantics, used by both `store/v1` and `commerce/v1` product lists: `facet[<key>]=a,b` is OR within a facet and AND across facets; `brand_id` ANDs with the rest.
- Fail closed everywhere: an unknown or inactive facet or value, an empty facet entry, or an unknown or inactive brand returns an empty list; more than 20 values in one facet is rejected with 422; brand UUIDs are lower-cased before lookup.
- `meta.facets` and `meta.brands` carry disjunctive counts (selection never narrows its own counts); a selected brand stays visible at count 0; one grouped query per active facet plus one for brands.
- Publication gate remains first: unpublished products never appear in results or counts.

#### Tests / CI

- `CommerceFacetStorefrontFilterTest` (12 cases) including fail-closed variants, uppercase UUID, inactive brand, over-limit input, mobile parity; OpenAPI contract tests. CI sqlite and pgsql green on the head; pgsql also verified locally on PostgreSQL 16.

#### Tenant isolation / backward compatibility

- Tenant-scoped counts and lookups; cross-tenant filtering returns nothing. Stores without facets return the same list with additive empty `meta.facets` and `meta.brands`.
- No journal, ledger, inventory, price or ZATCA behaviour touched.

#### Next

- H2c (collections), then H2d (admin UI).

### H2c — Manual collections

**Status:** MERGED  
**Base SHA:** `6c085e6819b563a45702a6bf0a45084de16130a2` (main after H2b)  
**Branch:** `flowers/h2c-collections` (tree rebuilt as main + H2c after the H2b squash, to avoid replaying already-merged commits)  
**PR:** #1189 (stacked, retargeted to `main`)  
**Head SHA:** `acf85afe6cb02afcc223a0e4e1220e3d0f8e3389`  
**Merge SHA:** `5851d00893689ae29e1b94075e1de45f35827dea` (squash)

#### What was implemented

- Additive migration `commerce_collections` (+ ordered membership), CompanyWide models, `CommerceCollectionService`, admin API `api/commerce/workspace/collections…` and public reads (`store/v1`, `commerce/v1`) gated by product publication.
- Shared slug derivation (`CatalogSlug`), `CatalogCollectionReader`, and `collection=<slug>` as a contextual constraint in `CatalogFacetFilter` (like category, not a facet), with facet counts computed inside the collection context.
- Hardening from review: member validation lifts only `BranchScope` (company-wide collections can hold products from every branch even with product sharing off), collection limit serialized with a tenant row lock, membership classified `OWNED_CHILD` and removed with a true product delete.

#### Tests / CI

- `CommerceCollectionApiTest` (13 cases incl. cross-branch curation and lifecycle cleanup), registry/guard suites, route allow-list and OpenAPI contract tests. CI sqlite and pgsql green; PostgreSQL 16 verified locally.
- One CI run hit the unrelated `ZatcaQrCertificateMaterialExtractorTest` random-key flake and was re-run once.

#### Tenant isolation / backward compatibility

- Tenant-scoped everywhere; foreign tenant collections/products rejected without revealing existence. Draft or unknown collections fail closed on public reads. No ledger, inventory, price, order or ZATCA change.

#### Deferred / risks

- Tenant-wide product search for the collection picker in multi-branch tenants with product sharing disabled (needs a backend endpoint); operators can switch branch meanwhile.

#### Next

- H2d (admin UI), then re-verify H3 and H4 against the new main.

### H2d — Merchandising admin UI

**Status:** MERGED  
**Base SHA:** `5851d00893689ae29e1b94075e1de45f35827dea` (main after H2c)  
**Branch:** `flowers/h2d-merchandising-admin-ui` (tree rebuilt as main + H2d after the H2c squash)  
**PR:** #1190 (retargeted to `main`)  
**Head SHA:** `723216f6afc7246f5be75564259fa08db337404a`  
**Merge SHA:** `1e8ba7055d73db29770e307ad9b1f7f01fbe1cbb` (squash)

#### What was implemented

- Commerce-workspace page `/commerce/merchandising` (nav entry gated on `products.view`): dimensions (facets and values, core presets offered only when missing, enable/disable, delete blocked while assigned), collections (create/edit/status, members dialog with server-side search, reorder, remove, exact-order save, read-only member view for view-only users), and product assignment.
- Review hardening: dialogs cannot be dismissed while a write is pending; only one activation in flight; stale save, stale load-more (including A→B→A) and stale picker rows are discarded; a failed load-more keeps loaded rows and offers retry; edits are locked while a save is pending; activation failures are shown; tab content is wrapped in the matching `TabPanel`.

#### Tests / CI / visual

- 26 vitest cases on the page, 11 on the client, nav and message-parity tests. CI (sqlite, pgsql, web build) green on the head.
- Visual: Playwright spec `web/e2e/flowers-h2-merchandising.spec.ts` (AR 390/430/1024/1440, members dialog, collections, EN 390 LTR with keyboard focus, no horizontal overflow) was run and its screenshots reviewed before the review fixes; it was not re-run after the final rebuild.

#### Tenant isolation / backward compatibility

- Frontend-only; all writes go through the tenant-scoped admin APIs; no tenant identifier is sent. No ledger, inventory, price or checkout change.

#### Deferred / risks

- Tenant-wide product search in the collection picker for multi-branch tenants with product sharing disabled (needs a backend endpoint).
- No automated browser run of the merchandising flow after the final review fixes.

#### Next

- H3 (gifting identity) then H4 (personalization), each rebuilt on the new main.

### H3 — Gifting identity and gift message

**Status:** MERGED  
**Base SHA:** `1e8ba7055d73db29770e307ad9b1f7f01fbe1cbb` (main after H2d; originally cut from `9c71d236…`, rebuilt on main)  
**Branch:** `flowers/h3-gifting-identity`  
**PR:** #1191  
**Head SHA:** `58bd4245771235d17bd5328d10b37d1fc057367f`  
**Merge SHA:** `d2b8cac4cc6f726f26683fb4054263d7e9280096` (squash)

#### What was implemented

- ADR-15: purchaser/contact, delivery recipient (existing order-snapshot `shipping_recipient_*`), gift sender display and gift message are four separate identities; a recipient never becomes an ERP `Partner` and the sender display is never an accounting identity.
- Additive tables `commerce_gift_settings` (policy per sales channel, disabled by default, typed columns), `commerce_checkout_gifts` (1:1 open checkout) and `commerce_order_gifts` (immutable once confirmed).
- `PATCH checkout/gift` on both store/v1 and commerce/v1 with sanitized bounded plain text and policy gating; completion re-validates and snapshots inside the same idempotent transaction (`gift_unavailable` / `gift_incomplete` produce review-required with no order); workspace `GET/PUT storefronts/{id}/gift-settings`.
- Non-gift checkouts and orders are unchanged (`gift: null`).

#### Tests / CI

- `CommerceGiftIdentityTest` (16 cases), OpenAPI contract and route-boundary tests; 401 checkout/cart/order/contract tests passed locally on PostgreSQL before the push. CI sqlite, pgsql and web build green on the head.

#### Tenant isolation / backward compatibility / risks

- CompanyWide tenant-owned models with structural tenant guards; settings API returns non-revealing 404. No journal, VAT, ZATCA, inventory, pricing or numbering behaviour changed, so no posting table applies.
- No shopper or admin UI yet: gift settings and checkout UI belong to H12 and a follow-up settings slice, so the feature stays disabled for every tenant until then.

#### Next

- H4 (personalization), rebuilt on this main.

### H4 — Product personalization (text, textarea, select)

**Status:** MERGED  
**Base SHA:** `d2b8cac4cc6f726f26683fb4054263d7e9280096` (main after H3; originally cut from `9c71d236…`, rebuilt on main)  
**Branch:** `flowers/h4-personalization`  
**PR:** #1192  
**Head SHA:** `6eb9d9403b88f603ba474c3228c430c20febd25a`  
**Merge SHA:** `a4866dfd4df2fa5919e49d51ee2f846f6021b6f6` (squash)

#### What was implemented

- ADR-16: personalization is a customer input, never SKU identity (never a variant). Per-product field definitions (text, textarea, select) are validated server-side and the validated input becomes part of the cart line identity, so different card texts are separate lines and identical input merges.
- Additive tables for definitions and options, cart-line personalization (with a signature added to both partial identity indexes, existing rows unchanged) and an immutable order-line snapshot with no foreign key to the live definition (history survives edits).
- Admin `GET/PUT products/{id}/personalization`; public product detail exposes active fields only; cart add, guest-to-customer merge and checkout carry and re-validate input (`personalization_invalid` → review-required, no order); payloads gain `personalization` only on personalized lines.
- Reconciled with H3 on rebuild: checkout completion runs the gift check and loads personalizations; order creation loads both relations.
- Product lifecycle: `CommerceProductPersonalizationField` is classified `OWNED_CHILD` and removed with a true product delete.

#### Tests / CI

- `CommerceProductPersonalizationApiTest` (10 incl. lifecycle) and `CommercePersonalizationCartTest` (10); 481 registry, personalization, gift, OpenAPI contract, boundary, checkout, cart, order and catalog tests passed locally on PostgreSQL before the push. CI sqlite, pgsql and web build green on the head.

#### Tenant isolation / backward compatibility / risks

- CompanyWide tenant-owned models with structural guards; no price modifier in V1, so no financial total or tax impact and no posting table. Ordinary (non-personalized) cart and order payloads are unchanged.
- No shopper or admin UI yet, and customer image upload (H4c) is intentionally not included.

#### Next

- H5 (structured content), rebuilt on this main.

---

### H5 — Structured product content (ADR-17)

**Status:** MERGED  
**Base SHA:** `a4866dfd4df2fa5919e49d51ee2f846f6021b6f6` (main after H4)  
**Branch:** `flowers/h5-structured-content`  
**PR:** #1199  
**Head SHA:** `e409a533ba71126aeebceadfa4cf18c44081d3ca`  
**Merge SHA:** `8663d489b618c03d31439dc6ce885b6e5fb267e0` (squash)

#### What was implemented

- Merchant-authored content blocks per product (composition, care, natural variation, included items, dimensions, materials, allergens, storage, preparation notes, personalization instructions): plain text only, never HTML, ordered, individually activatable.
- Admin `GET/PUT products/{id}/content` (atomic replace, RBAC like publication); public product detail exposes active blocks only, and the key is absent when none exist.
- `CommerceProductContentBlock` is `OWNED_CHILD` and removed with a true product delete.

#### Tests / CI / risks

- API, lifecycle, isolation, public-exposure and contract tests passed locally on PostgreSQL and sqlite; CI sqlite, pgsql and web build green on the head (one unrelated `ZatcaQrCertificateMaterialExtractorTest` random-key failure was re-run once and passed).
- No admin or shopper UI yet (planned with the PDP/builder slices).

---

### H6 — Add-ons backed by real products (ADR-18)

**Status:** PR OPEN, in review  
**Base SHA:** `8663d489b618c03d31439dc6ce885b6e5fb267e0` (main after H5)  
**Branch:** `flowers/h6-addons`  

#### What was implemented

- ADR-18: an add-on is an explicit parent ⇒ real-product relation (`commerce_product_addons`); price, stock and publication always come from the add-on product's own paths. The client sends product ids and quantities only; any price field is rejected.
- Cart: each add-on is its own child line (`parent_item_id`), quantity = parent quantity × per-parent quantity (recomputed on parent update, removed with the parent, child lines cannot be edited or removed directly). The selection is folded into the parent's line signature, so different selections are separate lines and identical ones merge. Guest-to-customer merge re-adds the parent with its add-ons.
- Checkout re-validates every relation at completion (inactive relation, lowered max, unpublished add-on → `addon_unavailable`, review-required, no order); add-on stock and price are checked and resolved per line. Order lines keep `parent_line_id`; payloads gain `addon_of`/`line_id` only when add-ons exist.
- Admin `GET/PUT products/{id}/addons` (RBAC like publication, self-service denied); public product detail exposes sellable add-ons (published, priced, with availability) and the key is absent when there are none.
- Product lifecycle: the relation is `OWNED_CHILD` and cleaned when the product is either the parent or the add-on.
- Hardening carried from H4 review: the product lock in personalization/add-on replacement keeps tenant + soft-delete scopes, so a product deleted after load is a 404 instead of a foreign-key failure (tested).
- SQLite-only: adding the parent foreign key rebuilds the table and drops the partial `WHERE` of the cart identity indexes, so the migration recreates them (caught by the existing variant tests).

#### Tests

- `CommerceProductAddonApiTest` (10) and `CommerceAddonCartTest` (18); 1342 Commerce/Storefront/registry/contract/boundary tests passed on PostgreSQL and the same set on sqlite (the only local failures are `FuelSaleServiceTest`, which needs the `bcmath` extension absent from this container and is unrelated).

#### Risks

- No admin or shopper UI yet; add-on pricing has no discount modifiers in V1 (no tax or posting change; CommerceOrder is still not an Invoice).

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
