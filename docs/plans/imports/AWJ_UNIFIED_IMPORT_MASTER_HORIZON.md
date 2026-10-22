# AWJ ERP — Unified Import Master Horizon

> **Horizon ID:** `IMPORT` (slices `IMP-H<n>-S<m>`)
> **Mode:** Horizon protocol, autonomous (`docs/engineering/AWJ_HORIZON_EXECUTION_PROTOCOL.md`).
> **Owner instruction:** "AWJ ERP — Unified Import Master Horizon: Standard Import + AWJ AI Assistant Advanced Import".
> **Planning baseline:** `origin/main` @ `474aad133244666e39378b1fb2c5744f0974ea81` (2026-10-21). It contains the owner's last known SHA `e69995d` (AI-ACTIONS-08).
> **Discovery evidence:** `AWJ_UNIFIED_IMPORT_H0_DISCOVERY_REPORT.md`, in this folder.
> **Live progress:** `AWJ_UNIFIED_IMPORT_HORIZON_TRACKER.md`. This plan does not track status.
> **Next executor entry point:** `AWJ_IMPORT_OPUS_HANDOFF.md`.

---

## 1. Outcome

All supported AWJ imports offer two user paths:

| Path | What it is | AI dependency |
|---|---|---|
| **Standard Import** (استيراد عادي) | Upload → map → validate → edit → preview → approve → execute → repair. Deterministic and repeatable. | None. It never calls a provider, needs no key, and sends no data out. |
| **AWJ AI-Assisted Import** (استيراد بمساعد أَوْج) | The same lifecycle, plus natural-language instructions, AI mapping and correction suggestions, explanations and conversational repair. | A real provider behind consent, budget and network gates. When AI is unavailable the path says so honestly. |

The non-negotiable is **one execution core, two experiences.** Both paths reach the same per-entity domain adapter, which validates, matches and applies through the approved domain services. AI output is an *untrusted suggestion* until the deterministic backend validates it.

---

## 2. Architecture decision (H0)

### 2.1 What exists today (summary; full evidence in the H0 report)

| Engine | Entities | Writes through | AI? |
|---|---|---|---|
| Product Import V2 (`ProductImportService`), sync | Products (+ category/brand `create_missing`, media) | `Product::create` + `ProductLifecycleService` | No |
| Product Workbook (`ProductWorkbookService`), sync | Products + alternate barcodes + unit prices | V2 for products; `alternateBarcodes()`; `PriceListService::upsertItem` | No |
| Durable Import Jobs (`ImportJobService`) | `product_catalog`, `product_workbook`, `inventory_opening` | Delegates to the engines above | No |
| Inventory Opening (`InventoryOpeningImportService` → `InventoryOpeningService`) | Opening stock document → one JE | `applyReceipt` + `LedgerService::post` | No |
| AI Actions (`AiAction*`, AI-ACTIONS-00..08) | `product_import.v1` only | `ProductService::create` / `ProductLifecycleService::update` | **No LLM call anywhere.** The `ai_suggested` origin is declared but never produced. |
| Intelligent Document Center (`DocumentCenter/*`) | Purchase invoice / expense (PDF/image) → drafts | `PurchaseService::create` / `ExpenseService::create` | **Yes.** Anthropic, OpenAI or Gemini; off by default (Stage 0). |
| AI Assistant (`AiAssistantGateway`) | Read-only finance tools | No writes | Anthropic/mock; off by default. Has no import or file tool. |

### 2.2 The unifying seam: **Import Domain Adapter**

We do **not** replace any working engine. We introduce one seam per entity, and every path converges on it:

```text
                 ┌──────────── Standard UX ─────────────┐   ┌──────── AI-Assisted UX ───────────┐
 file intake →   │ /<entity>/import/* (sync, ≤2000)      │   │ /ai-actions/* (versioned action)  │
                 │ /import-jobs (durable, chunked)       │   │ + AI suggestions (mapping/fixes)   │
                 └───────────────┬───────────────────────┘   └───────────────┬────────────────────┘
                                 ▼                                           ▼
                 ┌──────────────────────────────────────────────────────────────────────────────┐
                 │ ImportDomainAdapter (per entity): fields catalog · normalize · validate row ·  │
                 │ match (id → code/sku → …; name never an identifier) · plan · applyRow()         │
                 └───────────────┬──────────────────────────────────────────────────────────────┘
                                 ▼
          Domain services only: ProductService / ProductLifecycleService / PartnerService /
          ExpenseService::create / PurchaseService::create / InvoiceService::create /
          InventoryOpeningService / StocktakeService / StockPermitService / PriceListService
                                 ▼
                  LedgerService::post (only when the domain service posts; imports create drafts)
```

**Rules the adapter enforces for both paths:**

1. **The adapter owns validation and matching.** The AI path may only *propose* values. It submits them through the same `validateRow()`/`plan()`, and a row the standard path would reject is rejected here too (integration parity test required per entity).
2. **Writes go through domain services only.** No direct `Model::create` for business entities, no `journal_lines` writes, no stock writes outside `InventoryService`/`InventoryOpeningService`.
3. **Financial documents import as drafts.** Purchases, expenses and sales invoices are created as **drafts** by import. Posting stays a separate, explicit action through the existing `post()` with its own permission. Import never issues ZATCA documents.
4. **Name is never an identifier.** Matching uses Nebrax ID → entity code (SKU / partner code / document reference) → registered unique keys (barcode, VAT number as a *duplicate signal*). Fuzzy and name matches are *suggestions* that a human must confirm.
5. **Approval binds to content.** Execution requires an approval bound to the exact plan hash (the AI Actions model). The standard durable path gains the same binding (preview hash ↔ job file SHA + options), see IMP-H1-S3.
6. **Configurable policy, not imposed policy** (CLAUDE.md rule 6). Duplicate handling, blank cells and missing master data are per-run options with defaults that preserve today's behavior.
7. **Every entry path carries the direct API's gates.** A durable job domain (H1-S1 map) and an AI Action type (H1-S7 definition) each declare the **same** permission(s) **and** application key as the entity's direct create endpoint. Invariant tests fail CI when a domain or type is registered without them.
8. **Both paths, or a recorded exclusion.** Every entity in §3 that has a standard import either has an AI path slice or a `D-xx` exclusion in §7. There is no silent gap.

### 2.3 Why not merge `ImportJob` and `AiAction` into one table

The two records have different contracts. `ImportJob` is a durable *file* job with a chunk cursor. `AiAction` is a versioned *proposal* with human edits, approvals and repairs. Merging them would be a high-risk migration of working code for no user-visible gain. The non-duplication requirement is met at the **adapter** level, where validation, matching and writes live. Shared infrastructure (`SpreadsheetReader`, `ImportHeaderMatcher`, file storage, scan admission, idempotency) is reused, not forked.

### 2.4 Where "AI" actually comes from

| Input kind | AI engine to reuse | Why |
|---|---|---|
| Spreadsheets (CSV/XLSX) | AI Actions pipeline + a **new** suggestion step (IMP-H9) that calls the provider through the existing assistant provider/consent/budget gates | AI Actions already has versioning, provenance (`origin`), approval and repair. It lacks only the model. |
| Documents (PDF/images: purchase invoices, expenses) | **Intelligent Document Center**, as is | It already does LLM extraction, matching, financial validation, human review and the draft builders. Building a third extractor is forbidden. |
| Conversation | AI Assistant gateway + a new **import tool** that opens or advances an AI Action (never executes) | Keeps one assistant, one consent model and one budget. |

Until a provider is approved and enabled (decision **D-02**), the AI path must show its deterministic state honestly. It must not label deterministic mapping as "AI" (see IMP-H2-S0).

---

## 3. Coverage matrix (target vs. today)

Status legend: ✅ complete · 🟡 needs improvement · 🔨 needs implementation · ❓ needs decision · ⛔ not suitable (reason given).

| ID | Domain | Standard today | AI-assisted today | Target (this Horizon) | Write path | Accounting impact | Priority |
|---|---|---|---|---|---|---|---|
| SCOPE-01 | Products (+SKU, barcode, categories, brands, units, prices, images) | 🟡 V2 + workbook + durable jobs | 🟡 AI Actions, deterministic, no LLM | Align write path; workbook UX parity; mapping presets; real AI suggestions | `ProductService`/`ProductLifecycleService` | None (stock never touched) | **P0** |
| SCOPE-02 | Customers | 🔨 none | 🔨 none | Standard + AI | `PartnerService::create` / update | None, **unless opening balance → ❓ D-01** | **P1** |
| SCOPE-03 | Suppliers | 🔨 none | 🔨 none | Standard + AI (same adapter, `type=supplier`) | `PartnerService` | Same as above | **P1** |
| SCOPE-04 | Purchase invoices | 🔨 none (spreadsheet) | 🟡 Document Center (PDF/image → draft), Stage 0 | Spreadsheet → drafts (standard); AI = Doc Center + AI Action | `PurchaseService::create` (draft) | None at import; JE only on explicit post | **P2** |
| SCOPE-05 | Expenses | 🔨 none | 🟡 Document Center → draft | Spreadsheet → drafts; AI as above | `ExpenseService::create` (draft) | None at import | **P2** |
| SCOPE-06 | Sales invoices | 🔨 none | 🔨 none | **❓ D-03.** Recommended: drafts of *new* invoices only; no historical migration through the ZATCA chain | `InvoiceService::create` (draft) | None at import; ZATCA only on post | **P3 (gated)** |
| SCOPE-07a | Inventory opening balances | ✅ CSV/XLSX → draft → post (one JE) | 🔨 none | AI path (adapter reuse); app-gate fix on jobs | `InventoryOpeningService` | Dr inventory / Cr 3130 at post | **P1 (fix) / P3 (AI)** |
| SCOPE-07b | Stocktake counts | 🔨 none | 🔨 none | Count-sheet import into an open stocktake | `StocktakeService` | Variance JE at the stocktake's own post | **P3** |
| SCOPE-07c | Stock permits (receipt/issue lines) | 🔨 none | 🔨 none | Lines import into a draft permit | `StockPermitService` | At the permit's own post | **P4** |
| SCOPE-08a | Product categories / brands | 🟡 only as a `create_missing` side-effect | 🔨 | Standalone import (category hierarchy) | Category/Brand controllers' services | None | **P2** |
| SCOPE-08b | Unit templates | 🔨 | 🔨 | Create-only import (never edit factors of a used template) | UnitTemplate service | None directly; factors affect stock qty | **P3** |
| SCOPE-08c | Price list items | 🟡 only via the workbook "Unit Prices" sheet | 🔨 | Standalone price-list import | `PriceListService::upsertItem` | None | **P2** |
| SCOPE-08d | Warehouses, branches | — | — | ⛔ Low cardinality, structural, tied to plan limits and ZATCA/branch settings. Manual creation stays. | — | — | — |
| SCOPE-09a | Journal entries / account opening balances | — | — | **❓ D-07** (separate accounting Horizon) | `ManualJournalService` | Direct | — |
| SCOPE-09b | Employees | — | — | **❓ D-06** (PII, payroll and user linkage) | `EmployeeService` | Indirect (payroll) | — |
| SCOPE-09c | Fuel, POS, Commerce orders | — | — | ⛔ Operational and device-sourced data, not bulk-import material | — | — | — |

---

## 4. Horizon roadmap and slices

Each slice is one branch and one PR from the latest `origin/main`, squash-merged under Horizon authority (§7 of the owner brief). IDs are stable; the tracker owns status.

### H0 — Discovery & master architecture (this PR)
- **IMP-H0-S1:** Discovery report, this master plan, tracker, and Opus→Sonnet handoff. Docs only.

### H1 — Shared core alignment (fix what both paths stand on)
- **IMP-H1-S1 — Domain-aware import-job authorization + retention fix.**
  - (a) Add **one per-domain authorization map** on `ImportJobDomain`: `{view permission, manage permission, application key|null}`. Every `/import-jobs` operation enforces it with the same semantics as `EnsurePermission` + `EnsureApplicationActive`. That covers store (domain from the request, before any file is stored), show, apply and cancel (domain from the loaded job), and index (filtered to the domains the user may view).
    - Today `/import-jobs` checks only `products.view|manage`, with no app gate. A tenant with `inventory.core` disabled can therefore still create opening drafts.
    - Initial map:

      | Domain | View | Manage | App key |
      |---|---|---|---|
      | `product_catalog` | `products.view` | `products.manage` | — |
      | `product_workbook` | `products.view` | `products.manage` | — |
      | `inventory_opening` | `products.view` | `products.manage` | `inventory.core` |

    - **Invariant:** a domain cannot be registered without an entry in this map; a test asserts the map covers `ImportJobDomain::values()`. Every later domain must declare exactly the gates of its direct API:
      - partners: `partners.view|manage`
      - expenses: `expenses.view|manage` + `finance.operations`
      - purchases: `purchases.view|manage` + `purchases.cycle`
      - and so on.
    - The route-level `products.*` middleware moves into this map, so a purchases-only user can use purchase jobs without product permissions.
  - (b) `imports:prune` must delete `media_archive_storage_path` for completed jobs (today it deletes only `storage_path`, so archives leak).
  - Tests:
    - negative permission and app-gate tests (disabled / suspended) per domain
    - index filtering
    - map-coverage test
    - prune of a completed job with an archive
- **IMP-H1-S2 — `ImportDomainAdapter` contract + registry**, with the three existing domains wired through it. **No behavior change** (characterization tests first). `ImportJobService::runChunk` dispatches via the registry instead of `match`.
- **IMP-H1-S3 — Durable-path approval binding & idempotency.**
  - Preview returns `preview_hash` = HMAC(file SHA-256 + archive SHA-256 + domain + normalized options + mapping).
  - **Options move to job creation.** `POST /import-jobs` gains `options` (mode, policies, domain fields such as `opening_date`/`price_list_id`) and `mapping`. The server normalizes them exactly as preview does and **freezes them on the job at creation**. Today they first arrive at `/apply`, which cannot be bound.
  - **`preview_hash` is required to create an executable job.** `POST /import-jobs` without it, or with a hash that does not equal HMAC(uploaded file SHA ‖ archive SHA ‖ domain ‖ frozen normalized options ‖ mapping), is rejected (422 `preview_required` / `preview_mismatch`) before `ready`.
  - **`/apply` no longer accepts option changes.** It runs the frozen options. A body carrying options that differ from them returns 422 `options_frozen`; identical options are tolerated for compatibility with the old client during rollout.
  - **Compatibility:** the UI change ships in the same PR. Jobs already `ready` or `processing` at deploy time (`created_at` < the slice's cutover constant) may finish under the old contract; no new hashless job can execute.
  - The UI sends `idempotency_key`.
  - Add a route throttle.
- **IMP-H1-S4 — Spreadsheet scan admission.** Route AI-Action and import-job spreadsheets through the existing `DocumentFileScanAdmissionService` pattern, policy-driven: off → today's behavior; on → fail-closed. Enabling it in production is **D-04** (ops).
- **IMP-H1-S5 — Catalog job failure semantics.**
  - Pre-validate the whole file before chunk 1 (in-file duplicates across windows).
  - Expose `failed` partial results as a repair set (re-upload failed rows only).
  - Move remote image fetch outside the job row lock.
- **IMP-H1-S7 — AI Action type gates.**
  - Extend the `AiActionRegistry` definition with `application_key` (nullable) and allow more than one `domain_permissions`.
  - `AiActionPolicy::authorize` (today it checks only `ai.actions.*` + one domain permission, `AiActionPolicy.php:42-45`) also enforces the application key, with `EnsureApplicationActive` semantics: `suspended` means read-only, so reads pass and writes are refused. This reuses the extracted `authorize()` from H1-S1.
  - `product_import.v1` keeps `products.manage` with no app key (no behavior change).
  - Invariant test: every registered type declares the gates of its direct API. It must land **before** any new AI Action type (H3-S4, H4-S4, H5-S5, H7-S2, H7-S4). Expected gates:
    - `expense_import.v1`: `expenses.manage` + `finance.operations`
    - `purchase_import.v1`: `purchases.manage` + `purchases.cycle`
    - `inventory_opening_import.v1` / `stocktake_count_import.v1`: `products.manage` + `inventory.core`
- **IMP-H1-S6 — Zero-value inventory opening date guard.** `InventoryOpeningService::buildEntry` returns `null` for a zero-value document, so `post()` never reaches `AccountingDateGuard` (normally reached via `LedgerService::post`). Stock movements can then be dated inside a closed fiscal year or locked period. The fix asserts the guard explicitly before movements.
  - **Classification check:** this enforces the *existing* FC-3/ACC-6 rule and does not change it. If the reviewer disagrees, escalate to the owner and do not merge.

### H2 — Products completion

(H2-S5 is the slice that makes the shared adapter real for products. Without it the parity definition of done cannot be met.)
- **IMP-H2-S0 — Honest AI labeling.** Until IMP-H9 lands, the products "AI import" entry and page must not claim AI. Relabel it to an advanced/assisted review import, or show an explicit "AI suggestions unavailable" state. Copy is in AR+EN.
- **IMP-H2-S1 — Product write-path convergence.** V2 create goes through `ProductService::create(..., generateSku: false)` and keeps V2 semantics byte-for-byte (characterization tests from `ProductImportV2Test`).
- **IMP-H2-S2 — Shared value normalization.** Remove the duplicated regex validation in `AiActionProductFileIntakeService`/`AiActionProductReviewService`; both use `ProductImportValueNormalizer` or the adapter.
- **IMP-H2-S3 — Workbook UX parity.** Inspect step, template download, column mapping for the Products sheet, error tables.
- **IMP-H2-S4 — Tenant AI Actions enablement endpoint.** Owner/admin toggle for `ai_actions.enabled` (no write path exists today). Settings UI under Applications/AI settings. The platform flag still governs.
- **IMP-H2-S5 — Move both product consumers onto `ProductImportAdapter`.**
  - The sync `/products/import/*` endpoints (via `ProductImportService`) and the AI path use the adapter's `validateRow()`/`match()`/`applyRow()` instead of their own copies. The AI path covers `AiActionProductPreviewBuilder` (matching) and `AiActionProductExecutionService` (row write).
  - Each consumer keeps only its orchestration: the sync transaction, durable chunks, or AI versions/approval/lease.
  - The behavioral difference is expressed as **policy**, not code: the AI path calls the adapter with `master_data=match_or_error`; V2 keeps its `match_or_text` default.
  - Characterization tests come first. `ProductImportV2Test` and all `AiActionProduct*Test` suites stay green unchanged.
  - The parity test is the same file + the same policies ⇒ identical plan rows (creates/updates/skips/errors).

### H3 — Customers & suppliers
- **IMP-H3-S1:** `PartnerImportFields` + `PartnerImportAdapter`.
  - Modes create/update/upsert. Match by Nebrax ID → partner `code`. VAT/CR/phone/email are duplicate *signals* with a per-run policy (`error` | `skip` | `warn`).
  - `type` is fixed by the entry point (customer or supplier) and never inferred.
  - **Opening balance excluded** (D-01).
- **IMP-H3-S2:** Standard sync endpoints `/partners/import/{template,fields,inspect,preview,apply}?type=` plus `ImportJobDomain::PARTNER_MASTER`. Same gates as `POST partners` (today `partners.manage`, no app gate); add `$app` only if the owner later gates partners.
- **IMP-H3-S3:** Standard UI. A shared import stepper is extracted from products only if used twice, and lives on `/customers` and `/suppliers` pages.
- **IMP-H3-S4:** AI Action type `partner_import.v1` (registry entry, intake, review, preview, approval, execution) reusing the adapter. Parity test against the standard path.
- **IMP-H3-S5:** AI UI for partners.

### H4 — Master data
- **IMP-H4-S1:** Categories (with parent path) + brands import.
- **IMP-H4-S2:** Price-list items standalone import (extract from the workbook "Unit Prices" logic).
- **IMP-H4-S3:** Unit templates, create-only. **Standard path only.** The AI path is excluded by decision record **D-08**: conversion factors multiply stock quantities, so the risk of an AI-suggested factor outweighs the convenience, and templates are few.
- **IMP-H4-S4 — AI path for categories/brands and price-list items.**
  - A single AI Action type, `master_data_import.v1`, parameterized by adapter (`product_categories`, `brands`, `price_list_items`). It covers the registry entry, intake, review, preview, approval and execution, all reusing the H4-S1/S2 adapters.
  - Permissions: `ai.actions.*` + the adapter's own manage permission (`products.manage` for categories/brands, `company.manage` for price lists).
  - Includes the AI-facing UI tab in the import hub and a std↔AI parity test per adapter.

### H5 — Purchases & expenses (drafts only)
- **IMP-H5-S1:** Expense import adapter.
  - One row = one expense draft.
  - Category/vendor/payment-method/cost-center matching. Tax is computed by `ExpenseService` from lines; it is never trusted from the file (CLAUDE.md "totals are derived").
  - Duplicate identity: vendor + normalized reference + date + amount (minor units).
  - Concurrency safety: **H5-S1 introduces** the `import_document_reservations` table and its service (design under H5-S3).
    - The expense key is the **full** predicate: `dedupe_key = SHA-256(vendor id-or-normalized-name ‖ normalized reference ‖ date ‖ amount)`. Two different expenses that share only a reference never collide.
    - A row without a reference reserves nothing and gets only a non-blocking duplicate warning (same vendor + date + amount).
    - Lock: the vendor `Partner` row when the vendor is a partner, otherwise the tenant anchor row.
  - A PostgreSQL concurrency test is required here too.
- **IMP-H5-S2:** Expense standard UI + durable domain.
- **IMP-H5-S3:** Purchase import adapter.
  - Rows are grouped by `(supplier, supplier_invoice_ref)` into one draft with lines.
    - **`supplier_invoice_ref` is required by the import** even though `PurchaseService::create` permits a null `supplier_invoice_no`. A row without it is a row error (`purchase_reference_required`). Rows are **never** grouped under `(supplier, null)`, which would merge separate invoices and corrupt totals.
    - Any future reference-less mode must use an explicit per-document `document_key` column and must be a separate, owner-approved option.
  - Totals are derived; a file total that differs from the derived total is a **row error**, never silently overwritten.
  - Duplicate = an existing purchase with the same supplier + reference. **A pre-insert lookup alone is not enough**, because two concurrent jobs can both see no match. Required design:
    1. A new additive table `import_document_reservations`, `CompanyWide`:
       - Columns: `tenant_id`, `domain`, `dedupe_key` (SHA-256 of the **domain-specific** duplicate predicate), `counterparty_id` (nullable), `document_type`, `document_id`, `source` (`standard` | `ai_action` | `document_center`).
       - **Unique** index on (`tenant_id`, `domain`, `dedupe_key`).
       - The purchase predicate is supplier id ‖ normalized `supplier_invoice_no`. Each domain declares its predicate in its adapter, never by reusing another domain's key.
       - The reservation is inserted in the same transaction as the draft, so a concurrent duplicate fails on the unique index and becomes a row error.
    2. Inside that transaction, `lockForUpdate` on the supplier `Partner` row, then a lookup of existing `purchases.supplier_invoice_no` for that supplier (covers manually created purchases).
    - No unique index is added to `purchases`. Existing tenants may already hold duplicates, and `migrate --force` at boot would fail the deploy.
    - Manual-vs-manual duplicates stay out of scope (pre-existing behavior; recorded as a follow-up).
    - Required test: a PostgreSQL concurrency test (two processes, distinct idempotency keys, same supplier + reference ⇒ exactly one draft).
- **IMP-H5-S4:** Purchase standard UI + durable domain.
- **IMP-H5-S5:** AI path for spreadsheets: AI Action types `expense_import.v1` / `purchase_import.v1` on the H5-S1/S3 adapters.
- **IMP-H5-S6 — Route Document Center drafts through the financial adapters.**
  - `PurchaseDocumentDraftBuilder::build` and `ExpenseDocumentDraftBuilder::build` keep their own extraction, review and `DocumentTransactionLink` idempotency. **Before** calling `PurchaseService::create` / `ExpenseService::create`, they call the same adapter `validateRow()`/`plan()` and the `import_document_reservations` service, with `source=document_center`, in the same transaction.
  - Result: two different batches for the same invoice cannot both create drafts, and a spreadsheet import plus a document import of the same invoice also collide.
  - Existing Document Center tests stay green, and a new cross-source duplicate test (spreadsheet vs. document, PostgreSQL) is added.
  - The UI adds an entry link from the purchases/expenses import screens to Document Center upload, with status hand-off. No new extractor is built.
- Financial test bar: PostgreSQL, totals parity with manual creation, no JE at import, and a correct JE when the imported draft is posted through the existing `post()`.

### H6 — Sales & ZATCA (**gated by D-03**)
- **IMP-H6-S1..S3:** Drafts of new sales invoices via `InvoiceService::create`, with external reference de-duplication. **Never `post()` from import. No `issued_at`, ICV, PIH, hash, QR or XML is produced by import.** Historical-invoice migration is out of scope unless D-03 says otherwise.

### H7 — Inventory
- **IMP-H7-S1:** Stocktake count-sheet import into an *open* stocktake (counts only; variances are posted by the stocktake's own flow).
- **IMP-H7-S2:** AI path for inventory opening (AI Action type reusing `InventoryOpeningImportService` parse/preview; posting stays manual).
- **IMP-H7-S3:** Stock permit lines import (draft permits only). **Standard path only.** The AI path is excluded by **D-09**: permits are low-volume operational documents typed against a known warehouse, and a messy delivery file belongs to the Document Center delivery-note flow, not to spreadsheet AI. The owner may reopen this.
- **IMP-H7-S4:** AI path for stocktake counts: AI Action `stocktake_count_import.v1` on the H7-S1 adapter.
  - Gates: `products.manage` + `inventory.core`.
  - It targets an *open* stocktake only and writes counts only. Variances still post through the stocktake's own flow.
  - Includes a std↔AI parity test and a PostgreSQL row-lock test on the stocktake.
- Test bar: PostgreSQL concurrency (row locks on products and the stocktake), branch isolation of warehouses, no duplicate movements on retry.

### H8 — Unified Import UX
- **IMP-H8-S1:** Import Hub `/imports`. It lists the importable entities, each with **two equal entry points**: "استيراد عادي" and "استيراد بمساعد أَوْج". It includes job history (import-jobs + ai-actions) and resume links. It is RTL-first and follows `DESIGN_SYSTEM.md`.
- **IMP-H8-S2:** Saved column-mapping presets. These need a new `import_mapping_presets` table, which lifts the deferral recorded in CLAUDE.md "نطاق مستقبلي" under this Horizon's mandate. `CompanyWide`, per domain.
- **IMP-H8-S3:** Entry points on entity pages (products, customers, suppliers, purchases, expenses, inventory openings, stocktakes). The standard path is never hidden behind AI.
- Visual research is mandatory before S1 (Horizon protocol §4/§6): Shopify, Odoo, Zoho Books, Daftra, and Dynamics 365 Business Central configuration packages.

### H9 — AI Assistant integration (real AI)
- **IMP-H9-S1 — AI suggestion service.**
  - `AiImportSuggestionService` calls the provider through the existing assistant provider, consent, budget and network gates.
  - It sends **headers + bounded sample rows only** (data-minimization per D-02) and writes `origin = ai_suggested` + confidence into a *new action version*. It never writes to the domain.
  - Mock provider in tests.
  - Flags default off.
- **IMP-H9-S2 — Natural-language instructions.** The instruction text is parsed into a constrained, schema-validated *operation plan* (mode, policies, field mapping, row filters). Free-form model output is never executed.
- **IMP-H9-S3 — Assistant tool `imports.open_action`.** This read and draft tool lets the assistant attach a file to an AI Action, report status, explain errors and start a repair. It **cannot** approve or execute; those remain human UI actions bound to the approval hash.
- **IMP-H9-S4 — Conversational repair.** Failed rows are explained, and fixes are proposed as a new version, then go through the normal approve and execute steps.
- Activation in any environment (provider key, `*_EXTERNAL_NETWORK_ENABLED`, tenant consent) is **D-02**, an owner decision. Code ships dark.

### H10 — Security, accounting & reliability sweep
- **IMP-H10-S1:** Cross-entity test sweep. It covers tenant and branch isolation, RBAC negatives, approval integrity (tamper the hash or version), idempotency replay, PostgreSQL concurrency, file security (zip bomb, formula injection, MIME spoof), SSRF (remote images), duplicate prevention, accounting integrity (drafts → no JE), and ZATCA non-interference.
- **IMP-H10-S2:** Std↔AI parity suite. The same file + the same policies must produce identical plans and results per entity.

### H11 — Closure & operational readiness
- **IMP-H11-S1:** Closure report. It separates Code Complete, Merged, Deployed and Verified, lists the decisions still open and the env flags required, and includes a runbook for enabling the AI path.

---

## 5. Dependencies

```text
H0 → H1 (S1 independent; S2 before every new domain; S3/S4/S5 independent of each other)
H1-S2 → H3, H4, H5, H6, H7 (adapters)
H1-S7 → every new AI Action type (H3-S4, H4-S4, H5-S5, H7-S2, H7-S4)
H2-S0 → anytime (copy only)       H2-S1/S2 → H2-S5 → H9-S1 (AI writes rely on one product path)
H3-S1 → H3-S4 (AI reuses adapter)  H5-S1/S3 → H5-S5, H5-S6   H4-S1/S2 → H4-S4
H8-S1 needs ≥2 entities with both paths (after H3)
H9-S1 → H9-S2 → H9-S3 → H9-S4      H10/H11 last
H6 blocked on D-03 → skip and continue with H7, return when decided
```

---

## 6. Risks (top)

| # | Risk | Mitigation |
|---|---|---|
| R1 | Every merge to `main` auto-deploys on Railway and runs `php artisan migrate --force` at boot (`deploy/entrypoint.sh:70`), with no CI wait. | Migrations must be additive only, and new capabilities ship behind flags that default off. Any migration that alters or locks large existing tables needs an explicit deploy note. Never edit Railway settings or env. |
| R2 | A second import engine creeps in for "speed". | The adapter registry is the only write entry. PR review checks for a direct `Model::create` in any new import code. |
| R3 | AI output is treated as truth. | Schema-validated suggestions only. The adapter re-validates them, and parity tests enforce it. |
| R4 | Financial duplicates: purchases/expenses imported twice, including concurrently through different jobs **or through Document Center**. | `import_document_reservations` unique index on a domain-specific `dedupe_key` + counterparty/anchor row lock + existing-document lookup (H5-S1/S3), used by spreadsheet, AI and Document Center sources alike (H5-S6). This sits on top of approval binding and the idempotency key. A PostgreSQL concurrency test is mandatory. |
| R9 | A new durable domain inherits product permissions. | Per-domain authorization map with a coverage test (H1-S1). |
| R5 | ZATCA chain contamination by imported sales. | Drafts only; import never calls `post()` (static guard test). D-03 governs. |
| R6 | Partner opening balances post journals implicitly through `PartnerService::create`. | The partner import strips `opening_balance` (test asserts no JE). D-01 decides a dedicated opening document. |
| R7 | Tenant data sent to an external LLM without approval. | Existing consent and acknowledgement + network gate + budget. A new data category `import_rows` is opt-in, and payloads are minimized. D-02 governs. |
| R8 | Request-bound execution (`QUEUE_CONNECTION=sync`). | Keep the client-driven chunk loop (proven). Do not introduce workers in this Horizon. |

---

## 7. Decisions register (owner)

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| D-01 | Customer/supplier opening balances in import | Exclude from master-data import. Later add a dedicated *Partner Opening Balances* document (like Inventory Opening: draft → one JE → Dr/Cr control vs 3130). | Only the opening-balance feature (not H3) |
| D-02 | Enabling a real AI provider for imports (what data leaves, which provider, budget) | Headers + ≤20 sample rows, no full file. Opt-in data category `import_rows`, per-tenant acknowledgement, platform budget row required. Ship dark. | Activation of H9 (not the code) |
| D-03 | Sales invoice import scope | Drafts of new invoices only. No historical migration (already-reported invoices would get a new ICV/issued_at if posted). | H6 |
| D-04 | Malware scanning of spreadsheets in production (ClamAV service exists per media-storage closure) | Enable fail-closed after a smoke test. | Enabling H1-S4 policy in production |
| D-05 | Partner duplicate keys | Default: VAT number duplicate = `error`; phone/email = `warn`. Per-run configurable. | Non-blocking (configurable default) |
| D-06 | Employees import | Out of this Horizon (PII + payroll linkage). | — |
| D-07 | Journal entries / account opening balances import | Separate accounting Horizon. | — |
| D-09 | AI path for stock permit lines | Excluded. Low volume, a known warehouse, and documents belong to the Document Center delivery-note flow. The owner may reopen this. | — (recorded exclusion) |
| D-08 | AI path for unit templates | Excluded: conversion factors multiply stock quantities, so only the standard, create-only path is offered. The owner may reopen this. | — (recorded exclusion) |
| OPS-01 | Enabling `AI_ACTIONS_EXECUTION_ENABLED`, remote image fetch, staged-image purge schedule | Owner approval (unchanged from AI-ACTIONS-08). | Activation only |

---

## 8. Definition of done (Horizon)

These items come from the owner brief, §12.

- The entities approved in §3 have both paths, or a decision record explaining why not.
- The standard path works with every AI flag off, and the AI path makes real provider calls when activated.
- Both paths share adapters; the parity suite is green.
- Preview, approval and repair work on both paths.
- Each slice has its own report and tracker row with Base, Head and Merge SHAs.
- The closure report separates **Code Complete / Merged / Deployed / Verified**.
- Operational closure (deploy + verify on Railway) may stay open and is reported honestly.
