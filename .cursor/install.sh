#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  نبراس ERP — Cloud Agent install (idempotent dev bootstrap)
#  Backend: assembles a full Laravel 11 app from the repo "core"
#           into $NIBRAS_APP_DIR (default: $HOME/nibras-app), on SQLite.
#  Frontend: installs web/ (Next.js) deps and a local .env.
#  Runs after checkout; safe to re-run.
# ════════════════════════════════════════════════════════════════
set -euo pipefail

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${NIBRAS_APP_DIR:-$HOME/nibras-app}"

export COMPOSER_NO_INTERACTION=1
export COMPOSER_MEMORY_LIMIT=-1

# Composer 2.10+ blocks Laravel 11 (security-only) advisories by default.
# Laravel 11 is in security-only support, so allow it in this dev environment.
composer config --global policy.advisories.block false >/dev/null 2>&1 || true

echo "▶ 1/4  Assembling Laravel app into $APP_DIR (backend core merge)..."
bash "$CORE_DIR/deploy/assemble.sh" "$CORE_DIR" "$APP_DIR"

cd "$APP_DIR"

echo "▶ 2/4  Installing dev dependencies (PHPUnit, etc.) for local testing..."
composer install --optimize-autoloader

echo "▶ 3/4  Configuring SQLite for local development..."
[ -f .env ] || cp .env.example .env
grep -q '^APP_KEY=base64:' .env || php artisan key:generate --force
# Point Laravel at a local SQLite file (drop pgsql-only vars, keep the default path).
sed -i "/^DB_HOST=/d;/^DB_PORT=/d;/^DB_DATABASE=/d;/^DB_USERNAME=/d;/^DB_PASSWORD=/d" .env
if grep -q '^DB_CONNECTION=' .env; then
  sed -i "s|^DB_CONNECTION=.*|DB_CONNECTION=sqlite|" .env
else
  echo "DB_CONNECTION=sqlite" >> .env
fi
touch database/database.sqlite
php artisan migrate:fresh --force

echo "▶ 4/4  Installing web frontend (Next.js) dependencies..."
cd "$CORE_DIR/web"
npm ci
[ -f .env.local ] || cp .env.local.example .env.local

echo ""
echo "════════════════════════════════════════════════════════"
echo "✓ install complete"
echo "  Backend app : $APP_DIR  (SQLite)"
echo "  Frontend    : $CORE_DIR/web"
echo "════════════════════════════════════════════════════════"
