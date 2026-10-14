# Preview host — isolated service for App Links / Universal Links association
# files and the safe /preview/{reference} browser fallback.
#
# Zero npm dependencies: no install step, nothing fetched at build time.
#
# Railway: set the service Root Directory to `preview-host` (Dockerfile is
# auto-detected) and the health check path to `/health`.
#
# Build / run locally:
#   docker build -t awj-preview-host preview-host
#   docker run --rm -p 3000:3000 \
#     -e ANDROID_APP_LINK_SHA256_FINGERPRINTS=<sha256,...> \
#     -e APPLE_TEAM_ID=<team id> \
#     awj-preview-host
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY src ./src

# Railway injects PORT; 3000 is the local default.
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "src/server.js"]
