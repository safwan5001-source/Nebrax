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
| AI Assistant (`AiAssistantGateway`, `AnthropicAssistantProvider`) | Read-only finance tools; model-planned tool calls | No writes | **Real AI (Anthropic).** The model plans tool calls, the gateway re-authorizes each one and executes it from a closed tool registry, then the model composes a grounded answer from redacted digests. It has no import or file tool yet. |

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
9. **Execution unit = business document, never a raw row.** Each adapter declares `unitKey(row)`. A product, a partner or a price item is one row; a purchase is its `(supplier, ref)` group; a stocktake sheet is the whole file. Planning, reservation, durable chunking and AI execution batches all advance by **whole units**: a unit is never split across chunks, batches or transactions.
10. **Every apply is bound to its preview.** No execution path (sync `/apply`, durable job, AI execution) accepts content that was not previewed. Sync paths require `preview_hash` on apply; durable jobs bind it at creation; AI binds it via approval (H1-S3).
11. **No read-then-write invariants.** Every uniqueness or claim rule this plan relies on must be enforced by a database constraint, or by a row lock plus a conditional update with an affected-rows check. That covers reservations, repair claims, idempotency, partner duplicate signals, quota and single execution. A lookup followed by an insert is never enough. Each such invariant ships with a PostgreSQL race test in its slice, and each slice's PR review re-checks this rule against the code.
12. **Idempotency identity = every frozen input.** A reused idempotency key returns the earlier job only if **all** frozen inputs are identical: domain, file SHA, archive SHA, normalized options, mapping and preview hash. Any difference returns 409/422 `idempotency_key_reused`, never the old job.

### 2.3 Why not merge `ImportJob` and `AiAction` into one table

The two records have different contracts. `ImportJob` is a durable *file* job with a chunk cursor. `AiAction` is a versioned *proposal* with human edits, approvals and repairs. Merging them would be a high-risk migration of working code for no user-visible gain. The non-duplication requirement is met at the **adapter** level, where validation, matching and writes live. Shared infrastructure (`SpreadsheetReader`, `ImportHeaderMatcher`, file storage, scan admission, idempotency) is reused, not forked.

### 2.4 Where "AI" actually comes from

| Input kind | AI engine to reuse | Why |
|---|---|---|
| Spreadsheets (CSV/XLSX) | AI Actions pipeline **driven by the existing AWJ Assistant**: import tools registered in `AiAssistantToolRegistry` (IMP-H9) | AI Actions already has versioning, provenance (`origin`), approval and repair. The assistant already has the real model, consent, budget, audit and grounding. We add **tools**, not a provider or a second assistant. |
| Documents (PDF/images: purchase invoices, expenses) | **Intelligent Document Center**, as is | It already does LLM extraction, matching, financial validation, human review and the draft builders. Building a third extractor is forbidden. |
| Conversation | AI Assistant gateway + **import tools** that report, explain and propose on an AI Action (never approve or execute) | Keeps one assistant, one consent model and one budget. |

**Correction (IMP-H0-S2, owner-confirmed and re-verified in code):** the AWJ Assistant already contains real AI. `AiAssistantGateway` + `AnthropicAssistantProvider` implement the model call, the tool-planning loop, per-call re-authorization, budget reservation, consent, audit and answer grounding (`AiAnswerGuard`). The H0 wording that treated a real provider as something "to be approved" for the import path was too cautious. Provider choice and credentials are the owner's existing configuration and are **not touched** by this Horizon. What this Horizon adds is **tools** on that assistant, and what remains an owner decision (D-02) is only whether **import row data** may be sent to the model.

**What is verified deterministic today:** the current `/products/ai-import` wizard and the whole AI Actions pipeline (AI-ACTIONS-00..08) never call the assistant or any model (grep of `AiAction*`, `AiActionController` and `ProductImportActionSchema` finds no reference to `AiAssistant*`, `Anthropic*`, `AiRequestLedger` or `AiBudget*`). Its label «استيراد عبر مساعد أَوْج» therefore describes a goal, not current behavior (see IMP-H2-S0). The **standard** import stays fully independent of AI.

**Constraints the existing assistant imposes on our tools (verified in `AiAssistantGateway`/`AiAssistantToolRegistry`):**
- A tool declares `name`, `description`, a closed `inputSchema`, `validate`, `requiredPermission`, `dataCategory` and `execute`. The gateway runs `policy->authorize` with a fresh actor and `scopeGuard` before `validate` and `execute`, on every call.
- The registry is closed. A tool that must not be model-planned implements `AiExplicitInvocationOnly`; `offeredToModel()` hides it.
- A model-planned call is capped at `ai_assistant.limits.max_tool_calls` (3) per turn.
- Tool results sent back to the model are **digested** (`AiToolResultDigest`, token-capped, names tokenized), and audit `meta` accepts only the whitelisted keys of `AiAuditRecorder::META_KEYS`. Import tools therefore return **counts, statuses and error codes**, never raw rows, and need new audited keys added to that whitelist.
- A new data category must be added to `AiAssistantDataCategory` and is unavailable until the platform and the tenant both opt in.
- The assistant message API carries text and an optional `document_id` only. Files still enter through the existing `ai-actions/{id}/files` upload, and the conversation refers to the action by its id.

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
- **IMP-H1-S2 — `ImportDomainAdapter` contract + registry**, with the three existing domains wired through it. The contract includes `unitKey(row)` and an `applyUnit(rows)` entry point; the durable cursor and batch boundaries count **units**, not rows (rule 9). For the three existing domains a unit is one row (catalog) or the whole file (workbook, opening), so behavior is unchanged. **No behavior change** (characterization tests first). `ImportJobService::runChunk` dispatches via the registry instead of `match`.
- **IMP-H1-S3 — Durable-path approval binding & idempotency.**
  - Preview returns `preview_hash` = HMAC(file SHA-256 + archive SHA-256 + domain + normalized options + mapping).
  - **Options move to job creation.** `POST /import-jobs` gains `options` (mode, policies, domain fields such as `opening_date`/`price_list_id`) and `mapping`. The server normalizes them exactly as preview does and **freezes them on the job at creation**. Today they first arrive at `/apply`, which cannot be bound.
  - **`preview_hash` is required to create an executable job.** `POST /import-jobs` without it, or with a hash that does not equal HMAC(uploaded file SHA ‖ archive SHA ‖ domain ‖ frozen normalized options ‖ mapping), is rejected (422 `preview_required` / `preview_mismatch`) before `ready`.
  - **Single-use, server-held preview (rules 5 and 11).** Preview persists an `import_previews` record: `CompanyWide`, additive, holding tenant, user, branch, domain, file SHA, frozen options and mapping, the **canonical per-unit plan** (unit ref, action `create|update|skip|error`, matched target id + its `updated_at`), minted occurrence ids, `expires_at`, and `consumed_at`. It returns the record id plus its hash.
    - `POST /import-jobs` **consumes** the preview with a conditional update (`consumed_at IS NULL AND expires_at > now()`). One preview yields at most one job, so a replayed preview cannot create a second job, nor a second set of occurrence-keyed reservations.
    - **Plan drift is a failure, never a silent change, and the check is atomic with the write (rule 11).** Inside the unit's transaction, `applyUnit` first **locks the matched target row** (`lockForUpdate`), or for a planned create re-checks under the same lock/unique index that no match exists. It then compares the frozen action, target id and `updated_at`, and only then writes through the domain service in that same transaction.
      - Any difference (for example a create became an update because someone created the SKU meanwhile, or the target's `updated_at` moved) fails that unit with `plan_drift` and sends it to repair or re-preview. It is never applied as a different action.
      - This mirrors AI-ACTIONS `approval_stale`.
      - PostgreSQL test: a concurrent update of the target between preview and apply ⇒ `plan_drift`, with no overwrite.
  - **Branch binding.** `ImportJob` has no `branch_id` today (finding F-15), and `SetBranch` supplies the request's current branch to `BranchScoped` writes (products, categories, brands, units, partners). A job previewed in branch A could therefore apply in branch B.
    - H1-S3 adds an immutable `branch_id` (nullable, additive) set at job creation from the server-derived branch context.
    - The branch joins the preview hash and the idempotency identity.
    - Every chunk is applied with the branch context **restored from the job**, never taken from the apply request.
    - A user without access to that branch is refused (403).
    - AI Actions already store the approval branch (AI-ACTIONS-04); a test asserts execution uses it.
    - Tests: preview in A, apply with B active ⇒ rows are written to A (or 403 without access), and a cross-branch idempotency reuse is rejected.
  - **Idempotency covers the frozen inputs (rule 12).** Extend `ImportJobService::assertSameRequestOrFail()`, which today compares only domain and file/archive hashes (`ImportJobService.php:166`), to also compare the normalized options, mapping and preview hash. A test reuses a key with the same file but a different mapping and expects a rejection.
  - **`/apply` no longer accepts option changes.** It runs the frozen options. A body carrying options that differ from them returns 422 `options_frozen`; identical options are tolerated for compatibility with the old client during rollout.
  - **Compatibility:** the UI change ships in the same PR. Jobs already `ready` or `processing` at deploy time (`created_at` < the slice's cutover constant) may finish under the old contract; no new hashless job can execute.
  - The UI sends `idempotency_key`.
  - Add a route throttle.
  - **Synchronous apply is bound too (rule 10).** `/products/import/apply`, `/products/workbook/apply` and `/inventory-openings/import/apply` require the `preview_hash` from their own preview (422 `preview_required` / `preview_mismatch`).
    - Today's web UI uses only the durable jobs for execution, so no first-party caller breaks. Any external caller is named in the slice report.
    - Every **new** domain exposes sync `inspect`/`preview` only; its execution goes through the bound durable job or an AI approval.
- **IMP-H1-S4 — Spreadsheet scan admission at every intake point.**
  - Introduce one `SpreadsheetIntakeGuard`, called **before any parsing**, on every endpoint that receives a spreadsheet or archive:
    - every sync `inspect`/`preview`/`apply` (products, workbook, inventory openings, and every new domain)
    - `POST /import-jobs` and repairs
    - AI Action file and image-archive uploads
  - It reuses the existing `DocumentFileScanAdmissionService` pattern, policy-driven: off → today's behavior; on → fail-closed.
  - An invariant test enumerates the import routes that accept files and asserts each one invokes the guard, so a new domain cannot skip it.
  - Enabling it in production is **D-04** (ops).
- **IMP-H1-S5 — Catalog job failure semantics.**
  - Pre-validate the whole file before chunk 1 (in-file duplicates across windows).
  - Expose `failed` partial results through the generic repair mechanism (H1-S8).
  - Move remote image fetch outside the job row lock.
- **IMP-H1-S7 — AI Action type gates.**
  - Extend the `AiActionRegistry` definition with `application_key` (nullable) and allow more than one `domain_permissions`.
  - `AiActionPolicy::authorize` (today it checks only `ai.actions.*` + one domain permission, `AiActionPolicy.php:42-45`) also enforces the application key, with `EnsureApplicationActive` semantics: `suspended` means read-only, so reads pass and writes are refused. This reuses the extracted `authorize()` from H1-S1.
  - `product_import.v1` keeps `products.manage` with no app key (no behavior change).
  - Invariant test: every registered type declares the gates of its direct API. It must land **before** any new AI Action type (H3-S4, H4-S4, H5-S5, H7-S2, H7-S4). Expected gates:
    - `expense_import.v1`: `expenses.manage` + `finance.operations`
    - `purchase_import.v1`: `purchases.manage` + `purchases.cycle`
    - `inventory_opening_import.v1` / `stocktake_count_import.v1`: `products.manage` + `inventory.core`
- **IMP-H1-S8 — Generic standard repair for durable jobs (all domains).**
  - Each job persists per-unit outcomes (`succeeded` | `failed` + error codes) through the adapter.
  - `GET /import-jobs/{id}/failures` downloads the failed units in the original template, with an error column, generated by `SpreadsheetWriter` (formula-injection safe).
    - **Authorization:** it requires the domain's **manage** permission (not view) plus the app gate.
    - **Sensitive columns** are redacted unless the caller holds the sensitive-field permission. Today that means cost columns, which need `products.view_cost` (the same `SensitiveCostPolicy` that guards preview and apply), and each adapter declares its sensitive fields.
    - Test: a manage user without cost permission receives the file with cost columns blanked and marked.
  - **Stable repair identity.** Every unit gets an immutable `source_unit_ref`, a UUID minted at job creation and stored with its outcome. The failures file carries it in a protected `_awj_unit_ref` column next to the original data. The ref is independent of the business key, so a SKU, partner code or `supplier_invoice_ref` can be corrected, and a key that was missing can be filled.
  - `POST /import-jobs/{id}/repairs` creates a **new** child job (`parent_job_id`) from a corrected file.
    - Membership is validated by `_awj_unit_ref`: every child unit must reference a parent unit whose outcome is `failed`. Unknown, succeeded or already-repaired refs are rejected.
    - **Per-unit atomic claim, together with that unit's write (rule 11).** Child creation only validates membership, read-only, so nothing is claimed up front.
      - For each unit, inside the unit's own transaction or savepoint, the child runs a conditional `UPDATE … SET status='repaired', repaired_by_job_id=:child WHERE source_unit_ref = :ref AND status='failed'`, then the adapter write.
      - An affected-row count of 0 fails only that unit with `repair_ref_already_used`.
      - A failed write rolls the claim back with it, so the ref stays `failed` and stays repairable.
      - A child that stops mid-way leaves its unprocessed refs untouched, and an abandoned child holds nothing. No lease or expiry is needed.
    - PostgreSQL race test: two concurrent children over the same refs ⇒ each ref is repaired exactly once, and failed or unprocessed refs remain repairable.
    - The child goes through the normal preview, binding and apply steps.
    - Successful units are therefore never replayed; reservations and identifiers block them as a second line of defense.
  - The UI adds a "إصلاح الصفوف الفاشلة" step on the result screen, shared by every domain page.
  - This is the standard counterpart of AI-ACTIONS-06B repair. Every later domain gets repair for free through the adapter, and each domain slice adds one repair test.
- **IMP-H1-S6 — Zero-value inventory opening date guard.** `InventoryOpeningService::buildEntry` returns `null` for a zero-value document, so `post()` never reaches `AccountingDateGuard` (normally reached via `LedgerService::post`). Stock movements can then be dated inside a closed fiscal year or locked period. The fix asserts the guard explicitly before movements.
  - **Classification check:** this enforces the *existing* FC-3/ACC-6 rule and does not change it. If the reviewer disagrees, escalate to the owner and do not merge.

### H2 — Products completion

(H2-S5 is the slice that makes the shared adapter real for products. Without it the parity definition of done cannot be met.)
- **IMP-H2-S0 — Honest AI labeling.** Until the assistant tools of H9 are connected, the products "AI import" entry and page must not claim AI that does not run. Relabel the wizard to what it is, an assisted review import with a deterministic pipeline, and show an explicit state that the assistant is not yet connected to it. When H9-S1 lands, the label returns together with a visible "Ask the assistant" entry that opens the assistant on this action. Copy is in AR+EN.
- **IMP-H2-S1 — Product write-path convergence.** V2 create goes through `ProductService::create(..., generateSku: false)` and keeps V2 semantics byte-for-byte (characterization tests from `ProductImportV2Test`).
- **IMP-H2-S2 — Shared value normalization.** Remove the duplicated regex validation in `AiActionProductFileIntakeService`/`AiActionProductReviewService`; both use `ProductImportValueNormalizer` or the adapter.
- **IMP-H2-S3 — Workbook UX parity.** Inspect step, template download, column mapping for the Products sheet, error tables.
- **IMP-H2-S4 — Tenant AI Actions enablement endpoint.** Owner/admin toggle for `ai_actions.enabled` (no write path exists today). Settings UI under Applications/AI settings. The platform flag still governs.
  > Related parked requirement **IMP-X-01** (Super Admin control of AI Actions: global, per tenant, per action type) is registered in `AWJ_IMPORT_PARKED_REQUIREMENTS.md`. It is **not** part of this slice's scope and does not reorder it; it is recommended right after H2-S4 and before H3-S4.
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
  - **Concurrency-safe duplicate signals (rule 11).** `partners` is unique only on `(tenant_id, code)`. For every signal whose run policy is `error` or `skip` (for example the VAT number), the adapter's `applyUnit` takes a **tenant-scoped advisory or anchor lock** (the tenant-anchor row lock, shared with `PartnerService::create` while an import holds it), then re-checks existing partners by the normalized signal before inserting.
    - The direct `POST partners` path is unchanged. Duplicates there remain today's behavior, and the race against an import is accepted the same way as `duplicate_reference_policy=allow` in H5.
    - PostgreSQL race test: two concurrent imports with the same VAT and different codes yield one partner under `error`.
  - **Opening balance excluded** (D-01).
- **IMP-H3-S2:** Standard sync endpoints `/partners/import/{template,fields,inspect,preview}?type=` (**no sync `apply`**, per rule 10; execution goes only through the bound durable job) plus `ImportJobDomain::PARTNER_MASTER`. Same gates as `POST partners` (today `partners.manage`, no app gate); add `$app` only if the owner later gates partners.
- **IMP-H3-S3:** Standard UI. A shared import stepper is extracted from products only if used twice, and lives on `/customers` and `/suppliers` pages.
- **IMP-H3-S4:** AI Action type `partner_import.v1` (registry entry, intake, review, preview, approval, execution) reusing the adapter. Parity test against the standard path.
- **IMP-H3-S5:** AI UI for partners.

### H4 — Master data
- **IMP-H4-S1:** Categories (with parent path) + brands import.
- **IMP-H4-S2:** Price-list items standalone import (extract from the workbook "Unit Prices" logic).
- **IMP-H4-S3:** Unit templates, create-only. **Standard path only.** The AI path is excluded by decision record **D-08**: conversion factors multiply stock quantities, so the risk of an AI-suggested factor outweighs the convenience, and templates are few.
- **IMP-H4-S4 — AI path for categories/brands and price-list items.**
  - **Separate AI Action types**, one per permission boundary, so H1-S7's static per-type gates stay exact and an action can never switch domain through a later version:
    - `product_taxonomy_import.v1` (categories + brands, `products.manage`)
    - `price_list_item_import.v1` (`company.manage`; the target `price_list_id` is fixed at creation as immutable action scope)
  - Each covers the registry entry, intake, review, preview, approval and execution on the H4-S1/S2 adapters.
  - Includes the AI-facing UI tab in the import hub and a std↔AI parity test per adapter.

### H5 — Purchases & expenses (drafts only)
- **IMP-H5-S1:** Expense import adapter.
  - One row = one expense draft.
  - Category/vendor/payment-method/cost-center matching. Tax is computed by `ExpenseService` from lines; it is never trusted from the file (CLAUDE.md "totals are derived").
  - Duplicate identity: vendor + normalized reference + date + amount (minor units).
  - Concurrency safety: **H5-S1 introduces** the `import_document_reservations` table and its service (design under H5-S3).
    - The expense key is the **full** predicate: `dedupe_key = SHA-256(vendor id-or-normalized-name ‖ normalized reference ‖ date ‖ amount)`. Two different expenses that share only a reference never collide.
    - **A reference-less row still reserves.** Its fallback key is `SHA-256(vendor ‖ date ‖ amount ‖ "no-ref")`, so concurrent jobs, AI and Document Center cannot both create it.
      - A genuinely repeated expense (same vendor, day and amount) needs an explicit per-row **"distinct expense" confirmation** in review. That confirmation appends a **globally unique occurrence id** to the key. The id is **minted at preview time** and stored in the single-use `import_previews` record (standard path), the approved action version (AI path), or the Document Center document record. It is never derived from a job id created later, so replaying a preview cannot mint new keys. A row ordinal would repeat in later files. The confirmation is part of the approved plan (and hence the approval hash), and is audited.
      - Per-run policy `reference_required` (default off) rejects reference-less rows outright.
    - **Post-lock lookup of existing expenses (covers manual ones that never reserve under `allow`).** After taking the vendor/anchor lock, the adapter queries `expenses` for the same vendor + date + amount (minor units).
      - For a **reference-less** row, any match is a duplicate. The row is rejected unless it carries the explicit distinct confirmation.
      - For a **referenced** row, a match is reported as a *possible duplicate* that needs the same confirmation. Manual expenses have no persisted reference, so the reference cannot prove they differ.
      - Test: sequential manual `POST /expenses` then an import with the same vendor/date/amount ⇒ rejected without confirmation, accepted with it.
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
       - **Lifecycle:** a reservation lives exactly as long as its document. Deleting a **draft** through the existing `DELETE purchases/{id}` / `DELETE expenses/{id}` paths removes its reservation in the **same transaction**: a service-level hook in `PurchaseService`/`ExpenseService` deletion, never a scheduled cleanup. A corrected re-import therefore succeeds after the mistaken draft is deleted. Posted documents cannot be hard-deleted (they are reversed), so their reservation stays and still blocks re-import.
       - Tests: delete draft ⇒ re-import succeeds; reverse posted ⇒ re-import still blocked; a delete racing an import (PostgreSQL) leaves no orphan.
    2. Inside that transaction, `lockForUpdate` on the supplier `Partner` row, then a lookup of existing `purchases.supplier_invoice_no` for that supplier (covers manually created purchases).
    - No unique index is added to `purchases`. Existing tenants may already hold duplicates, and `migrate --force` at boot would fail the deploy.
    - **One owner of the reservation lifecycle: the document service, not the importer.** `PurchaseService` / `ExpenseService` call `DocumentDuplicateReservationService` inside their own `create`, `update` and `delete` transactions:
      - `create` reserves the key.
      - `update` that changes any predicate field (`partner_id`, `supplier_invoice_no`; expense vendor/reference/date/amount) **re-keys atomically**: it deletes the old reservation and inserts the new one, and a collision returns 422.
      - The reservation row persists its **canonical predicate components** (`predicate` JSON: normalized vendor key, normalized reference, date, amount in minor units, plus any occurrence id) beside the irreversible `dedupe_key`. An expense has no persisted reference column (`Expense::$fillable` has none), so a re-key recomputes from the stored components merged with the changed fields and the reference is never lost.
      - No schema change to `expenses` is needed. If a visible reference field is later wanted, it is a separate additive slice.
      - `delete` of a draft releases the reservation.
      - Importers never write reservations directly.
    - **Direct manual creation follows a configurable policy** (CLAUDE.md rule 6) in purchase/expense settings: `duplicate_reference_policy = allow | block`.
      - `allow` is the default and preserves today's behavior: manual duplicates stay possible, manual documents do not reserve, and imports still refuse to duplicate any existing or reserved document.
      - `block`: direct creation joins the same protocol (counterparty lock + recheck + reservation), so a direct `POST /purchases` racing an import cannot duplicate in either order.
    - The race under `allow` is accepted by definition, since the tenant permits duplicates manually; the slice report states this.
    - Tests: an edit re-keys; an edit into an existing key gets 422; under `block`, a direct-vs-import race in both orders yields one document (PostgreSQL); under `allow`, manual creation is unchanged.
    - Required test: a PostgreSQL concurrency test (two processes, distinct idempotency keys, same supplier + reference ⇒ exactly one draft).
- **IMP-H5-S4:** Purchase standard UI + durable domain. Units are whole `(supplier, ref)` groups (rule 9): a chunk holds N complete invoices, and a group larger than the chunk size is one chunk by itself. A test places a group across the would-be row boundary.
- **IMP-H5-S5:** AI path for spreadsheets: AI Action types `expense_import.v1` / `purchase_import.v1` on the H5-S1/S3 adapters.
- **IMP-H5-S6 — Route Document Center drafts through the financial adapters.**
  - **Gates first (rule 7).** `create-purchase-draft` / `create-expense-draft` today require only `documents.center.build_draft` + `document_center.core` (`routes/api.php:501-502`). Before either builder runs, also enforce the direct API's gates: `purchases.manage` + `purchases.cycle` for purchases, and `expenses.manage` + `finance.operations` for expenses. Use the H1-S1 `authorize()` semantics.
    - Negative tests: a custom role with Document Center permission but without the financial permission gets 403, and the target app disabled gets 403.
    - The behavior change is deliberate: Document Center is at Stage 0 and off by default. The report names it.
  - `PurchaseDocumentDraftBuilder::build` and `ExpenseDocumentDraftBuilder::build` keep their own extraction, review and `DocumentTransactionLink` idempotency.
    - They call the same adapter `validateRow()`/`plan()`, then call `PurchaseService::create` / `ExpenseService::create` with source metadata (`source=document_center`, batch id).
    - The **document service performs the single reservation write** (per H5-S3); builders never write reservations, which would otherwise double-insert and roll back.
  - Result: two different batches for the same invoice cannot both create drafts, and a spreadsheet import plus a document import of the same invoice also collide.
  - Existing Document Center tests stay green, and a new cross-source duplicate test (spreadsheet vs. document, PostgreSQL) is added.
  - The UI adds an entry link from the purchases/expenses import screens to Document Center upload, with status hand-off. No new extractor is built.
- Financial test bar: PostgreSQL, totals parity with manual creation, no JE at import, and a correct JE when the imported draft is posted through the existing `post()`.

### H6 — Sales & ZATCA (**gated by D-03**)
- **IMP-H6-S1..S3:** Drafts of new sales invoices via `InvoiceService::create`, with external reference de-duplication.
  - **Persistent duplicate identity.** `Invoice` has no external-reference field (`payment_reference` is a settlement reference). The import therefore reuses `import_document_reservations` (domain `sales_invoice`, key = customer id ‖ normalized external reference, `predicate` JSON persisted), with the same lifecycle owned by `InvoiceService`: reserve on create, re-key on a draft edit of the customer, release on draft delete, and keep for posted invoices.
  - The external reference is required by the sales import; a row without it is a row error.
  - Whether to also show it as an invoice field is a separate additive decision.
  - Tests: a sequential re-import is blocked; delete-then-re-import succeeds. **Never `post()` from import. No `issued_at`, ICV, PIH, hash, QR or XML is produced by import.** Historical-invoice migration is out of scope unless D-03 says otherwise.
  - Gates: `invoices.manage` **and the plan limit** `EnforcePlanLimit:invoices`. The direct `POST invoices` enforces that limit per request, so imports must not become a bypass.
  - A sales import job is **one atomic execution**. All invoice units are created in a single transaction that first takes the tenant-anchor lock, then checks the remaining quota for the whole batch, then creates every draft. It is all-or-nothing, so no other request can consume capacity between chunks.
  - The batch size is capped (proposed: 500 invoices per job, which the slice confirms) to keep the transaction bounded.
  - **The direct path must join the same protocol.** Today `EnforcePlanLimit` (`app/Http/Middleware/EnforcePlanLimit.php:19-36`) only counts and takes no lock, so locking the import side alone cannot prevent over-consumption.
    - H6-S1 puts the protocol **inside `InvoiceService::create` itself**, so no caller can bypass it. That covers `InvoiceController`, duplicate, `QuoteService` convert, `RecurringInvoiceService`, `PosService:242`, `FuelSaleService:173`, `DeliveryNoteSalesInvoiceDraftBuilder:216`, `PublicInvoiceController:135`, and import.
      - Every create takes the tenant-anchor lock first, so all invoice creation is serialized against the import's count-and-create.
      - The **quota check** inside it runs only for callers that are quota-enforced today (an explicit `enforceQuota` argument). This keeps current behavior exactly: POS, fuel, delivery-note and public paths are not newly blocked. Whether those should count against the quota is a separate owner decision, not a side effect of imports.
    - A caller-coverage test enumerates `InvoiceService::create` call sites, so a new caller must declare its quota mode.
    - The middleware stays as a fast pre-check, and its responses are unchanged.
    - This touches subscription enforcement and is in scope only once D-03 opens H6.
  - Tests: a batch exceeding the remaining quota creates nothing, and a concurrent direct `POST invoices` during the import cannot over-consume (PostgreSQL), in both orders.

- **IMP-H6-S4:** AI path for sales invoice drafts: AI Action `sales_invoice_import.v1` on the H6 adapter.
  - Gates (H1-S7): `invoices.manage`, plus the shared quota protocol at execution.
  - Execution is one atomic unit set: all-or-nothing, as in the standard path.
  - It covers intake, review, preview, approval, execution and the AI-facing UI. A std↔AI parity test is included.
  - It never posts and never touches ZATCA. Like all of H6, it is blocked on D-03.

### H7 — Inventory
- **IMP-H7-S1:** Stocktake count-sheet import into an *open* stocktake (counts only; variances are posted by the stocktake's own flow). The whole sheet is one atomic unit with a lock on the stocktake (rule 9), so no partial sheet can ever be posted. Required test: concurrent post during import ⇒ the post waits or fails, and never posts a partial sheet.
- **IMP-H7-S2:** AI path for inventory opening (AI Action type reusing `InventoryOpeningImportService` parse/preview; posting stays manual).
- **IMP-H7-S3:** Stock permit lines import (draft permits only). **Standard path only.** The AI path is excluded by **D-09**: permits are low-volume operational documents typed against a known warehouse, and a messy delivery file belongs to the Document Center delivery-note flow, not to spreadsheet AI. The owner may reopen this.
- **IMP-H7-S4:** AI path for stocktake counts: AI Action `stocktake_count_import.v1` on the H7-S1 adapter.
  - Gates: `products.manage` + `inventory.core`.
  - It targets an *open* stocktake only and writes counts only. Variances still post through the stocktake's own flow.
  - The whole count sheet is **one unit**, applied atomically in one transaction (standard and AI alike), with `lockForUpdate` on the stocktake. `StocktakeService::post()` cannot observe a half-applied sheet: it ignores null `counted_quantity` lines, so partial application would post silently.
  - Includes a std↔AI parity test and a PostgreSQL row-lock test on the stocktake.
- Test bar: PostgreSQL concurrency (row locks on products and the stocktake), branch isolation of warehouses, no duplicate movements on retry.

### H8 — Unified Import UX
- **IMP-H8-S1:** Import Hub `/imports`. It lists the importable entities, each with **two equal entry points**: "استيراد عادي" and "استيراد بمساعد أَوْج". It includes job history (import-jobs + ai-actions) and resume links. It is RTL-first and follows `DESIGN_SYSTEM.md`.
- **IMP-H8-S2:** Saved column-mapping presets. These need a new `import_mapping_presets` table, which lifts the deferral recorded in CLAUDE.md "نطاق مستقبلي" under this Horizon's mandate. `CompanyWide`, per domain.
- **IMP-H8-S3:** Entry points on entity pages (products, customers, suppliers, purchases, expenses, inventory openings, stocktakes). The standard path is never hidden behind AI.
- Visual research is mandatory before S1 (Horizon protocol §4/§6): Shopify, Odoo, Zoho Books, Daftra, and Dynamics 365 Business Central configuration packages.

### H9 — AWJ Assistant integration (real AI, existing assistant)

The assistant, provider, consent, budget, audit and grounding already exist. **H9 adds import tools to `AiAssistantToolRegistry` and nothing else on the AI side**: no second assistant, no new provider, no change to AI settings, and no model call outside `AiAssistantGateway`.

- **IMP-H9-S1 — Read-only import tools.** Register `imports.action_status` and `imports.explain_failures` (names final in the slice). Both take an AI Action id (a UUID) and return only counts, statuses and aggregated error codes.
  - `requiredPermission` is the target action type's domain permission, plus `ai.actions.use`. The action must belong to the actor's tenant and branch scope.
  - New `AiAuditRecorder::META_KEYS` entries for action id, state and counts, with no values.
  - A new data category (for example `import_metadata`) holds the opt-in. It stays unavailable until the platform and the tenant enable it, and the default is off.
  - The result digest carries no cell values, so nothing about row content leaves the server in this slice.
  - Tests use the mock provider and follow `AiAssistantGatewayTest` patterns, including the cross-tenant and revoked-permission negatives.
- **IMP-H9-S2 — Suggestion tool with minimized sample data (blocked on D-02).** `imports.suggest_mapping` returns a column-mapping proposal as a **new action version** with `origin = ai_suggested` and a confidence. The model sees **headers plus at most 20 sample rows**, with values redacted by the same digest rules, and only under the opt-in category `import_rows`.
  - Whatever the model returns is **schema-validated and then re-validated by the adapter**. It is never executed as is.
  - Code ships dark; activation needs D-02.
- **IMP-H9-S3 — Natural-language operation plan.** The model proposes a constrained operation plan (mode, policies, mapping, row filter) as arguments of an import tool. `validate()` checks it against a closed schema, and the plan becomes a new action version that goes through preview and approval like any other.
- **IMP-H9-S4 — Draft-and-repair tools.** `imports.start_repair` creates the repair action of AI-ACTIONS-06B from failed rows. The conversational explanation reuses S1. These tools **cannot approve or execute**: those stay human UI actions bound to the approval hash.
- **IMP-H9-S5 — UI connection.** `/products/ai-import` and every AI import screen gain an "Ask the assistant" entry that opens the assistant panel with the action as its context (`context.ts` gains an `ai_import` kind). The assistant's answers link back to the preview and approval screens.
- **Activation and settings:** provider, key, network switches and tenant consent are the owner's existing configuration. This Horizon never changes them. The new data categories are default-off.

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
H1-S8 → every new durable domain (repair comes through the adapter)
H1-S7 → every new AI Action type (H3-S4, H4-S4, H5-S5, H7-S2, H7-S4)
IMP-X-01 (parked) → after H2-S4, before H3-S4 (needs H1-S7 registry + H2-S4 tenant opt-in); see AWJ_IMPORT_PARKED_REQUIREMENTS.md
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
| R7 | Import data sent to the external model without approval. | The existing consent, acknowledgement, network gate and budget stay in force. New categories (`import_metadata`, `import_rows`) are default-off opt-ins, tool results are digested, and `import_rows` payloads are minimized to headers plus at most 20 sample rows. D-02 governs `import_rows`. |
| R8 | Request-bound execution (`QUEUE_CONNECTION=sync`). | Keep the client-driven chunk loop (proven). Do not introduce workers in this Horizon. |

---

## 7. Decisions register (owner)

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| D-01 | Customer/supplier opening balances in import | Exclude from master-data import. Later add a dedicated *Partner Opening Balances* document (like Inventory Opening: draft → one JE → Dr/Cr control vs 3130). | Only the opening-balance feature (not H3) |
| D-02 | May **import row data** (headers plus at most 20 sample rows) be sent to the assistant's model? The provider itself already exists and is configured by the owner; this decision covers only the new data scope. | Headers + ≤20 sample rows, never the full file. Opt-in data category `import_rows`, per-tenant acknowledgement, existing budget rows. Ship dark. | Only IMP-H9-S2 activation (not its code). H9-S1, S3 (the metadata-only parts), S4 and S5 do not need it. |
| D-03 | Sales invoice import scope | Drafts of new invoices only. No historical migration (already-reported invoices would get a new ICV/issued_at if posted). | H6 |
| D-04 | Malware scanning of spreadsheets in production (ClamAV service exists per media-storage closure) | Enable fail-closed after a smoke test. | Enabling H1-S4 policy in production |
| D-05 | Partner duplicate keys | Default: VAT number duplicate = `error`; phone/email = `warn`. Per-run configurable. | Non-blocking (configurable default) |
| D-06 | Employees import | Out of this Horizon (PII + payroll linkage). | — |
| D-07 | Journal entries / account opening balances import | Separate accounting Horizon. | — |
| D-09 | AI path for stock permit lines | Excluded. Low volume, a known warehouse, and documents belong to the Document Center delivery-note flow. The owner may reopen this. | — (recorded exclusion) |
| D-08 | AI path for unit templates | Excluded: conversion factors multiply stock quantities, so only the standard, create-only path is offered. The owner may reopen this. | — (recorded exclusion) |
| D-10 | (parked IMP-X-01) Precedence between the existing env flags and runtime Super Admin controls for AI Actions | Keep the env flags as a hard floor; runtime controls above it. | Only IMP-X-01 |
| D-11 | (parked IMP-X-01) Default for tenants | Default-deny: Super Admin grant **and** tenant opt-in. | Only IMP-X-01 |
| D-12 | (parked IMP-X-01) Also model AI Actions as an `ApplicationCatalog` capability for commercial packaging? | Optional, orthogonal to per-type operational control. | Only IMP-X-01 |
| OPS-01 | Enabling `AI_ACTIONS_EXECUTION_ENABLED`, remote image fetch, staged-image purge schedule | Owner approval (unchanged from AI-ACTIONS-08). | Activation only |

---

## 8. Definition of done (Horizon)

These items come from the owner brief, §12.

- The entities approved in §3 have both paths, or a decision record explaining why not.
- The standard path works with every AI flag off, and the AI path makes real provider calls when activated.
- Both paths share adapters; the parity suite is green.
- Preview, approval and repair work on both paths: standard repair via H1-S8 for every durable domain, AI repair via the 06B pattern and H9-S4.
- Each slice has its own report and tracker row with Base, Head and Merge SHAs.
- The closure report separates **Code Complete / Merged / Deployed / Verified**.
- Operational closure (deploy + verify on Railway) may stay open and is reported honestly.
