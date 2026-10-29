# IMP-H7-S3b — Stock permit lines import wizard (UI)

**Branch:** `claude/imp-h7-s3b-stock-permit-wizard`. **Web only:** no backend, migration, permission, env or ZATCA change. **No journal entries** — the wizard drives the backend of IMP-H7-S3a (#1727, `efdc5db`), which creates a **draft** permit through `StockPermitService::create`: no stock movement, no journal entry, no balance change at import. Posting stays the existing action on the permit page (verified in the S3a report: an imported receipt of 5 × 12.50 SAR posts Dr 1140 6,250 / Cr 5180 6,250 halalas through the existing flow).

## What it adds
- Route `/stock-permits/import` and an «Import from file» action (secondary) on the stock permits list.
- `StockPermitImportWizard` for the `stock_permit_import` domain (atomic `UNIT_FILE`, preview-bound only): **header** (type · warehouse · destination for a transfer · date · reason · notes · zero-cost switch for a receipt) → **file + column mapping** → **preview** (no writes) → durable bound job → **result** with a link to the new draft permit.
- **The header is frozen with the preview.** The server requires type and warehouse even for `inspect`, so the file input is disabled until the header is valid (transfer: a distinct destination). Any header change drops the job and preview.
- **Date freezing:** an empty date is not sent; the server resolves «today» at preview. The job options carry the **preview's resolved date**, so the options fingerprint matches the preview's across midnight.
- **Destination / zero-cost only where they apply:** the destination is sent for a transfer only and zero-cost for a receipt only (the server rejects the destination for other types); changing the type clears the dependants.
- **Mapping guard mirrors the server:** an identifier (`product_id`/`sku`/`barcode`, a name is not one) + quantity; no field twice; the cost column belongs to a receipt only — it is **auto-ignored** for issue/transfer (the shared template has a cost column) and blocks if re-mapped; a receipt with no cost column needs the explicit zero-cost switch.
- Preview: header summary (type, warehouse names, resolved date), counters (lines · warnings · errors · receipt total cost), a row table (product, quantity, unit, cost columns on a receipt only, per-row status with messages/warnings), formula-safe error CSV. Costs shown in riyals from halalas in the display layer only.
- Hardening carried from the other atomic wizards: stale job never re-applied, creation failure returns to the preview with the error visible, apply disabled once the preview's job ended, foreign-domain job refused, unbound job refused, stepper cannot jump to a missing preview, explicit continue for a stopped job, idempotency key derived from the single-use preview.
- ar/en `stockPermitImport` block (95 keys, parity scripted: 0 differences) + `stockPermits.import_from_file`.

## Tests
`contract.test.ts` 7 + `StockPermitImportWizard.test.tsx` 11 (18 total). Mutation controls — each fails a test when applied: file input not disabled without a header · job options using the empty field instead of the preview date · foreign-domain guard removed · type change not adapting the mapping · resume button not requiring a bound job · inspection response mapped with the type captured at send time (Codex P2).

**Disclosed test limit:** removing `invalidatePreview()` from header changes survives the suite. It is unobservable for the reason documented in H4-S6b: after «back to setup» the stepper cannot move forward again and `runPreview()` replaces the preview itself. The call stays as defence in depth; the retained test asserts what is observable (the changed header is what the next preview and job freeze).

## Not done / follow-ups
- Component tests only; no screenshots. The row table shows the first 10 rows (collapsed) of the 200-row server preview window.
- No duplicate guard and no stock-availability check at import (disclosed in S3a): availability is validated at posting by the existing flow.
- Product variants stay excluded (S3a contract).
