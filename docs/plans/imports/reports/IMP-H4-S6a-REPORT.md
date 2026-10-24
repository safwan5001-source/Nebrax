# IMP-H4-S6a — Categories / brands import wizard (UI)

**Branch:** `claude/imp-h4-s6a-taxonomy-wizard`. Web only: **no backend, migration, permission, accounting or ZATCA change.** Drives the merged `product_taxonomy` endpoints and job domain (H4-S5). No accounting effect, no product or stock effect.

## What it adds

- Routes **`/inventory-settings/categories/import`** and **`/inventory-settings/brands/import`** (the kind is fixed by the entry, like the customers/suppliers wizard) and an «Import from file» button on both settings pages (`SettingsHeader` gained an optional `action` slot).
- **Four steps** — Setup (file · rules · mapping) → Preview (no writes; compact row table with the full category path, the action badge, messages/warnings and the parents a row will create; counters for create/update/skip/warnings/errors; error CSV) → preview-bound durable job → Result with failed-row download/repair (row domain, `ImportRepairPanel`).
- **Rules mirror the server:** operation (create only / update only / create-or-update), blank-cell policy (ignore/clear — disabled for create-only), and, **for categories only**, missing-parent policy (reject / create the missing parents). A brand never sends `parent_policy`.
- **Mapping guard mirrors the server:** create/upsert need «Name»; update needs «Name» or «Nebrax ID»; no duplicate mapping; only writable fields plus the Nebrax ID are offered.
- **Hardening carried over from the expense/purchase wizards' reviews:** stale job never re-applied (rule/file/mapping changes drop it, never while applying); job-creation failure visible and returns to Preview; Apply disabled once the job from a preview has ended (single-use binding spent); Preview disabled after a failed inspect; resume from `?job=` refuses an unbound or other-domain job; explicit Continue for a paused job; latest-wins sequencing.
- Result shows the **cumulative rows processed** (`processed_rows`) and, labelled as such, the last chunk's created/updated/skipped breakdown (the engine returns that breakdown for the last chunk only).
- ar/en `taxonomyImport` block (key parity checked by script) and `inventorySettings.import_from_file`.

## Disclosures / limits

- No screenshots (component tests only) — same disclosed limit as the earlier wizards.
- The customers/suppliers wizard (`/partners/import`) still has the older state handling (the shared gaps in **IMP-WIZARD-STATE-01**): it was not touched here.
- The breakdown after a multi-chunk run is last-chunk-only (engine behaviour for every row domain); the cumulative total is the reliable number.

## Tests

- `contract.test.ts` (4) and `ProductTaxonomyImportWizard.test.tsx` (10): inspect carries the kind and offers writable fields + Nebrax ID; policies sent with the preview; **parent policy shown for categories, absent and never sent for brands** (mutation-verified); name/identifier mapping guards per operation; rows with paths and the parents a row will create, Apply blocked while any row has an error; durable job completes showing the cumulative total and sending no semantic options on apply; creation failure visible; a rule change creates a new job with the new option; **Apply disabled after the job ended** (mutation-verified); no preview after a failed inspect; unbound / other-domain resume refused.
- A first draft of the brand test checked for the parent control *after* leaving the setup step (vacuously true); the mutation run caught it and the test was rewritten to assert before the step change.
- Full web suite and `tsc` on touched files: see PR.

## Journal entries

None — taxonomy only, no accounting or stock.
