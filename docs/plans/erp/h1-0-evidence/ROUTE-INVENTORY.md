# AWJ-ERP-UX-H1-0 — Route & module inventory (generated from real-browser crawl)

Columns: **Loads** = page loads across v3/legacy × locale × theme × width; **HTTP** = document status; **Redirect** = final path when it differs; **API ≥400** = status codes seen from `/api/*` during load; **axe (v3)** = rule ids on any v3 run; **ox@320** = page-level horizontal overflow at 320px (v3, AR light).

| Module group | Routes crawled |
|---|---|
| Sales | 32 |
| Customers | 9 |
| Purchases | 22 |
| Inventory | 22 |
| Accounting | 12 |
| Finance | 15 |
| HR | 1 |
| Reports | 15 |
| POS | 12 |
| Documents | 7 |
| Settings & admin | 21 |
| Commerce / App Builder (separate posture) | 13 |
| Fuel stations (separate workspace) | 13 |
| Auth / self-service / dev | 12 |
| Other | 1 |
| **Total** | **207** URLs (= 204 of 231 manifest entries; `/reports/general/*` URLs share one dynamic entry) |


## Sales

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/credit-notes` | الإشعارات الدائنة | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/credit-notes/new` | إشعار دائن جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, link-in-text-block | 12 |  |
| `/customer-refunds` | استرداد العميل | 9 | 200 |  |  | aria-hidden-focus, label | 12 |  |
| `/delivery-hub` | صندوق التوصيل | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/delivery-notes` | سندات التسليم | 9 | 200 |  | 403 | aria-hidden-focus | 12 |  |
| `/delivery-notes/invoice-draft` | إنشاء مسودة فاتورة مبيعات | 9 | 200 |  | 403 | aria-hidden-focus, heading-order | 12 |  |
| `/delivery-notes/new` | سند تسليم جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/delivery-platforms` | منصات التوصيل | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/invoices` | الفواتير | 9 | 200 |  |  | aria-hidden-focus, empty-table-header | 12 |  |
| `/invoices/:id` | INV-2026-00001 | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/invoices/:id/edit` | تعديل الفاتورة | 9 | 200 |  |  | aria-hidden-focus, button-name, target-size | 12 |  |
| `/invoices/:id/payments/new` | إضافة عملية دفع | 9 | 200 |  |  | aria-hidden-focus, heading-order, landmark-unique | 12 |  |
| `/invoices/new` | INV-2026-00004 | 9 | 200 |  |  | aria-hidden-focus, button-name, target-size | 12 |  |
| `/payments` | المدفوعات | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/payments/:id` | REC-2026-00001 | 9 | 200 |  |  | aria-hidden-focus, color-contrast, heading-order | 12 |  |
| `/payments/new` | تسجيل دفعة | 9 | 200 |  |  | aria-hidden-focus, heading-order, landmark-unique | 12 |  |
| `/quotes` | عروض الأسعار | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/quotes/new` | عرض سعر جديد | 9 | 200 |  |  | aria-hidden-focus, button-name, heading-order, label | 12 |  |
| `/recurring-invoices` | الفواتير الدورية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/recurring-invoices/new` | فاتورة دورية جديدة | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/returns` | المرتجعات | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/sales-settings` | إعدادات المبيعات | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/sales-settings/designs` | مركز قوالب الطباعة | 9 | 200 | /document-design |  | aria-hidden-focus | 12 |  |
| `/sales-settings/einvoice` | ربط الفوترة الإلكترونية مع ZATCA | 9 | 200 |  |  | aria-hidden-focus, heading-order, landmark-unique | 12 |  |
| `/sales-settings/fields` | حقول الفواتير الإضافية | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/sales-settings/invoices` | إعدادات الفواتير | 9 | 200 |  |  | aria-hidden-focus, heading-order, link-in-text-block | 12 |  |
| `/sales-settings/orders` | إعدادات أوامر البيع | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/sales-settings/pricelists` | قوائم الأسعار | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/sales-settings/quotes` | إعدادات عروض الأسعار | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/sales-settings/shipping` | خيارات الشحن | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/sales-settings/sources` | مصادر الطلب | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/sales-settings/statuses` | حالات الفواتير | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |

## Customers

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/appointments` | المواعيد | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/contacts` | قائمة الاتصال | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/crm` | إدارة علاقات العملاء | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/customer-settings` | إعدادات العميل | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/partners` | العملاء والموردون | 9 | 200 |  |  | aria-hidden-focus, empty-table-header | 12 |  |
| `/partners/:id` | مؤسسة الطموح للتجارة | 9 | 200 |  |  | aria-hidden-focus, scrollable-region-focusable, target-size | 12 |  |
| `/partners/:id/edit` | تعديل بيانات الطرف | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/partners/:id/statement` | كشف حساب العميل | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/partners/new` | طرف جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |

## Purchases

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/debit-notes` | إشعارات مدينة | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/debit-notes/new` | إشعار مدين جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/purchase-orders` | أوامر الشراء | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/purchase-orders/new` | أمر شراء جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/purchase-quotes` | عروض أسعار الموردين | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/purchase-quotes/new` | عرض سعر مورّد جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/purchase-requests` | طلبات الشراء | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/purchase-requests/new` | طلب شراء جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/purchase-returns` | مرتجعات المشتريات | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/purchase-settings` | إعدادات المشتريات | 9 | 200 |  |  | aria-hidden-focus, heading-order, link-in-text-block | 12 |  |
| `/purchases` | المشتريات | 9 | 200 |  |  | aria-hidden-focus, empty-table-header | 12 |  |
| `/purchases/:id` | BILL-2026-00001 | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/purchases/:id/edit` | تعديل فاتورة الشراء | 9 | 200 |  |  | aria-hidden-focus, heading-order, label | 12 |  |
| `/purchases/:id/payments/new` | إضافة عملية دفع | 9 | 200 |  |  | aria-hidden-focus, heading-order, landmark-unique | 12 |  |
| `/purchases/new` | فاتورة شراء جديدة | 9 | 200 |  |  | aria-hidden-focus, heading-order, label | 12 |  |
| `/rfq` | طلبات عروض الأسعار | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/rfq/new` | طلب عروض أسعار جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/supplier-payments` | مدفوعات الموردين | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/supplier-refunds` | استرداد المورّد | 9 | 200 |  |  | aria-hidden-focus, label | 12 |  |
| `/suppliers` | إدارة الموردين | 9 | 200 |  |  | aria-hidden-focus, empty-table-header | 12 |  |
| `/suppliers/:id/ledger` | حركة حساب المورد | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/suppliers/:id/statement` | كشف حساب المورد | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |

## Inventory

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/inventory` | أرصدة المخزون | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/inventory-openings` | الأرصدة الافتتاحية للمخزون | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/inventory-openings/import` | استيراد رصيد افتتاحي | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/inventory-settings` | إعدادات المخزون والمنتجات | 9 | 200 |  |  | aria-hidden-focus, color-contrast, heading-order | 12 |  |
| `/inventory-settings/brands` | العلامات التجارية | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/inventory-settings/categories` | التصنيفات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/inventory-settings/products` | إعدادات المنتجات | 9 | 200 |  |  | aria-hidden-focus, color-contrast, heading-order | 12 |  |
| `/inventory-settings/units` | قوالب الوحدات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/products` | إدارة المنتجات | 9 | 200 |  |  | aria-hidden-focus, empty-table-header | 12 |  |
| `/products/:id` | زيت محرك صناعي عالي الأداء لمحركات الديز | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/products/:id/edit` | زيت محرك صناعي عالي الأداء لمحركات الديز | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 32 |  |
| `/products/import` | استيراد المنتجات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/products/new` | إضافة منتج | 9 | 200 |  |  | aria-hidden-focus, heading-order, select-name | 12 |  |
| `/products/workbook-import` | استيراد منتجات / باركود / أسعار وحدات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/stock-permits` | الأذون المخزنية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/stock-permits/new` | إذن مخزني جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/stocktaking` | إدارة الجرد | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/stocktaking/new` | فتح جرد | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/warehouses` | المخازن | 9 | 200 |  |  | aria-hidden-focus, empty-table-header | 12 |  |
| `/warehouses/:id` | تعديل مخزن | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/warehouses/:id/stock` | أرصدة المخزن | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/warehouses/new` | إضافة مخزن | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |

## Accounting

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/accounting-settings` | إعدادات المحاسبة | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/accounting-settings/account-routing` | توجيه الحسابات | 9 | 200 |  |  | aria-hidden-focus, heading-order, select-name | 12 |  |
| `/accounting-settings/fiscal-years` | السنوات المالية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/accounting-settings/period-locks` | أقفال الفترات المحاسبية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/accounts` | دليل الحسابات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/assets` | إدارة الأصول | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/assets/new` | تسجيل أصل ثابت | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/cost-centers` | مراكز التكلفة | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/journal-entries` | القيود اليومية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/journal-entries/:id` | JE-2026-00003 | 9 | 200 |  |  | aria-hidden-focus, color-contrast, heading-order | 12 |  |
| `/manual-journals` | القيود اليومية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/manual-journals/new` | قيد يومية يدوي جديد | 9 | 200 |  |  | aria-hidden-focus, heading-order, select-name | 12 |  |

## Finance

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/cash-and-bank` | خزائن وحسابات بنكية | 9 | 200 |  |  | aria-hidden-focus, button-name, empty-table-header | 12 |  |
| `/cash-and-bank/new` | إضافة خزينة | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/cash-and-bank/transfer` | تحويل بين الخزائن والحسابات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/employee-custodies` | عُهَد الموظفين | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/employee-custodies/new` | إضافة عهدة موظف | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/expenses` | المصروفات | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/expenses/categories` | تصنيفات المصروفات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/expenses/new` | تسجيل مصروف | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/finance-settings` | إعدادات المالية | 9 | 200 |  |  | aria-hidden-focus, color-contrast | 12 |  |
| `/finance-settings/financial-alerts` | إعدادات تنبيهات الرقابة المالية | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/finance-settings/settlement-types` | أنواع التسوية | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/financial-alerts` | تنبيهات الرقابة المالية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/payment-methods` | طرق الدفع | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/receipt-vouchers` | سندات القبض | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/receipt-vouchers/new` | إضافة سند قبض | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |

## HR

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/hr` | الموارد البشرية | 9 | 200 |  |  | aria-hidden-focus | 12 |  |

## Reports

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/reports` | مركز التقارير | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/classification-analytics` | تحليل التصنيفات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/customers/aging` | أعمار ديون العملاء | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/customers/balances` | أرصدة العملاء | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/reports/general/account-ledger` | كشف حساب الأستاذ | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/reports/general/balance-sheet` | الميزانية العمومية | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/general/income-statement` | قائمة الدخل | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/general/trial-balance` | ميزان المراجعة | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/inventory/value` | قيمة المخزون | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/reports/purchases/aging` | أعمار ديون الموردين | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/purchases/balances` | أرصدة الموردين | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/sales` | تقارير المبيعات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/sales/by-customer` | المبيعات حسب العميل | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/sales/delivery-channel` | مبيعات منصات التوصيل | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/reports/settings/classifications` | سياسة تعديل التصنيفات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |

## POS

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/pos` | فتح جلسة بيع | 9 | 200 | /pos/start |  | aria-hidden-focus | 12 |  |
| `/pos/audit` | الرقابة والتدقيق | 9 | 200 |  |  | aria-hidden-focus, landmark-main-is-top-level, landmark-no-duplicate-main, landmark-unique | 12 |  |
| `/pos/report` | تقرير نقاط البيع | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/pos/sessions` | جلسات نقطة البيع | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/pos/settings` | إعدادات نقاط البيع | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/pos/settings/cash-drawer` | درج النقدية | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/pos/settings/configuration` | تهيئة نقاط البيع | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/pos/settings/devices` | أجهزة نقاط البيع | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/pos/settings/printing` | تهيئة نقاط البيع | 9 | 200 | /pos/settings/configuration |  | aria-hidden-focus, heading-order | 12 |  |
| `/pos/settings/shifts` | ورديات نقاط البيع | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/pos/settings/sound-feedback` | الأصوات والتنبيهات | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 | yes |
| `/pos/start` | فتح جلسة بيع | 9 | 200 |  |  | aria-hidden-focus | 12 |  |

## Documents

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/document-design` | مركز قوالب الطباعة | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/document-qa` | مركز معاينة المستندات | 9 | 200 |  |  | color-contrast, svg-img-alt | 0 |  |
| `/documents` | مركز المستندات | 9 | 200 |  | 403 | aria-hidden-focus | 12 |  |
| `/documents/governance` | حوكمة الاحتفاظ والحجب | 9 | 200 |  | 403 | aria-hidden-focus | 12 |  |
| `/documents/operations` | عمليات المستندات | 9 | 200 |  | 403 | aria-hidden-focus | 12 |  |
| `/documents/settings` | إعدادات مركز المستندات | 9 | 200 |  | 403 | aria-hidden-focus | 12 |  |
| `/documents/usage` | استخدام معالجة المستندات | 9 | 200 |  | 403 | aria-hidden-focus | 12 |  |

## Settings & admin

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/applications` | إدارة التطبيقات | 9 | 200 |  |  | aria-hidden-focus, color-contrast | 12 |  |
| `/branches` | إدارة الفروع | 9 | 200 |  |  | aria-hidden-focus, empty-table-header | 12 |  |
| `/branches/:id` | تعديل فرع | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/branches/new` | إضافة فرع | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/branches/settings` | إعدادات الفروع | 9 | 200 |  |  | aria-hidden-focus, heading-order | 12 |  |
| `/dashboard` | لوحة التحكم | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/developer` | المطورون | 9 | 200 |  |  | aria-hidden-focus, scrollable-region-focusable | 12 |  |
| `/developer/docs` | توثيق الواجهة | 9 | 200 |  |  | aria-hidden-focus, heading-order, landmark-unique | 12 |  |
| `/developer/keys` | مفاتيح API | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/developer/security` | الأمان والتكامل | 9 | 200 |  |  | aria-hidden-focus, scrollable-region-focusable | 12 |  |
| `/developer/webhooks` | Webhooks | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/help` | مركز مساعدة أَوْج | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/help/create-sales-invoice` | إنشاء فاتورة مبيعات | 9 | 200 |  |  | aria-hidden-focus, landmark-unique | 12 |  |
| `/integrations` | مركز التكاملات | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/integrations/delivery-platforms` | منصات التوصيل | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/integrations/delivery-platforms/jahez` | جاهز | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/notifications` | الإشعارات | 9 | 200 |  |  | aria-hidden-focus | 12 |  |
| `/numbering-settings` | إعدادات الترقيم المتسلسل | 9 | 200 |  |  | aria-hidden-focus, heading-order, link-in-text-block | 12 |  |
| `/settings` | إعدادات الحساب | 9 | 200 |  |  | aria-hidden-focus, heading-order, landmark-unique | 12 |  |
| `/tax-settings` | إعدادات الضرائب | 9 | 200 |  |  | aria-hidden-focus, heading-order, label, select-name | 12 |  |
| `/whats-new` | ما الجديد | 9 | 200 |  |  | aria-hidden-focus | 12 |  |

## Commerce / App Builder (separate posture)

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/app-builder` | تطبيقات AWJ | 9 | 200 |  |  | link-name | 0 |  |
| `/app-builder/new` | إنشاء تطبيق | 9 | 200 |  |  | heading-order, link-name | 0 |  |
| `/commerce` | مركز قيادة التجارة | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/appearance` | متجر النور | 9 | 200 |  |  | aria-hidden-focus, label | 0 |  |
| `/commerce/delivery` | التوصيل وإعدادات القناة | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/domains` | النطاقات | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/gifting` | الإهداء | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/integrations` | التكاملات | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/merchandising` | التسويق والتصنيف | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/onboarding` | التهيئة الموجَّهة | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/published-products` | المنتجات المنشورة | 9 | 200 |  |  | aria-valid-attr-value, link-name | 0 |  |
| `/commerce/stores` | المتاجر | 9 | 200 |  |  | link-name | 0 |  |
| `/commerce/themes` | معرض الثيمات | 9 | 200 |  |  | link-name | 0 |  |

## Fuel stations (separate workspace)

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/fuel-stations` | مركز قيادة محطات الوقود | 9 | 200 |  | 403 | link-name | 0 |  |
| `/fuel-stations/alerts` | تنبيهات محطات الوقود | 9 | 200 |  | 403 | heading-order, link-name, select-name | 0 |  |
| `/fuel-stations/avi-rfid` | التزويد الذكي AVI/RFID | 9 | 200 |  | 403 | link-name | 0 |  |
| `/fuel-stations/corporate-contracts` | عقود وقود الشركات | 9 | 200 |  | 403 | link-name | 0 |  |
| `/fuel-stations/devices` | الأجهزة وسجل التكامل | 9 | 200 |  | 403 | link-name | 0 |  |
| `/fuel-stations/maintenance` | صيانة محطات الوقود | 9 | 200 |  | 403 | heading-order, link-name, select-name | 0 |  |
| `/fuel-stations/master-data` | بيانات محطات الوقود | 9 | 200 |  | 403 | link-name | 0 |  |
| `/fuel-stations/readiness` | ملخص الجاهزية والصحة | 9 | 200 |  | 403 | heading-order, link-name | 0 |  |
| `/fuel-stations/receiving` | توريد واستلام الوقود | 9 | 200 |  | 403 | heading-order, link-name | 0 |  |
| `/fuel-stations/safety` | السلامة والامتثال | 9 | 200 |  | 403 | heading-order, link-name, select-name | 0 |  |
| `/fuel-stations/sales` | مبيعات الوقود | 9 | 200 |  | 403 | link-name | 0 |  |
| `/fuel-stations/settings` |  | 9 | 200 |  | 403 | link-name, page-has-heading-one | 0 |  |
| `/fuel-stations/shifts` | الشفت التشغيلي والساحة | 9 | 200 |  | 403 | link-name | 0 |  |

## Auth / self-service / dev

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/` | أدر مبيعاتك ومصاريفك ومخزونك من مكان واح | 9 | 200 |  |  | color-contrast | 0 |  |
| `/_not-found` | 404 | 9 | 404 |  |  | landmark-one-main, region | 0 |  |
| `/auth/handoff` | جارٍ نقلك إلى مؤسستك… | 9 | 200 |  |  |  | 0 | yes |
| `/dev/customizer-versions` | 404 | 9 | 404 |  |  | landmark-one-main, region | 0 |  |
| `/dev/customizer-visual` | 404 | 9 | 404 |  |  | landmark-one-main, region | 0 |  |
| `/dev/trust-visual` | 404 | 9 | 404 |  |  | landmark-one-main, region | 0 |  |
| `/forgot-password` | استرداد كلمة المرور | 9 | 200 |  |  |  | 0 |  |
| `/login` | تسجيل الدخول | 9 | 200 |  |  |  | 0 |  |
| `/me` | مرحباً، | 9 | 200 |  | 403 | heading-order | 0 |  |
| `/register` | إنشاء حساب جديد | 9 | 200 |  |  |  | 0 |  |
| `/reset-password` | تعيين كلمة مرور جديدة | 9 | 200 |  |  |  | 0 |  |
| `/verify-email` | تأكيد البريد الإلكتروني | 9 | 200 |  | 422 |  | 0 |  |

## Other

| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |
|---|---|---|---|---|---|---|---|---|
| `/icon.ico` |  | 9 | 200 |  |  | html-has-lang, image-alt, landmark-one-main, page-has-heading-one, region | 0 |  |

## Dynamic routes not crawled (no fixture record in the isolated test tenant)

These routes exist in the build manifest but need a record the test tenant did not have. They are **NOT VERIFIED** in the browser by H1-0; their shared components were covered through sibling list/new routes.

- `/app-builder/[id]`
- `/app-builder/[id]/builder`
- `/app-builder/[id]/versions`
- `/cash-and-bank/[id]`
- `/credit-notes/[id]`
- `/customer-refunds/[id]`
- `/delivery-notes/[id]`
- `/delivery-notes/[id]/edit`
- `/documents/[id]`
- `/documents/[id]/diagnostics`
- `/employee-custodies/[id]`
- `/expenses/[id]`
- `/hr/employees/[id]`
- `/inventory-openings/[id]`
- `/manual-journals/[id]`
- `/pos/sessions/[id]`
- `/purchase-orders/[id]`
- `/purchase-quotes/[id]`
- `/purchase-requests/[id]`
- `/quotes/[id]`
- `/receipt-vouchers/[id]`
- `/recurring-invoices/[id]`
- `/returns/[id]`
- `/rfq/[id]`
- `/stock-permits/[id]`
- `/stocktaking/[id]`
- `/supplier-refunds/[id]`
