# AWJ-ERP-UI-H2 A1 — Route inventory (generated)

`page.tsx` files: **239** · in H2 scope: **228** · excluded with reason: **11** · not covered by H1: **30** · templates H1 covered via concrete paths: **8**

| Module | Pages | v3-gated | Posture |
|---|---|---|---|
| Accounting | 14 | 14 | Ledger |
| App Builder | 5 | 5 | Ledger, Studio |
| Auth / self-service | 8 | 0 | gate-excluded |
| Commerce Admin | 11 | 11 | Ledger, Studio |
| Customers | 9 | 9 | Ledger |
| Dashboard | 1 | 1 | Ledger |
| Documents | 7 | 7 | Ledger |
| EXCLUDED: internal dev/QA harness | 4 | 0 | - |
| EXCLUDED: platform (AWJ-PLATFORM-UX) | 7 | 0 | - |
| Finance | 19 | 19 | Ledger |
| Fuel | 13 | 0 | O-14 (deferred) |
| HR | 4 | 4 | Ledger |
| Inventory | 25 | 25 | Ledger |
| POS | 13 | 13 | Floor |
| Purchases | 27 | 27 | Ledger |
| Reports | 12 | 12 | Ledger |
| Sales | 40 | 40 | Ledger |
| Settings & admin | 20 | 20 | Ledger |

## Routes not covered by the H1 inventory

- `/manual-journals/:id` (Accounting)
- `/app-builder/:id` (App Builder)
- `/app-builder/:id/builder` (App Builder)
- `/app-builder/:id/versions` (App Builder)
- `/documents/:id` (Documents)
- `/documents/:id/diagnostics` (Documents)
- `/cash-and-bank/:id` (Finance)
- `/employee-custodies/:id` (Finance)
- `/expenses/:id` (Finance)
- `/receipt-vouchers/:id` (Finance)
- `/hr/employees/:id` (HR)
- `/roles` (HR)
- `/users` (HR)
- `/inventory-openings/:id` (Inventory)
- `/stock-permits/:id` (Inventory)
- `/stocktaking/:id` (Inventory)
- `/pos/sessions/:id` (POS)
- `/purchase-orders/:id` (Purchases)
- `/purchase-quotes/:id` (Purchases)
- `/purchase-requests/:id` (Purchases)
- `/rfq/:id` (Purchases)
- `/supplier-refunds/:id` (Purchases)
- `/credit-notes/:id` (Sales)
- `/customer-refunds/:id` (Sales)
- `/delivery-notes/:id` (Sales)
- `/delivery-notes/:id/edit` (Sales)
- `/quotes/:id` (Sales)
- `/recurring-invoices/:id` (Sales)
- `/returns/:id` (Sales)
- `/integrations/communications` (Settings & admin)

## Templates H1 covered through concrete paths

- `/reports/:id` (Reports)
- `/reports/customers/:id` (Reports)
- `/reports/general/:id` (Reports)
- `/reports/inventory/:id` (Reports)
- `/reports/purchases/:id` (Reports)
- `/reports/sales/:id` (Reports)
- `/help/:id` (Settings & admin)
- `/integrations/delivery-platforms/:id` (Settings & admin)

## Every page

| Route | Module | Posture | v3 gate | Source | Crawl (v3 ar-1440) |
|---|---|---|---|---|---|
| `/accounting-settings` | Accounting | Ledger | yes | `(app)/accounting-settings/page.tsx` | HTTP 200 · axe 0 |
| `/accounting-settings/account-routing` | Accounting | Ledger | yes | `(app)/accounting-settings/account-routing/page.tsx` | HTTP 200 · axe 0 |
| `/accounting-settings/fiscal-years` | Accounting | Ledger | yes | `(app)/accounting-settings/fiscal-years/page.tsx` | HTTP 200 · axe 0 |
| `/accounting-settings/period-locks` | Accounting | Ledger | yes | `(app)/accounting-settings/period-locks/page.tsx` | HTTP 200 · axe 0 |
| `/accounts` | Accounting | Ledger | yes | `(app)/accounts/page.tsx` | HTTP 200 · axe 0 |
| `/assets` | Accounting | Ledger | yes | `(app)/assets/page.tsx` | HTTP 200 · axe 0 |
| `/assets/new` | Accounting | Ledger | yes | `(app)/assets/new/page.tsx` | HTTP 200 · axe 0 |
| `/cost-centers` | Accounting | Ledger | yes | `(app)/cost-centers/page.tsx` | HTTP 200 · axe 0 |
| `/journal-entries` | Accounting | Ledger | yes | `(app)/journal-entries/page.tsx` | HTTP 200 · axe 0 |
| `/journal-entries/:id` | Accounting | Ledger | yes | `(app)/journal-entries/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/manual-journals` | Accounting | Ledger | yes | `(app)/manual-journals/page.tsx` | HTTP 200 · axe 0 |
| `/manual-journals/:id` | Accounting | Ledger | yes | `(app)/manual-journals/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/manual-journals/new` | Accounting | Ledger | yes | `(app)/manual-journals/new/page.tsx` | HTTP 200 · axe 0 |
| `/numbering-settings` | Accounting | Ledger | yes | `(app)/numbering-settings/page.tsx` | HTTP 200 · axe 0 |
| `/app-builder` | App Builder | Ledger | yes | `(commerce)/app-builder/page.tsx` | HTTP 200 · axe 0 |
| `/app-builder/:id` | App Builder | Ledger | yes | `(commerce)/app-builder/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/app-builder/:id/builder` | App Builder | Studio | yes | `(commerce)/app-builder/[id]/builder/page.tsx` | NOT LOADED (no fixture) |
| `/app-builder/:id/versions` | App Builder | Ledger | yes | `(commerce)/app-builder/[id]/versions/page.tsx` | NOT LOADED (no fixture) |
| `/app-builder/new` | App Builder | Ledger | yes | `(commerce)/app-builder/new/page.tsx` | HTTP 200 · axe 0 |
| `/` | Auth / self-service | gate-excluded | no | `/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/auth/handoff` | Auth / self-service | gate-excluded | no | `auth/handoff/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/forgot-password` | Auth / self-service | gate-excluded | no | `forgot-password/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/login` | Auth / self-service | gate-excluded | no | `login/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/me` | Auth / self-service | gate-excluded | no | `me/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/register` | Auth / self-service | gate-excluded | no | `register/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/reset-password` | Auth / self-service | gate-excluded | no | `reset-password/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/verify-email` | Auth / self-service | gate-excluded | no | `verify-email/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/commerce` | Commerce Admin | Ledger | yes | `(commerce)/commerce/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/appearance` | Commerce Admin | Studio | yes | `(commerce)/commerce/appearance/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/delivery` | Commerce Admin | Ledger | yes | `(commerce)/commerce/delivery/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/domains` | Commerce Admin | Ledger | yes | `(commerce)/commerce/domains/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/gifting` | Commerce Admin | Ledger | yes | `(commerce)/commerce/gifting/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/integrations` | Commerce Admin | Ledger | yes | `(commerce)/commerce/integrations/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/merchandising` | Commerce Admin | Ledger | yes | `(commerce)/commerce/merchandising/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/onboarding` | Commerce Admin | Ledger | yes | `(commerce)/commerce/onboarding/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/published-products` | Commerce Admin | Ledger | yes | `(commerce)/commerce/published-products/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/stores` | Commerce Admin | Ledger | yes | `(commerce)/commerce/stores/page.tsx` | HTTP 200 · axe 0 |
| `/commerce/themes` | Commerce Admin | Ledger | yes | `(commerce)/commerce/themes/page.tsx` | HTTP 200 · axe 0 |
| `/appointments` | Customers | Ledger | yes | `(app)/appointments/page.tsx` | HTTP 200 · axe 0 |
| `/contacts` | Customers | Ledger | yes | `(app)/contacts/page.tsx` | HTTP 200 · axe 0 |
| `/crm` | Customers | Ledger | yes | `(app)/crm/page.tsx` | HTTP 200 · axe 0 |
| `/customer-settings` | Customers | Ledger | yes | `(app)/customer-settings/page.tsx` | HTTP 200 · axe 0 |
| `/partners` | Customers | Ledger | yes | `(app)/partners/page.tsx` | HTTP 200 · axe 0 |
| `/partners/:id` | Customers | Ledger | yes | `(app)/partners/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/partners/:id/edit` | Customers | Ledger | yes | `(app)/partners/[id]/edit/page.tsx` | HTTP 200 · axe 0 |
| `/partners/:id/statement` | Customers | Ledger | yes | `(app)/partners/[id]/statement/page.tsx` | HTTP 200 · axe 0 |
| `/partners/new` | Customers | Ledger | yes | `(app)/partners/new/page.tsx` | HTTP 200 · axe 0 |
| `/dashboard` | Dashboard | Ledger | yes | `(app)/dashboard/page.tsx` | HTTP 200 · axe 0 |
| `/documents` | Documents | Ledger | yes | `(app)/documents/page.tsx` | HTTP 200 · axe 0 |
| `/documents/:id` | Documents | Ledger | yes | `(app)/documents/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/documents/:id/diagnostics` | Documents | Ledger | yes | `(app)/documents/[id]/diagnostics/page.tsx` | NOT LOADED (no fixture) |
| `/documents/governance` | Documents | Ledger | yes | `(app)/documents/governance/page.tsx` | HTTP 200 · axe 0 |
| `/documents/operations` | Documents | Ledger | yes | `(app)/documents/operations/page.tsx` | HTTP 200 · axe 0 |
| `/documents/settings` | Documents | Ledger | yes | `(app)/documents/settings/page.tsx` | HTTP 200 · axe 0 |
| `/documents/usage` | Documents | Ledger | yes | `(app)/documents/usage/page.tsx` | HTTP 200 · axe 0 |
| `/dev/customizer-versions` | EXCLUDED: internal dev/QA harness | - | no | `dev/customizer-versions/page.tsx` | HTTP 404 · axe 0 · gate n/a |
| `/dev/customizer-visual` | EXCLUDED: internal dev/QA harness | - | no | `dev/customizer-visual/page.tsx` | HTTP 404 · axe 0 · gate n/a |
| `/dev/trust-visual` | EXCLUDED: internal dev/QA harness | - | no | `dev/trust-visual/page.tsx` | HTTP 404 · axe 0 · gate n/a |
| `/document-qa` | EXCLUDED: internal dev/QA harness | - | no | `document-qa/page.tsx` | HTTP 200 · axe 1 · gate n/a |
| `/platform` | EXCLUDED: platform (AWJ-PLATFORM-UX) | - | no | `platform/(console)/page.tsx` | NOT LOADED (no fixture) |
| `/platform/document-operations` | EXCLUDED: platform (AWJ-PLATFORM-UX) | - | no | `platform/(console)/document-operations/page.tsx` | NOT LOADED (no fixture) |
| `/platform/integrations` | EXCLUDED: platform (AWJ-PLATFORM-UX) | - | no | `platform/(console)/integrations/page.tsx` | NOT LOADED (no fixture) |
| `/platform/login` | EXCLUDED: platform (AWJ-PLATFORM-UX) | - | no | `platform/login/page.tsx` | NOT LOADED (no fixture) |
| `/platform/prices` | EXCLUDED: platform (AWJ-PLATFORM-UX) | - | no | `platform/(console)/prices/page.tsx` | NOT LOADED (no fixture) |
| `/platform/tenants` | EXCLUDED: platform (AWJ-PLATFORM-UX) | - | no | `platform/(console)/tenants/page.tsx` | NOT LOADED (no fixture) |
| `/platform/tenants/:id` | EXCLUDED: platform (AWJ-PLATFORM-UX) | - | no | `platform/(console)/tenants/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/cash-and-bank` | Finance | Ledger | yes | `(app)/cash-and-bank/page.tsx` | HTTP 200 · axe 0 |
| `/cash-and-bank/:id` | Finance | Ledger | yes | `(app)/cash-and-bank/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/cash-and-bank/new` | Finance | Ledger | yes | `(app)/cash-and-bank/new/page.tsx` | HTTP 200 · axe 0 |
| `/cash-and-bank/transfer` | Finance | Ledger | yes | `(app)/cash-and-bank/transfer/page.tsx` | HTTP 200 · axe 0 |
| `/employee-custodies` | Finance | Ledger | yes | `(app)/employee-custodies/page.tsx` | HTTP 200 · axe 0 |
| `/employee-custodies/:id` | Finance | Ledger | yes | `(app)/employee-custodies/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/employee-custodies/new` | Finance | Ledger | yes | `(app)/employee-custodies/new/page.tsx` | HTTP 200 · axe 0 |
| `/expenses` | Finance | Ledger | yes | `(app)/expenses/page.tsx` | HTTP 200 · axe 0 |
| `/expenses/:id` | Finance | Ledger | yes | `(app)/expenses/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/expenses/categories` | Finance | Ledger | yes | `(app)/expenses/categories/page.tsx` | HTTP 200 · axe 0 |
| `/expenses/new` | Finance | Ledger | yes | `(app)/expenses/new/page.tsx` | HTTP 200 · axe 0 |
| `/finance-settings` | Finance | Ledger | yes | `(app)/finance-settings/page.tsx` | HTTP 200 · axe 0 |
| `/finance-settings/financial-alerts` | Finance | Ledger | yes | `(app)/finance-settings/financial-alerts/page.tsx` | HTTP 200 · axe 0 |
| `/finance-settings/settlement-types` | Finance | Ledger | yes | `(app)/finance-settings/settlement-types/page.tsx` | HTTP 200 · axe 0 |
| `/financial-alerts` | Finance | Ledger | yes | `(app)/financial-alerts/page.tsx` | HTTP 200 · axe 0 |
| `/payment-methods` | Finance | Ledger | yes | `(app)/payment-methods/page.tsx` | HTTP 200 · axe 0 |
| `/receipt-vouchers` | Finance | Ledger | yes | `(app)/receipt-vouchers/page.tsx` | HTTP 200 · axe 0 |
| `/receipt-vouchers/:id` | Finance | Ledger | yes | `(app)/receipt-vouchers/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/receipt-vouchers/new` | Finance | Ledger | yes | `(app)/receipt-vouchers/new/page.tsx` | HTTP 200 · axe 0 |
| `/fuel-stations` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/alerts` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/alerts/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/avi-rfid` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/avi-rfid/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/corporate-contracts` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/corporate-contracts/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/devices` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/devices/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/maintenance` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/maintenance/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/master-data` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/master-data/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/readiness` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/readiness/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/receiving` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/receiving/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/safety` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/safety/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/sales` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/sales/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/settings` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/settings/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/fuel-stations/shifts` | Fuel | O-14 (deferred) | no | `(fuel)/fuel-stations/shifts/page.tsx` | HTTP 200 · axe 0 · gate n/a |
| `/hr` | HR | Ledger | yes | `(app)/hr/page.tsx` | HTTP 200 · axe 0 |
| `/hr/employees/:id` | HR | Ledger | yes | `(app)/hr/employees/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/roles` | HR | Ledger | yes | `(app)/roles/page.tsx` | HTTP 200 · axe 0 |
| `/users` | HR | Ledger | yes | `(app)/users/page.tsx` | HTTP 200 · axe 0 |
| `/inventory` | Inventory | Ledger | yes | `(app)/inventory/page.tsx` | HTTP 200 · axe 0 |
| `/inventory-openings` | Inventory | Ledger | yes | `(app)/inventory-openings/page.tsx` | HTTP 200 · axe 0 |
| `/inventory-openings/:id` | Inventory | Ledger | yes | `(app)/inventory-openings/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/inventory-openings/import` | Inventory | Ledger | yes | `(app)/inventory-openings/import/page.tsx` | HTTP 200 · axe 0 |
| `/inventory-settings` | Inventory | Ledger | yes | `(app)/inventory-settings/page.tsx` | HTTP 200 · axe 0 |
| `/inventory-settings/brands` | Inventory | Ledger | yes | `(app)/inventory-settings/brands/page.tsx` | HTTP 200 · axe 0 |
| `/inventory-settings/categories` | Inventory | Ledger | yes | `(app)/inventory-settings/categories/page.tsx` | HTTP 200 · axe 0 |
| `/inventory-settings/products` | Inventory | Ledger | yes | `(app)/inventory-settings/products/page.tsx` | HTTP 200 · axe 0 |
| `/inventory-settings/units` | Inventory | Ledger | yes | `(app)/inventory-settings/units/page.tsx` | HTTP 200 · axe 0 |
| `/products` | Inventory | Ledger | yes | `(app)/products/page.tsx` | HTTP 200 · axe 0 |
| `/products/:id` | Inventory | Ledger | yes | `(app)/products/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/products/:id/edit` | Inventory | Ledger | yes | `(app)/products/[id]/edit/page.tsx` | HTTP 200 · axe 0 |
| `/products/import` | Inventory | Ledger | yes | `(app)/products/import/page.tsx` | HTTP 200 · axe 0 |
| `/products/new` | Inventory | Ledger | yes | `(app)/products/new/page.tsx` | HTTP 200 · axe 0 |
| `/products/workbook-import` | Inventory | Ledger | yes | `(app)/products/workbook-import/page.tsx` | HTTP 200 · axe 0 |
| `/stock-permits` | Inventory | Ledger | yes | `(app)/stock-permits/page.tsx` | HTTP 200 · axe 0 |
| `/stock-permits/:id` | Inventory | Ledger | yes | `(app)/stock-permits/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/stock-permits/new` | Inventory | Ledger | yes | `(app)/stock-permits/new/page.tsx` | HTTP 200 · axe 0 |
| `/stocktaking` | Inventory | Ledger | yes | `(app)/stocktaking/page.tsx` | HTTP 200 · axe 0 |
| `/stocktaking/:id` | Inventory | Ledger | yes | `(app)/stocktaking/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/stocktaking/new` | Inventory | Ledger | yes | `(app)/stocktaking/new/page.tsx` | HTTP 200 · axe 0 |
| `/warehouses` | Inventory | Ledger | yes | `(app)/warehouses/page.tsx` | HTTP 200 · axe 0 |
| `/warehouses/:id` | Inventory | Ledger | yes | `(app)/warehouses/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/warehouses/:id/stock` | Inventory | Ledger | yes | `(app)/warehouses/[id]/stock/page.tsx` | HTTP 200 · axe 0 |
| `/warehouses/new` | Inventory | Ledger | yes | `(app)/warehouses/new/page.tsx` | HTTP 200 · axe 0 |
| `/pos` | POS | Floor | yes | `(pos)/pos/page.tsx` | HTTP 200 · axe 0 |
| `/pos/audit` | POS | Floor | yes | `(app)/pos/audit/page.tsx` | HTTP 200 · axe 0 |
| `/pos/report` | POS | Floor | yes | `(app)/pos/report/page.tsx` | HTTP 200 · axe 0 |
| `/pos/sessions` | POS | Floor | yes | `(app)/pos/sessions/page.tsx` | HTTP 200 · axe 0 |
| `/pos/sessions/:id` | POS | Floor | yes | `(app)/pos/sessions/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/pos/settings` | POS | Floor | yes | `(app)/pos/settings/page.tsx` | HTTP 200 · axe 0 |
| `/pos/settings/cash-drawer` | POS | Floor | yes | `(app)/pos/settings/cash-drawer/page.tsx` | HTTP 200 · axe 0 |
| `/pos/settings/configuration` | POS | Floor | yes | `(app)/pos/settings/configuration/page.tsx` | HTTP 200 · axe 0 |
| `/pos/settings/devices` | POS | Floor | yes | `(app)/pos/settings/devices/page.tsx` | HTTP 200 · axe 0 |
| `/pos/settings/printing` | POS | Floor | yes | `(app)/pos/settings/printing/page.tsx` | HTTP 200 · axe 0 |
| `/pos/settings/shifts` | POS | Floor | yes | `(app)/pos/settings/shifts/page.tsx` | HTTP 200 · axe 0 |
| `/pos/settings/sound-feedback` | POS | Floor | yes | `(app)/pos/settings/sound-feedback/page.tsx` | HTTP 200 · axe 0 |
| `/pos/start` | POS | Floor | yes | `(app)/pos/start/page.tsx` | HTTP 200 · axe 0 |
| `/debit-notes` | Purchases | Ledger | yes | `(app)/debit-notes/page.tsx` | HTTP 200 · axe 0 |
| `/debit-notes/new` | Purchases | Ledger | yes | `(app)/debit-notes/new/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-orders` | Purchases | Ledger | yes | `(app)/purchase-orders/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-orders/:id` | Purchases | Ledger | yes | `(app)/purchase-orders/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/purchase-orders/new` | Purchases | Ledger | yes | `(app)/purchase-orders/new/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-quotes` | Purchases | Ledger | yes | `(app)/purchase-quotes/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-quotes/:id` | Purchases | Ledger | yes | `(app)/purchase-quotes/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/purchase-quotes/new` | Purchases | Ledger | yes | `(app)/purchase-quotes/new/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-requests` | Purchases | Ledger | yes | `(app)/purchase-requests/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-requests/:id` | Purchases | Ledger | yes | `(app)/purchase-requests/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/purchase-requests/new` | Purchases | Ledger | yes | `(app)/purchase-requests/new/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-returns` | Purchases | Ledger | yes | `(app)/purchase-returns/page.tsx` | HTTP 200 · axe 0 |
| `/purchase-settings` | Purchases | Ledger | yes | `(app)/purchase-settings/page.tsx` | HTTP 200 · axe 0 |
| `/purchases` | Purchases | Ledger | yes | `(app)/purchases/page.tsx` | HTTP 200 · axe 0 |
| `/purchases/:id` | Purchases | Ledger | yes | `(app)/purchases/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/purchases/:id/edit` | Purchases | Ledger | yes | `(app)/purchases/[id]/edit/page.tsx` | HTTP 200 · axe 0 |
| `/purchases/:id/payments/new` | Purchases | Ledger | yes | `(app)/purchases/[id]/payments/new/page.tsx` | HTTP 200 · axe 0 |
| `/purchases/new` | Purchases | Ledger | yes | `(app)/purchases/new/page.tsx` | HTTP 200 · axe 0 |
| `/rfq` | Purchases | Ledger | yes | `(app)/rfq/page.tsx` | HTTP 200 · axe 0 |
| `/rfq/:id` | Purchases | Ledger | yes | `(app)/rfq/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/rfq/new` | Purchases | Ledger | yes | `(app)/rfq/new/page.tsx` | HTTP 200 · axe 0 |
| `/supplier-payments` | Purchases | Ledger | yes | `(app)/supplier-payments/page.tsx` | HTTP 200 · axe 0 |
| `/supplier-refunds` | Purchases | Ledger | yes | `(app)/supplier-refunds/page.tsx` | HTTP 200 · axe 0 |
| `/supplier-refunds/:id` | Purchases | Ledger | yes | `(app)/supplier-refunds/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/suppliers` | Purchases | Ledger | yes | `(app)/suppliers/page.tsx` | HTTP 200 · axe 0 |
| `/suppliers/:id/ledger` | Purchases | Ledger | yes | `(app)/suppliers/[id]/ledger/page.tsx` | HTTP 200 · axe 0 |
| `/suppliers/:id/statement` | Purchases | Ledger | yes | `(app)/suppliers/[id]/statement/page.tsx` | HTTP 200 · axe 0 |
| `/reports` | Reports | Ledger | yes | `(app)/reports/page.tsx` | HTTP 200 · axe 0 |
| `/reports/:id` | Reports | Ledger | yes | `(app)/reports/[category]/page.tsx` | HTTP 200 · axe 0 · via 5 concrete path(s) |
| `/reports/classification-analytics` | Reports | Ledger | yes | `(app)/reports/classification-analytics/page.tsx` | HTTP 200 · axe 0 |
| `/reports/customers/:id` | Reports | Ledger | yes | `(app)/reports/customers/[report]/page.tsx` | HTTP 200 · axe 0 · via 4 concrete path(s) |
| `/reports/customers/aging` | Reports | Ledger | yes | `(app)/reports/customers/aging/page.tsx` | HTTP 200 · axe 0 |
| `/reports/general/:id` | Reports | Ledger | yes | `(app)/reports/general/[report]/page.tsx` | HTTP 200 · axe 0 · via 8 concrete path(s) |
| `/reports/inventory/:id` | Reports | Ledger | yes | `(app)/reports/inventory/[report]/page.tsx` | HTTP 200 · axe 0 · via 5 concrete path(s) |
| `/reports/purchases/:id` | Reports | Ledger | yes | `(app)/reports/purchases/[report]/page.tsx` | HTTP 200 · axe 0 · via 7 concrete path(s) |
| `/reports/purchases/aging` | Reports | Ledger | yes | `(app)/reports/purchases/aging/page.tsx` | HTTP 200 · axe 0 |
| `/reports/sales/:id` | Reports | Ledger | yes | `(app)/reports/sales/[report]/page.tsx` | HTTP 200 · axe 0 · via 7 concrete path(s) |
| `/reports/sales/delivery-channel` | Reports | Ledger | yes | `(app)/reports/sales/delivery-channel/page.tsx` | HTTP 200 · axe 0 |
| `/reports/settings/classifications` | Reports | Ledger | yes | `(app)/reports/settings/classifications/page.tsx` | HTTP 200 · axe 0 |
| `/credit-notes` | Sales | Ledger | yes | `(app)/credit-notes/page.tsx` | HTTP 200 · axe 0 |
| `/credit-notes/:id` | Sales | Ledger | yes | `(app)/credit-notes/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/credit-notes/new` | Sales | Ledger | yes | `(app)/credit-notes/new/page.tsx` | HTTP 200 · axe 0 |
| `/customer-refunds` | Sales | Ledger | yes | `(app)/customer-refunds/page.tsx` | HTTP 200 · axe 0 |
| `/customer-refunds/:id` | Sales | Ledger | yes | `(app)/customer-refunds/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/delivery-hub` | Sales | Ledger | yes | `(app)/delivery-hub/page.tsx` | HTTP 200 · axe 0 |
| `/delivery-notes` | Sales | Ledger | yes | `(app)/delivery-notes/page.tsx` | HTTP 200 · axe 0 |
| `/delivery-notes/:id` | Sales | Ledger | yes | `(app)/delivery-notes/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/delivery-notes/:id/edit` | Sales | Ledger | yes | `(app)/delivery-notes/[id]/edit/page.tsx` | NOT LOADED (no fixture) |
| `/delivery-notes/invoice-draft` | Sales | Ledger | yes | `(app)/delivery-notes/invoice-draft/page.tsx` | HTTP 200 · axe 0 |
| `/delivery-notes/new` | Sales | Ledger | yes | `(app)/delivery-notes/new/page.tsx` | HTTP 200 · axe 0 |
| `/delivery-platforms` | Sales | Ledger | yes | `(app)/delivery-platforms/page.tsx` | HTTP 200 · axe 0 |
| `/document-design` | Sales | Ledger | yes | `(app)/document-design/page.tsx` | HTTP 200 · axe 0 |
| `/invoices` | Sales | Ledger | yes | `(app)/invoices/page.tsx` | HTTP 200 · axe 0 |
| `/invoices/:id` | Sales | Ledger | yes | `(app)/invoices/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/invoices/:id/edit` | Sales | Ledger | yes | `(app)/invoices/[id]/edit/page.tsx` | HTTP 200 · axe 0 |
| `/invoices/:id/payments/new` | Sales | Ledger | yes | `(app)/invoices/[id]/payments/new/page.tsx` | HTTP 200 · axe 0 |
| `/invoices/new` | Sales | Ledger | yes | `(app)/invoices/new/page.tsx` | HTTP 200 · axe 1 |
| `/payments` | Sales | Ledger | yes | `(app)/payments/page.tsx` | HTTP 200 · axe 0 |
| `/payments/:id` | Sales | Ledger | yes | `(app)/payments/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/payments/new` | Sales | Ledger | yes | `(app)/payments/new/page.tsx` | HTTP 200 · axe 0 |
| `/quotes` | Sales | Ledger | yes | `(app)/quotes/page.tsx` | HTTP 200 · axe 0 |
| `/quotes/:id` | Sales | Ledger | yes | `(app)/quotes/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/quotes/new` | Sales | Ledger | yes | `(app)/quotes/new/page.tsx` | HTTP 200 · axe 0 |
| `/recurring-invoices` | Sales | Ledger | yes | `(app)/recurring-invoices/page.tsx` | HTTP 200 · axe 0 |
| `/recurring-invoices/:id` | Sales | Ledger | yes | `(app)/recurring-invoices/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/recurring-invoices/new` | Sales | Ledger | yes | `(app)/recurring-invoices/new/page.tsx` | HTTP 200 · axe 0 |
| `/returns` | Sales | Ledger | yes | `(app)/returns/page.tsx` | HTTP 200 · axe 0 |
| `/returns/:id` | Sales | Ledger | yes | `(app)/returns/[id]/page.tsx` | NOT LOADED (no fixture) |
| `/sales-settings` | Sales | Ledger | yes | `(app)/sales-settings/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/designs` | Sales | Ledger | yes | `(app)/sales-settings/designs/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/einvoice` | Sales | Ledger | yes | `(app)/sales-settings/einvoice/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/fields` | Sales | Ledger | yes | `(app)/sales-settings/fields/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/invoices` | Sales | Ledger | yes | `(app)/sales-settings/invoices/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/orders` | Sales | Ledger | yes | `(app)/sales-settings/orders/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/pricelists` | Sales | Ledger | yes | `(app)/sales-settings/pricelists/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/quotes` | Sales | Ledger | yes | `(app)/sales-settings/quotes/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/shipping` | Sales | Ledger | yes | `(app)/sales-settings/shipping/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/sources` | Sales | Ledger | yes | `(app)/sales-settings/sources/page.tsx` | HTTP 200 · axe 0 |
| `/sales-settings/statuses` | Sales | Ledger | yes | `(app)/sales-settings/statuses/page.tsx` | HTTP 200 · axe 0 |
| `/applications` | Settings & admin | Ledger | yes | `(app)/applications/page.tsx` | HTTP 200 · axe 0 |
| `/branches` | Settings & admin | Ledger | yes | `(app)/branches/page.tsx` | HTTP 200 · axe 0 |
| `/branches/:id` | Settings & admin | Ledger | yes | `(app)/branches/[id]/page.tsx` | HTTP 200 · axe 0 |
| `/branches/new` | Settings & admin | Ledger | yes | `(app)/branches/new/page.tsx` | HTTP 200 · axe 0 |
| `/branches/settings` | Settings & admin | Ledger | yes | `(app)/branches/settings/page.tsx` | HTTP 200 · axe 0 |
| `/developer` | Settings & admin | Ledger | yes | `(app)/developer/page.tsx` | HTTP 200 · axe 0 |
| `/developer/docs` | Settings & admin | Ledger | yes | `(app)/developer/docs/page.tsx` | HTTP 200 · axe 0 |
| `/developer/keys` | Settings & admin | Ledger | yes | `(app)/developer/keys/page.tsx` | HTTP 200 · axe 0 |
| `/developer/security` | Settings & admin | Ledger | yes | `(app)/developer/security/page.tsx` | HTTP 200 · axe 0 |
| `/developer/webhooks` | Settings & admin | Ledger | yes | `(app)/developer/webhooks/page.tsx` | HTTP 200 · axe 0 |
| `/help` | Settings & admin | Ledger | yes | `(app)/help/page.tsx` | HTTP 200 · axe 0 |
| `/help/:id` | Settings & admin | Ledger | yes | `(app)/help/[slug]/page.tsx` | HTTP 200 · axe 0 · via 1 concrete path(s) |
| `/integrations` | Settings & admin | Ledger | yes | `(app)/integrations/page.tsx` | HTTP 200 · axe 0 |
| `/integrations/communications` | Settings & admin | Ledger | yes | `(app)/integrations/communications/page.tsx` | HTTP 200 · axe 0 |
| `/integrations/delivery-platforms` | Settings & admin | Ledger | yes | `(app)/integrations/delivery-platforms/page.tsx` | HTTP 200 · axe 0 |
| `/integrations/delivery-platforms/:id` | Settings & admin | Ledger | yes | `(app)/integrations/delivery-platforms/[platformKey]/page.tsx` | HTTP 200 · axe 0 · via 1 concrete path(s) |
| `/notifications` | Settings & admin | Ledger | yes | `(app)/notifications/page.tsx` | HTTP 200 · axe 0 |
| `/settings` | Settings & admin | Ledger | yes | `(app)/settings/page.tsx` | HTTP 200 · axe 0 |
| `/tax-settings` | Settings & admin | Ledger | yes | `(app)/tax-settings/page.tsx` | HTTP 200 · axe 0 |
| `/whats-new` | Settings & admin | Ledger | yes | `(app)/whats-new/page.tsx` | HTTP 200 · axe 0 |
