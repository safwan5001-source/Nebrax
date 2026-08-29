#!/usr/bin/bash
# Recovery script when /bin/bash is restored: sudo ln -sf /usr/bin/bash /bin/bash
set -euo pipefail
sudo ln -sf /usr/bin/bash /bin/bash 2>/dev/null || true
cd /workspace
echo "=== git status ==="
git status --short
echo "=== web tests ==="
cd web && npm run test
echo "=== web build ==="
npm run build
cd /workspace
if [ -d /tmp/nibras-app ] && [ -f /tmp/nibras-app/artisan ]; then
  echo "=== php document review tests ==="
  cd /tmp/nibras-app && php artisan test --filter='DocumentReview|DocumentReviewer'
else
  echo "=== assembling php app ==="
  bash deploy/assemble.sh /workspace /tmp/nibras-app
  cd /tmp/nibras-app && php artisan test --filter='DocumentReview|DocumentReviewer'
fi
cd /workspace
git add -A
git commit -m "fix(documents): address PR #565 CI — vitest OOM, payload test, review fixes"
git push -u origin cursor/complete-document-center-review-ux-6a0f
echo "NEW_HEAD=$(git rev-parse HEAD)"
