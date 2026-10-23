# AWJ Unified Import — Horizon Tracker

> **Live progress log.** Update this file in every slice PR: branch, PR, SHAs, CI, deploy and verify. It does not re-plan; the plan is `AWJ_UNIFIED_IMPORT_MASTER_HORIZON.md`.
>
> **Status flow:** `Planned → In Progress → Code Complete → CI Passed → Merged → Deployed → Verified`, with `Blocked (D-xx)` and `Skipped (reason)` as side states.
>
> **"Deployed" is set only with evidence of a Railway deploy containing the Merge SHA. "Verified" is set only with evidence from the target environment.** A merge alone is never "Deployed".

## Current pointer

| Field | Value |
|---|---|
| Last merged slice | **IMP-H0-S1**: PR #1595, squash-merged 2026-10-22, Merge SHA `5e20e9edc941f83181497158fa68e6c55e95c485` |
| **Next slice** | **IMP-H2-S2** (shared value normalization), then S3 → S4 → IMP-X-01 → H3. Merged: H1-S1..S5a, S7, S8a/b/c. **On hold:** H1-S6 (PR #1626, owner decision D-13). H2-S0 merged `38b9b6d` (#1628). |
| Open owner decisions | D-01, D-02 (narrowed: `import_rows` data scope only), D-03, D-04, D-06, D-07, OPS-01 (D-05 has a non-blocking default; D-08/D-09 are recorded exclusions) |
| Railway state | Unknown (owner-reported stall; no access from the agent) |

## Slice log

| Slice | Std | AI | Scope | Depends | Branch | PR | Base SHA | Head SHA | Merge SHA | Tests | CI | Deploy | Verify | Status | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IMP-H0-S1 | — | — | Discovery, master plan, tracker, handoff (docs) | — | `claude/unified-import-h0` | #1595 | `474aad1` (main at start; merged onto `d187406`) | `323e6e4` | `5e20e9e` | CI: PHP SQLite ✅, PostgreSQL ✅ (one infra re-run), CI Gate ✅. Local: 8078 passed / 26 env-only `bcmath` Fuel failures | ✅ | n/a (docs; no code change deployed) | n/a | **Merged** | Model handoff → IMP-H1-S1 |
| IMP-H1-S1 | ✅ | — | Per-domain job authorization map (perm + app gate, index filtering); prune deletes media archive | H0 | `claude/imp-h1-s1-import-jobs-gate-retention` | #1603 | `1c8b643` | `dcb9af8` | `d959b98` | CI: SQLite ✅, PostgreSQL ✅ (first run caught a hand-inserted-tenant row-lock test needing `inventory.core`; fixed), CI Gate ✅. Local: 8155 passed / 26 env-only `bcmath` | ✅ | no migration, no env change; intended narrow behavior change (see report) | n/a | **Merged** | H1-S2 |
| IMP-H1-S2 | ✅ | ✅ | `ImportDomainAdapter` + registry; existing 3 domains moved behind it; no behavior change (unit-cursor/`applyUnit` deferred to H1-S3) | H1-S1 | `claude/imp-h1-s2-import-domain-adapter` | #1605 | `d959b98` | `2ee18e8` | `8412a19` | CI: SQLite ✅, PostgreSQL ✅, CI Gate ✅ (Gate needed one re-run: runners queued >10 min). Local: 8165 passed / 26 env-only `bcmath` | ✅ | no migration, no env change, no journal entry | n/a | **Merged** | H1-S7 / S3a |
| IMP-H1-S3 | ✅ | — | **Split:** **S3a** job branch binding (F-15) — **merged** #1607 `75d0fa1` · **S3b** single-use `import_previews` + `preview_hash`/options bound at job creation (optional until activation) + frozen options (`options_frozen`) + idempotency over frozen inputs + UI sends the binding — **merged** #1610 `d52437d` (CI SQLite ✅ PostgreSQL ✅ Gate ✅; Codex: 2 findings P1+P2 fixed/resolved, last review run on `20bb34c` never completed (stuck ~35 min, no findings); local full suite on `c0720d6`: 8273 passed / 26 env-only `bcmath`) · **S3c** catalog `plan_drift` + sync apply bound to its preview + real-PostgreSQL race proof — **merged** `e73cac6` · **S3d** `preview_required` activation + UI idempotency key + throttle. Original scope: single-use `import_previews` (canonical per-unit plan, `plan_drift` on apply, minted occurrence ids); job `branch_id` bound + restored per chunk (F-15); sync applies require `preview_hash`; options+mapping frozen at job creation; required preview-hash binding; `/apply` rejects changed options (legacy in-flight jobs only grandfathered); UI idempotency key; throttle | H1-S2 | `claude/imp-h1-s3a-preview-binding` (S3a), `claude/imp-h1-s3b-v2` (S3b), `claude/imp-h1-s3c-v2` (S3c) | #1607, #1610, S3c PR | `2aac9f0` (S3a base) | `3409be0` (S3a), `20bb34c` (S3b) | `75d0fa1` (S3a), `d52437d` (S3b) | S3a/S3b: SQLite ✅ PostgreSQL ✅ CI Gate ✅ | ✅ additive (S3a nullable column; S3b new table + 2 nullable columns; S3c 1 nullable column) | no env change | n/a | S3a, S3b, S3c **Merged** | S3c → S3d |
| IMP-H1-S4 | ✅ | ✅ | `SpreadsheetIntakeGuard` before parsing on every file-accepting import route (route invariant test; prod enable = D-04) | H1-S1 | `claude/imp-h1-s4-intake-guard` | #1616 | `e73cac6` | `e613c93` | `06d438c` | SQLite ✅ PostgreSQL ✅ Gate ✅; Codex clean on head; independent subagent review: 1 real defect (missing config key) fixed | ✅ no migration; default off | `IMPORTS_INTAKE_SCAN` (unchanged, default off) | n/a | **Merged** | — |
| IMP-H1-S5 | ✅ | — | Catalog job: whole-file pre-validation (S5a), fetch outside lock (S5b); repair via H1-S8 ✅ | H1-S2 | — | — | — | — | — | — | — | — | — | **S5a** whole-file duplicate pre-validation before chunk 1 — **merged** #1624 `813606d` (SQLite ✅ PostgreSQL ✅ Gate ✅) · **S5b** remote image fetch outside the job lock — **deferred, prerequisite of OPS-01 remote-image enablement** (feature is off; see report) | — |
| IMP-H1-S7 | — | ✅ | AI Action type gates: `domain_permissions` (all required) + `application_key` in registry/policy (suspended = read-only via `EnsureApplicationActive::authorize`); invariant `AiActionTypeGatesTest`; `product_import.v1` unchanged. **Known follow-up for the first key-bearing type:** classifier READ list vs AI GET handler names (see report) | H1-S1 | `claude/imp-h1-s7-ai-action-type-gates` | #1606 | `d959b98` | `6427014` | `2aac9f0` | CI: SQLite ✅, PostgreSQL ✅ after one re-run (unrelated `ZatcaCreditNoteIssuancePostgresTest` concurrency flake; commented on PR), CI Gate ✅ after re-run (runner queue) | ✅ | no migration, no env change | n/a | **Merged** | Before any new AI type |
| IMP-H1-S8 | ✅ | — | **Split:** **S8a** failed-unit persistence (`import_job_units`, deterministic `source_unit_ref`) + `GET /import-jobs/{id}/failures` (manage + sensitive-field redaction) — **merged** #1618 `cd69cda` (SQLite ✅ PostgreSQL ✅ Gate ✅; independent subagent review, Codex quota exhausted — no Codex review claimed) · **S8b** repair child job backend (`parent_job_id`, `POST /import-jobs/{id}/repairs`, membership by ref, per-unit atomic claim, real-PG race test) — **merged** #1619 `8c61ba8` (SQLite ✅ PostgreSQL ✅ Gate ✅; first PG run failed on a timing flaw in my own retry test — fixed, test-only; independent subagent review, Codex quota exhausted — no Codex review claimed) · **S8c** UI step "إصلاح الصفوف الفاشلة" + web contract — **merged** #1623 `7cc6f5d` (CI SQLite ✅ PostgreSQL ✅ web build ✅ Gate ✅; also fixed a review-found S8b gap: repair-child options frozen from the parent). Original scope: generic standard repair: immutable `source_unit_ref`, failures download (manage + sensitive-field redaction), refs claimed atomically at child apply | H1-S2, H1-S3 | — | — | — | — | — | — | — | — | — | Merged (S8a, S8b, S8c) | — |
| IMP-H1-S6 | ✅ | — | Zero-value opening hits `AccountingDateGuard` | — | — | — | — | — | — | — | — | — | — | **On hold — #1626 Draft (do not merge)** | D-13 (2026-10-23): owner chose *policy unification* (B), not blanket enforcement. Superseded by the separate accounting slice **ACC-INV-DATE-01**; decision matrix `docs/audits/accounting/ACC-INV-DATE-01-DECISION-MATRIX.md` **awaits owner approval — no rule change before it** |
| IMP-H2-S0 | — | ✅ | Honest labeling on products AI import until H9-S5 connects it to the assistant | — | — | — | — | — | — | — | — | — | — | **Merged** `38b9b6d` (#1628) | — |
| IMP-H2-S1 | ✅ | — | V2 create via `ProductService::create` (characterized) | H1-S2 | — | — | — | — | — | — | — | — | — | **Merged** (#1630) | — |
| IMP-H2-S2 | — | ✅ | Shared value normalization (remove duplicated regexes) | — | — | — | — | — | — | — | — | — | — | **Merged** `c301550` (#1631) | — |
| IMP-H2-S3 | ✅ | — | Workbook UX parity (inspect/template/mapping) | — | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H2-S4 | — | ✅ | Tenant `ai_actions.enabled` endpoint (backend; UI split to S4b) | — | — | — | — | — | — | — | — | — | — | **Merged** `0572fa4` (#1634) | `ai.actions.manage`; report `IMP-H2-S4-REPORT.md` |
| IMP-H2-S4b | — | ✅ | Settings card for the tenant opt-in + reason on AI import screens | H2-S4 | — | — | — | — | — | — | — | — | — | **Merged** `e8aa36a` (#1637) | Web only; report `IMP-H2-S4b-REPORT.md` |
| IMP-H2-S5 | ✅ | ✅ | Sync V2 + AI preview/execution onto `ProductImportAdapter` (policy-expressed differences, parity test) | H1-S2, H2-S1, H2-S2 | — | — | — | — | — | — | — | — | — | **Split:** S5a **merged** `8537303` (#1640) · S5b planned | — |
| IMP-H3-S1 | ✅ | ✅ | `PartnerImportFields` + adapter (no opening balance) | H1-S2 | — | — | — | — | — | — | — | — | — | In review (PR) | Adapter not registered until S2; report `IMP-H3-S1-REPORT.md` |
| IMP-H3-S2 | ✅ | — | Partner inspect/preview endpoints (no sync apply) + `partner_master` job domain | H3-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S3 | ✅ | — | Customers/suppliers import UI | H3-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S4 | — | ✅ | AI Action `partner_import.v1` + parity test | H3-S1, **IMP-X-01 (blocking prerequisite per owner window — see Parked requirements; same for H4-S4, H5-S5, H7-S2, H7-S4)** | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H3-S5 | — | ✅ | Partner AI import UI | H3-S4 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S1 | ✅ | via H4-S4 | Categories (hierarchy) + brands import (adapter + standard) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S2 | ✅ | via H4-S4 | Price-list items import (adapter + standard) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S3 | ✅ | ⛔ D-08 | Unit templates (create-only; AI excluded by D-08) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H4-S4 | — | ✅ | AI Actions `product_taxonomy_import.v1` + `price_list_item_import.v1` (separate gates) + parity | H4-S1, H4-S2, **IMP-X-01 (blocking)** | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S1 | ✅ | — | Expense adapter (drafts, derived tax, `import_document_reservations` with full-predicate key; reference-less fallback key + explicit distinct confirmation) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S2 | ✅ | — | Expense UI + durable domain | H5-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S3 | ✅ | — | Purchase adapter (grouped drafts with required `supplier_invoice_ref`, derived totals, `import_document_reservations` owned by the document services (create/update re-key/delete), `duplicate_reference_policy` allow|block, PG concurrency test) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S4 | ✅ | — | Purchase UI + durable domain | H5-S3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S5 | — | ✅ | AI Action types `expense_import.v1` / `purchase_import.v1` | H5-S1, H5-S3, **IMP-X-01 (blocking)** | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H5-S6 | — | ✅ | Document Center builders: financial perm+app gates, adapter validation + reservations; cross-source dup test (PG); entry link | H5-S1, H5-S3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H6-S1..S3 | ✅ | — | Sales invoice drafts (no post, no ZATCA; one atomic transaction; shared quota lock for direct + import paths) | **D-03** | — | — | — | — | — | — | — | — | — | Blocked (D-03) | Skip to H7 until decided |
| IMP-H6-S4 | — | ✅ | AI Action `sales_invoice_import.v1` (atomic, quota protocol, parity) | **D-03**, H6-S1..S3, H1-S7 | — | — | — | — | — | — | — | — | — | Blocked (D-03) | — |
| IMP-H7-S1 | ✅ | — | Stocktake count-sheet import (whole sheet atomic, stocktake lock) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H7-S2 | — | ✅ | AI path for inventory opening | H1-S2, **IMP-X-01 (blocking)** | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H7-S3 | ✅ | ⛔ D-09 | Stock permit lines import (drafts; AI excluded by D-09) | H1-S2 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H7-S4 | — | ✅ | AI Action `stocktake_count_import.v1` + parity + PG lock test | H7-S1, H1-S7, **IMP-X-01 (blocking)** | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H8-S1 | ✅ | ✅ | Import Hub `/imports` (visual research first) | H3 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H8-S2 | ✅ | ✅ | Saved mapping presets (new table) | H8-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H8-S3 | ✅ | ✅ | Entry points on entity pages | H8-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H9-S1 | — | ✅ | Read-only assistant import tools (`imports.action_status`, `imports.explain_failures`): counts/statuses/error codes only, new default-off `import_metadata` category | H1-S7, H2-S4 | — | — | — | — | — | — | — | — | — | Planned | No D-02 needed (no row values leave) |
| IMP-H9-S2 | — | ✅ | `imports.suggest_mapping`: headers + ≤20 sample rows, `import_rows` category, `ai_suggested` version, adapter re-validates | H9-S1, H2-S5 | — | — | — | — | — | — | — | — | — | Blocked (D-02) for activation | Code ships dark |
| IMP-H9-S3 | — | ✅ | NL operation plan as a closed-schema tool argument → new action version (no approve/execute) | H9-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H9-S4 | — | ✅ | `imports.start_repair` + conversational explanation | H9-S1, H1-S8 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H9-S5 | — | ✅ | "Ask the assistant" entry on AI import screens; `ai_import` context in `context.ts` | H9-S1 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H10-S1 | ✅ | ✅ | Security/accounting/reliability sweep | H1–H9 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H10-S2 | ✅ | ✅ | Std↔AI parity suite | H1–H9 | — | — | — | — | — | — | — | — | — | Planned | — |
| IMP-H11-S1 | — | — | Closure report | all | — | — | — | — | — | — | — | — | — | Planned | — |

## Parked requirements (registered, not started — they do not change any slice above)

Details, reuse analysis, dependencies and acceptance: `AWJ_IMPORT_PARKED_REQUIREMENTS.md`. "Parked" means *not started and not inside any current slice's scope*; it is nevertheless a **blocking prerequisite** of the first additional AI Action type (H3-S4 and every later AI Action slice), so those rows list it as a dependency. No existing slice is reordered.

| ID | Requirement | Status | Window | Depends on | Owner decisions |
|---|---|---|---|---|---|
| IMP-X-01 | Super Admin control of AI Actions — global (master + execution), per tenant, per action type; audited; no change to isolation/RBAC/approval | **Parked** | After IMP-H2-S4, before IMP-H3-S4 | H1-S7 (merged), H2-S4 | D-10 ✅, D-11 ✅, D-12 ✅ in principle (2026-10-22); capability split preview/review/execution is binding |

## H0 correction record (IMP-H0-S2)

Owner-confirmed and re-verified in code: the AWJ Assistant already contains real AI (Anthropic provider, tool-planning loop, consent, budget, audit, grounding). The H0 plan wrongly framed provider enablement as pending for the import path. **Corrected:** H9 now adds import tools to the existing assistant (no new provider, no second assistant, no change to AI settings); D-02 narrows to whether import row data may be sent to the model. The standard import is unaffected and stays independent of AI. See master plan §2.4 and H9.

## H0 review record

- **PR #1595:** 14 Codex review rounds produced 54 threads, every one answered and resolved. They are folded into master rules 7–12 and slices H1-S3/S7/S8, H2-S5, H4-S4, H5-S1/S3/S6, H6-S4 and H7-S4.
- The final Codex pass on `323e6e4` stayed in "running" for more than an hour and never posted a result. The merge proceeded on green CI, a clean merge state and zero open threads.
- **CI:** the PostgreSQL job on `323e6e4` hung in package install, before any test ran. It was cancelled and re-run once, then passed.

## Decision log

| ID | Asked | Answer | Date | Effect |
|---|---|---|---|---|
| D-01..D-07, OPS-01 | See master plan §7 | _open_ | — | — |
| D-10 | Env flags stay a hard floor that Super Admin settings cannot override | **Approved** | 2026-10-22 | Binds IMP-X-01 (parked) |
| D-11 | Default deny: Super Admin grant **and** tenant owner approval; all RBAC/isolation/preview/approval checks continue | **Approved** | 2026-10-22 | Binds IMP-X-01 (parked) |
| D-12 | AI Actions ↔ ApplicationCatalog/plans supported later; commercial entitlement is independent of operational control and never grants execution | **Approved in principle** | 2026-10-22 | Future; not in first IMP-X-01 slice |

## Deploy log

| Merge SHA | Slice | Railway deploy observed? | Evidence | Notes |
|---|---|---|---|---|
| `5e20e9e` | IMP-H0-S1 | Not observed | None (no agent access to Railway) | Docs only; any auto-deploy it triggers ships the code already on `main`. No agent access to Railway; the owner confirms deploys. |
