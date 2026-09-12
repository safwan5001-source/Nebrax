# Multi-stage build for Next.js (standalone output) on Node.js 22 (Alpine).
#
# Compatible with Railway's Docker builder: no BuildKit cache or secret mounts.
#
# This image serves the AWJ storefront. Catalog reads go to the AWJ Commerce
# API at runtime (AWJ_COMMERCE_API_URL / STOREFRONT_GATEWAY_SECRET). There is
# no Spree backend in production and none is required at build time.
#
# Build:
#   docker build -t storefront .
#
# Run (runtime env, not baked into the image):
#   docker run -p 3001:3001 \
#     -e AWJ_COMMERCE_API_URL=https://api.example.com \
#     -e STOREFRONT_GATEWAY_SECRET=... \
#     storefront
#
# Optional Sentry: set SENTRY_DSN / SENTRY_ORG / SENTRY_PROJECT as build-args
# to wrap the Next config. Do not pass SENTRY_AUTH_TOKEN as ARG/ENV — it would
# persist in image layers. Source-map upload is skipped without a token.

ARG NODE_VERSION=22-alpine


# ---- base: Node with pnpm (same version as package.json's `packageManager`) ----
FROM node:${NODE_VERSION} AS base
RUN npm install -g pnpm@10.33.4


# ---- deps: install production+dev dependencies for the build ----
FROM base AS deps
WORKDIR /app

# libc6-compat keeps a few native modules happy on Alpine (musl).
RUN apk add --no-cache libc6-compat

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


# ---- builder: compile the Next.js app ----
FROM base AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Optional Sentry wrap (next.config.ts skips withSentryConfig when DSN is empty).
ARG SENTRY_DSN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV SENTRY_DSN=$SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm run build


# ---- runner: minimal runtime image ----
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Static assets and the standalone server bundle.
# The standalone output ships its own minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3001

CMD ["node", "server.js"]
