# AWJ POS Workspace V2 — PR-2: Product & Category Experience

## 1. Executive Summary

PR-2's mandate was to improve the POS product-selection experience: Product
Cards V2, product images, category presentation (Default/Image/Color), and a
read-only Product Quick View — reusing existing architecture wherever it
already works, and stopping (not silently expanding) wherever a subpart would
require a backend/API/DB change.

**What was delivered**: the product card gained two isolated, independent
interactions on top of the existing add-to-cart body — a Quick View info
button and an out-of-stock/low-stock visual indicator — plus a new read-only
`PosProductQuickView` dialog. Both reuse 100% of existing data plumbing
(`/pos/products`, the existing `Product` frontend type, the existing
`PosDialog`/`PosProductImage` components) and add zero backend/API/DB
surface.

**What was found already implemented and reused as-is**: product image
handling (`show_product_images`, aspect-ratio preservation, missing/failed
fallback chain) and category-image presentation were already fully built and
correct before this PR — verified, not rebuilt.

**What is explicitly BLOCKED/DEFERRED**: Category Color mode (no `color`
column exists on `product_categories` — would need a migration) and any
persisted category-presentation-mode *setting* (Default/Image/Color as a
tenant choice — no such setting exists anywhere in the settings contract;
adding one is a backend contract change). Both are reported below, not
silently implemented or silently dropped.

**A pre-existing security finding is reported, not fixed**: `ProductResource`
(used by the very endpoint that feeds the POS catalog) unconditionally
serializes `purchase_price`, `avg_cost`, and `profit_margin` with no
permission gate. This is out of PR-2's frontend-only mandate to fix (Section
9 of the mission: "UI hiding is not a security boundary... if fixing requires
backend/API/permission architecture changes, STOP that subpart and report").
Quick View was built to never read or render these fields, but the
underlying over-exposure on the wire remains and should be triaged
separately.

## 2. Base Inspection Findings

Inspected only the areas PR-2 owns, using `main` (this branch's base) as
source of truth — no repository-wide audit performed.

- **POS product grid** (`app/(pos)/pos/page.tsx`, `productsPanel` section):
  grid rendering, search, category tabs (mobile), favorites tab — all
  existing and functional.
- **Product card** (`components/pos/pos-product-tile.tsx`): single
  full-surface `<button>` for add-to-cart, plus a sibling (not nested)
  favorite `<button>` with `stopPropagation` — already correctly isolated
  before this PR.
- **Product image** (`components/pos/pos-product-image.tsx`): already
  implements a three-level fallback (product image → company logo →
  generic `Package` icon + company name), `object-cover` for aspect
  preservation, `onError` for failed-load fallback, `loading="lazy"`.
- **`show_product_images`** (`app/Support/PosSettings.php`,
  `SalesConfigController.php`, `posCfg.show_product_images` in `page.tsx`):
  existing tenant setting, already correctly threaded through
  `posProductGridClass()` and the tile's `showImage` prop.
- **Category image** (`components/pos/pos-category-image.tsx`): already
  exists, same fallback pattern (image → generic `Package` icon), already
  wired into both the mobile category strip and (per grep) a second call
  site in `page.tsx`.
- **Category color / presentation-mode setting**: does **not** exist
  anywhere — no `color` column on `product_categories`
  (`database/migrations/2026_08_27_020000_add_profile_fields_to_product_categories_table.php`
  added only `description`/`image_path`/`image_original_name`/
  `image_mime_type`/`image_size`), no `category_presentation_mode` (or
  similar) key anywhere in `PosSettings.php` or `SalesConfigController.php`.
- **Favorite behavior**: real, already implemented (`favs` state, persisted,
  independent toggle button). Not rebuilt.
- **Quick View / product details**: did not exist before this PR. New in
  PR-2.
- **Product add-to-cart path**: `addProduct()` in `page.tsx` — single path,
  used unconditionally by the tile's main click. Not touched.
- **Barcode/scanner path** (`lib/pos-barcode.ts`,
  `use-pos-barcode-scanner.ts`): not touched.
- **UOM handling**: `pos_units` on `Product`, `pricedUnit()`,
  `appendPosCartProduct()` — not touched; Quick View only *reads*
  `pos_units` names for display.
- **Stock/status data exposed to POS**: `PosController::products()` already
  filters `Product::where('is_active', true)` — inactive products never
  reach the POS catalog at all (R1-consistent server authority), so no
  "inactive product" UI state was needed. `quantity_on_hand` and
  `track_inventory` were already returned; `reorder_level` was already
  returned by `ProductResource` but not yet read by the frontend `Product`
  TypeScript type (data existed on the wire, unused by the client).
- **Permission checks relevant to product details**: `PosController::products()`
  is gated by `invoices.manage` (not a cost-specific permission) — see the
  security finding in §10. `/products/{id}` (the ERP detail page) has its own
  existing server-side guard, unrelated to this PR.
- **Interaction modes / focus**: `pos-interaction-policy.ts`,
  `use-pos-product-navigation.ts` — not touched.
- **Relevant translations**: `pos.*` namespace in
  `web/src/messages/{ar,en}.json` — new keys added, existing keys reused
  (`available`, `barcode`, `categories`, `tab_favorites`).
- **Relevant tests**: `pos-product-tile.test.tsx` already existed (5 tests);
  extended, not replaced.

## 3. Existing-vs-New Classification

| Area | Classification | Action |
|---|---|---|
| Product grid/search/favorites tab | IMPLEMENTED & USABLE | Reused, untouched |
| Product card main-click add-to-cart | IMPLEMENTED & USABLE | Reused, untouched |
| Product card favorite isolation | IMPLEMENTED & USABLE | Reused, untouched |
| Product image ON (fallback chain, aspect ratio) | IMPLEMENTED & USABLE | Reused, untouched |
| Product image OFF (zero reserved media space) | IMPLEMENTED & USABLE | Verified already correct (see §7), no code change needed |
| Category image mode | IMPLEMENTED & USABLE | Reused, untouched |
| Category "Default" (no-image fallback) | IMPLEMENTED & USABLE (as implicit fallback, not a selectable mode) | Reused; see §8 for why it is not a real selectable "mode" today |
| Category color mode | MISSING (no data) | BLOCKED — see §8 |
| Category presentation-mode setting (Default\|Image\|Color as a tenant choice) | MISSING | BLOCKED — see §8 |
| Product Quick View | MISSING | Built in this PR (read-only) |
| Out-of-stock / low-stock card indicator | MISSING (data existed, unused) | Built in this PR, reusing the existing `reorder_level` field and the same low-stock definition already used by `ProductListFilters` |
| Sensitive cost/margin field exposure via `ProductResource` | Pre-existing gap, out of PR-2 scope | Reported, not fixed — see §10 |

## 4. What Was Changed

1. **`pos-product-tile.tsx`**: added an optional `onOpenQuickView` prop
   rendering a third, independent `Info`-icon button (`stopPropagation`,
   same isolation pattern as the existing favorite button — a sibling
   `<button>`, not nested inside the main add-to-cart button). Added an
   optional `reorder_level` field to `PosProductTileProduct` and computed
   `outOfStock`/`lowStock` booleans purely for display (no eligibility
   logic, no blocking of `onAdd`). Both additions are optional props —
   omitting them reproduces the exact prior behavior (verified by the
   pre-existing test suite passing unmodified).
2. **`pos-product-quick-view.tsx`** (new): a read-only dialog reusing
   `PosDialog` and `PosProductImage`. Renders name, image, SKU, barcode,
   category, units, and stock — using only fields already on the frontend
   `Product` type. Renders an optional "Open in ERP" link only when a real
   href is passed in (never a placeholder route). Deliberately does not
   accept or render cost/purchase-price/margin fields.
3. **`app/(pos)/pos/page.tsx`**:
   - Widened the `Product` interface with `reorder_level?: number | null`
     (data the server already sends; the type simply now acknowledges it).
   - Added `quickViewProductId` state (a single id, not a full mutable
     object — the dialog derives its data live from `products`).
   - Added `canOpenProductInErp` state, computed from `/me`'s already-returned
     (but previously unread) `user.permissions`/`user.role` via the existing
     `hasPermission()` helper, checked against `products.view` — the same
     permission slug that gates the ERP `/products` screens.
   - Passed the new props through to `PosProductTile` in the grid map, and
     rendered `PosProductQuickView` once, deriving its product from
     `products.find(...)`.
4. **Translations**: added `pos.sku`, `pos.out_of_stock`, `pos.low_stock`,
   `pos.quick_view`, `pos.quick_view_units`, `pos.quick_view_stock`,
   `pos.quick_view_open_in_erp` to both `ar.json`/`en.json`. Reused existing
   `pos.available`, `pos.barcode`, `pos.categories`.
5. **Tests**: extended `pos-product-tile.test.tsx` with 5 new cases; added
   `pos-product-quick-view.test.tsx` with 5 cases.

## 5. Files Changed

| File | Change |
|---|---|
| `web/src/components/pos/pos-product-tile.tsx` | Quick View button, out-of-stock/low-stock indicator |
| `web/src/components/pos/pos-product-tile.test.tsx` | 5 new tests |
| `web/src/components/pos/pos-product-quick-view.tsx` | New component |
| `web/src/components/pos/pos-product-quick-view.test.tsx` | New — 5 tests |
| `web/src/app/(pos)/pos/page.tsx` | Wiring: state, `Product` type widened, permission check, dialog render |
| `web/src/messages/en.json` / `ar.json` | New `pos.*` keys |
| `AWJ-POS-V2-PR2-IMPLEMENTATION-REPORT.md` | This report |

No file under `app/` (Laravel), `database/`, or `routes/` was touched.
`git status --short` on this branch confirms exactly the files above.

## 6. Product Card Verification — DONE + VERIFIED

- Main-card click still calls only the existing `onAdd` (→ `addProduct(p)`
  in `page.tsx`, the one existing cart-mutation path) — verified by the
  pre-existing test asserting two clicks call `onAdd` twice, unmodified.
- Favorite click calls only `onToggleFavorite`, never `onAdd` — pre-existing
  test, unmodified, still passing.
- Quick View click calls only `onOpenQuickView`, never `onAdd` — new test,
  passing. Both nested buttons use `event.stopPropagation()` before their own
  handler, and are DOM *siblings* of the main `<button>` (not descendants),
  so there is no propagation path into the card's own `onClick` regardless.
- Information hierarchy unchanged: name → price → barcode/stock footer,
  exactly as before, with the stock line now additionally color-coded
  (out-of-stock: `text-negative`; low-stock: `text-warning`) using existing
  design tokens, no new raw colors introduced.

## 7. Image ON/OFF Verification — DONE + VERIFIED (pre-existing, confirmed)

- **ON**: `showImage && (<div className="... aspect-[4/3] ...">
  <PosProductImage .../></div>)` — image area only renders when
  `showImage` is true; `object-cover` preserves aspect ratio without
  distortion; the fallback chain in `PosProductImage` handles missing path
  and `onError` handles failed loads, falling back to the company logo and
  then a generic icon.
- **OFF**: because the whole `<div>` wrapping the media area is inside a
  `showImage &&` guard, setting `show_product_images=false` means the media
  element is not rendered **at all** — not hidden via CSS, not present in the
  DOM with reserved height. The card's `min-h` class also switches from
  `172px` (with image) to `128px` (without), so the card is measurably
  shorter/denser, not just missing an image. This was true before PR-2 and
  is unchanged by it — confirmed by reading the component; no test was
  needed to change this behavior since it was not touched.
- No sparse-catalog whitespace "fix" was attempted — per the mission's own
  instruction that this is not automatically a layout bug.

## 8. Category Architecture Findings

- **Category Default**: IMPLEMENTED, but only as an *implicit fallback*
  (a category with no `image_path` renders a generic `Package` icon +
  label), not as a user-selectable "mode." Classification: **DONE +
  VERIFIED** for the fallback behavior itself; **NOT APPLICABLE** as a
  distinct selectable mode, because no mode selector exists to select it
  from (see below).
- **Category Image**: IMPLEMENTED & USABLE, already fully working
  pre-PR-2 — every category with `image_path` set already renders its image
  via `PosCategoryImage`, reused verbatim, verified by reading
  `pos-category-image.tsx` and its two call sites in `page.tsx`.
  **DONE + VERIFIED.**
- **Category Color**: **BLOCKED/DEFERRED.** No `color` (or similarly named)
  column exists on `product_categories` — confirmed by reading every
  migration touching that table
  (`2025_01_01_000045_create_product_categories_and_brands.php` and
  `2026_08_27_020000_add_profile_fields_to_product_categories_table.php`,
  the only two). Implementing Category Color would require: (1) a new
  migration adding a color column, (2) exposing it through
  `ProductCategoryController`/`ProductResource`, (3) frontend rendering.
  Steps 1–2 are explicitly forbidden by the mission's STOP gate (Section 7:
  "database migration... backend contract change... API change" all trigger
  STOP). **Not implemented. No fake color swatches, no placeholder UI.**
- **Presentation-mode selector (Default\|Image\|Color as a tenant-chosen,
  persisted setting)**: **BLOCKED/DEFERRED**, independently of Color's data
  gap. Even limiting the choice to Default vs. Image only, no such setting
  key exists anywhere in `PosSettings.php`'s defaults array or
  `SalesConfigController.php`'s validation rules (confirmed by grep across
  both files — the settings JSON blob has no `category_presentation_mode`
  or equivalent key). Adding one — even without a migration, since POS
  settings are stored in an existing JSON column — is still a **backend
  contract change** (new validated field, new default, new response key),
  which the mission's STOP gate lists as a trigger independent of whether a
  migration is also needed. **Not implemented.**
  - What this means in practice today: the POS always shows a category's
    real image when one exists, and the generic icon otherwise — there is
    no tenant-facing toggle to force "Default" (hide images) or force
    "Color" (impossible — no data). This is the truthful, current state,
    not a compromise made by this PR.

## 9. Quick View Verification — DONE + VERIFIED (within available data)

- Fields rendered: name, image (with the same fallback chain as the
  product tile), SKU (only if present), barcode (only if present),
  category (only if present), units (`pos_units` names joined), stock
  (only if `track_inventory`, with an explicit "Out of stock" state for
  `quantity_on_hand <= 0` — never displays "Available: 0" or a negative
  count as if it were normal stock).
- Read-only: no input, no edit affordance, no mutation call anywhere in the
  component or its wiring.
- No fabricated fields: every field is either present in the API response
  the tile already receives or explicitly omitted from rendering
  (conditionally, via `product.sku && (...)` etc.) when absent — never a
  placeholder value.
- "Open in ERP": renders only when `openInErpHref` is passed, which
  `page.tsx` only does when `canOpenProductInErp` is true (checked from the
  user's own `permissions`/`role`, already returned by `/me` but not
  previously read by this page) — matching Section 10's requirement
  ("only if a real route exists AND the user is authorized"). It is a
  secondary link below the read-only fields, never the primary Quick View
  action. It performs no POS financial mutation — it is a plain navigation
  `Link` to the existing `/products/{id}` ERP page, and (as the existing
  `pos-recent-invoices-dialog.tsx`'s `view_invoice` link already does for
  invoices) relies on that page's own existing server-side authorization
  guard as the actual enforcement boundary — this PR's client-side check is
  a UX convenience, not a claimed security boundary.
- Nested-interaction propagation: verified by test — clicking the tile's
  Quick View button never calls `onAdd`.

## 10. Sensitive-Data / Permission Findings

**Security finding (reported, not fixed in this PR):**
`app/Http/Resources/ProductResource.php` unconditionally serializes
`purchase_price` (line 84), `avg_cost` (line 88), and `profit_margin`
(line 78) with no permission check anywhere in the resource or in
`PosController::products()` (gated only by the generic `invoices.manage`
permission, not a cost-specific one). Any authenticated POS user whose role
carries `invoices.manage` — which is required simply to use POS at all —
receives these fields in the raw `/pos/products` response today, regardless
of whether their role should see cost/margin data.

This is exactly the "UI hiding is not a security boundary" scenario the
mission warns about in Section 9. **This PR does not expose these fields
anywhere in the new UI** — the frontend `Product` type in `page.tsx` never
declared them (confirmed pre-existing hygiene, not changed by this PR), and
`PosProductQuickView`'s prop type has no field for them at all, so there is
no code path in this PR that could render them even by accident.

**Fixing the underlying over-exposure is out of scope for PR-2** — it would
require a backend/permission-architecture change (a `products.view_cost` (or
similar) permission gate added to `ProductResource`, applied consistently
everywhere the resource is used, not just POS) per Section 9's explicit
instruction to STOP and report rather than casually expand PR-2. **This
finding should be triaged as its own backend security fix**, independent of
POS V2.

## 11. Barcode/Search/UOM/Focus Preservation — PRESERVED + VERIFIED

- No file under `components/pos/interactions/` was touched.
- `lib/pos-barcode.ts` (barcode matching/UOM-aware scan resolution) was not
  touched.
- The Quick View and stock-indicator additions render inside the existing
  product tile's DOM structure without altering focus order, `tabIndex`, or
  the `buttonRef`/`registerProductButton` wiring used by keyboard
  navigation — confirmed by reading `use-pos-product-navigation.ts`'s
  reliance on the tile's main button ref, which is unchanged.
- Verified via the broader regression run (§16) that includes
  `pos-shortcuts.test.tsx` and the interaction-module tests, all passing
  unmodified.

## 12. POS State Preservation — PRESERVED + VERIFIED

| State | Touched by PR-2? |
|---|---|
| Cart | No — `addProduct()` unchanged, Quick View has no cart access |
| Selected customer | No |
| POS Session | No |
| Device | No |
| Branch | No |
| Held/multiple carts | No |
| Recovery state | No |
| Interaction mode | No |

Opening/closing Quick View, changing category, searching, and favoriting are
all pure client-state toggles (`quickViewProductId`, `cat`, `search`, `favs`)
with no interaction with `cart`, `selectedCustomer`, `session`, `warehouseId`,
or `interaction_mode` state — confirmed by reading every new/changed line for
side effects; none exist. A full scripted integration test of the exact
11-step scenario in the mission (add product, select customer, open/close
Quick View, change category, verify cart/customer/session/device/mode
unchanged) was not written as a single end-to-end test, because `page.tsx`
has no existing integration-test harness exercising the full component tree
with a live cart (the existing test suite for this page's logic is unit-level
across smaller modules — `pos-receipt.ts`, `pos-barcode.ts`,
`use-pos-active-carts.ts`, etc. — not a mounted `page.tsx`). Building that
harness would be a disproportionate, unrelated investment for this PR, so
per the mission's own instruction ("test the nearest existing boundaries and
document the limitation") this was verified by code inspection (no shared
mutable state is touched by any new code path) rather than a new end-to-end
render test. This is the one explicitly acknowledged testing limitation in
this report.

## 13. Tenant/Branch/Permission Safety

- **Tenant Isolation**: unaffected — no query, endpoint, or scope was
  touched. Quick View reads only already-fetched, already tenant-scoped
  `products` state.
- **Branch Isolation**: unaffected, same reason.
- **Permissions**: the only permission-related code added
  (`canOpenProductInErp`) *narrows* visibility (hides a link) using an
  existing, already-computed permission list; it does not broaden any
  endpoint, query, or existing permission check. `PosController::products()`
  itself was not touched.
- Pre-existing scoping/security issue found outside this PR's safe frontend
  scope is documented prominently in §10, not silently fixed.

## 14. Financial Side-Effect Verification

- Quick View: read-only, no mutation call in its component body.
- Out-of-stock/low-stock indicator: purely computed from already-fetched
  `quantity_on_hand`/`reorder_level`; does not block or alter `onAdd`.
- Category/favorite/search interactions: unchanged, all pure client-state.
- The only cart mutation reachable from the product grid remains
  `addProduct()` via the tile's main click — unchanged code path, unchanged
  call site.
- No checkout, invoice, payment, return, exchange, inventory posting, cash
  movement, or POS Session open/close call exists anywhere in the diff.

## 15. R1–R6 Preservation — UNTOUCHED

No file under `app/Http/Controllers/Api/PosController.php`,
`app/Services/*Pos*`, `app/Http/Resources/InvoiceResource.php`, or any
return/exchange/checkout backend path was modified. `git diff --stat` against
`main` for this branch touches only files under `web/src/` plus this report.

## 16. Tests and Exact Results

```
npx vitest run src/components/pos/pos-product-tile.test.tsx src/components/pos/pos-product-quick-view.test.tsx
```
**Result: 2 test files, 17 tests passed** (12 in `pos-product-tile.test.tsx`
— 7 pre-existing + 5 new; 5 new in `pos-product-quick-view.test.tsx`).

```
npx vitest run "src/app/(pos)" src/components/pos src/lib/__tests__/pos-workspace.test.ts src/lib/pos-receipt.test.ts src/lib/permissions.test.ts
```
**Result: 28 test files, 136 tests passed** — broader POS regression
(interaction modules, shortcuts, barcode/UOM-adjacent modules, receipt
building, Start Selling invariants, permission helper) all green.

```
npx vitest run
```
**Result: 225 test files, 1431 tests passed** — full frontend suite, zero
failures, zero weakened assertions.

Backend: no backend file was changed in this PR, so no backend test run was
required by the mission's own instruction not to modify backend code merely
to exercise it; the repository's CI still runs the full PHP suite on every
push, unaffected by this PR's diff.

## 17. Build Result

```
npm run build
```
**Result: exit code 0.** Full production build completed, every route
compiled, no new type errors or warnings attributable to this change.

## 18. Manual/Browser UI Verification — Automated Only, Explicitly Stated

**No live-browser manual verification was performed in this session** (no
dev server was launched and visually inspected). All verification above is
automated: component render tests (jsdom + Testing Library) covering the
new Quick View button, the out-of-stock/low-stock indicator, and the Quick
View dialog's field rendering, plus the full existing frontend test suite
and a successful production build. RTL/LTR and light/dark rendering paths
are structurally unchanged from before this PR — the new components use only
existing design tokens (`text-negative`, `text-warning`, `text-muted`,
`border-border`, etc.) already exercised by the rest of the (already
RTL-first, theme-aware) POS UI, and introduce no new conditional layout
logic keyed on direction or theme — but this was not independently
re-verified in an actual browser. Keyboard/touch interaction for the two new
buttons follows the exact same pattern (`min-h-11 min-w-11`, `touch-manipulation`,
`focus-visible:ring-2`) already used by the pre-existing favorite button, but
this, too, was not manually re-verified with a live pointer/keyboard in a
browser this session.

## 19. Known Limitations

- The 11-step full state-preservation integration scenario (§12) was
  verified by code inspection rather than a new end-to-end render test, for
  the reason stated there.
- No live-browser manual QA pass was performed (§18).
- Low-stock/out-of-stock indication was added only to the product tile and
  Quick View; it was not requested for, and was not added to, any other
  surface (e.g., the mobile category strip).

## 20. BLOCKED/DEFERRED Items

- **Category Color mode** — BLOCKED. No `color` column exists on
  `product_categories`; adding one is a database migration + backend
  contract change, explicitly out of this PR's scope per the mission's STOP
  gate. See §8.
- **Category presentation-mode selector** (a persisted Default\|Image\|Color
  tenant setting) — BLOCKED, independent of Color's data gap. No such
  setting key exists in the POS settings contract today; adding one is a
  backend contract change even without a migration. See §8.
- **Sensitive cost/margin field exposure in `ProductResource`** — reported as
  a security finding, not fixed; requires backend permission-architecture
  work outside PR-2's frontend mandate. See §10.

## 21. Risks

- None introduced by the code in this PR beyond the three BLOCKED/DEFERRED
  items and the security finding, all explicitly reported above rather than
  hidden.
- The `canOpenProductInErp` permission check is a UX convenience only; the
  real authorization boundary remains the existing `/products/{id}` page's
  own server-side guard (consistent with the pre-existing `view_invoice`
  pattern in `pos-recent-invoices-dialog.tsx`), so there is no new security
  surface even if the client-side check were ever wrong.

## 22. Branch

`claude/pos-v2-pr2-product-category`

## 23. Draft PR Number/Link

Draft PR #654 — https://github.com/safwan5001-source/Nebrax/pull/654

## 24. Base SHA

`b94718a432d01dab7d5bde04dda2259717ef2a28`

## 25. Head SHA

`da7bb6b`

## 26. Recommended Next Step (superseded — see §27 for the current one)

Triage the `ProductResource` cost/margin exposure finding (§10) as an
independent backend security fix before it is compounded by any future PR
that reads more of that resource in a new surface. Separately, if Category
Color is still desired, scope it as its own small backend PR (migration +
resource + settings-contract change) rather than folding it into a future
frontend-only PR.

---

## 27. PR-2S Security Integration

This section documents integrating PR #654 with the now-merged security fix
from §10/§26 above (PR-2S, Draft PR #655), per a separate follow-up mission.
Nothing in §1–§26 was edited or erased; this section is additive.

### 27.1 What merged

- **PR #655** ("protect product cost/profit data with permission + POS
  setting") merged into `main` at commit `f59ffb398aa53c75a26db892ee29127795d6d866`.
- Verified at integration time: `origin/main` tip was exactly `f59ffb3`
  (no newer commits since); `git merge-base --is-ancestor f59ffb3 origin/main`
  confirmed reachable.
- Old PR #654 Head SHA (before this integration): `a31e523db0d540d6dead043cc6bf85b8944efa04`.

### 27.2 How #654 was updated

`git checkout claude/pos-v2-pr2-product-category && git merge origin/main --no-edit`
— a standard merge (not a rebase, to avoid rewriting a pushed, reviewable
branch's history). **Result: clean merge, zero conflicts.** PR-2's own files
(`pos-product-tile.tsx`, `pos-product-quick-view.tsx`, `pos/page.tsx` product
card/Quick View sections) and PR-2S's files
(`ProductResource.php`, `PosController.php`, `PosSettings.php`, `Rbac.php`,
`SalesConfigController.php`, the POS configuration settings page) are
entirely disjoint except for `web/src/messages/ar.json`/`en.json`, where git
auto-merged both PRs' independent new keys with no conflict (confirmed
afterward: both `pos.quick_view`/`pos.out_of_stock` from PR-2 and
`posSettings.show_cost_profit_in_pos` from PR-2S are present, JSON validated
with `python3 -c "json.load(...)"`). **No semantic disagreement was found
between PR-2 and PR-2S to report** — there was nothing to choose between;
the merge was mechanical.

### 27.3 Quick View integration with the authoritative security model

Inspected the actual, current `ProductResource::toArray()` contract (post
PR-2S): `purchase_price` and `avg_cost` (Money-formatted strings, e.g.
`"100.00"`) and `profit_margin` (raw integer or `null`) are each wrapped in
`$this->when(! $hidesCostProfit, ...)` — **absent from the JSON entirely**
(not `null`) when the requesting user lacks `products.view_cost` or the
tenant's `show_cost_profit_in_pos` setting is off.

Changes made, matching this contract exactly:

- **`web/src/app/(pos)/pos/page.tsx`**: `Product` interface gained
  `purchase_price?: string`, `avg_cost?: string`, `profit_margin?: number | null`
  — all optional, no default value assigned anywhere. The Quick View product
  builder passes `p.purchase_price`/`p.avg_cost`/`p.profit_margin` straight
  through (each `undefined` when the server omitted the key — ordinary
  JS/JSON behavior, no code needed to "detect" absence).
- **`web/src/components/pos/pos-product-quick-view.tsx`**: `PosProductQuickViewProduct`
  gained the same three optional fields. A new "commercial information"
  `<dl>` section renders **only when at least one of the three keys is
  `!== undefined`** — i.e., only when the server actually returned it. Inside
  that section, `profit_margin` additionally checks `!== null` before
  rendering its own row, so a product that has cost data but no recorded
  margin (a legitimate business `null`, distinct from "unauthorized")
  doesn't show a fake `0`/blank margin row — it simply omits that one row
  while still showing purchase price/average cost.
- **No client-side derivation anywhere**: no code path computes `purchase_price`
  from `sale_price`/`profit_margin` or vice versa; the three fields are read
  and displayed verbatim or not rendered at all.
- **Permission check kept separate and secondary, as instructed**: the
  pre-existing `canOpenProductInErp` (`hasPermission(..., 'products.view')`,
  used only for the unrelated "Open in ERP" link) was **not** reused or
  extended to gate the cost/profit section — the mission explicitly warned
  against making Quick View "depend solely on `hasPermission('products.view_cost')`"
  since the POS setting could still be off. The cost/profit section's
  visibility is driven **only** by field presence in the actual API
  response, never by a frontend permission check.

### 27.4 Frontend types

```ts
// Product (page.tsx) and PosProductQuickViewProduct (pos-product-quick-view.tsx)
purchase_price?: string;
avg_cost?: string;
profit_margin?: number | null;
```

All three are optional (`?:`); none has a default value in `POS_DEFAULTS`,
`DEFAULTS`, or any object literal — an unauthorized/disabled response simply
never populates them, and no code fills them in afterward.

### 27.5 Security regression checklist

Explicitly re-verified none of the following occurred during integration:

- [x] Sensitive fields remain **optional** in every frontend type touched.
- [x] No fallback/default value was added for any of the three fields.
- [x] `show_cost_profit_in_pos` is not bypassed — the frontend never
  requests or infers these fields independently; it only ever displays what
  `GET /pos/products` actually returned.
- [x] `products.view_cost` is not bypassed, duplicated, or shadowed by a
  second permission or setting.
- [x] No client-side cost calculation exists (no `sale_price − margin`,
  no `sale_price / (1 + margin)`, nothing derived).
- [x] Product Cards (`pos-product-tile.tsx`) were **not** touched by this
  integration and still show only name/price/barcode/stock — no cost/profit
  field was added there.
- [x] `ProductResource`'s security behavior (§7/§12 of PR-2S's own report)
  was not modified — this integration is frontend-only; `git diff` for this
  integration touches zero files under `app/`.
- [x] `PosController`'s security decision (`$revealCostProfit` computation)
  was not touched.
- [x] POS setting defaults (`show_cost_profit_in_pos: false`) unchanged.
- [x] Tenant Isolation / Branch Isolation: unaffected — no query, scope, or
  endpoint was touched by this integration; it only consumes fields already
  present or absent in a response whose tenant-scoping is entirely PR-2S's
  concern, verified there.

### 27.6 Existing PR-2 behavior preserved

Re-confirmed unchanged by this integration (all in files this integration
did not touch, or touched only additively):
card click still calls the existing `addProduct()` path; favorite remains an
independent sibling button with `stopPropagation`; Quick View's info button
remains independent and does not add to cart; `show_product_images`
ON/OFF behavior (including zero reserved media space when OFF) is
unmodified; image fallback chain unmodified; low-stock/out-of-stock
indicators remain purely informational on the card (untouched by this
integration); category image behavior unmodified; no topbar or Start
Selling change; no financial logic change anywhere in this diff.

### 27.7 Tests

**Frontend — targeted:**
```
npx vitest run src/components/pos/pos-product-quick-view.test.tsx src/components/pos/pos-product-tile.test.tsx
```
**20 passed** (12 tile — unmodified — + 8 Quick View, including 3 new PR-2S
integration tests: commercial section renders only when fields are present,
section absent entirely when fields are absent, and no fake margin row when
`profit_margin` is `null` alongside present cost fields).

**Frontend — broader POS regression:**
```
npx vitest run "src/app/(pos)" src/components/pos src/lib/__tests__/pos-workspace.test.ts src/lib/pos-receipt.test.ts src/lib/permissions.test.ts "src/app/(app)/pos/settings/configuration/page.test.tsx"
```
**157 passed** (29 test files) — includes the PR-2S settings-page toggle
test, Start Selling invariants, interaction modules, receipt building,
permission helper — all green.

**Frontend — full suite:**
```
npx vitest run
```
**1435 passed** (225 test files) — zero failures.

**Backend — targeted (SQLite):**
```
php artisan test --filter='PosProductCostVisibilityTest|PosCheckoutTest|PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosInvoiceBranchAccessTest|PosDefaultCustomerSettingsTest|ApiInvoiceTest|BranchIsolationGuardTest|ProductBarcodeAndMediaTest|SalesConfigTest|RoleTest'
```
**121 passed (1393 assertions)** on the merged branch — confirms PR-2S's
security tests (including `PosProductCostVisibilityTest`'s full 4-combination
truth table) still pass unchanged after the merge, and no regression was
introduced in R1–R6-adjacent suites.

**Backend — full suite (SQLite):**
```
php artisan test
```
**2344 passed, 1 skipped, 25 failed (16912 assertions).** The 25 failures
are the same pre-existing, environment-only gaps documented in every prior
report for this repository (24 `Fuel*Test` failures — `Call to undefined
function App\Services\bcmul()`, this environment's PHP lacks the `bcmath`
extension, which CI installs explicitly; 1 `DocumentCenterSecureIntakeTest`
failure — missing `poppler-utils`, also CI-installed). Identical failure set
and count to the pre-integration PR-2S run — zero new failures introduced by
this integration (which touches no backend file at all).

**PostgreSQL:**
```
php artisan migrate:fresh --force
```
Succeeds cleanly (no migration in this integration).
```
php artisan test --filter='PosProductCostVisibilityTest|PosCheckoutTest|PosCheckoutIdempotencyTest|PosReturnTest|PosReturnUomTest|PosReturnExchangeIdempotencyTest|PosInvoiceBranchAccessTest|PosDefaultCustomerSettingsTest|ApiInvoiceTest|BranchIsolationGuardTest|ProductBarcodeAndMediaTest|SalesConfigTest|RoleTest'
```
**121 passed (1393 assertions)** — identical to the SQLite targeted result.
A full-suite run was not repeated on PostgreSQL (would only re-confirm the
same two engine-independent, already-documented environment gaps); the
targeted run above covers every module this integration touches or could
plausibly affect, on PostgreSQL specifically.

### 27.8 Build

```
npm run build
```
**Exit code 0.**

### 27.9 Visual/manual verification

**Not performed as a live-browser session in this integration.** No dev
server was started against a real POS session, real product images, a real
authorized/unauthorized user pair, or the `show_cost_profit_in_pos` toggle in
an actual browser this session — consistent with how PR-1 and the original
PR-2 report already handled this exact question (both explicitly recorded
"automated verification only, no live browser pass," rather than claiming a
manual check that didn't happen). What **was** verified, automatically, via
component-level render tests exercising the real DOM output (jsdom +
Testing Library), covering every scenario the mission asked for at the
component level:

- Commercial section renders with correct labels/values when the three
  fields are present (§27.7).
- Commercial section is entirely absent when the fields are absent.
- No fake margin row when `profit_margin` is `null` but cost fields exist.
- Out-of-stock label renders instead of "Available: 0" (pre-existing test,
  re-confirmed passing).
- Long product name, missing image, Quick View open/close, add-to-cart
  isolation from Favorite/Quick View buttons — all pre-existing PR-2 tests,
  re-confirmed passing unmodified.

RTL rendering specifically: every string asserted against in the test suite
is Arabic-language UI text sourced through the same `next-intl`
`useTranslations` mechanism already exercised (in Arabic) by the rest of the
POS test suite; no new conditional layout logic keyed on direction was
introduced by this integration (the new commercial-info `<dl>` uses the same
`grid grid-cols-2` pattern already used one section above it for
sku/barcode/category/units). This was not independently re-verified in an
actual browser window.

**Explicit limitation acknowledged, not hidden**: light/dark theme
rendering, actual touch/keyboard interaction in a live browser, and a true
end-to-end pass with a real toggled `show_cost_profit_in_pos` setting and a
real `products.view_cost`-granted user were not performed this session.

### 27.10 Category Color / Category Presentation Mode

**Both remain exactly as documented in §8 of this report — unchanged,
un-implemented, not marked done:**

- **Category Color**: still DEFERRED/BLOCKED. No `color` column exists on
  `product_categories`; this integration did not touch category data,
  category resources, or category settings in any way.
- **Category Presentation Mode** (`Default | Image | Color`): still
  DEFERRED/BLOCKED. No persisted presentation-mode setting exists; this
  integration did not add one.

### 27.11 Files changed by this integration

| File | Change |
|---|---|
| `web/src/app/(pos)/pos/page.tsx` | `Product` type: 3 new optional fields; Quick View product builder passes them through; Quick View `fields` prop gets 4 new label keys |
| `web/src/components/pos/pos-product-quick-view.tsx` | `PosProductQuickViewProduct`: 3 new optional fields; new conditional "commercial information" section |
| `web/src/components/pos/pos-product-quick-view.test.tsx` | 3 new tests |
| `web/src/messages/en.json` / `ar.json` | 4 new `pos.*` keys (commercial section title + 3 field labels) |

No file under `app/` (Laravel), `database/`, or `routes/` was touched by
this integration — those files arrived already-merged from PR-2S via the
merge in §27.2, unmodified further.

### 27.12 Risks / Remaining Work

- No live-browser visual pass (§27.9) — recommend a human reviewer do a
  quick manual check of the commercial-info section's spacing/typography
  before merge, since it's genuinely new visual real estate in the dialog.
- Category Color / Presentation Mode remain open Master Contract items for
  a future, explicitly-scoped backend PR (unchanged recommendation from §26).

## 28. Updated Git Metadata

- Branch: `claude/pos-v2-pr2-product-category` (unchanged, same PR #654)
- Base SHA (original PR-2, §24): `b94718a432d01dab7d5bde04dda2259717ef2a28`
- Old Head SHA (before this integration): `a31e523db0d540d6dead043cc6bf85b8944efa04`
- Current `main` SHA used for this integration: `f59ffb398aa53c75a26db892ee29127795d6d866`
- New Head SHA (after this integration): `e053d1f` (Quick View integration commit), report-finalization commit follows

## 29. Recommended Next Step (current)

Human review of PR #654's now-integrated diff, specifically: (1) the
commercial-info section's visual placement in Quick View (§27.12), and (2) a
live check with `show_cost_profit_in_pos` toggled on for a
`products.view_cost`-holding user, before this Draft is marked ready. PR-2S
(#655) and PR-2 (#654) are otherwise fully reconciled — no outstanding
conflict or disagreement between them.
