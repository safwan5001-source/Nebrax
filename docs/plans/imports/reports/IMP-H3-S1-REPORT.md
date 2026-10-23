# IMP-H3-S1 — Partner import: field contract, service and durable-engine adapter

**Branch:** `claude/imp-h3-s1-partner-import` · **No migration, env, accounting/ledger, ZATCA or AI-setting change.** The adapter is **not registered** in `ImportDomainRegistry`/`ImportJobDomain` (that, the sync inspect/preview endpoints and the `partner_master` domain gates are **H3-S2**), so no request can reach it yet. Standard (deterministic) path only — the AI action type is H3-S4 and stays behind IMP-X-01.

## What it adds

- `PartnerImportFields` — single registry for customers/suppliers: `nebrax_id` (match only), `code`, `name` (required), `name_en`, `entity_type`, `vat_number` (15 digits), `cr_number`, `email`, `phone`, `mobile`, address parts, `country`, `credit_limit` (riyals → halalas), `credit_period` (0–3650), `is_active`. Template headers and Arabic/English auto-mapping derive from it.
  **Never in the contract:** `type` (fixed by the entry point), `opening_balance*` (D-01 — a file column of that name is simply unmapped and nothing posts), `tenant_id`/`branch_id`, classifications and price list (later, with an explicit master-data contract).
- `PartnerImportService` — `template`, `inspect`, `preview`/`previewWithPlan`, windowed `apply`:
  - **Modes** `create | update | upsert`; match by Nebrax ID, then code. The name is never an identifier (update without an id/code column is refused). The code can change only when the row was matched by Nebrax ID. The partner's `type` never changes; a partner of the *other* kind (not `both`) is a row error, not a silent conversion.
  - **Blank policy** `ignore | clear` (only clearable fields are cleared; others warn).
  - **Duplicate signals** (VAT, CR, phone, mobile, email) — per-run policy `error | skip | warn`, default `warn` (= today's behaviour of `POST /partners`, which accepts duplicates). Compared normalized (digits only / lower-case) by exact equality against stored values *and* between rows of the same file.
  - **Code uniqueness is tenant-wide** (including soft-deleted rows and other branches). A code the user cannot see is refused as `code_taken` instead of letting the unique index abort the chunk transaction mid-way.
  - **Whole-file in-file duplicate check** (code, Nebrax ID, and signals under `error`) at the first chunk, before any write; later chunks analyse the whole file but write only their window.
  - **Writes only through canonical paths:** `PartnerService::create` (same as `POST /partners`) and model `update` (same as the controller). No journal entry is ever created.
  - **Concurrency (rule 11):** under `error`/`skip` the whole analysis + write runs inside the chunk transaction after a PostgreSQL transaction-scoped advisory lock keyed by tenant (no effect on SQLite; does not touch the tenant anchor, so ledger posting is not blocked). The direct `POST /partners` path stays lock-free and keeps accepting duplicates — a race between it and an import is accepted, as the plan states.
- `PartnerImportAdapter` (`partner_master`, `UNIT_ROW`, `DURABLE_MAX_ROWS`): canonical options, plan-drift expectation from a bound preview, repair-child claim hook (reuses `ImportRepairClaims`), failures export with no sensitive columns.
- `ProductImportValueNormalizer::money/integer/boolean` became `public` (no behaviour change) so partner money/integer/boolean cells parse exactly like product cells.

## Tests

- `PartnerImportTest` (20, SQLite + PostgreSQL): contract (no type/opening balance, Arabic header mapping, template importable as-is); typed create + type fixed by entry; opening-balance column ignored and zero journal entries; per-row validation + named unit failures; update/upsert/skip classification; code-vs-id rule; other-kind vs `both`; unknown/conflicting ids; blank policy; in-file duplicates fail the whole file before any write; the three signal policies (DB and in-file); soft-deleted code refused; same code in another tenant is not a conflict; windows; plan drift; adapter options and chunk.
- `PartnerImportConcurrencyPostgresTest` (2, real PostgreSQL + `pcntl_fork`): four racing imports with the same VAT and different codes create exactly **one** partner under `error` (the others fail with a named row failure) and under `skip` (1 created, 3 skipped). **Negative control:** removing the lock makes both fail 3/3 runs; restored → green. Validated locally against a throwaway PostgreSQL 16, not only in CI.

## Known limits (disclosed)

- Signal comparison is exact on the normalized form against stored values: historical rows stored with different formatting (e.g. phones with dashes) are not detected as duplicates.
- `default_price_list_id`, classifications and the legacy `classification` text are not importable yet.
- No UI and no endpoints until H3-S2/S3.

## Disclosures

No Codex review (quota exhausted); an independent read-only subagent review is recorded in the PR if run.
