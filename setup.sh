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
PHP_VER=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
echo "  PHP $PHP_VER ✓"

echo "▶ 2/6  إنشاء مشروع Laravel..."
if [ ! -d "$APP_DIR" ]; then
  composer create-project laravel/laravel "$APP_DIR" --quiet
fi
cd "$APP_DIR"

echo "▶ 3/6  تثبيت Sanctum (المصادقة)..."
composer require laravel/sanctum --quiet

echo "▶ 4/6  دمج ملفات النواة..."
# نسخ النماذج والخدمات والـ migrations فوق المشروع
cp -r "$CORE_DIR/app/Models/"*.php        app/Models/
mkdir -p app/Services/Accounting app/Tenancy app/Http/Middleware tests/Feature
cp -r "$CORE_DIR/app/Services/Accounting/"*.php  app/Services/Accounting/
cp -r "$CORE_DIR/app/Tenancy/"*.php              app/Tenancy/
cp -r "$CORE_DIR/app/Http/Middleware/"*.php      app/Http/Middleware/
cp -r "$CORE_DIR/app/Providers/"*.php            app/Providers/
cp -r "$CORE_DIR/database/migrations/"*.php      database/migrations/
cp -r "$CORE_DIR/tests/Feature/"*.php            tests/Feature/

# تسجيل TenancyServiceProvider (حاسم للعزل) إن لم يكن مسجلاً
if ! grep -q "TenancyServiceProvider" bootstrap/providers.php; then
  sed -i "s|return \[|return [\n    App\\\\Providers\\\\TenancyServiceProvider::class,|" bootstrap/providers.php
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
