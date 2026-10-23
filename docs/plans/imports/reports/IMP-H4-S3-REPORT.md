# IMP-H4-S3 — Unit templates import (create-only; no AI path — D-08)

**Branch:** `claude/imp-h4-s3-unit-templates` · **No migration, env, route, permission, accounting/ledger, ZATCA or AI-setting change.** Adapter **not registered** (endpoints/gates/UI come later). **No AI action type exists or will be added for this domain (owner decision D-08):** a conversion factor multiplies stock quantities, so an AI-suggested factor is not worth the convenience for a handful of templates.

## What it adds
- `UnitTemplateImportFields` — long format, one row per alternate unit: `template_name`, `base_unit`, `unit_name`, `factor`, `is_active`. A template with no alternate units is a single row without `unit_name`. No product, id or update fields.
- `UnitTemplateImportService` — `template`, `inspect`, `preview`, `apply`:
  - **Create-only.** An existing template name (org-wide, all branches — like the controller) is an error by default; run policy `existing_policy=skip` skips the whole template with a warning and **never compares or edits its units** (semantic edits belong to the screen's PR-UOM-1 guard: inventory footprint and live references).
  - **Controller rules verbatim:** factor integer 2…1,000,000 (no default), no alternate unit named like the base, no duplicate unit, ≤ 50 units, name ≤ 255. Rows of one template need not be adjacent; a conflicting base unit or active flag between a template's rows is an error on the conflicting row.
  - **Unit of execution = the whole file** (a template is a row group; templates are few): one atomic transaction, any error writes nothing. Per-run advisory lock on the tenant (PostgreSQL) because name uniqueness is an application check.
  - Writes with `UnitTemplate::create` + `UnitTemplateUnit::create` (same as `UnitTemplateController::store/syncUnits`); no product is touched; the created template resolves units exactly like a screen-made one (tested via `factorFor`).
- `UnitTemplateImportAdapter` (`unit_templates`, `UNIT_FILE`, like the workbook/opening adapters). The direct API gate is `products.manage`; the registered domain must declare the same.

## Tests
- `UnitTemplateImportTest` (22, SQLite + PostgreSQL): contract, importable template, option/mapping refusals, multi-template create with units/active flag, `factorFor` parity, non-adjacent rows, every controller rule per row (base-named unit, factor 1 / over cap / non-numeric, duplicate, conflicting base, factor without unit, bad boolean, conflicting active flag), >50 units, error anywhere writes nothing, **injected mid-write failure rolls everything back**, existing template error / skip (untouched), other isolated branch still blocks the name, no product touched, wide-row guard, adapter options and chunk.
- `UnitTemplateImportConcurrencyPostgresTest` (1, real PostgreSQL + `pcntl_fork`): four racing imports of the same 30 templates → 30 rows, one winner, losers fail with a named row failure. **Negative control:** lock removed → fails; restored → green.

## Known limits
- Template-edit, adding units to an existing template, and product linkage are intentionally out of scope.
- No endpoints/UI yet; no screenshots.

## Independent review (read-only subagent) — disposition

Clean: rows that error never leak into a created template, first-row errors, name/unit trimming and lengths, tenant/branch isolation, lock correctness. Findings:

| # | Finding | Disposition |
|---|---|---|
| 1 | **HIGH.** The factor reused the lenient product-import integer parser: `2,5`→25, `1,2`→12, `1 2`→12, `12%`→12, `012`, `12.0`, `٢٠` were accepted — a mistyped decimal becomes a 10× factor, which multiplies stock | **Fixed**: a strict factor parser (digits only after Arabic-digit conversion, no separators / `%` / leading zeros / `.0`, 2…1,000,000) + a test over 13 bad and 4 good formats |
| 2 | A template named `0` was dropped by `array_filter` and never seen as existing (duplicate created) | **Fixed** (`!== null` filter) + test |
| 3 | A blank `base_unit` on a later row was silently inherited | **Fixed**: required on every row + test. (An `is_active` declared on any row applies to the template; conflicting declarations remain an error — documented) |
| 4 | Under `skip`, an existing template's unit rows were still validated, contradicting the "not compared" warning | **Fixed**: only cell-format errors still fail the file; unit rules are not applied to a skipped template + test |
| 5 | Preview of an empty file returns zeros while apply refuses | **Accepted** (apply refusal is the guard; asserted) |
| T | Missing tests: factor formats, falsy name, valid-units-of-errored-template, preview counts = apply counts, zero-row apply | **Added** |
| — | The lock serialises import vs import only (the screen's create is lock-free; no DB unique index) | **Accepted, documented** (same stance as the other importers) |

No Codex review (quota exhausted).
