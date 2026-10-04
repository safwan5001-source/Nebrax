# CUST-H4 — Horizon Closure Report: Section Library & Section Quality

| | |
|---|---|
| **Horizon** | CUST-H4 — Section Library & Section Quality (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md:585-646`) |
| **Closure date** | 2026-10-04 |
| **Repository** | `safwan5001-source/Nebrax` |
| **Final merged verification SHA** | `27a8049c5254794f49031e841d4a2549aab7e4cf` — `origin/main`, PR #1226, "qa(store): CUST-H4-8 verification rerun after H4-8b — READY FOR H4 CLOSURE" |
| **This closure task's Base SHA** | `27a8049c5254794f49031e841d4a2549aab7e4cf` (verified via `git fetch origin main` + `git rev-parse origin/main`, matches the task's expected SHA exactly) |
| **Task type** | Documentation / closure only. No application code, schema, API, pricing, accounting, checkout, POS, tenant logic, or storefront runtime file was read for modification or changed by this task. |
| **Merge / Deploy / Production** | **None.** This closure PR is not merged, nothing is deployed, nothing is released to production. |

---

## 1. Executive Summary

CUST-H4 set out to turn AWJ's ten-section homepage registry into a real merchant content toolbox — a searchable, honestly-stated Section Library over sections that are genuinely LIVE end-to-end (typed content, server normalization, real Canvas and Published renderers, real data, parity, tenant isolation), not a set of fake toggles.

Across ten merged slices (H4-1 through H4-8, plus the H4-8b blocker fix and the H4-8 verification rerun), AWJ:

- Formalized a `state`-aware Section Library/Picker (search, taxonomy, honest badges) over the existing section-instance architecture.
- Closed the Canvas↔Published preview gap on `categories`/`newArrivals` by wiring Canvas to the already-shipped tenant-scoped catalog read API, replacing a labeled mock fixture.
- Built a real multi-select product picker and a batched products-by-ids read for `featured`, replacing a raw ID text box and N unbatched fetches.
- Built `offers` as a real, bounded Commerce-referencing capability — a new `storefront_offers` curation/scheduling table (zero price/discount columns) plus a `StorefrontOfferResolver` service that resolves live prices through the existing, already-trusted `CommercePriceResolver`/`Product.sale_price` path — rather than closing it `GATED` as the original decision packet had concluded. This reverses that earlier decision under an explicit owner correction recorded in the architecture contract (`CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md`, Revision Notes 1–2).
- Found, during integrated real-stack QA (H4-8), a genuine cross-section blocker (B1: Canvas `<img>` tags pointed at the mobile-only, bearer-gated media route and rendered broken images for New Arrivals, Featured, and Offers alike), stopped, and escalated it rather than silently working around it.
- Resolved B1 in a dedicated slice (H4-8b) with a short-lived signed workspace media route, independently verified on the real stack, and reconfirmed in the H4-8 rerun with zero regressions to the public/mobile media routes' existing isolation guarantees.

The final, merged verification verdict (H4-8 rerun, §17.14 of `CUST-H4-8-INTEGRATED-QA-REPORT.md`) is:

> **READY FOR H4 CLOSURE**

This report formalizes that closure.

---

## 2. Closure Verdict

**CUST-H4 is CLOSED.**

All ten merchant-visible homepage sections are **LIVE**: real typed/config-sourced content where applicable, real server-side normalization, real Canvas renderer, real Published renderer, real data source, verified Canvas↔Published parity, and no fake/mock/gated merchant-visible section remains. The one genuine blocker found during integrated QA (B1, Canvas product media) was fixed and independently re-verified against the real stack before this verdict was reached.

**Remaining H4 Blockers: NONE.**

This verdict is supported directly by the merged evidence chain in §4 and the section-by-section state in §5 — it is not asserted independently of that evidence.

---

## 3. Scope Closed

In scope and closed by this Horizon:
- Section Library / Picker UX: search, 7-category taxonomy, honest per-type state badges, already-added/max-instance states (H4-2).
- Canvas real-catalog parity for `categories`/`newArrivals` (H4-3).
- Polish completion for `banner` (`imageAlt`), `appPromo` (inline Content-tab authoring) (H4-4).
- `featured`: real multi-select product picker + batched published-side products-by-ids read (H4-5).
- `offers`: bounded, real Commerce-referencing capability — backend (H4-6) and Canvas/Published UI (H4-7).
- Integrated cross-cutting QA: responsive, RTL/LTR, accessibility, tenant isolation, parity, performance (H4-8).
- Canvas product-media blocker fix (H4-8b) and its independent real-stack re-verification (H4-8 rerun).

Explicitly **not** in scope for CUST-H4, and not claimed as done here (deferred per the roadmap's own horizon boundaries, `AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` §§7, 20):
- Theme copies / scheduled publication (CUST-H1).
- Multi-page visual builder — product/category/informational pages, Header/Footer direct editing (CUST-H2).
- Store Identity Studio additions beyond what CUST-H3 already closed.
- Undo/Redo, version restore, unsaved-change recovery policy (CUST-H5).
- Advanced extensibility — custom CSS/JS, section developer SDK, theme packages (CUST-H6).
- A managed tenant-scoped section-media upload object for banner/hero images (explicitly deferred past H4, `CUST-H4-ARCH-1...md` §24) — the existing https-URL-only contract remains sufficient and safe for H4 closure.
- A broader Commerce promotions/discount/campaign engine — Offers closed as a thin, bounded curation+display layer over already-authoritative pricing, not an engine; ADR-11's deferral of a full promotions engine stands unchanged and unreopened.

---

## 4. Evidence Chain

All ten SHAs below were independently re-verified for this closure task (not copied blindly from the task brief) via `git fetch origin main` (unshallowed to full history) followed by `git cat-file -e <sha>` (object exists) and `git merge-base --is-ancestor <sha> origin/main` (ancestor of current main). Every SHA matched its claimed PR number and subject line exactly.

| Slice | PR | SHA | Subject (verified via `git log`) | Ancestor of `origin/main`? |
|---|---|---|---|---|
| H4-1 | #1150 | `b6024bd25a826e3800238d9c3ea1c62920001614` | `docs(store): define CUST-H4 section library and activation contract (#1150)` | ✅ |
| H4-2 | #1154 | `de8eee89e838c25d14f1e7c2064eff1d1720c633` | `feat(store): build CUST-H4 Section Library (H4-2) (#1154)` | ✅ |
| H4-3 | #1167 | `30ead922dbaf40a20bd7b10ac839876310e0de18` | `feat(store): use real catalog data in H4 Canvas (#1167)` | ✅ |
| H4-4 | #1172 | `241a06f87a61ff2d006e0758c1776abd9c815a71` | `feat(store): complete H4 content sections (#1172)` | ✅ |
| H4-5 | #1197 | `513ced7e3c51480053a508e23be81759b45a9f8e` | `feat(store): activate Featured Products in H4 (CUST-H4-5) (#1197)` | ✅ |
| H4-6 | #1202 | `f73e5b0ed568bdb38b514cf2385d321d65594d17` | `feat(store): add H4 real offers backend (#1202)` | ✅ |
| H4-7 | #1209 | `0ac176ae0d39986c17bdda706809107dedab1923` | `feat(store): activate H4 offers end-to-end (#1209)` | ✅ |
| H4-8 (integrated QA) | #1215 | `c5b89c2b84e3dde6dca586f012298b2c0a26675d` | `qa(store): CUST-H4-8 integrated QA report + real-stack harness (#1215)` | ✅ |
| H4-8b (media fix) | #1224 | `5264d531071bb081f3b0c0dc4a42931761332e0e` | `fix(store): authorize product media for H4 Canvas (#1224)` | ✅ |
| H4-8 verification rerun | #1226 | `27a8049c5254794f49031e841d4a2549aab7e4cf` | `qa(store): CUST-H4-8 verification rerun after H4-8b — READY FOR H4 CLOSURE (#1226)` | ✅ (this is `origin/main` HEAD) |

Linear ancestry (`git merge-base --is-ancestor`) confirms each slice built on the previous one in the stated order, ending at the current `origin/main` tip. No SHA in the task brief was found to be incorrect; all ten matched on first verification.

---

## 5. Section-by-Section Final State

Per the architecture contract's truth matrix (`CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §5) and the H4-8/H4-8-rerun integrated QA reports, re-confirmed against real-stack evidence (real Laravel, real `web/`, real `storefront/`, real Chromium, real seeded data — not component fixtures):

| Section | LIVE | Merchant-addable | Real data / real contract | Canvas supported | Published supported |
|---|---|---|---|---|---|
| **hero** | ✅ | ✅ (singleton, disabled once added) | ✅ global config fields, server-normalized | ✅ real authored text | ✅ real render |
| **categories** | ✅ | ✅ (singleton) | ✅ real tenant-scoped catalog read (`commerce/workspace/storefronts/{id}/categories`) | ✅ wired to real data in H4-3 (mock `PREVIEW_CATEGORIES` fixture retired for this purpose) | ✅ real catalog read |
| **newArrivals** | ✅ | ✅ (singleton) | ✅ real tenant-scoped catalog read (`commerce/workspace/storefronts/{id}/products`) | ✅ wired to real data in H4-3; also carries the H4-8b signed media fix | ✅ real catalog read |
| **wholesale** | ✅ | ✅ (singleton) | ✅ addon-flag-gated, intentionally static text | ✅ placeholder text by design | ✅ real `isWholesaleEnabled()` gate |
| **banner** | ✅ | ✅ (unlimited, duplicable) | ✅ typed `BannerContent`, sanitized URLs | ✅ real authored content | ✅ real render, omitted when empty |
| **featured** | ✅ | ✅ (unlimited, duplicable, max 8 products) | ✅ typed `FeaturedContent{productIds}`, real multi-select picker (H4-5), batched `ids[]` published read | ✅ real picker + H4-8b signed media | ✅ real batched read, real render |
| **offers** | ✅ | ✅ (unlimited, duplicable, max 8 offers) | ✅ `storefront_offers` (curation/scheduling only) + `StorefrontOfferResolver` over `CommercePriceResolver`/`Product.sale_price` — real, live-resolved pricing, zero stored discount facts | ✅ real workspace CRUD + picker + H4-8b signed media | ✅ real Host-resolved public read (`GET /store/v1/offers`) |
| **benefits** | ✅ | ✅ (unlimited, duplicable, max 6 items) | ✅ typed `BenefitsContent{items}` | ✅ real authored items | ✅ real render, omitted when empty |
| **appPromo** | ✅ | ✅ (singleton) | ✅ real merchant-entered, validated app-store URLs (`config.apps`); H4-4 added inline Content-tab authoring | ✅ real badges when valid | ✅ real render, `null` when no valid URL |
| **customContent** | ✅ | ✅ (unlimited, duplicable, max 8 blocks) | ✅ typed `CustomContent{blocks}`, closed to `heading`/`paragraph` kinds only — no HTML/iframe/embed | ✅ real authored blocks | ✅ real render, omitted when empty, accordion variant on `awj-market` |

No section in this table is a fake, mock, or gated placeholder as of H4 closure. `GATED_HOME_SECTION_KEYS` no longer lists `offers` (confirmed by the H4-8/H4-8-rerun Section Library matrix check: "all `state: 'live'`, `merchantAddable: true`" across all ten keys, "no stale gated/'coming soon' copy anywhere").

---

## 6. Offers Final Architecture

Documented in full in `CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §23 and verified end-to-end in H4-6/H4-7/H4-8/H4-8-rerun:

- A real `storefront_offers` backend table exists: `{id, tenant_id, storefront_id, product_id, starts_at, ends_at, is_active, position, timestamps}` — **zero** price/discount/percent columns.
- Offers are curation and scheduling only, never an independent pricing engine. The table cannot express a discount; it can only say "consider this product, optionally within this window."
- The real, authoritative price remains **`CommercePriceResolver`** — the same already-shipped, read-only service that powers real Cart V1 checkout lines. Offers calls it with no new pricing logic.
- The reference price is **`Product.sale_price`** — the product's own real public base price.
- The discount percent shown is backend-derived fresh on every read (`(reference − offer) / reference × 100`), never stored, never computed client-side.
- ATS/fulfillment gating remains authoritative: a product with zero available-to-sell stock, an inactive/unpublished product, or a variant-managed product is never shown as a live offer, regardless of configuration (fail-closed, confirmed by `ats-pricing.php` scenario matrix in both H4-8 and its rerun).
- **No Cart/Checkout/POS/Invoice pricing logic was changed.** `LedgerService`, `InvoiceService`, cart totals, and checkout's amount-due computation were not touched by any H4 slice.
- The merchant can create, edit, deactivate/reactivate, reorder, and delete Offers from the real builder UI, verified against the real API (21/21 merchant-flow assertions passing in both H4-8 and its rerun).
- Section instances store only `OffersContent{offerIds}` — references only, max 8, no price/discount/name/image/live-state ever persisted in presentation JSON (confirmed by regex check against the real saved config in both QA passes).
- Multiple Offers section instances on the same page remain independent (verified: S1 and S2 with different offer sets and orders, one shared deactivation updates both canvases' selection state correctly without merging the instances).
- Canvas and Published both resolve through the same `StorefrontOfferResolver` service, each from its own correctly-scoped authority boundary (workspace `ownedStorefront()` for Canvas, Host-resolved `ResolveStorefrontDomain`/`StorefrontContext` with no storefront id in any public parameter for Published) — parity is structural, not just tested-after-the-fact, and was re-confirmed data-for-data in both QA passes.
- Hidden, missing, deleted, or no-longer-genuinely-discounted offers are omitted honestly — never faked, never shown with a stale or invented discount (confirmed across both QA passes' hide/delete/deactivate/ATS-change scenarios).
- All 8 tenant-isolation/host-authority tests specified in the architecture contract (§30) were implemented and pass; real-stack Host-resolution isolation (cross-storefront, cross-tenant, unverified domain, forged query params, forged `X-Tenant-Id` header) was independently re-verified via real HTTP requests with real `Host` headers in both H4-8 and its rerun.

---

## 7. Featured / New Arrivals Final State

**Featured:**
- Real multi-select product picker, built on the existing tenant-scoped `commerce/workspace/storefronts/{id}/products` read (H4-5) — not a new endpoint, reusing the data layer CUST-H2 already shipped.
- Saved order is authoritative: section content stores only `productIds` (max 8) in array order; Published renders in that exact order.
- Invalid, missing, deleted, and inactive products are omitted, never faked — confirmed in both QA passes (a bogus id string and a deactivated product were both correctly dropped by the normalizer/renderer, order preserved for the remaining valid ids).
- Real Canvas rendering (with the H4-8b signed media fix) and real batched Published rendering (`ids[]` filter on `StorefrontProductController::index`, replacing the original N-unbatched-fetch pattern).

**New Arrivals:**
- Real catalog data on both sides: Published already read `cachedListProducts(...).sort:-available_on` pre-H4; Canvas was wired in H4-3 to the real tenant-scoped `commerce/workspace/storefronts/{id}/products` read, retiring the `PREVIEW_PRODUCTS` mock fixture for this purpose.
- Real Canvas + Published rendering confirmed, including the H4-8b signed media fix for Canvas thumbnails.

---

## 8. Canvas Product Media Resolution

**B1 is resolved.**

- **Root cause** (found in H4-8 integrated QA): workspace product/offer read endpoints built `thumbnail_url`/`media[].url` via the mobile-only, bearer-gated `/commerce/v1/media/{id}` route. A plain `<img src>` tag in the merchant web app cannot attach an `Authorization` header, so every Canvas image request returned `401` → `net::ERR_BLOCKED_BY_ORB` → a broken-image glyph. This affected New Arrivals, Featured, and Offers Canvas previews identically, since all three share the same workspace product payload shape.
- **Fix** (H4-8b): a new, short-lived (20-minute) signed workspace media route (`GET /commerce/workspace/storefronts/{id}/media/{media}?expires=…&signature=…`), using Laravel's own `temporarySignedRoute()` — no new cryptography, no bearer token in the URL, no blob-fetch/JS-hydration layer (which would have reintroduced an N+1 pattern). Authority is enforced twice independently: the unforgeable, time-boxed signature, and the controller's own fresh tenant/channel-publication re-check against the database.
- **Independent re-verification** (H4-8 rerun, §17.1): real Playwright/Chromium browser, real `<img>` tags, zero `Authorization` header sent, `200` responses, real decoded images (`naturalWidth=64, complete=true`) on all three Canvas surfaces (New Arrivals, Featured, Offers).
- **Workspace-authorized signed URLs are used for Canvas** exactly as required — not the public `/store/v1/media` route and not the mobile bearer-gated `/commerce/v1/media` route.
- **New Arrivals / Featured / Offers images load in Canvas** — confirmed individually for each surface in the rerun, with screenshots inspected (not committed) at desktop and mobile widths.
- **Tenant/storefront/publication isolation preserved**: `CommerceWorkspaceMediaApiTest` (13 tests, 45 assertions) proves cross-tenant media cannot be loaded even with a validly-signed URL for a foreign tenant, media not published on the resolving storefront's own sales channel is rejected (including a sibling storefront of the same tenant), expired signatures return `403`, tampered parameters with a reused signature return `403`, and all failure paths return uniform non-revealing `404`/`403` responses.
- **Public storefront media behavior remains intact**: `/commerce/v1/media` (mobile) and `/store/v1/media` (public) are byte-for-byte unchanged — proven by their existing, unmodified test suites (`CommerceMediaApiTest`, `ProductMediaR2CommerceStorefrontReadTest`, `StorefrontDomainMediaVisibilityTest`) passing without modification after a shared-trait extraction that changed no observable behavior.

---

## 9. Tenant / Storefront Isolation

Confirmed at both the schema level and the application/request level, re-verified against the real stack in H4-8 and independently re-run in the H4-8 rerun:

- Host-based resolution (`a.h48.test`, `b.h48.test`, `foreign.h48.test`) returns only that storefront's own offers/sections — no cross-storefront or cross-tenant leakage observed in either pass.
- An unverified or unknown hostname fails closed with a uniform, non-revealing `404`.
- Client-supplied `?storefront_id=`/`?tenant_id=`/`X-Tenant-Id` parameters on an otherwise-valid request are ignored — the resolved Host remains the sole authority.
- The one supported alternate-hostname path (`X-Storefront-Forwarded-Host` + `X-Storefront-Gateway-Secret`) requires the correct server-only secret; a wrong or missing secret falls back to the real Laravel-visible host exactly as if no header were sent.
- Workspace media (H4-8b) adds a second, independent isolation boundary (signature + fresh controller-side tenant/channel re-check) proven by 13 dedicated tests, re-confirmed in the rerun with no guard weakened.
- A `storefront_offers` row referencing a foreign-tenant `product_id` cannot resolve or leak — the same `BaseModel` tenant-scope failure mode `Featured`'s `productIds` already relied on.

---

## 10. Canvas ↔ Published Parity

Confirmed data-for-data in both H4-8 and the H4-8 rerun for every H4-target section:

- **Offers**: Canvas order (`A2, A` for S1, `A, A2` for S2) matched Published order exactly; hidden/deleted/deactivated offers disappeared from both surfaces together; prices matched exactly (Canvas Latin digits vs. Published Arabic-Indic digits — a pre-existing, documented, non-blocking localization-formatting difference, not a data discrepancy).
- **Featured**: configured set `[C, A, D(inactive), "not a valid id!"]` rendered as `[C, A]` in saved order on both Canvas and Published — the inactive product and the bogus id were dropped identically on both sides.
- **Categories / New Arrivals**: Canvas wired to the same real tenant-scoped catalog read Published already used (H4-3), closing the pre-existing mock-vs-real gap.
- **Banner / Benefits / Custom Content / App Promo**: rendered identically on both sides through the real save→publish path; only intentional, documented chrome differences remain (e.g., Canvas shows an empty-state placeholder for a not-yet-configured section; Published omits an empty section entirely).
- One cosmetic, pre-existing, non-blocking copy difference was noted (Featured section heading reads differently in Canvas vs. the storefront, a labeling choice from H4-5, not a data or parity defect) and is recorded here rather than silently dropped.

---

## 11. Save / Reload / Publish

Verified against the real save/publish API and a real full page reload, in both H4-8 and the rerun:

- `Save draft` → full page reload → section content and order persisted exactly, for both single and multiple Offers/Featured instances.
- `Publish` via the real publish dialog succeeded with no faked step; the published version became read-only afterward, consistent with the existing "create draft from published" design.
- **Draft content never leaked to Published before an explicit publish**: a draft-only change (removing an offer from one section instance) was confirmed absent from the live Published read via two independent methods — a real browser read of the storefront, and a direct backend `fetch()` to `GET /store/v1/offers` bypassing the browser/Next.js layer entirely. Both methods agreed the published state was unchanged until the explicit publish action was taken.

---

## 12. ATS / Pricing Integrity

Re-verified against the real database and the real public endpoint in both QA passes:

- `CommercePriceResolver`'s resolved amount for a test product matched the public API's `offer_price` exactly, and independently matched the real Cart V1 checkout line's `unit_price` for the same product (confirmed by the H4-6 test suite) — one single source of pricing truth, never duplicated or recomputed differently for display.
- Products with zero available-to-sell stock (fully reserved) were correctly omitted from live offers, and correctly reappeared once stock was released — re-tested through multiple reserve/release cycles.
- Products with no genuine discount (price-list price equal to base price) were correctly never shown as an offer.
- Inactive/unpublished products were correctly omitted.
- Variant-managed products were correctly, fail-closed, excluded from Offers (the create API itself rejects them; a directly-inserted row for testing purposes was still excluded from the live resolution).
- **No Cart, Checkout, POS, or Invoice pricing/ledger logic was read for modification or changed by any H4 slice.**

---

## 13. Responsive / Accessibility

- **Responsive**: real browser checks (not code-reading alone) at AR/EN widths 390, 430, 768, 1024, 1280, 1440 for Canvas, the Bottom Sheet CRUD surfaces, and the Published storefront — zero document/dialog overflow observed at any tested width in either QA pass, except a pre-existing, independently baseline-confirmed builder-header overflow at 768/1024 when the draft is dirty (reproduced identically on the pre-H4-7 baseline commit, confirming it is not an H4 regression; left unfixed per the QA task's own instruction not to fix unrelated pre-existing issues).
- **Accessibility**: edit/delete controls carry accessible, product-named labels; every offer/section row states its live/hidden status in text, never color alone; `aria-labelledby` landmarks resolve uniquely per section; opening an edit form moves focus to its heading and `Escape` restores focus to the opener; delete confirmation dialogs are named `alertdialog`s with `Cancel` focused first; forms render `dir="rtl"`; product images in both Canvas and Published are correctly marked decorative (`alt=""`) with the product name present as adjacent text. No screen-reader (assistive-technology) pass was performed — no AT was available in the QA sandbox; this gap is recorded honestly rather than claimed as covered.

---

## 14. Test / CI Evidence

From the H4-8 rerun (the most current, final verification pass; see `CUST-H4-8-INTEGRATED-QA-REPORT.md` §17.11 for full detail):

| Suite | Result |
|---|---|
| `CommerceWorkspaceMediaApiTest` (new, H4-8b) | 13 passed, 45 assertions |
| `CommerceMediaApiTest` + `ProductMediaR2CommerceStorefrontReadTest` (existing, unmodified) | 15 passed, 38 assertions |
| `StorefrontDomainMediaVisibilityTest` | 5 passed |
| Commerce workspace product/offer/boundary tests | 83 passed, 461 assertions |
| H4 Offers/presentation suite (model, public API, draft/publish/version/normalizer/legacy-compat/runtime) | 237 passed, 1245 assertions |
| Broad backend filter (`Commerce\|Storefront\|Tenant\|Isolation\|PriceList\|Fulfillment\|AvailableToSell\|BranchIsolationGuard\|ProductReference\|Presentation`) | 2200 passed, 33 skipped, **8 failed — all pre-existing environmental gaps** (`bcmath` not installed locally for two `Fuel*` tests; local `.env` `MAIL_MAILER=log` for two `AuthRecovery`/`ResendMailTransport` tests) — unrelated to any H4 code |
| Full backend suite, no `--filter`, local sandbox | 5514 passed, 56 failed, 57 skipped — all 56 failures traced to a pre-existing local sandbox gap (`setup.sh` omitting `app/Mail/`, unlike real CI), not to any H4 or H4-8b file |
| web full vitest | 378 files / 3145 tests passed, 0 failed |
| storefront full vitest (H4-8, unchanged by the rerun) | 115 files / 829 tests passed; biome clean; `tsc --noEmit` clean |
| H4-8b's own PR, real CI (`ci.yml`, both SQLite and PostgreSQL jobs) | green, all 4 jobs `conclusion: success` |
| H4-8 rerun's own CI | not independently re-observed in this closure task (no product code changed by the rerun PR; see that PR's own checks) |

**No test was skipped, disabled, or quarantined to reach this result.** Every reported failure above is explicitly traced to a pre-existing, environment-specific gap (missing local PHP extension, local mail config, an incomplete local sandbox copy step) that is identical before and after every H4 slice, not to H4 code.

This closure task itself is docs-only: no application, test, or configuration file was changed besides the roadmap status note and this report, so no new test run was required or performed by this task. The merged evidence above is reused as closure evidence, not re-executed.

---

## 15. Backward Compatibility

- All additive fields introduced across H4 (`state` on `SECTION_CAPABILITIES`, `imageAlt` on `BannerContent`, `OffersContent{offerIds}`) are optional and require no schema-version bump — consistent with the CONTRACT-2 precedent of changing shape without a document-shape migration.
- The legacy v1 `{key, visible}` → v2 `{id, type, visible}` section migration, unknown-type dropping, duplicate-id collapsing, and the `MAX_HOME_SECTIONS=30` cap all remain proven by the existing `config.test.ts` suite, unmodified by H4.
- Existing `offers` section instances with no `content` key remain valid and render as empty (section omitted) — identical to how `banner`/`benefits`/`customContent` already behaved before a merchant configures them. No migration of pre-H4 `offers` instances was required.
- `/commerce/v1/media` (mobile) and `/store/v1/media` (public) behavior is byte-for-byte unchanged after the H4-8b media fix, proven by their own unmodified test suites passing without alteration.

---

## 16. Known Pre-existing Non-H4 Issues

Recorded here explicitly, per instruction, as separate from H4 and **not** converted into H4 blockers:

- Builder header overflow when the draft is dirty, at 768px/1024px viewport widths — reproduced identically on the pre-H4-7 baseline commit (`f73e5b0`), confirming it predates H4 entirely.
- A Next.js dev-console SVG `<path d>` error traced to an H5 commit (#1160) unrelated to H4, and a separate `IntlError INVALID_KEY` console warning that could not be traced to any specific source and was not observed to involve any Offers/H4 code path.
- Storefront renders Arabic-Indic digits for prices while Canvas renders Latin digits — a pre-existing, documented localization-formatting difference (H4-6/H4-7), not a data or parity defect.
- The Featured section heading's copy differs slightly between Canvas and the public storefront (a labeling choice since H4-5), not a functional or data gap.
- No section-editing surface exists at the 768px breakpoint specifically (pre-existing since H4-7); Canvas-only at that width, with no layout overflow.
- Categories' Canvas preview still renders a deliberately-labeled mock fixture (`PREVIEW_CATEGORIES`) for its thumbnail imagery specifically (distinct from the real catalog *data* wiring H4-3 delivered) — explicitly out of scope for the B1 media fix per H4-8b's own report, and not claimed as resolved by this closure.
- The seeded QA demo tenant has no English content configured, so `/sa/en` currently resolves Arabic chrome rather than switching to English — a content/seed-data artifact of the QA environment, unrelated to any H4 or H4-8b code change.
- The documented H4-6 backend query cost for Offers resolution (~11 queries per live tracked offer) stands unchanged; it was evaluated against a documented bound in H4-6 and found acceptable, not flagged as a new H4-8/closure-time problem.

None of the above items were introduced by H4, and none are treated as H4 blockers.

---

## 17. Remaining H4 Blockers

**NONE.**

This is supported directly by the merged evidence in §4 (the H4-8 verification rerun, PR #1226, is itself titled "READY FOR H4 CLOSURE") and by the section-by-section, capability-by-capability detail in §§5–13 above. The one blocker found during this Horizon (B1, Canvas product media) was fixed in H4-8b and independently re-verified against the real stack in the H4-8 rerun before this report was written — it is not an open item.

---

## 18. Final Owner-facing Status

CUST-H4 — Section Library & Section Quality is **closed and complete**. The Section Library is a real, honest merchant toolbox: every one of the ten homepage sections is LIVE, backed by real data and real contracts, with verified Canvas↔Published parity, tenant isolation, responsive behavior, and accessibility. Offers — the one section this Horizon's original architecture draft had proposed closing as permanently gated — was instead built as a real, bounded, Commerce-truth-respecting capability per an explicit owner correction, and is now LIVE end-to-end alongside the other nine. No merchant-visible section in this Horizon is a placeholder, a mock, or a fake toggle. No application code, schema, pricing, accounting, checkout, POS, tenant, or storefront-runtime logic was changed, merged, deployed, or released by this closure task itself — closure here is a documentation act confirming work that was already merged to `main` across ten prior, independently reviewed PRs.

---

## 19. Next Recommended Product Step

Per the Horizon Roadmap's own recommended order (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` §14), the next roadmap-defined horizon is:

**CUST-H5 — Undo / Redo, Recovery & Change Confidence** — making experimentation safe via toolbar Undo/Redo, explicit saved/unsaved/conflict states, and a safe restore/version-recovery path, scoped to the active draft/version.

Starting CUST-H5 is **not authorized by this closure report**. Per the roadmap's own Horizon lifecycle (`AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` §6.1, "No new Horizon starts automatically"), CUST-H5 requires its own Evidence Pass, UX contract, and architecture/data contract decision before any implementation begins, and that work is explicitly out of scope for this closure task.

---

**No Merge. No Deploy. No Production release.**
