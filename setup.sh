#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  نبراس ERP — تركيب وتشغيل تلقائي
#  يبني مشروع Laravel كامل، يدمج النواة، ويشغّل الاختبارات.
#  الاستخدام:   bash setup.sh
# ════════════════════════════════════════════════════════════════
set -e

CORE_DIR="$(cd "$(dirname "$0")" && pwd)"   # مجلد النواة (هذا المجلد)
APP_DIR="$CORE_DIR/../nibras-app"           # مشروع Laravel الجديد

echo "▶ 1/6  التحقق من المتطلبات..."
command -v php      >/dev/null || { echo "✗ PHP غير مثبت. ثبّت PHP 8.2+"; exit 1; }
command -v composer >/dev/null || { echo "✗ Composer غير مثبت."; exit 1; }
command -v xmllint  >/dev/null || { echo "✗ xmllint غير مثبت (حزمة libxml2-utils مطلوبة لـ ZATCA C14N 1.1)."; exit 1; }
php -m | grep -qi '^dom$' || { echo "✗ إضافة PHP DOM غير مفعّلة."; exit 1; }
PHP_VER=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
echo "  PHP $PHP_VER ✓"

echo "▶ 2/6  إنشاء مشروع Laravel..."
if [ ! -d "$APP_DIR" ]; then
  composer create-project "laravel/laravel:^11.0" "$APP_DIR" --quiet
fi
cd "$APP_DIR"

echo "▶ 3/6  تثبيت Sanctum + تفعيل مسارات API..."
composer require laravel/sanctum --quiet
php artisan install:api --no-interaction --quiet || true
# لدينا جدول personal_access_tokens ضمن migration النواة — نحذف نسخة Sanctum المنشورة لتجنّب التكرار
rm -f database/migrations/*_create_personal_access_tokens_table.php 2>/dev/null || true

echo "▶ 4/6  دمج ملفات النواة وطبقة الـ API..."
# نسخ النماذج والخدمات والـ migrations فوق المشروع
cp -r "$CORE_DIR/app/Models/"*.php        app/Models/
# السمات في مجلد فرعي لا يلتقطها glob النماذج أعلاه؛ يجب أن تطابق CI والإنتاج.
mkdir -p app/Contracts app/Models/Concerns app/Jobs/DocumentCenter app/Services app/Services/Accounting app/Services/DocumentCenter app/Services/Pos app/Services/Pos/Hardware app/Services/Reporting app/Services/PrintTemplates app/Support \
         app/Tenancy app/Http/Middleware app/Http/Controllers/Api config \
         app/Http/Requests app/Http/Resources app/Console/Commands tests/Feature routes docs/openapi
cp -r "$CORE_DIR/app/Contracts/"*.php app/Contracts/
cp -r "$CORE_DIR/app/Jobs/DocumentCenter/"*.php app/Jobs/DocumentCenter/
cp -r "$CORE_DIR/app/Models/Concerns/"*.php app/Models/Concerns/
cp -r "$CORE_DIR/app/Services/"*.php            app/Services/ 2>/dev/null || true
cp -r "$CORE_DIR/app/Services/Accounting/"*.php  app/Services/Accounting/
cp -r "$CORE_DIR/app/Services/DocumentCenter/"*.php app/Services/DocumentCenter/
cp -r "$CORE_DIR/app/Services/Pos/"*.php         app/Services/Pos/
cp -r "$CORE_DIR/app/Services/Pos/Hardware/"*.php app/Services/Pos/Hardware/
cp -r "$CORE_DIR/app/Services/Reporting/"*.php   app/Services/Reporting/
cp -r "$CORE_DIR/app/Services/PrintTemplates/"*.php app/Services/PrintTemplates/
cp -r "$CORE_DIR/app/Support/"*.php              app/Support/
cp -r "$CORE_DIR/app/Tenancy/"*.php              app/Tenancy/
cp -r "$CORE_DIR/app/Http/Middleware/"*.php      app/Http/Middleware/
cp -r "$CORE_DIR/app/Http/Controllers/"*.php     app/Http/Controllers/ 2>/dev/null || true
cp -r "$CORE_DIR/app/Http/Controllers/Api/"*.php app/Http/Controllers/Api/
cp -r "$CORE_DIR/app/Http/Requests/"*.php        app/Http/Requests/
cp -r "$CORE_DIR/app/Http/Resources/"*.php       app/Http/Resources/
cp -r "$CORE_DIR/app/Console/Commands/"*.php      app/Console/Commands/ 2>/dev/null || true
cp -r "$CORE_DIR/app/Providers/"*.php            app/Providers/
cp -r "$CORE_DIR/config/"*.php                   config/
cp -r "$CORE_DIR/database/migrations/"*.php      database/migrations/
cp -r "$CORE_DIR/routes/api.php"                 routes/api.php
cp -r "$CORE_DIR/routes/api_public.php"          routes/api_public.php
cp -r "$CORE_DIR/routes/console.php"             routes/console.php
cp -r "$CORE_DIR/tests/Feature/"*.php            tests/Feature/
# عقد OpenAPI (توثيق فقط) — يقرأه اختبار المطابقة عبر base_path('docs/openapi/…')
cp -r "$CORE_DIR/docs/openapi/"*.yaml            docs/openapi/

# تسجيل TenancyServiceProvider (حاسم للعزل) إن لم يكن مسجلاً
if ! grep -q "TenancyServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \[|return [\n    App\\\\Providers\\\\TenancyServiceProvider::class,|" bootstrap/providers.php
fi
if ! grep -q "DocumentCenterServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \[|return [\n    App\\\\Providers\\\\DocumentCenterServiceProvider::class,|" bootstrap/providers.php
fi
if ! grep -q "PublicApiServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \[|return [\n    App\\\\Providers\\\\PublicApiServiceProvider::class,|" bootstrap/providers.php
fi
if ! grep -q "WebhookServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \[|return [\n    App\\\\Providers\\\\WebhookServiceProvider::class,|" bootstrap/providers.php
fi

# حذف users migration الافتراضية (لدينا واحدة خاصة بالمستأجرين)
rm -f database/migrations/*_create_users_table.php \
      database/migrations/*_add_api_columns* \
      database/migrations/0001_01_01_000000_create_users_table.php 2>/dev/null || true

echo "▶ 5/6  إعداد قاعدة بيانات SQLite (للاختبار السريع)..."
touch database/database.sqlite
# ضبط .env لاستخدام sqlite
sed -i "s|^DB_CONNECTION=.*|DB_CONNECTION=sqlite|" .env
sed -i "/^DB_HOST=/d;/^DB_PORT=/d;/^DB_DATABASE=/d;/^DB_USERNAME=/d;/^DB_PASSWORD=/d" .env
php artisan migrate:fresh --force

echo "▶ 6/6  تشغيل اختبارات النواة المالية..."
php artisan test --filter=LedgerTest

echo ""
echo "════════════════════════════════════════════════════════"
echo "✓ جاهز. لتشغيل الخادم:"
echo "    cd $APP_DIR && php artisan serve"
echo "════════════════════════════════════════════════════════"
