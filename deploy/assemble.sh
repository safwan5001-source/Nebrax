#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════
#  نبراس ERP — تجميع تطبيق Laravel كامل للإنتاج (Production)
#  نسخة إنتاجية من setup.sh: بلا SQLite وبلا تشغيل اختبارات.
#  تُستدعى وقت بناء صورة Docker. المخرَج: تطبيق Laravel جاهز في $APP_DIR.
#  الاستخدام:  bash deploy/assemble.sh /path/to/core /path/to/app
# ═════════════════════════════════════════════════════════════════
set -euo pipefail

CORE_DIR="${1:?مسار النواة مطلوب}"
APP_DIR="${2:?مسار التطبيق مطلوب}"

echo "▶ 1/4  إنشاء هيكل Laravel 11..."
if [ ! -f "$APP_DIR/artisan" ]; then
  composer create-project "laravel/laravel:^11.0" "$APP_DIR" --no-interaction --prefer-dist
fi
cd "$APP_DIR"

echo "▶ 2/4  Sanctum + تخزين S3/R2 + تفعيل طبقة الـ API..."
composer require laravel/sanctum league/flysystem-aws-s3-v3:^3.0 predis/predis:^2.2 --no-interaction
php artisan install:api --no-interaction --without-migration-prompt || true
rm -f database/migrations/*_create_personal_access_tokens_table.php 2>/dev/null || true

echo "▶ 3/4  دمج ملفات النواة وطبقة الـ API..."
mkdir -p app/Contracts app/Jobs/Accounting app/Jobs/DocumentCenter app/Services app/Services/Accounting app/Services/Commerce app/Services/Pos app/Services/Pos/Hardware app/Services/Reporting app/Services/PrintTemplates app/Support app/Support/Inventory \
         app/Tenancy app/Http/Middleware app/Http/Controllers/Api \
         app/Http/Requests app/Http/Resources app/Console/Commands \
         app/Models/Concerns tests/Feature routes config docs/openapi
cp -r "$CORE_DIR/app/Models/"*.php               app/Models/
cp -r "$CORE_DIR/app/Contracts/"*.php             app/Contracts/
cp -r "$CORE_DIR/app/Jobs/DocumentCenter/"*.php   app/Jobs/DocumentCenter/
cp -r "$CORE_DIR/app/Jobs/Accounting/"*.php       app/Jobs/Accounting/
cp -r "$CORE_DIR/app/Models/Concerns/"*.php      app/Models/Concerns/
cp -r "$CORE_DIR/app/Services/"*.php               app/Services/ 2>/dev/null || true
cp -r "$CORE_DIR/app/Services/Accounting/"*.php  app/Services/Accounting/
cp -r "$CORE_DIR/app/Services/Commerce/"*.php    app/Services/Commerce/
mkdir -p app/Services/DocumentCenter
cp -r "$CORE_DIR/app/Services/DocumentCenter/"*.php app/Services/DocumentCenter/
cp -r "$CORE_DIR/app/Services/Pos/"*.php         app/Services/Pos/
cp -r "$CORE_DIR/app/Services/Pos/Hardware/"*.php app/Services/Pos/Hardware/
cp -r "$CORE_DIR/app/Services/Reporting/"*.php   app/Services/Reporting/
cp -r "$CORE_DIR/app/Services/PrintTemplates/"*.php app/Services/PrintTemplates/
cp -r "$CORE_DIR/app/Support/"*.php              app/Support/
mkdir -p app/Support/Inventory
cp -r "$CORE_DIR/app/Support/Inventory/"*.php    app/Support/Inventory/
cp -r "$CORE_DIR/app/Tenancy/"*.php              app/Tenancy/
cp -r "$CORE_DIR/app/Http/Middleware/"*.php      app/Http/Middleware/
cp -r "$CORE_DIR/app/Http/Controllers/"*.php     app/Http/Controllers/ 2>/dev/null || true
cp -r "$CORE_DIR/app/Http/Controllers/Api/"*.php app/Http/Controllers/Api/
cp -r "$CORE_DIR/app/Http/Requests/"*.php        app/Http/Requests/
cp -r "$CORE_DIR/app/Http/Resources/"*.php       app/Http/Resources/
cp -r "$CORE_DIR/app/Providers/"*.php            app/Providers/
cp -r "$CORE_DIR/config/"*.php                   config/
cp -r "$CORE_DIR/app/Console/Commands/"*.php    app/Console/Commands/ 2>/dev/null || true
cp -r "$CORE_DIR/database/migrations/"*.php      database/migrations/
cp -r "$CORE_DIR/routes/api.php"                 routes/api.php
cp -r "$CORE_DIR/routes/api_public.php"          routes/api_public.php
cp -r "$CORE_DIR/routes/api_storefront.php"      routes/api_storefront.php
cp -r "$CORE_DIR/routes/console.php"             routes/console.php
cp -r "$CORE_DIR/tests/Feature/"*.php            tests/Feature/ 2>/dev/null || true
cp -r "$CORE_DIR/docs/openapi/"*.yaml            docs/openapi/ 2>/dev/null || true

if ! grep -q "TenancyServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \\[|return [\\n    App\\\\\\\\Providers\\\\\\\\TenancyServiceProvider::class,|" bootstrap/providers.php
fi
if ! grep -q "DocumentCenterServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \\[|return [\\n    App\\\\\\\\Providers\\\\\\\\DocumentCenterServiceProvider::class,|" bootstrap/providers.php
fi
if ! grep -q "PublicApiServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \\[|return [\\n    App\\\\\\\\Providers\\\\\\\\PublicApiServiceProvider::class,|" bootstrap/providers.php
fi
if ! grep -q "StorefrontApiServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \\[|return [\\n    App\\\\\\\\Providers\\\\\\\\StorefrontApiServiceProvider::class,|" bootstrap/providers.php
fi
if ! grep -q "WebhookServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \\[|return [\\n    App\\\\\\\\Providers\\\\\\\\WebhookServiceProvider::class,|" bootstrap/providers.php
fi

rm -f database/migrations/*_create_users_table.php \\
      database/migrations/*_add_api_columns* \\
      database/migrations/0001_01_01_000000_create_users_table.php 2>/dev/null || true

mkdir -p config
cp "$CORE_DIR/deploy/cors.php" config/cors.php

echo "▶ 4/4  تثبيت اعتماديات الإنتاج..."
composer install --no-dev --optimize-autoloader --no-interaction

echo "✓ التجميع اكتمل في $APP_DIR"
