# CUST-H4-8 — Integrated QA Report

| | |
|---|---|
| **Base SHA** | `0ac176ae0d39986c17bdda706809107dedab1923` (`origin/main`, the squash merge of H4-7 PR #1209 — verified directly: `git fetch` + `merge-base --is-ancestor`, not assumed) |
| **Head SHA** | see the PR (one docs + test + one-line-fix commit on top of the Base SHA) |
| **Branch** | `qa/cust-h4-8-integrated` |
| **PR** | opened for the report, the QA harness and the one small fix below — **not merged** |
| **Merge / Deploy / Production** | **None.** Not merged, not deployed, not released. |
| **H4 closure verdict** | **B) NOT READY** — one blocker (§15), found only by running the real stack |

H4-8 is integrated QA plus targeted fixes. No product scope was added, Offers was not redesigned, Cart/Checkout/POS/Invoice/pricing were not touched.

---

## 1. Environment (real stack, no fixtures)

| Layer | How it ran |
|---|---|
| Laravel | The repo's own `setup.sh` copy step re-synced to Base SHA into `nibras-app`, `migrate:fresh` on SQLite, `php artisan serve` on :8000 with `STOREFRONT_GATEWAY_SECRET` set (the existing, supported forwarded-Host mechanism). |
| Web (merchant app) | `next dev` on :3000, real login (`POST /api/login`), real Store Customizer at `/commerce/appearance`. |
| Storefront | `next dev` on :3001, **no** `AWJ_STOREFRONT_DEV_HOST` bypass. Hostnames `*.h48.test` are mapped to 127.0.0.1 by Chromium `--host-resolver-rules`, so the genuine `Host` header reaches `ResolveStorefrontDomain → StorefrontContext → /store/v1/*`. |
| Browser | Playwright + the pre-installed Chromium, real clicks/keyboard. |
| Data | Deterministic seed (`scripts/qa/h4-8/seed.php`) built with the repo's own `SeedsStorefrontOffers` fixture trait, run against the real DB. |

Harness (committed, reproducible): `scripts/qa/h4-8/` (see its README). Screenshots were produced under an ignored `out/` folder and inspected, not committed.

## 2. Fixtures

* **Tenant T1** (owner `qa-owner@h48.test`) with **Storefront A** (`a.h48.test`, channel `web`) and **Storefront B** (`b.h48.test`, sibling, channel `web2`, own warehouse/price list/offer), plus an *unverified* hostname on A.
* **Tenant T2 (foreign)** with its own storefront `foreign.h48.test`, product and live offer.
* Products on A: **A** (genuine discount 25000→19900, tracked, stock 10) · **A2** (18000→13500, stock 4, extra live product so two-instance ordering can be tested) · **B** (30000→21000, tracked, stock 3 fully reserved ⇒ ATS 0) · **C** (price-list item = base ⇒ no genuine discount) · **D** (published, then deactivated) · **E** (variant-managed shirt).
* Pre-seeded configured offers B, C, D, E (E inserted directly because the API rightly rejects variant-managed products); **Offer A / A2 are created by the merchant through the UI** (§4).

## 3. Host resolution & isolation (real middleware)

| Request | Result |
|---|---|
| `Host: a.h48.test` | only A's live offers |
| `Host: b.h48.test` | only B's offer (`Storefront B product 30000/40000 25%`); **no A leakage** |
| `Host: foreign.h48.test` | only T2's offer; T1 offers never appear on it and vice versa |
| `Host: unverified.h48.test`, `nope.h48.test` | uniform non-revealing `404 not_found` (`تعذّر تحديد متجر صالح`) |
| `?storefront_id=…&tenant_id=…` + `X-Tenant-Id` on A | ignored — still A only |
| `Host: 127.0.0.1` + `X-Storefront-Forwarded-Host: b…` + correct gateway secret | resolves B (supported production-like path); wrong secret cannot redirect |
| Workspace UI, Storefront A → B → A | A panel lists only A offers; B panel only B's (no foreign/A rows); back on A no stale B row |
| Published (browser) on `a.h48.test`, `b.h48.test`, `unverified.h48.test` | A: its sections; B: none of A's; unverified: none |

## 4. Merchant CRUD end-to-end (real web UI → real API)

All steps passed against the real API (`scripts/qa/h4-8/merchant-flow.mjs`, **21 PASS / 0 FAIL**):

1. Create first version → Home → add **Offers** section → hidden candidates B/C/D/E listed with **honest server reasons** (`غير متوفر في المخزون`, `لا يوجد خصم فعلي…`, `المنتج غير نشط أو غير منشور…`, `متعدد الخيارات (غير مدعوم…)`).
2. **Invalid date range** (start after end): **real 422**, error on the *Ends at* field, form stays open, input preserved.
3. Create **Offer A** and **A2** through the product picker → live, with `199.00 / 250.00 · 20%` and `135.00 / 180.00 · 25%`.
4. **Duplicate product** → picker option disabled ("له عرض مهيّأ بالفعل"); a **real 409** (a second tab created it meanwhile) shows "هذا المنتج مُهيَّأ مسبقاً كعرض على هذا المتجر" and keeps the form.
5. Select A, A2, B(hidden); count `3/8`; hidden B stays selected but **no Canvas card**; reorder (A2 up) ⇒ stored order A2, A, B and Canvas cards A2, A.
6. **Edit / deactivate / reactivate A**: the row turns `غير ظاهر — العرض موقوف` and the card disappears from **both** Offers sections; reactivation restores both.
7. **Delete** offer A2 (inline `alertdialog`): removed from **both** sections' selections in one draft change; a real **delete-404** (deleted in another tab first) is treated as "already gone", no stale row.
8. **Multiple instances**: S1 = A2,A · S2 = A,A2 stay independent; the configured-offer catalog is shared (one deactivation updates both).

## 5. Draft save / reload / publish (normal AWJ flow)

* `Save draft` → **full page reload** → both Offers sections and their orders persisted (S1 A2,A · S2 A,A2).
* **Publish** via the normal publish dialog (`[data-publish]` → confirm) worked locally — no blocker; no faked step.
* After publishing, the version is read-only ("create draft from published", as designed); a draft-only change (remove A2 from S1) **did not leak** to Published (still 2 cards) until published.

## 6. Canvas ↔ Published parity (data / order / state)

| | Canvas (workspace read) | Published (`/store/v1/offers`, Host-resolved) |
|---|---|---|
| S1 order | A2, A (hidden B omitted) | A2, A (hidden B omitted) |
| S2 order | A, A2 | A, A2 |
| A | `199.00` / `250.00` / 20% | `١٩٩٫٠٠` / `٢٥٠٫٠٠` / 20% (storefront's `ar-SA` digits — pre-existing, H4-7 §16.4) |
| A2 | `135.00` / `180.00` / 25% | `١٣٥٫٠٠` / `١٨٠٫٠٠` / 25% |
| Missing/hidden ids | no card | omitted; **no live offers ⇒ the whole section is omitted** (heading too); a deleted id is omitted |

Other H4 sections configured through the real save→publish path (`configure-all-sections.mjs`) — Banner, Featured (`[C, A, D(inactive), "not a valid id!"]`), Benefits, Custom Content, App Promo (valid https store URLs), Categories, New Arrivals: Published rendered Banner/Benefits/Custom/App Promo, **Featured `[C, A]` in saved order (D omitted, bogus id dropped by the normalizer)**; Canvas shows the same Banner/Benefits/Custom/AppPromo and the same section order. Intentional chrome differences remain (Canvas shows an empty Categories state and the Wholesale teaser; Published omits them). *Pre-existing, minor:* the Featured heading reads «منتجات مميزة» in Canvas but «مختارات المتجر» on the storefront (copy only, since H4-5).

**Image parity is the one real gap — see blocker B1 (§15).**

## 7. ATS / pricing truth (real services)

`scripts/qa/h4-8/ats-pricing.php` against the real DB, observed through the public endpoint:

| Scenario | Public result |
|---|---|
| A: genuine discount + ATS>0 | **live** `19900/25000 20%` |
| B: genuine discount + ATS 0 (fully reserved) | **omitted** (workspace reason `out_of_stock`) |
| B: reservation released | **live** `21000/30000 30%` |
| A: all stock reserved (ATS 0) | omitted; released ⇒ live again |
| C: price-list item == base | omitted (`not_discounted`) |
| A: price-list raised to base / restored | omitted / live |
| D: product inactive | omitted (`product_unavailable`) |
| E: variant-managed (inserted directly) | omitted — fail-closed (`variant_managed`) |

`CommercePriceResolver` amount for A = **19900** = the public `offer_price`; `discount_percent` is shown exactly as sent (no frontend recomputation). The H4-6 suite additionally proves `offer_price == resolver == real cart line unit_price`. Cart/Checkout/POS/Invoice were not modified.

## 8. Section Library truth matrix (real picker + registry)

`hero, categories, newArrivals, wholesale, banner, featured, offers, benefits, appPromo, customContent` → **all `state: "live"`, `merchantAddable: true`**. In the real picker: singleton sections already present are disabled ("أُضيف بالفعل": categories, newArrivals, wholesale, hero, appPromo); multi-instance sections (featured, offers, banner, customContent, benefits) stay addable; **no stale gated/"coming soon" copy** anywhere (Offers badge gone, Featured not partial).

## 9. Presentation twin parity

PHP `StorefrontPresentationNormalizerTest` (46) + web/storefront `section-content` suites are green; on the real save path: `OffersContent {offerIds}` only — **no price/discount/stock/name/image/live-state** in the persisted JSON (checked by regex on the saved config), invalid ids dropped, duplicates removed, max 8, empty normalized. Featured likewise.

## 10. Responsive QA (real browser)

| Surface | Widths | Result |
|---|---|---|
| Canvas + Offers panel (desktop shell) | AR 1024 · 1280 · 1440, EN 1024 · 1440 | **no document overflow** |
| Canvas + Offers CRUD in the Bottom Sheet | AR 390 · 430, EN 390 | **no overflow (doc and dialog)**, exactly **one** dialog (form and delete confirmation inline), submit/cancel ≥ 40px, date inputs usable |
| AR 768 | — | no section-editing surface at this width (pre-existing, H4-7 §14); Canvas only; no overflow |
| Published `a.h48.test` | AR 390 · 430 · 768 · 1024 · 1280 · 1440, EN 390 · 1440 | 2 Offers sections, `dir` correct, **no overflow** |

Known pre-existing builder-header overflow when the draft is dirty at 768/1024: **re-verified identical on the pre-H4-7 baseline** (`f73e5b0`, side-by-side on the dev fixture: 1024 → clean 2px / dirty+Banner **39px on both** baseline and HEAD; 768 → 0 on both). H4-7 diff contains no header markup. **Not fixed, per instruction.**

## 11. Accessibility (real browser)

(Harness note: the form-open focus check asserts the real active element — an `H3` inside the edit form — and was proven non-vacuous with a deliberate negative run; harness scripts now exit non-zero on any failed assertion, see `checks-selftest.mjs`.) PASS: edit/delete buttons carry product-named accessible names; every row states live/hidden **in text** (✓/○ glyph + reason, not colour only); Canvas Offers sections have unique, resolving `aria-labelledby`; opening the form focuses its heading, **Escape closes it and focus returns to the opener**; delete `alertdialog` is named, **Cancel is focused first**, Escape cancels and returns focus to the Delete opener; form `direction: rtl`; product images are decorative (`alt=""`, name adjacent) on Published and Canvas. (A screen-reader pass was not done — no AT in the sandbox.)

## 12. Error / degraded states

Workspace (real unless noted): list **500** (route-intercepted) → error + retry, retry recovers · product search **500** → error state · create **409** (real) · create/update **422** (real invalid range) · delete **404** (real) · delete failure covered by unit tests · storefront switch (no stale cross-storefront rows, §3). Published: **zero live offers → sections omitted**, selected ids missing → omitted, **backend down → storefront 200, no Offers, zero page errors**. No stale/fake cards anywhere.
Note: the public API's per-IP *unauth* limit (30/min) returned "rate limited" for repeated loads in this harness; the storefront degraded gracefully (sections omitted). The harness clears the cache between loads.

## 13. Network request counts / backend query count

| Surface | Requests (observed) |
|---|---|
| Canvas (workspace), editor load | 1× `GET …/offers` (+ versions, categories, products?per_page=8); `GET …/products?per_page=50` only when the create form opens |
| Canvas after each mutation | 1 write + 1 silent `GET …/offers` (by design) — **no N+1** |
| Published SSR home with **2** Offers sections | **1** `GET /store/v1/offers` (5 `/store/v1` calls total for the page) |
| Browser → public offers | 0 (server-side render) |

Backend queries (in-process, SQLite, includes middleware baseline): public offers (2 live tracked + 3 hidden candidates) **48**, workspace read **49** — consistent with the documented H4-6 bound (≈11/live tracked offer, ≤145 at the 12 cap). Cap 12 configured / max 8 selected unchanged. No new frontend N+1; the H4-6 resolver cost stands as documented.

## 14. Tests / builds / CI

| Suite | Result |
|---|---|
| PHP focused (offers model/workspace/public, presentation normalizer/draft/publish/runtime, host resolution) — in-memory SQLite | **218 passed** |
| PHP broad (`Commerce\|Storefront\|Tenant\|Isolation\|PriceList\|Fulfillment\|AvailableToSell\|BranchIsolationGuard\|ProductReference\|Presentation`) | **2175 passed, 33 skipped, 8 failed — all environmental** (`FuelReconciliation`/`FuelSaleService`: `bcmath` missing locally; `AuthRecovery`/`ResendMailTransport`: local `.env` `MAIL_MAILER=log`). No PHP file changed in H4-8, so identical on `main`. |
| web full vitest | **372 files / 3063 tests passed** (before the one-line fix); `ExperienceBuilder.offers-crud` 12/12 after it |
| storefront full vitest | **115 files / 829 tests passed**; biome clean; `tsc --noEmit` clean |
| web `tsc` | no errors in touched files (repo carries pre-existing errors elsewhere) |
| CI | see the PR checks (not observed at the time of writing) |

## 15. Findings

### Fixed in H4-8 (H4 UX state)
* **F1 — stale list after a real 409.** After a concurrent create conflict, the conflicting offer was not visible until a manual "Refresh list". `create` now silently re-reads on `conflict` (mirrors `update`'s 404 handling). Verified against the real API (`conflict-409.mjs`): form + error + product kept; row visible after closing the form. 1 source line (+comment), test updated.

### Blocker B1 — Canvas cannot show real product photos (pre-existing, cross-section; **needs an owner decision**)
Integrated QA with a product that has a real image: **Published shows the photo, Canvas never does.** The workspace products/offers endpoints return `/commerce/v1/media/{id}` — the **mobile ApiClient media route** (`CommerceMediaController`, bearer = ApiClient, channel-bound). The merchant app's `<img>` cannot authenticate to it: `GET` → `401` JSON → `net::ERR_BLOCKED_BY_ORB`, and the card shows a broken-image glyph (the H4-5 report states "never a broken-image icon"). It hits **New Arrivals (H4-3), Featured (H4-5) and Offers (H4-7) identically** (all three Canvas images share the same URL; reproduced in `canvas-media-probe.mjs`). Not caused by H4-7, but it is a merchant-visible Canvas↔Published image-parity break across H4. A correct fix needs a backend decision (a workspace-authorized, storefront/tenant-scoped media URL, or returning the public `/store/v1/media` URL) — i.e. **new media-serving surface, which H4-8 is forbidden to invent**. **STOP and report.** Suggested slice: *H4-8b — workspace-authorized product media for Canvas* (then re-run `canvas-media-probe.mjs` + `published-all-sections.mjs`).

### Pre-existing, not H4 regressions (not fixed)
* Builder header overflow when dirty at 768/1024 (verified identical to baseline, §10); at 390 the Publish button is clipped in the header when dirty.
* Next dev console errors seen during the run: an SVG `<path d>` error from `ExperienceBuilder.tsx` (introduced in H5 #1160, not H4) and an `IntlError INVALID_KEY` (namespace with `.`) that was **not traced to a source** (not observed to involve Offers code).
* Storefront Arabic-Indic digits vs. Canvas Latin digits; Featured heading copy differs between Canvas and storefront; list-vs-detail price drift (H4-6 §9); variant-managed offers unsupported (H4-6 §8); no section-editing surface at 768.

## 16. H4 closure gate

Requirements checked: real merchant usability ✅ · real source ✅ · isolation ✅ · responsive ✅ · accessibility ✅ · save/reload/publish ✅ · no fake merchant-visible section ✅ · no H4 regression ✅ · **Canvas/Published parity ❌ (B1: product images)**.

**Classification: B) NOT READY** — blocker **B1** only. Everything else is closable; once B1 is resolved (or the owner explicitly accepts "Canvas thumbnails fall back to the placeholder" and a no-broken-icon guard), H4 can close.

**No Merge. No Deploy. No Production release.**

---

## 17. H4-8 Verification Rerun after H4-8b (2026-10-04)

| | |
|---|---|
| **Base SHA** | `5264d531071bb081f3b0c0dc4a42931761332e0e` (`origin/main` HEAD, re-fetched and verified directly with `git fetch origin main` + `git rev-parse origin/main` — not assumed). This **is** the expected H4-8b squash merge of PR #1224 (`fix(store): authorize product media for H4 Canvas`), confirmed identical by `git log --oneline`. |
| **Head SHA** | see the PR — one commit on top of the Base SHA, this branch only |
| **Branch** | `qa/cust-h4-8-rerun` |
| **PR** | opened for this rerun's report + harness fix — **not merged** |
| **Scope** | Verification only. One harness timing fix (below) was required to get a trustworthy signal; no product (`app/`, `web/`, `storefront/` source) code was touched. |
| **Merge / Deploy / Production** | **None.** Not merged, not deployed, not released. |

### 17.1 B1 — real-stack recheck: RESOLVED

Reused `scripts/qa/h4-8/h4-8b-verify.mjs` (committed by H4-8b) against the real stack (real Laravel on :8000, real `web/` on :3000, real `storefront/` on :3001, real Chromium, real seeded `ProductMedia`, no fixtures/mocks). **Result: `FAILS 0`** across all assertions:

* Workspace product list and workspace offer payloads carry a `thumbnail_url` pointing at `commerce/workspace/storefronts/{id}/media/{media}?expires=…&signature=…` — **not** `/commerce/v1/media`.
* A plain, deliberately-unauthenticated `fetch()` of that exact URL (the literal `<img src>` scenario) returns `200` with `content-type: image/*`.
* Real Playwright/Chromium browser, logged in as the merchant, opened `/commerce/appearance`: all **three** Canvas surfaces render a real decoded `<img>` —
  * **New Arrivals**: `naturalWidth=64, complete=true`
  * **Featured**: `naturalWidth=64, complete=true`
  * **Offers**: `naturalWidth=64, complete=true`
* The browser's own network layer confirms: at least one real HTTP request hit a workspace media URL, **none** of those requests carried an `Authorization` header, and every one got `200`.

Re-ran the **original B1 reproduction script**, `canvas-media-probe.mjs`, unmodified, for a direct before/after: it previously logged `401`/`net::ERR_BLOCKED_BY_ORB` events and a broken `<img src>` pointing at `/commerce/v1/media`; on this branch it logs **zero** media-related failure/console events, and `img.src` is now the signed `commerce/workspace/.../media/...?expires=&signature=` URL.

**B1 before/after:**

| | Before (H4-8, Base `0ac176a`) | After (this rerun, Base `5264d53`) |
|---|---|---|
| Canvas `<img src>` | `/commerce/v1/media/{id}` (bearer-gated) | `commerce/workspace/storefronts/{id}/media/{id}?expires=…&signature=…` (signed, unauthenticated) |
| Browser request | `401` → `net::ERR_BLOCKED_BY_ORB` | `200`, `image/*`, no `Authorization` header |
| Canvas render | broken-image glyph, all 3 surfaces | real decoded image, all 3 surfaces (`naturalWidth=64`) |

### 17.2 Published / existing media routes — unchanged, still correct

* **Published storefront** (`a.h48.test:3001`, real browser, real Host resolution): the same product's image renders via `http://a.h48.test:3001/api/storefront/media/{id}` — the storefront app's pre-existing proxy to `/store/v1/media/{id}` (confirmed in `storefront/src/lib/commerce/mappers.ts`; untouched by H4-8b). `200`, `image/*`, `naturalWidth=64`.
* `CommerceMediaApiTest` (13 tests, unmodified) and `ProductMediaR2CommerceStorefrontReadTest` (2 tests, unmodified) pass unchanged — `/commerce/v1/media` and `/store/v1/media` behavior is byte-for-byte identical to before H4-8b, as the H4-8b report claims.
* `StorefrontDomainMediaVisibilityTest` (5 tests) also green — the trusted-domain-path media route is unaffected.

### 17.3 Security / isolation recheck — all guards hold, none weakened

`CommerceWorkspaceMediaApiTest` (new in H4-8b, 13 tests, 45 assertions) — **13/13 passed**:

| Guard | Result |
|---|---|
| Tenant A media loads for tenant A storefront | ✅ (`workspace product list thumbnail points to the signed workspace media route`) |
| Tenant A cannot load tenant B's media (validly-signed URL for a foreign tenant's media) | ✅ `404`, non-revealing |
| Storefront cannot load media not eligible for its own sales channel | ✅ `404` (`media_of_a_product_unpublished_on_that_storefronts_channel_is_not_served`) |
| Media published only on a **sibling** storefront's channel (same tenant) | ✅ `404`, not served via the other storefront |
| Unpublished product media | ✅ fails safely, `404` |
| Missing media id | ✅ non-revealing `404` |
| Missing storefront id | ✅ non-revealing `404` |
| Malformed (non-UUID) id | ✅ `404` regardless of an otherwise-valid signature |
| **Expired signature** | ✅ `403` (`an_expired_signed_url_is_rejected`) |
| **Tampered id with a reused signature** | ✅ `403` (`a_tampered_media_id_with_a_reused_signature_is_rejected`) |
| Response cacheability | ✅ `private, max-age=600` — not shareable by a proxy/CDN |
| Storage path/disk leak | ✅ none, in any response |

No guard was weakened to make this pass — all 13 are the same assertions H4-8b's own report documents, independently re-run on fresh `origin/main`. No tenant/storefront leakage observed in any error path (uniform `404`/`403`, no distinguishing detail).

### 17.4 H4 regression subset

**Section Library matrix** (`section-library-matrix.mjs`): `hero`, `categories`, `newArrivals`, `wholesale`, `appPromo` correctly `DISABLED` (already added, singleton); `featured`, `offers`, `banner`, `customContent`, `benefits` addable. **No stale `قريباً`/`coming soon`/gated copy anywhere.** (Two additional sections — `productShelf`, `discovery`, `deliveryPromise` — are visible from later, unrelated Horizons (H14–H16); not an H4-8/H4-8b concern.)

**Merchant Offers CRUD + Canvas/Published parity** (`merchant-flow.mjs`, real UI → real API, 21 assertions): **21/21 passed** after one harness timing fix (§17.7) —

* Create A, A2 via the real product picker; select/reorder/hide B → Canvas S1 order `A2,A` (B hidden, omitted).
* Second independent Offers instance S2 (`A,A2`); S1 unaffected.
* Save draft → full reload → both sections and orders persisted.
* Edit/deactivate/reactivate A → disappears from **both** canvases (shared catalog), returns in both.
* Save + **publish** (real publish dialog) → Published has 2 Offers sections, S1/S2 order matches Canvas exactly, hidden B (ATS) not published, storefront B shows none of A's offers, unverified host renders no offers.
* **Draft-only change does not leak before publish**: create draft-from-published, remove A2 from S1, save draft (not publish) → draft Canvas shows 1 card, **Published still shows 2** (confirmed both via the real browser read and independently via a direct backend fetch bypassing the browser/Next layer entirely — see §17.7).
* Delete offer A2 → cleaned from **both** section instances' selections in one draft change; canvases update together.

**Conflict/409** (`conflict-409.mjs`): real `409` on a concurrent duplicate-product create — form stays open, error shown, selected product kept; the row becomes visible after closing the form **without a manual refresh** (F1 fix from H4-8, re-confirmed still working).

**Storefront switch isolation** (`storefront-switch.mjs`): Storefront A's Offers panel lists only A's configured offers; switching to sibling Storefront B shows only B's own offer (no A/foreign leakage); switching back to A shows no stale B row.

**Presentation save/reload/publish**: covered above (merchant-flow.mjs steps 4 and 6–7) — all held.

### 17.5 ATS / pricing recheck

`ats-pricing.php` against the real DB, through the public endpoint:

* `CommercePriceResolver` amount for A = `19900`, matching the public `offer_price` exactly (**`offer_price==resolver: YES`**).
* C (no genuine discount), D (inactive), E (variant-managed) never appear live in any scenario — correctly excluded throughout.
* B transitions correctly: out-of-stock → omitted; hold released/restocked → live; re-reserved (ATS 0) → omitted again.
* No frontend pricing logic; Cart/Checkout/POS/Invoice untouched by this rerun (same as H4-8/H4-8b).

### 17.6 Presentation contract recheck

`configure-all-sections.mjs` against a real draft: `OffersContent` persists as **`{offerIds: [...]}`** only — confirmed by regex against the saved JSON (`no commerce facts in presentation JSON: true`). Featured's bogus id is dropped by the normalizer, inactive product D omitted, order preserved (`C, A`). Workspace product/offer list payloads now carry a signed `thumbnail_url` string (§17.1) — still just a URL string in the API response, consumed identically by the same unmodified `web/` call sites H4-8b's own report enumerates; no new shape, no commerce facts added to presentation storage.

### 17.7 One investigated non-issue: a test-harness timing race (not a product regression)

The first `merchant-flow.mjs` run on this branch showed 1 (later, after the Laravel dev server was restarted mid-session, up to 4) failed assertions, all of the shape *"published still has N cards"* reading **fewer** cards than the real published state actually has. This was treated as a potential real regression (draft content leaking into — or otherwise corrupting — the published read) and investigated to ground truth before being dismissed:

1. **Direct backend check, bypassing the browser and the `storefront/` Next.js app entirely** — a raw `fetch()` to `GET /store/v1/offers` with the real `X-Storefront-Forwarded-Host`/`X-Storefront-Gateway-Secret` production-pattern headers, executed *immediately* after saving the suspect draft (A2 removed from S1, **not published**): returned `200` with **2** offers (A, A2), full correct data — proving the backend's draft/published separation is intact and was never at risk.
2. A fresh Playwright page opened against the real `storefront/` app at the same moment showed **0** `[data-offer-card]` elements immediately after `waitUntil: 'networkidle'`, then **2** elements ~1.5s later with no further action taken — i.e. a client hydration settle delay on a cold browser context, not a leak (a real leak would read as **1** card, never **0**-then-**2**).
3. A screenshot taken at the "0" instant showed the Offers section fully, correctly rendered with both cards, prices, and the real product image — confirming the DOM was correct and only the *script's* `[data-offer-card]`-count assertion ran before Chromium's hydration had attached event handlers/attributes on a freshly-launched (cold V8) browser context.

**Root cause:** `merchant-flow.mjs`'s `readPub()` helper (and `published-responsive.mjs`'s equivalent) counted `[data-offer-card]` elements right after Playwright's `waitUntil: 'networkidle'`, which guarantees network quiescence but not React hydration completion — a race that is more likely to lose on a cold, freshly-launched browser context than on a context that has already executed the same JS bundle once in the same process (which is why the *first* few `readPub()` calls inside the same script, reusing one warm page, passed reliably while a brand-new `browser()`/page opened later in the same script intermittently lost the race). This is pre-existing behavior in QA-harness scripts that H4-8b did not touch (neither `merchant-flow.mjs` nor `published-responsive.mjs` appear in H4-8b's file list) — it is a harness reliability gap, not a product defect, and it predates this rerun.

**Fix applied** (harness only, zero product code changed): added `await page.waitForSelector('[data-offer-card]', { timeout: 5000 }).catch(() => {})` immediately after each `goto()` and before counting, in `merchant-flow.mjs` (`readPub()` and the step-7 standalone check) and `published-responsive.mjs`. This makes the assertion wait for the real DOM state instead of racing it, without weakening any assertion — a page with genuinely zero live offers (e.g. the unverified-host check) simply times out the wait after 5s and correctly counts 0.

**After the fix:** `merchant-flow.mjs` → **21/21 passed, `FAILS 0`**, deterministically, re-run clean. `published-responsive.mjs` → correct `offerSections=2`, `dir=rtl`, `docOverflow=0` at all 8 width/locale combinations. This is reported in full per instruction (not glossed over as "tests are green") precisely because the failure was real on first read and required independent, non-browser confirmation before being ruled out as a harness issue rather than a product one.

### 17.8 Responsive spot check

* **Canvas** (`canvas-responsive.mjs`), AR 390/430/768/1024/1280/1440: `clean`/`afterSelect`/`dirty` document width never exceeds viewport (`sw === cw`) at any width. The known **pre-existing** dirty-state builder-header overflow at 768 (71px) and 1024 (115px) reproduces identically to the H4-8 baseline — **not changed by H4-8b**, not fixed here (unrelated to media, out of scope per instruction).
* **Mobile bottom sheet** (`mobile-sheet.mjs`): create/edit/delete-confirm all show **zero** document/dialog overflow at 390/430; submit/cancel ≥ 40px; exactly one dialog at a time.
* **Published** (`published-responsive.mjs`, after the harness fix in §17.7), AR 390/430/768/1024/1280/1440 + EN 390/1440: 2 Offers sections, `dir=rtl`, zero document overflow at every width, real product image (`imgAlt=""`, decorative), one card link per card.
* *Pre-existing, not a regression:* the seeded demo storefront has no English content configured, so `/sa/en` resolves `dir=rtl`/`lang=ar` (Arabic) rather than switching to LTR English chrome — identical before and after H4-8b (zero `web/`/`storefront/` files changed by H4-8b), unrelated to localization scope.

### 17.9 Accessibility spot check

`a11y-and-errors.mjs`, reused unmodified: edit/delete controls have accessible names; every offer row states live/hidden **in text** (not colour-only); Canvas Offers sections have unique, resolving `aria-labelledby`; opening the edit form moves focus to its `H3` heading; **Escape** closes the form and restores focus to the opener; the delete `alertdialog` is named, **Cancel is focused first**, Escape cancels and restores focus; form is `dir: rtl`. Real `409`/`404`/`500` error states (list-500 → error+retry, retry recovers; product-search-500 → error state) all still correct. **`FAILS 0`** — no assertion weakened.

### 17.10 Request / performance check

* `query-count.php` (fresh fixture, B/C/D/E only configured): public `/store/v1/offers` — **37–39** queries; workspace offers — **38** queries. Same order of magnitude as H4-8's documented baseline (≈48–49 with 6 offers configured; fewer offers here accounts for the difference) — **no N+1 introduced**, consistent with H4-8b's own claim that `workspaceMediaPayload()` is a pure URL-string builder adding zero queries.
* Browser network capture in `h4-8b-verify.mjs` (§17.1): zero JS fetch-per-image, zero blob hydration — the signed URL is embedded directly in the existing single list/offer response; the browser's `<img>` tag issues one ordinary HTTP GET per image, exactly like the Published side always has.
* Workspace Offers/product read counts: unchanged from H4-8 (same single `GET .../offers` / `GET .../products` pattern; media URLs ride along in the same payload).

### 17.11 Tests

| Suite | Result |
|---|---|
| `CommerceWorkspaceMediaApiTest` (new, 13 tests) | **13 passed, 45 assertions** |
| `CommerceMediaApiTest` + `ProductMediaR2CommerceStorefrontReadTest` (existing, unmodified) | **15 passed, 38 assertions** |
| `StorefrontDomainMediaVisibilityTest` | **5 passed** |
| `CommerceWorkspaceStorefrontProductApiTest` + `CommerceWorkspaceStorefrontOfferApiTest` + `CommerceModuleBoundaryTest` | **83 passed, 461 assertions** |
| H4 Offers/presentation suite (`StorefrontOfferModelTest`, `StorefrontOfferPublicApiTest`, `StorefrontPresentationDataSectionsTest/DraftApiTest/LegacyCompatibilityForkTest/NormalizerTest/PublicRuntimeTest/PublishApiTest/VersionApiTest/VersionPublishApiTest`) | **237 passed, 1245 assertions** |
| Broad (`Commerce\|Storefront\|Tenant\|Isolation\|PriceList\|Fulfillment\|AvailableToSell\|BranchIsolationGuard\|ProductReference\|Presentation`) | **2200 passed, 33 skipped, 8 failed — all the same pre-existing environmental failures H4-8 documented** (`FuelReconciliation`/`FuelSaleService`: `bcmath` missing locally; `AuthRecovery`/`ResendMailTransport`: local `.env` `MAIL_MAILER=log`) |
| Full suite, no `--filter`, local sandbox | **5514 passed, 56 failed, 57 skipped** — all 56 failures traced to `Class "App\Mail\AuthActionMail" not found`, the same pre-existing `setup.sh` sandbox gap (omits `app/Mail/`) H4-8b's own report documents; fixed locally for this session the same way (manually copied `app/Mail/` into the sandbox build) — **unrelated to H4/H4-8b**, no file either touches is under `app/Mail` |
| web full vitest | **378 files / 3145 tests passed, 0 failed** |
| CI | not re-observed in this rerun (no PR-triggering product code changed; see this PR's own checks for the harness-only diff) |

### 17.12 Pre-existing issues (separated, not regressions)

* Builder header overflow when dirty at 768/1024 (§17.8) — identical to H4-8 baseline.
* `/sa/en` resolves Arabic, not English, for this seed tenant — no English content configured; unrelated to H4-8b.
* Categories Canvas preview still renders the labeled mock fixture (`PREVIEW_CATEGORIES`), not real images — explicitly out of scope for B1 per H4-8b's own report §14, unchanged here.
* The documented H4-6 backend pricing query cost (≈11 queries/live tracked offer) stands, unchanged.

### 17.13 Remaining blockers

**None found for H4 closure.** B1 is resolved and independently re-verified on the real stack; no new blocker was introduced by H4-8b; the one anomaly investigated (§17.7) was root-caused to a QA-harness timing gap, fixed in the harness, and re-confirmed deterministic — not a product regression.

### 17.14 Final verdict

## READY FOR H4 CLOSURE

**No Merge. No Deploy. No Production release.**
