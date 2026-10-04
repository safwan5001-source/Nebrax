#!/usr/bin/env bash
# Re-creates the deterministic H4-8 fixture in the real nibras-app DB (migrate:fresh + seed) and refreshes seed.json.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd /home/user/nibras-app && php artisan migrate:fresh --force --quiet && php "$HERE/seed.php" > "$HERE/seed.json"
