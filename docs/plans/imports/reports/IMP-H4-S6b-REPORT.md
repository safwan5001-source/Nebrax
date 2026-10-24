# IMP-H4-S6b — Price list items import wizard (UI)

**Branch:** `claude/imp-h4-s6b-price-list-wizard`. **Web only:** no backend, migration, permission, env or ZATCA change. **No journal entries** — the import writes list prices through the existing `PriceListService::upsertItem`; product card prices, saved invoices and accounting are untouched (server rule, stated on screen).

## What it adds
- Route `/sales-settings/pricelists/import` (optional `?price_list_id=`) and an «Import from file» button on the price lists screen (preselects the open list).
- `PriceListItemImportWizard` for the merged `price_list_items` domain (H4-S5). Setup (**target list · operation · file · column mapping**) → Preview (no writes) → preview-bound durable job → Result, with failed-row download/repair (row domain).
- **Target list is a frozen run option**, chosen from the active lists (`GET /price-lists`); a `?price_list_id=` is accepted only when it is active and known. The file is blocked until a list is chosen because the server requires `price_list_id` even for `inspect` (`PriceListItemImportRequest`).
- Operation defaults to **upsert** (the workbook/server default); create-only and update-only available with hints.
- Mapping guard mirrors the server: `price` required, a product identifier (`nebrax_id` or `sku`; a name is not one), no field mapped twice.
- Preview table: row · product (name + SKU) · unit (blank = base unit) · new price · current price · action · status; prices shown in riyals from halalas in the display layer only. Error CSV is formula-safe.
- Hardening carried from the purchase/taxonomy wizards: stale job never re-applied, creation failure visible, Apply disabled once a preview's job has ended, no preview after a failed inspect, foreign-domain job refused on every path, unbound job refused, stepper cannot jump to a missing preview, explicit Continue, **repair children (frozen via `parent_job_id`) resume and continue**, partial-failure note, latest-wins sequencing.
- ar/en `priceListImport` block (key parity scripted: 0 differences) + `priceLists.import_from_file`.

## Tests
`PriceListItemImportWizard.test.tsx` 16 + `contract.test.ts` 4 (20 total). Mutation controls (each fails a test when applied): file input not disabled without a list · list not sent to inspect · foreign-domain guard removed · mapping gaps ignored.

**Disclosed test limit:** removing `invalidatePreview()` from the list `onChange` survives the suite. It is not observable: after returning to setup the stepper cannot go forward again (`index <= step`) and `runPreview()` itself calls `dropJob()`, so a stale preview is unreachable either way. The call is kept as defence in depth for consistency with the other wizards; the test that remains asserts what is observable (the newly chosen list is what the next preview and job freeze).

## Review dispositions
Independent review and Codex review: see PR thread (to be appended on merge).

## Out of scope / follow-ups
- H4-S6c unit-templates wizard (atomic `UNIT_FILE`) is next.
- Component tests only; no screenshots. Product variants and unit-factor price derivation remain excluded by the H4-S2 contract.
- IMP-WIZARD-STATE-01 (older wizards, engine-level `resume` domain check) unchanged.
