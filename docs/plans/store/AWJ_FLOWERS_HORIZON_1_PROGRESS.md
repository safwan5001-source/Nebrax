# AWJ Flowers & Gifts — Horizon 1 Progress

**Status:** IN PROGRESS — H1–H8b merged; H9a in review  
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

H1–H6 are merged (see the per-slice log below); each slice is opened only after its predecessor is merged and main is synced. One slice at a time: review → CI → merge → sync main → next.

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
| H6 | Add-ons | MERGED | #1201 | `f86d36d` |
| H7a | Delivery scheduling — policy, windows, blocked dates, derived availability, public options, admin API | MERGED | #1206 | `bbe59d1` |
| H7b | Delivery scheduling — checkout schedule, order snapshot, capacity locks, revalidation | MERGED | #1208 | `01fb179` |
| H8a | Availability / Same-day — derived promise seam, product preparation time, `commerce/v1` exposure | MERGED | #1210 | `f7c18bc` |
| H8b | Availability / Same-day — `store/v1` parity and `deliver_today` filter | MERGED | #1211 | `0ed7b6c` |
| H9a | Store Builder — data-backed section content contract (ADR-21) | PR OPEN, in review | (see log) | — |
| H9b | Store Builder — storefront renderers for the data-backed sections | NOT STARTED | — | — |
| H9c | Store Builder — builder UI (library, panels, canvas) and default-document entries | NOT STARTED | — | — |
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

**Status:** MERGED  
**Base SHA:** `8663d489b618c03d31439dc6ce885b6e5fb267e0` (main after H5)  
**Branch:** `flowers/h6-addons`  
**PR:** #1201  
**Head SHA:** `a3e78912d46a2add2a0a9ddaf4fe769295f0f31e`  
**Merge SHA:** `f86d36d453540df2ddf4bb18cc5c9b8a1d837e40` (squash)

#### What was implemented

- ADR-18: an add-on is an explicit parent ⇒ real-product relation (`commerce_product_addons`); price, stock and publication always come from the add-on product's own paths. The client sends product ids and quantities only; any price field is rejected.
- Cart: each add-on is its own child line (`parent_item_id`), quantity = parent quantity × per-parent quantity (derived, bounded to the cart limit, recomputed on parent update, removed with the parent; child lines cannot be edited or removed directly). The selection is folded into the parent's line signature. A stale relation shows as unavailable in the cart (same single check as checkout) and stays out of the subtotal.
- Checkout re-validates every relation at completion (`addon_unavailable` → review-required, no order), aggregates stock demand per (product, variant, warehouse) across all cart lines, and creates order lines linked by `parent_line_id`. Payloads gain `addon_of`/`line_id` only when add-ons exist.
- Admin `GET/PUT products/{id}/addons`; public detail exposes sellable add-ons only (variant state, required personalization and publication are checked before any price/availability resolution).
- Lock discipline: replace, cart add and checkout take product locks in one global id order (no deadlock cycle); the add-on targets are locked on replace. Hardening carried from H4: the product lock keeps tenant + soft-delete scopes (404, not an FK failure).
- Migration is SQLite-safe in both directions (the table rebuild drops partial index predicates; they are recreated in `up()` and `down()`).

#### Tests / CI

- `CommerceProductAddonApiTest` (14) and `CommerceAddonCartTest` (23). Review loop: ten Codex findings (variant state, derived-quantity overflow, stock aggregation, SQLite rollback, required personalization, target locking, three lock-ordering paths, stale cart state) each fixed with a test verified to fail without the fix; CI sqlite, pgsql green on the head, all review threads resolved.

#### Risks / deferred

- No admin or shopper UI yet. Add-on personalization input and add-on pricing modifiers are out of V1 (a required-personalization product is refused as an add-on instead). PostgreSQL lock-order tests are skipped on sqlite by design.

---

### H7a — Delivery scheduling: policy, windows, blocked dates, availability (ADR-19)

**Status:** MERGED  
**Base SHA:** `f86d36d453540df2ddf4bb18cc5c9b8a1d837e40` (main after H6)  
**Branch:** `flowers/h7-delivery-scheduling`  
**PR:** #1206  
**Head SHA:** `7515f2fa6244c6026efcc799b6010082e3b91c7a`  
**Merge SHA:** `bbe59d17cdf20f43ba0e889735cef6359dcbf2ed` (squash)

#### What was implemented

- ADR-19: scheduling is a channel-level policy layered on the existing shipping/fulfilment authorities (no second shipping model, no hard-coded marketing labels). Absent or disabled settings ⇒ no scheduling and a byte-identical checkout.
- Additive tables `commerce_delivery_schedule_settings` (enabled, required, timezone, lead time, same-day cut-off, booking horizon), `commerce_delivery_slots` (method, free-text labels, local start/end, weekday mask, optional capacity, optional shipping-zone restriction) and `commerce_delivery_blocked_dates`; all `CompanyWide` with structural guards (tenant ownership, ranges, formats; a deleted zone removes its window — fail closed).
- `CommerceDeliveryScheduleService` is the single authority: dates are calendar dates in the policy timezone (tenant timezone fallback), a window is selectable only if its start is after now + lead time, the cut-off has not passed for today, the date is not blocked for the method, the weekday matches, and for delivery the destination resolves to its zone through the existing matcher (`ShippingRateService::resolveZone`, extracted without changing the fee behaviour). Earliest fulfilment is derived.
- Public read `GET delivery-schedule` on `store/v1` (trusted domain + legacy path) and `commerce/v1` returns selectable windows only (no capacity or internal fields). Admin `GET` + `PUT settings|slots|blocked-dates` under `commerce/workspace/storefronts/{id}/delivery-schedule` (`commerce.manage`, self-service denied, channel row locked on replace).

#### Tests

- `CommerceDeliveryScheduleTest` (29 after review): derived availability with a fixed clock (same-day start, lead time boundary, cut-off, blocked dates per method, weekday mask, horizon, zone matching precedence, policy timezone vs client, inactive, required flag), admin round trip and validation, atomic replacement, RBAC and tenant isolation, model guards, public and mobile contracts. Six mutations of the availability rules were each caught.

#### Deferred to H7b / H8

- Checkout schedule selection, order snapshot, capacity enforcement under a slot row lock and completion revalidation (H7b); per-product lead time and "deliver today" eligibility (H8).

---

### H7b — Delivery scheduling: checkout selection, capacity, order snapshot (ADR-19 §2.3)

**Status:** MERGED  
**Base SHA:** `bbe59d17cdf20f43ba0e889735cef6359dcbf2ed` (main after H7a)  
**Branch:** `flowers/h7b-checkout-schedule`  
**PR:** #1208  
**Head SHA:** `449fd5bba6dff1a5dc683b5cef6740e273698c76`  
**Merge SHA:** `01fb1791318685ec035ccb4be8b2227d1b49155d` (squash)

#### What was implemented

- `PATCH checkout/schedule {date, slot_id}` (store/v1 and commerce/v1; both keys required, both `null` clears). A choice is validated by the same `CommerceDeliveryScheduleService` authority against the checkout's **stored** method and destination (checkout `standard`/`pickup` map to slot `delivery`/`pickup`) and is refused with 422 when scheduling is off or the choice is not selectable (lead time, cut-off, blocked date, weekday, zone, full slot). Nothing is reserved at selection time.
- Checkout payload gains `schedule {date, slot, valid}` only once a choice exists; a later change that invalidates it (method, destination, policy, slot edit, capacity) shows `valid: false` and forces review at completion.
- Completion re-validates before any write (`schedule_required` when the channel requires a window that exists for the chosen method, `schedule_unavailable` otherwise → `409 review_required`, no order). A method with no active window is never forced to pick a date. The schedule key joins the idempotency fingerprint only when present.
- Capacity: inside the order transaction the slot row is locked `FOR UPDATE` and confirmed `commerce_order_schedules` for (slot, date) are counted before the order schedule is written, so two checkouts cannot take the last place. The order stores an immutable snapshot (method, date, window label/times, timezone) — `CommerceOrderSchedule` rejects create/update/delete once the order is confirmed; serializers expose `schedule` only when present.
- Admin slot replacement is now id-stable (`slots.*.id` upserts in place, absent ids are removed): editing a window keeps open checkout selections and its capacity history instead of orphaning them via delete/recreate.
- Additive tables `commerce_checkout_schedules` and `commerce_order_schedules` (SQLite-safe both directions). OpenAPI updated (`PATCH /checkout/schedule`, checkout/order `schedule`).

#### Tests

- `CommerceDeliveryScheduleCheckoutTest` (21 after review; three PostgreSQL-only lock-protocol tests): scheduling-off no-op, snapshot, invalid selections, method-first/pickup windows, zone-restricted windows follow the stored destination, required/optional, post-selection changes force review, in-place window edit keeps its id, capacity at selection/completion, order-time race guard (direct call; verified to fail with the check removed), slot lock inside the transaction before the count (PostgreSQL; verified to fail with the lock removed), frozen snapshot, idempotent replay, clear, admin replace by id, web parity.

#### Review loop / CI

- Seven Codex findings (zone-aware required check, final revalidation under channel+slot locks, shared channel lock on selection, shipping-zone writers joining the lock protocol, plus earlier ones) each fixed with a test verified to fail without the fix; CI sqlite + pgsql green on the head, all threads resolved. The reviewer later hit its usage limit; no open finding remained.

#### Risks / deferred

- Per-product lead time and "deliver today" eligibility remain H8; no admin or shopper UI for scheduling yet (H9/H12).

---

### H8a — Availability / Same-day: derived delivery promise (ADR-20)

**Status:** MERGED  
**Base SHA:** `01fb1791318685ec035ccb4be8b2227d1b49155d` (main after H7b)  
**Branch:** `flowers/h8-availability`  
**PR:** #1210  
**Head SHA:** `633b9014051f2ffd977ffdde485c6169d979a4dc`  
**Merge SHA:** `f7c18bcbf235ddff5414be6bd869f9fa486746e6` (squash)

#### What was implemented

- ADR-20: the promise is derived per request from ATS + the channel schedule + product preparation time; nothing is stored. Effective lead = max(channel lead, product preparation) (not the sum).
- `commerce_product_preparations` (one row per product, absent = none; `OWNED_CHILD`, cleaned with a true delete) and admin `GET/PUT commerce/workspace/products/{id}/preparation`.
- `CommerceDeliveryScheduleService` split into `context()` (loaded once) and `evaluate()` (in memory); `options()` unchanged in behaviour. `AvailableToSellService::forWarehouseMany` / `InventoryReservationService::activeReservedMany` give batched ATS with the same definitions.
- `CommerceDeliveryPromiseService::forProducts` — constant query count regardless of products or distinct lead times; `commerce/v1` product list and detail gain `delivery_promise` only while scheduling is enabled; optional `city`/`region` select zone-restricted windows.

#### Tests / CI

- `CommerceDeliveryPromiseTest` (9) and `CommerceProductPreparationApiTest` (5); four mutations each caught. CI sqlite + pgsql green on the head; no review findings (the reviewer had reached its usage limit).

#### Deferred to H8b

- `store/v1` parity and the `deliver_today` list filter; pickup promise.

---

### H8b — Availability / Same-day: storefront parity and Deliver Today (ADR-20 §2.4)

**Status:** MERGED  
**Base SHA:** `f7c18bcbf235ddff5414be6bd869f9fa486746e6` (main after H8a)  
**Branch:** `flowers/h8b-storefront-promise`  
**PR:** #1211  
**Head SHA:** `0c6fced86aa86a9a391dddc4358e594eb5387e6c`  
**Merge SHA:** `0ed7b6cdd387b5262606e7223a144292221f943b` (squash)

#### What was implemented

- `store/v1` product list and detail expose `delivery_promise` (same service and conditions as `commerce/v1`; key absent while scheduling is off; `city`/`region` validated).
- `deliver_today=true` on both public lists via `DeliverTodayFilter`: derived (never stored), evaluated over the candidate set in constant-query chunks and applied before facet counts, sorting and pagination. Scheduling off ⇒ empty; more than 5 000 candidates ⇒ 422 (fail closed).

#### Tests

- `CommerceDeliveryPromiseTest` grew to 13: filter semantics and live changes (stock, cut-off), pagination totals, composition with search, off/invalid values, the candidate limit, and web storefront parity; four more mutations each caught.

#### Review loop / CI

- Three Codex findings (documented `true|false` boolean query values; bound the candidate query before materialising; exclude inactive variants from the promise), each fixed with a test verified to fail without the fix. One CI job failed on `ZatcaQrCertificateMaterialExtractorTest` (a byte-dependent random-key test in code this slice does not touch; it passed on a sibling run of the same commit and on re-run) — noted on the PR; the probable root cause is recorded under Risks in the final report.

#### Deferred

- Pre-computed Deliver Today index for very large catalogs; pickup promise; UI (H10/H11).

---

### H9a — Store Builder: data-backed section content contract (ADR-21)

**Status:** PR OPEN, in review  
**Base SHA:** `0ed7b6cdd387b5262606e7223a144292221f943b` (main after H8b)  
**Branch:** `flowers/h9-builder-sections`  

#### What was implemented

- ADR-21: the Horizon's candidate sections are three generic data-backed types — `productShelf` (collection or facet-value source, optional deliver-today, limit), `discovery` (facet dimension or brand), `deliveryPromise` (optional editorial text) — that store references/text only and read everything else live.
- `StorefrontPresentationNormalizer` accepts and normalizes the three types fail-closed (`HOME_DATA_SECTION_KEYS`), **without** changing the default document; both TypeScript twins (`web` and `storefront` `section-content.ts`) gained the same types, readers and normalizers.
- One shared fixture (`tests/Fixtures/presentation/data-sections.json`, 21 cases) is read by the PHP test and both TS tests, so the three normalizers cannot drift.

#### Tests

- `StorefrontPresentationDataSectionsTest` (3, PHP) and `section-content.data-sections.test.ts` (27 each in `web` and `storefront`); the existing normalizer/default-document tests are unchanged and green; a mutated limit bound is caught by the fixture.

#### Next

- H9b renders the sections in the public storefront; H9c adds the builder UI and the default-document entries (and updates the default fixtures/twins together).

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
