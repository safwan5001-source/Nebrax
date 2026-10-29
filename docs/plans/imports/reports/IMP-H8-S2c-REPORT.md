# IMP-H8-S2c — Saved mapping presets on the products, workbook and opening-balance import pages (UI)

**Branch:** `claude/imp-h8-s2c-presets-pages`. **Web only** — reuses `MappingPresetBar` (S2b, #1798) and the S2a API (#1796). No backend, migration, permission, env or ZATCA change. **No journal entries** — a preset stores header texts and field keys only.

## What it adds
The same bar, mounted in the mapping card of the three import **pages** that hold their mapping state themselves rather than through a module wizard: products V2 (`product_catalog`), the multi-sheet product workbook (`product_workbook`, the Products sheet's columns), and inventory opening balances (`inventory_opening`). With this, every import screen that has a column-mapping step offers saved mappings.

Each page passes `applyPresetMapping`, which sets the mapping and drops the preview exactly as that page's own `updateMapping` does (the workbook page also invalidates its in-flight preview request). The bar's stale-response guard (S2b) applies unchanged.

## Tests
`mapping-presets-wiring.test.ts` now covers the three pages as well (11 cases): the bar's domain equals the page's `useImportJobEngine` domain, `onApply={applyPresetMapping}`, and the function sets the mapping **and** drops the preview. Mutation controls fail tests when applied: a wrong domain on a page · `applyPresetMapping` not dropping the preview. One existing workbook test selector was narrowed: it asserted no «apply» button after a stale preview, and the bar's own (disabled) «apply» button now carries the same label — the assertion now looks for an **enabled** apply button, which is what it always meant.

## Not done
- Rename of a preset, per-user presets (company-wide by design).
- Component tests only; no screenshots.
