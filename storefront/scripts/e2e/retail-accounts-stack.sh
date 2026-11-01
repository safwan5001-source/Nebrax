#!/usr/bin/env bash
# B2C-ACCOUNTS — boot the LOCAL, THROWAWAY stack the retail-accounts browser E2E runs against.
#
#   LARAVEL_ROOT=/path/to/assembled/laravel ./scripts/e2e/retail-accounts-stack.sh up
#   pnpm exec playwright test --config=playwright.retail-accounts-e2e.config.ts
#   ./scripts/e2e/retail-accounts-stack.sh down
#
# The assembled Laravel app (`bash setup.sh` output) on 127.0.0.1:8000 over a fresh SQLite file whose path contains "e2e",
# seeded by e2e/support/retail-accounts-e2e-seed.php, with the retail-accounts deployment flag ON and the app's own `log`
# mail transport; and the storefront built and served in PRODUCTION mode (`next start`) on :3001. Nothing here can reach a
# deployed host: the API is loopback, the gateway secret is a throwaway constant, the DB is a scratch file.
set -euo pipefail

WORK="${E2E_WORKDIR:-/tmp/e2e-retail}"
SECRET="e2e-local-gateway-secret-not-a-real-secret"
STORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$WORK"

laravel_env() {
  export APP_ENV=production APP_DEBUG=false APP_URL=http://127.0.0.1:8000
  export DB_CONNECTION=sqlite DB_DATABASE="$WORK/e2e.sqlite"
  export QUEUE_CONNECTION=sync MAIL_MAILER=log CACHE_STORE=file SESSION_DRIVER=file LOG_CHANNEL=single
  export COMMERCE_RETAIL_ACCOUNTS_ENABLED=true STOREFRONT_GATEWAY_SECRET="$SECRET"
}
store_env() {
  export AWJ_COMMERCE_API_URL=http://127.0.0.1:8000 STOREFRONT_GATEWAY_SECRET="$SECRET"
  export NEXT_PUBLIC_DEFAULT_COUNTRY=sa NEXT_PUBLIC_DEFAULT_LOCALE=ar NEXT_TELEMETRY_DISABLED=1
  export NEXT_PUBLIC_SITE_URL=http://shop.e2e.localhost:3001
}

case "${1:-}" in
  up)
    : "${LARAVEL_ROOT:?set LARAVEL_ROOT to the assembled Laravel app (see setup.sh)}"
    (
      laravel_env
      cd "$LARAVEL_ROOT"
      rm -f "$DB_DATABASE" && touch "$DB_DATABASE"
      rm -rf storage/framework/cache/data && : > storage/logs/laravel.log
      php artisan migrate --force >/dev/null
      E2E_ALLOW_SEED=1 php "$STORE_DIR/e2e/support/retail-accounts-e2e-seed.php" > "$WORK/seed.json"
      nohup php -S 127.0.0.1:8000 -t public public/index.php > "$WORK/laravel.out" 2>&1 &
      echo $! > "$WORK/laravel.pid"
    )
    (
      store_env
      cd "$STORE_DIR"
      # always compile the CURRENT source; NEXT_PUBLIC_* values are baked in at build time.
      if [ "${E2E_SKIP_BUILD:-0}" = "1" ]; then
        echo "WARNING: E2E_SKIP_BUILD=1 — serving whatever .next already holds; results may not reflect the current source" >&2
      else
        pnpm build
      fi
      nohup pnpm exec next start -p 3001 > "$WORK/next.out" 2>&1 &
      echo $! > "$WORK/next.pid"
    )
    echo "stack up. seed: $WORK/seed.json   export E2E_SEED_JSON=$WORK/seed.json E2E_LARAVEL_ROOT=$LARAVEL_ROOT E2E_DB_PATH=$WORK/e2e.sqlite"
    ;;
  down)
    for s in laravel next; do
      [ -f "$WORK/$s.pid" ] && kill "$(cat "$WORK/$s.pid")" 2>/dev/null || true
    done
    pkill -f "next start -p 3001" 2>/dev/null || true
    echo "stack down."
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
