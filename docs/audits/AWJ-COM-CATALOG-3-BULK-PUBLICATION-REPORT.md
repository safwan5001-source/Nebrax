# AWJ-COM-CATALOG-3 — Bulk Selection & Publishing (Published Products)

| | |
|---|---|
| Branch | `claude/commerce-bulk-selection-publish-1yxzho` |
| Base SHA | `3fbeb69eed7af15d902ac7e864f063a851f52017` (`main`) |
| Verified code head | `f3fa04a86391bc2e6ecc5fb1e6d669ab8950d376` — all CI checks green on this SHA (see §5). The PR head is this report's docs-only commit on top; a report cannot contain its own commit SHA, so read the final head from the PR. |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1973 |
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
- **Concurrency guard (Codex P2, fixed in `f3fa04a`):** the single-record action replaces the full per-store set from row state at click time, so bulk actions are blocked while a single update is in flight and single actions are blocked while a bulk run is in flight.
- **Pagination recovery (Codex P2, fixed in `f3fa04a`):** if a bulk change removes the current page (e.g. under a status filter), `load()` clamps to the last existing page instead of showing the empty state without pagination controls.

## 2. Changed files
**Backend:** `app/Http/Controllers/Api/Commerce{Product,Category}PublicationController.php`, `app/Services/Commerce/Commerce{Product,Category}PublicationService.php`, `app/Providers/CommerceWorkspaceServiceProvider.php`, `tests/Feature/CommerceModuleBoundaryTest.php` (route allow-list), `tests/Feature/CommerceBulkPublicationApiTest.php` (new).
**Frontend:** `web/src/app/(commerce)/commerce/published-products/page.tsx` (+ `page.test.tsx`), `web/src/modules/commerce-workspace/publication-bulk/{bulk-publication.tsx,selection.ts,selection.test.ts}` (new), `web/src/modules/{products,categories}/publication.ts` (+ tests), `web/src/modules/commerce-workspace/messages.ts`, `web/e2e/commerce-bulk-publication.spec.ts` (new).
**Docs:** `CLAUDE.md` (contract note), this report.

## 3. Tests

| Suite | Result |
|---|---|
| Backend new `CommerceBulkPublicationApiTest` | 11 tests pass (selected-only, idempotency, other-store untouched, foreign IDs, foreign/inactive/malformed store, per-record failure isolation, RBAC, validation + cap, categories, products↔categories independence + no stock/journal rows) |
| Backend related (publication API, boundary, RBAC, route-scanning guards, OpenAPI contract, branch isolation) | 98 pass |
| Frontend unit/page (commerce-workspace, products, categories, app/(commerce), guards) | 143 files / 1,611 tests pass at `f3fa04a` (page test file: 29 tests, incl. 2 regression tests that fail on the pre-fix code) |
| Playwright `commerce-bulk-publication.spec.ts` (desktop 1440 + mobile 390, ar/en) | 8/8 pass, no horizontal overflow; screenshots reviewed |
| `next build` | passes |
| Mutation checks | disabling clear-on-filter-change is caught by 2 tests; reverting `f3fa04a` fails both new regression tests |

### Full PHP suite — local sandbox (SQLite, serial, `php artisan test`), run at `e6aed61`
**74 failed, 377 skipped, 10,794 passed (108,248 assertions).** None of the 74 touch publication code. **Superseded by CI (§5):** the same full suite passes on both sqlite and pgsql in GitHub CI at `f3fa04a`, which confirms both groups below were sandbox-only.

| Group | Count | Cause |
|---|---|---|
| Fuel* (AviRfid, CostPool, Reconciliation, SaleApi, SaleService, StationScope, SupplyReceiving×2) | 50 | Sandbox lacks PHP `bcmath` (the setup hook warns about this; `apt` has no package). 47 verified as `Call to undefined function bc*()`; 3 are API 500 responses inside Fuel classes **not individually traced** (consistent with the same cause). |
| `WholesalePriceVisibilityTest`, `WholesaleQuickOrderTest` | 24 | `no such table: tenants` — DB-state pollution in the long serial run. **Pass in isolation (9/9), together with my new class (49/49), and with all `Wholesale*` classes in suite order (173 pass, 0 fail).** Polluter not identified; a base-branch full run was not performed. |

The local run alone would not satisfy the project's pre-PR rule (all tests green). The CI full-suite runs (sqlite + pgsql, with `bcmath`) are the authoritative result and are green — including every Fuel and Wholesale class listed above.

## 4. Journal entries (CLAUDE.md pre-PR protocol)
No financial operation exists in this change: no journal entry, ledger line, stock movement, payment or invoice is created (asserted in `product_and_category_bulk_are_fully_independent`). Table: n/a.

## 5. CI (GitHub, PR #1973, verified head `f3fa04a`)

| Check | Result |
|---|---|
| `php artisan test (L11, sqlite)` — full suite | ✅ success |
| `php artisan test (L11, pgsql)` — full suite | ✅ success |
| `web build (Next.js)` (Vitest + type-checked build) | ✅ success (first attempt failed on a transient `next/font` Google Fonts fetch error in `store-experience-builder/presentation/fonts.ts`, a file this PR does not touch; passed on the single re-run; the run on the previous head also passed) |
| `PostgreSQL feed-lock performance (COPS-H1-1)` | ✅ success on the single re-run (see below) |
| `CI Gate` | ✅ success after re-run (it only aggregates the checks above) |
| Codex code review | ✅ completed at `f3fa04a`, no findings; its 2 P2 findings on `6be2494` were verified real, fixed and the threads resolved |
| GitHub mergeability | `clean` |

### COPS-H1-1 timing gate — diagnosis
- A timing gate (`CommerceOrderEventsPostgresTest::the_realistic_load_gate…`, added p95 feed-lock wait < 50 ms) that only runs `--group cops-h1-1-perf`. Nothing in this PR executes in that job (this PR changes publication code, the Published Products page, tests and docs only).
- Failed on `6be2494` (round 3: 77.6 ms) and `f3fa04a` (round 3: 71.1 ms) with rounds 1–2 at 13.6–19.5 ms each time; each failure had one cluster of 12 slow waits in round 3.
- The same job failed at the same step on `main` (run `da1b33e`, 2026-11-03 20:38 UTC) before this PR existed, while `main` at the base SHA `3fbeb69` passed — i.e. the gate is intermittent independent of this PR.
- **One** re-run of the failed job (no code or benchmark change) passed: job `126507247736`, 2026-11-04 09:50–09:51 UTC. The budget and the test were not modified.
- Not proven: why round 3 spikes on shared runners. That belongs to the COPS-H1-1 owners; treat it as a pre-existing flaky gate, not a regression from this PR.

## 6. Risks / decisions left to the owner
1. **Inactive products/categories** can be bulk-published exactly as with the single-record action (policy intentionally unchanged per instruction).
2. No "select all N matching the filter": would need a server-side ID resolver and an explicit-scope design; deferred.
3. Max 100 per request; > 100 selection is blocked client-side. Sync request ⇒ large batches are bounded by that cap (production queue is `sync`).
4. A request-level network failure leaves outcome unconfirmed by design; the UI says so and asks to verify.
5. No audit-log entry per bulk operation (single-record publish has none either); add if governance requires it.
6. Local-sandbox suite failures (Fuel / Wholesale) were environmental and are closed by the green CI full-suite runs; the Wholesale order-dependent pollution in the long *local* serial run was not root-caused.
7. The COPS-H1-1 timing gate is intermittently red on `main` as well; expect occasional re-runs on any PR until its owners address it.
8. Docs-only commit: this report is committed on top of the verified code head `f3fa04a`, which starts a fresh CI run; it changes no code.

## 7. Next steps
**Merge-readiness recommendation:** code is ready to merge — all CI checks green on `f3fa04a`, Codex clean, mergeable `clean`, no financial/inventory/accounting effect, backward compatible (additive endpoints, existing single-record flow unchanged). Merge is conditional on this report's docs-only commit also finishing green (re-run the intermittent COPS-H1-1 gate at most once if it recurs). **Merge and Deploy are NOT performed; both need the owner's explicit approval** (deploy separately).

Optional follow-ups: audit trail per bulk operation, filter-scoped "select all matching", owner decision on inactive-item bulk publishing, hardening/triage of the COPS-H1-1 gate.
