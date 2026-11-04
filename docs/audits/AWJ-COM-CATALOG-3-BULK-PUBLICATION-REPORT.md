# AWJ-COM-CATALOG-3 — Bulk Selection & Publishing (Published Products)

| | |
|---|---|
| Branch | `claude/commerce-bulk-selection-publish-1yxzho` |
| Base SHA | `3fbeb69eed7af15d902ac7e864f063a851f52017` (`main`) |
| Code head | `3b75cbdb775748774dca379cd999c790e03a8bd3` (the PR head is this report's commit on top) |
| Scope | Products tab + Categories tab, `/commerce/published-products` |
| Merge / Deploy | **Not performed** — awaiting explicit approval |

## 1. What was built

### Backend (additive; single-record endpoints untouched)
`POST commerce/workspace/products/publication/bulk` and `POST commerce/workspace/categories/publication/bulk`.

- **AuthZ:** `products.manage` (existing permission, no new one); `self_service` → 403; unauthenticated → 401.
- **Body:** `action` (`publish|unpublish`), `storefront_id` (**required, exactly one store**), `ids` (1..100 distinct UUIDs). No "all stores", no filters, no tenant id from the client.
- **Isolation:** store resolved only inside the tenant's active web storefronts, else 422 before any write. IDs resolved through the tenant-scoped query; foreign/unknown ⇒ uniform `rejected / not_found` (foreign is indistinguishable from missing).
- **Effect:** writes `is_published` on the **chosen store's channel listing only** (`CommerceListing` / `CommerceCategoryListing`), for the listed IDs only. No inventory, pricing, financial, or accounting data is read or written.
- **Partial failure:** each record in its own transaction; response is 200 with `summary{requested,updated,unchanged,rejected,failed}` and per-record `results`. Idempotent (`unchanged`; no row is created to "unpublish" a record that was never listed).
- **Not changed:** the publication policy for inactive products/categories (bulk = identical behaviour to the existing single-record publish).

### Frontend
- Row checkboxes + "select all" with indeterminate state, on both tabs; only for users with `products.manage` and ≥ 1 active web store.
- **Select-all label (explicit scope):** AR `تحديد كل عناصر الصفحة الحالية فقط` / EN `Select all items on the current page only` (also on the mobile header row).
- Selection = explicit IDs (no "select all matching the filter"); persists across pages; **cleared immediately** on any change of search text, status filter, store filter, and on tab switch; capped at 100 (matches server) with a visible notice. A notice explains when a filter change cleared the selection.
- Bulk bar shows total / on-this-page / on-other-pages counts and the scope hint; sticky on mobile. Multi-store tenants must choose the target store explicitly; single-store is deterministic.
- Confirmation dialog states action, exact count, store name, sample names → result dialog with counts and per-item names for rejected/failed; failed items alone stay selected for retry. A request-level failure says the outcome is unconfirmed and keeps the selection.
- Individual per-store actions preserved. AR/EN, RTL/LTR, 44 px touch targets, design tokens only.

## 2. Changed files
**Backend:** `app/Http/Controllers/Api/Commerce{Product,Category}PublicationController.php`, `app/Services/Commerce/Commerce{Product,Category}PublicationService.php`, `app/Providers/CommerceWorkspaceServiceProvider.php`, `tests/Feature/CommerceModuleBoundaryTest.php` (route allow-list), `tests/Feature/CommerceBulkPublicationApiTest.php` (new).
**Frontend:** `web/src/app/(commerce)/commerce/published-products/page.tsx` (+ `page.test.tsx`), `web/src/modules/commerce-workspace/publication-bulk/{bulk-publication.tsx,selection.ts,selection.test.ts}` (new), `web/src/modules/{products,categories}/publication.ts` (+ tests), `web/src/modules/commerce-workspace/messages.ts`, `web/e2e/commerce-bulk-publication.spec.ts` (new).
**Docs:** `CLAUDE.md` (contract note), this report.

## 3. Tests

| Suite | Result |
|---|---|
| Backend new `CommerceBulkPublicationApiTest` | 11 tests pass (selected-only, idempotency, other-store untouched, foreign IDs, foreign/inactive/malformed store, per-record failure isolation, RBAC, validation + cap, categories, products↔categories independence + no stock/journal rows) |
| Backend related (publication API, boundary, RBAC, route-scanning guards, OpenAPI contract, branch isolation) | 98 pass |
| Frontend unit/page (commerce-workspace, products, categories, app/(commerce), guards) | 145 files / 1,622 tests pass (re-run after label change: 116 files / 1,268 pass) |
| Playwright `commerce-bulk-publication.spec.ts` (desktop 1440 + mobile 390, ar/en) | 8/8 pass, no horizontal overflow; screenshots reviewed |
| `next build` | passes |
| Mutation check | disabling clear-on-filter-change is caught by 2 tests |

### Full PHP suite (local, SQLite, serial, `php artisan test`)
**74 failed, 377 skipped, 10,794 passed (108,248 assertions).** None of the 74 touch publication code.

| Group | Count | Cause |
|---|---|---|
| Fuel* (AviRfid, CostPool, Reconciliation, SaleApi, SaleService, StationScope, SupplyReceiving×2) | 50 | Sandbox lacks PHP `bcmath` (the setup hook warns about this; `apt` has no package). 47 verified as `Call to undefined function bc*()`; 3 are API 500 responses inside Fuel classes **not individually traced** (consistent with the same cause). |
| `WholesalePriceVisibilityTest`, `WholesaleQuickOrderTest` | 24 | `no such table: tenants` — DB-state pollution in the long serial run. **Pass in isolation (9/9), together with my new class (49/49), and with all `Wholesale*` classes in suite order (173 pass, 0 fail).** Polluter not identified; a base-branch full run was not performed. |

Per the project's pre-PR rule these are **not** a clean full-suite pass; GitHub CI (which loads `bcmath`) is the arbiter for the Fuel classes, and Wholesale must be green there.

## 4. Journal entries (CLAUDE.md pre-PR protocol)
No financial operation exists in this change: no journal entry, ledger line, stock movement, payment or invoice is created (asserted in `product_and_category_bulk_are_fully_independent`). Table: n/a.

## 5. CI
See the PR for live status; recorded in the final report.

## 6. Risks / decisions left to the owner
1. **Inactive products/categories** can be bulk-published exactly as with the single-record action (policy intentionally unchanged per instruction).
2. No "select all N matching the filter": would need a server-side ID resolver and an explicit-scope design; deferred.
3. Max 100 per request; > 100 selection is blocked client-side. Sync request ⇒ large batches are bounded by that cap (production queue is `sync`).
4. A request-level network failure leaves outcome unconfirmed by design; the UI says so and asks to verify.
5. No audit-log entry per bulk operation (single-record publish has none either); add if governance requires it.
6. The two unresolved local-suite items above (3 untraced Fuel 500s, Wholesale ordering pollution) rely on CI to close.

## 7. Next steps
CI green + review → owner approval → merge. Deploy requires separate explicit approval. Optional follow-ups: audit trail, filter-scoped "select all matching", tracing the Wholesale suite-order pollution.
