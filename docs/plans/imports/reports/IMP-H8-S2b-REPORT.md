# IMP-H8-S2b — Saved mapping presets in the import wizards (UI)

**Branch:** `claude/imp-h8-s2b-presets-ui`. **Web only** — uses the S2a API (`#1796`, `1247cdf`); no backend, migration, permission, env or ZATCA change. **No journal entries** — a preset stores header texts and field keys; the bar writes nothing but that setting.

## What it adds
- **`MappingPresetBar`** (`web/src/modules/import-jobs/`), mounted inside the «column mapping» card of **eight wizards**: stock permit lines, stocktake counts, price list items, unit templates, categories/brands, purchases, expenses, customers/suppliers — each with its **own engine domain**.
- **Apply** a saved mapping to the current file: the server matches by normalized header (`POST …/match`), the client merges the result: a matched column takes the saved field (the saved binding beats the automatic suggestion), an unmatched column keeps its current mapping, a saved field the current file contract does not know is **skipped and counted** (never sent to the server), and a field is never left on two columns. A note says how many columns matched and how many did not.
- **Save** the current mapping under a name (columns stored by header, ignored columns as no field); disabled with nothing mapped. **Delete** needs an explicit second click.
- Applying a preset is a manual mapping change: the wizard drops the preview and job exactly as a hand edit does (`invalidatePreview()`).
- **Policies are not saved** and the bar says so (zero-cost, blanks, duplicate signals stay per-run choices — rule 6).
- **Fails quiet:** if the list cannot be loaded (network, no permission, unexpected contract) the bar is not shown; the import is never affected. Server refusals on save/delete (duplicate name, limit) are shown as-is.
- ar/en `mappingPresets` block (15 keys, parity scripted).

## Tests
`mapping-presets.test.ts` 6 (merge/save logic) + `MappingPresetBar.test.tsx` 7 + `mapping-presets-wiring.test.ts` 8 (each wizard's bar domain equals its `useImportJobEngine` domain, and apply drops the preview) + one behavioural wizard test (stock permit: a saved mapping rebinds by header and clears the duplicate suggestion). Mutation controls — each fails tests when applied: raw server mapping applied without the merge · delete without confirmation · unknown saved fields not skipped · duplicate suggestion not cleared · the saved binding not winning · a wrong domain on a wizard · apply not dropping the preview. (A redundant «unavailable» state was removed after a mutation showed it dead.)

## Not done / follow-ups
- **Not yet in** the products V2, product workbook and inventory-openings import **pages** (they hold mapping state differently from the engine wizards); same bar, separate slice.
- No rename of a preset (delete and save again); no per-user presets (company-wide by design).
- Component tests only; no screenshots.
