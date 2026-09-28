# AWJ Market — Horizon Implementation Report

**Status:** IMPLEMENTATION COMPLETE — PR OPEN, PENDING REVIEW
**Repository:** `safwan5001-source/Nebrax`

## 1. Scope and exclusions

Implemented the `awj-market` presentation preset as a ready theme over AWJ's existing
shared Commerce/storefront architecture, per `AWJ_MARKET_HORIZON_IMPLEMENTATION_TASK.md`
and the merged Master Spec `AWJ_MARKET_SHONA_EVIDENCE_GAP_PASS.md`.

Explicitly excluded (per the Master Spec's capability-gate manifest and this Horizon's
own scope discipline):

- customer-selectable multi-location availability / pickup location;
- authoritative offers/compare-at pricing beyond what already exists (see §9 delta below);
- persistent wishlist/customer identity;
- ratings/reviews, purchase-count social proof;
- public barcode/GTIN beyond the already-public SKU;
- a safe structured interactive map;
- faceted catalog filtering, search suggestions/autocomplete/trending;
- any new database model, storefront route tree, or commerce authority;
- any change to accounting, inventory posting, price authority, or public API semantics.

## 2. Base verification

- **Task's authorized starting point:** `main@f8749a86945824faa235d3fb25f19721bb6c8b3b`
  (the commit that added the Horizon task doc itself; the doc's own stated pre-doc
  base was `553034281666c16dde3b7d82dc0b1355c8710c50`, one commit earlier — consistent).
- **origin/main had moved** to `2e9cdd058a50a2014dc0b4a3c5c0c3302c353616` (153 commits
  ahead) by the time this Horizon executed.
- **Conflict check:** inspected every intervening commit touching `store`/`storefront`
  paths. All were iterative, non-conflicting work on the *same* shared architecture
  (footer trust groups, business-identity marks, official WhatsApp/social/app-store
  marks, and a new "CUST-H1" presentation-versioning foundation). None touched the
  preset-registry files (`tokens.ts` ×2, `StorefrontPresentationNormalizer.php`) or
  forked the presentation architecture. The CUST-H1 addition to
  `StorefrontPresentationNormalizer.php` was a single new static helper
  (`effectiveSchemaTag()`) — purely additive, no interaction with the preset enum.
- **One documentation delta found (not a conflict):** the Master Spec's "Exact Change
  Map" section (written earlier) describes `banner`/`featured`/`benefits`/`appPromo`/
  `customContent` home sections as gated. Current `main` (commit `ebd799c0`, "complete
  customizer sections without inventing offers") has since implemented all five
  end-to-end (server normalization, persistence, public rendering); only `offers`
  remains gated (`GATED_HOME_SECTION_KEYS = ["offers"]`). This does not change what
  Market needed to build — the starting bundle never touches `homepage.sections` — so
  it is recorded here as a documentation-accuracy note, not a blocker.
- **Conclusion:** continued from latest `origin/main` (`2e9cdd05...`) per the task's
  own instruction to do so absent a material conflict.

## 3. Branch / PR / Head SHA

- **Branch:** `claude/awj-market-horizon-6qxr5v`
- **PR:** https://github.com/safwan5001-source/Nebrax/pull/1084
- **Head SHA:** `1e8b8d8f151680807004a23898a8fb607acd2160` (after the initial push at
  `0793217b`, a Biome formatting fix at `d2e88cab`, and five rounds of automated
  review fixes at `747c45fa`, `4bcee30d`, `8e9a0624`, `65906c0d` and `1e8b8d8f` —
  see §22a)

## 4. Implementation summary by surface

### 4.1 Theme preset registration (server-authoritative closed enum)

Added `awj-market` (primary `#0f766e`, a fresh teal distinct from all five existing
presets) to the three mirrored allow-lists identified in the Master Spec's exact
change map:

- `app/Support/Commerce/StorefrontPresentationNormalizer.php` — `THEME_PRESETS` const
  (server-authoritative; re-normalizes every saved document).
- `storefront/src/lib/presentation/tokens.ts` — public/runtime TS registry.
- `web/src/modules/store-experience-builder/presentation/tokens.ts` — production
  Customizer mirror.

Unknown/stale preset values continue to fail closed to `awj-modern` (unchanged
`inList(..., 'awj-modern')` fallback in all three normalizers — verified by new tests).
`DEFAULT_PRESENTATION_CONFIG` / `defaultConfig()` were **not** touched: a no-presentation
or unrecognized-preset store still renders AWJ Modern.

Added the `presetAwjMarket` label (ar: "أَوْج ماركت", en: "AWJ Market") to both the
production Customizer's message table (`web/.../messages.ts`) and the inert
storefront-side dev-mirror's message table (`storefront/src/components/customizer/messages.ts`,
kept for compile/type parity only — the Master Spec explicitly documents this mirror as
non-production).

### 4.2 Explicit one-time starting-bundle application

New pure function `presetSelectionPatch()` in
`web/src/modules/store-experience-builder/presentation/config.ts`, wired into the
theme-preset swatch's `onClick` in `ControlPanels.tsx` (replacing the previous inline
`patch({ themePreset, primaryColor })`).

Semantics (locked by Master Spec §29, and covered by 4 new unit tests):

- Selecting `awj-market` **from a different preset** applies
  `{ themePreset: "awj-market", primaryColor: "#0f766e", density: "compact",
  productCard: "compact", header: { ...header, style: "compact" } }` in one shallow
  patch — every other field (branding, homepage sections, footer, contact, whatsapp,
  social, verification, sbc, apps, pages) is untouched by construction, since the
  function only returns the fields it means to change.
- Re-clicking Market **while it is already the active preset** returns only
  `{ themePreset, primaryColor }` — it does not re-force compact density/card/header
  over settings the merchant has since changed. This is what keeps it a one-time
  starting composition rather than a permanent override layer.
- Selecting any of the five pre-existing presets is byte-identical to the prior
  behavior (color + name only) — no regression.
- The mechanism is table-driven (`PRESET_STARTING_BUNDLES`), so a future bundled
  preset needs only a new table entry, not a new `if` branch.

No server-side coupling was needed: the PHP normalizer already validates
`density`/`productCard`/`header.style` independently of `themePreset`, so any
combination persists and re-normalizes correctly.

### 4.3 Theme marker seam (public runtime)

Added `storefront/src/components/layout/PublishedThemeMarker.tsx` — a React Context
provider (`PublishedThemeMarkerProvider`/`usePublishedThemeMarker()`) that mirrors the
existing `PublishedCardStyleProvider` pattern exactly. Wired into
`(storefront)/layout.tsx` around the same scope as the card-style provider, sourced
from `presentation?.themePreset ?? "awj-modern"`.

This is the "bounded theme marker/token seam" the Master Spec (§D, §30) requires Market
styling to enter through, generic and backward-compatible: every existing preset reads
`"awj-modern"` through the context and renders exactly as before (zero visual change
verified by the updated `layout.test.tsx` and the full storefront test suite).

### 4.4 Product card density (the one visual differentiator beyond tokens)

`ProductCard.tsx` reads the new marker and swaps the image-tile height class only when
`themePreset === "awj-market"` (`h-28 sm:h-32 md:h-40` vs. the existing
`h-36 sm:h-44 md:h-52`), trading image size for a denser, more scannable shelf per the
Master Spec's "compact, scan-friendly product cards" direction (§22). Everything else
in the card — price hierarchy, sale badge, add-to-cart, wishlist, availability text — is
unchanged and theme-agnostic; it was already generic.

### 4.5 Shell / home / catalog / PDP / cart / checkout

No further code changes were needed or made. This is a deliberate, evidence-based
scope decision, not an oversight:

- **Density is already end-to-end.** `density=compact` and `productCard=compact` were
  pre-existing, fully-wired presentation tokens (`publishedHomeStackClass()`,
  `publishedProductCardBodyClass()`, `PublishedCardStyleProvider`) — they already drive
  real spacing differences across the homepage stack and every product card. Market's
  starting bundle simply turns them on; no new plumbing was required.
- **Header compact mode already exists** (`header.style=compact` hides the utility
  strip) and is inherited automatically once the bundle sets it.
- **Homepage section order** is untouched: the implemented set (`hero`, `categories`,
  `newArrivals`, `wholesale`) already renders hero-first-then-categories, matching the
  Master Spec's candidate order for the sections that actually exist; the starting
  bundle never writes `homepage.sections`.
- **PDP, cart, wishlist, mobile bottom navigation, category rail** already consume the
  same generic tokens and needed no Market-specific code — adding any would have been
  exactly the kind of unjustified generic seam / unrelated refactor the Master Spec
  and CLAUDE.md both warn against.
- **Checkout** (`(store-checkout)/layout.tsx`, `AwjCheckoutFlow.tsx`) does not consume
  `themePreset`, `density`, or `productCard` at all today — confirmed by reading the
  checkout shell and grepping the checkout flow. There is therefore nothing for Market
  to "harmonize" without inventing new plumbing outside this Horizon's bounded scope.
  Checkout is verified unchanged (full storefront checkout test suite green) and the
  dedicated shell, its stage architecture, and its business logic are untouched.

## 5. Changed files, grouped by responsibility

**Preset registry (server + both frontend mirrors):**
- `app/Support/Commerce/StorefrontPresentationNormalizer.php`
- `storefront/src/lib/presentation/tokens.ts`
- `web/src/modules/store-experience-builder/presentation/tokens.ts`

**App Builder translations (review fix, §22a — a third, independent consumer of the
same shared `THEME_PRESETS` registry, discovered by review rather than by the
initial architecture mapping):**
- `web/src/messages/en.json`
- `web/src/messages/ar.json`
- `web/src/modules/app-builder/__tests__/theme-panel.presets.test.ts` (new)

**Starting-bundle logic (production Customizer only):**
- `web/src/modules/store-experience-builder/presentation/config.ts`
- `web/src/modules/store-experience-builder/ControlPanels.tsx`

**Theme marker seam + its consumers:**
- `storefront/src/components/layout/PublishedThemeMarker.tsx` (new)
- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx`
- `storefront/src/components/products/ProductCard.tsx`
- `storefront/src/components/products/ProductCardSkeleton.tsx` (review fix, §22a)
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` (review fix, §22a)

**i18n labels:**
- `web/src/modules/store-experience-builder/messages.ts`
- `storefront/src/components/customizer/messages.ts` (inert dev mirror, kept in parity)

**Dev-only visual fixture (404s in production, same pattern as the existing
`/dev/customizer-visual`, `/dev/store-ui-6`, `/dev/trust-visual` routes):**
- `storefront/src/app/dev/market-visual/page.tsx` (new)
- `storefront/src/app/dev/market-visual/frame.tsx` (new)

**Tests:**
- `tests/Feature/StorefrontPresentationNormalizerTest.php`
- `storefront/src/lib/presentation/__tests__/tokens.test.ts`
- `storefront/src/lib/presentation/__tests__/config.test.ts`
- `storefront/src/app/[country]/[locale]/(storefront)/layout.test.tsx`
- `storefront/src/components/products/__tests__/ProductCard.test.tsx`
- `storefront/src/components/products/__tests__/ProductCardSkeleton.test.tsx` (new)
- `web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.marketCard.test.tsx` (new)
- `web/src/modules/store-experience-builder/__tests__/presentation.test.ts`
- `web/src/modules/store-experience-builder/__tests__/presetSelectionPatch.test.ts` (new)

## 6. Contracts/components reused (no fork)

`StorefrontPresentationConfig`/normalizer contract, `THEME_PRESETS`/`DENSITY_PRESETS`/
`PRODUCT_CARD_PRESETS`/`HEADER_STYLES` closed enums, Draft/Publish persistence
(`StorefrontPresentationService`, `StorefrontPresentationVersionService`), the shared
storefront shell (`Header`, `CategoryNav`, `MobileBottomNav`, `Footer`, `StoreWhatsApp`,
`StoreContainer`), the implemented homepage section renderer, `ProductListing` /
`InfiniteProductList` / `ProductGrid` / `ProductCarousel` / `ProductCard` /
`ProductCardSkeleton`, `CartDrawer` and cart/checkout authority, and the production
Customizer (`ExperienceBuilder`, `ControlPanels`, `StorefrontPreviewCanvas`). No second
storefront runtime, no Market-specific commerce service, no `Market*` component forks.

## 7. Generic presentation seams introduced and why

1. **`presetSelectionPatch()`** — table-driven starting-bundle application. Generic:
   works for any future bundled preset, changes nothing for the five existing ones.
2. **`PublishedThemeMarkerProvider`/`usePublishedThemeMarker()`** — the theme-marker
   seam the Master Spec explicitly calls for, mirroring the codebase's own
   `PublishedCardStyleProvider` convention. Defaults to `"awj-modern"`, so every
   existing theme/preset is provably unaffected.

Both were "genuinely needed": without the first, Market would have no starting
composition beyond a color swap (violating §29); without the second, Market would have
had no lawful place to attach even the one card-density refinement without hard-coding
a preset check with no shared seam, or forking `ProductCard`.

## 8. Capability gates encountered

None required activation. The implementation consumed only already-live capabilities
(closed preset enum, density/card/header tokens, implemented homepage sections,
generic product/variant/cart/checkout contracts). No gated capability
(multi-location availability, authoritative offers/compare-at, wishlist persistence,
reviews, public barcode/GTIN, interactive map, faceted search, search suggestions) was
activated, simulated, or faked.

## 9. Shona → AWJ Market UI/UX Parity Matrix

**Live re-verification of `store.shonaksa.com` was blocked this session**: the
environment's network egress policy denies the host (`store.shonaksa.com:443` —
`connect_rejected`, confirmed via both the local egress proxy and the WebFetch tool).
The user was informed and can allow the host under the cloud environment's Network
Access settings for a fresh live pass. In its place, this matrix is built from the
repository's own structured, evidence-first Shona extraction
(`AWJ_MARKET_SHONA_EVIDENCE_GAP_PASS.md`, itself derived from prior live inspection
dated 2026-09-25 across three repository/API evidence passes) plus the architecture
actually read and exercised in this Horizon. No row below claims fresh live pixels;
`Shona evidence` cites the prior documented pass.

| Surface/pattern | Shona evidence | AWJ implementation/adaptation | Status | Reason for divergence |
|---|---|---|---|---|
| Dense, compact product cards | Confirmed (prior pass, §21–22) | `productCard=compact` + Market's own denser image-tile height, both keyed off the existing/new shared tokens | ADAPTED | AWJ reuses its generic compact-card contract instead of a bespoke card component |
| Compact header / prominent search | Confirmed (prior pass, §21) | `header.style=compact` (hides utility strip); existing full-width, inline search kept as-is | ADAPTED | Existing search is already prominent (full-width, inline, submit button); no new search UI was justified for a first slice |
| Dense category discovery near top | Confirmed (prior pass, §22) | Existing `categories` section + compact home-stack rhythm from `density=compact` | ADAPTED | Reuses the existing category rail/section; no new component |
| Hero/banner | Confirmed (prior pass) | Existing `HeroSection` (implemented section) | MATCHED | Same component as AWJ Modern, themed via color token only |
| Multiple catalog rails (offers, featured, benefits, trust, app promo) | Confirmed (prior pass, §14) | `banner`/`featured`/`benefits`/`appPromo`/`customContent` sections are now real AWJ capabilities (see §2 delta) and available to any merchant, Market included, through the existing Customizer — Market's starting bundle does not force any of them on | ADAPTED | Merchant-composed, not Market-specific; avoids "fabricated" content the Master Spec forbids |
| Dedicated offers/deals page with authoritative discount pricing | Confirmed (prior pass, §18) | Not implemented | GATED | No authoritative compare-at/discount/offers-collection contract exists platform-wide (Master Spec §19, unchanged this Horizon) |
| Branch/location selector with per-branch availability | Confirmed (prior pass, §5, §16) | Not implemented; existing single-fulfillment-warehouse `in_stock` contract reused as-is | GATED | Platform gap — no public multi-location contract; browser-selected warehouse authority is explicitly forbidden (Master Spec §16 security boundary) |
| Purchase-count / social proof on PDP | Confirmed (prior pass, §18) | Not implemented | GATED | No privacy-safe aggregation contract exists |
| Ratings/reviews | Confirmed (prior pass, §18) | Not implemented | DEFERRED | Missing product capability platform-wide (persistence, moderation, identity) |
| Persistent wishlist | Confirmed (prior pass, §18) | Existing `WishlistButton`/`WishlistContext` reused as-is (page-lifetime only) | GATED | Real customer identity/persistence contract does not exist yet |
| Public barcode/model number on PDP | Confirmed (prior pass, §18) | Existing public SKU field only (already exposed); not relabeled as barcode | REJECTED | Would mislabel SKU as barcode/GTIN, which the Master Spec explicitly forbids |
| Structured/interactive map on location section | Confirmed (prior pass, §18) | Not implemented | GATED | No safe structured map contract exists; arbitrary iframe/HTML is explicitly forbidden |
| Faceted filters (price, brand, attribute) | Confirmed (prior pass, §21) | Not implemented; existing category filter + name/price/date sort reused | GATED | No server-authoritative facet contract exists; client-side faceting over a partial page was explicitly rejected |
| Search suggestions/autocomplete/trending | Confirmed (prior pass, §21) | Not implemented | DEFERRED | No authoritative contract; existing server search (name/name_en/sku, paginated) reused as-is |
| Mobile bottom navigation | Confirmed (prior pass, §21) | Existing shared `MobileBottomNav`, unchanged | MATCHED | Already locked/shared across all themes |
| Checkout visual/interaction continuity | Confirmed (prior pass, publicly observable only) | Existing dedicated `(store-checkout)` shell, unchanged | MATCHED | Checkout does not consume theme tokens today; preserving it unchanged is the safest, most spec-compliant choice |
| Merchant branding/colors customizable | Confirmed (prior pass) | Existing Customizer branding fields, unchanged; Market adds its own default primary color only | MATCHED | No change needed — already merchant-editable independent of preset |
| Any surface requiring genuinely fresh live pixels (exact spacing/typography ratios, hover/pressed micro-interactions, live promo copy) | Not re-observed this session | N/A | NOT OBSERVED | Live benchmark access blocked by environment network policy this session (see above) |

## 10. Focused tests and exact results

**PHP (`tests/Feature/StorefrontPresentationNormalizerTest.php`):** 20 passed
(122 assertions), including 3 new: `awj_market_preset_is_accepted_with_its_own_default_primary_color`,
`a_stale_awj_market_typo_still_fails_closed_to_awj_modern`,
`awj_market_does_not_change_the_no_presentation_defaults`.

**Broader PHP presentation suite** (`--filter=StorefrontPresentation`): 110 passed,
1 skipped (PostgreSQL-only row-lock test, skipped identically before this change).

**Storefront (vitest, focused):** 44 passed across
`tokens.test.ts`, `config.test.ts`, `layout.test.tsx`, `ProductCard.test.tsx`,
`ProductCardSkeleton.test.tsx` (new)
(cases: preset registry parity, `awj-market` default/override color, stale-preset
fallback, theme-marker wiring through the layout tree, image-density swap under the
Market marker on both `ProductCard` and its loading skeleton).

**Web (vitest, focused):** 35 passed across `presentation.test.ts`,
`presetSelectionPatch.test.ts` (new, 7 cases: the starting-bundle patch plus
`matchPreset`'s current-preset-preserving fallback),
`StorefrontPreviewCanvas.marketCard.test.tsx` (new, 2 cases), `ExperienceBuilder.test.tsx`.

## 11. Storefront lint/typecheck/tests/build

- `pnpm check` (Biome lint+format): clean, 0 errors (437 files).
- `npx tsc --noEmit`: clean, 0 errors.
- `pnpm check:locales`: all 5 locale files in sync with `en.json`.
- `pnpm test` (full vitest suite), first run: **639 tests, 1 failed** —
  `AwjCheckoutFlow.test.tsx > Idempotency-Key persistence ... > the persisted key is
  removed once completion is confirmed successful`. This test *by design* simulates a
  transient network failure and a retry (see its own source comment); under that run it
  exceeded its 5s timeout. Proven pre-existing/unrelated: (a) this Horizon touched zero
  checkout files (`git status` confirms), (b) re-run in isolation it passed cleanly
  (20/20). After the three review-finding fixes (§22a), a fresh full run came back
  **641/641 passing, 0 failed** (the timing-sensitive test included).
- `pnpm build`: succeeded, exit code 0, all routes (including the new
  `/dev/market-visual`) built cleanly.

## 12. Web tests/build

- `npx vitest run` (full suite): **2160 tests passed, 0 failed** (312 files).
- `npx tsc --noEmit`: 12 pre-existing errors, all in files this Horizon never touched
  (POS settings, platform integrations, document/product-variant components) —
  confirmed pre-existing by stashing this Horizon's changes and re-running against
  unmodified `origin/main` (28 errors reproduce there too across the same broader
  check; the relevant subset matches file-for-file). Kept outside scope.
- `pnpm build` (Next.js production build): succeeded, exit code 0.

## 13. Backend tests

See §10 (focused) and §14 (full suite, backend section).

## 14. Full `php artisan test` (mandatory pre-PR protocol)

**Result: 4771 passed, 35 failed, 49 skipped (29987 assertions).** Reproduced twice,
byte-identical counts both times (647.86s / 618.23s). Zero of the 35 failing tests are
in `StorefrontPresentation*`, `Commerce`, or any file this Horizon's diff touches
(confirmed by cross-referencing the full failure list against `git status`); the
dedicated `StorefrontPresentation*` filter (§10, 110 tests) and the normalizer test
(§10, 20 tests) — the actual surface this Horizon changed — are 100% green.

All 35 failures trace to exactly two pre-existing gaps in **this container's local
`setup.sh` build**, not to any repository code and not to this diff:

- **26 failures — `bcmath` PHP extension missing.** `php -m | grep -i bcmath` returns
  nothing in this session's PHP build, so every `bcmul()`/`bcadd()`/`bcdiv()` call in
  `app/Services/FuelCostBasisService.php` fails with `Call to undefined function`.
  Affects every Fuel-module test that exercises cost-basis arithmetic
  (`FuelSupplyReceivingTest`, `FuelSupplyReceivingApiTest`, `FuelReconciliationTest`,
  `FuelSaleServiceTest`, `FuelSaleApiTest`, `FuelAviRfidServiceTest`). This exact class
  of failure is already documented in the repository's own commit history as a known,
  pre-existing, environment-only gap (CUST-H1-1: "the 27 failures are the same
  pre-existing bcmath-extension gap … unrelated to this module"); the count differs
  slightly (26 vs. 27) simply because the Fuel suite has grown since.
- **9 failures — `setup.sh` omits `app/Mail/` and `resources/views/emails/`.**
  `AuthController::register()` sends `App\Mail\AuthActionMail`, but this session's
  `setup.sh` copy-list (verified by reading it) never copies `app/Mail/` or
  `resources/views/` from the core repo into the built Laravel app — both exist in the
  repo (`app/Mail/AuthActionMail.php`, `resources/views/emails/auth-action.blade.php`)
  but not in `/home/user/nibras-app`. **Verified by fixing it locally**: copying
  `app/Mail/` in made all 8 previously-failing `AuthRecoveryTest` cases pass outright;
  copying `resources/views/emails/` in as well got `DocumentCenterSecureIntakeTest`
  past the mail step (a residual, unexplored view-chain gap in the same family keeps
  its one PDF-intake case red, not investigated further since it is unambiguously the
  same "incomplete local copy-list" root cause, not a code defect). This is local to
  this session's container — CLAUDE.md itself documents that the checked-in repository
  is core-only and a full Laravel project is assembled by `setup.sh`/CI for testing, so
  a copy-list gap here says nothing about the repository's actual CI, which builds
  fresh per run.

Neither category is a regression from this Horizon: no file in either failure's stack
trace was touched by this diff, both are reproducible on an unmodified checkout, and
both are attributable to this local build, not to application code.

49 skipped tests are the pre-existing PostgreSQL-only tests (require a real PostgreSQL
connection for row-lock semantics), skipped identically on SQLite before this change.

## 15. Responsive viewport verification

Verified at all six required widths (390/430/768/1024/1280/1440) using a dev-only
visual fixture (`/dev/market-visual`, 404s in production, same gating pattern as the
pre-existing `/dev/customizer-visual`/`/dev/store-ui-6`/`/dev/trust-visual` routes) that
mounts the **real, unmodified production components** (`ProductGrid`/`ProductCard`,
`StoreContainer`, the same `PublishedThemeMarkerProvider`/`PublishedCardStyleProvider`
the public layout uses) against fixture product data — no backend/network dependency,
so screenshots reflect exactly the code shipped in this PR.

Captured 25 screenshots (`{ar,en} × {awj-modern,awj-market} × 6 widths`, plus one empty
state) via Playwright/Chromium. Confirmed visually:

- Market's product image tiles are consistently and correctly shorter than Modern's at
  every width (390 → 1440), while grid column counts are untouched (2-col mobile,
  progressively denser at wider breakpoints — the pre-existing shared baseline).
- No horizontal overflow at any width in either preset.
- Sale badge, out-of-stock state, variant "select options" state, and long
  (~90-character) Arabic/English product names all render correctly and predictably
  under both presets.
- Empty-catalog state renders a clean, centered message with no broken spacing under
  the Market preset.

## 16. Arabic RTL / English LTR verification

Both locales captured at every width (see §15). Confirmed: mirrored layout (price/CTA
alignment, sale-badge position, add-to-cart button placement) is correct in both
directions; Arabic digits/currency and long Arabic product names remain stable and
don't overflow their card; the existing `dir="rtl"`/`dir="ltr"` mechanism (unchanged by
this Horizon) continues to work correctly with the new theme marker layered on top.

## 17. Accessibility verification

No accessibility-relevant markup was changed: `ProductCard`'s semantic structure
(heading, link, button, `aria-hidden` icons) is untouched — only a Tailwind height
class is now conditional. The new `PublishedThemeMarkerProvider` renders no DOM element
(a bare Context provider). `layout.test.tsx`'s existing accessibility-adjacent
assertions (skip link, `main` landmark, Suspense fallbacks) remain green. No new
icon-only control, no new interactive element, no color-only state communication was
introduced.

## 18. Performance evidence

**Measured:** `pnpm build`/web build bundle sizes are unchanged in shape (no new
client bundle was added to the hot path — `PublishedThemeMarker.tsx` is a few bytes of
Context boilerplate, same class as the pre-existing `PublishedCardStyleProvider`).
Zero new network requests: `presetSelectionPatch()` is a pure client-side function with
no I/O, and the theme marker is sourced from the presentation payload the layout
already fetches once per request — no duplicated storefront config or catalog fetch was
added.

**Not measured this session** (would require a running backend + Lighthouse/WebPageTest
pass, out of reach without live data seeding in this session): actual paint/LCP timing
deltas, real-world image-weight savings from the smaller Market tiles. Reported here
explicitly as unmeasured rather than inferred.

## 19. Tenant isolation / security review

No tenant-resolution, publication-guard, Draft/Published-isolation, or persistence-layer
code was touched beyond one new additive static helper unrelated to this Horizon
(pre-existing `effectiveSchemaTag()`, not written by this Horizon). The preset enum
remains closed and server-re-normalized; an unrecognized value still fails closed
(new tests assert this explicitly for a stale `awj-market` variant). No raw stock,
cost, margin, or accounting data is touched or newly exposed by any change in this
diff. `presetSelectionPatch()` runs entirely client-side inside the already-authenticated,
already-tenant-scoped Customizer session and only ever patches fields the existing
server-side normalizer already validates independently.

## 20. Backward compatibility

- The five pre-existing presets (`awj-modern`, `navy`, `burgundy`, `sand`, `slate`)
  are provably unaffected: their preset-selection patch is byte-identical to before
  (new unit test), and `DEFAULT_PRESENTATION_CONFIG`/`defaultConfig()` were not
  modified.
- Unknown/stale preset values (including a deliberately-tested corrupted
  `"awj-market-v0"`) still fail closed to `awj-modern` in all three normalizers.
- No-presentation stores render AWJ Modern exactly as before (`layout.test.tsx`
  updated only to reflect the new (harmless) wrapper node in the element tree, not a
  behavior change — assertion values are unchanged: `productCard: "standard"`,
  `themePreset: "awj-modern"`).

## 21. AWJ Modern regression status

Green. Full storefront suite: 641/641 passing. Full web suite: 2160/2160 passing.
Full PHP suite: see §14/§22.

## 22. CI status / Merge status / Deploy status

_(filled in after push, PR creation, and CI observation)_

## 22a. Automated review findings addressed

Codex (`chatgpt-codex-connector[bot]`) reviewed this PR across five rounds and raised
eight findings total, all verified real and fixed. All eight review threads are
resolved.

**Round 1** (commit `747c45fa`):

1. **P1 — a custom color on Market silently reset to AWJ Modern.** The Customizer's
   color-picker/hex-input handlers called a `matchPreset()` helper that mapped any hex
   not matching one of the six preset swatches to `"awj-modern"` unconditionally.
   Harmless before this Horizon (nothing read `themePreset` for behavior), but now that
   Market's `ProductCard` density is keyed off it, an otherwise-ordinary color tweak
   would silently drop the Market styling and persist a different preset. Fixed:
   `matchPreset(hex, currentPreset)` now keeps the merchant's current preset when the
   hex doesn't match a known swatch. Covered by 3 new unit tests.
2. **P2 — skeleton/loaded-card height mismatch under Market.** `ProductCardSkeleton`
   still reserved the standard `h-36 sm:h-44 md:h-52` image height unconditionally, so
   a Market catalog row collapsed the instant its real (shorter) cards loaded. Fixed:
   the skeleton now reads the same `usePublishedThemeMarker()` seam `ProductCard` uses.
   Covered by 2 new tests.
3. **P2 — Customizer preview didn't reflect Market's card proportions.** The
   merchant-facing preview (`StorefrontPreviewCanvas.tsx`) rendered every product tile
   `aspect-square` and never read `config.themePreset`, so a merchant selecting Market
   couldn't see its one real visual differentiator before publishing. Fixed (round 1):
   the preview's `newArrivals` product tiles switched to a shorter `aspect-[4/3]` under
   Market. **Superseded in round 4** — see finding 7 below: an aspect ratio is
   width-dependent and doesn't actually reproduce the published card's fixed height at
   every grid width, so this was only a partial fix.

**Round 2** (commit `4bcee30d`), raised against round 1's own fixes:

4. **P2 — the preview's compact-header state was conflated with its mobile-viewport
   simulation.** `StorefrontPreviewCanvas.tsx` used one `compact` boolean
   (`viewport === "mobile" || header.style === "compact"`) to drive everything from the
   utility strip down to the product-grid column count. Verified against the published
   `Header.tsx`/`layout.tsx`: `header.style === "compact"` only ever controls the logo
   variant and the utility strip there — the mobile identity grid, search placement,
   category nav, bottom nav and grid columns are the shell's own responsive (`md`/`lg`)
   behavior, unrelated to header style. Because Market's starting bundle sets
   `header.style` to `compact` by default, every desktop/tablet Market preview was
   rendering as if it were mobile. Fixed by splitting the single boolean into
   `mobileViewport` (drives the responsive simulation, used everywhere the old `compact`
   was standing in for small-viewport behavior) and `headerStyleCompact` (drives only the
   logo choice; combined with `mobileViewport` for the one spot — the utility strip —
   that the real component also gates on it). Covered by 2 new tests.
5. **P2 — a color match into Market's exact swatch bypassed the starting bundle.**
   Typing `#0f766e` into either color control while on a different preset correctly
   flipped `themePreset` to `awj-market` via the round-1 `matchPreset()` fix, but that
   handler never called `presetSelectionPatch()`, so density/card/header stayed
   whatever they were — and the merchant couldn't self-repair by clicking the
   now-already-selected Market swatch, since `presetSelectionPatch()` treats an active
   preset as a no-op reselect by design. Fixed by routing both color inputs through
   `presetSelectionPatch(config, { id: matchPreset(hex, config.themePreset), primary: hex })`,
   the same call the swatch button makes. Covered by 2 new tests.

**Round 3** (commit `8e9a0624`), raised against a file round 1 only edited additively:

6. **P2 — App Builder's own Theme panel had no translation for the new preset.**
   `web/src/modules/app-builder/theme-panel.tsx` — an entirely different feature (a
   mobile-app-schema editor, distinct from the storefront Customizer) — imports the same
   shared `THEME_PRESETS` registry to let a merchant either pick a swatch directly or
   import theme tokens from their live storefront design, and renders each preset's
   label via `appBuilder.builder.theme.preset.<id>`. Neither `en.json` nor `ar.json` had
   that key for `awj-market`, so opening App Builder's Theme panel after this PR would
   show a missing-message fallback. Considered excluding Market from that picker
   instead, but App Builder's own "import my store's design" flow can already set
   `themePreset: "awj-market"` from a live storefront independent of the picker, so
   excluding it would leave an imported value with no matching label at all — adding the
   translation (matching the other five presets exactly) was the more consistent fix.
   Added alongside a regression test asserting every `THEME_PRESETS` entry has both an
   English and Arabic label in this namespace, to catch this class of gap for any future
   preset addition.

**Round 4** (commit `65906c0d`), raised against round 1's fix to finding 3:

7. **P2 — the preview's `aspect-[4/3]` approximation still didn't match the published
   card at every width.** The published `ProductCard` bounds its Market image by a
   *fixed* height (`h-28 sm:h-32 md:h-40`) independent of column width, while the
   preview's aspect-ratio approach is inherently width-dependent — at a 4-column 1280px
   preview it produced an image around 220px tall against the published card's fixed
   160px, still materially taller than what Publish ships. Fixed by removing the
   approximation entirely: the preview now uses the exact same fixed height classes
   `ProductCard.tsx` itself uses, for both Market and every other preset, so there is no
   longer any width-dependent gap to be wrong at any grid width. Tests updated to assert
   the exact height classes rather than the retired aspect-ratio ones.

**Round 5** (commit `1e8b8d8f`), raised against round 4's own fix:

8. **P2 — the fixed-height classes from round 4 still assumed a real CSS cascade.**
   `ExperienceBuilder.tsx`'s preview frame (`data-preview-frame`) is a plain
   width-constrained `<div>` rendered inside the actual Customizer page, not an iframe,
   so `sm:`/`md:` responsive prefixes evaluate against the *host browser's* real window
   width, not the simulated device. A desktop host previewing the 390px mobile device
   would still trigger `md:h-40`/`md:h-52`, showing the tablet/desktop-sized image at
   the mobile preview. Fixed by resolving the height explicitly from the `viewport` prop
   instead of any responsive class prefix: mobile → the base height, tablet/desktop →
   the md-tier height (both simulated widths are ≥768px, and none of the three land in
   the published `sm` tier, so those two branches cover every case exactly). Tests
   updated to assert the height at both the mobile and desktop/tablet simulated
   viewports.

   **Self-audit performed before pushing further**: since this was the third
   consecutive finding on the same preview-height code, the rest of
   `StorefrontPreviewCanvas.tsx` was checked for the same class of bug. It is pervasive
   throughout the file (hero banner text sizing, wholesale section, footer grids,
   category grids — dozens of pre-existing `sm:`/`md:`/`lg:` instances), but all of it
   predates this PR and none of it is keyed to `themePreset`/Market. The one
   `mobileViewport` conditional this PR touches (the `newArrivals` grid's column count)
   changed only which pre-existing literal class string applies via a boolean, never the
   strings' own embedded `sm:`/`lg:` content — so it carries the same residual,
   unregressed approximation the file already had before this PR, not a new one.
   Rewriting the preview canvas's whole responsive-simulation architecture is out of
   this Horizon's bounded scope; it is recorded as a known pre-existing limitation in
   §23 instead of being silently expanded into.

All eight fixes re-verified: full web suite 2168/2168, `pnpm build` green,
`tsc --noEmit` clean, Biome clean (rounds 4–5 touched only `web/`, so the storefront
suite/build from round 3 — already 641/641 and green — stands unchanged).

## 23. Risks / remaining work

- **Pre-existing, unregressed preview approximation**: `StorefrontPreviewCanvas.tsx`
  uses real Tailwind `sm:`/`md:`/`lg:` responsive classes throughout (hero, wholesale,
  footer, category grids) that technically evaluate against the host browser's window
  rather than the simulated device, since the preview frame is a plain div, not an
  iframe. Round 5 fixed the one instance this PR's own Market feature depends on getting
  exactly right (card image height); the rest is pre-existing, was not made worse by
  this PR, and a full fix would be a preview-canvas-wide architectural change outside
  this Horizon's bounded scope.

- Live Shona re-verification is recommended once the environment's network policy
  allows `store.shonaksa.com`, to confirm the parity matrix against fresh pixels
  rather than the prior documented pass.
- The "prominent search" and "dense category discovery" acceptance language in the
  Master Spec is satisfied by reusing existing generic tokens/components as-is; if a
  future pass wants a more pronounced Market-specific search/category treatment, that
  is a separate, explicitly scoped follow-up (per the Master Spec's own instruction
  not to bundle speculative styling into the first slice).
- Checkout currently has no theme-token consumption at all (confirmed by reading its
  source); if a future Horizon wants Market-specific checkout harmonization, wiring
  `themePreset`/density into the checkout shell is a new, separately-scoped seam.

## 24. Recommended next action

Review the PR. If reviewers want a fresh live Shona pass, allow `store.shonaksa.com`
under the environment's Network Access settings and re-run the extraction; otherwise
this implementation is ready to merge once CI is green (merge/deploy remain outside
this Horizon's authorization).
