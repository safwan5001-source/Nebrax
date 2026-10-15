# AWJ-ERP-UI-H2 A2 — Shared UI kit adoption per page (static, generated)

Pages traced: **221** (each `page.tsx` + its local imports, 2 levels; shared kit files themselves excluded). Excludes `platform/`, `dev/`, `document-qa`.

| Pattern | Pages using it |
|---|---|
| `PageHeader` | 51 |
| `ListToolbar` | 35 |
| `DataTable` | 49 |
| `raw<table>` | 58 |
| `ui/Table` | 24 |
| `Pagination` | 35 |
| `EmptyState` | 22 |
| `ErrorState` | 22 |
| `LoadingState` | 28 |
| `Skeleton` | 85 |
| `FormPage` | 8 |
| `FormSection` | 8 |
| `DetailPage` | 5 |
| `ConfirmDialog` | 2 |
| `window.confirm` | 16 |
| `MobileRecord` | 0 |
| `DocumentWorkspace` | 4 |
| `rawHex` | 10 |
| `text<12px` | 55 |

| Page | PageHeader | ListToolbar | DataTable | raw<table> | ui/Table | Pagination | EmptyState | ErrorState | LoadingState | Skeleton | FormPage | FormSection | DetailPage | ConfirmDialog | window.confirm | MobileRecord | DocumentWorkspace | rawHex | text<12px |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `(app)/accounting-settings` |  |  |  |  |  |  | 1 |  | 1 |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/accounting-settings/account-routing` |  |  |  |  |  |  | 1 |  | 2 |  |  |  |  |  |  |  |  |  |  |
| `(app)/accounting-settings/fiscal-years` |  |  |  |  | 1 |  | 2 |  | 4 |  |  |  |  |  |  |  |  |  |  |
| `(app)/accounting-settings/period-locks` |  |  |  |  | 1 |  | 2 |  | 3 |  |  |  |  |  |  |  |  |  |  |
| `(app)/accounts` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  | 4 |
| `(app)/applications` | 2 |  |  |  |  |  | 1 | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| `(app)/appointments` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/assets` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/assets/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/branches` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/branches/[id]` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/branches/new` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/branches/settings` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/cash-and-bank` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/cash-and-bank/[id]` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/cash-and-bank/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/cash-and-bank/transfer` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/contacts` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/cost-centers` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/credit-notes` |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/credit-notes/[id]` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  | 7 |
| `(app)/credit-notes/new` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/crm` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/customer-refunds` | 1 |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/customer-refunds/[id]` |  |  |  | 1 |  |  |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| `(app)/customer-settings` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/dashboard` |  |  |  |  | 1 |  |  |  |  | 8 |  |  |  |  |  |  |  |  | 7 |
| `(app)/debit-notes` |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/debit-notes/new` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/delivery-hub` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/delivery-notes` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/delivery-notes/[id]` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/delivery-notes/[id]/edit` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/delivery-notes/invoice-draft` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/delivery-notes/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/delivery-platforms` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/document-design` |  |  |  | 2 |  |  |  |  |  | 6 |  |  |  |  |  |  |  | 19 | 3 |
| `(app)/documents` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/documents/[id]` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/documents/[id]/diagnostics` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/documents/governance` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/documents/operations` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/documents/settings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/documents/usage` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/employee-custodies` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/employee-custodies/[id]` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/employee-custodies/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/expenses` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/expenses/[id]` |  |  |  |  |  |  |  | 1 | 1 |  |  |  | 1 |  |  |  |  |  |  |
| `(app)/expenses/categories` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/expenses/new` |  |  |  |  |  |  |  |  |  |  | 1 | 3 |  |  |  |  |  |  |  |
| `(app)/finance-settings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/finance-settings/financial-alerts` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/finance-settings/settlement-types` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/financial-alerts` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/help` | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 2 |
| `(app)/help/[slug]` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/hr` |  |  | 9 |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/hr/employees/[id]` |  |  |  |  | 3 |  |  |  |  | 3 |  |  |  |  |  |  |  |  | 8 |
| `(app)/integrations` |  |  |  |  |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(app)/integrations/communications` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/integrations/delivery-platforms` |  |  |  |  | 1 |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/integrations/delivery-platforms/[platformKey]` |  |  |  |  |  |  |  |  |  | 4 |  |  |  |  |  |  |  |  |  |
| `(app)/inventory` |  | 1 | 1 |  | 1 | 1 |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/inventory-openings` | 1 |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/inventory-openings/[id]` |  |  |  | 1 |  |  | 1 |  | 1 |  |  |  |  |  |  |  |  |  |  |
| `(app)/inventory-openings/import` |  |  |  | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/inventory-settings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/inventory-settings/brands` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/inventory-settings/categories` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 1 | 1 |
| `(app)/inventory-settings/products` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/inventory-settings/units` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/invoices` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/invoices/[id]` |  |  |  | 5 |  |  | 1 |  |  | 13 |  |  |  |  |  |  | 9 |  | 7 |
| `(app)/invoices/[id]/edit` |  |  |  | 1 |  |  |  |  |  | 1 | 1 | 6 |  |  |  |  | 10 |  | 10 |
| `(app)/invoices/[id]/payments/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/invoices/new` |  |  |  | 1 |  |  |  |  |  | 1 | 1 | 6 |  |  |  |  | 10 |  | 10 |
| `(app)/journal-entries` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/journal-entries/[id]` |  |  |  | 1 |  |  |  | 1 | 1 |  |  |  | 1 |  |  |  |  |  | 3 |
| `(app)/manual-journals` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/manual-journals/[id]` |  |  |  | 1 |  |  |  | 1 | 1 |  |  |  | 1 |  |  |  |  |  | 3 |
| `(app)/manual-journals/new` |  |  |  |  |  |  |  |  |  |  | 1 | 2 |  |  |  |  |  |  |  |
| `(app)/notifications` | 1 |  | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/numbering-settings` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/partners` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/partners/[id]` |  |  |  | 2 | 1 |  |  |  |  | 5 |  |  |  |  |  |  |  |  | 6 |
| `(app)/partners/[id]/edit` |  |  |  |  |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  | 4 |
| `(app)/partners/[id]/statement` |  |  |  | 1 | 1 |  |  |  |  | 3 |  |  |  |  |  |  |  |  | 2 |
| `(app)/partners/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 4 |
| `(app)/payment-methods` |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/payments` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/payments/[id]` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  | 7 |
| `(app)/payments/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/pos/audit` |  |  | 6 | 1 |  | 4 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/pos/report` |  |  |  |  | 1 |  |  |  |  | 4 |  |  |  |  |  |  |  |  | 1 |
| `(app)/pos/sessions` |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/pos/sessions/[id]` |  |  |  | 2 |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(app)/pos/settings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/pos/settings/cash-drawer` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/pos/settings/configuration` |  |  |  |  |  |  |  |  |  | 1 |  | 7 |  |  |  |  |  |  |  |
| `(app)/pos/settings/printing` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/pos/settings/shifts` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/pos/settings/sound-feedback` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/pos/start` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/products` | 1 | 1 | 1 | 1 |  | 1 |  |  |  | 2 |  |  |  |  | 2 |  |  |  | 1 |
| `(app)/products/[id]` |  |  | 2 | 1 | 1 |  |  |  |  | 4 |  |  |  |  | 8 |  |  | 1 | 3 |
| `(app)/products/[id]/edit` |  |  |  |  | 1 |  |  |  |  | 2 |  |  |  |  | 2 |  |  |  | 3 |
| `(app)/products/import` |  |  |  | 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/products/new` |  |  | 2 | 1 |  |  |  |  |  | 2 |  |  |  |  | 6 |  |  | 1 | 3 |
| `(app)/products/workbook-import` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/purchase-orders` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-orders/[id]` |  |  |  | 1 |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-orders/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-quotes` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-quotes/[id]` |  |  |  | 1 |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-quotes/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-requests` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-requests/[id]` |  |  |  | 1 |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-requests/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-returns` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchase-settings` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/purchases` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchases/[id]` |  |  |  | 6 |  |  | 1 |  |  | 11 |  |  |  |  |  |  | 9 |  | 10 |
| `(app)/purchases/[id]/edit` |  |  |  | 1 |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 5 |
| `(app)/purchases/[id]/payments/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/purchases/new` |  |  |  | 1 |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 5 |
| `(app)/quotes` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/quotes/[id]` |  |  |  |  |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  | 7 |
| `(app)/quotes/new` |  |  |  | 1 |  |  |  |  |  | 2 |  |  |  |  | 1 |  |  |  | 1 |
| `(app)/receipt-vouchers` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/receipt-vouchers/[id]` |  |  |  |  |  |  |  | 1 | 1 |  |  |  | 1 |  |  |  |  |  |  |
| `(app)/receipt-vouchers/new` |  |  |  |  |  |  |  |  |  |  | 1 | 1 |  |  |  |  |  |  |  |
| `(app)/recurring-invoices` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/recurring-invoices/[id]` |  |  |  |  | 1 |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/recurring-invoices/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/reports` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/reports/[category]` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/reports/classification-analytics` |  |  |  |  | 1 |  |  |  |  | 4 |  |  |  |  |  |  |  |  | 1 |
| `(app)/reports/customers/[report]` |  |  |  | 1 |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | 5 |
| `(app)/reports/customers/aging` |  |  |  | 1 | 2 |  |  |  |  | 5 |  |  |  |  |  |  |  |  | 8 |
| `(app)/reports/general/[report]` |  |  |  | 1 | 3 |  |  |  |  | 9 |  |  |  |  |  |  |  |  | 8 |
| `(app)/reports/inventory/[report]` |  |  |  | 1 |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | 5 |
| `(app)/reports/purchases/[report]` |  |  |  | 1 |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  | 6 |
| `(app)/reports/purchases/aging` |  |  |  | 1 | 2 |  |  |  |  | 5 |  |  |  |  |  |  |  |  | 8 |
| `(app)/reports/sales/[report]` |  |  |  | 1 |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | 6 |
| `(app)/reports/sales/delivery-channel` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | 2 |
| `(app)/reports/settings/classifications` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/returns` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/returns/[id]` |  |  |  | 1 | 1 |  |  |  |  | 2 |  |  |  |  |  |  |  |  | 3 |
| `(app)/rfq` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/rfq/[id]` |  |  |  | 1 |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(app)/rfq/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/roles` | 2 |  |  |  |  |  | 3 | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| `(app)/sales-settings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| `(app)/sales-settings/designs` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/sales-settings/einvoice` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/sales-settings/fields` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 1 |  |
| `(app)/sales-settings/invoices` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/sales-settings/orders` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/sales-settings/pricelists` |  |  |  | 1 |  |  |  |  |  | 2 |  |  |  |  | 2 |  |  |  |  |
| `(app)/sales-settings/quotes` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/sales-settings/shipping` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 1 |  |
| `(app)/sales-settings/sources` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 1 |  |
| `(app)/sales-settings/statuses` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  | 1 |  |
| `(app)/settings` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  | 1 |
| `(app)/stock-permits` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/stock-permits/[id]` |  |  |  | 1 |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/stock-permits/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/stocktaking` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/stocktaking/[id]` |  |  |  | 1 |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(app)/stocktaking/new` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/supplier-payments` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/supplier-refunds` | 1 |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/supplier-refunds/[id]` |  |  |  | 1 |  |  |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| `(app)/suppliers` |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/suppliers/[id]/ledger` |  |  |  | 1 | 1 |  |  |  |  | 3 |  |  |  |  |  |  |  |  | 6 |
| `(app)/suppliers/[id]/statement` |  |  |  | 1 | 1 |  |  |  |  | 3 |  |  |  |  |  |  |  |  | 2 |
| `(app)/tax-settings` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(app)/users` | 2 | 1 | 1 |  |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/warehouses` | 1 | 1 | 1 |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/warehouses/[id]` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | 3 |
| `(app)/warehouses/[id]/stock` |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(app)/warehouses/new` |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  | 3 |
| `(app)/whats-new` | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `(commerce)/app-builder` | 2 |  |  |  |  |  | 1 | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| `(commerce)/app-builder/[id]` |  |  |  |  |  |  |  | 1 | 1 |  |  |  | 1 |  |  |  |  |  |  |
| `(commerce)/app-builder/[id]/builder` |  |  |  |  |  |  |  | 1 | 1 |  |  |  |  |  |  |  |  | 21 | 18 |
| `(commerce)/app-builder/[id]/versions` |  |  |  |  |  |  |  | 1 | 1 |  |  |  |  |  |  |  |  |  |  |
| `(commerce)/app-builder/new` |  |  |  |  |  |  |  |  |  |  | 1 | 3 |  |  |  |  |  |  |  |
| `(commerce)/commerce` | 2 |  |  |  |  |  | 3 | 3 | 4 |  |  |  |  |  | 1 |  |  |  |  |
| `(commerce)/commerce/appearance` |  |  |  |  |  |  | 1 | 1 | 1 |  |  |  |  |  | 6 |  |  |  | 8 |
| `(commerce)/commerce/delivery` | 1 |  |  |  |  |  | 7 | 4 | 5 |  |  |  |  | 2 | 1 |  |  |  |  |
| `(commerce)/commerce/domains` | 1 |  |  |  | 1 |  | 2 | 2 | 2 |  |  |  |  |  | 1 |  |  |  | 1 |
| `(commerce)/commerce/gifting` | 1 |  |  |  |  |  | 4 | 3 | 4 |  |  |  |  |  |  |  |  |  |  |
| `(commerce)/commerce/integrations` | 1 |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |  |  |  |
| `(commerce)/commerce/merchandising` | 1 |  |  |  |  |  | 3 | 5 | 5 |  |  |  |  | 4 |  |  |  | 2 | 1 |
| `(commerce)/commerce/onboarding` | 1 |  |  |  |  |  | 4 | 5 | 5 |  |  |  |  |  | 1 |  |  |  |  |
| `(commerce)/commerce/published-products` | 1 |  |  |  | 1 | 1 | 1 | 1 | 1 |  |  |  |  |  | 1 |  |  |  |  |
| `(commerce)/commerce/stores` | 1 |  |  |  | 1 |  | 1 | 1 | 1 |  |  |  |  |  | 1 |  |  |  |  |
| `(commerce)/commerce/themes` | 1 |  |  |  |  |  |  |  |  |  |  |  |  |  | 1 |  |  |  |  |
| `(fuel)/fuel-stations` | 1 |  |  |  |  |  | 1 | 1 | 1 | 1 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/alerts` |  |  |  |  |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/avi-rfid` |  |  | 2 |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/corporate-contracts` |  |  | 1 |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/maintenance` |  |  |  | 1 |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/master-data` |  |  |  | 1 |  |  |  |  | 1 | 1 |  | 6 |  |  | 1 |  |  |  |  |
| `(fuel)/fuel-stations/readiness` |  |  |  |  |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/receiving` |  |  |  | 2 |  |  |  |  |  | 1 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/safety` |  |  |  | 1 |  |  |  |  |  | 3 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/sales` |  |  | 1 |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/settings` |  |  |  |  |  |  |  |  |  | 4 |  |  |  |  |  |  |  |  |  |
| `(fuel)/fuel-stations/shifts` |  |  | 1 |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `(pos)/pos` |  |  |  |  | 2 |  |  |  |  | 6 |  |  |  |  | 1 |  |  |  | 32 |
| `.` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `auth/handoff` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `forgot-password` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `login` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `me` |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  |  |  |  |  |  |
| `register` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `reset-password` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `verify-email` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
