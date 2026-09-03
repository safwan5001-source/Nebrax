#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  نبراس ERP — Cloud Agent start (per-boot dev servers)
#  Launches the Laravel API (:8000) detached, then the Next.js dev
#  server (:3000) in the foreground so this process stays attached.
# ════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${NIBRAS_APP_DIR:-$HOME/nibras-app}"

if [ -f "$APP_DIR/artisan" ]; then
  echo "▶ Starting Laravel API on 0.0.0.0:8000 (logs: /tmp/nibras-backend.log)"
  ( cd "$APP_DIR" && exec php artisan serve --host=0.0.0.0 --port=8000 ) \
    > /tmp/nibras-backend.log 2>&1 &
else
  echo "⚠ Backend app not found at $APP_DIR — run .cursor/install.sh first." >&2
fi

echo "▶ Starting Next.js dev server on :3000"
cd "$REPO_DIR/web"
exec npm run dev
