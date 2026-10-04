# AWJ Flowers & Gifts — Horizon 1 Final Report

**Date:** 2026-10-04
**Execution authority:** `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` · progress log: `AWJ_FLOWERS_HORIZON_1_PROGRESS.md` · per-decision records: `ADR-14` … `ADR-26` · successor: `AWJ_FLOWERS_HORIZON_2_MERCHANT_ADMIN_SURFACES.md`

```text
MERGES: PERFORMED AS AUTHORIZED
MANUAL DEPLOY: NOT PERFORMED
AUTOMATIC CI/CD DEPLOY: OBSERVED AFTER MERGES TO main
FINAL H16 RAILWAY STATE: SUCCESS on storefront, nibras-api, Nebrax and awj-scheduler
```

> Historical correction: Horizon 1 did not trigger a manual deploy, but Railway is connected to `main` and auto-deployed merged commits. Therefore the earlier wording “Production unchanged” was not factually correct. Horizon 2 must distinguish manual deploy actions from automatic CI/CD effects.

---

## 1. Executive summary

All sixteen slices (H1–H16, delivered as 23 pull requests) of the Flowers & Gifts Horizon are merged, each through the loop *inspect → research → plan → build → test → visual verify → review → PR → CI → merge → sync main*, one Flowers PR open at a time, with the evidence label discipline of the Horizon doc.

The result is a **generic, reusable Flowers & Gifts vertical** layered on Commerce — not a Nebras-specific build:

- a **business vertical** per store (`general` | `flowers_gifts`) that recommends and prepares, never locks;
- a merchant-owned **taxonomy** (occasions, recipients, any facet) and manual collections;
- **gifting identity** (purchaser ≠ delivery recipient ≠ displayed sender, plain-text card message);
- **personalization** (text / textarea / select) with a frozen order snapshot;
- **structured product content** (composition, care, allergens…);
- **add-ons backed by real products** (priced, stocked and reserved by AWJ, never invented by the storefront);
- **delivery scheduling** (date + window per channel, lead time, cut-off, blocked dates, capacity under lock) and a derived **same-day promise**;
- **Store Builder** data-backed sections, a **discovery** UX, a gifting **PDP**, **cart/checkout** stages, an **account order view**, **onboarding defaults**, and a generic **AWJ Bloom** presentation pack.

Server authority was preserved throughout: price, availability, totals, validation and idempotent completion stay on the server; Commerce posts nothing to the ledger; `CommerceOrder` is never an invoice; reservation is never a stock movement; backward compatibility held (a store with no vertical, no policy and no gifting data behaves byte-for-byte as before — covered by explicit "ordinary product is identical" tests).

**The single most important residual:** the *dashboard* has no screens for the gift policy, the delivery schedule, or per-product personalization / add-ons / content blocks — they are API-only today (§16). The features are complete and correct end to end, but a merchant cannot yet switch them on without API access. That is the recommended next Horizon (§19).

---

## 2. Final architecture

| Layer | What it owns | What it must not own |
|---|---|---|
| **AWJ ERP services** (`InventoryService`, `LedgerService`, `InvoiceService`, `PaymentService`) | stock, accounting, invoicing, ZATCA | — (untouched by this Horizon) |
| **Commerce core** (`CommerceCartService`, `CommerceCheckoutService`, `CommerceOrderService`, `AvailableToSellService`, reservations) | cart, checkout, order, ATS, reservation, idempotent completion | invoices / journal entries |
| **Flowers capabilities on Commerce** (taxonomy, gift, personalization, content, add-ons, schedule, promise, vertical setup) | merchant configuration + frozen order snapshots, all tenant-scoped (`BaseModel`/`TenantScope`) | prices, stock truth, ledger |
| **Storefront API** (`store/v1`) and **mobile API** (`commerce/v1`) | the public, server-authoritative contract | client-supplied prices/totals |
| **Store Builder / presentation** (ADR-21, ADR-26) | references + editorial text + colour | any business truth |
| **Storefront (Next.js)** | rendering and shopper interaction | creating financial/stock facts |

New tables are additive; the only change to a pre-existing behaviour is additive optional keys (`personalization`, `addon_of`, `gift`, `schedule`, `delivery_promise`, `content_blocks`, facet `meta`) that are **absent for a non-gifting store**.

---

## 3. Business Vertical behaviour (H1, H14)

- `BusinessVertical` (`general`, `flowers_gifts`) in a 1:1 side table; no row = `general`, so nothing is backfilled and unknown stored values read as `general`.
- `VerticalCapability` lists the nine recommended capabilities; as of H14 all report `available = true` (it had stayed `false` since H1).
- **H14 setup checklist** (`GET …/vertical-setup`): per capability `configured | not_configured`, **derived from real configuration** — never a stored flag. Same-day additionally requires a fulfilment warehouse (corrected in H16).
- **Starter defaults** (`GET|POST …/vertical-setup/starters`): 12 occasions + 10 recipient values, AR+EN, **additive, previewed, idempotent**, through `CommerceFacetService`; never overwrites/re-enables/duplicates merchant data; a merchant's plain facet holding the key is left untouched (`blocked`). Switching the vertical back deletes nothing (tested).
- No policy (gift, scheduling, add-ons, personalization) is ever switched on automatically.

## 4. Taxonomy model (H2, ADR-14)

Merchant-owned `commerce_facets` (any dimension; optional per-tenant-unique `system_key` ∈ {occasion, recipient}) with localized, sortable, activatable values assigned many-to-many to products, plus manual ordered collections. Disabling keeps assignments; deleting an assigned value is refused. Listing meta carries **disjunctive facet/brand counts** computed server-side. Occasion/Recipient are merchandising dimensions, **not** the delivery recipient.

## 5. Gifting identity (H3, ADR-15)

`CommerceCheckoutGift` → immutable `CommerceOrderGift` snapshot: recipient name/phone, displayed sender (optionally hidden), plain-text message normalized server-side. Per-channel policy (`CommerceGiftSetting`, off by default; message length, hide-sender, phone-required). Revalidated at completion; the purchaser contact is never overwritten.

## 6. Personalization (H4, ADR-16)

Merchant-defined per-product fields (text/textarea/select, required/optional, max length), server-validated and sanitized, part of the cart-line identity, frozen onto the order line; editing a definition after add-to-cart blocks completion with a review reason instead of silently changing the order.

## 7. Add-ons (H6, ADR-18)

Add-ons are **real products** linked to a parent: priced by `CommercePriceResolver`, stock-checked/reserved like any line, derived quantity per parent, removed with their parent, refused if a client sends a price. Cart locks parent + add-on products in one global id order (deadlock-safe).

## 8. Delivery, availability, same-day (H7, H8, ADR-19/20)

Per-channel policy (enabled/required, timezone, lead time, cut-off, horizon), windows per method with weekday mask and capacity, blocked dates; options are computed server-side in the channel's timezone; selection reserves nothing and is **re-validated at completion** with capacity under the window lock; the order keeps an immutable schedule snapshot. The **delivery promise** is *derived, not stored* (published ∧ fulfilment warehouse ∧ ATS > 0 ∧ a window after lead time/cut-off/blocks/capacity) with a constant query count (verified in H16).

## 9. Store Builder (H9, ADR-21)

Data-backed home sections (`productShelf`, `discovery`, `deliveryPromise`) store only references and editorial text; the default document is unchanged; builder UI (library, editors, canvas) and storefront renderers shipped with PHP/web/storefront normalizer twins and shared fixtures.

## 10. Storefront (H10, H11, H13, ADR-22/24)

Gifting filters on the listing (occasion → recipient → merchant facets → brand → "Deliver today", `aria-pressed` toggles, mobile collapse with removable chips); PDP blocks (delivery promise note, personalization, content, add-on picker) with a required-field gate and focus handling; account order detail shows the stored gift card and date/window and nests add-ons (still gated behind the existing account capability).

## 11. Cart / checkout (H12, ADR-23)

Personalization answers and nested read-only add-ons on every line surface; two **optional** checkout stages (date & time, gift) present only when the channel offers them — a store with neither keeps the original six stages; refusals (`schedule_*`, `gift_*`, `addon_unavailable`) route back to the right stage; review and confirmation show requested date/window and gift.

## 12. Account / saved recipient (H13, ADR-24)

Built: shared gifting snapshot on confirmation + account order detail. **Deferred with reasons:** saved recipients (storefront has no shopper identity; the commerce address book already pairs recipient + destination — reuse it, never a Flowers-only copy), re-order (needs server re-pricing), wishlist (shared capability `design_only`), fulfilment timeline (no state invented).

## 13. UX/UI decisions and evidence

Every UI slice was reviewed in a real browser (Playwright, Arabic RTL and English LTR at 390/430/1024/1440, no horizontal overflow) — screenshots under each slice's `test-results/` evidence folder and recorded in the progress log. Decisions: optional stages only when offered; plain calendar dates (no timezone guessing in the browser); never a dead end (failed reads offer retry); starter values via preview → confirm; honest "No screen yet" instead of dead links; theme previews tint with the theme's own colour; RTL logical spacing (and the `ms-*`-on-`dir=ltr` pitfall) handled.

## 14. Accessibility

Toggle buttons with `aria-pressed`/`aria-expanded`/`aria-controls`; fieldset/legend groups; `aria-invalid` + described errors on personalization; focus moves to the first unanswered required field; Bloom primary `#9d2449` has 7.55:1 contrast with white; keyboard focus verified in the H2/H1 specs. No automated a11y audit tool was run — gap noted (§17).

## 15. Tenant isolation, security, performance

- **Tenant isolation:** every new model extends `BaseModel`; every slice has cross-tenant tests (IDOR → 404, other tenants' definitions never apply); setup/starters routes are RBAC-gated (`commerce.manage`, plus `products.manage` for writes).
- **Security:** client price/total never accepted (refused with 422); plain-text normalization of all merchant/shopper text; closed allow-lists for presets and section types; no HTML.
- **Performance:** H16 verifies that everything the Horizon adds to the catalog listing (delivery promise, facets, content) is a **constant** query count regardless of product count. Observed and *not* Horizon-related: the public listing issues one `product_media` and one `product_unit_prices` query per product (§17).

---

## 16. Tests and results (exact)

- **Backend (CI, sqlite + pgsql, every PR):** last full pgsql run before H16: **5611 passed**, 1 intermittent failure (see §17); sqlite and pgsql were required green on every merged head. New suites per slice (taxonomy, gifting, personalization, add-ons, scheduling incl. Postgres concurrency, promise, vertical setup, normalizer twins) plus H16 `FlowersEndToEndJourneyTest` (full journey through the real `store/v1` API, **55 assertions**, query-count guard).
- **Storefront:** **1011** tests green at H16 (lint, `tsc`, `biome`, `check:locales` ×6 clean), including `flowers-journey-contract.test.ts` (real backend responses through the real mappers).
- **Web:** **3145** tests green at H15; web build green on every PR; Playwright specs run locally for each UI slice.
- **Local environment note:** the authoring container lacks `bcmath` and the AWS SDK, so a local full run shows environment-only failures in `Fuel*` and `ProductMedia/R2` classes — CI is authoritative and green.

## 17. CI per PR

Each PR below merged only with sqlite + pgsql + storefront + web build + both visual-QA jobs green on its head and no open review thread (the Codex review quota was exhausted late in the Horizon (no automated review on the later PRs); earlier findings were each verified, fixed with a test shown to fail without the fix, and answered).

| Slice | Branch | PR | Base SHA | Head SHA | Merge SHA (squash) |
|---|---|---|---|---|---|
| H1 | `flowers/h1-business-vertical-foundation` | #1186 | `9c71d23627` | `9419626288` | `83635d6` |
| H2a | `flowers/h2a-catalog-facets` | #1187 | `9c71d23627` | `93e9b65db1` | `fbc0eeb715` |
| H2b | `flowers/h2b-facet-storefront-filter` | #1188 | `fbc0eeb715` | `a66b77e864` | `6c085e6819` |
| H2c | `flowers/h2c-collections` | #1189 | `6c085e6819` | `acf85afe6c` | `5851d00893` |
| H2d | `flowers/h2d-merchandising-admin-ui` | #1190 | `5851d00893` | `723216f6af` | `1e8ba7055d` |
| H3 | `flowers/h3-gifting-identity` | #1191 | `1e8ba7055d` | `58bd424577` | `d2b8cac4cc` |
| H4 | `flowers/h4-personalization` | #1192 | `d2b8cac4cc` | `6eb9d9403b` | `a4866dfd4d` |
| H5 | `flowers/h5-structured-content` | #1199 | `a4866dfd4d` | `e409a533ba` | `8663d489b6` |
| H6 | `flowers/h6-addons` | #1201 | `8663d489b6` | `a3e78912d4` | `f86d36d453` |
| H7a | `flowers/h7-delivery-scheduling` | #1206 | `f86d36d453` | `7515f2fa62` | `bbe59d17cd` |
| H7b | `flowers/h7b-checkout-schedule` | #1208 | `bbe59d17cd` | `449fd5bba6` | `01fb179131` |
| H8a | `flowers/h8-availability` | #1210 | `01fb179131` | `633b901405` | `f7c18bcbf2` |
| H8b | `flowers/h8b-storefront-promise` | #1211 | `f7c18bcbf2` | `0c6fced86a` | `0ed7b6cdd3` |
| H9a | `flowers/h9-builder-sections` | #1212 | `0ed7b6cdd3` | `7a610ff597` | `5f34585b2c` |
| H9b | `flowers/h9b-storefront-sections` | #1213 | `5f34585b2c` | `1bb906dbc3` | `c90f7587eb` |
| H9c | `flowers/h9c-builder-ui` | #1216 | `c90f7587eb` | `17e1a8358e` | `4bb8d17852` |
| H10 | `flowers/h10-discovery-ux` | #1217 | `4bb8d17852` | `5bd3ab50f7` | `6e98a01192` |
| H11 | `flowers/h11-pdp` | #1218 | `6e98a01192` | `54f1079482` | `6c7b81eb75` |
| H12 | `flowers/h12-cart-checkout-gifting` | #1219 | `6c7b81eb75` | `a511733652` | `1f15d5f421` |
| H13 | `flowers/h13-account-order-gifting` | #1220 | `1f15d5f421` | `25dbe49f32` | `52e1096dd8` |
| H14 | `flowers/h14-vertical-onboarding` | #1221 | `52e1096dd8` | `2ea23977e6` | `064a91e7df` |
| H15 | `flowers/h15-bloom-presentation` | #1222 | `064a91e7df` | `0c3f183de1` | `b1eb5ba6f8` |
| H16 | `flowers/h16-integration` | this PR | `b1eb5ba6f8` | — (this PR) | — (squash of this PR) |

Full SHAs:

- H1 (#1186): base `9c71d236272f2ab92b99a27b5278dd38150b279e` · head `941962628874c9d2a0e970fbde8c1e6a7ff7f808` · merge `83635d6`
- H2a (#1187): base `9c71d236272f2ab92b99a27b5278dd38150b279e` · head `93e9b65db1765d7dd50d2eb7b8ea3d8cb38f5194` · merge `fbc0eeb715e92dc955b958a3fdb86bf0a1b8a0b9`
- H2b (#1188): base `fbc0eeb715e92dc955b958a3fdb86bf0a1b8a0b9` · head `a66b77e864e80f1461d6ab404f8d21222f91931a` · merge `6c085e6819b563a45702a6bf0a45084de16130a2`
- H2c (#1189): base `6c085e6819b563a45702a6bf0a45084de16130a2` · head `acf85afe6cb02afcc223a0e4e1220e3d0f8e3389` · merge `5851d00893689ae29e1b94075e1de45f35827dea`
- H2d (#1190): base `5851d00893689ae29e1b94075e1de45f35827dea` · head `723216f6afc7246f5be75564259fa08db337404a` · merge `1e8ba7055d73db29770e307ad9b1f7f01fbe1cbb`
- H3 (#1191): base `1e8ba7055d73db29770e307ad9b1f7f01fbe1cbb` · head `58bd4245771235d17bd5328d10b37d1fc057367f` · merge `d2b8cac4cc6f726f26683fb4054263d7e9280096`
- H4 (#1192): base `d2b8cac4cc6f726f26683fb4054263d7e9280096` · head `6eb9d9403b88f603ba474c3228c430c20febd25a` · merge `a4866dfd4df2fa5919e49d51ee2f846f6021b6f6`
- H5 (#1199): base `a4866dfd4df2fa5919e49d51ee2f846f6021b6f6` · head `e409a533ba71126aeebceadfa4cf18c44081d3ca` · merge `8663d489b618c03d31439dc6ce885b6e5fb267e0`
- H6 (#1201): base `8663d489b618c03d31439dc6ce885b6e5fb267e0` · head `a3e78912d46a2add2a0a9ddaf4fe769295f0f31e` · merge `f86d36d453540df2ddf4bb18cc5c9b8a1d837e40`
- H7a (#1206): base `f86d36d453540df2ddf4bb18cc5c9b8a1d837e40` · head `7515f2fa6244c6026efcc799b6010082e3b91c7a` · merge `bbe59d17cdf20f43ba0e889735cef6359dcbf2ed`
- H7b (#1208): base `bbe59d17cdf20f43ba0e889735cef6359dcbf2ed` · head `449fd5bba6dff1a5dc683b5cef6740e273698c76` · merge `01fb1791318685ec035ccb4be8b2227d1b49155d`
- H8a (#1210): base `01fb1791318685ec035ccb4be8b2227d1b49155d` · head `633b9014051f2ffd977ffdde485c6169d979a4dc` · merge `f7c18bcbf235ddff5414be6bd869f9fa486746e6`
- H8b (#1211): base `f7c18bcbf235ddff5414be6bd869f9fa486746e6` · head `0c6fced86aa86a9a391dddc4358e594eb5387e6c` · merge `0ed7b6cdd387b5262606e7223a144292221f943b`
- H9a (#1212): base `0ed7b6cdd387b5262606e7223a144292221f943b` · head `7a610ff597414f4d5d2f0fd688e2be4174fb0eeb` · merge `5f34585b2cd84e41360b9b9fa7f7250cdd0d1c0a`
- H9b (#1213): base `5f34585b2cd84e41360b9b9fa7f7250cdd0d1c0a` · head `1bb906dbc396b91864ce44ecdee5cb562e0b362f` · merge `c90f7587ebfac8e5df1e13b64758641bb2ed60ea`
- H9c (#1216): base `c90f7587ebfac8e5df1e13b64758641bb2ed60ea` · head `17e1a8358ef2ac6132290303b60ef05c1b424254` · merge `4bb8d17852c8a618f826c35120c31d2f39a9c4ee`
- H10 (#1217): base `4bb8d17852c8a618f826c35120c31d2f39a9c4ee` · head `5bd3ab50f7322efe3f676c33857c618b6903c21c` · merge `6e98a011926f4abd990610d1bd9ee9027e82b7d2`
- H11 (#1218): base `6e98a011926f4abd990610d1bd9ee9027e82b7d2` · head `54f1079482f9be89341a9350bfd48757cbced5c0` · merge `6c7b81eb756dfffc82afa6a4d8a37135a9c94919`
- H12 (#1219): base `6c7b81eb756dfffc82afa6a4d8a37135a9c94919` · head `a5117336521a07d3c76804561af5f1c33083e653` · merge `1f15d5f421203fcd1d6707dfd05ef28205786b4c`
- H13 (#1220): base `1f15d5f421203fcd1d6707dfd05ef28205786b4c` · head `25dbe49f3293a89ecda64d27d2e93af7e3520e64` · merge `52e1096dd8a571081ae727d98c2c66f7bf83d126`
- H14 (#1221): base `52e1096dd8a571081ae727d98c2c66f7bf83d126` · head `2ea23977e6067cddd5be0f2c86c84312ef18bf34` · merge `064a91e7df3d31962758364911608e1f8631e114`
- H15 (#1222): base `064a91e7df3d31962758364911608e1f8631e114` · head `0c3f183de1d245a67de2ca0e4fb3dd8202051839` · merge `b1eb5ba6f85a0b7872f85d42a92d5b58ed0860ef`
- H16: this PR.

Observed CI events (all outside Horizon scope, none masked):
- `ZatcaQrCertificateMaterialExtractorTest` — intermittent (random EC coordinate may lose a leading zero byte); re-run once, not changed.
- `published footer visual QA` — one transient 404 on `/sa/en` for the first head of #1213; not reproducible locally, passed on the next head; **not root-caused**.
- `StorefrontCategoryPublicationTest::category_publication_is_independent_per_sales_channel` — intermittent on pgsql in #1222; **root-caused and fixed in H16** (two same-second web channels tied on `created_at` in the legacy resolver).

## 18. Changed areas (all slices)

Backend: `app/Models` (facets, collections, gift, personalization, content, add-ons, schedule/slot/blocked-date, order snapshots, business profile), `app/Services/Commerce/*` (facet, collection, gift, personalization, content, add-on, schedule, promise, preparation, vertical setup), `app/Support/Commerce/*` (vertical, capability, starter catalog, presentation normalizer), controllers/requests/resources, `routes/api*.php`, migrations (additive). Web: commerce workspace (stores, merchandising, vertical setup, themes), store-experience builder (sections, presets, flowers pack). Storefront: listing, PDP, cart, checkout, confirmation, account, presentation. Docs: `ADR-14`…`ADR-26`, this report, progress log. CI/setup: `contracts/flowers-journey` added to `setup.sh` and `ci.yml`, storefront CI path filter. **Not touched:** ledger, VAT, ZATCA, invoices, inventory valuation, payments, production configuration.

---

## 19. H16 — cross-horizon integration review (this PR)

Method: a full journey through the **real** `store/v1` API (taxonomy → content → personalization → add-ons → gift → schedule → cart → checkout → completion → order) captured as a shared contract (`contracts/flowers-journey/*.json`), compared against live responses on every backend CI run, and parsed by the storefront's real mappers in the storefront CI. Findings (all fixed here):

1. **Storefront dropped hyphenated personalization keys** (e.g. `card-name`) — the admin API stores slug keys, the storefront accepted only underscores — so a *required* field vanished and the shopper could not add the product. Fixed to the API rule; unit + contract tests.
2. **H14 reported "Deliver today" as set up** with windows alone; it also needs a fulfilment warehouse (else every promise is `not_configured`). Fixed + tested.
3. **Intermittent pgsql failure** from a non-deterministic "oldest web channel" tie in the legacy storefront resolver. Deterministic tie-break + test made explicit.
4. **Query-count guard** proving the Horizon's catalog additions are constant per request.

Reviews performed with no change required: tenant isolation (every new model/route), backward compatibility (non-gifting responses unchanged), RTL/LTR and mobile (slice evidence), docs consistency.

## 20. Risks and deferred domains

**Risks**
1. **Adoption gap (high):** no dashboard screens for gift policy, delivery schedule (settings/windows/blocked dates), or per-product personalization / add-ons / content blocks — API-only. The H14 checklist says so honestly.
2. Public listing issues two queries per product (`product_media`, `product_unit_prices`) — pre-existing, catalog-wide.
3. Real-API journey is verified on `store/v1`; `commerce/v1` (mobile) is covered by per-slice tests, not by the shared contract.
4. Account order detail stays gated by `ACCOUNT_ORDER_LOOKUP_CAPABILITY`.
5. No automated accessibility audit; transient CI 404 of #1213 not root-caused.

**Deferred high-risk / evidence-gated domains (not implemented, by design):** bundles and bouquet composition, per-recipient addresses and recipient notification, no-address gifting, customer file upload for personalization, saved recipients, re-order, wishlist, online/card payment, fees/VAT on gateways, seasonal presets, Nebras-specific styling or behaviour, App Builder/mobile gifting UI.

## 21. Successor Horizon — Flowers Merchant Admin Surfaces

The successor is now formally defined by:

- `AWJ_FLOWERS_HORIZON_2_MERCHANT_ADMIN_SURFACES.md` — authoritative autonomous execution plan;
- `AWJ_FLOWERS_HORIZON_2_PROGRESS.md` — required per-slice progress ledger.

Horizon 2 closes the merchant-adoption gap with a mandatory UI/UX quality gate for every admin surface: Gift Policy, Delivery Scheduling, Windows/Capacity, Blocked Dates, Fulfillment Warehouse, Product Preparation, Personalization, Add-ons, Structured Content, unified Product Gifting workspace, Setup Center V2, onboarding, RBAC/Tenant Isolation, cross-surface RTL/mobile polish, a real merchant journey contract, and final integration/reporting.

---

**MERGES: PERFORMED AS AUTHORIZED · MANUAL DEPLOY: NOT PERFORMED · AUTOMATIC RAILWAY DEPLOY: OBSERVED AND SUCCESSFUL FOR FINAL H16 SHA**
