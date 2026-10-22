# IMP-H2-S1 — Product write-path convergence (V2 create)

**Branch:** `claude/imp-h2-s1-write-path` · backend only, behavior-preserving

## Change

`ProductImportService::apply()` created products with `Product::create(createPayload) + ProductLifecycleService::create`. It now calls `ProductService::create($payload, $userId, generateSku: false)` — the same service the product card and the AI Actions path use (transaction + product + opening-stock hook + lifecycle event).

- `generateSku: false` — the SKU is still completed in `createPayload()` from the same locked counter (V2 behavior byte-for-byte); the service never invents a second one.
- `createPayload()` now strips `initial_quantity`: `ProductService::create` records an opening stock when it is present, while this path **never** imports quantity/stock/ledger effects (contract in CLAUDE.md). With quantity 0 the service's `recordOpeningStock` is a no-op anyway (verified: returns `null` for quantity ≤ 0).
- Updates still go through `ProductLifecycleService::update` (unchanged).

## Safety

No migration, env, ledger, ZATCA or AI change. The existing rollback characterization (`a_rolled_back_apply_leaves_no_orphan_category_or_brand`, which swaps `ProductLifecycleService` in the container) still holds because the service resolves the lifecycle from the container.

## Tests

New `ProductImportWritePathTest` (3): import creates exactly one `created` lifecycle event per product with **zero stock movements and zero journal entries**; blank SKUs are filled from the counter once and are unique; the event written by import has the same shape as the one written by `ProductService::create`. Characterization suites unchanged and green: `ProductImportTest`, `ProductImportV2Test`, `ImportJob*`, `AiActionProduct*` — 255 passed, 4 skipped (PG-only). CI on the PR. Codex is out of quota — no Codex review is claimed.
