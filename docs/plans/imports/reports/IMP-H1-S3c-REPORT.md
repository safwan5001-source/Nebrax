# IMP-H1-S3c — `plan_drift`, sync-apply binding, PostgreSQL race proof

**Branch:** `claude/imp-h1-s3c-plan-drift` (on top of S3b, #1610). Remaining for the S3 family: the **activation** of `preview_required` (one-line code change after the UI is live) and the UI idempotency key + route throttle (S3d).

## What changed

| Piece | Behaviour |
|---|---|
| Preview **plan** (catalog) | `ProductImportService::previewWithPlan()`: for every data row a compact code — `c` create · `u:<productId>` update · `s:<productId>` skip (no-op) · `e` error. Stored gzip+base64 in `import_previews.plan`, copied to `import_jobs.apply_plan` when the preview is spent |
| `plan_drift` | `apply()` compares each row of the current window with the frozen plan **before any write**; a difference (e.g. an `upsert` row planned as *create* whose SKU someone created meanwhile, a planned update whose target product changed, a planned skip that would now change the product) throws `ImportPlanDriftException` (`plan_drift: الصف N …`). Durable path: the chunk fails and the job becomes `failed` with that message; sync path: 422. Nothing is written |
| Sync apply binding | `products/import/apply`, `products/workbook/apply`, `inventory-openings/import/apply` accept `preview_id`+`preview_hash`. With a preview: verified against file+options (same rules as job creation) and **consumed in the same transaction as the write** (a failing write gives the preview back). Without: legacy contract until `imports.preview_required_from` is set (`preview_required`) |
| PostgreSQL proof | `ImportPreviewConcurrencyPostgresTest` (`pcntl_fork`, real row locks): 8 concurrent consumers → exactly 1 wins (rest `preview_consumed`); 6 concurrent `ImportJobService::create` with one preview → exactly 1 job. Negative control: removing the conditional `UPDATE` guard fails both |

## AWJ decisions (deviations from the master plan, recorded)

1. **The plan omits the target's `updated_at`.** The master plan proposed comparing it too. In a live tenant, every sale / stock movement touches `products.updated_at`, so the check would fail spuriously on busy catalogs. What matters is *which* product and *which* action; the apply writes only the file's fields over the same target, exactly as previewed.
2. **Chunk-level failure.** A drifted row fails its whole chunk (≤100 rows) — the same granularity as every other live-conflict failure today. Per-unit failure + repair is S8.
3. **Workbook and inventory-opening have no row plan.** They are atomic file units validated whole inside the same transaction as the write (opening already refuses products with prior movements); their binding covers file + options. Recorded exclusion.

## Safety / deploy evaluation

- No journal entry; domain write paths unchanged (the plan check runs *before* any write and only raises); AI settings, Railway, accounting, ZATCA untouched.
- **Migration** `2026_11_25_010000`: two nullable `longText` columns (`import_previews.plan`, `import_jobs.apply_plan`) — metadata-only, no backfill; existing previews/jobs have no plan ⇒ no comparison (old contract).
- Behavior change only for clients that send a preview (the first-party UI does) and, for sync endpoints, nothing until activation.
- Plan size: ~45 bytes/row raw, gzip'd (≈200 KB at the 20,000-row ceiling).

## Tests

`ImportPlanDriftTest` (11): plan stored + copied to the job; codec round-trip + corrupt plan fails closed; unchanged world across multi-chunk; create→update drift; changed target identity; planned skip now changing; legacy job (no plan) unchanged; sync catalog apply consumes + no replay; failing sync apply does not burn the preview; sync mismatch; the three sync applies require a preview only after activation. Negative control (comparison disabled) fails 4 of them. Affected suites (`ImportJob*|ProductImport*|ProductWorkbook*|InventoryOpening*|AiActionProduct*|ImportPreviewBinding*|ImportDomain*`): 383 passed. PostgreSQL race tests run **locally on a real PostgreSQL 16 with pcntl** (also in CI pgsql job).

## Not in this slice

- Activation of `preview_required` (code change after the UI is deployed — needs a deploy-order check, not an env var).
- UI idempotency key + route throttle (S3d).
- Plan for workbook/opening (excluded above); per-unit failure/repair (S8).

## Review

Codex reviews each PR when quota allows; findings are handled on the PR. Independent subagent review: see PR.
