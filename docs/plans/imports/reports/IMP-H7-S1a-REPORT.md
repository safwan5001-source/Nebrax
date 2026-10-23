# IMP-H7-S1a — Stocktake count-sheet import: field contract, service and durable-engine adapter (unregistered)

**Branch:** `claude/imp-h7-s1a-stocktake-count` · **No migration, env, route, permission, accounting/ledger, ZATCA or AI-setting change.** The adapter is **not registered** in `ImportDomainRegistry`/`ImportJobDomain` (no request can reach it; endpoints are H7-S1b, after H4-S5 lands the same registry files). A static test proves it.

## What it adds

- `StocktakeCountImportFields` — `nebrax_id` · `sku` · `barcode` (product identifiers, in that priority) · `product_name` (informational, **never an identifier**) · `counted_quantity` (required). **Not in the contract:** warehouse (the sheet fixes it), system quantity, cost, stocktake id (an option, never a column).
- `StocktakeCountImportService` — `template(stocktakeId)` (a **blind** count sheet: a row per stocktake line with SKU / barcode / name and an empty count column, **no system quantity**, so the count stays independent of the ledger), `inspect`, `preview`, `apply`, `options`.
  - **Writes counts only** via `StocktakeService::count` (the direct count path). No stock movement, no journal entry, no posting — the variance flow (`StocktakeService::post`, including its movement-since-open guard) is untouched and remains a separate human action. It never adds a product to the sheet.
  - **Unit = the whole sheet** (rule 9): one transaction; any row error blocks everything (`ImportUnitFailureException` with per-row failures).
  - **Row-lock on the stocktake** (`lockForUpdate`) before parsing and writing, with "open" re-checked under the lock. `post()` locks the same row first, so a concurrent post either wins (import then fails: *the stocktake is posted*) or waits and sees the full sheet; counts are never written to a posted stocktake.
  - **Existing-count policy** `existing_count_policy` (CLAUDE.md rule 6, per run): `error` (default — never silently replace a count) · `overwrite` · `skip`. An equal value is always *unchanged*, so re-uploading the same file is safe. Lines absent from the file stay as they are (never zeroed).
  - **Blank ≠ zero:** a blank count cell is a row error (*delete the row if it was not counted*); `0` is a real count. Integers only (Arabic/Persian digits and thousands separators accepted; `2.5`, `-1`, `1e3`, > 100,000,000 rejected — same bound as `StocktakeController::count`).
  - **Product resolution is confined to the sheet's own lines:** unknown, out-of-sheet, malformed-UUID, ambiguous barcode (two lines share it), name-only and duplicated-in-file rows are row errors (duplicates fail *both* rows). SKU is tenant-unique so it cannot be ambiguous.
  - **Access = the direct API's:** the stocktake's branch and warehouse must be within the user's access, else *not found* (no existence leak); other tenants' ids are not found. Template download follows the same rule.
- `StocktakeCountImportAdapter` (`stocktake_count`, `UNIT_FILE`, `MAX_ROWS` 5000): canonical options (`stocktake_id` lower-cased UUID, `existing_count_policy`, `mapping`), applied through the service with the job's user.

## Tests

- `StocktakeCountImportTest` (23, SQLite + PostgreSQL): contract (no warehouse/cost/system-quantity fields; Arabic header auto-map); blind template lists every line with no system quantities and re-imports as-is; writes by SKU/barcode/Nebrax ID (case-insensitive UUID) and leaves unlisted lines uncounted; zero vs blank; invalid quantities; out-of-sheet/unknown/foreign-product rows never added; name-only rejected; duplicates; ambiguous barcode; default policy vs equal value; `skip`/`overwrite`; idempotent re-import; whole-sheet atomicity; over-wide rows; preview writes nothing; posted stocktake refuses; unknown/foreign-tenant stocktake; warehouse-restricted user cannot import or download the template; **no movement / no journal entry created and the existing `post()` then produces the expected variance**; adapter shape; chunk application; static non-registration.
- `StocktakeCountImportConcurrencyPostgresTest` (2, real PostgreSQL + `pcntl_fork`; fails rather than skips without pcntl):
  - **Deterministic lock proof:** another connection holds the stocktake row `FOR UPDATE` (as `post()` does), flips it to `posted` and releases; the import must stay blocked for the hold period, then fail with *stocktake is posted* and write no count. **Negative control run:** with the import's lock disabled this test fails.
  - Invariant race: `post()` racing a 60-line import — the stocktake is either posted with every counted line costed (counts were written before posting) or still a draft; the sheet is never half-counted. (A timing-based negative control for this one did not bite — the window is too narrow to hit reliably — so the deterministic test above is the one that proves the lock.)
  - Test hygiene note: the parent closes its DB connection before forking and opens a new one afterwards; a child's `DB::purge()` on an inherited SSL socket otherwise tears down the parent's session (and its locks).

## Known limits (disclosed)

- `StocktakeService::count` itself (used by the direct API) does not lock the stocktake row; the import adds its own lock, but a direct `POST stocktakes/{id}/count` racing `post` keeps today's behaviour (out of scope; flagged for a later hardening slice).
- Quantities are integers (the stocktake model stores integers); fractional units are not supported by the existing stocktake either.
- No UI, no endpoints, no AI action (H7-S4 later, blocked on IMP-X-01 gates).
