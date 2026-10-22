# IMP-H1-S2 — `ImportDomainAdapter` + registry (no behavior change)

**Branch:** `claude/imp-h1-s2-import-domain-adapter` · **Depends on:** IMP-H1-S1 (#1603)

## What changed

The durable job engine (`ImportJobService`) used to carry domain-specific code: a `match` on
the domain for row ceilings, three `run*Chunk` methods, a CSV/XLSX row counter and the
catalog-only first-apply recount. All of it now sits behind one contract, so adding a domain
(H3+) means adding one adapter instead of editing the engine.

| Piece | Role |
|---|---|
| `Contracts\ImportDomainAdapter` | `domain()`, `unit()` (row/file/document), `maxRows()`, `inspect()`, `recountOnFirstApply()`, `applyChunk(ImportChunk): ImportChunkResult` |
| `Support\ImportChunk` / `ImportChunkResult` | Immutable chunk input / result (processed units + stored `apply_result`) |
| `Services\SpreadsheetImportAdapter` | Shared base: column ceiling, row counting |
| `ProductCatalogImportAdapter` (row) · `ProductWorkbookImportAdapter` (file) · `InventoryOpeningImportAdapter` (file) | The three existing domains, bodies moved verbatim from `ImportJobService` |
| `ImportDomainRegistry` | The only place that resolves a domain to its code; unknown domain fails closed |

`ImportJobService` keeps locking, `assertApplicable`, the chunk loop, failure handling and
idempotency exactly as before; it now delegates through the registry.

## Safety statement

- **No journal entry, no migration, no route change, no new permission.** Accounting paths are
  untouched (the opening adapter still calls the same `InventoryOpeningImportService`).
- **One behavior change (fail-closed):** `inspect()` for a domain that is not registered now
  throws instead of falling back to a generic CSV branch. Unreachable in practice — new rows are
  validated against `ImportJobDomain::values()`, and a test asserts registry == `values()`.
- AI settings, provider, assistant, Railway config: untouched.

## Verification

- Focused: `ImportDomainRegistryTest` (6) + all `ImportJob*` suites unchanged and green.
- Full local suite: **8165 passed, 167 skipped, 26 failed** — the 26 are the known env-only
  `bcmath` Fuel failures (`FuelAviRfid/Reconciliation/Sale/SupplyReceiving`), same as `main`.
  (An earlier full run was invalid: the session hook rebuilt the shared test DB mid-run; re-run clean.)
- CI (SQLite + PostgreSQL) — see PR.

## Review

Codex review quota is exhausted, so this was **not** reviewed by Codex. An independent read-only
subagent reviewed the diff line-by-line against the old `ImportJobService`: **no blocking
issues**; it flagged doc references to S1 symbols not yet on this branch, one stale comment and a
brittle source-grep test — the doc/comment items were fixed. The review did not run the tests.
It is not a substitute for human or Codex review.

## Follow-ups

- Done after S1 merged (`d959b98`): `ImportDomainRegistryTest` now also asserts every registered domain declares
  gates in `ImportJobDomain::authorization()`.
- `ImportJobService::create()` still has a catalog-only media-archive check; moves in a later slice.
