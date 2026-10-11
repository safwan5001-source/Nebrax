# DLV-CHANNEL-REPORT-API-1 — implementation report

**Task:** `DLV-CHANNEL-REPORT-API-1`
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `896516f1d954184b619603d3150d23794ad01e69` (PR #1302 merge)
**Design:** `docs/plans/pos/DLV-CHANNEL-REPORT-1-EVIDENCE-DESIGN.md`
**Nature:** read-only reporting API. No schema, posting, VAT, Hub join, CSV, connector, or UI.

## What was implemented

`GET /api/reports/delivery-channel` behind the existing `reports.view` middleware, in the same route group as `GET /api/reports/sales`.

The service is `App\Services\Reporting\DeliveryChannelReportService`. Amounts stay integer halalas until `DeliveryChannelReportController` calls `Money::toRiyal`. Counts stay integers.

`SalesReportService` was not extended. The session report was not called for a date range. `delivery_hub_orders` is not queried.

## Response contract

Filters: `from`, `to` (optional, `to` must be on or after `from`), `branch_id[]`, `delivery_platform_profile_id`. No status toggle and no `payment_status` filter.

`metrics` is numbered 1 through 9, matching the design:

| # | Key | Rule |
|---|---|---|
| 1 | `gross_sales` | `SUM(invoice_lines.line_subtotal)` |
| 2 | `discounts` | line discounts + `invoices.discount` |
| 3 | `net_sales` | `SUM(subtotal - discount + shipping + adjustment)` |
| 4 | `vat` | `SUM(invoices.tax_amount)` |
| 5 | `total` | `SUM(invoices.total)` |
| 6 | `posted_invoices` | count of the sales population |
| 7 | `credit_notes` | distinct posted sales notes, separate from 5 and 9 |
| 8 | `pos_returns` | stored return `subtotal`, `tax_amount`, `total` |
| 9 | `net_after_pos_returns` | metric 5 − metric 8 `total` |

Metric 10 (Hub) is absent. A combined net of returns plus credit notes is absent.

`summary` repeats the named money fields plus `shipping` and `adjustment` so the identity can be checked. `collection` splits metric 5 into `platform_collected` and `merchant_collected`. `unclassified_total` is the residual `metric 5 − those two parts`. It is not a new KPI. For the two stored modes it is zero, so the design identity holds. A third stored mode would stay inside metric 5 and show up here instead of being guessed into a mode.

`platforms` is one row per `delivery_platform_profile_id`, labelled by `platform_key`, with metrics 1–6 and 8–9 plus the collection split. Credit notes are `credit_notes.by_platform` and `credit_notes.rows`, not a reduction of the comparison row.

Drill-down: `invoices` (sales population only, pinned version `display_name` / `display_name_en` / `logo_asset_key`, raw `external_order_reference`), `returns` (`return_date`, source invoice number, source platform), and credit-note rows (`note_date`, source platform).

`exceptions.context_branch_mismatch` counts a posted POS sale whose context tenant matches but whose context branch does not. `exceptions.credit_note_partner_mismatch` counts a posted sales note in range whose source is in the attribution set and whose `partner_id` differs. Neither amount enters a money metric.

`scope.branch_ids` is the resolved `ReportBranchScope` (null when the caller is unrestricted and requested nothing).

## Population

Sales population: `status = posted`, `type = sale`, `pos_session_id` not null, `invoice_date` in range when a bound is present, and one `delivery_invoice_contexts` row with the same `invoice_id` and `tenant_id`, and the same branch on both sides. Branch equality is null-safe: both `branch_id` values null is a match, because `DeliveryInvoiceContext` copies the invoice branch and SQL `NULL = NULL` is unknown. One side null is a context-branch exception, not a sale. Optional profile filter uses `delivery_platform_profile_id`. Branch filter is `ReportBranchScope` on `invoices.branch_id`; a null invoice branch is outside a restricted user's allowed set.

Attribution set: the same invoice rule with no `invoice_date` predicate. Returns use `return_documents.return_date`. Credit notes use `credit_notes.note_date`. Source documents must be in the attribution set. `original_type` is `App\Models\Invoice` (`Invoice::class`), which is the value `PosReturnService` stores. The design's word "Invoice" is that morph, not the literal string `Invoice`.

A return or credit note is included only when its own `branch_id` and the source invoice branch are both inside `ReportBranchScope`. Notes require `type = sales`, `status = posted`, a non-null `original_invoice_id`, and `partner_id` equal to the source invoice. Header sums are not joined to lines, so two lines cannot double an invoice total. `invoice_id` on the context table is unique.

Draft, cancelled, ordinary POS sales, purchase credit notes, unlinked notes, and notes outside `note_date` are excluded. VAT is the stored `tax_amount`. `total` is the stored header. Nothing is recomputed from `tax_rate`.

## Files

- `app/Services/Reporting/DeliveryChannelReportService.php`
- `app/Http/Controllers/Api/DeliveryChannelReportController.php`
- `app/Http/Requests/DeliveryChannelReportRequest.php`
- `routes/api.php` (one GET)
- `tests/Feature/DeliveryChannelReportTest.php`
- `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (status pointer only)

No migration. No change to `InvoiceService`, `ReturnService`, `CreditNoteService`, `PosService`, or `web/src/lib/export.ts`.

## Security

Tenant id comes from `TenantContext`, never from the client. Invoice, context, profile, and version predicates include that tenant. Global tenant scopes remain. Branch scope is the existing intersection rule: a restricted user who omits `branch_id`, or who requests another branch, still sees only allowed branches. `reports.view` is required. `self_service` receives 403. Invalid dates and non-uuid filters receive 422. The route does not write.

## CSV handoff

Export is `DLV-CHANNEL-REPORT-UI-1`, not this slice. `toCsv` still only escapes quotes, commas, and newlines. This API returns the stored reference unchanged, including a value such as `=1+1`. The UI slice must prefix formula-leading string cells at export time and must not rewrite the database. This report does not claim that export is already protected.

## Tests

`tests/Feature/DeliveryChannelReportTest.php` (15 tests, 260 assertions) covers posted inclusion and the stored identity, draft/cancelled exclusion, sales without context, platform grouping and the collection split, two-line non-duplication, return dates inside and outside the range, non-delivery returns, credit-note `note_date` versus invoice date, draft notes, partner mismatch, unlinked notes, purchase notes, context branch mismatch, a Hub row that shares `external_order_reference`, tenant isolation, restricted branch scope, missing `reports.view`, invalid filters, and 1–2 halala display.

Fixtures insert posted rows and call `DeliveryInvoiceContext::create` for the append-only context. They do not call `InvoiceService::post` or add a posting rule. Local POS checkout cannot run in this sandbox because `xmllint` (`--c14n11`) is not installed; that is an environment limit, not a report rule. CI installs `libxml2-utils` and runs the suite on SQLite and PostgreSQL.

## Reviews

### Implementer

- Formulas match the merged design, including shipping and adjustment in metric 3 and stored VAT in metric 4.
- Metric 9 subtracts POS return totals only.
- Metric 7 uses the attribution set, then `note_date`, and distinct note ids.
- Mismatched customers are an exception count, not a platform total.
- Comparison groups by profile id and labels `platform_key`. Drill-down reads the pinned version name.

### Independent pass

- No Hub join, no commission field, no combined-net field.
- `external_order_reference` is selected for display and is not a join key.
- Money conversion is a whitelist. Counts are not passed through `Money::toRiyal`.
- Forbidden branch requests follow `ReportBranchScope` instead of a new 403 that would change the existing report rule.

### Guardian

| Risk | Result |
|---|---|
| Hub counted as revenue | Not queried |
| Draft or cancelled counted | Status locked to `posted` |
| VAT added twice | `tax_amount` and `total` are stored parts |
| Credit note subtracted twice | Metric 7 is separate from metric 9 |
| Credit note tied to another customer | Excluded; posting unchanged |
| CSV formula | Not this slice; stored value unchanged |
| Cross-tenant or cross-branch context | Tenant and branch must match; scope applies to the note and the source invoice |
| New posting or VAT rule | None |

No P1 or P2 left open in this pass.

## Remaining

- UI and CSV neutralization: `DLV-CHANNEL-REPORT-UI-1`, after this API merges.
- Hub operational count: `DLV-CHANNEL-REPORT-HUB-COUNT-1`.
- Combined net, commissions, settlements, imported posting, and native connectors stay blocked.
- `original_type` is the Eloquent class name. A future morph alias would be a posting change and is out of scope.

## PRE_MERGE_REVIEW

Pending CI on the PR head. Do not merge from this file.
