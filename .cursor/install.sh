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

SUDO=""
[ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"

# ── 0/4  System toolchain (idempotent) ──
# Keeps the environment self-contained on Cursor's default base image, so it
# needs no prebuilt snapshot. Captured in the build snapshot, so a booted pod
# does not re-run apt.
SYSTEM_PACKAGES=()

if ! command -v php >/dev/null 2>&1; then
  SYSTEM_PACKAGES+=(
    php8.3-cli php8.3-mbstring php8.3-sqlite3 php8.3-pgsql php8.3-bcmath
    php8.3-intl php8.3-zip php8.3-xml php8.3-curl php8.3-gd php8.3-opcache
  )
fi

command -v unzip >/dev/null 2>&1 || SYSTEM_PACKAGES+=(unzip)
command -v zip >/dev/null 2>&1 || SYSTEM_PACKAGES+=(zip)
command -v pdftotext >/dev/null 2>&1 || SYSTEM_PACKAGES+=(poppler-utils)
command -v xmllint >/dev/null 2>&1 || SYSTEM_PACKAGES+=(libxml2-utils)

if [ "${#SYSTEM_PACKAGES[@]}" -gt 0 ]; then
  echo "▶ 0/4  Installing missing system dependencies: ${SYSTEM_PACKAGES[*]}"
  $SUDO apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    "${SYSTEM_PACKAGES[@]}"
else
  echo "▶ 0/4  System dependencies already present — skipping apt."
fi

command -v php >/dev/null 2>&1 || { echo "✗ PHP installation failed."; exit 1; }
command -v xmllint >/dev/null 2>&1 || { echo "✗ xmllint installation failed."; exit 1; }
php -m | grep -qi '^dom$' || { echo "✗ PHP DOM extension is not available."; exit 1; }

# Raise only this cloud agent's CLI limit; AWJ's Laravel test discovery exceeds
# the image's 128 MiB default. This does not change application or production config.
PHP_CLI_MEMORY_LIMIT="${AWJ_PHP_CLI_MEMORY_LIMIT:-512M}"
PHP_CLI_SCAN_DIR="$(php --ini | sed -n 's/^Scan for additional .ini files in: //p')"
if [[ ${#PHP_CLI_SCAN_DIR} -ge 2 &&
      ( ( ${PHP_CLI_SCAN_DIR:0:1} = '"' && ${PHP_CLI_SCAN_DIR: -1} = '"' ) ||
        ( ${PHP_CLI_SCAN_DIR:0:1} = "'" && ${PHP_CLI_SCAN_DIR: -1} = "'" ) ) ]]; then
  PHP_CLI_SCAN_DIR="${PHP_CLI_SCAN_DIR:1:${#PHP_CLI_SCAN_DIR}-2}"
fi
if [ -z "$PHP_CLI_SCAN_DIR" ] || [ "$PHP_CLI_SCAN_DIR" = "(none)" ]; then
  echo "✗ PHP CLI does not expose an additional .ini scan directory."
  exit 1
fi
if [[ "$PHP_CLI_SCAN_DIR" == *:* ]]; then
  echo "✗ PHP CLI exposes multiple additional .ini scan directories; expected exactly one."
  exit 1
fi
if [ ! -d "$PHP_CLI_SCAN_DIR" ] || [ ! -w "$PHP_CLI_SCAN_DIR" ]; then
  echo "✗ PHP CLI additional .ini scan directory is not writable: $PHP_CLI_SCAN_DIR"
  exit 1
fi
PHP_CLI_INI="$PHP_CLI_SCAN_DIR/99-awj-cloud-agent.ini"
printf 'memory_limit=%s\n' "$PHP_CLI_MEMORY_LIMIT" > "$PHP_CLI_INI"
[ -f "$PHP_CLI_INI" ] || { echo "✗ PHP CLI configuration was not written to $PHP_CLI_INI."; exit 1; }
EFFECTIVE_PHP_CLI_MEMORY_LIMIT="$(php -r 'echo ini_get("memory_limit");')"
if [ "$EFFECTIVE_PHP_CLI_MEMORY_LIMIT" != "$PHP_CLI_MEMORY_LIMIT" ]; then
  echo "✗ PHP CLI memory_limit is $EFFECTIVE_PHP_CLI_MEMORY_LIMIT; expected $PHP_CLI_MEMORY_LIMIT."
  exit 1
fi
echo "▶      PHP CLI memory_limit: $EFFECTIVE_PHP_CLI_MEMORY_LIMIT"

if ! command -v composer >/dev/null 2>&1; then
  echo "▶      Installing Composer..."
  php -r "copy('https://getcomposer.org/installer', '/tmp/composer-setup.php');"
  php /tmp/composer-setup.php --quiet --install-dir=/tmp --filename=composer
  $SUDO mv /tmp/composer /usr/local/bin/composer
  rm -f /tmp/composer-setup.php
fi

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
