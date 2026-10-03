# CUST-H4-7 — Offers Canvas + Published + Merchant UI — Implementation Report

| | |
|---|---|
| **Base SHA** | `f73e5b0ed568bdb38b514cf2385d321d65594d17` (`origin/main`, the merge of H4-6 PR #1202 — verified directly via `git fetch` + `merge-base --is-ancestor`, not assumed) |
| **Head SHA** | `bee5dc722cfddc19479de56b90976d23abbdb62e` (implementation commit; later commits on the branch only touch this report) |
| **Branch** | `feat/cust-h4-7-offers-ui` |
| **PR** | #1209 — https://github.com/safwan5001-source/Nebrax/pull/1209 |
| **Offers capability** | **`state: "live"`, `merchantAddable: true`** |
| **Merge / Deploy / Production** | **None.** Not merged, not deployed, not released. |

Contract implemented: `docs/plans/store/CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §23.3 (`OffersContent`), §23.4–23.5; H4-6 backend contract unchanged and authoritative.

---

## 1. Files changed (46 files, +3897 / −141)

**Backend (PHP)**
- `app/Support/Commerce/StorefrontPresentationNormalizer.php` — `MAX_OFFERS = 8`, `offers` branch
- `tests/Feature/StorefrontPresentationNormalizerTest.php` — 8 new tests

**web/ — new**
- `src/modules/commerce-workspace/workspace-offers.ts` (+ `.test.ts`, 28 tests)
- `src/modules/store-experience-builder/offers-display.ts` (formatting only — no derivation)
- `…/__tests__/ControlPanels.offers.test.tsx` (36), `StorefrontPreviewCanvas.offers.test.tsx` (19), `ExperienceBuilder.offers.test.tsx` (15), `offers-fixtures.ts`
- `e2e/cust-h4-7-offers-visual.spec.ts` (12 scenarios)

**web/ — modified**
- `presentation/section-content.ts`, `presentation/section-capabilities.ts`, `presentation/tokens.ts`
- `ExperienceBuilder.tsx`, `ControlPanels.tsx`, `StorefrontPreviewCanvas.tsx`, `SectionLibrary.tsx` (comment), `messages.ts`
- `src/lib/mock-data.ts`, `src/app/dev/customizer-versions/page.tsx` (dev fixture only)
- Tests updated to the LIVE truth: `section-capabilities.test.ts`, `SectionLibrary.test.tsx`, `section-content.h4-4.test.ts`, `appearance/section-{instances,editing,library-mobile}.test.tsx`

**storefront/ — new**
- `src/lib/commerce/offers.ts` (+ `__tests__/offers.test.ts`, 17)
- `src/components/home/OffersShelf.tsx` (+ test, 10), `src/components/products/OfferCard.tsx` (+ test, 9)
- `src/app/dev/offers-visual/page.tsx`, `scripts/dev/offers-visual-stub.mjs` (dev-only visual fixture)

**storefront/ — modified**
- `src/lib/presentation/section-content.ts`, `tokens.ts`, `__tests__/section-content.h4-4.test.ts`
- `src/lib/commerce/types.ts`, `mappers.ts` (two helpers exported)
- `src/app/[country]/[locale]/(storefront)/page.tsx`
- `messages/{ar,en,de,es,fr,pl}.json` (4 keys each)

**Not touched:** Cart / Checkout / POS / Invoice / pricing code, `LedgerService`, any migration, routes, H4-6 backend files.

## 2. `OffersContent` contract

```ts
interface OffersContent { offerIds: string[] }   // max 8 (MAX_OFFERS)
```
Stores **only** `storefront_offers.id` references. Normalizer (identical in the 3 twins): trim → drop non-string / unsafe (`/^[a-zA-Z0-9_-]{1,64}$/`) / empty tokens → dedupe (first wins) → cap 8 → omit if empty. Unknown keys (`productIds`, `name`, `image`, prices, percent, stock, dates, live flag) are dropped. Legacy `offers` instances without `content` stay valid (renders empty / section omitted). No version bump. Twin parity is tested with the same case list in PHP / web / storefront.

*Deliberate difference vs Featured:* Featured tolerates an empty-string token (old draft text input); offers drop it — an offer id is always a real uuid.

## 3. Workspace client

`listWorkspaceOffers(storefrontId, signal?)` → `GET /api/commerce/workspace/storefronts/{id}/offers`. No tenant id; one request, no query. Parses `evaluation.is_live / reason / reference_price / offer_price / discount_percent` verbatim; unknown future reasons are kept as raw strings; a "live" row without the full price proof is a malformed payload (never patched); non-live rows drop any prices. 403/404/other classified. Read-only (CRUD stays the H4-6 authority).

## 4. Merchant picker UX (`OffersPickerFields`)
- Real configured offers (name, thumbnail/fallback, **live/hidden in text with ✓/○ glyph — not colour alone**, hidden **reason**, reference price, offer price, discount badge when live).
- Select (multi), remove, **reorder (↑/↓, product-name in aria-label)**, count `N/8` (`aria-live`), max 8 (unselected disabled, selected stay removable), duplicates structurally impossible (toggle), stored order preserved.
- Hidden selected offers **stay in the draft** (scheduled offers can be pre-selected) with an honest reason. A selected id absent from the workspace list → "Offer no longer available" row, removable, never faked, no id shown.
- No raw offer ids rendered; no price/discount editing; no search (≤12 candidates, one list; refresh button instead).
- Loading / empty / error+retry states. Empty copy does **not** point to a screen that doesn't exist.

## 5. Canvas data flow
`ExperienceBuilder` owns **one** workspace read per storefront/version (aborted + token-guarded; reset on storefront switch; unmount abort). It runs only on Home when an Offers instance is **visible or selected** — a store with only the default hidden row issues no request. Every instance maps its own `offerIds` over that list. Canvas renders `isLive && product` rows only, in stored order, with `offer_price`, `reference_price`, `discount_percent` exactly as returned. Hidden/missing → no card; "none live" gets an honest note.

## 6. Published data flow
`OffersShelf` (server) → `fetchOffers()` (one Host-resolved `GET /store/v1/offers`, no id/query) → `Map(id)` → stored `offerIds` order → omit missing/non-live → `null` if nothing remains (also on request failure, like other optional sections). `OfferCard` is link-only (product page by id), no add-to-cart, no pricing reads. Copy via `useTranslations("home")` inside the client card.

## 7. Ordering / hidden behaviour
Stored `offerIds` is the single order authority on Canvas and Published (verified with scrambled API order in unit tests and in the real server-rendered fixture). Public API order is never used. Non-live offers never reach Published (backend filter) and never render a Canvas card.

## 8. Price / discount authority
Nothing computed in the browser: no savings amount, no alternative percent, no "was" price, no variant pricing, no pricing endpoint calls. `discount_percent` shown exactly as sent. **Decision (flagged by H4-6):** a `0` percent (genuine sub-half-percent discount) draws **no badge** — "0% off" would be a misleading claim — while both prices remain visible.

## 9. Capability transition
`offers: gated/false → live/true`; `reasonKey` and the orphaned `sectionOffersComingSoon` copy (ar+en) removed; `GATED_HOME_SECTION_KEYS` is now `[]` in both twins (mechanism + `gatedSection`/`gatedBadge` kept for any future gated section). Tests rewritten: Offers live+addable+no badge, every other section unchanged, Featured still live, duplicates allowed (`canDuplicate`, `maxInstances: null`).

## 10. Accessibility
Picker listbox `aria-multiselectable` labelled via `aria-labelledby`; options keyboard-operable; selected count `aria-live`; move/remove buttons named per product; live/hidden stated in text + glyph; discount badge is readable text; price relationship via `sr-only` "Offer price / Base price" labels + strikethrough; card images decorative (`alt=""`, name adjacent); sections use `aria-labelledby` headings (unique per instance).

## 11. Tests / results
| Suite | Result |
|---|---|
| PHP `StorefrontPresentationNormalizerTest` | 46 passed (8 new) |
| PHP filter `StorefrontPresentation\|StorefrontOffer\|CommerceWorkspaceStorefrontOffer` | 338 passed, 1 skipped |
| web full vitest | **369 files / 2986 tests passed** |
| storefront full vitest | **115 files / 829 tests passed** |
| storefront biome / tsc | clean / clean |
| web tsc | no new errors (remaining set pre-existing: spread-argument errors in `appearance/section-*.test.tsx` incl. the untouched `section-selection`, product/pos/gemini/etc.) |
| Playwright `cust-h4-7-offers-visual.spec.ts` | 12 / 12 |
Web has no ESLint config in the repo (`next lint` unconfigured) — not run.

## 12. Builds
- `web`: `npm run build` — Compiled successfully.
- `storefront`: `next build` — Compiled successfully, TypeScript finished; page-data collection logs `Spree client is not configured` from `lib/data/sitemap.ts` (needs `SPREE_*` env locally — environmental, unrelated).

## 13. CI
See PR #1209 checks (not observed at the time of writing).

## 14. Visual QA (screenshots opened and inspected)
Editor (`/dev/customizer-versions`, fixture `MOCK_WORKSPACE_OFFERS`: live w/ image, live w/o image, 0%, very long names, hidden: scheduled/out_of_stock/expired/not_discounted/variant_managed, deleted product): AR 390, AR 430, AR 768/1024/1280 (Canvas), AR desktop (select/reorder/remove, hidden, max 8, empty, error), simulated Canvas tablet/mobile, EN LTR desktop.
Published (real `OffersShelf` against a local stub of `/store/v1/offers`, `/dev/offers-visual`): AR 390/430/768/1024/1280/1440, EN 1440, all-ids-missing (section omitted). Verified: stored order restored over scrambled API order, `gone` id omitted, 0% badge omitted, forwarded-host header sent, no horizontal overflow.

**Bugs found only by inspecting/running the real thing (both fixed):**
1. `OffersShelf` (server) passed a function (`discountBadge`) to the client `OfferCard` → the section failed to render in Next. Fixed (card uses `useTranslations`); regression test asserts only serializable props cross the boundary.
2. Picker candidate rows overlapped in the height-limited list (flex shrink). Fixed with `shrink-0`.
Also: `sr-only` price labels escaped the clipped preview scroller and widened the document → cards are `relative`.

**Pre-existing, not Offers (observed, not changed):** once the draft is dirty the builder **header toolbar** is wider than 768/1024 px and widens the document by ~28–40 px — reproduced identically after adding a plain Banner section. Below 1280 px the sidebar editor is not part of the shell at 768 (only ≥ 1024).

## 15. Known H4-6 backend limit
Unchanged: up to ~145 queries for 12 tracked live offers (≈11/offer); cap stays 12; no pricing batch refactor attempted. Frontend adds exactly one workspace read (editor) and one public read (Published).

## 16. Risks / remaining
1. **No merchant UI to create/configure offers.** H4-6 shipped backend CRUD only; H4-7 (per scope) selects existing offers and shows an honest empty state. Until a bounded configuration UI exists, a merchant cannot populate the list without API access. **Owner decision needed** (suggest a small H4-7b "Offers configuration" slice) — this is the main reason "LIVE" is end-to-end for the section but not yet self-serve.
2. Variant-managed products stay unsupported (fail-closed, H4-6).
3. Published `OfferCard` is link-only (no add-to-cart) — product page is the purchase surface; revisit if product wants quick-add.
4. Storefront price formatting reuses the existing `ar-SA` formatter (Arabic-Indic digits), Canvas uses `displayLocale` (Latin digits) — pre-existing divergence.
5. Offers rail fetch is not cached beyond Next defaults; relies on the backend's per-request evaluation.
6. Pre-existing header-toolbar overflow at 768/1024 (see §14).

## 17. H4-8 handoff
Integrated QA: end-to-end Canvas↔Published parity against a real Laravel instance (stubbed here); a11y pass with a screen reader; decide on the Offers configuration UI (risk 1); optional `commerce.offers` entry in `DataResourceRegistry` (reads `store/v1/offers`, no id); full-suite CI result on both DB drivers.

## 18. Confirmations
- **Offers is LIVE** (`state: "live"`, `merchantAddable: true`).
- No pricing authority change; no Cart/Checkout/POS/Invoice change; no journal entries.
- **No Merge. No Deploy. No Production release.**
