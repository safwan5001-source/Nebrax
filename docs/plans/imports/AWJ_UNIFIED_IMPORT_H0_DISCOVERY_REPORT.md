# AWJ Unified Import — H0 Discovery Report

> **Slice:** IMP-H0-S1 (docs only, no code change)
> **Base SHA:** `474aad133244666e39378b1fb2c5744f0974ea81` (`origin/main`, 2026-10-21). The owner-supplied SHA `e69995d` (AI-ACTIONS-08) is confirmed to be an ancestor.
> **Method:** Static read of `app/`, `routes/`, `config/`, `web/src`, `tests/Feature`, and the AI-ACTIONS-00..08 and Document Center docs. Every finding below carries a `file:line` reference. Findings marked **[verified]** were re-read by hand after the automated sweep.
> **Not done in H0:** No runtime execution against Railway and no production read. Deployment state is **unknown** (the owner reports an earlier Railway deploy stall).

---

## 1. Inventory of import paths

### 1.1 Product Import V2 (standard, sync)

- **Routes:** `routes/api.php:552-556`: `GET products/import/{template,fields}`, `POST products/import/{inspect,preview,apply}`.
  - Permission `products.manage` only. No `$app` gate, no throttle, no `EnforceUserIdempotency`.
- **Service:** `app/Services/ProductImportService.php`.
  - Modes `create|update|upsert` (default `create`).
  - Blank-cell policy `ignore|clear`.
  - Master-data policy `match_or_error|match_or_text` (default) `|create_missing` (categories and brands only; unit templates are never created).
- **Limits:** 2000 rows (sync), 20000 rows (durable `for_durable`), 200 columns, 5 MB, ZIP media ≤ 50 MB.
- **Matching:** Nebrax ID → SKU (not in `create`). Name is never an identifier. Barcode is used only for conflict checks.
- **Locked on update:** `type`, `track_inventory`.
- **Write:** one `DB::transaction`; live SKU and barcode conflict re-check.
  - **[verified]** Create uses `Product::create` directly, then `ProductLifecycleService::create` (`ProductImportService.php:332-333`).
- **Media:** `ProductImportMediaService`, ≤ 8 images per product.
  - Remote URLs are fetched by `ProductImageRemoteFetcher` only if `PRODUCT_IMPORT_REMOTE_IMAGES_ENABLED` is set (default **false**). The fetcher allows public IPs only, follows no redirects, enforces timeouts and a byte cap, and accepts JPEG/PNG/WebP.
  - In the sync path, media is applied **after** the product transaction commits (`ProductController.php:210-216`).
- **Never touches** stock quantity, average cost, movements or the ledger (`ProductImportService.php:30-34`).

### 1.2 Product Workbook (standard, sync)

- **Routes:** `routes/api.php:559-564`. `products.manage`, except export, which needs `products.view`.
- **Sheets:** `Products` (mandatory; delegated unchanged to V2 through a temp CSV), `Barcodes` (create-only alternate barcodes, registry re-check), `Unit Prices` (writes through `PriceListService::upsertItem` into one explicit `price_list_id`).
- One transaction across all sheets, XLSX only, 2000 rows. No media.
- **UI gap:** `web/src/app/(app)/products/workbook-import/page.tsx` has no inspect step, no template download and no mapping UI.

### 1.3 Durable Import Jobs (standard, client-driven chunks)

- **Routes:** `routes/api.php:568-572`. `products.view` (index/show) and `products.manage` (store/apply/cancel). **No `$app` gate.**
- **Model:** `ImportJob` (`CompanyWide`). It stores file SHA-256, archive SHA-256, options, result and `purge_after`.
- **Domains:** `product_catalog`, `product_workbook`, `inventory_opening` (`app/Support/ImportJobDomain.php`).
- **Statuses:** `uploaded → ready → processing → completed | failed | cancelled`. `queued` is declared but unreachable, because `QUEUE_CONNECTION=sync`.
- **Apply:** `applyNextChunk` holds a row lock on the job and freezes options at the first chunk.
  - Catalog runs in 100-row chunks.
  - Workbook and opening run as one atomic chunk; opening creates a **draft** only.
- **Idempotency:** optional `idempotency_key`, unique `(tenant_id, idempotency_key)`. **The UI never sends it** (`products/import/page.tsx:208`).
- **Retention:** `IMPORTS_RETENTION_DAYS` (default 14); `imports:prune` runs daily at 02:15.

### 1.4 Inventory Opening (standard)

- **Routes:** `routes/api.php:1510-1518`. `products.view|manage` **+ `$app('inventory.core')`**.
- **Flow:** inspect → preview (no writes) → draft (`InventoryOpeningService::createDraft`) → separate post.
  - Post takes locks on the document and its products and re-checks for prior movements.
  - It calls `applyReceipt` per line and posts **one** JE (Dr inventory role / Cr 3130, split per warehouse branch).

### 1.5 AI Actions — `product_import.v1` (AI-ACTIONS-00..08)

- **Registry:** closed, with one type only (`app/Services/AiActionRegistry.php:10-26`).
- **Lifecycle** (`routes/api.php:426-476`): draft/versions (HMAC proposal hash, `expected_version` CAS) → files (CSV/XLSX) → deterministic extraction → review (user edits = new versions) → preview (Nebrax ID → SKU → barcode registry; unknown or ambiguous category/brand **blocks** the row) → approval → execution → repair → images.
  - **Approval** is bound to `preview_hash` (`hash_equals`), is recomputed live, is unique per preview, and has a 60-minute TTL.
  - **Execution** is gated by `AI_ACTIONS_EXECUTION_ENABLED` (default off), requires executor = approver, allows one execution per approval (DB unique), and uses a lease with 200-row batches and a per-row transaction.
  - **Repair** creates a new action from failed rows.
  - **Images** are staged privately (ZIP or URL) under SHA-256 identity.
- **Write:** **[verified]** `ProductService::create(..., generateSku: false)` (`AiActionProductExecutionService.php:415`) and `ProductLifecycleService::update`. It is **not** `ProductImportService`.
- **[verified] No LLM call in the pipeline.** The `ai_suggested` origin is declared (`app/Support/ProductImportActionSchema.php:10`) but produced nowhere. The UI label is «استيراد عبر مساعد أَوْج» / "Import via AWJ Assistant" (`web/src/messages/en.json:4908`).
- **Flags, all off by default:**
  - `AI_ACTIONS_ENABLED`
  - Tenant `ai_actions.enabled`. **There is no write endpoint for it**; only tests set it.
  - `AI_ACTIONS_EXECUTION_ENABLED`
  - Remote image fetch
  - `AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED`
- **Permissions:** `ai.actions.use|approve|repair`, each also requiring `products.manage`; owner/admin only.

### 1.6 Intelligent Document Center (real AI, documents)

- **Input:** PDF, JPEG, PNG and WebP. Review-ready types are `purchase_invoice`, `expense` and `delivery_note` (`DocumentReviewReadinessPolicy.php:15`).
- **Providers:** real HTTP adapters for Anthropic, OpenAI and Gemini, with output normalized to `document-schema-v1`.
- **Gates, all off by default (rollout Stage 0):** `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED`, the engine and its primary provider, tenant `document_intelligence.processing_enabled`, and scan admission.
- **Deterministic steps:** product, counterparty and unit matching; duplicate detection; financial validation in minor units.
- **Drafts:** `PurchaseDocumentDraftBuilder` → `PurchaseService::create`; `ExpenseDocumentDraftBuilder` → `ExpenseService::create`. Both are idempotent through `DocumentTransactionLink`.
- **Accepted types without a builder:** sales_invoice, receipt, credit/debit notes.

### 1.7 AI Assistant

- **Provider:** `mock` by default. Anthropic is wired and shares the `document_ai` platform credential with Document Center.
- **Gates:** consent with acknowledgement, a required budget row, and a network gate.
- **Tool registry:** read-only finance tools only. **No import tool, no file attachment, no link to AI Actions.**
- **UI:** the assistant panel has no products or import context.

### 1.8 Everything else

**[verified via grep of `SpreadsheetReader` usages and routes]** There is **no** bulk import for:
- customers or suppliers
- expenses, purchases or sales invoices
- journal entries or account opening balances
- employees
- categories, brands or units (standalone)
- standalone price lists
- warehouses or branches
- fuel

Partner opening balance exists only as a per-record field. It **posts a JE** through `PartnerService::create` → `recordOpeningBalance` (`PartnerService.php:41-75`).

---

## 2. Findings (defects and risks in existing code)

| # | Finding | Evidence | Severity | Planned slice |
|---|---|---|---|---|
| F-1 | `/import-jobs` has no `$app` gate, so an `inventory_opening` job creates opening drafts even when `inventory.core` is disabled or suspended. The direct opening routes enforce the gate. | **[verified]** `routes/api.php:568-572`; `ImportJobController.php` has no domain gate | Medium (capability-gate bypass; drafts only, and posting stays gated) | IMP-H1-S1 |
| F-2 | `imports:prune` deletes only `storage_path`. Completed jobs keep `media_archive_storage_path`, so archives leak past retention. | **[verified]** `PruneImportJobs.php:42-46`; cancel and failure paths do clear it (`ImportJobService.php:211, 600`) | Medium (retention/privacy) | IMP-H1-S1 |
| F-3 | A failed catalog chunk leaves earlier chunks committed and the job terminal `failed`. In-file duplicates are detected per window only. | `ImportJobService.php:393-400`, `:585` | Medium | IMP-H1-S5 |
| F-4 | No binding between the reviewed preview and the durable job: the file is re-uploaded and its SHA is not compared. | `ImportJobService.php:63-180` | Medium | IMP-H1-S3 |
| F-5 | The UI never sends `idempotency_key`; import routes have no throttle. | `products/import/page.tsx:208` | Low | IMP-H1-S3 |
| F-6 | Remote image fetch runs inside the job transaction while holding the row lock. | `ImportJobService.php:470-500` | Low (dark flag) | IMP-H1-S5 |
| F-7 | Sync V2 media is written outside the product transaction. | `ProductController.php:210-216` | Low | IMP-H1-S5 (or document) |
| F-8 | A zero-value inventory opening posts movements without reaching `AccountingDateGuard`. | **[verified]** `InventoryOpeningService.php:314-318` | Medium (accounting integrity) | IMP-H1-S6 |
| F-9 | Two product write paths: V2 uses `Product::create` and AI uses `ProductService::create`. | **[verified]** see §1.1 and §1.5 | Medium (divergence) | IMP-H2-S1 |
| F-10 | Duplicated value-validation regexes in the AI intake and review services. | `AiActionProductFileIntakeService.php:244-247`, `AiActionProductReviewService.php:133-136` | Low | IMP-H2-S2 |
| F-11 | AI Action spreadsheets bypass malware scan admission. Document Center scans PDF/images only. | `AiActionProductFileIntakeService.php` (no scan call) | Medium | IMP-H1-S4 + D-04 |
| F-12 | "AI" labeling over a deterministic pipeline, which contradicts the owner rule. | `en.json:4908`, `ai-import/page.tsx` | Medium (trust) | IMP-H2-S0 |
| F-13 | There is no API to set tenant `ai_actions.enabled`. | `Settings.php:49-51` | Low | IMP-H2-S4 |
| F-14 | Category/brand master-data behavior differs: V2 defaults to `match_or_text`, while AI blocks unknown names. | Assessment 05 §1b | Low (documented) | Adapter policy in IMP-H1-S2 |

---

## 3. Test inventory (baseline)

**Backend** (`tests/Feature`), about 190 import tests plus the AI Actions suites:

| Suite | Tests |
|---|---|
| ProductImportV2Test | 52 |
| InventoryOpeningImportTest | 34 |
| ProductWorkbookTest | 20 |
| InventoryOpeningPostingTest | 17 |
| ImportJobTest | ~16 |
| ImportJobApplyTest | 14 |
| ImportJobWorkbookApplyTest | 12 |
| ImportJobInventoryOpeningApplyTest | 12 |
| ProductImportMediaSecurityTest | 6 |
| ProductImportTest | ~7 |
| ImportJobDomainRowLimitsTest | 3 |

The AI Actions suites are `AiActionsFoundationTest` and `AiActionProduct{FileIntake,Review,PreviewApproval,Execution,Repair,Images}Test`, plus `AiActionStaging{Cleanup,Scheduler}Test`.

**Frontend** (vitest):
- `page.test.tsx` for products/import, workbook-import, ai-import and inventory-openings/import
- `useImportJobEngine.test.tsx`
- `contract.test.ts`, `stepper.test.tsx`
- `web/src/modules/ai-actions/*.test.*`

**CI:**
- `ci.yml` runs PHP on SQLite and PostgreSQL for every PR.
- `web-ci.yml` runs on `web/**`.
- `ci-gate.yml` aggregates the result.

---

## 4. Deployment model (relevant to merge safety)

- Railway auto-deploys `main` on every merge, **without waiting for CI** (`AWJ-ANIMATED-MEDIA-CANVAS-PARITY-REPORT.md:133`). The container runs `php artisan migrate --force` on every boot (`deploy/entrypoint.sh:70`).
- **Consequence for this Horizon:** every merged slice reaches production on the next successful deploy.
  - Migrations must be additive.
  - Features ship behind default-off flags or behind entry points that need explicit enabling.
  - A slice whose migration could lock or rewrite large tables needs owner sign-off before merge.
- **The H0 docs merge** deploys no new code. If Railway is currently stuck, the next push to `main` (any author) re-triggers a deploy of the already-merged code. That code merged before this Horizon (for example REM-18b-3a, `#1577`), so the H0 merge adds no deploy risk of its own.

---

## 5. External evidence vs. AWJ decision (H0 scope)

- **External Evidence:** not collected in H0. Visual and product research (Shopify CSV import, Odoo import with saved mappings, Zoho Books import, Daftra import, Business Central configuration packages) is **mandatory at IMP-H8-S1** and at each UX slice, per the Horizon protocol §4/§6. H0 does not claim any external behavior.
- **AWJ Decision (H0):** one adapter seam, two experiences; financial imports create drafts only; AI as validated suggestions only; reuse Document Center for document extraction (see master plan §2).
- **Rejected / Not adopted:**
  - Merging `ImportJob` and `AiAction` into one table (high-risk migration, no user gain).
  - Building a new extraction service for purchases/expenses (Document Center exists).
  - Importing warehouses or branches (structural, low cardinality).
  - Inferring partner `type` or matching by name.
