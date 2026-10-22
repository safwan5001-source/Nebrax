# IMP-H1-S4 — Import intake guard (malware scan before parsing)

**Branch:** `claude/imp-h1-s4-intake-guard` · **Depends on:** H1-S1 (registry) · **Production enablement:** owner/ops decision **D-04** (not made here)

## Problem

Spreadsheet/archive uploads on the import routes were parsed (CSV/XLSX via `ZipArchive`+`XMLReader`, image archives via ZIP) without any
malware admission step, while Document Center uploads go through `DocumentSafetyScanner` (ClamAV). An import is a file-intake surface
like any other and must be admitted by the same scanner **before** any parsing, previewing, staging or storage.

## Changes

- `App\Services\SpreadsheetIntakeGuard` — `enabled()` reads `config('imports.intake_scan.mode')` (`off` | `on`); `admit(iterable $files)` opens each file and calls
  `DocumentSafetyScanner::scan`. **Fail closed:** `INFECTED` → 422; scanner throws / unreachable / unconfigured → 503 (details never leaked); any non-`CLEAN` status → 503.
- `App\Http\Middleware\EnsureImportFilesScanned` — flattens `$request->allFiles()` (spreadsheet **and** `media_archive`/image archives) and admits all of them; a no-op when the policy is off.
- `config/imports.php`: `intake_scan.mode = env('IMPORTS_INTAKE_SCAN', 'off')`.
- `routes/api.php`: the middleware added to `products/import` and `products/workbook` and `inventory-openings/import` (`inspect|preview|apply`), `POST import-jobs`,
  and the AI Action file / image-archive upload routes (`ai-actions/{action}/files`, `/image-archives`).

## Safety / behavior

- **Default off ⇒ no behavior change** anywhere (scanner never consulted — tested). No migration, no new table, no env change made, no AI/provider setting touched.
- Enabling in production requires a reachable ClamAV; enabling without it makes every import return 503 by design (fail closed). That is why enablement is **D-04** (owner/ops), not part of this merge.
- The guard runs before RBAC for `POST import-jobs`, because that route's authorization lives in its FormRequest; an unauthenticated caller is already stopped by `auth:sanctum`. An unauthorized-but-authenticated caller could cause a scan of their own upload only when the policy is on.
- No accounting, journal, ZATCA or inventory logic is touched.

## Tests — `ImportIntakeGuardTest` (7)

1. Policy off never consults the scanner. 2. On + clean proceeds, scanned first. 3. Infected refused on every import entry; nothing is created.
4. Unavailable/unconfigured scanner → 503, no detail leak. 5. Non-`CLEAN`, non-`INFECTED` status → 503. 6. Every uploaded file in the request (including `media_archive`) is scanned.
7. **Route invariant:** every POST/PUT/PATCH route whose FormRequest rules (or controller source) accept a file carries the middleware, or is listed in `NOT_IMPORT` with a reason
   (13 non-import routes: Document Center batch files, product media, category images, expense/payment/purchase/employee/invoice-note attachments, storefront media). A stale exclusion also fails.
   A new import domain therefore cannot ship unguarded.

**Negative control (run manually):** removing the middleware from `ai-actions/{action}/files` makes the invariant test fail and name the route; restored → green.

## Verification

- `--filter=ImportIntakeGuardTest`: 7 passed (40 assertions).
- `--filter='Import|AiAction|InventoryOpening|ProductWorkbook'`: 403 passed, 6 skipped (PostgreSQL-only in SQLite).
- Full local suite and CI (SQLite + PostgreSQL + Gate): recorded on the PR.
