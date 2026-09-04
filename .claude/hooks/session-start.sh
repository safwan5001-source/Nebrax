#!/bin/bash
# يجهّز بيئة نبراس ERP في جلسات Claude Code على الويب: يبني مشروع Laravel
# الكامل من نواة الريبو (setup.sh) ويثبّت تبعيات واجهة web/ — حتى تعمل
# php artisan test وnpm run build/lint/test فوراً بلا خطوات يدوية.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

CORE_DIR="$CLAUDE_PROJECT_DIR"
APP_DIR="$CORE_DIR/../nibras-app"

echo "▶ تجهيز backend (Laravel) من النواة..."
bash "$CORE_DIR/setup.sh"

echo "▶ تثبيت تبعيات web/ (Next.js)..."
cd "$CORE_DIR/web"
npm install --no-audit --no-fund

echo "✓ البيئة جاهزة: $APP_DIR (Laravel) + $CORE_DIR/web (Next.js)"
