#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  نبراس ERP — تجميع تطبيق Laravel كامل للإنتاج (Production)
#  نسخة إنتاجية من setup.sh: بلا SQLite وبلا تشغيل اختبارات.
#  تُستدعى وقت بناء صورة Docker. المخرَج: تطبيق Laravel جاهز في $APP_DIR.
#  الاستخدام:  bash deploy/assemble.sh /path/to/core /path/to/app
# ════════════════════════════════════════════════════════════════
set -euo pipefail

CORE_DIR="${1:?مسار النواة مطلوب}"
APP_DIR="${2:?مسار التطبيق مطلوب}"

echo "▶ 1/4  إنشاء هيكل Laravel 11..."
if [ ! -f "$APP_DIR/artisan" ]; then
  composer create-project "laravel/laravel:^11.0" "$APP_DIR" --no-interaction --prefer-dist
fi
cd "$APP_DIR"

echo "▶ 2/4  Sanctum + تفعيل طبقة الـ API..."
composer require laravel/sanctum --no-interaction
# --without-migration-prompt: لا نرحّل وقت البناء (الترحيل الحقيقي في entrypoint على pgsql)
php artisan install:api --no-interaction --without-migration-prompt || true
# جدول personal_access_tokens مضمَّن في migration النواة — نحذف نسخة Sanctum لتجنّب التكرار
rm -f database/migrations/*_create_personal_access_tokens_table.php 2>/dev/null || true

echo "▶ 3/4  دمج ملفات النواة وطبقة الـ API..."
mkdir -p app/Services app/Services/Accounting app/Services/Reporting app/Services/PrintTemplates app/Support \
         app/Tenancy app/Http/Middleware app/Http/Controllers/Api \
         app/Http/Requests app/Http/Resources app/Console/Commands \
         app/Models/Concerns tests/Feature routes config
cp -r "$CORE_DIR/app/Models/"*.php               app/Models/
# المجلدات الفرعية لا يلتقطها الـ glob أعلاه — كل مجلد جديد يُضاف صراحةً
cp -r "$CORE_DIR/app/Models/Concerns/"*.php      app/Models/Concerns/
cp -r "$CORE_DIR/app/Services/"*.php               app/Services/ 2>/dev/null || true
cp -r "$CORE_DIR/app/Services/Accounting/"*.php  app/Services/Accounting/
cp -r "$CORE_DIR/app/Services/Reporting/"*.php   app/Services/Reporting/
cp -r "$CORE_DIR/app/Services/PrintTemplates/"*.php app/Services/PrintTemplates/
cp -r "$CORE_DIR/app/Support/"*.php              app/Support/
cp -r "$CORE_DIR/app/Tenancy/"*.php              app/Tenancy/
cp -r "$CORE_DIR/app/Http/Middleware/"*.php      app/Http/Middleware/
cp -r "$CORE_DIR/app/Http/Controllers/"*.php     app/Http/Controllers/ 2>/dev/null || true
cp -r "$CORE_DIR/app/Http/Controllers/Api/"*.php app/Http/Controllers/Api/
cp -r "$CORE_DIR/app/Http/Requests/"*.php        app/Http/Requests/
cp -r "$CORE_DIR/app/Http/Resources/"*.php       app/Http/Resources/
cp -r "$CORE_DIR/app/Providers/"*.php            app/Providers/
cp -r "$CORE_DIR/config/"*.php                   config/
# أوامر artisan (تشخيص/صيانة) — بلا هذا السطر لا تصل صورة الإنتاج
cp -r "$CORE_DIR/app/Console/Commands/"*.php    app/Console/Commands/ 2>/dev/null || true
cp -r "$CORE_DIR/database/migrations/"*.php      database/migrations/
cp -r "$CORE_DIR/routes/api.php"                 routes/api.php
cp -r "$CORE_DIR/routes/console.php"             routes/console.php
cp -r "$CORE_DIR/tests/Feature/"*.php            tests/Feature/ 2>/dev/null || true

# تسجيل TenancyServiceProvider (حاسم للعزل) إن لم يكن مسجلاً
if ! grep -q "TenancyServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \[|return [\n    App\\\\Providers\\\\TenancyServiceProvider::class,|" bootstrap/providers.php
fi

# حذف users migration الافتراضية (لدينا واحدة خاصة بالمستأجرين)
rm -f database/migrations/*_create_users_table.php \
      database/migrations/*_add_api_columns* \
      database/migrations/0001_01_01_000000_create_users_table.php 2>/dev/null || true

# CORS: السماح لطلبات الواجهة (Bearer token، بلا كوكيز) — يُضبط النطاق عبر env عند التشغيل
mkdir -p config
cp "$CORE_DIR/deploy/cors.php" config/cors.php

echo "▶ 4/4  تثبيت اعتماديات الإنتاج..."
composer install --no-dev --optimize-autoloader --no-interaction

echo "✓ التجميع اكتمل في $APP_DIR"
