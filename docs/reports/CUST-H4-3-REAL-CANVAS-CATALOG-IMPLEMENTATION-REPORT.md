# CUST-H4-3 — Real Canvas Catalog Parity for Categories / New Arrivals — Implementation Report

**Horizon:** CUST-H4 — Section Library & Real Section Activation
**Slice:** H4-3 (Real Canvas catalog parity for Categories / New Arrivals)
**Base SHA:** `de8eee89e838c25d14f1e7c2064eff1d1720c633` — `feat(store): build CUST-H4 Section Library (H4-2) (#1154)` (verified directly via `git fetch origin main && git rev-parse origin/main` at task start; confirmed as `origin/main`'s own HEAD, not assumed from the task brief)
**Head SHA:** `8d70e9e58df7cd9e5aba3df699fc379f186212cc` (Revision Note 1 — P1 Categories parity fix)
**Branch:** `claude/tender-heisenberg-wzfczm` — **deviation from the task's suggested `feat/cust-h4-3-real-canvas-catalog`**, per this session's own Git Development Branch Requirements, which mandate developing on this pre-assigned branch name. Reported per the task's own "If the environment mandates another branch name, use it and report it" instruction.
**PR:** [safwan5001-source/Nebrax#1167](https://github.com/safwan5001-source/Nebrax/pull/1167), open against `main`, not merged

---

## Revision Note 1 — P1 Categories parity fix (owner follow-up on PR #1167)

The owner reviewed the first version of this slice and correctly identified that Categories was **not yet semantically equivalent to Published**: the implementation fetched up to 50 workspace categories (one page, ordered alphabetically) and then filtered to `parentId === null` **on the client**. Because the filter ran *after* pagination, a tenant with enough alphabetically-earlier child categories could have some of its real root categories pushed past the single fetched page and never reach the client at all — a genuine Canvas ↔ Published parity gap, not an accepted preview limitation as the first version of this report incorrectly characterized it in §13.

**This revision adds a small, additive, backward-compatible server-side filter** — `root_only=true` on `CommerceWorkspaceStorefrontCategoryController::index` — applying `whereNull('parent_id')` **before** `paginate()`. Canvas's categories fetch now requests exactly `root_only=true&per_page=12` (the real section limit) and renders the server's answer directly, with no client-side re-derivation of root-ness. This closes the gap: pagination can no longer starve root categories behind children, because children are excluded from the query before any page is cut.

Two real bugs were found and fixed while building this fix, both before this revision was pushed, not after:
1. Laravel's bare `'boolean'` validation rule only accepts `[true, false, 0, 1, '0', '1']` (strict comparison) — it rejects the literal string `"true"` the task's own example URL (`root_only=true`) and every `URLSearchParams`-built client request actually send. Fixed by validating `root_only` as `in:true,false,1,0` instead, read via `$request->boolean()` (which already parses `"true"` correctly — only the validation step was wrong).
2. A test-authoring bug (not a production bug): the first version of the new `root_only` pagination-ordering test misclassified a category that was itself root-level as "the parent, not a root," undercounting the real total/has_more metadata. Fixed in the test, not the controller.

This revision changes: `app/Http/Controllers/Api/CommerceWorkspaceStorefrontCategoryController.php`, `tests/Feature/CommerceWorkspaceStorefrontCategoryApiTest.php`, `web/src/modules/commerce-workspace/workspace-categories.ts` (+ its test), `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` (removes the client-side filter), `web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.homeCatalog.test.tsx` (updated to assert the server-side contract instead of client-side filtering), and `web/src/lib/mock-data.ts` (the dev-fixture mock gains the same `root_only` filter so visual QA against it stays accurate — dev-only, not production code). The New Arrivals `sort=newest` work from the first revision is untouched, as instructed.

Everything **not** touched by this revision — New Arrivals' data flow and tests, the honest loading/empty/error states, stale-response protection, request dedup, the out-of-scope header/footer chrome — is carried forward unchanged from the first revision; it was not reopened. Sections below are updated in place to describe the final, post-fix implementation rather than leaving a stale pre-fix description; §5 and §13 changed the most.

---

## 1. Scope actually implemented

Per the task brief and `CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §5/§21/§35 (H4-3's own definition, "confirmed to need no new backend work... can run fully in parallel"):

- Replaced the Home **"categories"** section's Canvas preview (`StorefrontPreviewCanvas.tsx`) from the static `PREVIEW_CATEGORIES` fixture to the real, tenant/storefront-scoped workspace categories read, filtered to root-level only via a **server-side** `root_only=true` filter (`whereNull('parent_id')`, applied before pagination — see Revision Note 1) — matching Published's own `depth_eq: 0` semantics (`CategoriesSection.tsx`) with true semantic parity, not a client-side approximation.
- Replaced the Home **"newArrivals"** section's Canvas preview from the static `PREVIEW_PRODUCTS` fixture to the real workspace products read, ordered by recency — matching Published's own `-available_on` (→ `created_at` desc) semantics (`NewArrivals.tsx`).
- Added honest loading/empty/error states for both sections, with a retry affordance on error, never a fallback to fake data.
- Added stale-response protection (a storefront switch, or a version switch, cannot let a slower previous request overwrite the newer one) and request dedup (each section fetches once per storefront, gated on the section actually being visible in the real, loaded config — not the transient default config shown before the Version loads).
- **Two small, additive, backward-compatible backend changes**: an optional `sort=newest` query parameter on `CommerceWorkspaceStorefrontProductController::index` (escalated to and approved by the owner before implementation — see §2), and an optional `root_only=true` query parameter on `CommerceWorkspaceStorefrontCategoryController::index` (added in Revision Note 1, after the owner identified the first version's client-side root filtering as a real parity gap, not an accepted limitation).

**Explicitly not touched**, per the task's scope guards: the header category-nav chip row and the footer "Shop" column, which still render from `PREVIEW_CATEGORIES` — these are unrelated chrome surfaces (not the "categories"/"newArrivals" home *sections* this task targets), confirmed in evidence-gathering and left exactly as they were (see §9's "Risks" for why, and why fixing them is out of this slice's bounded scope). No Banner/AppPromo/Featured/Offers work (H4-4/H4-5/H4-6/H4-7). No pricing/checkout logic. No persisted schema/section-content-contract change.

---

## 2. Stop-and-report resolution: the `sort=newest` backend touch

The task brief explicitly names this exact situation as a STOP trigger: *"New Arrivals Published semantics cannot be reproduced from the existing workspace API without an API change."* Evidence gathered before writing any code:

- Published's `NewArrivals.tsx` fetches with `sort: "-available_on"`, documented in its own comment as mapping to the catalogue's `created_at`, descending — "that is why this shelf is titled 'new arrivals'... AWJ exposes no featuring, ranking or sales-volume signal."
- `CommerceWorkspaceStorefrontProductController::index` — the endpoint H4-3 is told to reuse — had **no sort parameter at all**: hardcoded `orderBy('name')->orderBy('id')`, and the payload didn't even carry `created_at` for a client-side sort to fall back on.

Per the task's own instruction, this was surfaced to the user **before any code was written**, with three options (add a minimal additive backend sort param / ship with a documented alphabetical-order gap / stop entirely). The user selected **"Add minimal optional sort param"**. The resulting change (§4) is strictly additive: a new, optional, allow-listed `sort=newest` value; every existing caller (the raw Featured product-id input, the Product/Category preview pickers) omits `sort` and keeps today's exact alphabetical order, verified by a dedicated regression test (§7).

---

## 3. Files changed

**First revision (New Arrivals `sort=newest` + both sections' real-data wiring):**
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

**Revision Note 1 (P1 Categories parity fix, this update):**
```
 app/Http/Controllers/Api/CommerceWorkspaceStorefrontCategoryController.php    |  25 ++-   (M)
 tests/Feature/CommerceWorkspaceStorefrontCategoryApiTest.php                  | 109 +++++  (M)
 web/src/lib/mock-data.ts                                                      |   6 +-     (M)
 web/src/modules/commerce-workspace/workspace-categories.ts                    |   9 +-     (M)
 web/src/modules/commerce-workspace/workspace-categories.test.ts               |  17 +      (M)
 web/src/modules/store-experience-builder/ExperienceBuilder.tsx                |  16 +--    (M)
 web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.homeCatalog.test.tsx | 28 +-- (M)
```

Zero database migrations across both revisions. Zero changes to `routes/api.php` (both `sort` and `root_only` are query-string additions to existing routes, not new routes). Zero changes to `section-content.ts`, `GATED_HOME_SECTION_KEYS`, persisted presentation schema, or publish lifecycle. `web/src/lib/mock-data.ts` is a dev-fixture-only module (powers `/dev/customizer-versions` for visual QA), not production code.

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

## 5. Categories data flow — backend `root_only=true` + the full flow (Revision Note 1)

**Backend change** — `CommerceWorkspaceStorefrontCategoryController::index` (`app/Http/Controllers/Api/CommerceWorkspaceStorefrontCategoryController.php`):

```php
'root_only' => ['sometimes', 'nullable', 'string', 'in:true,false,1,0'],
...
if ($request->boolean('root_only')) {
    $query->whereNull('parent_id');   // applied BEFORE ->paginate()
}
```

Deliberately `in:true,false,1,0` rather than the bare `boolean` rule this codebase's other boolean filters use (e.g. `is_active` on `PublicProductController`): Laravel's `boolean` rule only strictly accepts `[true, false, 0, 1, '0', '1']` and rejects the literal query-string `"true"` — which is both this fix's own named example URL and what every `URLSearchParams`-built client request sends for a JS boolean. `$request->boolean('root_only')` (the *read*, as opposed to the *validation*) already parsed `"true"` correctly; only the validation rule needed the fix.

**Full data flow:**
1. `ExperienceBuilder.tsx`'s `loadHomeCategories()` calls `listWorkspaceCategories(storefrontId, { rootOnly: true, perPage: 12 })` (`@/modules/commerce-workspace/workspace-categories`) — `rootOnly` is a new, optional, additive client param (sent as `root_only=true` only when explicitly requested; every other caller, the Category-page preview picker, omits it and is unaffected).
2. The backend applies `whereNull('parent_id')` **before** `->paginate()` — a page can never be filled with non-root rows that then starve real root categories off the end of the result, the exact parity gap the first version of this slice left open.
3. **No client-side re-filtering or re-slicing.** `StorefrontPreviewCanvas` renders exactly the rows the server returns (`homeCategories: { id, name }[]` + `homeCategoriesState`) — real tiles (name only — see §13 on the `color`/child-count gap), with loading-skeleton/empty/error states.

**Authority chain**: authenticated user → `SetTenant`/`SetBranch` → `EnsureActiveSubscription` → `EnsurePermission:commerce.manage` → `ownedStorefront()` (tenant-id equality check, 404 not 403 on mismatch) → `CommerceCategoryListing::publishedOn($storefront->sales_channel_id)` — unchanged by `root_only`; it is purely an additional `WHERE` clause composed with the existing eligibility subquery, never a replacement for it. No new write path, no client-supplied tenant/storefront override possible (same contract CUST-H2-4's own 8-scenario isolation test suite already locks down, re-verified green and extended with 5 new `root_only`-specific tests — §10).

## 6. New Arrivals data flow

1. `loadHomeNewArrivals()` calls `listWorkspaceProducts(storefrontId, { sort: "newest", perPage: 8 })` — the one new, additive param (§2/§4).
2. Backend orders by `created_at desc, id desc` — the same semantic rule Published's `-available_on` sort already applies.
3. Result passed to Canvas as `homeNewArrivals: { id, name, thumbnailUrl }[]` + `homeNewArrivalsState`.
4. Canvas renders real product cards: real name, real thumbnail (or an honest empty tile when the product has no media — never an invented photo), no price/stock/discount ever shown (Featured's own established "presentation holds no commerce facts" precedent, unchanged here since this section doesn't even persist product references, only renders a live-fetched preview).

**Authority chain**: identical to Categories, through `CommerceListing::query()->where('sales_channel_id', $storefront->sales_channel_id)->where('is_published', true)` — unchanged by the `sort` addition.

---

## 7. Canvas ↔ Published parity evidence

**Final documented data flow, per the owner's required framing:**

> **Categories** — Canvas: authenticated workspace root-category read (`root_only=true`, server-side `whereNull('parent_id')` before pagination) → same storefront sales channel publication eligibility. Published: public Host-resolved root-category read (`depth_eq: 0`) → same storefront sales channel publication eligibility.
>
> **New Arrivals** — Canvas: authenticated workspace recency-ordered read (`sort=newest`, server-side `created_at` desc) → same storefront sales channel publication eligibility. Published: public Host-resolved recency-ordered read (`-available_on`) → same storefront sales channel publication eligibility.

| | Canvas (this slice) | Published |
|---|---|---|
| Categories scope | root-level only — **server-side** `root_only=true` (`whereNull('parent_id')`, before pagination) | `depth_eq: 0` (`CategoriesSection.tsx` → `store/v1/categories`) |
| Categories channel/tenant | `Storefront.sales_channel_id` via `ownedStorefront()` (authenticated workspace) | `SalesChannel` resolved via `ResolveStorefrontDomain`/`StorefrontContext` (Host-resolved public) |
| New Arrivals order | `created_at` desc — **server-side** `sort=newest` | `created_at` desc (`-available_on`, existing) |
| New Arrivals channel/tenant | same `ownedStorefront()` authority | same Host-resolved public authority |
| Eligibility rule | `is_active` + `CommerceListing`/`CommerceCategoryListing` published on *this* channel | identical rule, same underlying tables, applied via the public read path |

Different HTTP surfaces (authenticated workspace vs. Host-resolved public) remain acceptable, per the task's own framing — the important parity requirement is same tenant/storefront sales channel, same publication eligibility, same section meaning, same real catalog truth. **Different category meaning is not acceptable, and is no longer present**: Categories parity no longer depends in any way on client-side filtering of a paginated, mixed-depth category list — the root-only semantic is enforced by the database query itself, before any page boundary is drawn, exactly like New Arrivals' recency ordering is enforced by the database query rather than a client-side sort.

Visually confirmed (§11): the exact same 3 root categories and 3 products that `MOCK_WORKSPACE_CATEGORIES`/`MOCK_WORKSPACE_PRODUCTS` (the dev fixture's stand-in for the real backend, now also honoring `root_only` — see Revision Note 1) expose, with the 2 non-root categories correctly excluded by the fixture's own server-side-equivalent filter, not by Canvas.

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

- No new route, no new controller, no new middleware, for either `sort=newest` or `root_only=true`. Both go through the exact same `auth:sanctum` → `SetTenant` → `SetBranch` → `EnsureActiveSubscription` → `EnsurePermission:commerce.manage` → `ownedStorefront()` chain every sibling route in their respective groups already enforces.
- `sort=newest` cannot select or widen tenant/storefront/channel scope — it only changes `ORDER BY` on a query whose `WHERE` clause (tenant scope via `Product`'s own `BaseModel`, channel scope via `CommerceListing::sales_channel_id`) is unchanged and untouched by this diff.
- `root_only=true` cannot select or widen tenant/storefront/channel scope either — it only *adds* a `WHERE parent_id IS NULL` clause composed (via `->where()`) with the existing `whereIn('id', $this->publishedCategoryIds(...))` eligibility subquery; it can only ever narrow the result set further, never bypass or replace the eligibility/tenant predicate.
- New backend test `sort_newest_still_respects_tenant_isolation_and_eligibility` proves a second tenant's product never appears under `sort=newest` for the first tenant's storefront.
- New backend test `root_only_still_respects_tenant_storefront_and_channel_publication_isolation` proves the same for Categories: a second tenant's root category never appears, and an unpublished root category for the *same* tenant is still correctly excluded — `root_only` narrows, it does not bypass, the publication gate.
- New backend test `an_unsupported_sort_value_is_rejected` / `an_unsupported_root_only_value_fails_validation` prove each allow-list (`in:newest` / `in:true,false,1,0`) rejects anything else with a 422, not a silent fallback or a 500.
- New backend test `root_only_pagination_happens_after_the_filter_so_root_categories_are_never_starved_by_children` is the direct proof the parity fix actually fixes the reported gap: a plain (non-`root_only`) 2-row page is shown to be fully consumed by alphabetically-earlier child categories (the control, proving the gap is real), while the same 2-row page with `root_only=true` contains only root categories, and a second page reaches the 3rd, confirming the filter runs before — not after — pagination.
- The existing 8-scenario tenant-isolation/404-vs-403/payload-minimization suites for both controllers were re-run in full and are untouched and green (§10).

---

## 10. Tests and exact results

**Backend, targeted** (`php artisan test --filter=...`, run from the scaffolded `nibras-app` project):
```
CommerceWorkspaceStorefrontProductApiTest     21 tests passed (89 assertions) — 17 pre-existing + 4 new (sort=newest)
CommerceWorkspaceStorefrontCategoryApiTest    24 tests passed (94 assertions) — 19 pre-existing + 5 new (root_only)
```

**Backend, full suite** (`php artisan test`, no `--filter`):

First revision: 4978 passed, 59 failed, 51 skipped (31090 assertions), 911s. Revision Note 1 re-run (after the local `app/Mail`/`resources/views` workaround described below): **4995 passed, 47 failed, 51 skipped (31152 assertions), 993s** — the failure count *dropped* from 59 to 47 purely from that local workaround, isolating the remaining 47 to a second, equally unrelated local-scaffold gap (confirmed next paragraph), not anything in this diff.

The original 59 failures (and 12 of them specifically) are a **local-scaffold-only** artifact, root-caused precisely while building this revision (not merely asserted by precedent): this session's `setup.sh` (the local dev-session Laravel scaffold builder) never copies `app/Mail/` or `resources/views/` into the scaffolded `nibras-app` project, so every test that calls the shared `registerTenant()` helper hits `Class "App\Mail\AuthActionMail" not found` (the class exists in the core repo, `app/Mail/AuthActionMail.php`, but the local scaffold never receives it) when the registration endpoint tries to send a verification email. **`.github/workflows/ci.yml` — the repository's actual CI — copies both directories correctly** (`cp -r "$CORE/app/Mail/"*.php app/Mail/`, `cp -r "$CORE/resources/views/"* resources/views/`), confirming this is purely a gap in the local one-off scaffold script, not a real repository issue, and not something this diff introduced or could fix (`setup.sh` is out of this slice's scope). Copying both directories into the local `nibras-app` checkout (a local-only, uncommitted workaround, not part of this diff) made the previously-failing `registerTenant()`-dependent tests in the two controllers this revision touches pass cleanly, which is how the targeted 21/24 counts above were confirmed test-logic-clean rather than merely "passing around a known-broken helper."

The remaining 47 failures are a **different**, equally local-scaffold-only, equally unrelated gap: `Class "Aws\Exception\AwsException" not found` in `R2StorageServiceTest` — `aws/aws-sdk-php` is simply not present in this session's `nibras-app/vendor/`. This diff never touches storage/R2 code. **GitHub's real CI confirms both local gaps are scaffold-only, not repository issues** (§12): `php artisan test (L11, sqlite)` and `php artisan test (L11, pgsql)` both came back fully green — zero failures of any kind — on this exact diff, run against a real, clean `composer install`.

**Frontend, targeted** (`npx vitest run`):
```
src/modules/commerce-workspace/workspace-products.test.ts              12 tests passed (sort=newest query param)
src/modules/commerce-workspace/workspace-categories.test.ts            12 tests passed (+1: root_only=true query param, Revision Note 1)
src/modules/store-experience-builder/__tests__/ExperienceBuilder.homeCatalog.test.tsx   8 tests passed (2 of the 8 updated in Revision Note 1 to assert the server-side root_only contract instead of client-side filtering — same coverage, no test removed)
src/modules/store-experience-builder/__tests__/ExperienceBuilder.categoryRegions.test.tsx   14 tests passed (1 assertion adjusted — see below)
src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.marketCard.test.tsx   16 tests passed (unchanged — confirms the idle-state grid-class regression was caught and fixed, not merely avoided)
```

One pre-existing test's assertion needed adjustment, not weakening: `ExperienceBuilder.categoryRegions.test.tsx`'s "zero Products in the category" test asserted `listWorkspaceProducts.mock.calls[0]` was the category-grid call — no longer safe once the Home page's own new "New Arrivals" fetch (fired before the test switches to the Category page) also calls the same mocked client. Fixed to search all calls for the one carrying `categoryId`, preserving the exact same coverage.

**Frontend, full module + route group** (after Revision Note 1):
```
web/src/modules/store-experience-builder + web/src/modules/commerce-workspace    441 tests passed, 0 failed
src/app/(commerce)/commerce/appearance                                           41 tests passed, 0 failed
```

**Frontend, full suite** (`npm test`, after Revision Note 1):
```
346 test files, 2675 tests passed, 0 failed
```

**TypeScript** (`npx tsc --noEmit`): same pre-existing, unrelated error set H4-2's own report documented on `main` (`pos/settings/configuration`, `gemini-card`, `document-language-selector`, `product-*`, `use-document-label-mode`, `useImportJobEngine`, plus the pre-existing `section-*.test.tsx` spread-argument errors in `(commerce)/commerce/appearance`) — none of this slice's changed files appear in the list, in either revision.

**Build** (`npm run build`, after Revision Note 1): `✓ Compiled successfully in 52s`, `✓ Generating static pages (179/179)`.

---

## 11. Visual QA

Real browser QA via the pre-installed headless Chromium (`/opt/pw-browsers/chromium-1194`), the repository's existing Playwright e2e harness, and the `/dev/customizer-versions` demo fixture — same fixture `cust-h2-2-page-navigator.spec.ts`/`cust-h4-2-section-library-visual.spec.ts` already use (mounts the real `ExperienceBuilder`, no Laravel server, no login). New spec: `web/e2e/cust-h4-3-real-canvas-catalog-visual.spec.ts`, 4/4 passed.

**A fixture quirk discovered, not caused, by this slice**: every scenario this fixture seeds (`seedMockPresentationVersions`) defaults to `config: { version: 2 }` with no `homepage.sections` — and CUST-H4's own V2 document rule treats an explicit-but-empty section list as "the merchant cleared it" (unlike a pre-V2 legacy document, which falls back to the default 4 sections). This means the Home page in **every** scenario this fixture offers starts with zero rendered sections — a pre-existing fixture property this slice did not create and did not change. This spec adds the "categories"/"newArrivals" sections itself through the real, already-shipped CUST-H4-2 Section Library `onAdd` flow (the same interaction a merchant actually performs), rather than editing the shared fixture's seeding — keeping this slice's footprint to its own files.

The fixture's demo-mode `mockApi()` already had dedicated handlers for the exact real routes this slice wires up (`MOCK_WORKSPACE_PRODUCTS`/`MOCK_WORKSPACE_CATEGORIES`, built for CUST-H2-3/H2-4's own visual QA) — this slice reuses that data as-is, adding none of its own. **Revision Note 1** taught the categories mock handler the same `root_only=true` filter the real backend now has (`web/src/lib/mock-data.ts`, dev-fixture-only, not production code) — without this, removing Canvas's client-side filter would have made the dev fixture itself start leaking non-root categories into the screenshots below, since the mock previously relied on Canvas doing that filtering for it. The screenshots were re-captured and re-inspected after this fix; the root-category set shown is unchanged from the first revision (proving the server-side filter produces the identical, correct result), but it is now genuinely the mock *server's* filter doing the work, not Canvas's own code.

**Screenshots actually opened and inspected** (not just asserted on):

- **AR 390** (`ar-390-home-catalog.png`) — the real "تصنيف فارغ" (Empty category) root-tile and the real "وصل حديثاً" product shelf (an honest empty-image placeholder for a product with no media) render behind the open Homepage composer sheet; no horizontal overflow; RTL confirmed.
- **AR 430** (`ar-430-home-catalog.png`) — same checks at the wider mobile width; layout holds.
- **AR desktop** (`ar-desktop-home-catalog.png`, 1440×960) — full confirmation: "تسوق حسب التصنيف" shows exactly the 3 real root categories (`الدراجات الهوائية ومستلزماتها`, `إكسسوارات متنوعة`, `تصنيف فارغ`) with the 2 non-root categories (`دراجات الطريق`, the deep one) correctly excluded; "وصل حديثاً" shows all 3 real mock products (`منتج بسيط بلا وصف`, `قميص قطني` — both honestly imageless; `خوذة دراجة هوائية مقاومة للصدمات...` — with its real thumbnail). The header category-nav chips and footer "Shop" column are visibly still the old static fixture (`الإلكترونيات`, `المنزل`, ...) — confirming, visually, that those two out-of-scope chrome surfaces were correctly left untouched while the two in-scope sections now show real data.
- **EN desktop** (`en-desktop-home-catalog.png`, 1440×960) — same real categories/products render correctly under an English UI with `dir="ltr"`; the category/product *names* themselves stay in Arabic (the only language this catalog data has — no `name_en` column on categories, and this slice follows the existing `ProductPreviewPickerPanel.tsx` convention of never switching a rendered name by locale), which is the honest behavior, not a bug.

**Not covered in this pass**: a genuinely empty real-catalog screenshot (the fixture's mock handlers always return the same 3 products / categories regardless of scenario) and a genuinely errored real-network screenshot (same reason) — both states are instead covered by the Vitest integration suite (§10), which directly controls the mocked client's resolution and asserts the exact empty/error markup, retry behavior, and absence of fake content. 768/1024/1280 tablet widths were not captured as separate screenshots; the Canvas's `categoriesColumns`/`newArrivalsColumns` responsive logic for those tiers is unchanged by this slice (verified by the untouched, still-green `StorefrontPreviewCanvas.marketCard.test.tsx` column-count assertions) and was not itself a target of this slice.

---

## 12. CI status

**Observed directly on GitHub for this PR at head `6cbd3217ca2b5bcf2e190041bbaa2da9df1cd9f3` — all 8 checks green**, `mergeable_state: "clean"` (no conflict):

| Check | Conclusion |
|---|---|
| `web build (Next.js)` ×2 | ✅ success |
| `php artisan test (L11, sqlite)` ×2 | ✅ success |
| `php artisan test (L11, pgsql)` ×2 | ✅ success |
| `merchant preview visual QA` | ✅ success (see note below) |
| `published footer visual QA` | ✅ success |

This is the authoritative confirmation of §10's local-scaffold theory: **both `php artisan test` runs (SQLite and PostgreSQL, on a real, clean `composer install`) are fully green on this exact diff** — zero `AuthActionMail`/`AwsException` failures, zero failures of any kind. That confirms the 47 (and originally 59) local failures in this session's `nibras-app` checkout are purely an artifact of `setup.sh`'s incomplete directory copy list, not a real repository issue and not caused by this diff.

**`merchant preview visual QA` real-CI note**: this check failed on its first run, in `store-brand-qa.spec.ts` (a VAT/CR business-identity-icon footer test this diff never touches), with `Test timeout of 30000ms exceeded` / `Protocol error (Runtime.callFunctionOn): Internal server error, session closed` — a browser-session-infra signature, not a content assertion failure. Per the drive-to-green protocol (rule out a failure naming code the diff doesn't touch, confirm with one re-run), the job was re-run once and came back green with no code change — confirming it was a transient CI infra flake, not a regression.

---

## 13. Risks / remaining items

- **Header category-nav + footer "Shop" column still use `PREVIEW_CATEGORIES`.** Confirmed via direct evidence (grep + visual QA screenshot) to be unrelated chrome surfaces, not the "categories"/"newArrivals" home *sections* this task names — left untouched per the scope guard against touching unrelated Commerce workspace surfaces. A reasonable candidate for a future slice, not raised as a blocker here.
- **Category tiles carry no merchant accent color or child count.** The workspace categories list payload (`CommerceWorkspaceStorefrontCategoryController::index`) returns `{id, name, parent_id, parent_name}` only — no `color` (unlike the public `StorefrontCategoryResource`, which does expose it) and no eager-loaded `children` count. Canvas renders a neutral-accent tile with no count badge rather than inventing either value — an honest, lower-fidelity rendering, not a fabrication. Fixing this would mean a third backend payload addition beyond the two already made (`sort`, `root_only`); deliberately not done in this slice to keep the backend touch minimal.
- **Resolved in Revision Note 1 — no longer a risk:** Categories previously depended on fetching up to 50 mixed-depth rows and filtering to root on the client, which could under-represent a tenant's real root categories if enough alphabetically-earlier children filled the page first. This is now a real, bounded, server-side `root_only=true` query (`whereNull('parent_id')` before `paginate()`) — pagination can no longer starve root categories behind children, proven by a dedicated test with exactly that adversarial shape (§9/§10).
- **Local backend test failures (59 → 47, neither real)** — both root-caused in Revision Note 1 (§10): `setup.sh` (local dev-session scaffold only) omits `app/Mail/` and `resources/views/` from its copy list (12 of the 59), and separately never installs `aws/aws-sdk-php` (the remaining 47, `R2StorageServiceTest`) — unlike `.github/workflows/ci.yml`, which handles the first correctly and whose full, clean `composer install` avoids the second. **Confirmed real-CI-green on this exact diff** (§12: both `php artisan test` jobs, SQLite and PostgreSQL, fully green, zero failures); unrelated to and unaffected by this diff either way. `setup.sh` itself was deliberately not patched — fixing a shared scaffold script is outside this slice's bounded scope, and the local-only workaround used to get a clean test signal for this diff's own two controllers (§10) was not committed.

---

## 14. H4-4 next step

Unchanged by this slice: Banner's missing `imageAlt` field, AppPromo's content still authored from the separate "Apps" settings panel rather than its own Content tab. Both remain exactly as CUST-H4-ARCH-1 §18/§22 and the H4-2 report's §15 described them — H4-4's own scope, not reopened or touched here.

---

## 15. No Merge / No Deploy / No Production release

This task did not merge the PR, did not deploy anything, and did not release anything to production. The PR remains open, pending review.
