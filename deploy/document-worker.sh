#!/usr/bin/env bash
set -euo pipefail

cd /app

if [ "${QUEUE_CONNECTION:-database}" = "sync" ]; then
  echo "✗ Document worker refuses QUEUE_CONNECTION=sync."
  exit 1
fi

# Render injects the same application/database environment as the API service.
# Keep this worker dedicated to document processing so AI/PDF workloads never block web requests.
php artisan config:cache || echo "⚠ config:cache تخطّي"

exec php artisan queue:work "${QUEUE_CONNECTION:-database}" \
  --queue=documents \
  --sleep="${DOCUMENT_QUEUE_SLEEP:-3}" \
  --tries="${DOCUMENT_QUEUE_TRIES:-3}" \
  --timeout="${DOCUMENT_QUEUE_TIMEOUT:-180}" \
  --max-time="${DOCUMENT_QUEUE_MAX_TIME:-3600}" \
  --memory="${DOCUMENT_QUEUE_MEMORY:-256}"
