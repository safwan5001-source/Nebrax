# IMP-H7-S1b — Stocktake count import: endpoints + durable job domain

Registers the H7-S1a adapter and exposes it. **Counts only** — posting the stocktake (stock movements + the variance journal entry) stays a separate action through `StocktakeService::post`; nothing here touches stock or the ledger.

## Changes

| Area | File |
|---|---|
| Domain + gates | `ImportJobDomain::STOCKTAKE_COUNT = 'stocktake_count'`; view `products.view`, manage `products.manage`, app `inventory.core` (= `POST stocktakes/{id}/count`); in `PREVIEW_BOUND_ONLY` |
| Registry | `ImportDomainRegistry` registers `StocktakeCountImportAdapter` (`DOMAIN` now references the constant) |
| Endpoints | `GET stocktakes/count-import/fields`, `GET stocktakes/{id}/count-import/template` (blind sheet, no system quantities), `POST stocktakes/count-import/inspect`, `POST stocktakes/count-import/preview` (issues the single-use binding, `plan = null`: the unit is the whole sheet and apply re-validates everything under the stocktake row lock). Gates `products.manage` + `inventory.core`; file routes behind `EnsureImportFilesScanned`. **No synchronous apply** (404 asserted) |
| Requests | `StocktakeCountImportRequest`; `StoreImportJobRequest`/`ApplyImportJobRequest` accept `stocktake_id` (required for this domain) and `existing_count_policy`, plus the field keys in mapping validation |
| Tests | `H7ImportEndpointsTest` (8) · `StocktakeCountImportTest` (registered-with-gates test replaces the obsolete "not registered") |

## Accounting impact

**None.** No journal entry, no stock movement, no stocktake status change (asserted: movements, entries and `status = draft` unchanged after a completed job).

## Verification

- SQLite: H7 endpoints + StocktakeCount + registry/authorization/preview/AI type-gates suites green; PostgreSQL: 58 passed (incl. the H7-S1a lock-race tests).
- The one failing test in the wider route sweep (`fuel sale api…`) is the known local `bcmath`-missing environment failure, unrelated and absent in CI.
- Independent subagent review: see PR conversation (no Codex review is claimed).

## Not in scope / next

UI wizard for stocktake count import (web), AI Action `stocktake_count_import.v1` (H7-S4, after the X-01 operational state), H7-S2/S3. No migration, permission, accounting or ZATCA change.
