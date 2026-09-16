# AWJ — Product Create/Edit V2: Implementation Plan

**Status:** Planning only — no PR in this sequence is authorized for
merge by this document. Each PR requires its own explicit go-ahead.
**Depends on:** `AWJ_PRODUCT_CREATE_EDIT_V2_UX_ARCHITECTURE.md` (this plan
implements that document section by section; do not start a PR whose
scope isn't traceable to a numbered section there).

This mission itself produces **no production code** — this plan exists so
that a future, separately-authorized pass can execute it incrementally
without re-deriving the evidence or the design decisions.

---

## Sequencing rationale

The mission's suggested four-PR breakdown is kept, because the evidence
supports it directly: PR-1 must land the shared workspace shell and the
create-flow save/unlock mechanism (architecture §8) before PR-2/PR-3 have
anywhere correct to render into; PR-2 (pricing/barcode) and PR-3
(options/variants) are independent of each other once PR-1 exists, but
PR-3 depends on PR-2 for the "embed multi-barcode table in the variant
detail sheet" composition (architecture §10); PR-4 is deliberately last
because media deduplication and publication repositioning are
lowest-risk and benefit from the workspace shell already being stable.

Each PR is a **frontend-only, additive-first** change. No PR in this
sequence modifies a backend endpoint, schema, or API contract. No PR
touches `ProductPricingService`, `PriceListService`, barcode resolution,
accounting, or Tenant Isolation.

---

## PR-PROD-UX-1 — Shared Product Workspace foundation

**Scope:**
- Introduce one workspace component (e.g. `ProductWorkspace`) rendering
  sections 1, 4, 6, 8 from the architecture's IA (§5) — the fields that
  are already field-for-field identical in capability between
  `/products/new` and `ProductDialog` today, so this PR is pure
  consolidation with zero new capability.
- Implement the create-flow save/unlock mechanism (architecture §8):
  first Save keeps the user in the workspace, writes the resulting
  `product_id` into local state, and unlocks any section gated on it —
  even though PR-1 itself doesn't yet render sections 2/3/5 (those come
  in PR-2/3/4), the unlock mechanism itself must exist and be tested here
  so later PRs only need to plug sections into it.
- Fix the category/brand data-model mismatch (architecture §4 finding 2):
  adopt the FK-lookup `<Select>` model (as already used in `ProductDialog`)
  in both Create and Edit; remove the free-text inputs from
  `/products/new`.
- `/products/new` route becomes a thin wrapper around `ProductWorkspace`
  in create mode. `/products/[id]`'s `info` tab is replaced by
  `ProductWorkspace` in edit mode (the `variants`/`movements`/`timeline`/`activity`
  tabs are untouched — out of scope, architecture §9).
- `ProductDialog`'s three quick-add call sites (`invoice-form.tsx`,
  `purchase-form.tsx`, `quotes/new/page.tsx`) are **not** touched in this
  PR — they keep using the existing `ProductDialog` as-is (architecture
  §17). `ProductDialog` itself is not deleted yet; it stops being used
  from `/products` list's edit action and `/products/[id]`'s Edit button
  once PR-1 lands (those now open `ProductWorkspace` in edit mode
  in-place), but remains for the quick-add sites until a future decision
  (not in this plan) migrates or retires them.

**Expected files:**
- New: `web/src/components/products/product-workspace.tsx` (or
  equivalent, exact naming TBD at implementation time), plus its own
  `.test.tsx`.
- Modified: `web/src/app/(app)/products/new/page.tsx` (becomes a thin
  wrapper), `web/src/app/(app)/products/[id]/page.tsx` (`info` tab wiring
  only), `web/src/app/(app)/products/page.tsx` (edit action target).
- Modified: category/brand field components — replace free-text inputs
  with the existing `<Select>` pattern already proven in `ProductDialog`.
- Not modified: `ProductDialog` itself (still used by the three quick-add
  sites), `ProductVariantsPanel`, `ProductMultiBarcodeTable`,
  `ProductPublicationFields`, any media component, any backend file.

**Tests:**
- New workspace-level test covering: create → first Save → `product_id`
  present in state → previously-locked-section placeholder becomes
  unlocked (using a stub/mock section, since real sections 2/3/5 don't
  exist in this PR yet).
- Regression: existing `web/src/app/(app)/products/new/page.com-ws-3.test.tsx`
  and `web/src/app/(app)/products/page.test.tsx` updated to match the new
  category/brand select, still asserting the same submitted payload shape
  to `POST /products` (category_id/brand_id instead of free-text strings).
- New test asserting `ProductDialog` is unchanged and still passes its
  own existing coverage (indirect, via the three quick-add call sites'
  own tests, e.g. `invoice-form.test.tsx`, `purchase-form.test.tsx`).

**Dependencies:** None — first PR in the sequence.

**Rollback boundary:** Fully revertible as a single PR. `ProductDialog`
remains intact throughout, so reverting this PR restores the exact
pre-PR routing (`/products` edit action → `ProductDialog`,
`/products/[id]` Edit button → `ProductDialog`) with no data-shape
regression, since the category/brand FK-select payload shape is a subset
of what `ProductDialog` already sends today.

**Risks:**
- Category/brand migration risk: if any existing product data relies on
  the free-text values not resolving to a valid `/product-categories` or
  `/brands` entity, the new `<Select>` needs a documented fallback (e.g.
  "غير مصنَّف" / unmapped state) — this must be verified against real
  data before merge, not assumed.
- Regressing the three quick-add call sites by accidentally changing a
  shared prop/type used by both `ProductDialog` and the new workspace.

**Explicit non-goals:** No pricing/barcode/variant/media UI in this PR —
those are stubs/placeholders only, wired for later PRs to fill in.

---

## PR-PROD-UX-2 — UOM / Pricing / Barcode integration

**Scope:**
- Render architecture §5 section 2 (الوحدات والأسعار / الباركود متعدد)
  inside `ProductWorkspace`, for both Create (staged, atomic-array
  submission with the first Save — architecture §8 item 2, matching
  `/products/new`'s already-proven `barcodes[]`/`unit_prices[]` pattern)
  and Edit (`ProductMultiBarcodeTable`, unchanged, now reachable
  immediately post-save without a dialog close/reopen — architecture §4
  finding 3, fixed here).
- Extend the create-time "pending rows" UI (currently only on
  `/products/new`) so it is available inside `ProductWorkspace` in create
  mode for `ProductDialog`'s former create-mode users too — this closes
  the capability gap found in architecture §4 finding 1 without changing
  the underlying `POST /products` contract, which already accepts these
  arrays.
- No change to `ProductMultiBarcodeTable`'s internals (columns,
  price-writes-through-`unit-prices`, factor-read-only) — reused exactly
  as-is (architecture §11/§12/§21).

**Expected files:**
- Modified: `ProductWorkspace` (adds section 2).
- Modified: `web/src/app/(app)/products/new/page.tsx`'s pending-barcode
  logic — extracted into a shared hook/module so both Create and (via the
  atomic-submission path) the workspace can use it without duplicating
  the validation logic (quantity 1–1,000,000, price parse) found in
  evidence.
- Not modified: `product-multi-barcode-table.tsx` itself, `unit-prices`/`barcodes`
  API contracts, `product-unit-template.ts`.

**Tests:**
- New: create-mode test asserting a product with two pending alternate-UOM
  rows submits both in the same `POST /products` call and that the saved
  product immediately shows the same rows via `ProductMultiBarcodeTable`
  once section 2 re-renders in "existing product" mode (no reopen step).
- Regression: `product-multi-barcode-table.test.tsx` unchanged/still
  green (component itself untouched).
- Regression: `product-unit-template.test.ts` unchanged/still green.

**Dependencies:** PR-PROD-UX-1 (needs the workspace shell and the
save/unlock mechanism).

**Rollback boundary:** Revertible independently of PR-3/PR-4. Reverting
leaves `ProductWorkspace` with section 2 stubbed again (PR-1's
placeholder), no data loss, since this PR does not change any persisted
data shape.

**Risks:**
- The extracted pending-barcode hook must not silently change the
  existing validation bounds (quantity/price) — regression tests must
  assert the exact same limits found in evidence, not new ones.
- Ensuring the "atomic submit on first Save" path and the "existing
  product, live-editing via `ProductMultiBarcodeTable`" path visually
  hand off without a layout jump.

**Explicit non-goals:** No new pricing authority, no factor-derived price,
no new API field. Tax rate placement (co-located with price per
architecture §5) is included here since it has no independent workflow of
its own.

---

## PR-PROD-UX-3 — Options / Variants integration

**Scope:**
- Render architecture §5 section 3 (الخيارات والمتغيرات) inside
  `ProductWorkspace`, mounting the existing `ProductVariantsPanel`
  unchanged, unlocked immediately after first Save (architecture §8 item
  4) instead of requiring navigation to `/products/[id]`'s separate tab.
- Before first Save, section 3 renders visibly-but-disabled with the
  explanatory inline copy specified in architecture §8 item 5.
- Composition improvement: embed a `product_variant_id`-filtered instance
  of `ProductMultiBarcodeTable` (from PR-2) inside `ProductVariantsPanel`'s
  existing variant detail `Sheet`, so barcode/UOM/price become editable
  without leaving that sheet (architecture §10). This is a prop/composition
  change to the Sheet's content only — `ProductVariantsPanel`'s own
  Option/Value/combination/SKU/activation logic is untouched.
- Inventory section 4's variant-managed messaging (architecture §13):
  once the product becomes variant-managed, replace the initial-quantity
  input with the neutral "tracked per variant" message.

**Expected files:**
- Modified: `ProductWorkspace` (adds section 3, wires section 4's
  conditional messaging).
- Modified: `product-variants-panel.tsx` — only the detail `Sheet`'s
  rendered content gains the embedded, filtered `ProductMultiBarcodeTable`;
  no change to its Option/Value/combination/API-call logic.
- `/products/[id]`'s `variants` tab: kept for now as a secondary, still-working
  route to the same `ProductVariantsPanel` instance (do not break existing
  bookmarks/links), but no longer the *only* entry point.

**Tests:**
- New: workspace-level test confirming section 3 is disabled pre-save
  with the correct explanatory copy, and enabled immediately post-save
  with no route change.
- New: variant detail sheet test confirming the embedded, filtered
  multi-barcode table only shows rows for its own `product_variant_id`
  (no sibling-variant leakage in the UI list) — a UI-level regression
  test for the no-sibling-fallback authority boundary (architecture §21),
  not a backend test (backend behavior is already covered by existing
  Feature tests and is out of scope here).
- Regression: `product-variants-panel.test.tsx` — extended, not rewritten,
  to cover the new embedded table without breaking existing
  Option/Value/combination assertions.

**Dependencies:** PR-PROD-UX-1 (workspace shell) and PR-PROD-UX-2 (the
`ProductMultiBarcodeTable` instance being embedded).

**Rollback boundary:** Revertible independently of PR-4. Reverting removes
the embedded table from the detail sheet (falls back to PR-1/2's
SKU+active-only sheet) and re-locks section 3 to its PR-1 placeholder;
`/products/[id]`'s `variants` tab keeps working throughout since it is
never removed by this PR.

**Risks:**
- Largest behavioral surface of the four PRs — must not weaken the
  suggest→review→create gate, must not allow a combination to be
  persisted without explicit selection, must not let the embedded
  multi-barcode table leak a sibling variant's rows into the wrong sheet
  instance (state-key bugs are the realistic failure mode here, not
  authority bugs, since the underlying component/endpoint is unchanged).
- Simple→variant-managed conversion's existing server-side gate
  (blocked when there's a stock footprint) must continue to surface its
  specific reason text in the new location, not a generic error.

**Explicit non-goals:** No option-value/variant media (architecture §14/§22
— explicitly deferred pending backend confirmation). No change to the
combination-generation algorithm, SKU-suggestion logic, or bulk-activation
behavior.

---

## PR-PROD-UX-4 — Media / Publication / final polish

**Scope:**
- Deduplicate the two existing product-level media gallery
  implementations (`/products/[id]`'s inline gallery,
  `ProductDialog`'s grid uploader) into one shared component, mounted as
  architecture §5 section 5, unlocked post-save alongside sections 2/3.
- Reposition `ProductPublicationFields` into architecture §5 section 7 —
  no component change, since it already works correctly pre-save
  (architecture §16).
- Consolidate section 8 (معلومات إضافية: supplier, tags, internal notes,
  active toggle) — fixes the minor `internal_notes` `<Input>`-vs-textarea
  inconsistency found in evidence, and adds `supplier_id` to the unified
  Edit workspace (currently missing from `ProductDialog`, architecture
  §3 matrix row).
- Final polish pass: apply the `ProductPublicationFields` loading/error/empty
  state pattern (architecture §18) to sections 2/3/5 if not already
  consistent from their own PRs; accessibility labeling audit (§20);
  RTL numeric-field audit (§19) across the consolidated workspace.
- If, and only if, the option-value/variant media backend dependency
  (architecture §22) is confirmed to already exist by this point, wire a
  minimal authoring UI for it as an additive sub-section of section 5. If
  not confirmed, explicitly leave it undone and re-state the dependency
  in this PR's own description — do not build placeholder UI for it.
- Once all four PRs have landed and `ProductDialog` is no longer used for
  full-product Create/Edit, evaluate (as a *separate*, future decision,
  not part of this PR) whether the three quick-add call sites should keep
  their own minimal modal or migrate to a scoped subset of
  `ProductWorkspace` — this plan does not decide that here (architecture
  §17 non-goal).

**Expected files:**
- New: shared media gallery component (e.g.
  `product-media-gallery.tsx`), replacing the two duplicated
  implementations, plus its own `.test.tsx`.
- Modified: `ProductWorkspace` (adds sections 5, 7, finalizes 8).
- Modified: `web/src/app/(app)/products/[id]/page.tsx` (removes its
  now-redundant inline gallery, mounts the shared component instead).
- Modified: `product-dialog.tsx`'s own grid uploader — removed once its
  three remaining call sites are confirmed not to need full media
  authoring (they don't, per architecture §17 — they are name/SKU/price
  quick-adds).

**Tests:**
- New: shared media gallery component test (upload/delete/empty/error
  states), replacing the coverage previously implied by the two separate
  implementations.
- Regression: `mock-product-media.test.ts` still green.
- Regression: `publication.test.ts` still green (component/logic
  untouched, only its mount location changes).
- Full workspace end-to-end test: create a product through all unlocked
  sections in one sitting (basic info → save → units/price → options/variants
  → media → publication → additional info) with no route change and no
  dialog reopen, asserting the acceptance criteria in architecture §24
  items 1–3 and 5.

**Dependencies:** PR-PROD-UX-1 (shell), PR-PROD-UX-2 and PR-PROD-UX-3
(sections 2/3 must already be in place for the full end-to-end test in
this PR to be meaningful).

**Rollback boundary:** Revertible independently — reverting restores the
two duplicated media implementations exactly as they exist after PR-1/2/3
(they are not touched by any earlier PR in this sequence), and restores
section 7/8 to their PR-1 placeholder state.

**Risks:**
- Media component consolidation must not silently change the 8-image cap
  or file-type/size validation already enforced in both existing
  implementations — regression tests must assert the exact same limits.
- If the option-value/variant media dependency turns out to be genuinely
  absent, this PR must not quietly skip it without restating the
  dependency explicitly in its own description, per the mission's "UX
  DEPENDENCY — BACKEND CHANGE REQUIRED, do not implement it" instruction.

**Explicit non-goals:** No new "online price" or "storefront category"
field (architecture §16 — confirmed absent, not being invented here). No
migration of the three quick-add `ProductDialog` call sites (explicitly
deferred to a future, separate decision).

---

## Cross-cutting notes for all four PRs

- **No PR in this sequence changes a backend file, migration, or API
  contract**, with the single conditional exception named in PR-4 (media
  authoring endpoints), which is explicitly gated on confirmation and not
  assumed.
- **No PR touches `ProductPricingService`, `PriceListService`, barcode
  resolution, `LedgerService`, Tenant Isolation, or any RBAC/permission
  check** — all are read, never modified, per architecture §21/§17.
- Each PR should independently satisfy `npm run build` and its own test
  suite before merge, per the repository's own Web CI gate — this plan
  does not relax that requirement for any PR.
- Each PR's description should re-link back to the specific architecture
  document section(s) it implements, so review can verify scope
  discipline against the approved design rather than against this plan's
  prose alone.
