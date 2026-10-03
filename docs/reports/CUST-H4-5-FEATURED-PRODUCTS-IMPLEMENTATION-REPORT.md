# CUST-H4-5 — Featured Products Real Picker + Batched Product Read — Implementation Report

**Horizon:** CUST-H4 — Section Library & Section Quality
**Slice:** H4-5 (Featured Products real picker + batched product read)
**Base SHA:** `6c085e6819b563a45702a6bf0a45084de16130a2` — `feat(commerce): FLOWERS H2b — facet & brand filtering on public catalog (#1188)` (verified via `git fetch origin main && git rev-parse origin/main` at task start; confirmed as `origin/main`'s own HEAD). H4-4 (PR #1172) is merged into this history (`241a06f feat(store): complete H4 content sections (#1172)`) but `main` has since advanced through several unrelated slices (FLOWERS H1/H2, DLV-POS/ACCOUNTING).
**Head SHA:** `dafd107` (branch tip at time of this report)
**Branch:** `feat/cust-h4-5-featured-products` (the task's own suggested name; no environment override needed)
**PR:** opened against `main`, not merged — see Final Response for the URL/number

---

## 1. Scope actually implemented

Per the task brief and `CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §21 (and H4-4's own "Explicit H4-5 next step", §17): Featured moves from **PARTIAL** to **LIVE** by replacing both named gaps — the raw product-ID text input, and the Published renderer's N unbatched `fetchProduct(id)` calls.

- **Contract verified unchanged**: `FeaturedContent { productIds: string[] }`, `MAX_FEATURED_PRODUCTS = 8`, identical across all three normalizer twins (`web/.../presentation/section-content.ts`, `storefront/.../section-content.ts`, `StorefrontPresentationNormalizer.php`). No schema change, no migration.
- **Backend**: additive, optional `ids[]` query filter on both `CommerceWorkspaceStorefrontProductController::index` (authenticated workspace — feeds Canvas + the picker's selected-chips resolution) and `StorefrontProductController::index` (public — feeds Published's `FeaturedShelf`). Both bounded to 8, validate each id as a UUID, dedupe, and compose with the existing tenant/channel/publication eligibility gate rather than replacing it.
- **Real multi-select picker** (`FeaturedPickerFields`, `web/.../ControlPanels.tsx`): search, selected chips with real name/thumbnail, reorder (↑/↓), remove, duplicate-prevention (toggle, never two entries for one id), max-8 enforcement (disables unselected candidates once full, never disables an already-selected one so it stays removable).
- **Canvas** (`StorefrontPreviewCanvas.tsx`): renders real resolved product cards per Featured section instance (name + thumbnail or honest placeholder), with loading/empty/error states — replacing the bare id-text-chip list.
- **Published** (`FeaturedShelf.tsx`): one batched `fetchProductsByIds()` call replaces the N `Promise.allSettled(productIds.map(fetchProduct))` calls; results are re-sorted into the stored `productIds` order before rendering.
- **Tests**: 9 new backend tests on each of the two touched controllers (18 total), 13 new `ControlPanels` tests, 9 new `ExperienceBuilder` tests, 9 new `StorefrontPreviewCanvas` tests, 9 new `storefront` tests (`products.test.ts` + `FeaturedShelf.test.tsx`), 2 new `workspace-products.ts` client tests, 1 new Playwright visual spec (5 scenarios).

**Explicitly not touched**, per the task's scope guards: Offers (stays `GATED`, `merchantAddable=false` — H4-6/H4-7), Categories/New Arrivals (H4-3, unchanged), Banner/Benefits/CustomContent/AppPromo (H4-4, unchanged), checkout/cart/pricing, no pricing architecture change (no price shown on Canvas at all — `WorkspaceProductSummary` carries no price field, matching Categories/New Arrivals' own Canvas precedent; Published already showed real price via the existing list endpoint's `price.amount_minor`, unchanged by this slice).

---

## 2. Discrepancies found vs. the architecture doc's assumptions

None material. §21's exact prediction held: the data layer (`listWorkspaceProducts`) was reusable as-is after adding `ids`; the existing single-select `ProductPreviewPicker*` components were correctly identified as unsuitable for direct reuse (different selection model, coupled to CUST-H2's unpersisted preview-product state) and were **not** touched — a new, small, multi-select component was built instead, on the same data layer. The only addition beyond §21's own text: the dev-only `/dev/customizer-versions` visual-QA fixture (`web/src/lib/mock-data.ts`) needed its own `ids[]` handling (mirroring the real backend filter) so the fixture's picker/Canvas resolve honestly instead of ignoring the filter and returning the full mock catalog regardless of selection — the same category of fixture-parity fix H4-3's Revision Note 1 made for `root_only`.

---

## 3. Files changed

```
app/Http/Controllers/Api/CommerceWorkspaceStorefrontProductController.php         |  18 +   (M)
app/Http/Controllers/Api/StorefrontProductController.php                          |  17 +   (M)
tests/Feature/CommerceWorkspaceStorefrontProductApiTest.php                       | 163 +   (M)
tests/Feature/StorefrontCatalogApiTest.php                                        | 117 +   (M)
web/src/modules/commerce-workspace/workspace-products.ts                          |  18 +-  (M)
web/src/modules/commerce-workspace/workspace-products.test.ts                     |  20 +   (M)
web/src/modules/store-experience-builder/ExperienceBuilder.tsx                    | 169 +   (M)
web/src/modules/store-experience-builder/ControlPanels.tsx                        | 276 +-  (M)
web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx              |  97 +-  (M)
web/src/modules/store-experience-builder/messages.ts                             |  30 +-  (M)
web/src/lib/mock-data.ts                                                          |   7 +-  (M)
web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.featured.test.tsx     | 315 +   (A, new)
web/src/modules/store-experience-builder/__tests__/ControlPanels.featured.test.tsx         | 334 +   (A, new)
web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.featured.test.tsx | 186 + (A, new)
web/e2e/cust-h4-5-featured-products-visual.spec.ts                                | 166 +   (A, new)
storefront/src/lib/commerce/config.ts                                            |  14 +-  (M)
storefront/src/lib/commerce/products.ts                                          |  33 +   (M)
storefront/src/lib/commerce/__tests__/products.test.ts                           |  58 +   (M)
storefront/src/components/home/FeaturedShelf.tsx                                 |  27 +-  (M)
storefront/src/components/home/__tests__/FeaturedShelf.test.tsx                  | 100 +-  (M)

20 files changed, 2078 insertions(+), 87 deletions(-)
```

Zero database migrations. Zero changes to `routes/api.php` (both `ids[]` additions are query-string filters on existing routes). Zero changes to `GATED_HOME_SECTION_KEYS`, `MAX_FEATURED_PRODUCTS`, `FeaturedContent`'s shape, publish lifecycle, or section ids/order. **No journal entry is generated by this change or by H4-5 as a whole** — this slice touches only Store Customizer presentation/picker UI and two read-only Commerce catalog query endpoints; it never calls `LedgerService::post`, writes no `journal_lines`/`journal_entries`.

---

## 4. Backend — the `ids[]` batched filter

Identical shape on both controllers, each bounded by a local `IDS_FILTER_MAX = 8` constant (documented in both files as matching `MAX_FEATURED_PRODUCTS`):

```php
'ids' => ['sometimes', 'array', 'max:8'],
'ids.*' => ['uuid'],
...
if (filled($filters['ids'] ?? null)) {
    $query->whereIn('id', array_values(array_unique($filters['ids'])));
}
```

- **Composition, not replacement**: the `whereIn('id', $ids)` clause is added to the *same* query that already carries the tenant/channel eligibility `whereIn` (`CommerceListing` published-on-this-channel subquery) and `is_active = true` — a foreign, unpublished, or inactive id simply fails to match and is silently absent from the result, never an error and never a leak.
- **Validation, not silent truncation**: a non-UUID entry or a 9th id fails the request with 422 (`in:` / `max:` validation), matching every other allow-listed filter in this codebase (`sort=newest`, `root_only=true` from H4-3).
- **Dedup is defense-in-depth**: `array_unique` before `whereIn`; SQL `IN (...)` with duplicate values never produces duplicate rows anyway (primary-key match), but the explicit dedup keeps the executed query clean and matches the task's "deduplicates safely" requirement literally.
- **Payload unchanged**: both controllers return the exact same row shape they already did (`WorkspaceProductSummary`-equivalent for the workspace endpoint, full `StorefrontProductResource` for the public one) — no new field, no price added to the workspace endpoint's payload (Canvas never shows a price, matching Categories/New Arrivals' own precedent).

---

## 5. Frontend batched-read clients

**Workspace (`web/src/modules/commerce-workspace/workspace-products.ts`)**: `listWorkspaceProducts(storefrontId, { ids?: string[], ... })` appends `ids[]=<id>` once per id via `URLSearchParams.append` — omitted entirely when absent/empty, so every existing caller (search list, category grid, new-arrivals sort) is byte-for-byte unaffected.

**Public (`storefront/src/lib/commerce/config.ts` + `products.ts`)**: `StorefrontQueryParams` gained a `readonly string[]` variant; `storefrontFetch` serializes an array value as repeated `key[]=value` query params (`ids[]=a&ids[]=b`), the same PHP/Laravel-native convention the workspace client already used. New `fetchProductsByIds(ids)`:

```ts
export async function fetchProductsByIds(ids: readonly string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const response = await storefrontFetch<AwjListResponse<AwjProduct>>("products", { ids });
  const locale = await getLocale();
  return response.data.map((product) => mapAwjProductToViewModel(product, locale));
}
```

Returns whatever order the API answers in — order restoration is the caller's job (§8).

---

## 6. Picker UX (`FeaturedPickerFields`, `web/.../ControlPanels.tsx`)

Replaces `FeaturedFields` (the old raw product-ID `<input>` list) entirely. Follows the AWJ Customizer's established Content-tab pattern (same as Banner/Benefits/CustomContent fields): no dropdown, no second modal — the picker is inline in the section's own Content tab, which is already part of the Sections Bottom Sheet on mobile (no nested modal-on-modal).

- **Selected products** block: ordered list of chips, each showing real thumbnail-or-placeholder + real name (from the same batched `ids[]` resolution that feeds Canvas — no second fetch for the editor's own display), with ↑/↓ reorder buttons (reusing the existing `moveIndex`/`iconBtnClass` helpers already used elsewhere in this file) and a remove button. Count shown as `N/8`.
- **Candidate list**: a `role="listbox" aria-multiselectable="true"` search result list (reusing `listWorkspaceProducts` search, the same data layer `ProductPreviewPickerPanel` uses for its own single-select picker). Each candidate is a `role="option"` button with `aria-selected`; clicking toggles — selecting when unselected (unless at the 8-cap, where it's `disabled`), deselecting when already selected (toggle, so a duplicate can never be added: the click handler checks `productIds.includes(id)` before appending).
- **Max enforcement**: only *unselected* candidates are disabled once 8 are picked; an already-selected candidate stays clickable so it can still be removed via toggle even at the cap.
- **Search**: a plain `<input type="search">`, same no-debounce convention the existing Product-page preview picker already uses (fires on every change).
- All state (search text, candidate list, loading/error) is owned by `ExperienceBuilder`, not this component — it stays purely presentational, consistent with the rest of this file's architecture.

---

## 7. Batched-read design (state machine in `ExperienceBuilder.tsx`)

Two independent concerns, both backed by the same `listWorkspaceProducts({ ids })` call:

**(a) Per-section-instance resolution** (`featuredResolved`/`featuredResolvedState`, both `Record<sectionId, …>`): "featured" is **not** a singleton section type (`canDuplicate: true` per `SECTION_CAPABILITIES`) — a merchant can add several Featured rails, each curating its own products. Unlike `homeCategories`/`homeNewArrivals` (genuinely singleton, one shared state slot each), this is keyed by section instance id. An effect iterates every visible "featured" section on each relevant render, computes `key = productIds.join(",")`, and only re-fetches when that section's own key differs from the last one it fetched (tracked in `featuredResolvedKeyRef`, a ref — not state, since it is pure bookkeeping, never rendered). An empty selection resolves to `"ready"` with `[]` immediately, no network call.

**(b) The picker's own candidate list** (`featuredPickerSearch`/`featuredPickerList`/`featuredPickerListState`): loads once, the first time a Featured section becomes selected, via the exact same `listWorkspaceProducts` call used by `ProductPreviewPicker` but with its own state (not shared — different selection model entirely, as the architecture doc's §21 itself required).

**Stale-response protection**: `loadFeaturedResolution` bumps a per-section-id request token (`featuredRequestRef.current[sectionId]`) on every call and discards a response if a newer call for that same section has already started, or if the storefront changed mid-flight (`storefrontIdRef.current !== originStorefrontId`) — the same two-part guard every other preview fetch in this file already uses. Verified by a dedicated test: selecting a product (slow, held pending) then immediately selecting a second one (fast) — the slow first response's data never overwrites the second's once it has rendered.

**Reset on storefront/version switch**: added to the existing reset block (alongside `homeCategories`/`homeNewArrivals`'s own reset) — clears both resolution maps, the per-section key-bookkeeping ref, and the picker's own list/search state, so a previous storefront's featured data or "already resolved this key" bookkeeping can never survive into a newly-opened storefront.

---

## 8. Order semantics

Both Canvas and Published independently implement the same rule: **the stored `productIds` array is the only order authority; the batched read's own response order is discarded.**

- **Published** (`FeaturedShelf.tsx`): builds a `Map<id, product>` from the batched response, then does `productIds.map(id => byId.get(id)).filter(defined)` — this both restores order and drops any id the API didn't return (foreign/unpublished/deleted), with no placeholder.
- **Canvas** (`StorefrontPreviewCanvas.tsx`, featured branch): identical pattern — `ids.map(id => products.find(p => p.id === id)).filter(defined)`.

A dedicated test on each side proves this with an adversarially-scrambled mock response (`[p3, p1, p2]` in, `[p1, p2, p3]` rendered) and a separate test proves a missing id is omitted without shifting the remaining ones or leaving a gap.

---

## 9. Canvas behavior

Per-section-instance states, mirroring the Categories/New Arrivals convention exactly (`"idle"`/`"loading"` render the same skeleton; `"ready"` with an empty array is the honest empty state):

- **Loading/idle**: an `animate-pulse` skeleton grid (reusing `newArrivalsColumns`/`cardImageHeight`/`cardPad`, the same responsive classing New Arrivals already uses).
- **Empty selection**: `data-home-featured-empty` message, no network call ever issued for an empty `productIds`.
- **Error**: `data-home-featured-error` with a retry button wired to `onRetryFeatured(sectionId)`.
- **Populated**: real product cards (thumbnail-or-honest-placeholder + name), in stored order, missing ids silently dropped.
- Each section instance gets its own unique heading id (`preview-featured-${section.id}`) and `aria-labelledby` landmark — proven independent with two simultaneous Featured sections resolving to different product sets.
- No price shown (consistent with the task's explicit instruction not to expand into pricing architecture — `WorkspaceProductSummary` carries no price field).

---

## 10. Published behavior

`FeaturedShelf.tsx` is now:

```ts
const resolved = await fetchProductsByIds(productIds).catch((error) => {
  console.error("FeaturedShelf: failed to load featured products", error);
  return [];
});
const byId = new Map(resolved.map((p) => [p.id, p]));
const products = productIds.map((id) => byId.get(id)).filter(defined);
if (products.length === 0) return null;
```

One request regardless of selection size (bounded to 8 anyway). A total failure (network/5xx) is caught and treated as an empty result — same `return null` empty-section-omission behavior every other optional Published section already uses (Banner/Benefits/CustomContent, Categories/NewArrivals), never a thrown error that would 500 the page. Verified: a test asserts `fetchProductsByIds` is called **exactly once** regardless of 1 vs. 3 selected ids (no N+1 regression reintroduced).

---

## 11. Tenant / storefront / channel isolation

Backend tests (new, both controllers), each independently proving the `ids[]` filter **narrows, never bypasses** the existing eligibility gate:

| Scenario | Workspace (`CommerceWorkspaceStorefrontProductApiTest`) | Public (`StorefrontCatalogApiTest`) |
|---|---|---|
| Exact match returns only requested eligible rows | ✅ | ✅ |
| Foreign tenant's product never returned | ✅ `ids_filter_still_respects_tenant_isolation` | ✅ `ids_filter_never_leaks_a_foreign_tenants_product` |
| Product published only on a different channel omitted | ✅ `ids_filter_still_respects_channel_publication_eligibility` | ✅ `ids_filter_never_leaks_a_product_published_only_on_a_different_channel` |
| Unpublished/inactive id silently omitted, not an error | ✅ | ✅ |
| Duplicate ids deduplicated safely | ✅ | ✅ |
| Non-UUID id → 422, not a crash | ✅ | ✅ |
| >8 ids → 422 | ✅ | ✅ |
| Exactly 8 ids accepted | ✅ `exactly_the_max_featured_products_in_the_filter_is_accepted` | — (same validation code path) |
| Omitting `ids` leaves existing behavior unchanged | ✅ | ✅ |

`commerce.manage` permission, `EnsureActiveSubscription`, self-service forbidding, and the pre-existing `ownedStorefront()`/`StorefrontContext` authority chains are untouched — the new filter is a `WHERE` clause composed onto the same query every sibling filter (`search`, `category_id`, `sort`) already composes onto.

---

## 12. Backward compatibility

- A Draft/Published document saved before this slice has `productIds: []` or a short list — both remain valid; nothing about the stored shape changed.
- `FeaturedContent`, `MAX_FEATURED_PRODUCTS`, `normalizeOptionalSectionContent`'s featured branch: byte-for-byte unchanged in all three twins.
- Every existing caller of `listWorkspaceProducts` (search picker, category grid, new-arrivals sort) omits `ids` and is provably unaffected (dedicated regression tests on both the omitted-param path and the default-behavior-unchanged path, backend and frontend).
- No schema/version bump anywhere (`StorefrontPresentationNormalizer::VERSION` untouched).

---

## 13. Performance / request count

- **Picker**: one search request on first selecting a Featured section (not per keystroke-debounced, matching the existing Product-picker's own no-debounce convention); zero N+1.
- **Canvas**: exactly one batched `ids[]` request **per visible Featured section instance**, only when that section's own selection actually changed (key-diffed, not re-fetched on unrelated re-renders) — proven by a dedicated "no redundant duplicate fetch" test and a "two independent instances, two independent requests" test.
- **Published**: exactly one batched request per page render for the whole Featured shelf, replacing the prior N (`productIds.length`) per-id requests — proven by a dedicated "calls the batched read exactly once regardless of selection size" test on both the storefront client and `ExperienceBuilder`.
- **Stale-response protection**: verified directly (slow-then-fast resolution race, §7).

---

## 14. Accessibility

- Search input has a real `sr-only` `<label htmlFor>` (`بحث عن منتج لإضافته` / `Search for a product to add`) — distinct from the results listbox's own `aria-label` (`featuredPickerResultsLabel`, a new key added specifically so the two don't collide under `getByLabelText`-style accessible-name queries).
- Candidate list is `role="listbox" aria-multiselectable="true"`; each candidate is `role="option" aria-selected={boolean}` — selection state conveyed semantically, not just visually. Verified: keyboard `Enter` on a focused option activates selection (native `<button>` semantics, no custom key handling needed).
- Selected-count (`N/8`) is in a `aria-live="polite"` span so a screen-reader user hears the count change as they select/deselect.
- Images use `alt=""` (decorative — the adjacent text already names the product, matching every other product-card pattern in this codebase); a product with no thumbnail renders an empty placeholder box, never a broken-image icon or an invented photo.
- Move-up/move-down buttons carry real `aria-label`s (`moveUp`/`moveDown`, pre-existing shared keys) and are `disabled` at the first/last position rather than silently no-op.
- Mobile: the picker lives inside the existing Sections Bottom Sheet's Content tab — no second `aria-modal` surface, matching every other section's established mobile pattern.

---

## 15. Tests and exact results

### 15.1 Backend, targeted
```
php artisan test --filter=CommerceWorkspaceStorefrontProductApiTest   30 passed (115 assertions) — 21 pre-existing + 9 new (ids[])
php artisan test --filter=StorefrontCatalogApiTest                    24 passed (99 assertions)  — 15 pre-existing + 9 new (ids[])
```

### 15.2 Backend, full suite
```
php artisan test (no --filter)
Tests: 5175 passed, 47 failed, 51 skipped (32211 assertions), 1061s.
```
All 47 failures are `Class "Aws\Exception\AwsException" not found` in `R2SmokeTestCommandTest`/`R2StorageServiceTest` — `aws/aws-sdk-php` is not installed in this local `nibras-app/vendor/`, the exact local-scaffold-only gap CUST-H4-3's and CUST-H4-4's own reports already root-caused in detail (§10/§12.3 of those reports respectively) against this same environment. This diff touches no storage/R2 code. **Zero failures occur in either file this diff touches** (§15.1 confirms both fully green in isolation). `.github/workflows/ci.yml`'s real CI installs the full Composer dependency set and should not reproduce this gap (prior H4 slices observed both `php artisan test` CI jobs green on equivalent diffs).

### 15.3 Frontend, targeted
```
web:         workspace-products.test.ts                                13 passed (2 new)
web:         ExperienceBuilder.featured.test.tsx                        9 passed (new file)
web:         ControlPanels.featured.test.tsx                           13 passed (new file)
web:         StorefrontPreviewCanvas.featured.test.tsx                  9 passed (new file)
storefront:  products.test.ts                                          18 passed (3 new)
storefront:  FeaturedShelf.test.tsx                                      9 passed (rewritten for batched read)
```

### 15.4 Frontend, full suites
```
web:         npx vitest run        358 test files, 2821 tests passed, 0 failed
storefront:  npx vitest run        112 test files, 785 tests passed, 0 failed
```

### 15.5 Design-token drift ratchet
A first pass introduced raw `neutral-*` Tailwind palette classes in the new picker component (matching the *old*, pre-H4-5 `FeaturedFields`' own convention) which tripped `web/src/design/__tests__/drift-ratchet.test.ts` (`ControlPanels.tsx: palette classes 72 → 88`). Fixed by switching to the semantic tokens the *better* precedent in this same file already establishes (`ProductPreviewPickerPanel.tsx`): `text-muted`, `text-text`, `border-border`, `bg-surface-muted`. Re-ran clean: `3 passed`.

### 15.6 TypeScript
```
web:         npx tsc --noEmit -p .   same pre-existing, unrelated error set H4-2/H4-3/H4-4's own reports
             already documented (pos/settings/configuration, gemini-card, document-language-selector,
             product-*, use-document-label-mode, useImportJobEngine, section-*.test.tsx spread-argument
             errors in (commerce)/commerce/appearance) — none of this slice's changed or new files appear.
storefront:  npx tsc --noEmit        0 errors.
```

### 15.7 Biome (storefront)
First run flagged this slice's own new/changed formatting (import order + one over-length line) in `products.ts`/`products.test.ts`/`FeaturedShelf.tsx` — fixed with `pnpm check --write` (safe auto-format, no logic change) and re-verified: `Checked 466 files, 0 errors`.

---

## 16. Builds

```
web:         npm run build       ✓ Compiled successfully; full route table generated; exit 0.
storefront:  npm run build       ✓ Compiled successfully; exit 0.
```

---

## 17. CI

Not yet observed on this PR at the time of writing (PR just opened). Local full-suite/build/lint results above are the pre-PR validation, per this repository's own protocol; GitHub Actions results should be checked on the PR once CI runs — not part of this task's scope to merge or force green, since **no merge is being requested**.

---

## 18. Visual QA

Real browser QA via the pre-installed headless Chromium (`/opt/pw-browsers/chromium`, via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`), the repository's existing Playwright e2e harness, and the `/dev/customizer-versions` demo fixture (same fixture CUST-H4-2/H4-3/H4-4's own specs use — mounts the real `ExperienceBuilder`, no Laravel server, no login). `MOCK_WORKSPACE_PRODUCTS`' dev-fixture mock handler gained its own additive `ids[]` filter (`web/src/lib/mock-data.ts`, dev-only, not production code) so the fixture's picker/Canvas resolve honestly against the selection instead of ignoring the filter — the same category of fixture-parity fix H4-3's Revision Note 1 made for `root_only`.

New spec: `web/e2e/cust-h4-5-featured-products-visual.spec.ts`, **5/5 passed** (desktop project).

**Screenshots actually opened and inspected** (not just asserted on):

- **AR 390** (`ar-390-featured-picker.png`) — the mobile Bottom Sheet's Featured Content tab shows the real empty-selection message, then after selecting two real mock products ("خوذة دراجة هوائية...", "قميص قطني") the Selected products list shows both with reorder/remove controls and a "2/8" count; the candidate list below shows all three real products with checkmarks on the selected two. RTL confirmed, no horizontal overflow.
- **AR 430** (`ar-430-featured-picker.png`) — same checks at the wider mobile width; layout holds identically.
- **AR desktop** (`ar-desktop-featured-selected.png`, 1440×1000) — all three real mock products selected and reordered; the Canvas renders a genuine product grid: the helmet with its real thumbnail image, the t-shirt and bare-product honestly imageless (no fabricated photo) — confirmed via `featuredSection.locator('img')).toHaveCount(1)` (only the helmet has real media) and visually in the screenshot.
- **AR desktop search** (`ar-desktop-featured-search.png`) — typing "قميص" narrows the candidate list to exactly the one matching product; selecting then re-clicking the same candidate deselects it (toggle, proven via the resulting empty-selection message), confirming duplicate selection is structurally impossible.
- **EN desktop** (`en-desktop-featured-no-image.png`) — under `dir="ltr"`, the empty-selection message reads "No products selected yet."; after selecting the t-shirt, the Canvas renders its real name ("قميص قطني" — the catalog has no `name_en`, so the name stays Arabic even under English UI, the same honest, already-documented convention Categories/New Arrivals/the Product-preview-picker all follow) with no image (honest placeholder, confirmed `toHaveCount(0)`).

**Not covered in this pass**: a genuinely-erroring real-network screenshot and a >8-selection screenshot (the fixture always has exactly 3 mock products, so neither state is reachable through this fixture) — both are instead covered by the Vitest integration suites (§15.3), which directly control the mocked client's resolution and assert the exact error/max-enforcement markup. 768/1024/1280 tablet widths were not captured separately — the picker's layout at those widths is a plain block-flow column (no responsive grid-column logic specific to Featured), unchanged from the same container every other section's Content tab already uses at those widths.

---

## 19. Capability registry

Per the task's own gate — **Featured transitions from `partial` to `live`**: a real merchant picker exists, real product data resolves (Canvas and the picker's own chips, via one batched `ids[]` read per section instance), Published resolves via the same batched-read principle with stored-order restoration, parity between Canvas and Published is structural (both independently implement "trust `productIds` order, build a lookup map, filter undefined"), and all tests are green. `GATED_HOME_SECTION_KEYS` is untouched — Offers remains `GATED`, `merchantAddable=false`, not reopened by this slice.

---

## 20. Risks / remaining items

- **Local backend test failures (47, pre-existing)** — confirmed, by direct root-cause match against CUST-H4-3's/H4-4's own precedent, to be `aws/aws-sdk-php` missing from this session's local `nibras-app/vendor/` (§15.2). Neither caused by nor related to this diff's changed files; both touched controllers are fully green in isolation.
- **No tablet-width (768/1024/1280) visual screenshots** — the picker's layout at those widths uses the same unchanged container every other Content-tab field already renders in; not a new responsive surface this slice introduces.
- **No authoritative display price on Canvas** — intentional, per the task's own instruction not to expand into pricing architecture; `WorkspaceProductSummary` has never carried a price field (Categories/New Arrivals' own Canvas preview has the identical property). Published already shows real price unchanged by this slice (the existing list endpoint already returns `price.amount_minor`).
- **Picker's candidate list loads once per section-selection, not re-queried on storefront switch mid-session beyond the existing reset** — covered by the explicit reset-on-switch logic added in §7; no gap identified.

---

## 21. Explicit H4-6 next step

Per `CUST-H4-ARCH-1-SECTION-LIBRARY-ACTIVATION-CONTRACT.md` §23 (Offers bounded Commerce contract, owner-approved to build real rather than stay gated): H4-6 builds the new `storefront_offers` curation/scheduling table (zero price/discount columns) and the `StorefrontOfferResolver` read-only service combining it with the existing `CommercePriceResolver`/`Product.sale_price` for live, never-invented discount display — followed by H4-7 (Offers Canvas + Published renderers, sharing one resolution path by construction) and H4-8 (integrated QA) before H4 Horizon closure. Not touched by this slice.

---

## 22. No Merge / No Deploy / No Production release

This task did not merge the PR, did not deploy anything, and did not release anything to production. The PR remains open, pending review.
