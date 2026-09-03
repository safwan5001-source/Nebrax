# AWJ / نبراس — Document Intelligence Foundation — Implementation Report

**Task:** Document Intelligence Foundation (settings decoupling + generic document lifecycle readiness)
**Branch:** `claude/document-intelligence-foundation-japfgd`
**Scope:** Foundation only. **No** Gemini/AI provider integration, **no** accounting/inventory posting, **no** ZATCA changes, **no** migrations, **no** merge/deploy.
**Base SHA:** `2ea1ff72c23b44a6b28db105ddf8abc214a0a5cc` (origin/main)

---

## Executive Summary

AWJ already ships a large, mature **Document Center / Document Intelligence** stack (generic document taxonomy, a full Review Workspace, field-level extraction metadata, matching, draft-only builders, a provider registry, and a retention-lifecycle-safety planner). The one architectural gap against this task was the **non-negotiable decision**: the two tenant-level concepts — **intelligent processing** and **original-file retention** — did not exist as **independent, per-tenant** settings. Intelligent processing was configured only at the **platform** level; retention existed only as a **global platform** time-based purge with no per-tenant choice of the four required semantics.

This PR adds exactly those two independent tenant controls, as inert preferences on the existing `tenants.settings` store (no new tables), read through a single canonical policy service, exposed via a guarded tenant API, and surfaced in the existing Document Center settings screen with full ar/en localization. The two concepts are modeled and validated as fully decoupled: **enabling AI never implies retaining the original, and choosing any retention mode never enables AI.**

Physical deletion / attachment execution for the retention modes is deliberately **deferred** to the later AI/cleanup phase; this PR lands the **policy + state foundation** and documents the deferral, consistent with the existing retention-lifecycle-safety design.

---

## Existing State Found (Phase 1 audit)

| Area | Already present before this task |
|---|---|
| Document taxonomy | 7 types in `StoreDocumentBatchRequest` (`purchase_invoice`, `sales_invoice`, `expense`, `delivery_note`, `receipt`, `credit_note`, `debit_note`) — delivery notes already a first-class type. |
| Field-level extraction contract | `DocumentExtractionNormalizer` already carries per-field `field_evidence` (`confidence_basis_points`, `source`/provenance, `page_number`, `bounding_box`) and per-line confidence/source; nulls are preserved (no fabrication). |
| Review Workspace | Full UI: extracted fields, line items, matching, issues/warnings, processing summary, history, reviewer assignment. |
| Draft safety | `PurchaseDocumentDraftBuilder` / `ExpenseDocumentDraftBuilder` create **draft-only** records via `DocumentTransactionLink` (transaction must be `status = draft`). |
| Provider abstraction | `DocumentExtractionProviderRegistry` + provider classes already exist (Anthropic/OpenAI/Gemini) but are **network-gated off** by `document_center.ai.provider_network_enabled=false`. |
| Retention lifecycle safety | `DocumentRetentionPlanner` already refuses purge while a transaction link, active hold, active processing run, open workflow, or non-clean scan exists. |
| Tenant/branch isolation | `BaseModel` (`TenantScope`) + `BranchScoped`; settings via `App\Support\Settings` on `tenants.settings` JSON. |
| Permissions | `documents.center.settings` (owner/admin) already defined in `Rbac::MATRIX`. |

### Gaps (Phase 2)

- **Missing:** a **per-tenant** "intelligent processing enabled + allowed document types" setting (only platform-level config existed).
- **Missing:** a **per-tenant** "original retention policy" with the four required semantics (only a global platform time-based purge existed).
- **Missing:** any tenant-facing settings API/UI for either concept (the settings screen was read-only status).
- **Risk avoided:** the document taxonomy lived only inside a FormRequest; a second consumer (tenant settings) would have duplicated it.

### Compatibility strategy

- Store both concepts as inert keys on the existing `tenants.settings` JSON (**no migration**, auto tenant-scoped).
- Defaults chosen to reproduce today's behavior exactly: processing **disabled**, allowed types **empty**, retention **`document_center_only`** (original stays in Document Center, no auto-attach, no early delete).
- Do **not** restrict Document Center intake by allowed types (the archive use case and existing uploads must keep working); allowed types gate only the future extraction path via `shouldProcessDocumentType()`.

---

## Changes Made

### Backend / domain
- `app/Support/DocumentTypeCatalog.php` **(new)** — single source of truth for the document taxonomy. `StoreDocumentBatchRequest` now references it (no parallel taxonomy).
- `app/Support/DocumentIntelligence.php` **(new)** — constants + semantics for the two concepts, especially the four retention modes and their `retainsInDocumentCenter()` / `attachesToRecord()` meaning.
- `app/Services/DocumentCenter/DocumentIntelligencePolicy.php` **(new)** — the **single canonical reader** of the tenant's decision, used by both the API and the governance endpoint. Pure; performs **no** external/provider calls.

### Database / settings
- `app/Support/Settings.php` — new `document_intelligence` group with three keys and backward-compatible defaults. **No schema/migration** (stored in existing `tenants.settings`).

### APIs
- `app/Http/Controllers/Api/DocumentIntelligenceSettingsController.php` **(new)** — `GET`/`PUT /api/document-intelligence-settings`.
- `app/Http/Requests/UpdateDocumentIntelligenceSettingsRequest.php` **(new)** — independent, partial-update validation; rejects invalid types/modes.
- `routes/api.php` — two routes guarded by `documents.center.settings`.
- `app/Http/Controllers/Api/DocumentOperationsController.php` — `document-governance` now surfaces the effective policy (a real service consumer, so the setting is not orphaned).

### Frontend / settings
- `web/src/components/documents/document-intelligence-settings.tsx` **(new)** — two visually separate sections (processing + allowed types via switches; retention as a 4-option radio group), RTL-first, using the existing design system.
- `web/src/app/(app)/documents/settings/page.tsx` — mounts the new editable section above the existing read-only status cards.

### i18n
- `web/src/messages/ar.json`, `web/src/messages/en.json` — new `documentIntelligence` namespace (professional Arabic + English). Document-type labels reuse the existing `documentCenterReview` type strings.

### Review Workspace / contracts
- No behavioral change. Verified (via test) that the existing extraction contract already represents handwritten/uncertain fields safely and does not fabricate missing values.

### Security / tenant isolation
- Settings read/write flow entirely through `App\Support\Settings` (tenant-scoped) and `TenantContext`; both routes require `documents.center.settings` (owner/admin). No storage paths, credentials, cross-tenant IDs, or provider secrets are exposed.

### Tests
- `tests/Feature/DocumentIntelligenceSettingsTest.php` **(new)** — 12 tests / 76 assertions.

---

## Files Changed

| File | Purpose |
|---|---|
| `app/Support/DocumentTypeCatalog.php` | Single taxonomy source of truth |
| `app/Support/DocumentIntelligence.php` | Retention-mode constants + decoupled semantics |
| `app/Services/DocumentCenter/DocumentIntelligencePolicy.php` | Canonical per-tenant policy reader |
| `app/Support/Settings.php` | New `document_intelligence` settings group + defaults |
| `app/Http/Requests/UpdateDocumentIntelligenceSettingsRequest.php` | Independent partial-update validation |
| `app/Http/Controllers/Api/DocumentIntelligenceSettingsController.php` | Tenant GET/PUT settings API |
| `app/Http/Controllers/Api/DocumentOperationsController.php` | Surfaces effective policy in governance |
| `app/Http/Requests/StoreDocumentBatchRequest.php` | References the catalog (removes inline list) |
| `routes/api.php` | Two guarded settings routes |
| `web/src/components/documents/document-intelligence-settings.tsx` | Settings UI (two independent sections) |
| `web/src/app/(app)/documents/settings/page.tsx` | Mounts the settings section |
| `web/src/messages/{ar,en}.json` | `documentIntelligence` i18n |
| `tests/Feature/DocumentIntelligenceSettingsTest.php` | Coverage |

---

## Database Changes

**None.** No migrations were added. Both concepts persist as keys on the existing `tenants.settings` JSON column, read through `App\Support\Settings` (which ignores unknown keys, so the addition is safe for existing rows).

Deterministic defaults (applied to every existing and new tenant, preserving current behavior):

| Key | Default | Rationale |
|---|---|---|
| `processing_enabled` | `false` | AI stays off until an explicit opt-in. |
| `allowed_document_types` | `[]` | No type is auto-processed until explicitly chosen. Does not restrict uploads. |
| `retention_mode` | `document_center_only` | Exactly today's behavior: original kept in Document Center, no auto-attach, no early delete. |

**No accounting journal entries are produced by this task** (no `LedgerService::post`, no financial operation). The mandatory "resulting journal entries" table does not apply — there are none.

---

## Tests

Environment note: the repo is core-only; `setup.sh` builds a full Laravel app to run tests (SQLite).

| Command | Result |
|---|---|
| `php artisan test --filter=DocumentIntelligenceSettingsTest` | **12 passed (76 assertions)** |
| `php artisan test --filter='DocumentCenter\|DocumentReview\|DocumentMatching\|...\|Settings'` | **204 passed**, 1 failed (env-only: `pdfinfo` missing) |
| `npm run build` (web) | **Compiled successfully** |
| `npx vitest run .../documents/settings/page.test.tsx` | **2 passed** (existing test still green with the new section) |
| `php artisan test` (full) | **2189 passed**, 1 skipped, **28 failed — all environmental/harness, none from this diff** |

The 28 full-suite failures are entirely due to this offline sandbox and a pre-existing harness gap, not this change:
- **24 ×** `Fuel*` → `Call to undefined function bcmul()` — the `bcmath` PHP extension is not installed locally (CI installs it).
- **3 ×** `ZatcaSubmission*` → `Class "App\Jobs\Accounting\SendZatcaSubmission" not found` — pre-existing `setup.sh` gap: it copies `app/Jobs/DocumentCenter/` but never `app/Jobs/Accounting/`. Affects `main` identically.
- **1 ×** `DocumentCenterSecureIntakeTest` (valid PDF page count) → `pdfinfo`/poppler-utils not installed locally (CI installs `poppler-utils`, `ci.yml:86`).

None of my changed files are in the Fuel, ZATCA-submission, or PDF-intake paths.

---

## Build / CI

- Web production build (`next build`) compiled successfully with the new component and i18n.
- No `.github/workflows` changes. CI installs `bcmath`, `poppler-utils`, and `libxml2-utils`, and (in CI) the Accounting job class is present, so the local-only failures above are expected to pass in CI.

---

## Safety Review

| Concern | Impact |
|---|---|
| **Accounting** | None. No ledger postings, no new financial calculations, no journal entries. Draft-only boundary untouched. |
| **Inventory** | None. No stock movements or inventory logic touched. |
| **ZATCA** | None. No ZATCA code, ICV, numbering, or UBL touched. |
| **Tenant isolation** | Preserved and tested. Settings flow through tenant-scoped `Settings`/`TenantContext`; a per-tenant isolation test asserts tenant B never sees tenant A's decision. |
| **Permissions** | Preserved. Both routes require `documents.center.settings` (owner/admin); a staff-forbidden test asserts 403 on read and write. |
| **Storage** | None. No storage keys, paths, or provider credentials introduced or exposed. |
| **Backward compatibility** | Defaults reproduce current behavior byte-for-byte; taxonomy unchanged (delivery notes already existed); intake not restricted; existing settings screen/test still work. |

---

## Retention Semantics

Four distinct modes are modeled in `DocumentIntelligence` and resolved by `DocumentIntelligencePolicy`:

| Mode | `retains_original_in_document_center` | `attaches_original_to_record` |
|---|---|---|
| `document_center_only` (default) | true | false |
| `record_attachment_only` | false | true |
| `document_center_and_attachment` | true | true |
| `do_not_retain` | false | false |

**When physical action happens (deferred):** This PR lands the **policy + state** only. It performs **no** physical deletion and **no** attachment copy. The existing `DocumentRetentionPlanner` already enforces the safety preconditions for any removal (no active transaction link, hold, running processing, open workflow, or unclean scan). Wiring `record_attachment_only` / `do_not_retain` to actual deletion — and `*_attachment` to an actual attachment copy — is intentionally deferred to the AI/cleanup phase, executed only after the processing/review/result-creation lifecycle safely completes, with idempotency and audit. `document_center_only` and `document_center_and_attachment` retain the original in Document Center and are unaffected by any future cleanup path. No destructive worker is introduced in this PR.

**Decoupling guarantee (tested):** `processing_enabled` and `retention_mode` are stored, validated, and updated independently. Tests assert enabling AI with `do_not_retain` is accepted (AI does not imply retention) and that updating one concept never resets the other.

---

## Delivery Document Readiness

- `delivery_note` is a first-class document-intelligence type (in the shared `DocumentTypeCatalog`) and is selectable as an allowed processing type per tenant.
- The extraction/review contract already represents handwritten/uncertain values safely: each field carries `confidence`, `source` (provenance, e.g. `handwritten`), page and bounding box; missing values stay `null` (never fabricated). A new test exercises a handwritten delivery-note payload to prove this.
- **Safe integration point (documented, not expanded):** AWJ has a general delivery-note domain (`DeliveryNote*` models, `delivery-notes/invoice-draft/preview`). A future AI phase can map a reviewed delivery-note extraction into that existing draft path. **No** stock, accounting, or financial posting for delivery documents is added here.

---

## Risks / Remaining Work (deferred)

1. **AI provider integration (next phase)** — no provider is called; `shouldProcessDocumentType()` is the gate the extraction path will consult.
2. **Retention physical execution** — deletion/attachment copy for `record_attachment_only` / `do_not_retain` / `*_attachment` deferred to the cleanup phase (policy/state only here).
3. **Delivery-note → resulting record mapping** — architecture ready; not implemented (out of scope).
4. **Unrelated pre-existing defect (documented, not fixed):** `setup.sh` does not copy `app/Jobs/Accounting/`, so `SendZatcaSubmission` is missing in the built test app (3 ZATCA-submission tests fail locally). Out of this task's scope.

---

## Git Information

- **Branch:** `claude/document-intelligence-foundation-japfgd`
- **Base SHA:** `2ea1ff72c23b44a6b28db105ddf8abc214a0a5cc`
- **Head SHA:** `4cb6c254276caa447649c77afefcf237fd35ed03`
- **PR:** [#630](https://github.com/safwan5001-source/Nebrax/pull/630) — ready for review, **not merged, not deployed**

---

## Recommended Next Step

**AI Provider Integration / Gemini pilot** — introduce a concrete extraction provider behind the existing `DocumentExtractionProviderRegistry`, gated by `processing_enabled` + `shouldProcessDocumentType()`, and wire the retention modes to actual physical deletion/attachment after lifecycle completion. Not part of this task.
