#!/usr/bin/bash
set -euo pipefail

sudo ln -sf /usr/bin/bash /bin/bash 2>/dev/null || true

cd /workspace
git checkout cursor/complete-document-center-review-ux-6a0f
git status -sb

cd web
NODE_OPTIONS=--max-old-space-size=8192 npm run test 2>&1 | tail -20
npm run build 2>&1 | tail -15

cd /workspace
git add -A
git commit -m "fix(documents): address PR #565 CI — vitest OOM, payload test, review fixes" || true
git push -u origin cursor/complete-document-center-review-ux-6a0f

git rev-parse HEAD
