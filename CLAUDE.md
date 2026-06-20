# نبراس ERP — سياق المشروع

نظام محاسبي سحابي **ERP متعدد المستأجرين (SaaS)** بنموذج اشتراكات، مرجعه الوظيفي دفترة.
**اللغة:** تواصل بالعربية. الواجهات RTL أولاً.

## الحالة الحالية

النواة المالية مكتملة ومختبَرة: محرك القيد المزدوج + عزل multi-tenant + دليل حسابات سعودي.
الوحدات القادمة بالترتيب: الأطراف+المنتجات → الفوترة → المخزون → التقارير → ZATCA → POS/HR.

## الـ Stack

- **Backend:** Laravel 11 + PostgreSQL (الإنتاج) / SQLite (الاختبار)
- **Auth:** Sanctum (JWT) + RBAC
- **Frontend (لاحقاً):** Next.js 15 + TypeScript + Tailwind + shadcn/ui — RTL
- **Cache/Queue:** Redis + Horizon. **Storage:** S3/R2.

## قواعد معمارية غير قابلة للكسر

1. **القيد المزدوج صارم:** كل معاملة = قيد متوازن (Σ مدين = Σ دائن). غير المتوازن يُرفض.
1. **النقود بالـ minor units (هللات) كـ `bigint`.** ممنوع `float`/`double` في أي حساب مالي. 100.50 ريال = 10050.
1. **القيود immutable بعد الترحيل.** التصحيح بقيد عكسي عبر `LedgerService::reverse()` فقط.
1. **العزل تلقائي:** كل نموذج أعمال يرث `BaseModel` (فيه `TenantScope` + `BelongsToTenant`). ممنوع استعلام يدوي يتجاوز الـ scope.
1. **الحسابات التجميعية (`is_group`) لا تقبل قيوداً مباشرة.**
1. **`TenantContext` مسجّل singleton** في `TenancyServiceProvider` — حاسم للعزل.
1. **PSR-4:** كلاس واحد لكل ملف.

## بنية الملفات الأساسية

```
app/Models/            BaseModel, Tenant, User, Account, JournalEntry, JournalLine, AccountBalance
app/Tenancy/           TenantContext, TenantScope, BelongsToTenant
app/Services/Accounting/  LedgerService (المحرك), ChartOfAccountsSeeder
app/Http/Middleware/   SetTenant
app/Providers/         TenancyServiceProvider
database/migrations/   tenants_and_users, accounting_core
tests/Feature/         LedgerTest
```

## المحرك — العقد (Contract)

```php
app(LedgerService::class)->post(array $lines, array $meta): JournalEntry;
// $lines: [['account_id'=>uuid,'debit'=>int,'credit'=>int,'partner_type'=>?,'partner_id'=>?], ...]
app(LedgerService::class)->reverse(JournalEntry $e, ?string $date, ?string $reason): JournalEntry;
```

أي وحدة جديدة (فاتورة/دفعة/مشترى) **تولّد قيودها عبر هذا المحرك** — لا كتابة مباشرة في journal_lines.

## أوامر متحقَّقة

```bash
php artisan migrate:fresh        # تهيئة القاعدة
php artisan test --filter=LedgerTest   # 5 اختبارات يجب أن تكون خضراء
php artisan serve
```

**قبل أي commit: شغّل `php artisan test` ويجب أن تنجح كل الاختبارات.**

## دليل الحسابات (الأكواد المرجعية)

1110 الصندوق · 1120 البنك · 1130 العملاء · 1140 المخزون · 1150 ضريبة مدخلات
2110 الموردون · 2120 ضريبة مخرجات · 3110 رأس المال
4110 إيرادات المبيعات · 5110 تكلفة البضاعة · 5140 الوقود

## بيانات شركة المرجع (نبراس الطموح — للاختبار)

الرقم الضريبي 15 خانة · العملة SAR · ضريبة VAT 15% · المدن: الدمام، الجبيل، الخبر، الظهران، الأحساء.

## مبادئ العمل

- بناء **وحدة وحدة**، كل واحدة قابلة للتشغيل والاختبار قبل التالية.
- تشخيص المشكلة منهجياً قبل تعديل الكود.
- مراجعة يدوية للتغييرات — لا وضع autonomous على كود محاسبي حسّاس.
- تجنّب الأنماط الزائدة؛ كود نظيف قابل للصيانة، معماري لا مبتدئ.

## قواعد التحقق المحاسبي الإلزامية

هذه القواعد **مُلزِمة ذاتياً في كل مهمة** — تُطبَّق دون طلب على كل ما بُني سابقاً وكل ما سيُبنى:

1. **مرور إجباري عبر المحرك:** كل وحدة تولّد أثراً محاسبياً (فاتورة، دفعة، مشترى، مرتجع، تسوية) يجب أن تمرّ عبر `LedgerService::post` حصراً. **ممنوع منعاً باتاً** الكتابة المباشرة في `journal_lines` أو `journal_entries`.
1. **الإجماليات مشتقة لا مُدخلة:** كل مبلغ إجمالي (`subtotal`, `tax_amount`, `total`) يُحسب من السطور (line items)، ولا يُدخله المستخدم يدوياً إطلاقاً. تُعاد الإجماليات من السطور (مصدر الحقيقة) **قبل توليد أي قيد**.
1. **توازن وربط:** كل قيد متوازن (Σ مدين = Σ دائن)، ومربوط بمصدره عبر `source_type` و`source_id` ليكون له أثر رجعي كامل.
1. **النقود بالهللات:** كل المبالغ `bigint` بالهللات (minor units)، ممنوع `float`/`double` في أي حساب مالي.
1. **العزل:** كل نموذج أعمال يرث `BaseModel` ويُعزل تلقائياً بالـ tenant.
1. **بروتوكول ما قبل أي Pull Request (إلزامي):**
   - شغّل `php artisan test` **كاملاً** (لا `--filter`)، ويجب أن تكون **كل** الاختبارات خضراء.
   - ثم اكتب في الرسالة **القيد المحاسبي الناتج لكل عملية مالية جديدة** في الوحدة (الحسابات، المدين، الدائن) بصيغة **جدول واضح** للمراجعة قبل الموافقة على الدمج.
   - **لا تطلب فتح PR قبل عرض القيود الناتجة.**

## الخطوة التالية

وحدة الفوترة: `Partner` (عميل/مورد) + `Product` + `Invoice` تولّد قيداً تلقائياً عبر `LedgerService`.