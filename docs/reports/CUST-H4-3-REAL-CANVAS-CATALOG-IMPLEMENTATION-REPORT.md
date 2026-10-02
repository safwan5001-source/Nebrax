# CUST-H4-3 — Real Canvas Catalog Parity for Categories / New Arrivals — Implementation Report

**Horizon:** CUST-H4 — Section Library & Real Section Activation
**Slice:** H4-3 (Real Canvas catalog parity for Categories / New Arrivals)
**Base SHA:** `de8eee89e838c25d14f1e7c2064eff1d1720c633` — `feat(store): build CUST-H4 Section Library (H4-2) (#1154)` (verified directly via `git fetch origin main && git rev-parse origin/main` at task start; confirmed as `origin/main`'s own HEAD, not assumed from the task brief)
**Head SHA:** `f4f17405ccc2f152a9e0ec3ed2840d04900b601c`
**Branch:** `claude/tender-heisenberg-wzfczm` — **deviation from the task's suggested `feat/cust-h4-3-real-canvas-catalog`**, per this session's own Git Development Branch Requirements, which mandate developing on this pre-assigned branch name. Reported per the task's own "If the environment mandates another branch name, use it and report it" instruction.
**PR:** [safwan5001-source/Nebrax#1167](https://github.com/safwan5001-source/Nebrax/pull/1167), open against `main`, not merged

---

## 1. Scope actually implemented

Per the task brief and `CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §5/§21/§35 (H4-3's own definition, "confirmed to need no new backend work... can run fully in parallel"):

- Replaced the Home **"categories"** section's Canvas preview (`StorefrontPreviewCanvas.tsx`) from the static `PREVIEW_CATEGORIES` fixture to the real, tenant/storefront-scoped workspace categories read, filtered to root-level only (`parentId === null`) — matching Published's own `depth_eq: 0` semantics (`CategoriesSection.tsx`).
- Replaced the Home **"newArrivals"** section's Canvas preview from the static `PREVIEW_PRODUCTS` fixture to the real workspace products read, ordered by recency — matching Published's own `-available_on` (→ `created_at` desc) semantics (`NewArrivals.tsx`).
- Added honest loading/empty/error states for both sections, with a retry affordance on error, never a fallback to fake data.
- Added stale-response protection (a storefront switch, or a version switch, cannot let a slower previous request overwrite the newer one) and request dedup (each section fetches once per storefront, gated on the section actually being visible in the real, loaded config — not the transient default config shown before the Version loads).
- **One small, additive, backward-compatible backend change** (escalated to and approved by the owner before implementation — see §2): an optional `sort=newest` query parameter on the existing `CommerceWorkspaceStorefrontProductController::index` endpoint, needed because that endpoint had no way to reproduce Published's recency ordering for New Arrivals otherwise (the task brief's own named stop condition — see §2).

**Explicitly not touched**, per the task's scope guards: the header category-nav chip row and the footer "Shop" column, which still render from `PREVIEW_CATEGORIES` — these are unrelated chrome surfaces (not the "categories"/"newArrivals" home *sections* this task targets), confirmed in evidence-gathering and left exactly as they were (see §9's "Risks" for why, and why fixing them is out of this slice's bounded scope). No Banner/AppPromo/Featured/Offers work (H4-4/H4-5/H4-6/H4-7). No pricing/checkout logic. No persisted schema/section-content-contract change.

---

## 2. Stop-and-report resolution: the `sort=newest` backend touch

The task brief explicitly names this exact situation as a STOP trigger: *"New Arrivals Published semantics cannot be reproduced from the existing workspace API without an API change."* Evidence gathered before writing any code:

- Published's `NewArrivals.tsx` fetches with `sort: "-available_on"`, documented in its own comment as mapping to the catalogue's `created_at`, descending — "that is why this shelf is titled 'new arrivals'... AWJ exposes no featuring, ranking or sales-volume signal."
- `CommerceWorkspaceStorefrontProductController::index` — the endpoint H4-3 is told to reuse — had **no sort parameter at all**: hardcoded `orderBy('name')->orderBy('id')`, and the payload didn't even carry `created_at` for a client-side sort to fall back on.

Per the task's own instruction, this was surfaced to the user **before any code was written**, with three options (add a minimal additive backend sort param / ship with a documented alphabetical-order gap / stop entirely). The user selected **"Add minimal optional sort param"**. The resulting change (§4) is strictly additive: a new, optional, allow-listed `sort=newest` value; every existing caller (the raw Featured product-id input, the Product/Category preview pickers) omits `sort` and keeps today's exact alphabetical order, verified by a dedicated regression test (§7).

---

## 3. Files changed

```
 app/Http/Controllers/Api/CommerceWorkspaceStorefrontProductController.php     |  25 ++-   (M)
 tests/Feature/CommerceWorkspaceStorefrontProductApiTest.php                   |  76 ++++   (M)
 web/e2e/cust-h4-3-real-canvas-catalog-visual.spec.ts                          | 182 +++    (A, new)
 web/src/modules/commerce-workspace/workspace-products.test.ts                 |  12 +      (M)
 web/src/modules/commerce-workspace/workspace-products.ts                      |   6 +      (M)
 web/src/modules/store-experience-builder/ExperienceBuilder.tsx                | 118 ++++    (M)
 web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx          | 210 ++++--- (M)
 web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.categoryRegions.test.tsx | 6 +- (M)
 web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.homeCatalog.test.tsx     | 270 +++ (A, new)
 web/src/modules/store-experience-builder/messages.ts                          |  16 +      (M)
 web/src/modules/store-experience-builder/preview-fixtures.ts                  |  24 +-     (M)
```

Zero database migrations. Zero changes to `routes/api.php` (the sort param is a query-string addition to an existing route, not a new route). Zero changes to `section-content.ts`, `GATED_HOME_SECTION_KEYS`, persisted presentation schema, or publish lifecycle.

---

## 4. Backend change — `sort=newest`

`CommerceWorkspaceStorefrontProductController::index` (`app/Http/Controllers/Api/CommerceWorkspaceStorefrontProductController.php`):

```php
'sort' => ['sometimes', 'nullable', 'string', 'in:newest'],
...
if (($filters['sort'] ?? null) === 'newest') {
    $query->orderByDesc('created_at')->orderByDesc('id');
} else {
    $query->orderBy('name')->orderBy('id');   // unchanged default
}
```

No financial/accounting impact — this controller is a read-only Commerce-catalog preview endpoint; it never calls `LedgerService::post`, writes no `journal_lines`/`journal_entries`, and this diff touches only the backend's product **ordering** on an existing read. **No journal entry is generated by this change or by H4-3 as a whole** (same posture as H4-2's own report).

---

## 5. Categories data flow

1. `ExperienceBuilder.tsx`'s new `loadHomeCategories()` calls the **unmodified** `listWorkspaceCategories(storefrontId, { perPage: 50 })` (`@/modules/commerce-workspace/workspace-categories`) — the exact client CUST-H2-4 already shipped and the Category-page preview picker already uses, called with different (home-section-appropriate) params.
2. The result is filtered client-side to `category.parentId === null` (root only) — the payload already carries `parent_id` for every row, so no new backend capability was needed here, unlike New Arrivals.
3. Sliced to 12 (matching Published's own `HOME_CATEGORY_LIMIT` default in `CategoriesSection.tsx`).
4. Passed to `StorefrontPreviewCanvas` as `homeCategories: { id, name }[]` + `homeCategoriesState`.
5. `StorefrontPreviewCanvas`'s `"categories"` branch renders these as real tiles (name only — see §9 on the `color`/child-count gap), with loading-skeleton/empty/error states.

**Authority chain**: authenticated user → `SetTenant`/`SetBranch` → `EnsureActiveSubscription` → `EnsurePermission:commerce.manage` → `ownedStorefront()` (tenant-id equality check, 404 not 403 on mismatch) → `CommerceCategoryListing::publishedOn($storefront->sales_channel_id)` — unchanged, no new write path, no client-supplied tenant/storefront override possible (same contract CUST-H2-4's own 8-scenario isolation test suite already locks down, untouched by this slice).

## 6. New Arrivals data flow

1. `loadHomeNewArrivals()` calls `listWorkspaceProducts(storefrontId, { sort: "newest", perPage: 8 })` — the one new, additive param (§2/§4).
2. Backend orders by `created_at desc, id desc` — the same semantic rule Published's `-available_on` sort already applies.
3. Result passed to Canvas as `homeNewArrivals: { id, name, thumbnailUrl }[]` + `homeNewArrivalsState`.
4. Canvas renders real product cards: real name, real thumbnail (or an honest empty tile when the product has no media — never an invented photo), no price/stock/discount ever shown (Featured's own established "presentation holds no commerce facts" precedent, unchanged here since this section doesn't even persist product references, only renders a live-fetched preview).

**Authority chain**: identical to Categories, through `CommerceListing::query()->where('sales_channel_id', $storefront->sales_channel_id)->where('is_published', true)` — unchanged by the `sort` addition.

---

## 7. Canvas ↔ Published parity evidence

| | Canvas (this slice) | Published |
|---|---|---|
| Categories scope | root-level only (`parentId === null`, client-filtered) | `depth_eq: 0` (`CategoriesSection.tsx` → `store/v1/categories`) |
| Categories channel/tenant | `Storefront.sales_channel_id` via `ownedStorefront()` (authenticated workspace) | `SalesChannel` resolved via `ResolveStorefrontDomain`/`StorefrontContext` (Host-resolved public) |
| New Arrivals order | `created_at` desc (`sort=newest`, new) | `created_at` desc (`-available_on`, existing) |
| New Arrivals channel/tenant | same `ownedStorefront()` authority | same Host-resolved public authority |
| Eligibility rule | `is_active` + `CommerceListing`/`CommerceCategoryListing` published on *this* channel | identical rule, same underlying tables, applied via the public read path |

Per the task's own framing ("HTTP surfaces may differ... the important parity requirement is: same tenant/storefront sales channel, same publication eligibility, same section meaning, same real catalog truth"), parity is structural (same source tables, same eligibility predicate, same ordering rule), not a shared HTTP route — exactly the accepted shape for every other already-real section in this Horizon.

Visually confirmed (§11): the exact same 3 root categories and 3 products that `MOCK_WORKSPACE_CATEGORIES`/`MOCK_WORKSPACE_PRODUCTS` (the dev fixture's stand-in for the real backend) expose, with the 2 non-root categories correctly excluded.

---

## 8. Request dedup / reuse, stale-response protection, loading/empty/error

- **Dedup**: each fetch is gated on `homeCategoriesState === "idle"` / `homeNewArrivalsState === "idle"` (same convention as the existing `productListState`/`categoryListState` pickers) — a re-render, a page switch away and back, or toggling an unrelated draft field never re-issues the request once loaded. Verified by a dedicated test (`ExperienceBuilder.homeCatalog.test.tsx`, "does not issue a redundant duplicate fetch once a section has loaded").
- **No premature fetch against the wrong config**: both fetch effects additionally gate on `busy !== "loading"` — `draft` starts as the transient `DEFAULT_PRESENTATION_CONFIG` before the real, persisted Version config loads (a pre-existing seam in `ExperienceBuilder`'s own reset effect), and evaluating section-visibility against that placeholder could fire a fetch for a section the merchant's actual saved homepage doesn't even show. This surfaced as a real test failure while building this slice and was fixed before, not after, the PR.
- **No fetch for a hidden section**: gated on `categoriesSectionVisible`/`newArrivalsSectionVisible` (derived from the real, loaded `draft.homepage.sections`) — a merchant who removed one of these sections never triggers its fetch. Verified by a dedicated test.
- **Stale-response protection**: the same `storefrontIdRef` + per-request token-ref pattern every other preview fetch in this file already uses (`productListRequestRef`, `categoryListRequestRef`, etc.) — a slower, earlier storefront's response arriving after a switch is discarded, never overwrites the newer storefront's already-rendered data. Verified by a dedicated test simulating a slow store-1 response resolving after a switch to store-2.
- **Loading**: a skeleton with the exact same responsive grid classes (`categoriesColumns`/`newArrivalsColumns`/`cardImageHeight`) the real content uses — no fake names/prices, `idle` (not-yet-fetched) renders identically to `loading` rather than jumping to an "empty" claim before the real answer is known.
- **Empty**: an honest, merchant-facing message (`homeCategoriesEmpty`/`homeNewArrivalsEmpty`, ar+en), visually distinct from the error state (dashed border, no retry button).
- **Error**: a concise message (`homeCategoriesLoadFailed`/`homeNewArrivalsLoadFailed`) with a working retry button, no raw technical error text, never a fallback to fake content. Verified by a dedicated test including a successful retry recovering real data.

---

## 9. Tenant/security boundaries

- No new route, no new controller, no new middleware. The `sort` addition goes through the exact same `auth:sanctum` → `SetTenant` → `SetBranch` → `EnsureActiveSubscription` → `EnsurePermission:commerce.manage` → `ownedStorefront()` chain every sibling route in this group already enforces.
- `sort=newest` cannot select or widen tenant/storefront/channel scope — it only changes `ORDER BY` on a query whose `WHERE` clause (tenant scope via `Product`'s own `BaseModel`, channel scope via `CommerceListing::sales_channel_id`) is unchanged and untouched by this diff.
- New backend test `sort_newest_still_respects_tenant_isolation_and_eligibility` proves a second tenant's product never appears under `sort=newest` for the first tenant's storefront.
- New backend test `an_unsupported_sort_value_is_rejected` proves the allow-list (`in:newest`) rejects anything else with a 422, not a silent fallback or a 500.
- The existing 8-scenario tenant-isolation/404-vs-403/payload-minimization suite for this controller (foreign storefront, foreign product id, inactive subscription, self-service role denial, tenant-id injection via query/body, cost/margin field leakage) was re-run in full and is untouched and green (§12).
- `listWorkspaceCategories` is called entirely unmodified — no new backend surface for Categories at all.

---

## 10. Tests and exact results

**Backend** (`php artisan test --filter=CommerceWorkspaceStorefrontProductApiTest`, run from the scaffolded `nibras-app` project):
```
21 tests passed (89 assertions) — 17 pre-existing + 4 new (default-order-unchanged, sort=newest ordering, sort=newest tenant isolation, invalid sort rejected)
```

**Backend, full suite** (`php artisan test`, no `--filter`, 911s):
```
4978 passed, 59 failed, 51 skipped (31090 assertions)
```
The 59 failures are the exact same `Class "App\Mail\AuthActionMail" not found` scaffold-only artifact H4-2's own report documented and confirmed green on the PR's real CI (§12 of that report) — this session's local `nibras-app` checkout, not a real repository issue, and not touched by this diff. Passed count is +5 over H4-2's own documented `4973` baseline, matching the 4 new product-controller tests plus net test-count drift from this session's own scaffold; zero new failures.

**Frontend, targeted** (`npx vitest run`):
```
src/modules/commerce-workspace/workspace-products.test.ts            12 tests passed (+1: sort=newest query param)
src/modules/store-experience-builder/__tests__/ExperienceBuilder.homeCatalog.test.tsx   8 tests passed (new file)
src/modules/store-experience-builder/__tests__/ExperienceBuilder.categoryRegions.test.tsx   14 tests passed (1 assertion adjusted — see below)
src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.marketCard.test.tsx   16 tests passed (unchanged — confirms the idle-state grid-class regression was caught and fixed, not merely avoided)
```

One pre-existing test's assertion needed adjustment, not weakening: `ExperienceBuilder.categoryRegions.test.tsx`'s "zero Products in the category" test asserted `listWorkspaceProducts.mock.calls[0]` was the category-grid call — no longer safe once the Home page's own new "New Arrivals" fetch (fired before the test switches to the Category page) also calls the same mocked client. Fixed to search all calls for the one carrying `categoryId`, preserving the exact same coverage.

**Frontend, full module + route group**:
```
web/src/modules/store-experience-builder + web/src/modules/commerce-workspace    440 tests passed, 0 failed
src/app/(commerce)/commerce/appearance                                           41 tests passed, 0 failed
```

**Frontend, full suite** (`npm test`):
```
346 test files, 2674 tests passed, 0 failed
```

**TypeScript** (`npx tsc --noEmit`): same pre-existing, unrelated error set H4-2's own report documented on `main` (`pos/settings/configuration`, `gemini-card`, `document-language-selector`, `product-*`, `use-document-label-mode`, `useImportJobEngine`) — none of this slice's changed files appear in the list.

**Build** (`npm run build`): `✓ Compiled successfully in 22.5s`, `✓ Generating static pages (179/179)`.

---

## 11. Visual QA

Real browser QA via the pre-installed headless Chromium (`/opt/pw-browsers/chromium-1194`), the repository's existing Playwright e2e harness, and the `/dev/customizer-versions` demo fixture — same fixture `cust-h2-2-page-navigator.spec.ts`/`cust-h4-2-section-library-visual.spec.ts` already use (mounts the real `ExperienceBuilder`, no Laravel server, no login). New spec: `web/e2e/cust-h4-3-real-canvas-catalog-visual.spec.ts`, 4/4 passed.

**A fixture quirk discovered, not caused, by this slice**: every scenario this fixture seeds (`seedMockPresentationVersions`) defaults to `config: { version: 2 }` with no `homepage.sections` — and CUST-H4's own V2 document rule treats an explicit-but-empty section list as "the merchant cleared it" (unlike a pre-V2 legacy document, which falls back to the default 4 sections). This means the Home page in **every** scenario this fixture offers starts with zero rendered sections — a pre-existing fixture property this slice did not create and did not change. This spec adds the "categories"/"newArrivals" sections itself through the real, already-shipped CUST-H4-2 Section Library `onAdd` flow (the same interaction a merchant actually performs), rather than editing the shared fixture's seeding — keeping this slice's footprint to its own files.

The fixture's demo-mode `mockApi()` already had dedicated handlers for the exact real routes this slice wires up (`MOCK_WORKSPACE_PRODUCTS`/`MOCK_WORKSPACE_CATEGORIES`, built for CUST-H2-3/H2-4's own visual QA) — this slice reuses that data as-is, adding none of its own.

**Screenshots actually opened and inspected** (not just asserted on):

- **AR 390** (`ar-390-home-catalog.png`) — the real "تصنيف فارغ" (Empty category) root-tile and the real "وصل حديثاً" product shelf (an honest empty-image placeholder for a product with no media) render behind the open Homepage composer sheet; no horizontal overflow; RTL confirmed.
- **AR 430** (`ar-430-home-catalog.png`) — same checks at the wider mobile width; layout holds.
- **AR desktop** (`ar-desktop-home-catalog.png`, 1440×960) — full confirmation: "تسوق حسب التصنيف" shows exactly the 3 real root categories (`الدراجات الهوائية ومستلزماتها`, `إكسسوارات متنوعة`, `تصنيف فارغ`) with the 2 non-root categories (`دراجات الطريق`, the deep one) correctly excluded; "وصل حديثاً" shows all 3 real mock products (`منتج بسيط بلا وصف`, `قميص قطني` — both honestly imageless; `خوذة دراجة هوائية مقاومة للصدمات...` — with its real thumbnail). The header category-nav chips and footer "Shop" column are visibly still the old static fixture (`الإلكترونيات`, `المنزل`, ...) — confirming, visually, that those two out-of-scope chrome surfaces were correctly left untouched while the two in-scope sections now show real data.
- **EN desktop** (`en-desktop-home-catalog.png`, 1440×960) — same real categories/products render correctly under an English UI with `dir="ltr"`; the category/product *names* themselves stay in Arabic (the only language this catalog data has — no `name_en` column on categories, and this slice follows the existing `ProductPreviewPickerPanel.tsx` convention of never switching a rendered name by locale), which is the honest behavior, not a bug.

**Not covered in this pass**: a genuinely empty real-catalog screenshot (the fixture's mock handlers always return the same 3 products / categories regardless of scenario) and a genuinely errored real-network screenshot (same reason) — both states are instead covered by the Vitest integration suite (§10), which directly controls the mocked client's resolution and asserts the exact empty/error markup, retry behavior, and absence of fake content. 768/1024/1280 tablet widths were not captured as separate screenshots; the Canvas's `categoriesColumns`/`newArrivalsColumns` responsive logic for those tiers is unchanged by this slice (verified by the untouched, still-green `StorefrontPreviewCanvas.marketCard.test.tsx` column-count assertions) and was not itself a target of this slice.

---

## 12. CI status

PR #1167 opened; GitHub Actions CI had not yet reported on this diff's exact head commit at the time this report was written. Local equivalents of CI's own gates (`php artisan test` on SQLite locally, `npm run build`, `npm test`) all green per §10.

---

## 13. Risks / remaining items

- **Header category-nav + footer "Shop" column still use `PREVIEW_CATEGORIES`.** Confirmed via direct evidence (grep + visual QA screenshot) to be unrelated chrome surfaces, not the "categories"/"newArrivals" home *sections* this task names — left untouched per the scope guard against touching unrelated Commerce workspace surfaces. A reasonable candidate for a future slice, not raised as a blocker here.
- **Category tiles carry no merchant accent color or child count.** The workspace categories list payload (`CommerceWorkspaceStorefrontCategoryController::index`) returns `{id, name, parent_id, parent_name}` only — no `color` (unlike the public `StorefrontCategoryResource`, which does expose it) and no eager-loaded `children` count. Canvas renders a neutral-accent tile with no count badge rather than inventing either value — an honest, lower-fidelity rendering, not a fabrication. Fixing this would mean a second backend payload addition beyond the one already escalated and approved (§2); deliberately not done in this slice to keep the backend touch to exactly the one approved change.
- **Categories are bounded to one `perPage=50` request, client-filtered to root.** A tenant with more than 50 categories, interleaved alphabetically with many non-root ones ahead of some root ones, could see fewer root tiles in Canvas than Published's own dedicated `depth_eq=0` query would return. Accepted as a bounded *editor preview* limitation (same precedent as `categoryGridProducts`' own bounded-page-not-exhaustive-count note already in this file) rather than adding a page-follow loop.
- **59 pre-existing local backend test failures** are a scaffold artifact (`App\Mail\AuthActionMail not found` in this session's `nibras-app` checkout), already documented and confirmed real-CI-green by H4-2's own report; unrelated to and unaffected by this diff.

---

## 14. H4-4 next step

Unchanged by this slice: Banner's missing `imageAlt` field, AppPromo's content still authored from the separate "Apps" settings panel rather than its own Content tab. Both remain exactly as CUST-H4-ARCH-1 §18/§22 and the H4-2 report's §15 described them — H4-4's own scope, not reopened or touched here.

---

## 15. No Merge / No Deploy / No Production release

This task did not merge the PR, did not deploy anything, and did not release anything to production. The PR remains open, pending review.
