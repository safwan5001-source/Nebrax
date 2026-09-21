#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  نقطة تشغيل أَوْج AWJ (Production runtime)
#  تهيئة Laravel + migrations fail-closed ثم Apache production runtime.
# ════════════════════════════════════════════════════════════════
set -euo pipefail

cd /app

# Laravel's generated FileStore, session files, and compiled Blade views all
# write below these paths. The image prepares them, but re-create and repair
# ownership at startup as well so a Railway-mounted/reused filesystem cannot
# turn the first public request into a 500 after a redeploy.
mkdir -p \
  storage/framework/cache/data \
  storage/framework/sessions \
  storage/framework/testing \
  storage/framework/views \
  storage/logs \
  bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache
chmod -R ug+rwX storage bootstrap/cache

for writable_path in \
  storage/framework/cache/data \
  storage/framework/sessions \
  storage/framework/testing \
  storage/framework/views \
  storage/logs \
  bootstrap/cache; do
  if ! su -s /bin/sh www-data -c "test -w '$writable_path'"; then
    echo "✗ Laravel runtime path is not writable by www-data: $writable_path"
    exit 1
  fi
done

if [ -z "${APP_KEY:-}" ]; then
  echo "⚠  APP_KEY غير مضبوط — أُولّد مفتاحاً مؤقتاً. للثبات اضبطه في متغيّرات البيئة."
  php artisan key:generate --force
fi

php artisan config:cache || echo "⚠ config:cache تخطّي"
php artisan route:cache  || echo "⚠ route:cache تخطّي"

echo "▶ ترحيل قاعدة البيانات..."
migrated=0
for attempt in 1 2 3 4 5; do
  if php artisan migrate --force; then
    migrated=1
    break
  fi
  if [ "${attempt}" -lt 5 ]; then
    echo "⚠ فشل الترحيل (محاولة ${attempt}/5) — إعادة بعد 5ث..."
    sleep 5
  fi
done

if [ "${migrated}" -ne 1 ]; then
  echo "✗ تعذّر ترحيل قاعدة البيانات بعد 5 محاولات — أوقفتُ الإقلاع عمداً."
  echo "  راجع سجلّ الترحيل أعلاه، ومتغيّرات DB_* واتصال القاعدة."
  exit 1
fi

# Railway injects PORT. Apache must listen on that exact port.
PORT="${PORT:-8000}"
sed -ri "s/^Listen .*/Listen ${PORT}/" /etc/apache2/ports.conf
sed -ri "s/<VirtualHost \*:[0-9]+>/<VirtualHost *:${PORT}>/" /etc/apache2/sites-available/000-default.conf

# Railway runtime may re-enable mpm_event after the image build. mod_php requires
# prefork, so enforce exactly one compatible MPM at container startup.
a2dismod mpm_event mpm_worker >/dev/null 2>&1 || true
a2enmod mpm_prefork >/dev/null 2>&1
apache2ctl configtest

echo "▶ إقلاع أَوْج عبر Apache على المنفذ ${PORT}"
exec apache2-foreground
