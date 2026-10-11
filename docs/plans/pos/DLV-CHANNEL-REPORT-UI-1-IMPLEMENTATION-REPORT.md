# DLV-CHANNEL-REPORT-UI-1 — implementation report

**Task:** `DLV-CHANNEL-REPORT-UI-1`
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `82616b0b8ee217603339c7993b4aa4c296a49070` (API PR #1305 merge)
**Design:** `docs/plans/pos/DLV-CHANNEL-REPORT-1-EVIDENCE-DESIGN.md`
**API:** `GET /api/reports/delivery-channel`
**Nature:** RTL report screen and scoped CSV. No schema, posting, VAT, Hub count, connector, or commission.

## What was implemented

A sales-catalog screen at `/reports/sales/delivery-channel`.

It reads only the merged delivery-channel report. Amounts on the screen are the strings the API already converted to riyals. The page does not recompute VAT, discounts, net sales, or net after POS returns. Credit-note count and total stay in a separate section and are not subtracted from metric 9.

Platform comparison rows stay separate by `delivery_platform_profile_id`. The visible label is `platform_key`, not a mutable display name. Pinned `display_name` / `display_name_en` appear only on the invoice drill-down.

Filters sent to the API are `from`, `to`, `branch_id[]`, and `delivery_platform_profile_id`. Branch behavior is the existing `ReportFilters` control, which leaves an omitted branch list for `ReportBranchScope` to resolve. The platform list is taken from an authorized report response for the same date and branch scope, not from `/delivery-platforms`, because that route also requires the POS application.

Invoice, return, and credit-note numbers link to the existing document routes only when the caller has `invoices.view` or `returns.view`. Without that permission the report still shows the rows the report API returned. `reports.view` is required before any request. A 403 from the API is the same forbidden state.

CSV is built from that same scoped payload. `formulaSafeCsv` prefixes a user-controlled string when, after leading spaces, it starts with `=`, `+`, `-`, `@`, tab, or carriage return, then calls the existing `toCsv` for delimiter escaping. A plain number, including `-10.50`, is not prefixed. `web/src/lib/export.ts` is unchanged. Stored references are unchanged. The on-screen reference stays raw.

Hub orders are not rendered. The API does not return a Hub count, and this slice does not call the Hub list.

## Files

- `web/src/lib/csv-formula.ts`
- `web/src/lib/delivery-channel-report.ts`
- `web/src/components/reports/delivery-channel-report-workspace.tsx`
- `web/src/components/reports/report-catalog.tsx`
- `web/src/app/(app)/reports/sales/delivery-channel/page.tsx`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`
- `web/src/lib/__tests__/csv-formula.test.ts`
- `web/src/lib/__tests__/delivery-channel-report.test.ts`
- `web/src/lib/__tests__/delivery-channel-report.fixture.ts`
- `web/src/components/reports/delivery-channel-report-workspace.test.tsx`
- `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (status pointer only)

No PHP, schema, posting, or shared exporter change.

## API contract used

`summary` for metrics 1–5, 6, 8, and 9. `credit_notes.count` and `credit_notes.total` for metric 7. `platforms[]` for comparison. `invoices`, `returns`, and `credit_notes.rows` for drill-down. `collection` is shown as a split of metric 5, including `unclassified_total`, and is not added to the total. `exceptions` are counts only.

`scope.source` must be `posted_pos_delivery_invoices`. A payload that fails the money or count contract is an incomplete state, not a zero report. Extra keys, including a Hub list, are ignored.

## Visual evidence

No authenticated browser screenshot was captured in this sandbox. The workspace test renders the screen in `dir="rtl"` and `dir="ltr"`, checks theme tokens (`bg-surface`, no `bg-white`), and checks the existing report table's mobile cards (`.md:hidden`) and desktop overflow (`.overflow-auto`).

## Tests

Focused Vitest:

- metric labels map to API summary fields
- VAT and net-after-returns are not recomputed; credit notes stay separate
- query parameters for date, branch, and profile id
- comparison identity is the profile id
- empty, loading, error, incomplete, and missing `reports.view`
- API 403
- document links follow `invoices.view` and `returns.view`
- CSV formula cases `=1+1`, `+1`, `-2+3`, `@SUM(A1)`, tab, CR, leading space, and pinned names
- `-10.50` and `-0.25` stay unprefixed numbers
- a late response from another tenant or an older filter is dropped
- a Hub row on the payload does not appear

## Build and CI

Local focused tests passed before the PR. Web CI (`npm test`, `npm run build`) and the repository PHP CI both run on this pull request. This file does not stamp those runs. Do not merge from this file.

## Review

### Implementer

- Headline figures are copied from `summary` and `credit_notes`.
- Metric 9 is not reduced by metric 7.
- Grouping key is `delivery_platform_profile_id`.
- Formula neutralization happens before `toCsv` and only on this export path.

### Independent pass

- No Hub join and no Hub count panel.
- No commission, settlement, or combined-net field.
- Screen text for an external reference is the stored value; only the CSV cell is prefixed.
- Forbidden users do not receive a report request.

### Guardian

| Risk | Result |
|---|---|
| Frontend recomputes VAT | Not done |
| Credit note subtracted twice | Separate section; metric 9 is the API field |
| Hub order shown as an invoice | Not rendered |
| CSV formula in a reference or pinned name | Prefixed at export |
| Negative money turned into text | Plain numeric pattern is not prefixed |
| Shared exporter behavior changed | `export.ts` untouched |
| Cross-tenant cache | In-flight responses are dropped when the tenant changes |
| Unauthorized document route | Link requires the existing view permission |

## Remaining

- Hub operational count: `DLV-CHANNEL-REPORT-HUB-COUNT-1`, only if the owner wants that separate read. This screen must keep it out of the money metrics.
- Combined net, commissions, settlements, imported posting, and native connectors stay blocked.
- `PRE_MERGE_REVIEW` waits for exact-head CI. Do not merge from this file.

## Branch

Recorded on the pull request after push. Base is `82616b0b8ee217603339c7993b4aa4c296a49070`.
