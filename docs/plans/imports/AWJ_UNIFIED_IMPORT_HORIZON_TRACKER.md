# AWJ Unified Import — Horizon Tracker

> **Live progress log.** Update this file in every slice PR: branch, PR, SHAs, CI, deploy and verify. It does not re-plan; the plan is `AWJ_UNIFIED_IMPORT_MASTER_HORIZON.md`.
>
> **Status flow:** `Planned → In Progress → Code Complete → CI Passed → Merged → Deployed → Verified`, with `Blocked (D-xx)` and `Skipped (reason)` as side states.
>
> **"Deployed" is set only with evidence of a Railway deploy containing the Merge SHA. "Verified" is set only with evidence from the target environment.** A merge alone is never "Deployed".

## Current pointer

| Field | Value |
|---|---|
| Last merged slice | — (H0 in review: PR #1595) |
| **Next slice** | **IMP-H1-S1** — import-jobs app gate + prune media archive (see `AWJ_IMPORT_OPUS_HANDOFF.md` §3) |
| Open owner decisions | D-01, D-02, D-03, D-04, D-06, D-07, OPS-01 (D-05 has a non-blocking default; D-08/D-09 are recorded exclusions) |
| Railway state | Unknown (owner-reported stall; no access from the agent) |

## Slice log

| Slice | Std | AI | Scope | Depends | Branch | PR | Base SHA | Head SHA | Merge SHA | Tests | CI | Deploy | Verify | Status | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IMP-H0-S1 | — | — | Discovery, master plan, tracker, handoff (docs) | — | `claude/unified-import-h0` | #1595 | `474aad1` | _pending_ | — | n/a (docs) | — | — | — | In Progress | Merge, then stop for the model handoff |
| IMP-H1-S1 | 🟡→✅ | — | Per-domain job authorization map (perm + app gate, index filtering); prune deletes media archive | H0 | — | — | — | — | — | — | — | — | — | Planned | Start (handoff §3) |
| IMP-H1-S2 | ✅ | ✅ | `ImportDomainAdapter` + registry (`unitKey`/`applyUnit`, unit-based cursor); existing 3 domains; no behavior change | H1-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H1-S3 | ✅ | — | Single-use `import_previews` (canonical per-unit plan, `plan_drift` on apply, minted occurrence ids); job `branch_id` bound + restored per chunk (F-15); sync applies require `preview_hash`; options+mapping frozen at job creation; required preview-hash binding; `/apply` rejects changed options (legacy in-flight jobs only grandfathered); UI idempotency key; throttle | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H1-S4 | ✅ | ✅ | `SpreadsheetIntakeGuard` before parsing on every file-accepting import route (route invariant test; prod enable = D-04) | — | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H1-S5 | ✅ | — | Catalog job: whole-file pre-validation, fetch outside lock (repair via H1-S8) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H1-S7 | — | ✅ | AI Action type gates: `application_key` + multi-permission in registry/policy; invariant test | H1-S1 | — | — | — | — | — | — | — | — | — | Planned | Before any new AI type |
| IMP-H1-S8 | ✅ | — | Generic standard repair: immutable `source_unit_ref`, failures download (manage + sensitive-field redaction), refs claimed atomically at child apply | H1-S2, H1-S3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H1-S6 | ✅ | — | Zero-value opening hits `AccountingDateGuard` | — | — | — | — | — | — | — | — | — | — | Planned | Confirm classification (master §4) |
| IMP-H2-S0 | — | ✅ | Honest AI labeling on products AI import | — | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H2-S1 | ✅ | — | V2 create via `ProductService::create` (characterized) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H2-S2 | — | ✅ | Shared value normalization (remove duplicated regexes) | — | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H2-S3 | ✅ | — | Workbook UX parity (inspect/template/mapping) | — | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H2-S4 | — | ✅ | Tenant `ai_actions.enabled` endpoint + settings UI | — | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H2-S5 | ✅ | ✅ | Sync V2 + AI preview/execution onto `ProductImportAdapter` (policy-expressed differences, parity test) | H1-S2, H2-S1, H2-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S1 | ✅ | ✅ | `PartnerImportFields` + adapter (no opening balance) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S2 | ✅ | — | Partner inspect/preview endpoints (no sync apply) + `partner_master` job domain | H3-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S3 | ✅ | — | Customers/suppliers import UI | H3-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S4 | — | ✅ | AI Action `partner_import.v1` + parity test | H3-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S5 | — | ✅ | Partner AI import UI | H3-S4 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S1 | ✅ | via H4-S4 | Categories (hierarchy) + brands import (adapter + standard) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S2 | ✅ | via H4-S4 | Price-list items import (adapter + standard) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S3 | ✅ | ⛔ D-08 | Unit templates (create-only; AI excluded by D-08) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S4 | — | ✅ | AI Actions `product_taxonomy_import.v1` + `price_list_item_import.v1` (separate gates) + parity | H4-S1, H4-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S1 | ✅ | — | Expense adapter (drafts, derived tax, `import_document_reservations` with full-predicate key; reference-less fallback key + explicit distinct confirmation) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S2 | ✅ | — | Expense UI + durable domain | H5-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S3 | ✅ | — | Purchase adapter (grouped drafts with required `supplier_invoice_ref`, derived totals, `import_document_reservations` owned by the document services (create/update re-key/delete), `duplicate_reference_policy` allow|block, PG concurrency test) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S4 | ✅ | — | Purchase UI + durable domain | H5-S3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S5 | — | ✅ | AI Action types `expense_import.v1` / `purchase_import.v1` | H5-S1, H5-S3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S6 | — | ✅ | Document Center builders: financial perm+app gates, adapter validation + reservations; cross-source dup test (PG); entry link | H5-S1, H5-S3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H6-S1..S3 | ✅ | — | Sales invoice drafts (no post, no ZATCA; one atomic transaction; shared quota lock for direct + import paths) | **D-03** | — | — | — | — | — | — | — | — | — | Blocked (D-03) | Skip to H7 until decided |
| IMP-H6-S4 | — | ✅ | AI Action `sales_invoice_import.v1` (atomic, quota protocol, parity) | **D-03**, H6-S1..S3, H1-S7 | — | — | — | — | — | — | — | — | — | Blocked (D-03) | — |
| IMP-H7-S1 | ✅ | — | Stocktake count-sheet import (whole sheet atomic, stocktake lock) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H7-S2 | — | ✅ | AI path for inventory opening | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H7-S3 | ✅ | ⛔ D-09 | Stock permit lines import (drafts; AI excluded by D-09) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H7-S4 | — | ✅ | AI Action `stocktake_count_import.v1` + parity + PG lock test | H7-S1, H1-S7 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H8-S1 | ✅ | ✅ | Import Hub `/imports` (visual research first) | H3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H8-S2 | ✅ | ✅ | Saved mapping presets (new table) | H8-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H8-S3 | ✅ | ✅ | Entry points on entity pages | H8-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H9-S1 | — | ✅ | `AiImportSuggestionService` (real provider, dark) | H2-S1, H2-S2 | — | — | — | — | — | — | — | — | — | Planned | Activation = D-02 |
| IMP-H9-S2 | — | ✅ | NL instruction → validated operation plan | H9-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H9-S3 | — | ✅ | Assistant tool `imports.open_action` (no approve/execute) | H9-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H9-S4 | — | ✅ | Conversational repair | H9-S3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H10-S1 | ✅ | ✅ | Security/accounting/reliability sweep | H1–H9 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H10-S2 | ✅ | ✅ | Std↔AI parity suite | H1–H9 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H11-S1 | — | — | Closure report | all | — | — | — | — | — | — | — | — | — | Planned | — |

## Decision log

| ID | Asked | Answer | Date | Effect |
|---|---|---|---|---|
| D-01..D-07, OPS-01 | See master plan §7 | _open_ | — | — |

## Deploy log

| Merge SHA | Slice | Railway deploy observed? | Evidence | Notes |
|---|---|---|---|---|
| — | — | — | — | No agent access to Railway; the owner confirms deploys. |
