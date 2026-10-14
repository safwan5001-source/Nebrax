# AWJ-ERP-UX-H1-0 — Crawl evidence (generated)

Page loads recorded: **1871**

Gate check: loads whose `data-awj-ui` attribute disagreed with the requested mode (excluding gate-excluded routes): **7** /icon.ico

| UI | Config | Loads |
|---|---|---|
| 3 | ar-dark-360 | 208 |
| 3 | ar-light-1440 | 208 |
| 3 | ar-light-320 | 207 |
| 3 | ar-light-390 | 208 |
| 3 | ar-light-768 | 208 |
| 3 | en-dark-1440 | 208 |
| 3 | en-light-390 | 208 |
| legacy | ar-light-1440 | 208 |
| legacy | ar-light-390 | 208 |

## axe-core 4.10.2 violations (WCAG 2.0/2.1/2.2 A+AA + best-practice)

| Rule | Impact | UI | Page loads affected | Distinct routes | Example route | Example node |
|---|---|---|---|---|---|---|
| `aria-hidden-focus` | serious | 3 | 674 | 168 | `/accounting-settings` | `.max-h-\[calc\(100dvh-1\.5rem\)\]` |
| `heading-order` | moderate | 3 | 372 | 92 | `/accounting-settings/account-routing` | `.border.bg-surface[data-awj-card="true"]:nth-child(2) > .pb-2.p-4 > h3[data-awj-card-title` |
| `aria-hidden-focus` | serious | legacy | 337 | 168 | `/accounting-settings` | `.max-h-\[calc\(100dvh-1\.5rem\)\]` |
| `heading-order` | moderate | legacy | 188 | 93 | `/accounting-settings/account-routing` | `.border.bg-surface[data-awj-card="true"]:nth-child(2) > .pb-2.p-4 > h3[data-awj-card-title` |
| `select-name` | critical | 3 | 60 | 15 | `/accounting-settings/account-routing` | `.border.bg-surface[data-awj-card="true"]:nth-child(2) > .pt-2.p-4 > .divide-y.divide-borde` |
| `label` | critical | 3 | 58 | 15 | `/commerce/appearance` | `.inset-0.opacity-0[value="#12372a"]` |
| `link-name` | serious | 3 | 50 | 25 | `/app-builder` | `a[href$="dashboard"]` |
| `select-name` | critical | legacy | 30 | 15 | `/accounting-settings/account-routing` | `.border.bg-surface[data-awj-card="true"]:nth-child(2) > .pt-2.p-4 > .divide-y.divide-borde` |
| `label` | critical | legacy | 29 | 15 | `/commerce/appearance` | `.inset-0.opacity-0[value="#12372a"]` |
| `link-name` | serious | legacy | 25 | 25 | `/app-builder` | `a[href$="dashboard"]` |
| `color-contrast` | serious | 3 | 22 | 8 | `/applications` | `.overflow-hidden:nth-child(1) > .divide-y.divide-border > .opacity-70:nth-child(2) > .min-` |
| `color-contrast` | serious | legacy | 22 | 17 | `/applications` | `.overflow-hidden:nth-child(1) > .divide-y.divide-border > .opacity-70:nth-child(2) > .min-` |
| `landmark-one-main` | moderate | 3 | 20 | 5 | `/_not-found` | `html` |
| `region` | moderate | 3 | 20 | 5 | `/_not-found` | `h1` |
| `landmark-unique` | moderate | 3 | 18 | 8 | `/developer/docs` | `.inset-y-0` |
| `empty-table-header` | minor | 3 | 16 | 8 | `/branches` | `th:nth-child(6)` |
| `link-in-text-block` | serious | 3 | 14 | 4 | `/credit-notes/new` | `.hover\:underline` |
| `button-name` | critical | 3 | 12 | 4 | `/cash-and-bank` | `tr:nth-child(1) > td:nth-child(6) > .justify-end.gap-1.flex > .relative > .w-9.h-9[aria-ha` |
| `target-size` | serious | 3 | 10 | 3 | `/invoices/:id/edit` | `.accent-primary` |
| `landmark-one-main` | moderate | legacy | 10 | 5 | `/_not-found` | `html` |
| `region` | moderate | legacy | 10 | 5 | `/_not-found` | `h1` |
| `landmark-unique` | moderate | legacy | 9 | 8 | `/developer/docs` | `.inset-y-0` |
| `page-has-heading-one` | moderate | 3 | 8 | 2 | `/fuel-stations/settings` | `html` |
| `empty-table-header` | minor | legacy | 8 | 8 | `/branches` | `th:nth-child(6)` |
| `scrollable-region-focusable` | serious | 3 | 6 | 3 | `/developer` | `pre` |
| `button-name` | critical | legacy | 6 | 4 | `/cash-and-bank` | `tr:nth-child(1) > td:nth-child(6) > .justify-end.gap-1.flex > .relative > .w-9.h-9[aria-ha` |
| `link-in-text-block` | serious | legacy | 6 | 3 | `/credit-notes/new` | `.hover\:underline` |
| `aria-valid-attr-value` | critical | 3 | 4 | 1 | `/commerce/published-products` | `#tab-products` |
| `svg-img-alt` | serious | 3 | 4 | 1 | `/document-qa` | `svg` |
| `html-has-lang` | serious | 3 | 4 | 1 | `/icon.ico` | `html` |
| `image-alt` | critical | 3 | 4 | 1 | `/icon.ico` | `img` |
| `landmark-main-is-top-level` | moderate | 3 | 4 | 1 | `/pos/audit` | `.lg\:p-6` |
| `landmark-no-duplicate-main` | moderate | 3 | 4 | 1 | `/pos/audit` | `.overflow-auto` |
| `svg-img-alt` | serious | legacy | 4 | 2 | `/document-qa` | `svg` |
| `page-has-heading-one` | moderate | legacy | 4 | 2 | `/fuel-stations/settings` | `html` |
| `scrollable-region-focusable` | serious | legacy | 3 | 3 | `/developer` | `pre` |
| `aria-valid-attr-value` | critical | legacy | 2 | 1 | `/commerce/published-products` | `#tab-products` |
| `html-has-lang` | serious | legacy | 2 | 1 | `/icon.ico` | `html` |
| `image-alt` | critical | legacy | 2 | 1 | `/icon.ico` | `img` |
| `landmark-main-is-top-level` | moderate | legacy | 2 | 1 | `/pos/audit` | `.lg\:p-6` |
| `landmark-no-duplicate-main` | moderate | legacy | 2 | 1 | `/pos/audit` | `.overflow-auto` |
| `target-size` | serious | legacy | 1 | 1 | `/partners/:id` | `#panel-details > .grid-cols-1.lg\:grid-cols-2.lg\:divide-x > div:nth-child(2) > .last\:bor` |

### Routes per axe rule (v3, excluding `aria-hidden-focus` which is shell-wide)

- **`heading-order`** (92): `/accounting-settings/account-routing`, `/accounts`, `/app-builder/new`, `/assets/new`, `/branches/:id`, `/branches/new`, `/branches/settings`, `/cash-and-bank/new`, `/cash-and-bank/transfer`, `/credit-notes/new`, `/customer-settings`, `/debit-notes/new`, `/delivery-notes/invoice-draft`, `/delivery-notes/new`, `/developer/docs`, `/employee-custodies/new`, `/expenses/categories`, `/expenses/new`, `/finance-settings/financial-alerts`, `/finance-settings/settlement-types`, `/fuel-stations/alerts`, `/fuel-stations/maintenance`, `/fuel-stations/readiness`, `/fuel-stations/receiving`, `/fuel-stations/safety`, `/inventory-openings/import`, `/inventory-settings`, `/inventory-settings/brands`, `/inventory-settings/categories`, `/inventory-settings/products`, `/inventory-settings/units`, `/invoices/:id`, `/invoices/:id/payments/new`, `/journal-entries/:id`, `/manual-journals/new`, `/me`, `/numbering-settings`, `/partners/:id/edit`, `/partners/:id/statement`, `/partners/new`, `/payment-methods`, `/payments/:id`, `/payments/new`, `/pos/settings/cash-drawer`, `/pos/settings/configuration`, `/pos/settings/printing`, `/pos/settings/sound-feedback`, `/products/:id/edit`, `/products/import`, `/products/new`, `/products/workbook-import`, `/purchase-orders/new`, `/purchase-quotes/new`, `/purchase-requests/new`, `/purchase-settings`, `/purchases/:id`, `/purchases/:id/edit`, `/purchases/:id/payments/new`, `/purchases/new`, `/quotes/new` …
- **`link-name`** (25): `/app-builder`, `/app-builder/new`, `/commerce`, `/commerce/delivery`, `/commerce/domains`, `/commerce/gifting`, `/commerce/integrations`, `/commerce/merchandising`, `/commerce/onboarding`, `/commerce/published-products`, `/commerce/stores`, `/commerce/themes`, `/fuel-stations`, `/fuel-stations/alerts`, `/fuel-stations/avi-rfid`, `/fuel-stations/corporate-contracts`, `/fuel-stations/devices`, `/fuel-stations/maintenance`, `/fuel-stations/master-data`, `/fuel-stations/readiness`, `/fuel-stations/receiving`, `/fuel-stations/safety`, `/fuel-stations/sales`, `/fuel-stations/settings`, `/fuel-stations/shifts`
- **`select-name`** (15): `/accounting-settings/account-routing`, `/debit-notes/new`, `/fuel-stations/alerts`, `/fuel-stations/maintenance`, `/fuel-stations/safety`, `/manual-journals/new`, `/products/:id/edit`, `/products/new`, `/purchase-orders/new`, `/purchase-quotes/new`, `/purchase-requests/new`, `/recurring-invoices/new`, `/rfq/new`, `/stock-permits/new`, `/tax-settings`
- **`label`** (15): `/commerce/appearance`, `/customer-refunds`, `/debit-notes/new`, `/products/:id/edit`, `/purchase-orders/new`, `/purchase-quotes/new`, `/purchase-requests/new`, `/purchases/:id/edit`, `/purchases/new`, `/quotes/new`, `/recurring-invoices/new`, `/rfq/new`, `/stock-permits/new`, `/supplier-refunds`, `/tax-settings`
- **`color-contrast`** (8): `/`, `/applications`, `/document-qa`, `/finance-settings`, `/inventory-settings`, `/inventory-settings/products`, `/journal-entries/:id`, `/payments/:id`
- **`empty-table-header`** (8): `/branches`, `/cash-and-bank`, `/invoices`, `/partners`, `/products`, `/purchases`, `/suppliers`, `/warehouses`
- **`landmark-unique`** (8): `/developer/docs`, `/help/create-sales-invoice`, `/invoices/:id/payments/new`, `/payments/new`, `/pos/audit`, `/purchases/:id/payments/new`, `/sales-settings/einvoice`, `/settings`
- **`landmark-one-main`** (5): `/_not-found`, `/dev/customizer-versions`, `/dev/customizer-visual`, `/dev/trust-visual`, `/icon.ico`
- **`region`** (5): `/_not-found`, `/dev/customizer-versions`, `/dev/customizer-visual`, `/dev/trust-visual`, `/icon.ico`
- **`button-name`** (4): `/cash-and-bank`, `/invoices/:id/edit`, `/invoices/new`, `/quotes/new`
- **`link-in-text-block`** (4): `/credit-notes/new`, `/numbering-settings`, `/purchase-settings`, `/sales-settings/invoices`
- **`scrollable-region-focusable`** (3): `/developer`, `/developer/security`, `/partners/:id`
- **`target-size`** (3): `/invoices/:id/edit`, `/invoices/new`, `/partners/:id`
- **`page-has-heading-one`** (2): `/fuel-stations/settings`, `/icon.ico`
- **`aria-valid-attr-value`** (1): `/commerce/published-products`
- **`svg-img-alt`** (1): `/document-qa`
- **`html-has-lang`** (1): `/icon.ico`
- **`image-alt`** (1): `/icon.ico`
- **`landmark-main-is-top-level`** (1): `/pos/audit`
- **`landmark-no-duplicate-main`** (1): `/pos/audit`

## Page-level horizontal overflow (documentElement.scrollWidth > clientWidth)

| Route | Config | UI | Overflow px |
|---|---|---|---|
| `/products/:id/edit` | ar-light-1440 | 3 | 264 |
| `/products/:id/edit` | en-dark-1440 | 3 | 264 |
| `/products/:id/edit` | ar-light-1440 | legacy | 264 |
| `/products/:id/edit` | ar-light-768 | 3 | 40 |
| `/products/:id/edit` | ar-light-390 | 3 | 32 |
| `/products/:id/edit` | en-light-390 | 3 | 32 |
| `/products/:id/edit` | ar-light-320 | 3 | 32 |
| `/products/:id/edit` | ar-dark-360 | 3 | 32 |
| `/products/:id/edit` | ar-light-390 | legacy | 32 |
| `/accounting-settings` | ar-light-320 | 3 | 12 |
| `/accounting-settings/account-routing` | ar-light-320 | 3 | 12 |
| `/accounting-settings/fiscal-years` | ar-light-320 | 3 | 12 |
| `/accounting-settings/period-locks` | ar-light-320 | 3 | 12 |
| `/accounts` | ar-light-320 | 3 | 12 |
| `/applications` | ar-light-320 | 3 | 12 |
| `/appointments` | ar-light-320 | 3 | 12 |
| `/assets` | ar-light-320 | 3 | 12 |
| `/assets/new` | ar-light-320 | 3 | 12 |
| `/branches` | ar-light-320 | 3 | 12 |
| `/branches/:id` | ar-light-320 | 3 | 12 |
| `/branches/new` | ar-light-320 | 3 | 12 |
| `/branches/settings` | ar-light-320 | 3 | 12 |
| `/cash-and-bank` | ar-light-320 | 3 | 12 |
| `/cash-and-bank/new` | ar-light-320 | 3 | 12 |
| `/cash-and-bank/transfer` | ar-light-320 | 3 | 12 |
| `/contacts` | ar-light-320 | 3 | 12 |
| `/cost-centers` | ar-light-320 | 3 | 12 |
| `/credit-notes` | ar-light-320 | 3 | 12 |
| `/credit-notes/new` | ar-light-320 | 3 | 12 |
| `/crm` | ar-light-320 | 3 | 12 |
| `/customer-refunds` | ar-light-320 | 3 | 12 |
| `/customer-settings` | ar-light-320 | 3 | 12 |
| `/dashboard` | ar-light-320 | 3 | 12 |
| `/debit-notes` | ar-light-320 | 3 | 12 |
| `/debit-notes/new` | ar-light-320 | 3 | 12 |
| `/delivery-hub` | ar-light-320 | 3 | 12 |
| `/delivery-notes` | ar-light-320 | 3 | 12 |
| `/delivery-notes/invoice-draft` | ar-light-320 | 3 | 12 |
| `/delivery-notes/new` | ar-light-320 | 3 | 12 |
| `/delivery-platforms` | ar-light-320 | 3 | 12 |
| `/developer` | ar-light-320 | 3 | 12 |
| `/developer/docs` | ar-light-320 | 3 | 12 |
| `/developer/keys` | ar-light-320 | 3 | 12 |
| `/developer/security` | ar-light-320 | 3 | 12 |
| `/developer/webhooks` | ar-light-320 | 3 | 12 |
| `/document-design` | ar-light-320 | 3 | 12 |
| `/documents` | ar-light-320 | 3 | 12 |
| `/documents/governance` | ar-light-320 | 3 | 12 |
| `/documents/operations` | ar-light-320 | 3 | 12 |
| `/documents/settings` | ar-light-320 | 3 | 12 |
| `/documents/usage` | ar-light-320 | 3 | 12 |
| `/employee-custodies` | ar-light-320 | 3 | 12 |
| `/employee-custodies/new` | ar-light-320 | 3 | 12 |
| `/expenses` | ar-light-320 | 3 | 12 |
| `/expenses/categories` | ar-light-320 | 3 | 12 |
| `/expenses/new` | ar-light-320 | 3 | 12 |
| `/finance-settings` | ar-light-320 | 3 | 12 |
| `/finance-settings/financial-alerts` | ar-light-320 | 3 | 12 |
| `/finance-settings/settlement-types` | ar-light-320 | 3 | 12 |
| `/financial-alerts` | ar-light-320 | 3 | 12 |
| `/help` | ar-light-320 | 3 | 12 |
| `/help/create-sales-invoice` | ar-light-320 | 3 | 12 |
| `/hr` | ar-light-320 | 3 | 12 |
| `/integrations` | ar-light-320 | 3 | 12 |
| `/integrations/delivery-platforms` | ar-light-320 | 3 | 12 |
| `/integrations/delivery-platforms/jahez` | ar-light-320 | 3 | 12 |
| `/inventory` | ar-light-320 | 3 | 12 |
| `/inventory-openings` | ar-light-320 | 3 | 12 |
| `/inventory-openings/import` | ar-light-320 | 3 | 12 |
| `/inventory-settings` | ar-light-320 | 3 | 12 |
| `/inventory-settings/brands` | ar-light-320 | 3 | 12 |
| `/inventory-settings/categories` | ar-light-320 | 3 | 12 |
| `/inventory-settings/products` | ar-light-320 | 3 | 12 |
| `/inventory-settings/units` | ar-light-320 | 3 | 12 |
| `/invoices` | ar-light-320 | 3 | 12 |
| `/invoices/:id` | ar-light-320 | 3 | 12 |
| `/invoices/:id/edit` | ar-light-320 | 3 | 12 |
| `/invoices/:id/payments/new` | ar-light-320 | 3 | 12 |
| `/invoices/new` | ar-light-320 | 3 | 12 |
| `/journal-entries` | ar-light-320 | 3 | 12 |
| `/journal-entries/:id` | ar-light-320 | 3 | 12 |
| `/manual-journals` | ar-light-320 | 3 | 12 |
| `/manual-journals/new` | ar-light-320 | 3 | 12 |
| `/notifications` | ar-light-320 | 3 | 12 |
| `/numbering-settings` | ar-light-320 | 3 | 12 |
| `/partners` | ar-light-320 | 3 | 12 |
| `/partners/:id` | ar-light-320 | 3 | 12 |
| `/partners/:id/edit` | ar-light-320 | 3 | 12 |
| `/partners/:id/statement` | ar-light-320 | 3 | 12 |
| `/partners/new` | ar-light-320 | 3 | 12 |
| `/payment-methods` | ar-light-320 | 3 | 12 |
| `/payments` | ar-light-320 | 3 | 12 |
| `/payments/:id` | ar-light-320 | 3 | 12 |
| `/payments/new` | ar-light-320 | 3 | 12 |
| `/pos` | ar-light-320 | 3 | 12 |
| `/pos/audit` | ar-light-320 | 3 | 12 |
| `/pos/report` | ar-light-320 | 3 | 12 |
| `/pos/sessions` | ar-light-320 | 3 | 12 |
| `/pos/settings` | ar-light-320 | 3 | 12 |
| `/pos/settings/cash-drawer` | ar-light-320 | 3 | 12 |
| `/pos/settings/configuration` | ar-light-320 | 3 | 12 |
| `/pos/settings/devices` | ar-light-320 | 3 | 12 |
| `/pos/settings/printing` | ar-light-320 | 3 | 12 |
| `/pos/settings/shifts` | ar-light-320 | 3 | 12 |
| `/pos/settings/sound-feedback` | ar-light-320 | 3 | 12 |
| `/pos/start` | ar-light-320 | 3 | 12 |
| `/products` | ar-light-320 | 3 | 12 |
| `/products/:id` | ar-light-320 | 3 | 12 |
| `/products/import` | ar-light-320 | 3 | 12 |
| `/products/new` | ar-light-320 | 3 | 12 |
| `/products/workbook-import` | ar-light-320 | 3 | 12 |
| `/purchase-orders` | ar-light-320 | 3 | 12 |
| `/purchase-orders/new` | ar-light-320 | 3 | 12 |
| `/purchase-quotes` | ar-light-320 | 3 | 12 |
| `/purchase-quotes/new` | ar-light-320 | 3 | 12 |
| `/purchase-requests` | ar-light-320 | 3 | 12 |
| `/purchase-requests/new` | ar-light-320 | 3 | 12 |
| `/purchase-returns` | ar-light-320 | 3 | 12 |
| `/purchase-settings` | ar-light-320 | 3 | 12 |
| `/purchases` | ar-light-320 | 3 | 12 |
| `/purchases/:id` | ar-light-320 | 3 | 12 |
| `/purchases/:id/edit` | ar-light-320 | 3 | 12 |
| `/purchases/:id/payments/new` | ar-light-320 | 3 | 12 |
| `/purchases/new` | ar-light-320 | 3 | 12 |
| `/quotes` | ar-light-320 | 3 | 12 |
| `/quotes/new` | ar-light-320 | 3 | 12 |
| `/receipt-vouchers` | ar-light-320 | 3 | 12 |
| `/receipt-vouchers/new` | ar-light-320 | 3 | 12 |
| `/recurring-invoices` | ar-light-320 | 3 | 12 |
| `/recurring-invoices/new` | ar-light-320 | 3 | 12 |
| `/reports` | ar-light-320 | 3 | 12 |
| `/reports/sales` | ar-light-320 | 3 | 12 |
| `/reports/classification-analytics` | ar-light-320 | 3 | 12 |
| `/reports/customers/balances` | ar-light-320 | 3 | 12 |
| `/reports/customers/aging` | ar-light-320 | 3 | 12 |
| `/reports/general/trial-balance` | ar-light-320 | 3 | 12 |
| `/reports/inventory/value` | ar-light-320 | 3 | 12 |
| `/reports/purchases/balances` | ar-light-320 | 3 | 12 |
| `/reports/purchases/aging` | ar-light-320 | 3 | 12 |
| `/reports/sales/by-customer` | ar-light-320 | 3 | 12 |
| `/reports/sales/delivery-channel` | ar-light-320 | 3 | 12 |
| `/reports/settings/classifications` | ar-light-320 | 3 | 12 |
| `/returns` | ar-light-320 | 3 | 12 |
| `/rfq` | ar-light-320 | 3 | 12 |
| `/rfq/new` | ar-light-320 | 3 | 12 |
| `/sales-settings` | ar-light-320 | 3 | 12 |
| `/sales-settings/designs` | ar-light-320 | 3 | 12 |
| `/sales-settings/einvoice` | ar-light-320 | 3 | 12 |
| `/sales-settings/fields` | ar-light-320 | 3 | 12 |
| `/sales-settings/invoices` | ar-light-320 | 3 | 12 |
| `/sales-settings/orders` | ar-light-320 | 3 | 12 |
| `/sales-settings/pricelists` | ar-light-320 | 3 | 12 |
| `/sales-settings/quotes` | ar-light-320 | 3 | 12 |
| `/sales-settings/shipping` | ar-light-320 | 3 | 12 |
| `/sales-settings/sources` | ar-light-320 | 3 | 12 |
| `/sales-settings/statuses` | ar-light-320 | 3 | 12 |
| `/settings` | ar-light-320 | 3 | 12 |
| `/stock-permits` | ar-light-320 | 3 | 12 |
| `/stock-permits/new` | ar-light-320 | 3 | 12 |
| `/stocktaking` | ar-light-320 | 3 | 12 |
| `/stocktaking/new` | ar-light-320 | 3 | 12 |
| `/supplier-payments` | ar-light-320 | 3 | 12 |
| `/supplier-refunds` | ar-light-320 | 3 | 12 |
| `/suppliers` | ar-light-320 | 3 | 12 |
| `/suppliers/:id/ledger` | ar-light-320 | 3 | 12 |
| `/suppliers/:id/statement` | ar-light-320 | 3 | 12 |
| `/tax-settings` | ar-light-320 | 3 | 12 |
| `/warehouses` | ar-light-320 | 3 | 12 |
| `/warehouses/:id` | ar-light-320 | 3 | 12 |
| `/warehouses/:id/stock` | ar-light-320 | 3 | 12 |
| `/warehouses/new` | ar-light-320 | 3 | 12 |
| `/whats-new` | ar-light-320 | 3 | 12 |
| `/reports/general/income-statement` | ar-light-320 | 3 | 12 |
| `/reports/general/balance-sheet` | ar-light-320 | 3 | 12 |
| `/reports/general/account-ledger` | ar-light-320 | 3 | 12 |

Total overflowing loads: 175 of 1871

## API responses >= 400 during page load

| Response | Routes |
|---|---|
| `403 GET /api/fuel-stations/stations` | `/fuel-stations/avi-rfid`, `/fuel-stations/devices`, `/fuel-stations/maintenance`, `/fuel-stations/master-data`, `/fuel-stations/receiving`, `/fuel-stations/safety`, `/fuel-stations/sales`, `/fuel-stations/settings`, `/fuel-stations/shifts` |
| `403 GET /api/fuel-stations/nozzles` | `/fuel-stations/avi-rfid`, `/fuel-stations/maintenance`, `/fuel-stations/master-data`, `/fuel-stations/sales`, `/fuel-stations/shifts` |
| `403 GET /api/fuel-stations/tanks` | `/fuel-stations/maintenance`, `/fuel-stations/master-data`, `/fuel-stations/receiving`, `/fuel-stations/shifts` |
| `403 GET /api/fuel-stations/devices` | `/fuel-stations/devices`, `/fuel-stations/maintenance`, `/fuel-stations/settings` |
| `403 GET /api/fuel-stations/products` | `/fuel-stations/master-data`, `/fuel-stations/receiving`, `/fuel-stations/settings` |
| `403 GET /api/delivery-notes` | `/delivery-notes`, `/delivery-notes/invoice-draft` |
| `403 GET /api/document-governance` | `/documents/governance`, `/documents/settings` |
| `403 GET /api/document-operations` | `/documents/operations`, `/documents/settings` |
| `403 GET /api/fuel-stations/avi-rfid/authorizations` | `/fuel-stations/avi-rfid`, `/fuel-stations/sales` |
| `403 GET /api/fuel-stations/corporate-contracts` | `/fuel-stations/avi-rfid`, `/fuel-stations/corporate-contracts` |
| `403 GET /api/fuel-stations/pumps` | `/fuel-stations/maintenance`, `/fuel-stations/master-data` |
| `403 GET /api/fuel-stations/shifts` | `/fuel-stations/sales`, `/fuel-stations/shifts` |
| `403 GET /api/document-batches/eligible-reviewers` | `/documents` |
| `403 GET /api/document-batches` | `/documents` |
| `403 GET /api/document-usage` | `/documents/usage` |
| `403 GET /api/fuel-stations/workspace` | `/fuel-stations` |
| `403 GET /api/fuel-stations/alerts` | `/fuel-stations/alerts` |
| `403 GET /api/fuel-stations/avi-rfid/tags` | `/fuel-stations/avi-rfid` |
| `403 GET /api/fuel-stations/fleet/vehicles` | `/fuel-stations/avi-rfid` |
| `403 GET /api/fuel-stations/fleet/drivers` | `/fuel-stations/avi-rfid` |
| `403 GET /api/fuel-stations/integration-events` | `/fuel-stations/devices` |
| `403 GET /api/fuel-stations/devices/adapter-contracts` | `/fuel-stations/devices` |
| `403 GET /api/fuel-stations/maintenance` | `/fuel-stations/maintenance` |
| `403 GET /api/fuel-stations/dashboard` | `/fuel-stations/readiness` |
| `403 GET /api/fuel-stations/deliveries` | `/fuel-stations/receiving` |
| `403 GET /api/fuel-stations/supplier-invoices` | `/fuel-stations/receiving` |
| `403 GET /api/fuel-stations/safety` | `/fuel-stations/safety` |
| `403 GET /api/fuel-stations/sales` | `/fuel-stations/sales` |
| `403 GET /api/fuel-stations/settings` | `/fuel-stations/settings` |
| `403 GET /api/me/profile` | `/me` |
| `403 GET /api/me/contract` | `/me` |
| `403 GET /api/me/attendances` | `/me` |
| `403 GET /api/me/payroll-items` | `/me` |
| `422 POST /api/email/verify` | `/verify-email` |

## Console errors / page errors

| Message (truncated) | Routes |
|---|---|
| `Failed to load resource: the server responded with a status of 403 (Forbidden)` | `/delivery-notes`, `/delivery-notes/invoice-draft`, `/documents`, `/documents/governance`, `/documents/operations`, `/documents/settings`, `/documents/usage`, `/fuel-stations` |
| `Failed to load resource: the server responded with a status of 404 (Not Found)` | `/_not-found`, `/accounting-settings`, `/accounting-settings/account-routing`, `/accounting-settings/fiscal-years`, `/accounting-settings/period-locks`, `/accounts`, `/assets`, `/assets/new` |
| `Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "6 3 1 8 6 13".` | `/commerce/appearance` |
| `Failed to load resource: the server responded with a status of 422 (Unprocessable Content)` | `/verify-email` |
| `Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "10 3 15 8 10 13".` | `/commerce/appearance` |

## i18n: missing messages, raw keys, Arabic UI chrome in English mode

| Key | Routes |
|---|---|
| `numberingSettings.entity_delivery_note` | `/numbering-settings` |
| `numberingSettings.entity_commerce_order` | `/numbering-settings` |
| `numberingSettings.entity_supplier_refund` | `/numbering-settings` |
| `numberingSettings.entity_customer_refund` | `/numbering-settings` |
| `numberingSettings.entity_pos_investigation_case` | `/numbering-settings` |

### Arabic text in UI chrome (th/label/button/h1-h3/tab/nav/option) while locale = en

| Route | Config | Count | Samples |
|---|---|---|---|
| `/reports/general/balance-sheet` | en-dark-1440 | 55 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/suppliers/:id/ledger` | en-dark-1440 | 52 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/suppliers/:id/statement` | en-dark-1440 | 51 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/reports/customers/aging` | en-dark-1440 | 50 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/reports/general/income-statement` | en-dark-1440 | 49 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/reports/general/account-ledger` | en-dark-1440 | 41 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/warehouses/:id` | en-light-390 | 40 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/warehouses/new` | en-light-390 | 40 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/suppliers` | en-dark-1440 | 40 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/stock-permits/new` | en-light-390 | 39 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/stocktaking/new` | en-light-390 | 36 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/supplier-payments` | en-light-390 | 36 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/supplier-refunds` | en-light-390 | 36 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/warehouses` | en-dark-1440 | 35 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/tax-settings` | en-light-390 | 32 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/stock-permits` | en-light-390 | 30 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/stocktaking` | en-light-390 | 30 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/warehouses/:id/stock` | en-light-390 | 30 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/whats-new` | en-light-390 | 23 | لوحة التحكم; المبيعات; نقطة البيع; التجارة الإلكترونية; العملاء |
| `/payment-methods` | en-light-390 | 6 | ع; ممالك الاختبارالفرع الرئيسي; بطاقة ائتمان; تحويل بنكي; شيك |
| `/cash-and-bank/transfer` | en-dark-1440 | 4 | ع; ممالك الاختبارالفرع الرئيسي; Source—الحساب البنكي الافتراضي; Destination—الحساب البنكي الاف |
| `/delivery-notes/new` | en-dark-1440 | 4 | ع; ممالك الاختبارالفرع الرئيسي; عميل اختبار 27; المخزن الرئيسي |
| `/invoices/:id/edit` | en-light-390 | 3 | ع; ممالك الاختبارالفرع الرئيسي; خدمة صيانة دورية |
| `/invoices/new` | en-light-390 | 3 | ع; ممالك الاختبارالفرع الرئيسي; عميل اختبار 27 |
| `/partners/:id` | en-light-390 | 3 | ع; ممالك الاختبارالفرع الرئيسي; مؤسسة الطموح للتجارة |
| `/products/:id` | en-light-390 | 3 | ع; ممالك الاختبارالفرع الرئيسي; زيت محرك صناعي عالي الأداء لمح |
| `/products/:id/edit` | en-light-390 | 3 | ع; ممالك الاختبارالفرع الرئيسي; زيت محرك صناعي عالي الأداء لمح |
| `/rfq/new` | en-light-390 | 3 | ع; ممالك الاختبارالفرع الرئيسي; مورد المحروقات الوطني |
| `/invoices` | en-dark-1440 | 3 | ع; ممالك الاختبارالفرع الرئيسي; المتبقي |
| `/accounting-settings` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/accounting-settings/account-routing` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/accounting-settings/fiscal-years` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/accounting-settings/period-locks` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/accounts` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/applications` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/appointments` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/assets` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/assets/new` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/branches` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/branches/:id` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/branches/new` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/branches/settings` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/cash-and-bank` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/cash-and-bank/new` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/contacts` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/cost-centers` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/credit-notes` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/credit-notes/new` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/crm` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/customer-refunds` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/customer-settings` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/dashboard` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/debit-notes` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/debit-notes/new` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/delivery-hub` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/delivery-notes` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/delivery-notes/invoice-draft` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/delivery-platforms` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/developer` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/developer/docs` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/developer/keys` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/developer/security` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/developer/webhooks` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/document-design` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/documents` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/documents/governance` | en-dark-1440 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/documents/operations` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/documents/settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/documents/usage` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/employee-custodies` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/employee-custodies/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/expenses` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/expenses/categories` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/expenses/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/finance-settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/finance-settings/financial-alerts` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/finance-settings/settlement-types` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/financial-alerts` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/help` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/help/create-sales-invoice` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/hr` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/integrations` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/integrations/delivery-platforms` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/integrations/delivery-platforms/jahez` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory-openings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory-openings/import` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory-settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory-settings/brands` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory-settings/categories` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory-settings/products` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/inventory-settings/units` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/invoices/:id` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/invoices/:id/payments/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/journal-entries` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/journal-entries/:id` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/manual-journals` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/manual-journals/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/notifications` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/numbering-settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/partners` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/partners/:id/edit` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/partners/:id/statement` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/partners/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/payments` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/payments/:id` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/payments/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/audit` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/report` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/sessions` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/settings/cash-drawer` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/settings/configuration` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/settings/devices` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/settings/printing` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/settings/shifts` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/settings/sound-feedback` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/pos/start` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/products` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/products/import` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/products/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/products/workbook-import` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-orders` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-orders/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-quotes` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-quotes/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-requests` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-requests/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-returns` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchase-settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchases` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchases/:id` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchases/:id/edit` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchases/:id/payments/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/purchases/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/quotes` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/quotes/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/receipt-vouchers` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/receipt-vouchers/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/recurring-invoices` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/recurring-invoices/new` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/sales` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/classification-analytics` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/customers/balances` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/general/trial-balance` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/inventory/value` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/purchases/balances` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/purchases/aging` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/sales/by-customer` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/sales/delivery-channel` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/reports/settings/classifications` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/returns` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/rfq` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/designs` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/einvoice` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/fields` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/invoices` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/orders` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/pricelists` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/quotes` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/shipping` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/sources` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/sales-settings/statuses` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/settings` | en-light-390 | 2 | ع; ممالك الاختبارالفرع الرئيسي |
| `/` | en-dark-1440 | 1 | ع |
| `/app-builder` | en-dark-1440 | 1 | ع |
| `/app-builder/new` | en-dark-1440 | 1 | ع |
| `/auth/handoff` | en-dark-1440 | 1 | ع |
| `/commerce` | en-dark-1440 | 1 | ع |
| `/commerce/delivery` | en-dark-1440 | 1 | ع |
| `/commerce/domains` | en-dark-1440 | 1 | ع |
| `/commerce/gifting` | en-dark-1440 | 1 | ع |
| `/commerce/integrations` | en-dark-1440 | 1 | ع |
| `/commerce/merchandising` | en-dark-1440 | 1 | ع |
| `/commerce/onboarding` | en-dark-1440 | 1 | ع |
| `/commerce/published-products` | en-dark-1440 | 1 | ع |
| `/commerce/stores` | en-dark-1440 | 1 | ع |
| `/commerce/themes` | en-dark-1440 | 1 | ع |
| `/forgot-password` | en-light-390 | 1 | ع |
| `/fuel-stations` | en-light-390 | 1 | ع |
| `/fuel-stations/alerts` | en-light-390 | 1 | ع |
| `/fuel-stations/avi-rfid` | en-light-390 | 1 | ع |
| `/fuel-stations/corporate-contracts` | en-light-390 | 1 | ع |
| `/fuel-stations/devices` | en-light-390 | 1 | ع |
| `/fuel-stations/maintenance` | en-light-390 | 1 | ع |
| `/fuel-stations/master-data` | en-light-390 | 1 | ع |
| `/fuel-stations/readiness` | en-light-390 | 1 | ع |
| `/fuel-stations/receiving` | en-light-390 | 1 | ع |
| `/fuel-stations/safety` | en-light-390 | 1 | ع |
| `/fuel-stations/sales` | en-light-390 | 1 | ع |
| `/fuel-stations/settings` | en-light-390 | 1 | ع |
| `/fuel-stations/shifts` | en-light-390 | 1 | ع |
| `/login` | en-light-390 | 1 | ع |
| `/me` | en-light-390 | 1 | ع |
| `/register` | en-light-390 | 1 | ع |
| `/reset-password` | en-light-390 | 1 | ع |
| `/verify-email` | en-light-390 | 1 | تأكيد البريد الإلكتروني |

Routes with Arabic chrome in EN: 200

## Structure: h1 count, heading skips, main landmark

| Route | Config | h1 | main | heading skips | h1 text |
|---|---|---|---|---|---|
| `/_not-found` | ar-light-1440 | 1 | 0 | 0 | 404 |
| `/dev/customizer-versions` | ar-light-1440 | 1 | 0 | 0 | 404 |
| `/dev/customizer-visual` | ar-light-1440 | 1 | 0 | 0 | 404 |
| `/dev/trust-visual` | ar-light-1440 | 1 | 0 | 0 | 404 |
| `/document-qa` | ar-light-1440 | 2 | 1 | 0 | مركز معاينة المستندات |
| `/fuel-stations/settings` | ar-light-1440 | 0 | 1 | 0 |  |
| `/icon.ico` | ar-light-1440 | 0 | 0 | 0 |  |
| `/pos/audit` | ar-light-1440 | 1 | 2 | 0 | الرقابة والتدقيق |

## Targets smaller than 24×24 CSS px at 390px (v3, ar-light-390)

| Route | Count | Samples |
|---|---|---|
| `/commerce/appearance` | 5 | الرئيسية; الرأس والتنقل; الهوية; التذييل; الهوية |
| `/login` | 2 | نسيت كلمة المرور؟; العودة للرئيسية |
| `/` | 1 | انتقل إلى المحتوى الرئيسي |
| `/accounting-settings/account-routing` | 1 | الرجوع إلى إعدادات المحاسبة |
| `/auth/handoff` | 1 | العودة لتسجيل الدخول |
| `/dashboard` | 1 | إدارة الورديات ← |
| `/delivery-notes/invoice-draft` | 1 | العودة إلى سندات التسليم |
| `/expenses/new` | 1 | INPUT |
| `/financial-alerts` | 1 | الإعدادات |
| `/forgot-password` | 1 | العودة لتسجيل الدخول |
| `/fuel-stations/receiving` | 1 | العودة إلى مساحة المحطات |
| `/help/create-sales-invoice` | 1 | مركز مساعدة أَوْج |
| `/invoices/:id/edit` | 1 | الخصم والشحن والتسويةعرض |
| `/invoices/new` | 1 | الخصم والشحن والتسويةعرض |
| `/partners/:id` | 1 | حساب الأستاذ ↗ |
| `/pos/settings/sound-feedback` | 1 | INPUT |
| `/register` | 1 | العودة للرئيسية |
| `/reports/sales` | 1 | العودة إلى مركز التقارير |
| `/reports/customers/balances` | 1 | العودة إلى تقارير العملاء |
| `/reports/inventory/value` | 1 | العودة إلى تقارير المخزون |
| `/reports/purchases/balances` | 1 | العودة إلى تقارير المشتريات |
| `/reports/sales/by-customer` | 1 | العودة إلى تقارير المبيعات |
| `/reports/sales/delivery-channel` | 1 | العودة إلى تقارير المبيعات |
| `/verify-email` | 1 | العودة لتسجيل الدخول |

## Redirects, non-200 and visible error states

| Route | Config | UI | HTTP | Final path | Error-text detected | navErr |
|---|---|---|---|---|---|---|
| `/_not-found` | ar-light-1440 | 3 | 404 | `/_not-found` | False |  |
| `/auth/handoff` | ar-light-1440 | 3 | 200 | `/auth/handoff` | True |  |
| `/dev/customizer-versions` | ar-light-1440 | 3 | 404 | `/dev/customizer-versions` | False |  |
| `/dev/customizer-visual` | ar-light-1440 | 3 | 404 | `/dev/customizer-visual` | False |  |
| `/dev/trust-visual` | ar-light-1440 | 3 | 404 | `/dev/trust-visual` | False |  |
| `/pos` | ar-light-1440 | 3 | 200 | `/pos/start` | False |  |
| `/pos/settings/printing` | ar-light-1440 | 3 | 200 | `/pos/settings/configuration` | False |  |
| `/pos/settings/sound-feedback` | ar-light-1440 | 3 | 200 | `/pos/settings/sound-feedback` | True |  |
| `/sales-settings/designs` | ar-light-1440 | 3 | 200 | `/document-design` | False |  |
| `/_not-found` | ar-light-1440 | legacy | 404 | `/_not-found` | False |  |
| `/auth/handoff` | ar-light-1440 | legacy | 200 | `/auth/handoff` | True |  |
| `/dev/customizer-versions` | ar-light-1440 | legacy | 404 | `/dev/customizer-versions` | False |  |
| `/dev/customizer-visual` | ar-light-1440 | legacy | 404 | `/dev/customizer-visual` | False |  |
| `/dev/trust-visual` | ar-light-1440 | legacy | 404 | `/dev/trust-visual` | False |  |
| `/pos` | ar-light-1440 | legacy | 200 | `/pos/start` | False |  |
| `/pos/settings/printing` | ar-light-1440 | legacy | 200 | `/pos/settings/configuration` | False |  |
| `/pos/settings/sound-feedback` | ar-light-1440 | legacy | 200 | `/pos/settings/sound-feedback` | True |  |
| `/sales-settings/designs` | ar-light-1440 | legacy | 200 | `/document-design` | False |  |

## Time to DOMContentLoaded + network idle (capped 4–12 s; ar-light-1440, v3)

| Route | ms |
|---|---|
| `/accounting-settings` | 12754 |
| `/accounting-settings/period-locks` | 12580 |
| `/documents/operations` | 12573 |
| `/accounting-settings/account-routing` | 12532 |
| `/accounts` | 12512 |
| `/documents` | 12497 |
| `/assets` | 12492 |
| `/accounting-settings/fiscal-years` | 12491 |
| `/documents/governance` | 12490 |
| `/documents/settings` | 12485 |
| `/assets/new` | 12484 |
| `/cost-centers` | 12480 |
| `/documents/usage` | 4887 |
| `/journal-entries` | 4525 |
| `/journal-entries/:id` | 4481 |
| `/` | 2438 |
| `/employee-custodies` | 2195 |
| `/pos` | 1989 |
| `/branches/:id` | 1983 |
| `/payments/new` | 1869 |
| `/products/:id/edit` | 1864 |
| `/reports/sales/by-customer` | 1823 |
| `/fuel-stations/avi-rfid` | 1820 |
| `/suppliers/:id/statement` | 1820 |
| `/expenses/new` | 1799 |
