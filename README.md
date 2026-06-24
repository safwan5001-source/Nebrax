# نبراس ERP — النواة المالية (التسليم الأول)

نواة محاسبية production-grade: قيد مزدوج صارم + عزل multi-tenant تلقائي + دليل حسابات سعودي.

> **الواجهة (Next.js) في `web/`.** لنشرها على Vercel اضبط **Root Directory = `web`** — انظر [`web/DEPLOY.md`](web/DEPLOY.md). الـ backend (Laravel/PHP) يُستضاف خارج Vercel.

## ما تم تسليمه
| الملف | الدور |
|------|------|
| `docs/ARCHITECTURE.md` | المخطط المعماري الكامل |
| `database/migrations/...000001` | المستأجرون + المستخدمون + التوكنات |
| `database/migrations/...000002` | دليل الحسابات + القيود + الأرصدة |
| `app/Tenancy/TenantContext.php` | سياق المستأجر + Global Scope للعزل |
| `app/Models/BaseModel.php` | نموذج أساس يعزل تلقائياً بالمستأجر |
| `app/Models/Account.php` | نماذج الحسابات والقيود |
| `app/Services/Accounting/LedgerService.php` | **محرك القيد المزدوج (النواة)** |
| `app/Services/Accounting/ChartOfAccountsSeeder.php` | دليل حسابات سعودي افتراضي |
| `app/Http/Middleware/SetTenant.php` | حقن المستأجر من التوكن |

## التشغيل داخل مشروع Laravel
```bash
composer create-project laravel/laravel nibras-erp
# انسخ مجلدات app/ و database/ فوق المشروع
php artisan migrate
```

## مثال استخدام المحرك — تسجيل فاتورة مبيعات نقدية (1150 ريال شامل ضريبة)
```php
$ledger = app(LedgerService::class);

// بيع بـ 1000 ريال + 15% ضريبة = 1150 ريال نقداً
$ledger->post([
    ['account_id' => $cashAccountId,      'debit'  => 115000], // الصندوق  1150.00
    ['account_id' => $salesRevenueId,     'credit' => 100000], // إيرادات  1000.00
    ['account_id' => $vatOutputId,        'credit' => 15000],  // ضريبة      150.00
], [
    'description' => 'فاتورة مبيعات نقدية INV-001',
    'source_type' => 'invoice',
    'source_id'   => $invoiceId,
]);
```

## الضمانات المعمارية المطبّقة
- **توازن إجباري**: أي قيد غير متوازن (مدين ≠ دائن) يُرفض بـ exception.
- **عزل تلقائي**: لا يمكن لمستأجر رؤية بيانات آخر — مفروض على مستوى ORM.
- **Immutability**: القيود المرحّلة لا تُعدّل — التصحيح بـ `reverse()` فقط.
- **دقة نقدية**: لا floating point — كل المبالغ هللات (bigint).
- **منع القيود على حسابات تجميعية**: محمي في `assertPostable()`.

## الخطوة التالية المقترحة
الوحدة 3: الأطراف (عملاء/موردون) + المنتجات، ثم الوحدة 4: الفوترة التي تولّد قيوداً تلقائياً عبر هذا المحرك.
