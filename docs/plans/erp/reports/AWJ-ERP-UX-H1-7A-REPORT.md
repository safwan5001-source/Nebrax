# AWJ-ERP-UX-H1-7A — Missing numbering-settings labels — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-008 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md)

## Outcome
The document-type selector on `/numbering-settings` labels every type the server returns. Added AR/EN labels for `delivery_note` (سند تسليم / Delivery note), `commerce_order` (طلب متجر إلكتروني / Online store order), `supplier_refund` (استرداد مورد / Supplier refund), `customer_refund` (استرداد عميل / Customer refund), `pos_investigation_case` (قضية تدقيق نقطة بيع / POS investigation case).

## Root cause
The page renders `t(\`entity_${key}\`)` for each entity from the API; five entities in `app/Support/DocumentNumberingCatalog.php` had no catalog entry in either language, so next-intl logged `MISSING_MESSAGE` and rendered the raw key.

## Changed files
- `web/src/messages/{ar,en}.json` (5 keys each, placed next to related entities)
- `web/src/app/(app)/numbering-settings/entity-labels.test.ts` (new guard)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-7A-REPORT.md`

## Tests and exact results
- Guard test reads the server catalog (`DocumentNumberingCatalog.php`) and asserts an AR and EN label for every entity key. **Without the fix: 2 failed / 1 passed. With the fix: 3 passed.** It will fail again if a new numbering entity is added without labels.
- Full Vitest on the final tree: recorded in the PR.
- Real browser: `MISSING_MESSAGE` console errors on `/numbering-settings` 10 → **0** (AR and EN).

## Self-review / Guardian
Labels only; numbering logic, prefixes and series untouched (no change to `GeneratesDocumentNumbers` or the catalog).

## Recommended next task
H1-7B (heading order and remaining P3 items).
