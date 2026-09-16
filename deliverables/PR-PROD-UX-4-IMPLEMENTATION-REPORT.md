# PR-PROD-UX-4 — Media + Publication + Workspace Polish — Implementation Report

## 1. Branch

`claude/pr-prod-ux-4-media-publication-polish`

## 2. Base

`main` at `26c0648` (PR #844, PR-PROD-UX-3, squash-merged). Not rebased.

## 3. Head SHA

`e91c378` (single commit on top of the base).

## 4. PR

Opened against `main`, ready for review (not draft). URL: see hand-off message.

## 5. Phase 0 — evidence map

**A. Product media — before this PR, three separate implementations:**

| Surface | File | Behaviour |
|---|---|---|
| Edit — product profile | `web/src/app/(app)/products/[id]/page.tsx` | Richest: `GET/POST/DELETE /products/{id}/media`, `fetchImageUrl` (blob: hydration, no storage path leaks), big preview + 5-col thumbnail selector, immediate upload/delete. |
| Create | `web/src/app/(app)/products/new/page.tsx` | Local `File`+`previewUrl` staging grid, no API calls until after `POST /products` succeeds, then one `POST /products/{id}/media`. |
| Quick Add | `web/src/components/products/product-dialog.tsx` | Grid uploader, immediate upload/delete once `product?.id` exists. Left untouched (Quick Add boundary). |

No shared component existed; each page re-implemented gallery logic independently. Backend authority (`ProductMediaService`, `ProductMediaGalleryService`, `ProductMediaResource`, routes at `routes/api.php:423-426`, permissions `products.view`/`products.manage`) was already correct and untouched — the gap was purely a frontend duplication problem, as `AWJ_PRODUCT_CREATE_EDIT_V2_UX_ARCHITECTURE.md` §14 predicted ("this is deduplication of an already-correct feature, not new functionality").

**B. Product publication — before this PR:**

- `CommerceListing.is_published` confirmed as the sole authority (`app/Models/CommerceListing.php`, `App\Services\Commerce\CommerceListingService`).
- `CommerceProductPublicationController` (`show`/`update`) already registered under `api/commerce/workspace/products/{id}/publication`, gated by `products.view`/`products.manage` (`app/Providers/CommerceWorkspaceServiceProvider.php`).
- Frontend authority already existed and was already correct: `web/src/modules/products/publication.ts` (`loadProductPublication`, `loadAvailableProductStores`, `replaceProductPublication`), `web/src/modules/products/use-product-publication.ts` (mode-aware hook: no `productId` → available stores; with `productId` → live state), and `ProductPublicationFields` component. Already consumed by `ProductDialog` and by `/products/new` (page-level, outside `ProductWorkspace`).
- **Gap:** `/products/[id]` (Edit) had no publication control at all — an existing product could not have its store publication changed from the profile page.

**C. `ProductWorkspace` — what PR-1/2/3 had already integrated:** basic info, pricing/tax/accounts, inventory, additional info, `ProductMultiBarcodeTable` (PR-2, "pending rows before save / live authority after save" pattern), `ProductVariantsPanel` (PR-3, locked-before-save card). Media and publication were explicitly deferred to PR-4 per the component's own doc comment.

No STOP CONDITION was triggered: no schema change, no new flag, no authority change, no API contract change was required — everything needed already existed and only needed frontend wiring/deduplication.

## 6. Integration approach

**Media** — new `web/src/components/products/product-media-section.tsx` (`ProductMediaSection`), extracted from the product-profile page's gallery (the richest/most complete implementation) and parametrized exactly like `ProductMultiBarcodeTable`'s proven "two modes, one component" pattern:

- No `productId` → local-only staging (`pendingFiles`/`onPendingFilesChange`, owned by `ProductWorkspace`), zero network calls.
- `productId` present → live gallery, immediate `POST`/`DELETE` on user action, `fetchImageUrl` for blob-URL hydration (no storage path ever reaches the DOM as a raw `src`).
- First item in the list is the deterministic cover/large-preview by construction (`liveMedia[0]`), no separate "cover" flag invented.
- No option-value/variant-media authoring UI added — confirmed no authoring endpoint exists beyond the shared gallery; the architecture doc explicitly reserves that as future work, not this PR's job.

**Publication** — `ProductWorkspace` now calls the *existing* `useProductPublication` hook and renders the *existing* `ProductPublicationFields` directly (same component `ProductDialog` already uses), for both Create and Edit. No new component, no new endpoint, no new flag.

- **Edit mode:** the hook is bound to the real `productId` from mount (stable for the component's lifetime) — live-loads current publish state, and a change is applied immediately as part of the "Save changes" click (`PUT /products/{id}` then `PUT .../publication`), mirroring `ProductDialog`'s existing submit-time pattern.
- **Create mode:** the hook is deliberately kept in "available stores" mode (no `productId` argument) for the *entire* create session, even after `persistedId` becomes set post-first-save. This mirrors `ProductDialog` exactly. Binding it to the transitioning `persistedId` was tried first and found to be a real bug: the hook's own `useEffect` fires on that transition and calls `loadProductPublication`, which — if it resolves before the explicit `replaceProductPublication` write completes — silently resets the user's unconfirmed checkbox selection to the still-unpublished server truth, and (per a failing test that caught this) can also flip hook `status` away from `'ready'` before the intended write happens. Keeping the hook unbound during create removes this race entirely; `replaceProductPublication` (not the hook's own reload) is what applies the user's choice to the newly created product.
- A failed publish is a hard gate: `setError(...)`, `setPublicationRetryNeeded(true)`, `return` before `onCreated`/`onUpdated` — the Save button itself becomes "Retry publication," matching the pre-existing create-mode UX exactly, now also available in Edit mode (new).

**Pages** — `/products/new` and `/products/[id]` lost their duplicated inline media/publication state, handlers, and JSX; both are now thin wrappers whose only remaining job is post-success navigation/reload.

**IA** — "Additional information" (tags, internal notes, active toggle) moved from the top 4-card grid to the very end. Final `ProductWorkspace` section order:

1. Basic info / Pricing & tax & accounts / Inventory (existing 3-card grid, unchanged relative order from PR-1)
2. Units & multi-barcode/unit-price table (PR-2)
3. Options & Variants (PR-3)
4. Media (new)
5. Online / Commerce publication (new)
6. Additional information (moved to last)

**Known, documented deviation from `AWJ_PRODUCT_CREATE_EDIT_V2_UX_ARCHITECTURE.md` §5:** that document's canonical order places Options & Variants and Media *before* Inventory, and Inventory before Units/Barcode. The current, already-shipped PR-1/2/3 layout keeps the 3-card grid (Basic/Pricing/Inventory) first, then Units/Barcode, then Options & Variants. Reordering that grid was judged out of this PR's bounded scope (real regression risk to already-tested PR-1/2/3 markup for a cosmetic ordering gain, and the task instructions explicitly say not to reorder for its own sake without clear evidence). Logged as non-blocking follow-up in §16.

## 7. Create lifecycle (verified by test)

1. Before first Save: `ProductMediaSection` shows local staging only (hint text, no live "Upload" button, zero `/media` API calls). `ProductPublicationFields` shows the tenant's available stores (unpublished) — selectable but not yet applied to any product.
2. First Save → `POST /products` (exactly one, atomic with pending barcodes/unit-prices per PR-2) → `setPersistedId` → pending media uploaded via one `POST /products/{id}/media` (soft-fail: toast on failure, does not block completion) → publication applied via `PUT .../publication` if a selection was made (hard-fail: blocks completion, Save becomes "Retry publication") → `onCreated`.
3. A failed first Save (`POST /products` rejects) leaves media and publication both untouched/unlocked-nothing: no media API calls, no publication write, Options & Variants stays locked — all pre-existing PR-1/PR-3 invariants intact.

## 8. Edit lifecycle (verified by test)

- Media gallery loads immediately via `GET /products/{id}/media` (live authority from mount, matching the pre-existing product-profile behaviour byte-for-byte).
- Publication loads current state via `GET .../publication` (new — previously absent from Edit) and reflects `is_published` from the backend, not client-only state.
- "Save changes" applies the product `PUT` first, then the publication `PUT` if the selection differs from what's loaded, then reloads the hook from the server (confirmed-state resync) — a failed publish blocks completion the same way as Create.

## 9. Files changed

```
web/src/app/(app)/products/[id]/page.tsx        (inline gallery removed, ProductWorkspace now owns it)
web/src/app/(app)/products/new/page.tsx          (inline media/publication state removed)
web/src/components/products/product-media-section.tsx   (new, extracted+parametrized)
web/src/components/products/product-workspace.tsx        (media+publication wiring, IA reorder)
web/src/components/products/product-workspace.test.tsx   (+9 new tests)
web/src/messages/ar.json / en.json                        (+1 key each: media_pending_hint)
```

`product-dialog.tsx` and `product-variants-panel.tsx` / `product-multi-barcode-table.tsx` are untouched.

## 10. Test results

- `product-workspace.test.tsx`: 23/23 passing (16 pre-existing + 7 new media tests + 3 new publication tests — 2 of the new counts overlap categories, see file for exact breakdown: locked-before-save, zero-API-calls-before-save, unlock-after-save, upload-exactly-once, failed-save-stays-locked, edit-mode-loads-media, edit-mode-loads-publication, save-applies-publication-via-authority, no `is_online` field ever appears in any payload).
- Full `products` component/page suite: 88/88 passing.
- Full frontend suite (`npx vitest run`, no filter): **273 test files / 1810 tests, all passing.**
- `npm run build`: succeeds (exit 0), full route table generated, no new warnings.

No backend files were touched, so `php artisan test` was not run, per the STOP CONDITION guidance for a pure frontend PR.

## 11. RTL / LTR / mobile verification

- RTL/LTR: existing `wrapAr`/`wrapEn` test harness re-exercised against the new sections implicitly (all 23 workspace tests render in Arabic; existing dedicated RTL/LTR tests for the workspace still pass unchanged). `ProductMediaSection`/publication reuse the same `useTranslations`, `dir="ltr"` (on `num` fields), and RTL-neutral flex/grid classes as every other integrated section — no new bespoke direction handling was introduced.
- Mobile: not re-verified with a live viewport tool in this pass (no such tool in this environment); verified by construction instead — `ProductMediaSection`'s markup (`grid-cols-2 sm:grid-cols-4`, `aspect-square`, `flex-wrap`, 44px+ icon buttons) is copied unchanged from the pre-existing `[id]/page.tsx` gallery and `ProductDialog`'s grid, both of which were already in production use at the same breakpoints as the rest of `ProductWorkspace`. `ProductPublicationFields` is reused completely unmodified (already used inside `ProductDialog`, a modal, and was already responsive there). No new horizontal-scroll-prone element was introduced.

## 12. ProductDialog (Quick Add) regression result

`product-dialog.tsx` was not modified at all (zero-line diff). Its own media/publication logic (a third, intentionally-separate, bounded Quick-Add implementation) is unchanged. Invoice/Purchase/Quote Quick Add call sites (`invoice-form.tsx`, `purchase-form.tsx`, `quotes/new/page.tsx`) were not touched; their existing test coverage (part of the 1810 full-suite green run) passed unchanged.

## 13. Invariants verified

| Invariant | How verified |
|---|---|
| PR-1: one `POST /products` across the flow | Existing + new tests assert `POST /products` call count === 1 in every create scenario, including with pending media/barcodes. |
| PR-1: workspace stays mounted, no navigation on first save | Existing tests unchanged and still pass; page-level `afterCreated` navigates only after `ProductWorkspace`'s own internal completion, same as before. |
| PR-1: failed save doesn't unlock persisted-only capability | New test: failed `POST /products` → zero `/media` calls, no live upload control rendered, alert shown. |
| PR-2: UOM/multi-barcode/pricing unchanged | `product-multi-barcode-table.test.tsx` (untouched file) still 100% passing; `ProductWorkspace`'s barcode-merge tests unchanged and still pass. |
| PR-3: Options & Variants zero-pre-save-API-calls, suggest→review→create boundary | `product-variants-panel.test.tsx` untouched, still passing; workspace's PR-3 tests untouched and still passing. |
| No `Product.is_online` anywhere | New test asserts the `POST /products` body never carries an `is_online` key; `buildPayload` (unmodified) was also read directly to confirm no such field exists in its output. |
| `CommerceListing.is_published` stays sole publication authority | Publication reads/writes go exclusively through `useProductPublication`/`replaceProductPublication`, which call the pre-existing `/commerce/workspace/products/{id}/publication` endpoints; no local-only publish flag was added anywhere. |
| Media identity not made a configurable Setting | No `Settings`/`BranchSettings` field was added for media; cover/order stays purely list-position-derived. |

## 14. Diff audit

```
git diff --stat 26c0648..HEAD
 web/src/app/(app)/products/[id]/page.tsx           | 166 +++-----------------
 web/src/app/(app)/products/new/page.tsx            | 158 ++-----------------
 web/src/components/products/product-workspace.test.tsx | 132 ++++++++++++++++
 web/src/components/products/product-workspace.tsx  | 170 ++++++++++++++++++---
 web/src/messages/ar.json                           |   1 +
 web/src/messages/en.json                           |   1 +
 + web/src/components/products/product-media-section.tsx (new file)
```

`git diff 26c0648..HEAD --name-only -- app/ database/ routes/ tests/` returns **empty** — confirmed zero backend changes: no migrations, no accounting/`LedgerService`/`InventoryService`, no `ProductPricingService`, no barcode registry, no Product Variant domain files, no `CommerceListingService`/publication authority files, no tenant-isolation (`BaseModel`/`TenantScope`) files, no unrelated module. The PR is bounded strictly to the six frontend files listed above.

## 15. Risks

- The create-mode publication design decision (hook deliberately never bound to the post-save `productId`) is a real, load-bearing choice, not an oversight — documented at length in `product-workspace.tsx` itself (`publicationTracksProduct` comment block) so a future maintainer does not "fix" it by re-binding the hook and reintroducing the race.
- Media upload-after-create is a second, non-atomic network call (backend does not accept files on `POST /products`); a partial failure (product created, images not uploaded) is possible and intentionally soft-fails with a toast, matching the pre-existing `/products/new` behaviour exactly — not a new risk, just relocated.

## 16. Remaining non-blocking work

- IA: the 3-card top grid (Basic/Pricing/Inventory) does not exactly match `AWJ_PRODUCT_CREATE_EDIT_V2_UX_ARCHITECTURE.md` §5's canonical ordering (Options & Variants/Media before Inventory) — see §6 above for why this was left alone in this bounded pass.
- Option-value-level and exact-variant media overrides remain unbuilt (confirmed no authoring backend exists); left as documented future work per the architecture doc's own §14/§22, not invented here.
- No live-viewport mobile screenshot/manual pass was performed in this session (see §11) — recommend a manual phone-width pass before this ships to production, even though the CSS is reused unchanged from already-shipped surfaces.
- No dedicated frontend test infra exists for permission-denied/error states across the app (pre-existing gap, not introduced or worsened here).

## 17. Product Create/Edit V2 closure classification

**B) CORE CLOSED WITH NON-BLOCKING FOLLOW-UPS.**

Evidence:

- All nine architecture-doc-named sections are now present in one implementation, reachable from both Create and Edit, through `ProductWorkspace` alone: basic info, classification (category/brand), pricing/tax/accounts, units/multi-barcode/unit-price, options & variants, inventory, media, publication, additional info.
- The "one component, two modes" (pending-before-save / live-after-save) pattern established in PR-2 is now applied consistently across every section that needs it (barcodes, variants, media) — no outlier implementation remains.
- `ProductDialog` (Quick Add) is correctly bounded and untouched across all four PRs, exactly as the architecture doc specifies (§17).
- Zero fabricated fields anywhere in the whole initiative: no `Product.is_online`, no invented SEO/storefront fields, no option-value/variant media UI without confirmed backend authority.
- Full regression suite (1810 tests) and production build are green with this PR applied.

Why not **A) CLOSED**: the IA section order has one acknowledged, non-blocking deviation from the architecture doc's canonical ordering (§6/§16), and mobile behaviour for the newly-relocated sections was verified by construction/class-reuse rather than a live-viewport pass. Neither blocks correctness, data integrity, or any of the four PRs' stated invariants — both are cosmetic/verification-process gaps, hence **B**, not **C**.

## 18. Next recommended step

A human review pass on this PR (diff + a live phone-width click-through of `/products/new` and `/products/[id]`), then, only if desired later, a small separate follow-up PR for the IA grid reorder — not part of this initiative's remaining scope per the mission's explicit hard stop (no PR-PROD-UX-5 to be started from this session).
