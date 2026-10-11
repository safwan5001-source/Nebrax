# DLV-CHANNEL-REPORT-1 — POS delivery-channel sales report

**Task:** `DLV-CHANNEL-REPORT-1`
**Nature:** evidence and design only. No API, UI, migration, posting, VAT change, or provider enablement.
**Repository:** `safwan5001-source/Nebrax`
**Base SHA (`origin/main` at start):** `999e06c52cd9e7dba3d8e16b3be00fc8d9ad9fa0`
**Confirmed ancestor:** PR #1293 merge `aff051717097225a9fccecda00912b30a72f1854`
**Verification date:** 2026-10-11
**PRE_MERGE_REVIEW:** not stamped in this file.

This document does not authorize implementation, merge, or deploy.

## 1. Conclusion

A delivery-platform sales report can be built from posted POS invoices that already carry `DeliveryInvoiceContext`. It must not be built from Delivery Hub rows, payments, or draft documents.

The existing session close report already attributes posted POS invoices to a pinned platform profile and version. It is session-scoped, uses `invoices.total` only, and does not subtract returns. The company date-range report reuses that attribution join. It does not replace the Z report and does not change posting.

Stored invoice headers are tax-exclusive net plus VAT. `invoices.total` is the tax-inclusive customer total. Adding VAT again in the UI would double-count tax.

| Metric | State |
|---|---|
| Gross sales (tax-exclusive, before discounts) | READY |
| Discounts (line + header) | READY |
| Net sales before VAT | READY |
| VAT | READY |
| Total sales including VAT | READY |
| Posted invoice count | READY |
| Credit-note count and amount | READY only as a separate block |
| POS return amount | READY |
| Net sales after POS returns | READY |
| Net after returns and credit notes combined | BLOCKED |
| Operational Hub order count | READY as a separate count, not a sale |
| Commission, settlement, fee VAT | BLOCKED |

No Decision Packet is required. The blocked combined-net figure is fail-closed, not estimated.

## 2. What was verified

Base `999e06c` includes the #1293 documentation merge and `AWJ-TAX-REM-01` (#1291). Return amounts on this SHA are re-derived from the source document lines at post time.

| Fact | Evidence |
|---|---|
| POS checkout writes `invoices.pos_session_id` and `type = sale`, then posts the invoice | `PosService` checkout; `InvoiceService::create` sets `type` to `sale` |
| Platform choice does not change the price list | `PosService` comment and call order: price list resolves before the platform |
| Attribution is one append-only row per invoice | `delivery_invoice_contexts.invoice_id` unique; `DeliveryInvoiceContext` |
| Collection mode is derived, not taken from the client | `DeliveryInvoiceContext` saving hook |
| `platform_collected` invoice is still a POS invoice; its clearing payment has no `pos_session_id` | `PosService` posts `method=bank` without `pos_session_id` |
| Session channel block uses the same posted invoices, then the context | `PosSessionService::deliveryPlatformSalesReport` |
| Hub rows have no `invoice_id` | `2026_10_29_010000_create_delivery_hub_orders_table.php` |
| `external_order_reference` is not unique on either table | both migrations |
| Sales reports count `status=posted` and `type=sale` only | `SalesReportService::invoices` |
| Branch scope is requested ∩ allowed | `ReportBranchScope` |
| `reports.view` is on accountant and staff; `delivery_hub.view` is owner/admin via `*` only | `Rbac` |
| Spreadsheet export in reports is client CSV | `sales-reports-workspace.tsx` `toCsv` / `downloadCsv` |

Invoice status values are `draft`, `posted`, and `cancelled`. Only `posted` is a sale.

## 3. Accounting contract

### 3.1 Population

A row is in the financial population only when all of these hold:

- `invoices.status = posted`
- `invoices.type = sale`
- `invoices.pos_session_id` is not null
- a `delivery_invoice_contexts` row exists for that `invoice_id`
- `context.tenant_id = invoice.tenant_id`
- `context.branch_id = invoice.branch_id`

Anything else is outside the sums:

- draft or cancelled invoices
- posted POS sales with no delivery context (ordinary cash/card)
- a delivery context whose branch does not match the invoice branch
- a delivery context on an invoice with no POS session
- every Hub row

Mismatched context/invoice branch is an exception count, not a guessed platform sale.

### 3.2 Money identity

Amounts are integer halalas until the existing display edge (`Money::toRiyal`). Do not sum riyals.

`InvoiceService::applyItemsAndTotals` stores line nets after extracting VAT when `tax_inclusive` is true, and before adding VAT when it is false. Header identity is the same either way:

```text
invoices.subtotal   = sum of line nets after line discounts, before header discount, tax-exclusive
invoices.discount   = header discount only, tax-exclusive net method
line_discount       = per-line discount, tax-exclusive
invoices.tax_amount = goods VAT + shipping VAT
invoices.total      = (subtotal - discount) + shipping + tax_amount + adjustment
```

`SalesReportService::invoiceTotals` already defines:

```text
net_sales = subtotal - discount + shipping + adjustment
amount    = total
tax       = tax_amount
```

Therefore `total = net_sales + tax_amount`. The report uses that identity. It does not recalculate VAT and does not read the POS request flag as the report basis.

Shipping and adjustment are not discounts. They stay visible so the identity can be checked.

### 3.3 Metric rules

Date basis for sales is `invoices.invoice_date`, matching `SalesReportService`. That filter defines the **sales population** only. Returns and credit notes do not use it.

The **attribution set** is the same invoice rule as §3.1 with no `invoice_date` predicate: posted `type=sale`, non-null `pos_session_id`, one matching delivery context, same tenant, same branch on the context and the invoice, plus the requested platform and `ReportBranchScope`. A source invoice stays in that set when its invoice date is outside the report range.

A return uses `return_documents.return_date`. A credit note uses `credit_notes.note_date`. Both dates are period activity, not an invoice cohort. The source invoice is taken from the attribution set, then the document's own date decides whether it falls in the range. A return or credit note in a later range is still attributed to the source invoice's platform and does not change the earlier range's sales totals.

| # | Metric | Rule | Tax basis |
|---|---|---|---|
| 1 | Gross sales | `SUM(invoice_lines.line_subtotal)` for the sales population | tax-exclusive, before line and header discounts |
| 2 | Discounts | `SUM(invoice_lines.line_discount) + SUM(invoices.discount)` | tax-exclusive |
| 3 | Net sales before VAT | `SUM(subtotal - discount + shipping + adjustment)` | tax-exclusive |
| 4 | VAT | `SUM(invoices.tax_amount)` | VAT only |
| 5 | Total including VAT | `SUM(invoices.total)` | tax-inclusive |
| 6 | Posted invoices | `COUNT(*)` of the sales population | not money |
| 7 | Credit notes | posted `credit_notes` with `type = sales` whose `original_invoice_id` is in the attribution set, and whose `note_date` is inside the range. The source invoice's `invoice_date` is not a predicate. Count distinct `credit_notes.id` and `SUM(total)` | credit-note total as stored |
| 8 | POS returns | posted `return_documents` with `type = sales`, `original_type = Invoice`, `original_id` in the attribution set, and `return_date` inside the range. `SUM(total)`, `SUM(subtotal)`, `SUM(tax_amount)`, count | `total` is tax-inclusive; `subtotal` is tax-exclusive |
| 9 | Net after POS returns | metric 5 − metric 8 `total` for the same filters | tax-inclusive |
| 10 | Operational Hub orders | `COUNT(*)` of `delivery_hub_orders` in the created-at range | not money; never added to 5, 6, or 9 |

Identity check that must be tested: metric 3 + metric 4 = metric 5 for the same invoice set. Metric 1 − metric 2 + shipping + adjustment = metric 3.

`collection_mode` splits metric 5 into `platform_collected` and `merchant_collected`. Those two parts add up to metric 5. They are not a second sale. The session report already uses this split on `invoices.total`.

### 3.4 Returns and credit notes

POS checkout returns create a `ReturnDocument`, not a `CreditNote` (`PosReturnService::buildAndPostReturn`). The return copies `tax_inclusive` from the invoice and sets `original_id` / `original_type`. On this base, `ReturnService::rederiveSourceAmounts` rebuilds the return from the source lines and stores `subtotal`, `tax_amount`, and `total = subtotal + tax_amount`. The report sums those stored headers. It does not derive a new rate.

`CreditNote.original_invoice_id` is optional. Metric 7 includes a sales credit note only when that id is in the attribution set and `note_date` is inside the range. Unlinked credit notes are not platform sales and are not allocated by partner, date, or amount. A note whose source invoice is outside the sales-population dates is still included when the note's own date is in range. A note whose own date is outside the range is excluded even when the source invoice date is inside it.

Tenant and branch authorization apply to both sides. The note, the source invoice, and the context must share the current tenant. `credit_notes.branch_id` and the source `invoices.branch_id` must each pass `ReportBranchScope`. If either branch is outside the caller's allowed set, the note is excluded. That stops a visible note from publishing another branch's platform activity. `delivery_invoice_contexts.invoice_id` is unique, so one note joins at most one context and is not multiplied into the sum. The total counts distinct note ids. The same note is not also subtracted from metric 5 or metric 9, including when both the invoice date and the note date fall in the range.

`CreditNoteService::create` stores `partner_id` from the request and `original_invoice_id` separately. `CreditNoteOwnershipResolver` only checks that the invoice exists and that the note is a sales note. It does not require the same customer. A note whose `partner_id` differs from the source invoice's `partner_id` is not an adjustment of that sale. Metric 7 excludes it and the report counts it as an exception. This pass does not change credit-note posting. The stored note total is not capped to the invoice balance, because no such cap exists today; a same-customer note is still not folded into metric 9.

Nothing in the inspected services forbids both a posted sales return and a posted sales credit note against the same invoice. Adding them into one net would be an estimate. Metric 9 therefore subtracts POS returns only. A combined net is BLOCKED.

Purchase credit notes are excluded (`CreditNoteOwnershipResolver` purchase path).

### 3.5 Hub and double counting

Hub identity is `tenant + profile + provider_order_id`. It is operational. There is no foreign key to `invoices`. `external_order_reference` must be shown on a drill-down row and must not join Hub to invoices.

`intake_payload` may contain amounts. Those amounts are not sales and are not summed.

Metric 10 uses `created_at`, which is not `invoice_date`. The UI must say so. Cancelled Hub rows remain in the operational count; cancellation is not a credit note. Branch-restricted users do not see unrouted Hub rows. That visibility rule stays in the Hub query and is not reimplemented inside the financial query.

A posted POS delivery invoice with no Hub row is still a sale. A Hub row with no invoice is not a sale.

### 3.6 What this report does not do

- no commission, settlement, fee, or fee VAT
- no imported-order posting and no DG-3 tax-point selection
- no change to `InvoiceService`, `ReturnService`, `LedgerService`, or inventory
- no status other than `configured` / `disabled` for connectors
- no treatment of `payment_status` as a sale filter; an unpaid posted invoice is still a sale
- no grouping that rewrites a historical version name into the profile's current name

Comparison rows group by `delivery_platform_profile_id`. The stable label is `platform_key`. Version `display_name` and `logo_asset_key` appear on the invoice drill-down, taken from the pinned `delivery_platform_profile_version_id`, which is what the session report already does.

## 4. Data availability

| Need | Source | Available |
|---|---|---|
| Platform on a POS invoice | `delivery_invoice_contexts` | yes, one row |
| Historical name | pinned profile version | yes |
| Branch | `invoices.branch_id`, must match context | yes |
| Session | `invoices.pos_session_id` | yes for this population |
| Gross, discount, VAT, total | invoice header + `invoice_lines` | yes |
| POS return link | `return_documents.original_id` | yes |
| Credit-note link | `credit_notes.original_invoice_id` | only when set |
| Hub-to-invoice link | none | no |
| Commission / settlement | not in this population | no |

## 5. Filters and drill-down

| Filter | Rule |
|---|---|
| Date range | `invoice_date` for the sales population only; `return_date` for returns; `note_date` for credit notes; `created_at` for Hub. Returns and credit notes attribute through the attribution set, which has no invoice-date filter |
| Platform | `delivery_platform_profile_id` inside the tenant. Empty means every attribution-set invoice, not every POS sale. Credit notes inherit the platform from the source invoice |
| Branch | `ReportBranchScope` on `invoices.branch_id` for sales. A return or credit note is included only when its own `branch_id` and the source invoice's `branch_id` are both inside that scope |
| Invoice status | locked to `posted` for every KPI and for the attribution set. Draft and cancelled are not a toggle |

Drill-down columns, one row per sales-population invoice: number, `invoice_date`, branch, `platform_key`, pinned display name, `collection_mode`, external reference (label only), gross, discounts, shipping, adjustment, net before VAT, VAT, total, `pos_session_id`. A return drill-down is separate: return number, `return_date`, source invoice number, platform of that invoice, subtotal, VAT, total. A credit-note drill-down is separate and uses `note_date` plus the source invoice's platform. It is not a second copy of a sales row.

Platform comparison is one row per profile: metrics 1–6 and 8–9, plus the collection-mode split of metric 5. Credit notes are a second table. Hub is a third count with no money column.

CSV is Excel-compatible and is built from the same scoped payload as the screen. A new XLSX library is out of scope. The current shared helper is not a sufficient sanitizer. `web/src/lib/export.ts` `toCsv` writes a UTF-8 BOM and escapes a cell only when it contains `"`, a comma, or a newline. `PosService::normalizeDeliveryReference` only trims; a cashier reference that starts with `=`, `+`, `-`, or `@` is stored as-is on `delivery_invoice_contexts.external_order_reference`.

The UI slice must neutralize spreadsheet formulas at export time and must not pass raw user-controlled strings through that helper. This design pass does not change `export.ts` or the stored reference. For every exported string cell, including `external_order_reference`, pinned `display_name` / `display_name_en`, branch name, and document numbers:

- if the value, ignoring leading spaces only for the test, starts with `=`, `+`, `-`, `@`, a tab, or a carriage return, prefix one apostrophe
- then apply the existing quote and delimiter escaping to the prefixed text
- do not strip or rewrite the database value

A cell that is only an optional minus, digits, and one decimal point stays numeric, so a negative money amount is not turned into text. A value such as `-2+3` or `=1+1` does not match that numeric pattern and is prefixed. Headers are escaped the same way when they are user-controlled labels. The export still contains no other tenant.

## 6. API reuse

Do not extend `SalesReportService` views. That service has no delivery join, and its `amount` is `invoices.total` without discounts broken out. Copying a `view` onto it would hide line discounts and Hub rules inside a general sales report.

| Piece | Decision |
|---|---|
| `ReportBranchScope` | reuse |
| `SalesReportController` halala-to-riyal edge | same display rule on a new read-only controller |
| `GET /api/reports/sales` | do not overload |
| Session `deliveryPlatformSalesReport` | reuse the attribution idea only; do not call it for a date range |
| `GET /api/delivery-hub/orders` | do not use the list as a sales total |
| New `GET /api/reports/delivery-channel` | required. Middleware `reports.view` only, same group as `reports/sales`. No `sales.pos` gate, because accountants already read sales reports without a POS checkout permission |
| Hub count | separate read behind `delivery_hub.view`. If the caller lacks it, the financial report still returns. The operational panel is omitted, not a 403 for the whole screen |

The financial route must not join `delivery_hub_orders`.

## 7. UX

Reuse the reports workspace, not a new visual system:

- `ReportScreenHeader`, `ReportMetricGrid`, `ReportFilters`, `ReportDataTable`, `ReportMobileRows`
- RTL from the existing reports pages (`dir="rtl"` in the sales workspace test)
- CSV action from `sales-reports-workspace.tsx`

Layout:

1. Caption: posted POS delivery invoices only. Ordinary POS sales are excluded. Hub orders are not invoices.
2. KPI row: gross, discounts, net before VAT, VAT, total including VAT, invoice count, POS returns, net after POS returns.
3. Second, visually separate KPI: credit-note count and amount, with the sentence that they are not subtracted above.
4. Third panel: operational Hub count, or a permission-denied state when `delivery_hub.view` is absent. No amount.
5. Platform comparison table.
6. Invoice drill-down.

States: loading skeleton already used by report workspaces; empty when the population count is zero; error with retry; 403 when `reports.view` is missing. Desktop is the table. Mobile uses `ReportMobileRows` for the same rows. No new color, type, or spacing tokens.

## 8. Security invariants

- tenant scope stays on the models; no client `tenant_id`
- branch scope is `ReportBranchScope`, including the empty-filter case that forces a restricted user's branches
- a context from another tenant cannot be read by invoice id alone; the query also matches `tenant_id` and `branch_id`
- drafts and cancelled documents never enter KPI sums
- Hub payloads never enter KPI sums
- collection-mode parts are a partition of metric 5, not an addition on top of it
- no write, no post, no VAT math, no ledger line, no stock movement
- external reference is displayed and never used as a join or an authority
- CSV uses the scoped payload only, and every user-controlled string cell is formula-neutralized before delimiter escaping
- a credit note is one row in metric 7, never a second reduction of metric 5 or 9

## 9. Tests the implementation must include

SQLite and PostgreSQL, read-only:

1. Posted POS invoice with a context is included. Identity: gross − discounts + shipping + adjustment = net; net + VAT = total.
2. Draft and cancelled invoices with a context are excluded. A later post of the draft counts once.
3. Posted POS invoice without a context is excluded.
4. `platform_collected` and `merchant_collected` split metric 5 and do not increase it.
5. A sales return whose `original_id` is a delivery POS invoice reduces metric 9 and does not reduce metric 6. Its date is `return_date`.
6. A return of a non-delivery invoice is excluded.
7. A posted sales credit note whose `note_date` is inside the range and whose source invoice is in the attribution set appears only in the credit-note block. Metric 9 is unchanged. This includes a source invoice whose `invoice_date` is before the range.
8. A credit note with no `original_invoice_id`, or whose source is not a posted POS delivery invoice, is absent. A note whose `note_date` is outside the range is absent even when the source `invoice_date` is inside the range. When both dates are inside the range, the note id is counted once.
9. A credit note is excluded when the note's branch or the source invoice's branch fails `ReportBranchScope`, or when the note, invoice, and context are not the same tenant. A note whose `partner_id` differs from the source invoice's `partner_id` is an exception and is absent from metric 7.
10. A Hub row, including one that shares `external_order_reference` text with an invoice, does not change any money metric or the invoice count.
11. Another tenant's invoice and context are invisible.
12. A branch-restricted user does not see another branch, and omitting `branch_id` still limits them to allowed branches.
13. Context branch ≠ invoice branch: excluded from sums, present in the exception count.
14. Amounts in the service are halalas. The HTTP edge converts money fields only.
15. Export neutralization, in the UI slice: `=1+1`, `+1`, `-2+3`, `@SUM(A1)`, and the same prefixes on a pinned display name are written with a leading apostrophe after delimiter escaping. A money cell `-10.50` stays an unprefixed number. The stored `external_order_reference` is unchanged.

No test may call `InvoiceService::post` through a new report path. Fixtures post through the existing POS/return services, or insert posted rows the same way current report tests do, without a new posting rule.

## 10. Slices

| Slice | Scope | State after this document merges |
|---|---|---|
| `DLV-CHANNEL-REPORT-API-1` | read-only service and `GET /api/reports/delivery-channel`: metrics 1–9, comparison, drill-down, exception count. No Hub join. No writes | next implementation candidate |
| `DLV-CHANNEL-REPORT-UI-1` | RTL screen, states, CSV with formula neutralization before `toCsv`, reuse of report components. Depends on the API | not ready until the API slice is merged |
| `DLV-CHANNEL-REPORT-HUB-COUNT-1` | operational count only, `delivery_hub.view`, no amounts, no invoice join | not ready until the API slice exists; not a financial task |

`DLV-COMMISSION-1`, `DLV-SETTLEMENT-1`, `DLV-RECON-1`, `DLV-REFUND-1`, imported posting, and native connectors stay blocked. This report does not unblock them.

## 11. Reviews

### Implementer self-review

- Population is posted POS invoices with a matching context, not Hub rows and not drafts.
- Gross and discounts match stored line and header fields. VAT is `tax_amount`, not a new rate.
- Metric 9 subtracts POS return totals only. Credit notes stay separate because overlap is not disproven.
- Metric 7 uses the attribution set, then `note_date`. It does not require the source `invoice_date` to sit in the range, and it does not count one note twice.
- CSV neutralization is an export requirement. `toCsv` as it exists does not implement it, and this pass does not patch it.
- Session report behavior is cited and not reused as a date-range engine.
- No provider is enabled. No tax point is selected.

### Source-quality review

- Rules are taken from current `origin/main` services and migrations, not from the older connector branch.
- `AWJ-TAX-REM-01` is on this base, so return headers after post are the source-derived amounts.
- Hub absence of `invoice_id` was read from the create migration, not inferred.
- `web/src/lib/export.ts` escapes delimiters only. `normalizeDeliveryReference` does not strip formula prefixes. Both were read on this base.

### AWJ Guardian review

| Risk | Result |
|---|---|
| Hub order counted as revenue | Forbidden. Count only, separate permission, separate panel |
| Draft counted as a sale | Status locked to `posted` |
| VAT added twice | UI shows net and VAT and inclusive total as stored parts of one identity |
| Return and credit note added together | Combined net BLOCKED |
| Credit note dated outside the source invoice period dropped | Attribution set has no invoice-date filter; `note_date` is the period |
| One credit note counted as a sale reduction and as metric 7 | Metric 7 is separate; metric 9 subtracts returns only |
| Credit note linked to another customer's invoice | Excluded from metric 7; posting is unchanged |
| CSV formula in an external reference | Export prefixes formula-leading string cells; stored value unchanged |
| Cross-tenant or cross-branch context | Query matches tenant and branch; `ReportBranchScope` applies to the note and the source invoice |
| New posting or VAT rule | Out of scope |
| Historical platform name rewritten | Comparison uses `platform_key`; version name stays on the pinned drill-down |
| Commission invented from the invoice total | Not in the contract |

The two documentation P2 threads on credit-note dating and CSV formula prefixes are corrected in this revision. No runtime code changes, so there is no new implementation finding.

## 12. Next task

After this documentation PR is merged, and only with a separate execution authorization, the next ready task is `DLV-CHANNEL-REPORT-API-1`.

It is not ready before that merge. This file does not start it.
