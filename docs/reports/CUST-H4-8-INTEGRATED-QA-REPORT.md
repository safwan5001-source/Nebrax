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
