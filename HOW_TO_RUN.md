# كيف تشغّل وتختبر — نبراس ERP

عندك 3 طرق. اختر حسب وضعك. **الأسرع للاختبار = الطريقة A**.

---

## الطريقة A — تلقائي بأمر واحد (موصى بها)

**المتطلبات:** PHP 8.2+ و Composer مثبتان.

```bash
cd nibras-erp
bash setup.sh
```

السكربت يفعل كل شيء تلقائياً:
1. ينشئ مشروع Laravel كامل
2. يدمج النواة (النماذج، المحرك، الـ migrations)
3. يجهّز قاعدة SQLite
4. **يشغّل الاختبارات ويثبت أن المحرك يعمل**

ستشاهد في النهاية نتيجة الاختبارات (5 اختبارات تثبت: توازن القيود، رفض غير المتوازن، رفض الحسابات التجميعية، العكس، العزل بين المستأجرين).

---

## الطريقة B — Docker (بدون تثبيت PHP محلياً)

**المتطلبات:** Docker فقط.

```bash
cd nibras-erp
docker build -t nibras-erp .
docker run --rm nibras-erp
```

يبني البيئة كاملة داخل حاوية ويشغّل الاختبارات. لا يلوّث جهازك.

---

## الطريقة C — يدوي (لفهم كل خطوة)

```bash
# 1. أنشئ مشروع Laravel
composer create-project laravel/laravel nibras-app
cd nibras-app
composer require laravel/sanctum

# 2. انسخ النواة فوق المشروع
cp -r ../nibras-erp/app/Models/*.php            app/Models/
mkdir -p app/Services/Accounting app/Tenancy
cp -r ../nibras-erp/app/Services/Accounting/*   app/Services/Accounting/
cp -r ../nibras-erp/app/Tenancy/*               app/Tenancy/
cp -r ../nibras-erp/app/Http/Middleware/*       app/Http/Middleware/
cp -r ../nibras-erp/database/migrations/*       database/migrations/
cp -r ../nibras-erp/tests/Feature/*             tests/Feature/

# 3. احذف users migration الافتراضية (لدينا بديل)
rm database/migrations/0001_01_01_000000_create_users_table.php

# 4. اضبط SQLite في .env
#    DB_CONNECTION=sqlite   (واحذف أسطر DB_HOST/PORT/DATABASE/USERNAME/PASSWORD)
touch database/database.sqlite

# 5. شغّل الهجرات والاختبارات
php artisan migrate
php artisan test --filter=LedgerTest

# 6. شغّل الخادم
php artisan serve   # → http://127.0.0.1:8000
```

---

## ماذا تتوقع أن ترى

اختبار ناجح يعني المحرك سليم:

```
PASS  Tests\Feature\LedgerTest
✓ it posts a balanced entry          ← القيد المتوازن يُرحّل
✓ it rejects unbalanced entry        ← غير المتوازن يُرفض
✓ it rejects posting to group account ← الحساب التجميعي يُرفض
✓ it reverses an entry               ← العكس يعمل والرصيد يعود صفراً
✓ tenants are isolated               ← العزل بين العملاء مضمون

Tests: 5 passed
```

---

## تجربة المحرك يدوياً (Tinker)

```bash
php artisan tinker
```
```php
// أنشئ مستأجراً واضبط السياق
$t = App\Models\Tenant::create(['name'=>'نبراس','slug'=>'nibras']);
app(App\Tenancy\TenantContext::class)->set($t->id);

// أنشئ دليل الحسابات
app(App\Services\Accounting\ChartOfAccountsSeeder::class)->seed($t->id);

// سجّل فاتورة نقدية 1150 ريال (1000 + 15% ضريبة)
$cash  = App\Models\Account::where('code','1110')->first();
$sales = App\Models\Account::where('code','4110')->first();
$vat   = App\Models\Account::where('code','2120')->first();

$entry = app(App\Services\Accounting\LedgerService::class)->post([
    ['account_id'=>$cash->id,  'debit'=>115000],
    ['account_id'=>$sales->id, 'credit'=>100000],
    ['account_id'=>$vat->id,   'credit'=>15000],
], ['description'=>'فاتورة نقدية']);

// تحقق من الرصيد
$cash->balance->balance;   // → 115000 (1150.00 ريال)
```

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| `Class not found` | `composer dump-autoload` |
| `database.sqlite not found` | `touch database/database.sqlite` |
| `could not find driver` | فعّل `pdo_sqlite` في php.ini |
| اختبار العزل يفشل | تأكد أن النماذج ترث `BaseModel` لا `Model` |

---

## ملاحظة عن الإنتاج
SQLite للاختبار السريع فقط. للإنتاج استخدم **PostgreSQL**:
```
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_DATABASE=nibras
```
ثم `php artisan migrate:fresh`.
