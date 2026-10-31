#!/usr/bin/env bash
# Boot `next dev` for the default Playwright config (the fixture-route specs under e2e/).
# Loads `.env.e2e` into the environment when one exists; none is required.

set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -f .env.e2e ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.e2e
  set +a
fi

# Reuse the canonical dev command (port + flags) from package.json.
exec pnpm run dev
