# Reports Saved Views Coverage Audit

## Scope

Audit of the existing report-table consumers after PR #539. The goal is to verify stable Saved Views coverage without forcing specialized financial presentations into the generic report grid.

## Findings

- Sales tabular reports already use stable `reportKey` values in the form `sales:<view>`.
- Purchase tabular reports already use stable `reportKey` values in the form `purchases:<view>`.
- Customer tabular reports already use stable `reportKey` values in the form `customers:<view>`.
- Inventory tabular reports already use stable `reportKey` values in the form `inventory:<view>`.
- Account Ledger already owns a stable Saved Views key: `general:account-ledger`.
- Journal Entries intentionally remain a grouped specialized table because entry-to-lines grouping and entry drill-down are semantic parts of the report; converting it only to gain Saved Views would be a risky presentation regression.
- Cash Flow is a structured financial statement, not a generic tabular result report.
- Tax Report is a compact financial summary card, not a generic tabular result report.

## Decision

No functional code change is required for Saved Views coverage. Existing generic report tables already have stable persistence keys where appropriate. Specialized financial reports should remain specialized rather than being forced into `ReportDataTable` solely for feature parity.

## Next Gap

Proceed to report state hardening: normalize loading / empty / no-results / error behavior and prevent stale report payloads when filters change quickly, starting with the sales reports workspace because it does not currently use the request-generation guard already present in customer, purchase, inventory, and general report workspaces.
